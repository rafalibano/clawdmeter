import type { SkillsConfigStore } from '../../application/ports';
import { parseSkillsConfig, type SkillDefinition } from '../../domain/skills';
import type { JsonFile } from './json-file';

export class JsonSkillsConfigStore implements SkillsConfigStore {
  constructor(private readonly file: JsonFile) {}

  async load(): Promise<SkillDefinition[]> {
    const text = await this.file.read();
    if (text === null) return parseSkillsConfig(null);
    try {
      return parseSkillsConfig(JSON.parse(text));
    } catch {
      return parseSkillsConfig(null);
    }
  }
}
