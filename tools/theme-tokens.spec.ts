import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MOTTU } from '../src/ui/theme/mottu-tokens';

const SRC = join(__dirname, '..', 'src');
const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

const sources = filesUnder(SRC).filter((path) => /\.(ts|scss|html)$/.test(path) && !path.endsWith('.spec.ts'));
const tokens = readFileSync(join(SRC, 'ui/theme/mottu-tokens.scss'), 'utf8');

function token(name: string): string {
  const match = new RegExp(`--me-${name}: ([^;]+);`).exec(tokens);
  if (!match) throw new Error(`token ausente: ${name}`);
  return match[1]!;
}

describe('snapshot dos tokens --me-*', () => {
  it('as constantes TS espelham o CSS do DS', () => {
    expect(MOTTU.primary).toEqual({ dark: '#003909', base: '#00b131', alt: '#1bd60b', light: '#71ff75' });
    expect(token('primary-60')).toBe(MOTTU.primary.base);
    expect(token('primary-70')).toBe(MOTTU.primary.alt);
    expect(token('primary-20')).toBe(MOTTU.primary.dark);
    expect(token('primary-90')).toBe(MOTTU.primary.light);
    expect(token('alert-60')).toBe(MOTTU.alert.base);
    expect(token('alert-90')).toBe(MOTTU.alert.light);
    expect(token('warning-60')).toBe(MOTTU.warning.base);
    expect(token('info-60')).toBe(MOTTU.info.base);
    expect(token('neutral-0')).toBe(MOTTU.neutral.black);
    expect(token('neutral-10')).toBe(MOTTU.neutral.extraDark);
    expect(token('neutral-20')).toBe(MOTTU.neutral.dark);
    expect(token('neutral-100')).toBe(MOTTU.neutral.white);
  });

  it('escala neutral e raios do DS', () => {
    const neutral = { 30: '#4f4f4f', 40: '#616161', 60: '#8f8f8f', 80: '#c4c4c4', 95: '#eeeeee', 99: '#f7f7f7' };
    for (const [step, hex] of Object.entries(neutral)) expect(token(`neutral-${step}`)).toBe(hex);
    expect([2, 4, 8, 16].map((size) => token(`radius-${size}`))).toEqual(['2px', '4px', '8px', '16px']);
    expect(token('radius-1000')).toBe('1000px');
    expect(token('shadow-1')).toContain('rgba');
  });

  it('o amarelo do SLA é o Amarelo 1 da paleta oficial', () => {
    expect(MOTTU.amarelo1).toBe('#ffc700');
    expect(readFileSync(join(SRC, 'ui/theme/theme.scss'), 'utf8')).toContain('--dp-sla-attention: #ffc700;');
  });
});

describe('guardas de tema', () => {
  it('uma única família de fonte, Helvetica, em todo o app', () => {
    const declared = sources.flatMap((path) =>
      [...readFileSync(path, 'utf8').matchAll(/font-family:\s*([^;]+);/g)].map((match) => [relative(SRC, path), match[1]!.trim()]),
    ).filter(([, family]) => family !== 'var(--dp-font-family)');
    expect(declared).toEqual([[join('ui', 'theme', 'theme.scss'), FONT]]);
  });

  it('nenhuma cor hexadecimal fora de src/ui/theme (usa tokens do DS)', () => {
    const offenders = sources
      .filter((path) => !relative(SRC, path).startsWith(join('ui', 'theme')) && !relative(SRC, path).startsWith('domain'))
      .filter((path) => /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![\w-])/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(SRC, path));
    expect(offenders).toEqual([]);
  });

  it('sem índigo nem roxo (o índigo só existe na migração)', () => {
    const offenders = sources
      .filter((path) => /6366f1|a855f7|ec4899/i.test(readFileSync(path, 'utf8')))
      .map((path) => relative(SRC, path));
    expect(offenders).toEqual([join('domain', 'settings', 'migrate-settings.ts')]);
  });
});
