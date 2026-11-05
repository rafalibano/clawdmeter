export type ApplicationMessageKey =
  | 'notice.run.succeeded'
  | 'notice.run.failed'
  | 'tooltip.unavailable'
  | 'tooltip.noData'
  | 'tooltip.resets'
  | 'run.failure.execution-failed'
  | 'run.failure.no-result'
  | 'run.failure.truncated'
  | 'run.exitCode.unknown';

export type MessageArgs = Record<string, string | number>;

export interface Translator {
  readonly locale: string;
  t(key: ApplicationMessageKey, args?: MessageArgs): string;
  cost(usd: number): string;
}
