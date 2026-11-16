import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { I18n } from '../../i18n';
import type { DailyView } from './usage-daily-view';
import { UsageViewState } from './usage-view-state';

@Component({
  selector: 'cm-usage-daily',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './usage-daily.component.html',
  styleUrl: './usage-daily.component.scss',
})
export class UsageDailyComponent {
  readonly view = input.required<DailyView | null>();
  protected readonly i18n = inject(I18n);
  protected readonly open = inject(UsageViewState).dailyOpen;

  protected toggle(): void {
    this.open.update((open) => !open);
  }
}
