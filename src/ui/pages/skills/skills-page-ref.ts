import { pageRef } from '../../../application/pages';
import type { SkillDefinition } from '../../../domain/skills';

export interface SkillsPageData {
  skills: SkillDefinition[];
}

export const SKILLS_PAGE = pageRef<SkillsPageData>('skills');
