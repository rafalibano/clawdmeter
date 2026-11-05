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
  it('without a file or with broken JSON uses the default skills without writing', async () => {
    const missing = new MemoryFile();
    expect((await new JsonSkillsConfigStore(missing).load()).map((skill) => skill.id)).toEqual(
      DEFAULT_SKILLS.map((skill) => skill.id),
    );
    expect(missing.text).toBeNull();
    expect(await new JsonSkillsConfigStore(new MemoryFile('{quebrado')).load()).toHaveLength(DEFAULT_SKILLS.length);
  });

  it('reads the skills from the file', async () => {
    const file = new MemoryFile(
      JSON.stringify({ skills: [{ id: 'prs', name: 'PRs', prompt: '/prs', maxBudgetUsd: 0.5, allowedTools: ['Read'] }] }),
    );
    expect(await new JsonSkillsConfigStore(file).load()).toEqual([
      { id: 'prs', name: 'PRs', prompt: '/prs', maxBudgetUsd: 0.5, allowedTools: ['Read'], cwd: null },
    ]);
  });
});

describe('JsonSkillRunStore', () => {
  it('writes and rereads the history', async () => {
    const file = new MemoryFile();
    const store = new JsonSkillRunStore(file);
    const run = { ...startRun('r1', DEFAULT_SKILLS[0]!, 100), status: 'succeeded' as const, endedAt: 200, costUsd: 0.2 };
    await store.save([run]);
    expect(JSON.parse(file.text ?? '{}')).toMatchObject({ schemaVersion: 1 });
    expect(await store.load()).toEqual([run]);
  });

  it('writes in series, in call order, even with slow writes', async () => {
    const order: string[] = [];
    let active = 0;
    let overlapped = false;
    const file = new (class extends MemoryFile {
      override async write(text: string): Promise<void> {
        active += 1;
        overlapped ||= active > 1;
        const id = (JSON.parse(text) as { runs: Array<{ id: string }> }).runs[0]?.id ?? '';
        await new Promise((resolve) => setTimeout(resolve, id === 'a' ? 20 : 1));
        order.push(id);
        active -= 1;
      }
    })();
    const store = new JsonSkillRunStore(file);
    const run = (id: string) => ({ ...startRun(id, DEFAULT_SKILLS[0]!, 1), status: 'succeeded' as const });
    await Promise.all([store.save([run('a')]), store.save([run('b')]), store.save([run('c')])]);
    expect(order).toEqual(['a', 'b', 'c']);
    expect(overlapped).toBe(false);
  });

  it('a failed write does not block the following ones', async () => {
    let calls = 0;
    const file = new (class extends MemoryFile {
      override async write(text: string): Promise<void> {
        calls += 1;
        if (calls === 1) throw new Error('disco cheio');
        this.text = text;
      }
    })();
    const store = new JsonSkillRunStore(file);
    await expect(store.save([])).rejects.toThrow('disco cheio');
    await store.save([]);
    expect(file.text).not.toBeNull();
  });

  it('without a file or with a corrupt one returns an empty history', async () => {
    expect(await new JsonSkillRunStore(new MemoryFile()).load()).toEqual([]);
    expect(await new JsonSkillRunStore(new MemoryFile('nada')).load()).toEqual([]);
  });
});
