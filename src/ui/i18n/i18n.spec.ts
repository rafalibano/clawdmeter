import { describe, expect, it } from 'vitest';
import { APP_LANGUAGES, createDefaultSettings, migrateSettings } from '../../domain/settings';
import { CONNECTION_PROBLEMS } from '../../domain/connections';
import { DICTIONARIES, Localizer, interpolate, translate, type MessageKey } from './localizer';
import { LiveTranslator } from './live-translator';
import { CurrentLanguage } from '../../application/language';
import { ptBR } from './pt-BR';

const KEYS = Object.keys(ptBR) as MessageKey[];

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe('dicionários', () => {
  it.each(APP_LANGUAGES)('%s tem exatamente as mesmas chaves do pt-BR', (language) => {
    expect(Object.keys(DICTIONARIES[language]).sort()).toEqual([...KEYS].sort());
  });

  it.each(APP_LANGUAGES)('%s não tem texto vazio', (language) => {
    for (const key of KEYS) expect(DICTIONARIES[language][key].trim(), key).not.toBe('');
  });

  it.each(APP_LANGUAGES)('%s usa os mesmos placeholders de cada chave', (language) => {
    for (const key of KEYS) expect(placeholders(DICTIONARIES[language][key]), key).toEqual(placeholders(ptBR[key]));
  });

  it('todo problema de conexão tem texto nas três línguas', () => {
    for (const language of APP_LANGUAGES) {
      for (const problem of CONNECTION_PROBLEMS) expect(translate(language, `problem.${problem}`, { org: 'X' })).not.toContain('{');
    }
  });
});

describe('troca de língua', () => {
  it('o mesmo serviço devolve texto na língua escolhida', () => {
    expect(translate('pt-BR', 'shell.settings')).toBe('Ajustes');
    expect(translate('en', 'shell.settings')).toBe('Settings');
    expect(translate('es-MX', 'shell.settings')).toBe('Ajustes');
    expect(translate('en', 'connections.heading')).toBe('Connections');
  });

  it('o tradutor da aplicação acompanha a língua atual na hora', () => {
    const current = new CurrentLanguage();
    const translator = new LiveTranslator(current);
    expect(translator.t('notice.run.failed', { name: 'Acabativa' })).toBe('Acabativa falhou');
    current.set('en');
    expect(translator.t('notice.run.failed', { name: 'Acabativa' })).toBe('Acabativa failed');
    expect(translator.locale).toBe('en-US');
    current.set('es-MX');
    expect(translator.t('tooltip.noData', { label: '7d' })).toBe('7d: sin dato');
  });

  it('settings antigos sem idioma abrem em pt-BR e o padrão é pt-BR', () => {
    expect(createDefaultSettings().language).toBe('pt-BR');
    expect(migrateSettings({ schemaVersion: 1, enabledPages: {} }).language).toBe('pt-BR');
  });
});

describe('interpolate', () => {
  it('troca placeholders e mantém os desconhecidos', () => {
    expect(interpolate('oi {name}, {x}', { name: 'ana' })).toBe('oi ana, {x}');
    expect(interpolate('sem args {a}')).toBe('sem args {a}');
  });
});

describe('formatadores por língua', () => {
  const pt = new Localizer('pt-BR');
  const en = new Localizer('en');
  const es = new Localizer('es-MX');
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it('duração compacta e textos de tempo', () => {
    expect(pt.span(30_000)).toBe('menos de 1 min');
    expect(en.span(30_000)).toBe('less than 1 min');
    expect(pt.span(2 * HOUR + 6 * MIN)).toBe('2h06');
    expect(en.span(6 * DAY + 2 * HOUR)).toBe('6d2h');
    expect(pt.span(90 * MIN)).toBe('1h30');
  });

  it('"há X" e "agora"', () => {
    expect(pt.since(10_000)).toBe('agora');
    expect(en.since(10_000)).toBe('now');
    expect(pt.since(5 * MIN)).toBe('há 5 min');
    expect(en.since(5 * MIN)).toBe('5 min ago');
    expect(es.since(5 * MIN)).toBe('hace 5 min');
  });

  it('rodapé "atualizado há Xs"', () => {
    expect(pt.updatedAgo(null, 0)).toBe('aguardando dados');
    expect(pt.updatedAgo(0, 12_000)).toBe('atualizado há 12s');
    expect(pt.updatedAgo(0, 5 * MIN)).toBe('atualizado há 5 min');
    expect(pt.updatedAgo(0, 3 * HOUR)).toBe('atualizado há 3 h');
    expect(en.updatedAgo(0, 12_000)).toBe('updated 12s ago');
    expect(es.updatedAgo(0, 12_000)).toBe('actualizado hace 12s');
  });

  it('números e custo seguem a língua', () => {
    expect(pt.cost(1234.5)).toBe('US$ 1.234,50');
    expect(en.cost(1234.5)).toBe('US$ 1,234.50');
    expect(es.cost(0.5)).toBe('US$ 0.50');
    expect(pt.budget(2)).toBe('US$ 2');
    expect(pt.number(1.5)).toBe('1,5');
    expect(en.number(1.5)).toBe('1.5');
  });

  it('hora em 24h em todas as línguas e dia do mês na ordem local', () => {
    const at = Date.UTC(2026, 10, 5, 14, 5);
    expect(pt.clock(at, 'UTC')).toBe('14:05');
    expect(en.clock(at, 'UTC')).toBe('14:05');
    expect(es.clock(at, 'UTC')).toBe('14:05');
    const day = new Date(2026, 10, 5, 12).getTime();
    expect(pt.axisTick(day, 30 * DAY)).toBe('05/11');
    expect(en.axisTick(day, 30 * DAY)).toBe('11/05');
    expect(pt.axisTick(day, DAY)).toMatch(/^\d{2}:\d{2}$/);
  });

  it('dia da semana abreviado na língua, sem ponto', () => {
    const friday = Date.UTC(2026, 10, 6, 12);
    expect(pt.weekday(friday, 'UTC')).toBe('sex');
    expect(en.weekday(friday, 'UTC')).toBe('fri');
    expect(es.weekday(friday, 'UTC')).toBe('vie');
  });

  it('plural de sessões segue a língua', () => {
    expect(pt.count('sessions.count', 1)).toBe('1 sessão');
    expect(pt.count('sessions.count', 3)).toBe('3 sessões');
    expect(en.count('sessions.flagged', 1)).toBe('1 needs attention');
    expect(en.count('sessions.flagged', 2)).toBe('2 need attention');
  });
});
