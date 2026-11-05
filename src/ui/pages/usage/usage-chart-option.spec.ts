import { describe, expect, it } from 'vitest';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../../../domain/time';
import { usageRange, type Forecast, type UsagePoint } from '../../../domain/usage';
import { chartPalette } from '../../theme/chart-palette';
import { Localizer } from '../../i18n';
import { axisMaxFor, buildChartModel as buildModel, CYCLE_MS, FUTURE_SHARE, type WindowInput } from './usage-chart-model';
import { buildChartOption as buildOption } from './usage-chart-option';

const PT = new Localizer('pt-BR');
const THRESHOLDS = { warning: 70, critical: 90 };
const buildChartModel = (inputs: WindowInput[], range: ReturnType<typeof usageRange>, now: number, thresholds = THRESHOLDS) =>
  buildModel(inputs, range, now, thresholds);
const buildChartOption = (model: ReturnType<typeof buildChartModel>, palette: ReturnType<typeof chartPalette>, l = PT) =>
  buildOption(model, palette, l);

const NOW = 1_800_000_000_000;
const palette = chartPalette('#00b131', null, 'light');
const points = Array.from({ length: 10 }, (_, index) => ({
  at: NOW - (9 - index) * MINUTE_MS,
  utilization: 20 + index,
  resetsAt: NOW + 4 * HOUR_MS,
}));

const ready = (toValue: number, exhaustsAt: number | null = null): Forecast => ({
  status: 'ready',
  resetsAt: NOW + 4 * HOUR_MS,
  valueAtReset: toValue,
  trend: { fromAt: NOW, fromValue: 29, toAt: NOW + 4 * HOUR_MS, toValue },
  exhaustsAt,
  exhaustsLeadMs: exhaustsAt === null ? null : NOW + 4 * HOUR_MS - exhaustsAt,
});

const WEEKLY_RESET = NOW + 3 * 24 * HOUR_MS;
const cycleInputs = (): WindowInput[] => {
  const history: UsagePoint[] = [
    { at: NOW - 8 * 24 * HOUR_MS, utilization: 90, resetsAt: NOW - 8 * 24 * HOUR_MS + 5 * HOUR_MS },
    { at: NOW - 3 * 24 * HOUR_MS, utilization: 5, resetsAt: NOW - 3 * 24 * HOUR_MS + 5 * HOUR_MS },
    { at: NOW - 2 * 24 * HOUR_MS, utilization: 20, resetsAt: NOW - 2 * 24 * HOUR_MS + 5 * HOUR_MS },
    { at: NOW - HOUR_MS, utilization: 30, resetsAt: NOW + 4 * HOUR_MS },
  ];
  return [
    { kind: 'fiveHour', label: '5h', points: history, forecast: ready(60), resetsAt: NOW + 4 * HOUR_MS },
    { kind: 'sevenDay', label: '7d', points: history, forecast: ready(75), resetsAt: WEEKLY_RESET },
  ];
};
const steepCycle = (factor: number): WindowInput[] =>
  cycleInputs().map((input) =>
    input.kind === 'sevenDay'
      ? { ...input, points: input.points.map((point) => ({ ...point, utilization: point.at < NOW - 4 * DAY_MS ? 0 : point.utilization * factor })) }
      : input,
  );

function inputs(forecast: Forecast, weekly: Forecast = { status: 'collecting' }): WindowInput[] {
  return [
    { kind: 'fiveHour', label: '5h', points, forecast, resetsAt: NOW + 4 * HOUR_MS },
    {
      kind: 'sevenDay',
      label: '7d',
      points: points.map((point) => ({ ...point, utilization: 50 })),
      forecast: weekly,
      resetsAt: NOW + 3 * 24 * HOUR_MS,
    },
  ];
}

