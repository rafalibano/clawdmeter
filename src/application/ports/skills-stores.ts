import type { SkillDefinition, SkillRun } from '../../domain/skills';

export interface SkillsConfigStore {
  load(): Promise<SkillDefinition[]>;
}

export interface SkillRunStore {
  load(): Promise<SkillRun[]>;
  save(runs: SkillRun[]): Promise<void>;
}
