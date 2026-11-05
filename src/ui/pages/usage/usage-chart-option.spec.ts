import { describe, expect, it } from 'vitest';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../../../domain/time';
import { forecastWindow, usageRange, type Forecast, type ProjectionMethod, type UsagePoint } from '../../../domain/usage';
import { chartPalette } from '../../theme/chart-palette';
import { Localizer } from '../../i18n';
import { axisMaxFor, buildChartModel as buildModel, CYCLE_MS, CHART_BUCKETS, curveValueAt, downsample, FUTURE_SHARE, type WindowInput } from './usage-chart-model';
import { buildChartOption as buildOption, tooltipFormatter } from './usage-chart-option';

const PT = new Localizer('pt-BR');
const buildChartModel = buildModel;
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
  ratePerDay: 0,
  valueAtReset: toValue,
  trend: { fromAt: NOW, fromValue: 29, toAt: NOW + 4 * HOUR_MS, toValue },
  exhaustsAt,
  exhaustsLeadMs: exhaustsAt === null ? null : NOW + 4 * HOUR_MS - exhaustsAt,
});

const WEEKLY_RESET = NOW + 3 * 24 * HOUR_MS;
const withWeekly = (list: WindowInput[], method: ProjectionMethod = '14d'): WindowInput[] =>
  list.map((input) => {
    if (input.kind !== 'sevenDay') return input;
    const last = input.points[input.points.length - 1]!;
    return { ...input, forecast: forecastWindow('sevenDay', method, input.points, NOW, last.utilization, input.resetsAt) };
  });