describe('buildChartModel', () => {
  it('eixo vai de agora - período até agora + folga para a tendência', () => {
    const model = buildChartModel(inputs({ status: 'collecting' }), usageRange('1h'), NOW);
    expect(model.xMin).toBe(NOW - HOUR_MS);
    expect(model.xMax).toBe(NOW + HOUR_MS * FUTURE_SHARE);
    expect(model.windows.map((window) => window.points.length)).toEqual([10, 10]);
    expect(model.windows[0]!.trend).toBeNull();
  });

  it('tendência é cortada na borda do eixo e interpolada', () => {
    const model = buildChartModel(inputs(ready(69)), usageRange('1h'), NOW);
    const trend = model.windows[0]!.trend;
    expect(trend?.[0]).toEqual([NOW, 29]);
    expect(trend?.[1]?.[0]).toBe(model.xMax);
    expect(trend?.[1]?.[1]).toBeCloseTo(29 + (40 * HOUR_MS * FUTURE_SHARE) / (4 * HOUR_MS), 5);
  });

  it('fora do Ciclo a tendência termina onde cruza 100%', () => {
    for (const id of ['1h', '6h', '1d', '7d', '30d'] as const) {
      const model = buildChartModel(inputs(ready(5000)), usageRange(id), NOW);
      const end = model.windows[0]!.trend![1]!;
      expect(end[1]).toBe(100);
      expect(end[0]).toBeLessThan(model.xMax);
      expect(model.yMax).toBe(100);
    }
  });

  it('no Ciclo a tendência passa de 100% e termina onde cruza 300%', () => {
    const model = buildChartModel(steepCycle(40), usageRange('cycle'), NOW);
    const end = model.windows[1]!.trend![1]!;
    expect(end[1]).toBe(300);
    expect(model.yMax).toBe(300);
  });

  it('reset antes da borda: a tendência termina no reset', () => {
    const forecast = ready(40);
    const near = { ...forecast, trend: { ...(forecast as { trend: object }).trend, toAt: NOW + 5 * MINUTE_MS, toValue: 31 } } as Forecast;
    expect(buildChartModel(inputs(near), usageRange('30d'), NOW).windows[0]!.trend?.[1]).toEqual([NOW + 5 * MINUTE_MS, 31]);
  });
});

describe('escala do eixo y', () => {
  it('sem projeção acima de 100% o eixo é 0–100', () => {
    expect(axisMaxFor([])).toBe(100);
    expect(axisMaxFor([40, 100])).toBe(100);
    expect(buildChartModel(inputs(ready(60), ready(70)), usageRange('1h'), NOW).yMax).toBe(100);
  });

  it('acima de 100% sobe para o próximo múltiplo de 25 acima do máximo', () => {
    expect(axisMaxFor([100.5])).toBe(125);
    expect(axisMaxFor([124])).toBe(125);
    expect(axisMaxFor([125])).toBe(150);
    expect(axisMaxFor([180])).toBe(200);
  });

  it('o teto é 300%', () => {
    expect(axisMaxFor([299])).toBe(300);
    expect(axisMaxFor([900])).toBe(300);
  });

  it('o máximo vem do trecho desenhado da tendência, só no Ciclo', () => {
    expect(buildChartModel(steepCycle(4), usageRange('cycle'), NOW).yMax).toBeGreaterThan(100);
    expect(buildChartModel(inputs(ready(600)), usageRange('6h'), NOW).yMax).toBe(100);
  });
});

