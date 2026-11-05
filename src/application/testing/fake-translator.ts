import type { ApplicationMessageKey, MessageArgs, Translator } from '../ports';

const TEXTS: Record<ApplicationMessageKey, string> = {
  'notice.run.succeeded': '{name} finished',
  'notice.run.failed': '{name} failed',
  'tooltip.unavailable': 'ClawdMeter · usage unavailable',
  'tooltip.noData': '{label}: no data',
  'tooltip.resets': 'resets {when}',
  'run.failure.execution-failed': 'Execution failed.',
  'run.failure.no-result': 'Claude Code exited without a result (code {code}).',
  'run.failure.truncated': 'Output truncated.',
  'run.exitCode.unknown': 'unknown',
};

export class FakeTranslator implements Translator {
  readonly locale = 'en-US';

  t(key: ApplicationMessageKey, args?: MessageArgs): string {
    return TEXTS[key].replace(/\{(\w+)\}/g, (match, name: string) => (args && name in args ? String(args[name]) : match));
  }

  cost(usd: number): string {
    return `US$ ${usd.toFixed(2)}`;
  }
}
