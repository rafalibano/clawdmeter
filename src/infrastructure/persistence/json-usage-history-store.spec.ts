import { describe, expect, it } from 'vitest';
import { createEmptyHistory } from '../../domain/usage';
import type { JsonFile } from './json-file';
import { JsonUsageHistoryStore } from './json-usage-history-store';

class MemoryFile implements JsonFile {
  constructor(public text: string | null = null) {}

  async read(): Promise<string | null> {
    return this.text;
  }

  async write(text: string): Promise<void> {
    this.text = text;
  }

  async watch(): Promise<() => void> {
    return () => undefined;
  }
}

describe('JsonUsageHistoryStore', () => {
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

  it('JSON inválido: começa vazio em vez de quebrar a página', async () => {
    expect(await new JsonUsageHistoryStore(new MemoryFile('{ quebrado')).load()).toEqual(createEmptyHistory());
  });
});
