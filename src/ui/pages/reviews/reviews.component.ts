import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PullRequestsViewComponent } from '../shared/pull-requests-view.component';
import { REVIEWS_PAGE } from './reviews-page-ref';

@Component({
  selector: 'cm-reviews-page',
  imports: [PullRequestsViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<cm-pull-requests-view [page]="page" />`,
})
export class ReviewsComponent {
  protected readonly page = REVIEWS_PAGE;
}
