import { describe, expect, it } from 'vitest';
import { APP_LANGUAGES, DEFAULT_CLAUDE_OAUTH_CLIENT_ID, createDefaultSettings, migrateSettings } from '../../domain/settings';
import { CONNECTION_PROBLEMS } from '../../domain/connections';
import type { ErrorCode } from '../../domain/coded-error';
import { DICTIONARIES, Localizer, interpolate, translate, type MessageKey } from './localizer';
import { LiveTranslator } from './live-translator';
import { CurrentLanguage } from '../../application/language';
import { en as enDictionary } from './en';

const ERROR_CODES: readonly ErrorCode[] = [
  'usage-disconnected',
  'github-not-connected',
  'skill-running',
  'skill-unknown',
  'skill-no-session',
  'link-invalid-meeting',
  'link-invalid-github',
  'meeting-open-failed',
  'too-many-processes',
  'github-token-empty',
  'github-access-denied',
  'github-code-expired',
  'github-oauth-misconfigured',
  'github-login-failed',
  'github-rate-limited',
  'microsoft-calendar-denied',
  'client-id-missing',
  'claude-signin-required',
  'claude-account-name-empty',
  'claude-account-name-too-long',
  'claude-account-name-taken',
  'claude-account-limit',
  'claude-account-missing',
  'claude-client-id-invalid',
  'claude-login-code-empty',
  'claude-login-code-invalid',
  'claude-login-busy',
  'keychain-unavailable',
  'keyring-unavailable',
  'claude-login-timeout',
  'claude-login-cancelled',
  'claude-login-rate-limited',
  'claude-login-failed',
];

const KEYS = Object.keys(enDictionary) as MessageKey[];

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe('dictionaries', () => {
  it.each(APP_LANGUAGES)('%s has exactly the same keys as en', (language) => {
    expect(Object.keys(DICTIONARIES[language]).sort()).toEqual([...KEYS].sort());
  });

  it.each(APP_LANGUAGES)('%s has no empty text', (language) => {
    for (const key of KEYS) expect(DICTIONARIES[language][key].trim(), key).not.toBe('');
  });

  it.each(APP_LANGUAGES)('%s uses the same placeholders for each key', (language) => {
    for (const key of KEYS) expect(placeholders(DICTIONARIES[language][key]), key).toEqual(placeholders(enDictionary[key]));
  });

  it('no text shows the default Claude client id or its prefix', () => {
    expect(APP_LANGUAGES).toEqual(expect.arrayContaining(['en', 'pt-BR', 'es-MX']));
    const hidden = [DEFAULT_CLAUDE_OAUTH_CLIENT_ID.toLowerCase(), '9d1c250a'];
    for (const language of APP_LANGUAGES) {
      for (const key of KEYS) {
        const text = DICTIONARIES[language][key].toLowerCase();
        for (const fragment of hidden) expect(text.includes(fragment), `${language} ${key}`).toBe(false);
      }
    }
  });

  it('every connection problem has text in the three languages', () => {
    for (const language of APP_LANGUAGES) {
      for (const problem of CONNECTION_PROBLEMS) expect(translate(language, `problem.${problem}`, { org: 'X' })).not.toContain('{');
    }
  });

  it('every error code has text in the three languages with the same placeholders', () => {
    for (const code of ERROR_CODES) {
      const key = `error.${code}` as MessageKey;
      expect(key in enDictionary, key).toBe(true);
      for (const language of APP_LANGUAGES) {
        expect(DICTIONARIES[language][key].trim(), `${language} ${key}`).not.toBe('');
        expect(placeholders(DICTIONARIES[language][key]), `${language} ${key}`).toEqual(placeholders(enDictionary[key]));
      }
    }
  });
});

