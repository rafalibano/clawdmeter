import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { PullRequestsData } from '../../../application/pull-requests';
import type { PageRef } from '../../../application/pages';
import { PageStateService } from '../../shell/page-state.service';
import { PageErrorComponent } from './page-error.component';
import { PullRequestSectionsComponent } from './pull-request-sections.component';

@Component({
  selector: 'dp-pull-requests-view',
  imports: [PageErrorComponent, PullRequestSectionsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .loading {
      color: var(--dp-muted);
    }
  `,
  template: `
    @let state = update();
    @if (state === undefined) {
      <p class="loading">Carregando…</p>
    } @else if (state.status === 'error') {
      <dp-page-error [pageId]="page().id" connection="github" [message]="state.error" [problem]="state.problem" />
    } @else {
      <dp-pull-request-sections [sections]="state.data.sections" [now]="state.at" [showAuthor]="showAuthor()" />
    }
  `,
})
export class PullRequestsViewComponent {
  private readonly pageState = inject(PageStateService);

  readonly page = input.required<PageRef<PullRequestsData>>();
  readonly showAuthor = input(false);

  protected readonly update = computed(() => this.pageState.get(this.page()));
}
