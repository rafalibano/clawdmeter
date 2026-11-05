import type { PageModule } from '../../../application/pages';
import type { Skills } from '../../../application/skills';
import { SkillsComponent } from './skills.component';
import { SKILLS_PAGE, type SkillsPageData } from './skills-page-ref';

export function createSkillsPage(deps: { skills: Skills }): PageModule<SkillsPageData> {
  return {
    id: SKILLS_PAGE.id,
    title: 'Skills',
    requiredConnections: ['claude', 'notifications'],
    pollIntervalMs: null,
    load: async () => {
      await deps.skills.loadRuns.execute();
      return { skills: await deps.skills.list.execute() };
    },
    component: SkillsComponent,
  };
}
