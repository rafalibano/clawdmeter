import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionProblemError } from '../../domain/connections';
import { createDefaultSettings, type AppSettings } from '../../domain/settings';
import { PageRegistry } from '../pages/page-registry';
import { FakeClock, flushPromises } from '../testing/fake-clock';
import { fakePage } from '../testing/fake-page';
import { PollingScheduler, type PageUpdate } from './polling-scheduler';

function settingsWith(enabledPages: Record<string, boolean>): AppSettings {
  return { ...createDefaultSettings(), enabledPages };
}

describe('PollingScheduler', () => {
  let clock: FakeClock;
  let updates: PageUpdate[];
  const fast = vi.fn(async () => 'fast');
  const slow = vi.fn(async () => 'slow');
  const once = vi.fn(async () => 'once');

  function build(): PollingScheduler {
    const registry = new PageRegistry([
      fakePage({ id: 'fast', pollIntervalMs: 1_000, load: fast }),
      fakePage({ id: 'slow', pollIntervalMs: 5_000, load: slow }),
      fakePage({ id: 'once', pollIntervalMs: null, load: once }),
    ]);
    const scheduler = new PollingScheduler(registry, clock);
    scheduler.subscribe((update) => updates.push(update));
    return scheduler;
  }

  beforeEach(() => {
    clock = new FakeClock();
    updates = [];
    fast.mockClear();
    slow.mockClear();
    once.mockClear();
  });

  it('só agenda páginas ligadas', async () => {
    const scheduler = build();
    scheduler.sync(settingsWith({ fast: true, slow: false, once: false }));
    await clock.advance(10_000);
    expect(fast).toHaveBeenCalledTimes(11);
    expect(slow).not.toHaveBeenCalled();
    expect(once).not.toHaveBeenCalled();
    expect(clock.activeTimers()).toBe(1);
  });

  it('carrega na hora ao ligar e respeita o intervalo de cada página', async () => {
    const scheduler = build();
    scheduler.sync(settingsWith({ once: false }));
    await flushPromises();
    expect(fast).toHaveBeenCalledTimes(1);
    expect(slow).toHaveBeenCalledTimes(1);
    await clock.advance(5_000);
    expect(fast).toHaveBeenCalledTimes(6);
    expect(slow).toHaveBeenCalledTimes(2);
  });

  it('página sem intervalo carrega uma vez e não agenda timer', async () => {
    const scheduler = build();
    scheduler.sync(settingsWith({ fast: false, slow: false }));
    await clock.advance(60_000);
    expect(once).toHaveBeenCalledTimes(1);
    expect(clock.activeTimers()).toBe(0);
  });

  it('para de agendar ao desligar a página', async () => {
    const scheduler = build();
    scheduler.sync(settingsWith({ slow: false, once: false }));
    await clock.advance(2_000);
    expect(fast).toHaveBeenCalledTimes(3);
    scheduler.sync(settingsWith({ fast: false, slow: false, once: false }));
    await clock.advance(10_000);
    expect(fast).toHaveBeenCalledTimes(3);
    expect(clock.activeTimers()).toBe(0);
  });

  it('recomeça ao ligar de novo, com carga imediata', async () => {
    const scheduler = build();
    scheduler.sync(settingsWith({ slow: false, once: false }));
    await clock.advance(1_000);
    scheduler.sync(settingsWith({ fast: false, slow: false, once: false }));
    await clock.advance(5_000);
    expect(fast).toHaveBeenCalledTimes(2);
    scheduler.sync(settingsWith({ slow: false, once: false }));
    await flushPromises();
    expect(fast).toHaveBeenCalledTimes(3);
    await clock.advance(2_000);
    expect(fast).toHaveBeenCalledTimes(5);
  });

  it('sync repetido com as mesmas configurações não duplica timers nem cargas', async () => {
    const scheduler = build();
    const settings = settingsWith({ slow: false, once: false });
    scheduler.sync(settings);
    scheduler.sync(settings);
    await flushPromises();
    expect(fast).toHaveBeenCalledTimes(1);
    expect(clock.activeTimers()).toBe(1);
  });

  it('publica o resultado com o horário do relógio injetado', async () => {
    const scheduler = build();
    scheduler.sync(settingsWith({ slow: false, once: false }));
    await clock.advance(1_000);
    expect(updates).toEqual([
      { pageId: 'fast', status: 'ok', data: 'fast', at: 0 },
      { pageId: 'fast', status: 'ok', data: 'fast', at: 1_000 },
    ]);
  });

  it('publica erro de load sem derrubar o agendamento', async () => {
    const failing = vi.fn().mockRejectedValueOnce(new Error('falhou')).mockResolvedValue('ok');
    const registry = new PageRegistry([fakePage({ id: 'flaky', pollIntervalMs: 1_000, load: failing })]);
    const scheduler = new PollingScheduler(registry, clock);
    scheduler.subscribe((update) => updates.push(update));
    scheduler.sync(createDefaultSettings());
    await clock.advance(1_000);
    expect(updates.map((update) => update.status)).toEqual(['error', 'ok']);
    expect(updates[0]).toMatchObject({ error: 'falhou' });
  });

  it('não sobrepõe cargas enquanto a anterior não terminou', async () => {
    let release: (value: string) => void = () => undefined;
    const hanging = vi.fn(() => new Promise<string>((resolve) => (release = resolve)));
    const registry = new PageRegistry([fakePage({ id: 'hang', pollIntervalMs: 1_000, load: hanging })]);
    const scheduler = new PollingScheduler(registry, clock);
    scheduler.sync(createDefaultSettings());
    await clock.advance(5_000);
    expect(hanging).toHaveBeenCalledTimes(1);
    release('fim');
    await flushPromises();
    await clock.advance(1_000);
    expect(hanging).toHaveBeenCalledTimes(2);
  });

  it('refresh durante uma carga em andamento roda de novo ao terminar', async () => {
    const releases: Array<(value: string) => void> = [];
    const hanging = vi.fn(() => new Promise<string>((resolve) => releases.push(resolve)));
    const registry = new PageRegistry([fakePage({ id: 'hang', pollIntervalMs: null, load: hanging })]);
    const scheduler = new PollingScheduler(registry, clock);
    scheduler.subscribe((update) => updates.push(update));
    scheduler.sync(createDefaultSettings());
    const refreshed = scheduler.refresh('hang');
    await flushPromises();
    expect(hanging).toHaveBeenCalledTimes(1);
    releases[0]?.('antiga');
    await flushPromises();
    expect(hanging).toHaveBeenCalledTimes(2);
    releases[1]?.('nova');
    await refreshed;
    expect(updates.map((update) => (update.status === 'ok' ? update.data : update.error))).toEqual(['antiga', 'nova']);
  });

  it('nenhum refresh se perde entre o fim do drain e a liberação do inflight', async () => {
    for (let offset = 0; offset <= 16; offset += 1) {
      const started: number[] = [];
      let calls = 0;
      const load = vi.fn(async () => {
        started.push(calls);
        return 'ok';
      });
      const scheduler = new PollingScheduler(new PageRegistry([fakePage({ id: 'gap', pollIntervalMs: null, load })]), clock);
      scheduler.sync(createDefaultSettings());
      for (let tick = 0; tick < offset; tick += 1) await Promise.resolve();
      calls += 1;
      void scheduler.refresh('gap');
      await flushPromises();
      expect(started.at(-1), `refresh após ${offset} ticks`).toBe(1);
      scheduler.stopAll();
    }
  });

  it('vários refreshes durante a carga viram uma única recarga', async () => {
    const releases: Array<(value: string) => void> = [];
    const hanging = vi.fn(() => new Promise<string>((resolve) => releases.push(resolve)));
    const registry = new PageRegistry([fakePage({ id: 'hang', pollIntervalMs: null, load: hanging })]);
    const scheduler = new PollingScheduler(registry, clock);
    scheduler.sync(createDefaultSettings());
    void scheduler.refresh('hang');
    void scheduler.refresh('hang');
    releases[0]?.('a');
    await flushPromises();
    releases[1]?.('b');
    await flushPromises();
    expect(hanging).toHaveBeenCalledTimes(2);
  });

  it('problema de conexão vira mensagem legível e carrega o problema', async () => {
    const failing = vi.fn().mockRejectedValue(new ConnectionProblemError('microsoft-expired'));
    const registry = new PageRegistry([fakePage({ id: 'agenda', pollIntervalMs: null, load: failing })]);
    const scheduler = new PollingScheduler(registry, clock);
    scheduler.subscribe((update) => updates.push(update));
    scheduler.sync(createDefaultSettings());
    await flushPromises();
    expect(updates[0]).toMatchObject({ status: 'error', error: 'O login da Microsoft expirou.', problem: 'microsoft-expired' });
  });

  it('problema com mensagem específica mantém a mensagem', async () => {
    const failing = vi.fn().mockRejectedValue(new ConnectionProblemError('microsoft-expired', 'Sem permissão'));
    const registry = new PageRegistry([fakePage({ id: 'agenda', pollIntervalMs: null, load: failing })]);
    const scheduler = new PollingScheduler(registry, clock);
    scheduler.subscribe((update) => updates.push(update));
    scheduler.sync(createDefaultSettings());
    await flushPromises();
    expect(updates[0]).toMatchObject({ error: 'Sem permissão', problem: 'microsoft-expired' });
  });

  it('descarta o resultado de uma carga que terminou depois de a página ser desligada', async () => {
    let release: (value: string) => void = () => undefined;
    const registry = new PageRegistry([
      fakePage({ id: 'late', pollIntervalMs: null, load: () => new Promise<string>((resolve) => (release = resolve)) }),
    ]);
    const scheduler = new PollingScheduler(registry, clock);
    scheduler.subscribe((update) => updates.push(update));
    scheduler.sync(createDefaultSettings());
    scheduler.sync(settingsWith({ late: false }));
    release('tarde');
    await flushPromises();
    expect(updates).toEqual([]);
  });

  it('stopAll cancela tudo', async () => {
    const scheduler = build();
    scheduler.sync(createDefaultSettings());
    scheduler.stopAll();
    expect(clock.activeTimers()).toBe(0);
  });

  it('reemite o último resultado para quem assina depois, mesmo sem polling', async () => {
    const registry = new PageRegistry([fakePage({ id: 'once', pollIntervalMs: null, load: async () => 'dado' })]);
    const scheduler = new PollingScheduler(registry, clock);
    scheduler.sync(createDefaultSettings());
    await flushPromises();
    const late = vi.fn();
    scheduler.subscribe(late);
    expect(late).toHaveBeenCalledTimes(1);
    expect(late).toHaveBeenCalledWith({ pageId: 'once', status: 'ok', data: 'dado', at: 0 });
  });

  it('reemite só o resultado mais recente de cada página', async () => {
    const scheduler = build();
    scheduler.sync(settingsWith({ slow: false, once: false }));
    await clock.advance(2_000);
    const late = vi.fn();
    scheduler.subscribe(late);
    expect(late).toHaveBeenCalledTimes(1);
    expect(late.mock.calls[0]?.[0]).toMatchObject({ pageId: 'fast', at: 2_000 });
  });

  it('não reemite resultado de página desligada', async () => {
    const scheduler = build();
    scheduler.sync(settingsWith({ slow: false, once: false }));
    await flushPromises();
    scheduler.sync(settingsWith({ fast: false, slow: false, once: false }));
    const late = vi.fn();
    scheduler.subscribe(late);
    expect(late).not.toHaveBeenCalled();
  });

  it('permite cancelar a assinatura', async () => {
    const registry = new PageRegistry([fakePage({ id: 'p', pollIntervalMs: null })]);
    const scheduler = new PollingScheduler(registry, clock);
    const listener = vi.fn();
    scheduler.subscribe(listener)();
    scheduler.sync(createDefaultSettings());
    await flushPromises();
    expect(listener).not.toHaveBeenCalled();
  });

  it('refresh recarrega uma página ligada na hora e ignora página desligada', async () => {
    const scheduler = build();
    scheduler.sync(settingsWith({ fast: false, slow: false }));
    await flushPromises();
    await scheduler.refresh('once');
    expect(once).toHaveBeenCalledTimes(2);
    await scheduler.refresh('fast');
    await scheduler.refresh('inexistente');
    expect(fast).not.toHaveBeenCalled();
  });
});