const cycleInputs = (method: ProjectionMethod = '14d'): WindowInput[] => {
  const history: UsagePoint[] = [
    { at: NOW - 8 * 24 * HOUR_MS, utilization: 90, resetsAt: NOW - 8 * 24 * HOUR_MS + 5 * HOUR_MS },
    { at: NOW - 3 * 24 * HOUR_MS, utilization: 5, resetsAt: NOW - 3 * 24 * HOUR_MS + 5 * HOUR_MS },
    { at: NOW - 2 * 24 * HOUR_MS, utilization: 20, resetsAt: NOW - 2 * 24 * HOUR_MS + 5 * HOUR_MS },
    { at: NOW - HOUR_MS, utilization: 30, resetsAt: NOW + 4 * HOUR_MS },
  ];
  return withWeekly(
    [
      { kind: 'fiveHour', label: '5h', points: history, forecast: ready(60), resetsAt: NOW + 4 * HOUR_MS },
      { kind: 'sevenDay', label: '7d', points: history, forecast: ready(75), resetsAt: WEEKLY_RESET },
    ],
    method,
  );
};
const steepCycle = (factor: number): WindowInput[] =>
  withWeekly(
    cycleInputs().map((input) =>
      input.kind === 'sevenDay'
        ? { ...input, points: input.points.map((point) => ({ ...point, utilization: point.at < NOW - 4 * DAY_MS ? 0 : point.utilization * factor })) }
        : input,
    ),
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
      const model = buildChartModel(inputs(ready(5000), ready(5000)), usageRange(id), NOW);
      const end = model.windows[id === '7d' || id === '30d' ? 1 : 0]!.trend![1]!;
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
    expect(buildChartModel(inputs(near), usageRange('1d'), NOW).windows[0]!.trend?.[1]).toEqual([NOW + 5 * MINUTE_MS, 31]);
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
      smooth?: boolean | number;
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
    expect(option.series[0]!.smooth).toBe(0.5);
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

  it('cores escolhidas valem na linha real, na área, na tendência tracejada e no tooltip', () => {
    const custom = chartPalette('#00b131', null, 'dark', { fiveHour: '#0063f7', sevenDay: '#ef6800' });
    const out = buildChartOption(model, custom) as unknown as typeof option;
    expect(out.series[0]!.lineStyle.color).toBe('#0063f7');
    expect(out.series[1]!.lineStyle.color).toBe('#ef6800');
    expect(out.series[2]!.lineStyle.color).toBe('#0063f7');
    expect(out.series[3]!.lineStyle.color).toBe('#ef6800');
    expect(out.series[0]!.areaStyle?.color.colorStops[0]).toEqual({ offset: 0, color: 'rgba(0, 99, 247, 0.1)' });
    const at = model.windows[0]!.points[0]![0];
    const text = tooltipFormatter(model, custom, PT)([{ axisValue: at }]);
    expect(text).toContain('background-color:#0063f7');
    expect(text).toContain('background-color:#ef6800');
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

  it('a tendência tem sempre a cor da série, qualquer que seja o valor projetado', () => {
    const colors = (five: number, seven: number) => {
      const built = buildChartOption(buildChartModel(inputs(ready(five), ready(seven)), usageRange('1h'), NOW), palette) as unknown as typeof option;
      return [built.series[2]!.lineStyle.color, built.series[3]!.lineStyle.color];
    };
    for (const value of [50, 75, 95, 100, 160]) expect(colors(value, value)).toEqual(['#00b131', '#767676']);
  });

  it('a 5h segue verde mesmo sem o 7d na tendência', () => {
    const only = buildChartOption(buildChartModel(inputs(ready(60)), usageRange('1h'), NOW), palette) as unknown as typeof option;
    expect(only.series[0]!.lineStyle.color).toBe('#00b131');
    expect(only.series[2]!.lineStyle.color).toBe('#00b131');
  });

  it('em períodos longos a linha real afina, e a tendência continua mais fina que ela', () => {
    const long = buildChartOption(buildChartModel(inputs(ready(60), ready(60)), usageRange('30d'), NOW), palette) as unknown as typeof option;
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
    const window = model.windows[0]!;
    const values = window.points.map((point) => point[1]);
    expect(window.points.every((point) => point[0] >= model.xMin && point[0] <= NOW)).toBe(true);
    expect(Math.max(...values)).toBe(30);
    expect(values.includes(90)).toBe(false);
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

  it('sem dados suficientes cai no consumo desde o reset', () => {
    const short = withWeekly(cycleInputs().map((input) => ({ ...input, points: input.points.filter((point) => point.at > NOW - 2 * HOUR_MS) })));
    const model = buildChartModel(short, usageRange('cycle'), NOW);
    expect(model.windows[1]!.trend![1]![1]).toBeCloseTo(30 + (30 / 4) * 3, 5);
  });

  it('períodos comuns mantêm a regressão e a projeção do 5h', () => {
    const model1d = buildChartModel(cycleInputs(), usageRange('1d'), NOW);
    expect(model1d.windows[0]!.trend).not.toBeNull();
    expect(model1d.windows[1]!.trend).not.toBeNull();
  });

  it('7d e 30d só projetam o 7d; o 5h fica sem tendência', () => {
    for (const id of ['7d', '30d']) {
      const model = buildChartModel(cycleInputs(), usageRange(id), NOW);
      expect(model.windows[0]!.trend).toBeNull();
      expect(model.windows[1]!.trend).not.toBeNull();
    }
    for (const id of ['1h', '6h', '1d']) {
      expect(buildChartModel(cycleInputs(), usageRange(id), NOW).windows[0]!.trend).not.toBeNull();
    }
  });

  describe('projeção no Reset', () => {
    it('não há bolinhas diárias, só a linha tracejada e a sonda do tooltip', () => {
      const built = buildChartModel(steepCycle(4), usageRange('cycle'), NOW);
      expect(built.yMax).toBeGreaterThan(100);
      const out = buildChartOption(built, palette, PT) as unknown as { series: { type: string }[] };
      expect(out.series.some((series) => series.type === 'scatter')).toBe(false);
    });

    it('tooltip live: no futuro mostra só a projeção calculada no instante; no passado, os valores reais', () => {
      const built = buildChartModel(steepCycle(4), usageRange('cycle'), NOW);
      const format = tooltipFormatter(built, palette, PT);
      const project = built.windows[1]!.projectAt!;
      const mid = NOW + 30 * HOUR_MS + 17 * MINUTE_MS;
      const future = format([{ axisValue: mid, seriesIndex: 0, marker: '', seriesName: '5h', value: [NOW, 5] }]);
      expect(future).toBe(`${PT.weekday(mid)} ${PT.axisTick(mid, CYCLE_MS)} ${PT.clock(mid)}<br/><span style="display:inline-block;margin-right:4px;border-radius:50%;width:10px;height:10px;background-color:${palette.series.sevenDay.line}"></span>Projetado ${Math.round(project(mid))}%`);
      expect(future).not.toContain('5h');
      expect(project(mid)).toBeGreaterThan(project(NOW + HOUR_MS));
      const past = NOW - HOUR_MS;
      const curve = curveValueAt(built.windows[1]!.points, past)!;
      const text = format([{ axisValue: past }]);
      expect(text).toContain(`7d ${Math.round(curve)}%`);
      expect(text).not.toContain('Projetado');
    });
  });

  describe('histórico e curva suave em baldes', () => {
    const mixed = (): UsagePoint[] => [
      { at: NOW - 20 * DAY_MS, utilization: 10, resetsAt: null, imported: true },
      { at: NOW - 6 * DAY_MS - 30 * MINUTE_MS, utilization: 12, resetsAt: null },
      { at: NOW - 6 * DAY_MS, utilization: 15, resetsAt: null, imported: true },
      { at: NOW - 5 * DAY_MS, utilization: 16, resetsAt: null },
      { at: NOW - 5 * DAY_MS + 10 * MINUTE_MS, utilization: 17, resetsAt: null },
      { at: NOW - HOUR_MS, utilization: 30, resetsAt: null },
      { at: NOW - 50 * MINUTE_MS, utilization: 31, resetsAt: null },
    ];
    const weekly = (id: string) =>
      buildChartModel([{ kind: 'sevenDay', label: '7d', points: mixed(), forecast: { status: 'collecting' }, resetsAt: null }], usageRange(id), NOW);

    it('cada balde vira um ponto com a média do valor e do instante; baldes vazios somem', () => {
      const bucket = (7 * DAY_MS) / CHART_BUCKETS;
      expect(weekly('7d').windows[0]!.points).toEqual([
        [NOW - 6 * DAY_MS - 30 * MINUTE_MS, 12],
        [NOW - 6 * DAY_MS, 15],
        [NOW - 5 * DAY_MS + 5 * MINUTE_MS, 16.5],
        [NOW - 55 * MINUTE_MS, 30.5],
      ]);
      expect(bucket).toBeGreaterThan(80 * MINUTE_MS);
    });

    it('30d inclui também o trecho antigo, ainda em no máximo 120 pontos', () => {
      expect(weekly('30d').windows[0]!.points[0]).toEqual([NOW - 20 * DAY_MS, 10]);
      const dense: UsagePoint[] = Array.from({ length: 5000 }, (_, index) => ({ at: NOW - index * 5 * MINUTE_MS, utilization: index % 100, resetsAt: null }));
      expect(downsample(dense, NOW - 30 * DAY_MS, NOW).length).toBeLessThanOrEqual(CHART_BUCKETS);
    });

    it('lacunas e resets não ganham tratamento especial: só os pontos médios', () => {
      const points = downsample(
        [
          { at: 0, utilization: 80, resetsAt: 10 },
          { at: 1000, utilization: 5, resetsAt: 2000 },
        ],
        0,
        1200,
      );
      expect(points).toEqual([
        [0, 80],
        [1000, 5],
      ]);
    });

    it('a série é suave (0.5), sem série auxiliar de lacuna e sem connectNulls', () => {
      const out = buildChartOption(weekly('7d'), palette) as unknown as { series: { smooth: number; connectNulls?: boolean; silent?: boolean; areaStyle?: unknown }[] };
      expect(out.series[0]).toMatchObject({ smooth: 0.5 });
      expect(out.series[0]).not.toHaveProperty('connectNulls');
      expect(out.series).toHaveLength(1);
    });

    it('tooltip interpola na curva (Catmull-Rom) e não fala em estimado', () => {
      const model = weekly('7d');
      const format = tooltipFormatter(model, palette, PT);
      const points = model.windows[0]!.points;
      const mid = (points[2]![0] + points[3]![0]) / 2;
      const value = curveValueAt(points, mid)!;
      expect(value).toBeGreaterThan(16.5);
      expect(value).toBeLessThan(30.5);
      const text = format([{ axisValue: mid }]);
      expect(text).toContain(`7d ${Math.round(value)}%`);
      expect(text).not.toMatch(/estimado|sem leitura/);
    });

    it('curva passa pelos pontos, fica no último depois dele e some antes do primeiro', () => {
      const points: [number, number][] = [
        [0, 10],
        [10, 20],
        [20, 40],
        [30, 30],
      ];
      expect(curveValueAt(points, 10)).toBe(20);
      expect(curveValueAt(points, 20)).toBe(40);
      expect(curveValueAt(points, 15)).toBeCloseTo(0.5 * (40 + (40 - 10) * 0.5 + (20 - 100 + 160 - 30) * 0.25 + (60 - 10 - 120 + 30) * 0.125), 9);
      expect(curveValueAt(points, 35)).toBe(30);
      expect(curveValueAt(points, -1)).toBeNull();
      expect(curveValueAt([], 5)).toBeNull();
    });

    it('vale também para o 5h', () => {
      const model = buildChartModel(
        [{ kind: 'fiveHour', label: '5h', points: [{ at: NOW - 40 * MINUTE_MS, utilization: 90, resetsAt: null }, { at: NOW - 10 * MINUTE_MS, utilization: 4, resetsAt: null }], forecast: { status: 'collecting' }, resetsAt: null }],
        usageRange('1h'),
        NOW,
      );
      expect(model.windows[0]!.points).toEqual([
        [NOW - 40 * MINUTE_MS, 90],
        [NOW - 10 * MINUTE_MS, 4],
      ]);
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
