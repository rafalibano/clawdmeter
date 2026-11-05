import { describe, expect, it } from 'vitest';
import { createEmptyHistory } from '../../domain/usage';
import type { AtomicJsonFile } from './json-file';
import { JsonUsageHistoryStore } from './json-usage-history-store';

class MemoryFile implements AtomicJsonFile {
  corrupt: string | null = null;
  reads = 0;
  atomicWrites = 0;

  constructor(public text: string | null = null) {}

  async read(): Promise<string | null> {
    this.reads += 1;
    return this.text;
  }

  async write(text: string): Promise<void> {
    this.text = text;
  }

  async writeAtomic(text: string): Promise<void> {
    this.atomicWrites += 1;
    this.text = text;
  }

  async quarantine(): Promise<void> {
    this.corrupt = this.text;
    this.text = null;
  }

  async watch(): Promise<() => void> {
    return () => undefined;
  }
}

describe('JsonUsageHistoryStore', () => {
  it('leitura que falha não trava o próximo load', async () => {
    const file = new MemoryFile();
    let fail = true;
    file.read = async () => {
      if (fail) throw new Error('disco');
      return null;
    };
    const store = new JsonUsageHistoryStore(file);
    await expect(store.load()).rejects.toThrow('disco');
    fail = false;
    expect(await store.load()).toEqual(createEmptyHistory());
  });

  it('arquivo ausente: histórico vazio', async () => {
    expect(await new JsonUsageHistoryStore(new MemoryFile()).load()).toEqual(createEmptyHistory());
  });

  it('grava e relê o histórico (sobrevive a reiniciar)', async () => {
    const file = new MemoryFile();
    const history = {
      fiveHour: [{ at: 1_000, utilization: 12.5, resetsAt: 9_000 }],
      sevenDay: [{ at: 1_000, utilization: 3, resetsAt: null }],
    };
    await new JsonUsageHistoryStore(file).save(history);
    expect(JSON.parse(file.text ?? '')).toMatchObject({ schemaVersion: 1, fiveHour: [[1_000, 12.5, 9_000]] });
    expect(await new JsonUsageHistoryStore(file).load()).toEqual(history);
  });

  it('JSON inválido: guarda o arquivo como .corrupt e começa vazio, sem sobrescrever', async () => {
    const file = new MemoryFile('{ quebrado');
    const store = new JsonUsageHistoryStore(file);
    expect(await store.load()).toEqual(createEmptyHistory());
    expect(file.corrupt).toBe('{ quebrado');
    expect(file.text).toBeNull();
    await store.save(createEmptyHistory());
    expect(file.corrupt).toBe('{ quebrado');
  });

  it('JSON válido mas que não é um objeto também vai para .corrupt', async () => {
    const file = new MemoryFile('[1,2]');
    expect(await new JsonUsageHistoryStore(file).load()).toEqual(createEmptyHistory());
    expect(file.corrupt).toBe('[1,2]');
  });

  it('lê o disco uma vez e mantém o histórico em memória depois', async () => {
    const file = new MemoryFile();
    const store = new JsonUsageHistoryStore(file);
    await Promise.all([store.load(), store.load()]);
    const history = { fiveHour: [{ at: 1, utilization: 2, resetsAt: null }], sevenDay: [] };
    await store.save(history);
    expect(await store.load()).toBe(history);
    expect(file.reads).toBe(1);
  });

  it('grava de forma atômica e em série, na ordem das chamadas', async () => {
    const order: number[] = [];
    let active = 0;
    let overlapped = false;
    const file = new (class extends MemoryFile {
      override async writeAtomic(text: string): Promise<void> {
        active += 1;
        overlapped ||= active > 1;
        const at = (JSON.parse(text) as { fiveHour: number[][] }).fiveHour[0]?.[0] ?? 0;
        await new Promise((resolve) => setTimeout(resolve, at === 1 ? 20 : 1));
        order.push(at);
        active -= 1;
      }
    })();
    const store = new JsonUsageHistoryStore(file);
    const history = (at: number) => ({ fiveHour: [{ at, utilization: 1, resetsAt: null }], sevenDay: [] });
    await Promise.all([store.save(history(1)), store.save(history(2)), store.save(history(3))]);
    expect(order).toEqual([1, 2, 3]);
    expect(overlapped).toBe(false);
  });

  it('uma gravação que falha não trava as seguintes e o histórico em memória continua válido', async () => {
    let calls = 0;
    const file = new (class extends MemoryFile {
      override async writeAtomic(text: string): Promise<void> {
        calls += 1;
        if (calls === 1) throw new Error('disco cheio');
        this.text = text;
      }
    })();
    const store = new JsonUsageHistoryStore(file);
    const history = { fiveHour: [{ at: 5, utilization: 1, resetsAt: null }], sevenDay: [] };
    await expect(store.save(history)).rejects.toThrow('disco cheio');
    expect(await store.load()).toBe(history);
    await store.save(history);
    expect(file.text).not.toBeNull();
  });

  it('o marcador da migração do ClaudeUsageBar sobrevive a salvar e reiniciar', async () => {
    const file = new MemoryFile();
    const store = new JsonUsageHistoryStore(file);
    expect(await store.importedAt()).toBeNull();
    await store.save({ fiveHour: [{ at: 1, utilization: 1, resetsAt: null }], sevenDay: [] });
    await store.markImported(5_000);
    await store.save({ fiveHour: [{ at: 2, utilization: 2, resetsAt: null }], sevenDay: [] });
    const reopened = new JsonUsageHistoryStore(file);
    expect(await reopened.importedAt()).toBe(5_000);
    expect((await reopened.load()).fiveHour).toHaveLength(1);
  });

  it('arquivo antigo sem marcador volta null', async () => {
    const file = new MemoryFile(JSON.stringify({ schemaVersion: 1, fiveHour: [], sevenDay: [] }));
    expect(await new JsonUsageHistoryStore(file).importedAt()).toBeNull();
  });
});
