import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { PageStateService } from '../../shell/page-state.service';
import { EXAMPLE_PAGE_ID } from './example-page-id';
import type { ExampleData } from './example.page';

@Component({
  selector: 'dp-example-page',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .card {
      padding: 12px;
      border: 1px solid var(--dp-border);
      border-radius: 8px;
      background: var(--dp-surface);
    }
    .value {
      font-size: 22px;
      font-weight: 600;
      color: var(--dp-accent);
    }
    .hint {
      margin: 0 0 12px;
      color: var(--dp-muted);
    }
  `,
  template: `
    <p class="hint">Página de exemplo registrada via PageModule.</p>
    @if (data(); as data) {
      <div class="card">
        <div class="value">{{ data.loads }}ª leitura</div>
        <div>às {{ data.loadedAt | date: 'HH:mm:ss' }}</div>
      </div>
    } @else {
      <div class="card">Carregando…</div>
    }
  `,
})
export class ExampleComponent {
  private readonly update = inject(PageStateService).of(EXAMPLE_PAGE_ID);

  protected readonly data = computed(() => {
    const update = this.update();
    return update?.status === 'ok' ? (update.data as ExampleData) : null;
  });
}
