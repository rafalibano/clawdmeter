import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NgxEchartsDirective, provideEchartsCore } from 'ngx-echarts';
import type { ConnectionAction } from '../../../domain/connections';
import { USAGE_RANGES } from '../../../domain/usage';
import { APPLICATION } from '../../shell/application.token';
import { ConnectionsFacade } from '../../shell/connections.facade';
import { PageStateService } from '../../shell/page-state.service';
import { SettingsFacade } from '../../shell/settings.facade';
import { chartPalette } from '../../theme/chart-palette';
import { ThemeService } from '../../theme/theme.service';
import { buildChartOption } from './usage-chart-option';
import { USAGE_PAGE } from './usage-page-ref';
import { UsageViewState } from './usage-view-state';
import { toUsageErrorView, toUsageView } from './usage-view';

@Component({
  selector: 'dp-usage-page',
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
  private readonly scheduler = inject(APPLICATION).scheduler;
  private readonly state = inject(UsageViewState);
  private readonly settings = inject(SettingsFacade);
  private readonly theme = inject(ThemeService);

  protected readonly ranges = USAGE_RANGES;
  protected readonly rangeId = this.state.range;

  private readonly palette = computed(() => {
    const { accentColor, popoverBackground } = this.settings.settings().appearance;
    return chartPalette(accentColor, popoverBackground, this.theme.resolved());
  });

  protected readonly view = computed(() => {
    const update = this.update();
    const data = update?.status === 'ok' ? update.data : this.lastData();
    if (data === undefined) return null;
    const usage = toUsageView(data, this.rangeId());
    return { bars: usage.bars, option: buildChartOption(usage.chart, this.palette()) };
  });

  protected readonly error = computed(() => {
    const update = this.update();
    if (update?.status !== 'error') return null;
    return toUsageErrorView(
      update.error,
      this.connections.rows().find((row) => row.id === 'claude'),
    );
  });

  protected select(id: string): void {
    this.state.range.set(id);
  }

  protected async run(action: ConnectionAction): Promise<void> {
    await this.connections.act('claude', action);
    await this.scheduler.refresh(USAGE_PAGE.id);
  }
}
