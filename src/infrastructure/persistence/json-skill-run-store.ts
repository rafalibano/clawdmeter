import type { SkillRunStore } from '../../application/ports';
import { parseRunHistory, type SkillRun } from '../../domain/skills';
import type { JsonFile } from './json-file';

export class JsonSkillRunStore implements SkillRunStore {
  constructor(private readonly file: JsonFile) {}

  async load(): Promise<SkillRun[]> {
    const text = await this.file.read();
    if (text === null) return [];
    try {
      return parseRunHistory(JSON.parse(text));
    } catch {
      return [];
    }
  }

  async save(runs: SkillRun[]): Promise<void> {
    await this.file.write(`${JSON.stringify({ schemaVersion: 1, runs }, null, 2)}\n`);
  }
}
