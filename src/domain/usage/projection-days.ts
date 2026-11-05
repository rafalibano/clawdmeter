import { trendValueAt, type TrendLine } from './forecast';

export interface ProjectionDay {
  at: number;
  value: number;
}

export function localMidnightsBetween(from: number, to: number): number[] {
  const midnights: number[] = [];
  const cursor = new Date(from);
  cursor.setHours(24, 0, 0, 0);
  while (cursor.getTime() < to) {
    midnights.push(cursor.getTime());
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(0, 0, 0, 0);
  }
  return midnights;
}

export function projectionDays(trend: TrendLine): ProjectionDay[] {
  return [...localMidnightsBetween(trend.fromAt, trend.toAt), trend.toAt].map((at) => ({
    at,
    value: trendValueAt(trend, at),
  }));
}
