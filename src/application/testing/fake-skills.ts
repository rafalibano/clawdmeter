import { createConnections } from '../connections/create-connections';
import type { Clock } from '../ports';
import { FakeTranslator } from './fake-translator';
import { createSkills, type Skills } from '../skills';
import { FakeTerminal, FakeUrlOpener, createFakeConnectionWorld } from './fake-connection-adapters';
import {
  FakeNotifier,
  FakeSkillRunStore,
  FakeSkillsConfigStore,
  FakeStreamingProcessRunner,
} from './fake-feature-adapters';

export function createFakeSkills(clock: Clock): Skills {
  return createSkills(
    {
      config: new FakeSkillsConfigStore(),
      runs: new FakeSkillRunStore(),
      runner: new FakeStreamingProcessRunner(),
      terminal: new FakeTerminal(),
      urls: new FakeUrlOpener(),
      notifier: new FakeNotifier(),
      translator: new FakeTranslator(),
    },
    clock,
    createConnections(createFakeConnectionWorld().adapters, clock),
  );
}