describe('buildChartOption', () => {
  const model = buildChartModel(inputs(ready(60), ready(70)), usageRange('1h'), NOW);
  const option = buildChartOption(model, palette) as unknown as {
    xAxis: { min: number; max: number; axisLine: { show: boolean }; axisLabel: { formatter: (value: number) => string } };
    yAxis: {
      min: number;
      max: number;
      interval: number;
      position: string;
      axisLine: { show: boolean };
      splitLine: { lineStyle: { color: string; type: string } };
    };
    tooltip: { backgroundColor: string };
    visualMap?: unknown;
    textStyle: { fontFamily: string };
    series: {
      name: string;
      smooth?: boolean;
      data: number[][];
      lineStyle: { color: string; type?: string; width: number };
      areaStyle?: { color: { type: string; colorStops: { offset: number; color: string }[] } };
      markLine?: { data: { xAxis?: number; yAxis?: number; lineStyle: { color: string; type: string } }[] };
    }[];
  };

  it('eixo y à direita de 0 a 100 de 25 em 25, sem linha forte, grade tracejada leve', () => {
    expect(option.yAxis).toMatchObject({ min: 0, max: 100, interval: 25, position: 'right' });
    expect(option.xAxis.axisLine.show).toBe(false);
    expect(option.yAxis.axisLine.show).toBe(false);
    expect(option.yAxis.splitLine.lineStyle).toMatchObject({ color: 'rgba(18, 18, 18, 0.06)', type: 'dashed' });
  });

  it('duas séries suaves (5h e 7d) e uma tendência tracejada e mais fina por série com previsão', () => {
    expect(option.series.map((series) => series.name)).toEqual(['5h', '7d', '5h tendência', '7d tendência']);
    const en = buildChartOption(model, palette, new Localizer('en')) as unknown as typeof option;
    expect(en.series.map((series) => series.name)).toEqual(['5h', '7d', '5h trend', '7d trend']);
    expect(option.series[0]!.smooth).toBe(true);
    expect(option.series[2]!.lineStyle).toMatchObject({ type: 'dashed', width: 1.2 });
    expect(option.series[2]!.lineStyle.width).toBeLessThan(option.series[0]!.lineStyle.width);
    expect(option.series[2]!.data[0]).toEqual([NOW, 29]);
  });

  it('5h em verde Mottu e 7d em cinza neutro, com área muito leve', () => {
    expect(option.series[0]!.lineStyle.color).toBe('#00b131');
    expect(option.series[1]!.lineStyle.color).toBe('#767676');
    expect(option.series[2]!.lineStyle.color).toBe('#00b131');
    expect(option.series[0]!.areaStyle?.color.colorStops).toEqual([
      { offset: 0, color: 'rgba(0, 177, 49, 0.1)' },
      { offset: 1, color: 'rgba(0, 177, 49, 0)' },
    ]);
    const dark = buildChartOption(model, chartPalette('#00b131', null, 'dark')) as unknown as typeof option;
    expect(dark.series[0]!.lineStyle.color).toBe('#1bd60b');
    expect(dark.series[1]!.lineStyle.color).toBe('#a9a9a9');
  });

  it('marcas: sem linha de 100% quando o eixo é 0–100, só "agora" e os resets dentro do eixo', () => {
    const marks = option.series[0]!.markLine!.data;
    expect(marks.some((mark) => mark.yAxis !== undefined)).toBe(false);
    expect(marks.some((mark) => mark.xAxis === NOW)).toBe(true);
    expect(marks.filter((mark) => mark.xAxis !== undefined && mark.xAxis > NOW)).toHaveLength(0);
    const wide = buildChartOption(buildChartModel(inputs(ready(60)), usageRange('30d'), NOW), palette) as unknown as typeof option;
    const resets = wide.series[0]!.markLine!.data.filter((mark) => mark.xAxis !== undefined && mark.xAxis > NOW);
    expect(resets.map((mark) => mark.xAxis)).toEqual([NOW + 4 * HOUR_MS, NOW + 3 * 24 * HOUR_MS]);
  });

  describe('eixo expandido (só no Ciclo)', () => {
    const cycleOption = (factor: number) =>
      buildChartOption(buildChartModel(steepCycle(factor), usageRange('cycle'), NOW), palette) as unknown as typeof option & {
        yAxis: { max: number; interval: number; axisLabel: { formatter: (value: number) => string } };
      };
    const expanded = cycleOption(4);

    it('o eixo y passa de 100% e o rótulo de 100% ganha destaque', () => {
      expect(expanded.yAxis.max).toBeGreaterThan(100);
      expect(expanded.yAxis.axisLabel.formatter(100)).toBe('{reference|100%}');
      expect(expanded.yAxis.axisLabel.formatter(50)).toBe('50%');
    });

    it('linha de referência sólida e sutil em 100%', () => {
      const reference = expanded.series[0]!.markLine!.data.filter((mark) => mark.yAxis !== undefined);
      expect(reference).toHaveLength(1);
      expect(reference[0]).toMatchObject({ yAxis: 100, lineStyle: { type: 'solid', width: 1, color: 'rgba(255, 84, 73, 0.4)' } });
    });

    it('com teto de 300% o passo do eixo é de 50 em 50', () => {
      expect(cycleOption(40).yAxis).toMatchObject({ max: 300, interval: 50 });
    });

    it('fora do Ciclo o eixo é 0–100, sem linha nem rótulo destacado', () => {
      for (const id of ['1h', '6h', '1d', '7d', '30d'] as const) {
        const plain = buildChartOption(buildChartModel(inputs(ready(600)), usageRange(id), NOW), palette) as unknown as typeof expanded;
        expect(plain.yAxis).toMatchObject({ min: 0, max: 100, interval: 25 });
        expect(plain.yAxis.axisLabel.formatter(100)).toBe('100%');
        expect(plain.series[0]!.markLine!.data.some((mark) => mark.yAxis !== undefined)).toBe(false);
      }
    });
  });

  it('a grade de 100% é a mesma linha suave dos outros níveis', () => {
    expect(JSON.stringify(option)).not.toContain('rgba(255, 84, 73, 0.5)');
    expect(option.yAxis.splitLine.lineStyle).toMatchObject({ color: 'rgba(18, 18, 18, 0.06)', type: 'dashed' });
  });

  it('a série real do 7d é sempre cinza: não há visualMap de faixa', () => {
    expect(option.visualMap).toBeUndefined();
    const high = buildChartOption(
      buildChartModel(inputs(ready(60)).map((input) => ({ ...input, points: input.points.map((point) => ({ ...point, utilization: 95 })) })), usageRange('1h'), NOW),
      palette,
    ) as unknown as typeof option;
    expect(high.series[1]!.lineStyle.color).toBe('#767676');
  });

  it('a faixa vale só para a projeção: tendência 7d cinza < alerta, amarela >= alerta, vermelha >= crítico', () => {
    const colorOf = (projected: number) => {
      const built = buildChartOption(buildChartModel(inputs(ready(40), ready(projected)), usageRange('1h'), NOW), palette) as unknown as typeof option;
      return built.series[3]!.lineStyle.color;
    };
    expect(colorOf(50)).toBe('#767676');
    expect(colorOf(70)).toBe('#ffc700');
    expect(colorOf(89)).toBe('#ffc700');
    expect(colorOf(90)).toBe('#ff5449');
    expect(colorOf(140)).toBe('#ff5449');
  });

  it('os limiares editados mudam a cor da tendência na hora', () => {
    const model = buildChartModel(inputs(ready(40), ready(60)), usageRange('1h'), NOW, { warning: 50, critical: 55 });
    const built = buildChartOption(model, palette) as unknown as typeof option;
    expect(built.series[3]!.lineStyle.color).toBe('#ff5449');
  });

  it('a tendência 5h é verde e só fica vermelha se estourar 100%', () => {
    const at = (projected: number) =>
      (buildChartOption(buildChartModel(inputs(ready(projected)), usageRange('1h'), NOW), palette) as unknown as typeof option).series[2]!.lineStyle.color;
    expect(at(95)).toBe('#00b131');
    expect(at(100)).toBe('#ff5449');
    expect(at(160)).toBe('#ff5449');
  });

  it('a 5h segue verde mesmo sem o 7d na tendência', () => {
    const only = buildChartOption(buildChartModel(inputs(ready(60)), usageRange('1h'), NOW), palette) as unknown as typeof option;
    expect(only.series[0]!.lineStyle.color).toBe('#00b131');
    expect(only.series[2]!.lineStyle.color).toBe('#00b131');
  });

  it('em períodos longos a linha real afina, e a tendência continua mais fina que ela', () => {
    const long = buildChartOption(buildChartModel(inputs(ready(60)), usageRange('30d'), NOW), palette) as unknown as typeof option;
    expect(long.series[0]!.lineStyle.width).toBe(1.5);
    expect(long.series[2]!.lineStyle.width).toBeLessThan(1.5);
  });

  it('tooltip na cor do card e fonte Helvetica', () => {
    expect(option.tooltip.backgroundColor).toBe('#ffffff');
    expect(option.textStyle.fontFamily).toBe('"Helvetica Neue", Helvetica, Arial, sans-serif');
  });

  it('sem previsão só desenha as duas séries reais', () => {
    const plain = buildChartOption(buildChartModel(inputs({ status: 'collecting' }), usageRange('1h'), NOW), palette) as unknown as {
      series: unknown[];
    };
    expect(plain.series).toHaveLength(2);
  });

  it('rótulos do eixo usam hora local no período curto e dia/mês no longo', () => {
    expect(option.xAxis.axisLabel.formatter(NOW)).toMatch(/^\d{2}:\d{2}$/);
    const long = buildChartOption(buildChartModel(inputs({ status: 'collecting' }), usageRange('30d'), NOW), palette) as unknown as typeof option;
    expect(long.xAxis.axisLabel.formatter(NOW)).toMatch(/^\d{2}\/\d{2}$/);
  });
});

