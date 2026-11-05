import type { Clock, SkillRunStore, SkillsConfigStore, StreamingProcessRunner, TerminalLauncher, UrlOpener } from '../ports';
import {
  CancelSkillRun,
  ContinueSkillInTerminal,
  FixSkillProblem,
  ListSkills,
  LoadSkillRuns,
  RunSkill,
} from '../use-cases/skills';
import { SkillRunBoard } from './skill-run-board';

export interface SkillAdapters {
  config: SkillsConfigStore;
  runs: SkillRunStore;
  runner: StreamingProcessRunner;
  terminal: TerminalLauncher;
  urls: UrlOpener;
}

export interface Skills {
  board: SkillRunBoard;
  list: ListSkills;
  loadRuns: LoadSkillRuns;
  run: RunSkill;
  cancel: CancelSkillRun;
  continueInTerminal: ContinueSkillInTerminal;
  fix: FixSkillProblem;
}

export function createSkills(adapters: SkillAdapters, clock: Clock): Skills {
  const board = new SkillRunBoard();
  return {
    board,
    list: new ListSkills(adapters.config),
    loadRuns: new LoadSkillRuns(adapters.runs, board),
    run: new RunSkill(adapters.config, adapters.runner, adapters.runs, board, clock),
    cancel: new CancelSkillRun(board),
    continueInTerminal: new ContinueSkillInTerminal(board, adapters.terminal),
    fix: new FixSkillProblem(adapters.terminal, adapters.urls),
  };
}