describe('language switching', () => {
  it('the same service returns text in the chosen language', () => {
    expect(translate('pt-BR', 'shell.settings')).toBe('Ajustes');
    expect(translate('en', 'shell.settings')).toBe('Settings');
    expect(translate('es-MX', 'shell.settings')).toBe('Ajustes');
    expect(translate('en', 'connections.heading')).toBe('Connections');
  });

  it('the application translator follows the current language immediately', () => {
    const current = new CurrentLanguage();
    const translator = new LiveTranslator(current);
    expect(translator.t('notice.run.failed', { name: 'Acabativa' })).toBe('Acabativa failed');
    expect(translator.locale).toBe('en-US');
    current.set('pt-BR');
    expect(translator.t('notice.run.failed', { name: 'Acabativa' })).toBe('Acabativa falhou');
    current.set('es-MX');
    expect(translator.t('tooltip.noData', { label: '7d' })).toBe('7d: sin dato');
  });

  it('old settings without a language open in en and the default is en', () => {
    expect(createDefaultSettings().language).toBe('en');
    expect(migrateSettings({ schemaVersion: 1, enabledPages: {} }).language).toBe('en');
  });

  it('a language already saved is preserved', () => {
    expect(migrateSettings({ schemaVersion: 3, language: 'pt-BR' }).language).toBe('pt-BR');
    expect(migrateSettings({ schemaVersion: 7, language: 'es-MX' }).language).toBe('es-MX');
  });
});

describe('interpolate', () => {
  it('replaces placeholders and keeps unknown ones', () => {
    expect(interpolate('oi {name}, {x}', { name: 'ana' })).toBe('oi ana, {x}');
    expect(interpolate('sem args {a}')).toBe('sem args {a}');
  });
});

describe('formatters by language', () => {
  const pt = new Localizer('pt-BR');
  const en = new Localizer('en');
  const es = new Localizer('es-MX');
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it('compact duration and time texts', () => {
    expect(pt.span(30_000)).toBe('menos de 1 min');
    expect(en.span(30_000)).toBe('less than 1 min');
    expect(pt.span(2 * HOUR + 6 * MIN)).toBe('2h06');
    expect(en.span(6 * DAY + 2 * HOUR)).toBe('6d2h');
    expect(pt.span(90 * MIN)).toBe('1h30');
  });

  it('"X ago" and "now"', () => {
    expect(pt.since(10_000)).toBe('agora');
    expect(en.since(10_000)).toBe('now');
    expect(pt.since(5 * MIN)).toBe('há 5 min');
    expect(en.since(5 * MIN)).toBe('5 min ago');
    expect(es.since(5 * MIN)).toBe('hace 5 min');
  });

  it('footer "updated Xs ago"', () => {
    expect(pt.updatedAgo(null, 0)).toBe('aguardando dados');
    expect(pt.updatedAgo(0, 12_000)).toBe('atualizado há 12s');
    expect(pt.updatedAgo(0, 5 * MIN)).toBe('atualizado há 5 min');
    expect(pt.updatedAgo(0, 3 * HOUR)).toBe('atualizado há 3 h');
    expect(en.updatedAgo(0, 12_000)).toBe('updated 12s ago');
    expect(es.updatedAgo(0, 12_000)).toBe('actualizado hace 12s');
  });

  it('numbers and cost follow the language', () => {
    expect(pt.cost(1234.5)).toBe('US$ 1.234,50');
    expect(en.cost(1234.5)).toBe('US$ 1,234.50');
    expect(es.cost(0.5)).toBe('US$ 0.50');
    expect(pt.budget(2)).toBe('US$ 2');
    expect(pt.number(1.5)).toBe('1,5');
    expect(en.number(1.5)).toBe('1.5');
  });

  it('24h time in every language and day of month in local order', () => {
    const at = Date.UTC(2026, 10, 5, 14, 5);
    expect(pt.clock(at, 'UTC')).toBe('14:05');
    expect(en.clock(at, 'UTC')).toBe('14:05');
    expect(es.clock(at, 'UTC')).toBe('14:05');
    const day = new Date(2026, 10, 5, 12).getTime();
    expect(pt.axisTick(day, 30 * DAY)).toBe('05/11');
    expect(en.axisTick(day, 30 * DAY)).toBe('11/05');
    expect(pt.axisTick(day, DAY)).toMatch(/^\d{2}:\d{2}$/);
  });

  it('abbreviated weekday in the language, without a dot', () => {
    const friday = Date.UTC(2026, 10, 6, 12);
    expect(pt.weekday(friday, 'UTC')).toBe('sex');
    expect(en.weekday(friday, 'UTC')).toBe('fri');
    expect(es.weekday(friday, 'UTC')).toBe('vie');
  });

  it('session plural follows the language', () => {
    expect(pt.count('sessions.count', 1)).toBe('1 sessão');
    expect(pt.count('sessions.count', 3)).toBe('3 sessões');
    expect(en.count('sessions.flagged', 1)).toBe('1 needs attention');
    expect(en.count('sessions.flagged', 2)).toBe('2 need attention');
  });
});
