import { describe, expect, it } from 'vitest';
import { DEFAULT_SKILLS, startRun } from '../../domain/skills';
import type { JsonFile } from './json-file';
import { JsonSkillRunStore } from './json-skill-run-store';
import { JsonSkillsConfigStore } from './json-skills-config-store';

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

describe('JsonSkillsConfigStore', () => {
  it('sem arquivo ou com JSON quebrado usa as skills padrão sem escrever', async () => {
    const missing = new MemoryFile();
    expect((await new JsonSkillsConfigStore(missing).load()).map((skill) => skill.id)).toEqual(
      DEFAULT_SKILLS.map((skill) => skill.id),
    );
    expect(missing.text).toBeNull();
    expect(await new JsonSkillsConfigStore(new MemoryFile('{quebrado')).load()).toHaveLength(DEFAULT_SKILLS.length);
  });

  it('lê as skills do arquivo', async () => {
    const file = new MemoryFile(
      JSON.stringify({ skills: [{ id: 'prs', name: 'PRs', prompt: '/prs', maxBudgetUsd: 0.5, allowedTools: ['Read'] }] }),
    );
    expect(await new JsonSkillsConfigStore(file).load()).toEqual([
      { id: 'prs', name: 'PRs', prompt: '/prs', maxBudgetUsd: 0.5, allowedTools: ['Read'], cwd: null },
    ]);
  });
});

describe('JsonSkillRunStore', () => {
  it('grava e relê o histórico', async () => {
    const file = new MemoryFile();
    const store = new JsonSkillRunStore(file);
    const run = { ...startRun('r1', DEFAULT_SKILLS[0]!, 100), status: 'succeeded' as const, endedAt: 200, costUsd: 0.2 };
    await store.save([run]);
    expect(JSON.parse(file.text ?? '{}')).toMatchObject({ schemaVersion: 1 });
    expect(await store.load()).toEqual([run]);
  });

  it('sem arquivo ou corrompido devolve histórico vazio', async () => {
    expect(await new JsonSkillRunStore(new MemoryFile()).load()).toEqual([]);
    expect(await new JsonSkillRunStore(new MemoryFile('nada')).load()).toEqual([]);
  });
});
