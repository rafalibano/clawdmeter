import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { NgxEchartsDirective, provideEchartsCore } from 'ngx-echarts';
import type { ConnectionAction } from '../../../domain/connections';
import { USAGE_RANGES, type UsageRange } from '../../../domain/usage';
import { I18n } from '../../i18n';
import { APPLICATION } from '../../shell/application.token';
import { ConnectionsFacade } from '../../shell/connections.facade';
import { PageStateService } from '../../shell/page-state.service';
import { SettingsFacade } from '../../shell/settings.facade';
import { chartPalette } from '../../theme/chart-palette';
import { ThemeService } from '../../theme/theme.service';
import { buildChartOption } from './usage-chart-option';
import { USAGE_PAGE } from './usage-page-ref';
import { UsageViewState } from './usage-view-state';
import { activeUsageData, toUsageErrorView, toUsageView } from './usage-view';

const CLOCK_TICK_MS = 15_000;

@Component({
  selector: 'cm-usage-page',
  imports: [NgxEchartsDirective],
  providers: [provideEchartsCore({ echarts: () => import('./echarts-setup').then((module) => module.echarts) })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './usage.component.html',
  styleUrl: './usage.component.scss',
})
export class UsageComponent {
  private readonly pageState = inject(PageStateService);
  private readonly update = this.pageState.of(USAGE_PAGE);
  private readonly lastData = this.pageState.lastOk(USAGE_PAGE);
  private readonly connections = inject(ConnectionsFacade);
  private readonly application = inject(APPLICATION);
  private readonly scheduler = this.application.scheduler;
  private readonly state = inject(UsageViewState);
  private readonly settings = inject(SettingsFacade);
  private readonly theme = inject(ThemeService);
  private readonly now = signal(this.application.clock.now());
  protected readonly i18n = inject(I18n);

  protected readonly ranges = USAGE_RANGES;
  protected readonly rangeId = this.state.range;

  private readonly palette = computed(() => {
    const { appearance, seriesColors } = this.settings.settings();
    return chartPalette(appearance.accentColor, appearance.popoverBackground, this.theme.resolved(), seriesColors);
  });

  protected readonly view = computed(() => {
    const data = activeUsageData(this.update(), this.lastData(), this.settings.settings().claude.activeAccountId);
    if (data === undefined) return null;
    const l = this.i18n.localizer();
    const usage = toUsageView(data, this.rangeId(), l, this.settings.settings().projectionMethod);
    return {
      bars: usage.bars,
      cycleAvailable: usage.cycleAvailable,
      option: buildChartOption(usage.chart, this.palette(), l),
    };
  });

  protected readonly error = computed(() => {
    const update = this.update();
    if (update?.status !== 'error') return null;
    const l = this.i18n.localizer();
    const text =
      update.rateLimitedUntil === undefined
        ? this.i18n.errorText(update)
        : l.t('usage.rateLimited', { span: l.span(update.rateLimitedUntil - this.now()) });
    return toUsageErrorView(
      text,
      this.connections.rows().find((row) => row.id === 'claude'),
    );
  });

  constructor() {
    const stop = this.application.clock.every(CLOCK_TICK_MS, () => this.now.set(this.application.clock.now()));
    inject(DestroyRef).onDestroy(stop);
  }

  protected rangeLabel(range: UsageRange): string {
    return range.cycle ? this.i18n.t('usage.range.reset') : range.label;
  }

  protected select(id: string): void {
    this.state.range.set(id);
  }

  protected async run(action: ConnectionAction): Promise<void> {
    await this.connections.act('claude', action);
    if (!this.connections.opensSettings('claude', action)) await this.scheduler.refresh(USAGE_PAGE.id);
  }
}
