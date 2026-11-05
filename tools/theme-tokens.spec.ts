import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MOTTU } from '../src/ui/theme/mottu-tokens';
import { SOFT_SURFACES } from '../src/ui/theme/soft-surfaces';

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

describe('--me-* token snapshot', () => {
  it('the TS constants mirror the DS CSS', () => {
    expect(MOTTU.primary).toEqual({ dark: '#003909', base: '#00b131', alt: '#1bd60b', light: '#71ff75' });
    expect(token('primary-60')).toBe(MOTTU.primary.base);
    expect(token('primary-70')).toBe(MOTTU.primary.alt);
    expect(token('primary-20')).toBe(MOTTU.primary.dark);
    expect(token('primary-90')).toBe(MOTTU.primary.light);
    expect(token('alert-60')).toBe(MOTTU.alert.base);
    expect(token('alert-90')).toBe(MOTTU.alert.light);
    expect(token('warning-60')).toBe(MOTTU.warning.base);
    expect(token('info-60')).toBe(MOTTU.info.base);
    expect(token('info-70')).toBe(MOTTU.info.alt);
    expect(token('neutral-0')).toBe(MOTTU.neutral.black);
    expect(token('neutral-10')).toBe(MOTTU.neutral.extraDark);
    expect(token('neutral-20')).toBe(MOTTU.neutral.dark);
    expect(token('neutral-100')).toBe(MOTTU.neutral.white);
  });

  it('DS neutral scale and radii', () => {
    const neutral = { 30: '#4f4f4f', 40: '#616161', 60: '#8f8f8f', 80: '#c4c4c4', 95: '#eeeeee', 99: '#f7f7f7' };
    for (const [step, hex] of Object.entries(neutral)) expect(token(`neutral-${step}`)).toBe(hex);
    expect([2, 4, 8, 16].map((size) => token(`radius-${size}`))).toEqual(['2px', '4px', '8px', '16px']);
    expect(token('radius-1000')).toBe('1000px');
    expect(token('shadow-1')).toContain('rgba');
  });

  it('the SLA yellow is Yellow 1 of the official palette', () => {
    expect(MOTTU.amarelo1).toBe('#ffc700');
    expect(readFileSync(join(SRC, 'ui/theme/theme.scss'), 'utf8')).toContain('--cm-sla-attention: #ffc700;');
  });
});

function rgb(hex: string): number[] {
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
}

describe('soft surfaces', () => {
  const theme = readFileSync(join(SRC, 'ui/theme/theme.scss'), 'utf8');
  const dark = /:root\[data-theme='dark'\] \{([^}]+)\}/.exec(theme)![1]!;

  it('dark sits between the DS neutral-10 and neutral-20, without pure black', () => {
    const low = rgb(token('neutral-10'));
    const high = rgb(token('neutral-20'));
    for (const hex of [SOFT_SURFACES.dark.popover, SOFT_SURFACES.dark.card]) {
      rgb(hex).forEach((value, index) => {
        expect(value).toBeGreaterThanOrEqual(low[index]!);
        expect(value).toBeLessThanOrEqual(high[index]!);
      });
    }
    expect(SOFT_SURFACES.dark.popover).not.toBe('#000000');
  });

  it('the dark card is one step lighter than the popover; in light, popover neutral-99 and white card', () => {
    expect(rgb(SOFT_SURFACES.dark.card).reduce((a, b) => a + b)).toBeGreaterThan(rgb(SOFT_SURFACES.dark.popover).reduce((a, b) => a + b));
    expect(SOFT_SURFACES.light).toEqual({ popover: token('neutral-99'), card: token('neutral-100') });
  });

  it('theme.scss uses the same hex values as the constants', () => {
    expect(dark).toContain(`--cm-bg: ${SOFT_SURFACES.dark.popover};`);
    expect(dark).toContain(`--cm-surface: ${SOFT_SURFACES.dark.card};`);
    expect(theme).toContain('--cm-bg: var(--me-neutral-99);');
    expect(theme).toContain('--cm-surface: var(--me-neutral-100);');
  });

  it('borders and separators are translucent (6% on cards) and the window corners are 12px', () => {
    expect(dark).toContain('--cm-border: rgba(255, 255, 255, 0.06);');
    expect(theme).toContain('--cm-border: rgba(0, 0, 0, 0.06);');
    expect(theme).toContain('--cm-radius-window: 12px;');
    expect(theme).toContain('--cm-radius-md: 12px;');
  });

  it('the page canvas does not paint: transparent html and body and color-scheme only outside the root', () => {
    const styles = readFileSync(join(SRC, 'styles.scss'), 'utf8');
    expect(/html,\s*body \{[^}]*background: transparent;/.test(styles)).toBe(true);
    expect(/:root\s*\{[^}]*color-scheme/.test(styles + theme)).toBe(false);
  });
});

describe('theme guards', () => {
  it('a single font family, Helvetica, across the app', () => {
    const declared = sources.flatMap((path) =>
      [...readFileSync(path, 'utf8').matchAll(/font-family:\s*([^;]+);/g)].map((match) => [relative(SRC, path), match[1]!.trim()]),
    ).filter(([, family]) => family !== 'var(--cm-font-family)');
    expect(declared).toEqual([[join('ui', 'theme', 'theme.scss'), FONT]]);
  });

  it('no hex color outside src/ui/theme (use DS tokens)', () => {
    const offenders = sources
      .filter((path) => !relative(SRC, path).startsWith(join('ui', 'theme')) && !relative(SRC, path).startsWith('domain'))
      .filter((path) => /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![\w-])/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(SRC, path));
    expect(offenders).toEqual([]);
  });

  it('no indigo or purple (indigo only exists in the migration)', () => {
    const offenders = sources
      .filter((path) => /6366f1|a855f7|ec4899/i.test(readFileSync(path, 'utf8')))
      .map((path) => relative(SRC, path));
    expect(offenders).toEqual([join('domain', 'settings', 'migrate-settings.ts')]);
  });
});
