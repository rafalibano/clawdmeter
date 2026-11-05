import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FIX_FOR, FIX_LABELS, type ConnectionId, type ConnectionProblem } from '../../../domain/connections';
import { PageProblemFacade } from './page-problem.facade';

@Component({
  selector: 'dp-page-error',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .error {
      padding: 12px;
      border: 1px solid color-mix(in srgb, #ef4444 40%, transparent);
      border-radius: 8px;
      background: color-mix(in srgb, #ef4444 10%, transparent);
    }
    .message {
      margin: 0 0 10px;
    }
    .actions {
      display: flex;
      gap: 6px;
    }
    .btn {
      padding: 4px 10px;
      border: 1px solid var(--dp-border);
      border-radius: 6px;
      background: var(--dp-surface);
      color: inherit;
      cursor: pointer;
    }
    .btn.primary {
      border-color: var(--dp-accent);
      background: var(--dp-accent);
      color: var(--dp-accent-fg);
    }
    .btn:disabled {
      opacity: 0.6;
      cursor: default;
    }
  `,
  template: `
    <div class="error" role="alert" [attr.data-problem]="problem() ?? 'none'">
      <p class="message">{{ message() }}</p>
      <div class="actions">
        @if (fixLabel(); as label) {
          <button type="button" class="btn primary" data-action="fix" [disabled]="busy()" (click)="fix()">{{ label }}</button>
        }
        <button type="button" class="btn" data-action="retry" [disabled]="busy()" (click)="retry()">Tentar de novo</button>
      </div>
    </div>
  `,
})
export class PageErrorComponent {
  private readonly facade = inject(PageProblemFacade);

  readonly pageId = input.required<string>();
  readonly connection = input.required<ConnectionId>();
  readonly message = input.required<string>();
  readonly problem = input<ConnectionProblem | undefined>(undefined);

  protected readonly busy = signal(false);
  protected readonly fixLabel = computed(() => {
    const problem = this.problem();
    if (problem === undefined) return null;
    const fix = FIX_FOR[problem];
    return fix === 'retry' ? null : FIX_LABELS[fix];
  });

  constructor() {
    effect(() => {
      const problem = this.problem();
      const message = this.message();
      if (problem !== undefined) untracked(() => this.facade.report(this.connection(), problem, message));
    });
  }

  protected async fix(): Promise<void> {
    const problem = this.problem();
    if (problem === undefined) return;
    await this.run(() => this.facade.fix(this.pageId(), this.connection(), problem));
  }

  protected retry(): Promise<void> {
    return this.run(() => this.facade.retry(this.pageId()));
  }

  private async run(work: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await work();
    } finally {
      this.busy.set(false);
    }
  }
}
