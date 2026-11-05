import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { I18n } from '../i18n';
import { bannerView, type BannerAction } from './update-view';
import { UpdatesFacade } from './updates.facade';

@Component({
  selector: 'cm-update-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (view(); as banner) {
      <div class="banner" role="status" data-update-banner>
        <span class="text">{{ banner.text }}</span>
        @if (banner.action; as action) {
          <button type="button" class="action" [attr.data-action]="action" (click)="act(action)">
            {{ actionText(action) }}
          </button>
        }
        @if (banner.dismissible) {
          <button type="button" class="later" (click)="updates.dismiss()">{{ i18n.t('updates.banner.later') }}</button>
        }
      </div>
    }
  `,
  styleUrl: './update-banner.component.scss',
})
export class UpdateBannerComponent {
  protected readonly updates = inject(UpdatesFacade);
  protected readonly i18n = inject(I18n);
  protected readonly view = computed(() =>
    this.updates.showBanner() ? bannerView(this.i18n.localizer(), this.updates.snapshot().status) : null,
  );

  protected actionText(action: Exclude<BannerAction, null>): string {
    switch (action) {
      case 'install':
        return this.i18n.t('updates.banner.update');
      case 'restart':
        return this.i18n.t('updates.banner.restart');
      case 'retry-install':
        return this.i18n.t('common.retry');
    }
  }

  protected act(action: Exclude<BannerAction, null>): void {
    if (action === 'restart') void this.updates.restart();
    else void this.updates.install();
  }
}
