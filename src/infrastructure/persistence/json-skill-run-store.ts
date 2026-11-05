import type { SkillRunStore } from '../../application/ports';
import { parseRunHistory, type SkillRun } from '../../domain/skills';
import type { JsonFile } from './json-file';

export class JsonSkillRunStore implements SkillRunStore {
  private writing: Promise<void> = Promise.resolve();

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

  save(runs: SkillRun[]): Promise<void> {
    const body = `${JSON.stringify({ schemaVersion: 1, runs }, null, 2)}\n`;
    const write = this.writing.then(() => this.file.write(body));
    this.writing = write.catch(() => undefined);
    return write;
  }
}
