import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import type { RunFix, SkillRun } from '../../../domain/skills';
import { APPLICATION } from '../../shell/application.token';

@Injectable({ providedIn: 'root' })
export class SkillsFacade {
  private readonly skills = inject(APPLICATION).skills;

  readonly runs = signal<readonly SkillRun[]>([]);
  readonly error = signal<string | null>(null);

  constructor() {
    const stop = this.skills.board.subscribe((runs) => this.runs.set(runs));
    inject(DestroyRef).onDestroy(stop);
  }

  run(skillId: string): Promise<void> {
    return this.attempt(async () => {
      await this.skills.run.execute(skillId);
    });
  }

  cancel(runId: string): Promise<void> {
    return this.attempt(() => this.skills.cancel.execute(runId));
  }

  continueInTerminal(runId: string): Promise<void> {
    return this.attempt(() => this.skills.continueInTerminal.execute(runId));
  }

  fix(fix: RunFix): Promise<void> {
    return this.attempt(() => this.skills.fix.execute(fix));
  }

  private async attempt(work: () => Promise<void>): Promise<void> {
    this.error.set(null);
    try {
      await work();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    }
  }
}
