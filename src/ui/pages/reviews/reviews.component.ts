import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PullRequestsViewComponent } from '../shared/pull-requests-view.component';
import { REVIEWS_PAGE } from './reviews-page-ref';

@Component({
  selector: 'dp-reviews-page',
  imports: [PullRequestsViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<dp-pull-requests-view [page]="page" [showAuthor]="true" />`,
})
export class ReviewsComponent {
  protected readonly page = REVIEWS_PAGE;
}
