import type { Clock } from '../ports';
import { createSkills, type Skills } from '../skills';
import { FakeTerminal, FakeUrlOpener } from './fake-connection-adapters';
import { FakeSkillRunStore, FakeSkillsConfigStore, FakeStreamingProcessRunner } from './fake-feature-adapters';

export function createFakeSkills(clock: Clock): Skills {
  return createSkills(
    {
      config: new FakeSkillsConfigStore(),
      runs: new FakeSkillRunStore(),
      runner: new FakeStreamingProcessRunner(),
      terminal: new FakeTerminal(),
      urls: new FakeUrlOpener(),
    },
    clock,
  );
}
