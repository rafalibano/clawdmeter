import { describe, expect, it } from 'vitest';
import { buildDailyUsage, localDayStarts, type RawDailyUsage } from '../../../domain/usage';
import { Localizer } from '../../i18n';
import { toDailyView } from './usage-daily-view';

const NOW = new Date(2026, 10, 13, 15, 0).getTime();
const STARTS = localDayStarts(NOW, 7);

function usage(days: Array<[number, Record<string, number>, number[]]>) {
  const raw: RawDailyUsage = {
    complete: true,
    days: days.map(([index, models, peaks]) => ({
      start: STARTS[index] ?? 0,
      models: Object.entries(models).map(([model, tokens]) => ({ model, tokens })),
      sessions: peaks.length,
      contextPeaks: peaks,
    })),
  };
  return buildDailyUsage(raw);
}

describe('toDailyView', () => {
  const en = new Localizer('en');

  it('shows the most recent day first, with today and yesterday spelled out', () => {
    const view = toDailyView(
      usage([
        [4, { 'claude-opus-5-5': 1_000 }, [10]],
        [5, { 'claude-opus-5-5': 2_000 }, [10]],
        [6, { 'claude-opus-5-5': 3_000 }, [10]],
      ]),
      NOW,
      en,
    );
    expect(view.days.map((day) => day.label)).toEqual(['Today', 'Yesterday', expect.stringMatching(/^wed \d\d\/\d\d$/)]);
  });

  it('formats tokens compactly, with short model names, sessions and average context', () => {
    const view = toDailyView(
      usage([[6, { 'claude-opus-5-5': 212_400_000, 'claude-haiku-5-5': 340_000 }, [400_000, 100_000]]]),
      NOW,
      en,
    );
    expect(view.empty).toBe(false);
    expect(view.days[0]).toMatchObject({
      total: '212.7M',
      sessions: '2 sessions',
      context: 'avg context 250k',
      models: [
        { model: 'opus-5-5', tokens: '212.4M' },
        { model: 'haiku-5-5', tokens: '340k' },
      ],
      idle: false,
    });
  });

  it('splits the period by model with a percentage and a bar width', () => {
    const view = toDailyView(usage([[6, { 'claude-opus-5-5': 750, 'claude-haiku-5-5': 249, 'claude-sonnet-5-5': 1 }, [1]]]), NOW, en);
    expect(view.shares).toEqual([
      { model: 'opus-5-5', percent: '75%', fill: 75 },
      { model: 'haiku-5-5', percent: '25%', fill: 24.9 },
      { model: 'sonnet-5-5', percent: '<1%', fill: 0.1 },
    ]);
  });

  it('a day without use is idle, with no context', () => {
    const view = toDailyView(
      usage([
        [5, {}, []],
        [6, { 'claude-opus-5-5': 10 }, [5]],
      ]),
      NOW,
      en,
    );
    expect(view.days[1]).toMatchObject({ idle: true, total: '0', context: null, models: [] });
  });

  it('is empty when no day has any use', () => {
    const view = toDailyView(usage([[6, {}, []]]), NOW, en);
    expect(view.empty).toBe(true);
    expect(view.shares).toEqual([]);
  });

  it('a model id that does not start with claude- is shown as is', () => {
    expect(toDailyView(usage([[6, { unknown: 5 }, [1]]]), NOW, en).shares[0]?.model).toBe('unknown');
  });

  it('speaks pt-BR and es-MX', () => {
    const data = usage([
      [5, { 'claude-opus-5-5': 5_000 }, [1_000]],
      [6, { 'claude-opus-5-5': 5_000 }, [1_000, 3_000]],
    ]);
    const pt = toDailyView(data, NOW, new Localizer('pt-BR'));
    expect(pt.days.map((day) => day.label)).toEqual(['Hoje', 'Ontem']);
    expect(pt.days[0]?.sessions).toBe('2 sessões');
    expect(pt.days[0]?.context).toBe('contexto médio 2k');
    const es = toDailyView(data, NOW, new Localizer('es-MX'));
    expect(es.days.map((day) => day.label)).toEqual(['Hoy', 'Ayer']);
    expect(es.days[0]?.context).toBe('contexto promedio 2k');
  });
});