describe('PollingScheduler: problemas de conexão e refresh', () => {
  it('preserva o problema quando o load lança ConnectionProblemError', async () => {
    const clock = new FakeClock();
    const registry = new PageRegistry([
      fakePage({
        id: 'prs',
        load: async () => {
          throw new ConnectionProblemError('github-org-access', 'SSO pendente');
        },
      }),
      fakePage({
        id: 'net',
        load: async () => {
          throw new Error('sem rede');
        },
      }),
    ]);
    const scheduler = new PollingScheduler(registry, clock);
    const updates: PageUpdate[] = [];
    scheduler.subscribe((update) => updates.push(update));
    scheduler.sync(createDefaultSettings());
    await flushPromises();
    expect(updates.find((update) => update.pageId === 'prs')).toMatchObject({
      status: 'error',
      error: 'SSO pendente',
      problem: 'github-org-access',
    });
    expect(updates.find((update) => update.pageId === 'net')).not.toHaveProperty('problem');
  });

  it('refresh recarrega uma página ligada na hora e ignora páginas desligadas', async () => {
    const clock = new FakeClock();
    const load = vi.fn(async () => 'ok');
    const scheduler = new PollingScheduler(new PageRegistry([fakePage({ id: 'prs', load })]), clock);
    scheduler.sync(createDefaultSettings());
    await flushPromises();
    await scheduler.refresh('prs');
    expect(load).toHaveBeenCalledTimes(2);
    await scheduler.refresh('inexistente');
    scheduler.sync({ ...createDefaultSettings(), enabledPages: { prs: false } });
    await scheduler.refresh('prs');
    expect(load).toHaveBeenCalledTimes(2);
  });
});
