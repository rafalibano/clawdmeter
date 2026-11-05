import { runNotice, type SkillRun } from '../../../domain/skills';
import type { Connections } from '../../connections/create-connections';
import type { Notifier } from '../../ports';

export class NotifyRunFinished {
  constructor(
    private readonly notifier: Notifier,
    private readonly connections: Pick<Connections, 'monitor' | 'check'>,
  ) {}

  async execute(run: SkillRun): Promise<void> {
    const notice = runNotice(run);
    if (notice === null) return;
    try {
      const known = this.connections.monitor.get('notifications');
      const status = known.state === 'unknown' ? await this.connections.check.execute('notifications') : known;
      if (status.state !== 'connected') return;
      await this.notifier.notify(notice);
    } catch {
      return;
    }
  }
}
