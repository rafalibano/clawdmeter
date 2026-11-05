import type { ApplicationMessageKey, MessageArgs, Translator } from '../ports';

const TEXTS: Record<ApplicationMessageKey, string> = {
  'notice.run.succeeded': '{name} concluída',
  'notice.run.failed': '{name} falhou',
  'tooltip.unavailable': 'Dev Pulse · usage indisponível',
  'tooltip.noData': '{label}: sem dado',
  'tooltip.resets': 'reseta {when}',
  'run.failure.execution-failed': 'A execução falhou.',
  'run.failure.no-result': 'O Claude Code encerrou sem resultado (código {code}).',
  'run.failure.truncated': 'Saída truncada.',
  'run.exitCode.unknown': 'desconhecido',
};

export class FakeTranslator implements Translator {
  readonly locale = 'pt-BR';

  t(key: ApplicationMessageKey, args?: MessageArgs): string {
    return TEXTS[key].replace(/\{(\w+)\}/g, (match, name: string) => (args && name in args ? String(args[name]) : match));
  }

  cost(usd: number): string {
    return `US$ ${usd.toFixed(2).replace('.', ',')}`;
  }
}
