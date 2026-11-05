import { formatDuration, runNotice, type RunNotice, type SkillRun } from '../../../domain/skills';
import type { Connections } from '../../connections/create-connections';
import type { Notice, Notifier, Translator } from '../../ports';

export function describeRunFailure(
  notice: { failure: RunNotice['failure']; exitCode: number | null; error: string | null },
  translator: Translator,
): string {
  const base =
    notice.failure === null
      ? ''
      : translator.t(`run.failure.${notice.failure}`, { code: notice.exitCode ?? translator.t('run.exitCode.unknown') });
  return [base, notice.error ?? ''].filter((part) => part !== '').join('\n');
}

export function toNotice(notice: RunNotice, translator: Translator): Notice {
  const details = [notice.costUsd === null ? null : translator.cost(notice.costUsd), formatDuration(notice.durationMs)].filter(
    (part): part is string => part !== null,
  );
  if (notice.outcome === 'succeeded') return { title: translator.t('notice.run.succeeded', { name: notice.name }), body: details.join(' · ') };
  const reason = describeRunFailure(notice, translator).replace(/\s+/g, ' ').slice(0, 140);
  return {
    title: translator.t('notice.run.failed', { name: notice.name }),
    body: [reason, ...details].filter((part) => part !== '').join(' · '),
  };
}

export class NotifyRunFinished {
  constructor(
    private readonly notifier: Notifier,
    private readonly connections: Pick<Connections, 'monitor' | 'check'>,
    private readonly translator: Translator,
  ) {}

  async execute(run: SkillRun): Promise<void> {
    const notice = runNotice(run);
    if (notice === null) return;
    try {
      const known = this.connections.monitor.get('notifications');
      const status = known.state === 'unknown' ? await this.connections.check.execute('notifications') : known;
      if (status.state !== 'connected') return;
      await this.notifier.notify(toNotice(notice, this.translator));
    } catch {
      return;
    }
  }
}
