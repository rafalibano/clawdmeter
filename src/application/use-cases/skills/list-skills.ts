import type { SkillDefinition } from '../../../domain/skills';
import type { SkillsConfigStore } from '../../ports';

export class ListSkills {
  constructor(private readonly config: SkillsConfigStore) {}

  execute(): Promise<SkillDefinition[]> {
    return this.config.load();
  }
}
