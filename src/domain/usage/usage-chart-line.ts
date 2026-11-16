export type UsageChartLine = 'stepped' | 'smooth';

export const USAGE_CHART_LINES: readonly UsageChartLine[] = ['stepped', 'smooth'];

export const DEFAULT_USAGE_CHART_LINE: UsageChartLine = 'stepped';

export function isUsageChartLine(value: unknown): value is UsageChartLine {
  return USAGE_CHART_LINES.includes(value as UsageChartLine);
}
