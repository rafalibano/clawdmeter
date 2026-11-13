import { describe, expect, it } from 'vitest';
import { parseModelLimits } from './model-limits';

const row = (name: unknown, percent: unknown, extra: Record<string, unknown> = {}) => ({
  kind: 'weekly_scoped',
  group: 'weekly',
  percent,
  resets_at: '2026-11-09T10:00:00+00:00',
  is_active: true,
  severity: 'normal',
  scope: { model: { display_name: name, id: null }, surface: null },
  ...extra,
});

const RESET = Date.parse('2026-11-09T10:00:00+00:00');

describe('parseModelLimits', () => {
  it('reads the rows of limits[] that carry a model name, with the name the API sends', () => {
    const limits = parseModelLimits({
      limits: [
        { kind: 'session', group: 'session', percent: 40, resets_at: null, scope: null },
        { kind: 'weekly_all', group: 'weekly', percent: 20, resets_at: null, scope: null },
        row('Fable', 31),
      ],
    });
    expect(limits).toEqual([{ name: 'Fable', utilization: 31, resetsAt: RESET }]);
  });

  it('keeps the order of the API and trims the name', () => {
    const limits = parseModelLimits({ limits: [row('  Sonnet 5 ', 10), row('Fable', 31)] });
    expect(limits.map((limit) => limit.name)).toEqual(['Sonnet 5', 'Fable']);
  });

  it('skips session rows even when they carry a model', () => {
    expect(parseModelLimits({ limits: [row('Fable', 31, { group: 'session' })] })).toEqual([]);
  });

  it('skips malformed rows: not an object, no scope, no model, empty or non-text name, no percent', () => {
    const limits = parseModelLimits({
      limits: [
        null,
        'x',
        42,
        [],
        { percent: 10 },
        { percent: 10, scope: null },
        { percent: 10, scope: { model: null } },
        row('', 10),
        row('   ', 10),
        row(7, 10),
        row('NoPercent', null),
        row('BadPercent', 'abc'),
        row('Valid', 12),
      ],
    });
    expect(limits).toEqual([{ name: 'Valid', utilization: 12, resetsAt: RESET }]);
  });

  it('accepts a textual percent, clamps a negative one and nulls an invalid reset', () => {
    const limits = parseModelLimits({ limits: [row('A', '42.5'), row('B', -5, { resets_at: 'soon' })] });
    expect(limits).toEqual([
      { name: 'A', utilization: 42.5, resetsAt: RESET },
      { name: 'B', utilization: 0, resetsAt: null },
    ]);
  });

  it('is empty when limits is absent, null or not a list', () => {
    expect(parseModelLimits({})).toEqual([]);
    expect(parseModelLimits({ limits: null })).toEqual([]);
    expect(parseModelLimits({ limits: { a: 1 } })).toEqual([]);
    expect(parseModelLimits({ limits: [] })).toEqual([]);
  });

  it('adds seven_day_opus and seven_day_sonnet when they come and are not in limits[]', () => {
    const limits = parseModelLimits({
      limits: [row('Fable', 31)],
      seven_day_opus: { utilization: 9, resets_at: '2026-11-09T10:00:00+00:00' },
      seven_day_sonnet: { utilization: 4.5, resets_at: null },
    });
    expect(limits).toEqual([
      { name: 'Fable', utilization: 31, resetsAt: RESET },
      { name: 'Opus', utilization: 9, resetsAt: RESET },
      { name: 'Sonnet', utilization: 4.5, resetsAt: null },
    ]);
  });

  it('does not duplicate a model that limits[] already carries, whatever the name casing or prefix', () => {
    const limits = parseModelLimits({
      limits: [row('Claude OPUS 4', 50), row('sonnet', 20)],
      seven_day_opus: { utilization: 9, resets_at: null },
      seven_day_sonnet: { utilization: 4, resets_at: null },
    });
    expect(limits.map((limit) => [limit.name, limit.utilization])).toEqual([
      ['Claude OPUS 4', 50],
      ['sonnet', 20],
    ]);
  });

  it('ignores null, malformed or utilization-less seven_day_* windows', () => {
    expect(
      parseModelLimits({
        seven_day_opus: null,
        seven_day_sonnet: { utilization: 'x', resets_at: null },
      }),
    ).toEqual([]);
    expect(parseModelLimits({ seven_day_opus: 'x', seven_day_sonnet: [] })).toEqual([]);
  });

  it('collapses the same name repeated in limits[], keeping the higher percent', () => {
    const limits = parseModelLimits({ limits: [row('Fable', 10), row('fable', 60), row('FABLE', 30)] });
    expect(limits).toEqual([{ name: 'fable', utilization: 60, resetsAt: RESET }]);
  });
});
