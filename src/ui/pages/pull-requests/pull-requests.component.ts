import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PullRequestsViewComponent } from '../shared/pull-requests-view.component';
import { PULL_REQUESTS_PAGE } from './pull-requests-page-ref';

@Component({
  selector: 'dp-pull-requests-page',
  imports: [PullRequestsViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<dp-pull-requests-view [page]="page" />`,
})
export class PullRequestsComponent {
  protected readonly page = PULL_REQUESTS_PAGE;
}
