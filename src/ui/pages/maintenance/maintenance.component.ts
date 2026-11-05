import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { I18n } from '../../i18n';

@Component({
  selector: 'dp-maintenance-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 32px 12px;
      text-align: center;
      color: var(--dp-muted);
    }
    .title {
      margin: 0;
      font-weight: 600;
      color: inherit;
    }
    .text {
      margin: 0;
    }
  `,
  template: `
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z" />
    </svg>
    <p class="title">{{ i18n.t('maintenance.title') }}</p>
    <p class="text">{{ i18n.t('maintenance.description') }}</p>
  `,
})
export class MaintenanceComponent {
  protected readonly i18n = inject(I18n);
}
