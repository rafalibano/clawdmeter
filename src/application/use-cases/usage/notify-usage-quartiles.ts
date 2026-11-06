import { USAGE_WINDOWS, evaluateUsageAlert } from '../../../domain/usage';
import type { Quartile, UsageSnapshot, UsageWindowKind, WindowAlertState } from '../../../domain/usage';
import type { Connections } from '../../connections/create-connections';
import type { Clock, Notice, Notifier, SettingsStore, Translator } from '../../ports';

function dayKey(at: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

function describeReset(resetsAt: number, now: number, locale: string): string {
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(resetsAt);
  if (dayKey(resetsAt, locale) === dayKey(now, locale)) return time;
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(resetsAt).replace('.', '').toLowerCase();
  return `${weekday} ${time}`;
}

export class NotifyUsageQuartiles {
  private readonly states = new Map<UsageWindowKind, WindowAlertState>();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly notifier: Notifier,
    private readonly connections: Pick<Connections, 'monitor' | 'check'>,
    private readonly translator: Translator,
    private readonly settings: SettingsStore,
    private readonly clock: Clock,
  ) {}

  execute(snapshot: UsageSnapshot): Promise<void> {
    this.queue = this.queue.then(() => this.run(snapshot)).catch(() => undefined);
    return this.queue;
  }

  private async run(snapshot: UsageSnapshot): Promise<void> {
    try {
      const { usageAlerts } = await this.settings.load();
      const notices = USAGE_WINDOWS.flatMap(({ kind, label }) => {
        const reading = snapshot[kind];
        if (reading === null) return [];
        const outcome = evaluateUsageAlert(this.states.get(kind) ?? null, reading, usageAlerts[kind]);
        this.states.set(kind, outcome.state);
        return outcome.alert === null ? [] : [this.toNotice(label, outcome.alert, reading.utilization, reading.resetsAt)];
      });
      if (notices.length === 0 || !(await this.notificationsConnected())) return;
      for (const notice of notices) await this.notifier.notify(notice).catch(() => undefined);
    } catch {
      return;
    }
  }

  private async notificationsConnected(): Promise<boolean> {
    const known = this.connections.monitor.get('notifications');
    const status = known.state === 'unknown' ? await this.connections.check.execute('notifications') : known;
    return status.state === 'connected';
  }

  private toNotice(window: string, quartile: Quartile, utilization: number, resetsAt: number | null): Notice {
    const percent = Math.max(quartile, Math.floor(utilization));
    const title = this.translator.t('notice.usage.title', { window, percent });
    if (resetsAt === null) return { title, body: this.translator.t('notice.usage.body', { window }) };
    const when = describeReset(resetsAt, this.clock.now(), this.translator.locale);
    return { title, body: this.translator.t('notice.usage.body.resets', { when }) };
  }
}
