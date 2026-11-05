import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint();

async function rulesViolatedBy(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((message) => message.ruleId ?? 'parse-error');
}

describe('architecture lint', () => {
  describe('rule 1: isolated domain', () => {
    it('blocks domain importing infrastructure', async () => {
      const rules = await rulesViolatedBy(
        'src/domain/__fixture__.ts',
        `import { SystemClock } from '../infrastructure/platform/system-clock';\nexport const clock = SystemClock;\n`,
      );
      expect(rules).toContain('boundaries/dependencies');
    });

    it('blocks domain importing application', async () => {
      const rules = await rulesViolatedBy(
        'src/domain/__fixture__.ts',
        `import { PageRegistry } from '../application/pages';\nexport const registry = PageRegistry;\n`,
      );
      expect(rules).toContain('boundaries/dependencies');
    });

    it('blocks domain importing an external package', async () => {
      const rules = await rulesViolatedBy(
        'src/domain/__fixture__.ts',
        `import { signal } from '@angular/core';\nexport const s = signal;\n`,
      );
      expect(rules).toContain('no-restricted-imports');
    });
  });

  describe('rule 2: application only sees domain', () => {
    it('blocks application importing infrastructure', async () => {
      const rules = await rulesViolatedBy(
        'src/application/__fixture__.ts',
        `import { JsonSettingsStore } from '../infrastructure/persistence';\nexport const s = JsonSettingsStore;\n`,
      );
      expect(rules).toContain('boundaries/dependencies');
    });

    it('blocks application importing ui', async () => {
      const rules = await rulesViolatedBy(
        'src/application/__fixture__.ts',
        `import { Localizer } from '../ui/i18n/localizer';\nexport const f = Localizer;\n`,
      );
      expect(rules).toContain('boundaries/dependencies');
    });

    it('blocks application importing @angular/*', async () => {
      const rules = await rulesViolatedBy(
        'src/application/__fixture__.ts',
        `import { Injectable } from '@angular/core';\nexport const i = Injectable;\n`,
      );
      expect(rules).toContain('no-restricted-imports');
    });

    it('blocks application importing @tauri-apps/*', async () => {
      const rules = await rulesViolatedBy(
        'src/application/__fixture__.ts',
        `import { invoke } from '@tauri-apps/api/core';\nexport const i = invoke;\n`,
      );
      expect(rules).toContain('no-restricted-imports');
    });
  });

  describe('rules 3 and 4: ui does not touch infrastructure or Tauri', () => {
    it('blocks ui importing infrastructure', async () => {
      const rules = await rulesViolatedBy(
        'src/ui/__fixture__.ts',
        `import { JsonSettingsStore } from '../infrastructure/persistence';\nexport const s = JsonSettingsStore;\n`,
      );
      expect(rules).toContain('boundaries/dependencies');
    });

    it('blocks ui importing a Tauri plugin', async () => {
      const rules = await rulesViolatedBy(
        'src/ui/__fixture__.ts',
        `import { readTextFile } from '@tauri-apps/plugin-fs';\nexport const r = readTextFile;\n`,
      );
      expect(rules).toContain('no-restricted-imports');
    });

    it('blocks ui calling fetch', async () => {
      const rules = await rulesViolatedBy('src/ui/__fixture__.ts', `export const call = () => fetch('/x');\n`);
      expect(rules).toContain('no-restricted-globals');
    });

    it('blocks ui importing @angular/common/http', async () => {
      const rules = await rulesViolatedBy(
        'src/ui/__fixture__.ts',
        `import { HttpClient } from '@angular/common/http';\nexport const h = HttpClient;\n`,
      );
      expect(rules).toContain('no-restricted-imports');
    });

    it('allows ui importing @angular/common', async () => {
      const rules = await rulesViolatedBy(
        'src/ui/__fixture__.ts',
        `import { DatePipe } from '@angular/common';\nexport const d = DatePipe;\n`,
      );
      expect(rules).toEqual([]);
    });

    it.each([
      ['window.fetch', `export const call = () => window.fetch('/x');\n`],
      ['globalThis.fetch', `export const call = () => globalThis.fetch('/x');\n`],
      ["globalThis['fetch']", `export const call = () => globalThis['fetch']('/x');\n`],
      ['new window.WebSocket', `export const socket = new window.WebSocket('ws://x');\n`],
      ['desestruturando window', `const { fetch } = window;\nexport const call = fetch;\n`],
    ])('barra ui acessando rede por %s', async (_name, code) => {
      const rules = await rulesViolatedBy('src/ui/__fixture__.ts', code);
      expect(rules).toContain('no-restricted-syntax');
    });

    it.each([
      ['const { innerWidth } = window', `const { innerWidth } = window;\nexport const w = innerWidth;\n`],
      ['const { document } = globalThis', `const { document } = globalThis;\nexport const d = document;\n`],
    ])('permite %s na ui', async (_name, code) => {
      const rules = await rulesViolatedBy('src/ui/__fixture__.ts', code);
      expect(rules).toEqual([]);
    });

    it('blocks destructuring XMLHttpRequest and WebSocket from self', async () => {
      const rules = await rulesViolatedBy(
        'src/ui/__fixture__.ts',
        `const { XMLHttpRequest, WebSocket: Socket } = self;\nexport const a = [XMLHttpRequest, Socket];\n`,
      );
      expect(rules).toContain('no-restricted-syntax');
    });

    it('allows fetch in infrastructure, including via globalThis', async () => {
      const rules = await rulesViolatedBy(
        'src/infrastructure/__fixture__.ts',
        `export const a = () => fetch('/x');\nexport const b = () => globalThis.fetch('/x');\n`,
      );
      expect(rules).toEqual([]);
    });
  });

  describe('rule 6: OS detection', () => {
    it('blocks navigator.platform outside the composition root', async () => {
      const rules = await rulesViolatedBy('src/ui/__fixture__.ts', `export const os = navigator.platform;\n`);
      expect(rules).toContain('no-restricted-properties');
    });

    it('allows it in the composition root', async () => {
      const rules = await rulesViolatedBy('src/composition-root.ts', `export const os = navigator.platform;\n`);
      expect(rules).toEqual([]);
    });

    it.each([
      ['window.navigator.platform', `export const os = window.navigator.platform;\n`],
      ['globalThis.navigator.userAgent', `export const os = globalThis.navigator.userAgent;\n`],
      ["navigator['platform']", `export const os = navigator['platform'];\n`],
      ["window.navigator['userAgentData']", `export const os = window.navigator['userAgentData'];\n`],
      ['desestruturando navigator', `const { platform } = navigator;\nexport const os = platform;\n`],
    ])('barra %s na ui', async (_name, code) => {
      const rules = await rulesViolatedBy('src/ui/__fixture__.ts', code);
      expect(rules).toContain('no-restricted-syntax');
    });

    it('allows destructuring a non-OS property from navigator', async () => {
      const rules = await rulesViolatedBy(
        'src/ui/__fixture__.ts',
        `const { language } = navigator;\nexport const l = language;\n`,
      );
      expect(rules).toEqual([]);
    });

    it('blocks process.platform outside the composition root', async () => {
      const rules = await rulesViolatedBy('src/infrastructure/__fixture__.ts', `export const os = process.platform;\n`);
      expect(rules).toContain('no-restricted-properties');
    });

    it('blocks window.navigator.platform in infrastructure', async () => {
      const rules = await rulesViolatedBy(
        'src/infrastructure/__fixture__.ts',
        `export const os = window.navigator.platform;\n`,
      );
      expect(rules).toContain('no-restricted-syntax');
    });

    it('blocks @tauri-apps/plugin-os in infrastructure', async () => {
      const rules = await rulesViolatedBy(
        'src/infrastructure/__fixture__.ts',
        `import { platform } from '@tauri-apps/plugin-os';\nexport const os = platform;\n`,
      );
      expect(rules).toContain('no-restricted-imports');
    });

    it('blocks @tauri-apps/plugin-os in ui', async () => {
      const rules = await rulesViolatedBy(
        'src/ui/__fixture__.ts',
        `import { platform } from '@tauri-apps/plugin-os';\nexport const os = platform;\n`,
      );
      expect(rules).toContain('no-restricted-imports');
    });

    it('allows plugin-os, process.platform and window.navigator in the composition root', async () => {
      const rules = await rulesViolatedBy(
        'src/composition-root.ts',
        `import { platform } from '@tauri-apps/plugin-os';\nexport const a = [platform, process.platform, window.navigator.platform];\n`,
      );
      expect(rules).toEqual([]);
    });

    it('infrastructure can still use other Tauri plugins', async () => {
      const rules = await rulesViolatedBy(
        'src/infrastructure/__fixture__.ts',
        `import { readTextFile } from '@tauri-apps/plugin-fs';\nexport const r = readTextFile;\n`,
      );
      expect(rules).toEqual([]);
    });
  });

  describe('allowed dependencies', () => {
    it('ui imports application and domain', async () => {
      const rules = await rulesViolatedBy(
        'src/ui/__fixture__.ts',
        `import { PageRegistry } from '../application/pages';\nimport { createDefaultSettings } from '../domain/settings';\nexport const x = [PageRegistry, createDefaultSettings];\n`,
      );
      expect(rules).toEqual([]);
    });

    it('infrastructure implements application ports', async () => {
      const rules = await rulesViolatedBy(
        'src/infrastructure/__fixture__.ts',
        `import type { Clock } from '../application/ports';\nexport type C = Clock;\n`,
      );
      expect(rules).toEqual([]);
    });

    it('composition root imports infrastructure and ui', async () => {
      const rules = await rulesViolatedBy(
        'src/composition-root.ts',
        `import { SystemClock } from './infrastructure/platform/system-clock';\nimport { createExamplePage } from './ui/pages/example/example.page';\nexport const x = [SystemClock, createExamplePage];\n`,
      );
      expect(rules).toEqual([]);
    });
  });

  describe('rule 7: the popover must not lose focus', () => {
    function sourcesUnder(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return sourcesUnder(path);
        return /\.(html|ts)$/.test(entry.name) && !entry.name.endsWith('.spec.ts') ? [path] : [];
      });
    }

    it('ui does not use input type=color (the native picker closes the popover on blur)', () => {
      const offenders = sourcesUnder('src/ui').filter((path) => /type\s*=\s*["']color["']/.test(readFileSync(path, 'utf8')));
      expect(offenders).toEqual([]);
    });
  });
});