describe('período Reset (ciclo semanal)', () => {
  it('eixo vai de (reset semanal - 7d) até o reset semanal e só traz pontos desse ciclo', () => {
    const model = buildChartModel(cycleInputs(), usageRange('cycle'), NOW);
    expect(model).toMatchObject({ cycle: true, xMin: WEEKLY_RESET - CYCLE_MS, xMax: WEEKLY_RESET, rangeMs: CYCLE_MS });
    expect(model.windows[0]!.points.map((point) => point[1])).toEqual([5, 20, 30]);
    expect(model.windows[0]!.points.some((point) => point[1] === 90)).toBe(false);
  });

  it('no Reset a projeção do 5h não aparece e a do 7d vai até o reset semanal', () => {
    const model = buildChartModel(cycleInputs(), usageRange('cycle'), NOW);
    expect(model.windows[0]!.trend).toBeNull();
    expect(model.windows[1]!.trend?.[1]?.[0]).toBe(WEEKLY_RESET);
  });

  it('no Reset o 7d usa a média diária dos últimos 14 dias', () => {
    const model = buildChartModel(cycleInputs(), usageRange('cycle'), NOW);
    const span = (NOW - HOUR_MS - (NOW - 8 * 24 * HOUR_MS)) / DAY_MS;
    const rate = (15 + 10) / span;
    const trend = model.windows[1]!.trend!;
    expect(trend[0]).toEqual([NOW, 30]);
    expect(trend[1]![1]).toBeCloseTo(30 + rate * 3, 5);
  });

  it('sem dados suficientes cai na regressão atual', () => {
    const short = cycleInputs().map((input) => ({ ...input, points: input.points.filter((point) => point.at > NOW - 2 * HOUR_MS) }));
    const model = buildChartModel(short, usageRange('cycle'), NOW);
    expect(model.windows[1]!.trend![1]![1]).toBeCloseTo(75, 5);
  });

  it('períodos comuns mantêm a regressão e a projeção do 5h', () => {
    const model = buildChartModel(cycleInputs(), usageRange('7d'), NOW);
    expect(model.windows[0]!.trend).not.toBeNull();
    expect(model.windows[1]!.days).toEqual([]);
  });

  describe('pontos por dia', () => {
    const model = buildChartModel(cycleInputs(), usageRange('cycle'), NOW);
    const days = model.windows[1]!.days;

    it('um ponto em cada 00:00 local entre agora e o reset, mais o ponto no reset', () => {
      const expected: number[] = [];
      const cursor = new Date(NOW);
      cursor.setHours(24, 0, 0, 0);
      while (cursor.getTime() < WEEKLY_RESET) {
        expected.push(cursor.getTime());
        cursor.setDate(cursor.getDate() + 1);
        cursor.setHours(0, 0, 0, 0);
      }
      expect(days.map((day) => day.at)).toEqual([...expected, WEEKLY_RESET]);
      days.slice(0, -1).forEach((day) => expect(new Date(day.at).getHours()).toBe(0));
    });

    it('cada valor está sobre a reta da projeção', () => {
      const trend = model.windows[1]!.trend!;
      for (const day of days) {
        const expected = trend[0]![1] + ((trend[1]![1] - trend[0]![1]) * (day.at - NOW)) / (WEEKLY_RESET - NOW);
        expect(day.value).toBeCloseTo(expected, 5);
      }
    });

    it('a cor segue as faixas dos limiares: cinza, amarelo e vermelho', () => {
      const withRate = (perDay: number) => {
        const history: UsagePoint[] = [
          { at: NOW - 3 * DAY_MS, utilization: 0, resetsAt: null },
          { at: NOW, utilization: 3 * perDay, resetsAt: null },
        ];
        const input = [
          { kind: 'fiveHour' as const, label: '5h', points: [], forecast: { status: 'collecting' } as Forecast, resetsAt: null },
          { kind: 'sevenDay' as const, label: '7d', points: history, forecast: { status: 'collecting' } as Forecast, resetsAt: NOW + 3 * DAY_MS },
        ];
        return buildChartModel(input, usageRange('cycle'), NOW).windows[1]!.days;
      };
      expect(withRate(10).at(-1)!.tone).toBe('base');
      expect(withRate(12).at(-1)!.tone).toBe('attention');
      expect(withRate(15).at(-1)!.tone).toBe('danger');
      expect(withRate(40).at(-1)!.tone).toBe('danger');
      expect(withRate(12).map((day) => day.tone)).toContain('base');
    });

    it('o rótulo some quando dois pontos ficam apertados, mas o ponto continua', () => {
      const reset = new Date(NOW);
      reset.setHours(24 * 2, 30, 0, 0);
      const close = buildChartModel(
        cycleInputs().map((input) => ({ ...input, resetsAt: input.kind === 'sevenDay' ? reset.getTime() : input.resetsAt })),
        usageRange('cycle'),
        NOW,
      ).windows[1]!.days;
      expect(close.at(-1)!.labeled).toBe(true);
      expect(close.at(-2)!.labeled).toBe(false);
      expect(close.length).toBeGreaterThanOrEqual(3);
    });

    it('o eixo expande para a projeção do Reset e a série de pontos leva rótulo, cor e tooltip', () => {
      const steep = steepCycle(4);
      const built = buildChartModel(steep, usageRange('cycle'), NOW);
      expect(built.yMax).toBeGreaterThan(100);
      const out = buildChartOption(built, palette, PT) as unknown as {
        series: {
          type: string;
          data: { value: number[]; itemStyle: { color: string }; label: { show: boolean; formatter: string } }[];
          tooltip?: { formatter: (params: { value: number[] }) => string };
        }[];
      };
      const scatter = out.series.find((series) => series.type === 'scatter')!;
      expect(scatter.data).toHaveLength(built.windows[1]!.days.length);
      const last = scatter.data.at(-1)!;
      expect(last.itemStyle.color).toBe('#ff5449');
      expect(last.label.formatter).toBe(`${Math.round(built.windows[1]!.days.at(-1)!.value)}%`);
      expect(scatter.tooltip!.formatter({ value: last.value })).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}<br\/>Projetado \d+%$/);
    });

    it('fora do Reset não há série de pontos', () => {
      const other = buildChartOption(buildChartModel(cycleInputs(), usageRange('7d'), NOW), palette) as unknown as { series: { type: string }[] };
      expect(other.series.some((series) => series.type === 'scatter')).toBe(false);
    });
  });

  it('marcadores: agora e os resets do 5h que caem no intervalo (passados e o próximo)', () => {
    const model = buildChartModel(cycleInputs(), usageRange('cycle'), NOW);
    expect(model.fiveHourResets).toEqual([
      NOW - 3 * 24 * HOUR_MS + 5 * HOUR_MS,
      NOW - 2 * 24 * HOUR_MS + 5 * HOUR_MS,
      NOW + 4 * HOUR_MS,
    ]);
    const option = buildChartOption(model, palette) as unknown as {
      series: { markLine?: { data: { xAxis: number }[] } }[];
    };
    const marks = option.series[0]!.markLine!.data.map((mark) => mark.xAxis);
    expect(marks).toEqual([NOW, ...model.fiveHourResets]);
  });

  it('sem reset semanal conhecido cai no período padrão, sem ciclo', () => {
    const noReset = cycleInputs().map((input) => (input.kind === 'sevenDay' ? { ...input, resetsAt: null } : input));
    const model = buildChartModel(noReset, usageRange('cycle'), NOW);
    expect(model.cycle).toBe(false);
    expect(model.xMin).toBe(NOW - 6 * HOUR_MS);
    expect(model.fiveHourResets).toEqual([]);
  });

  it('períodos comuns não ligam o modo ciclo', () => {
    expect(buildChartModel(cycleInputs(), usageRange('7d'), NOW)).toMatchObject({ cycle: false, fiveHourResets: [] });
  });
});
