import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint();

async function rulesViolatedBy(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((message) => message.ruleId ?? 'parse-error');
}

describe('lint de arquitetura', () => {
  describe('regra 1: domain isolado', () => {
    it('barra domain importando infrastructure', async () => {
      const rules = await rulesViolatedBy(
        'src/domain/__fixture__.ts',
        `import { SystemClock } from '../infrastructure/platform/system-clock';\nexport const clock = SystemClock;\n`,
      );
      expect(rules).toContain('boundaries/dependencies');
    });

    it('barra domain importando application', async () => {
      const rules = await rulesViolatedBy(
        'src/domain/__fixture__.ts',
        `import { PageRegistry } from '../application/pages';\nexport const registry = PageRegistry;\n`,
      );
      expect(rules).toContain('boundaries/dependencies');
    });

    it('barra domain importando pacote externo', async () => {
      const rules = await rulesViolatedBy(
        'src/domain/__fixture__.ts',
        `import { signal } from '@angular/core';\nexport const s = signal;\n`,
      );
      expect(rules).toContain('no-restricted-imports');
    });
  });

  describe('regra 2: application só enxerga domain', () => {
    it('barra application importando infrastructure', async () => {
      const rules = await rulesViolatedBy(
        'src/application/__fixture__.ts',
        `import { JsonSettingsStore } from '../infrastructure/persistence';\nexport const s = JsonSettingsStore;\n`,
      );
      expect(rules).toContain('boundaries/dependencies');
    });

    it('barra application importando ui', async () => {
      const rules = await rulesViolatedBy(
        'src/application/__fixture__.ts',
        `import { formatUpdatedAgo } from '../ui/shell/elapsed';\nexport const f = formatUpdatedAgo;\n`,
      );
      expect(rules).toContain('boundaries/dependencies');
    });

    it('barra application importando @angular/*', async () => {
      const rules = await rulesViolatedBy(
        'src/application/__fixture__.ts',
        `import { Injectable } from '@angular/core';\nexport const i = Injectable;\n`,
      );
      expect(rules).toContain('no-restricted-imports');
    });

    it('barra application importando @tauri-apps/*', async () => {
      const rules = await rulesViolatedBy(
        'src/application/__fixture__.ts',
        `import { invoke } from '@tauri-apps/api/core';\nexport const i = invoke;\n`,
      );
      expect(rules).toContain('no-restricted-imports');
    });
  });

  describe('regras 3 e 4: ui não toca infrastructure nem Tauri', () => {
    it('barra ui importando infrastructure', async () => {
      const rules = await rulesViolatedBy(
        'src/ui/__fixture__.ts',
        `import { JsonSettingsStore } from '../infrastructure/persistence';\nexport const s = JsonSettingsStore;\n`,
      );
      expect(rules).toContain('boundaries/dependencies');
    });

    it('barra ui importando plugin do Tauri', async () => {
      const rules = await rulesViolatedBy(
        'src/ui/__fixture__.ts',
        `import { readTextFile } from '@tauri-apps/plugin-fs';\nexport const r = readTextFile;\n`,
      );
      expect(rules).toContain('no-restricted-imports');
    });

    it('barra ui chamando fetch', async () => {
      const rules = await rulesViolatedBy('src/ui/__fixture__.ts', `export const call = () => fetch('/x');\n`);
      expect(rules).toContain('no-restricted-globals');
    });

    it('barra ui importando @angular/common/http', async () => {
      const rules = await rulesViolatedBy(
        'src/ui/__fixture__.ts',
        `import { HttpClient } from '@angular/common/http';\nexport const h = HttpClient;\n`,
      );
      expect(rules).toContain('no-restricted-imports');
    });

    it('permite ui importando @angular/common', async () => {
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

    it('barra desestruturação de XMLHttpRequest e WebSocket de self', async () => {
      const rules = await rulesViolatedBy(
        'src/ui/__fixture__.ts',
        `const { XMLHttpRequest, WebSocket: Socket } = self;\nexport const a = [XMLHttpRequest, Socket];\n`,
      );
      expect(rules).toContain('no-restricted-syntax');
    });

    it('permite fetch na infrastructure, inclusive via globalThis', async () => {
      const rules = await rulesViolatedBy(
        'src/infrastructure/__fixture__.ts',
        `export const a = () => fetch('/x');\nexport const b = () => globalThis.fetch('/x');\n`,
      );
      expect(rules).toEqual([]);
    });
  });

  describe('regra 6: detecção de SO', () => {
    it('barra navigator.platform fora do composition-root', async () => {
      const rules = await rulesViolatedBy('src/ui/__fixture__.ts', `export const os = navigator.platform;\n`);
      expect(rules).toContain('no-restricted-properties');
    });

    it('permite no composition-root', async () => {
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

    it('permite desestruturar propriedade não relacionada a SO de navigator', async () => {
      const rules = await rulesViolatedBy(
        'src/ui/__fixture__.ts',
        `const { language } = navigator;\nexport const l = language;\n`,
      );
      expect(rules).toEqual([]);
    });

    it('barra process.platform fora do composition-root', async () => {
      const rules = await rulesViolatedBy('src/infrastructure/__fixture__.ts', `export const os = process.platform;\n`);
      expect(rules).toContain('no-restricted-properties');
    });

    it('barra window.navigator.platform na infrastructure', async () => {
      const rules = await rulesViolatedBy(
        'src/infrastructure/__fixture__.ts',
        `export const os = window.navigator.platform;\n`,
      );
      expect(rules).toContain('no-restricted-syntax');
    });

    it('barra @tauri-apps/plugin-os na infrastructure', async () => {
      const rules = await rulesViolatedBy(
        'src/infrastructure/__fixture__.ts',
        `import { platform } from '@tauri-apps/plugin-os';\nexport const os = platform;\n`,
      );
      expect(rules).toContain('no-restricted-imports');
    });

    it('barra @tauri-apps/plugin-os na ui', async () => {
      const rules = await rulesViolatedBy(
        'src/ui/__fixture__.ts',
        `import { platform } from '@tauri-apps/plugin-os';\nexport const os = platform;\n`,
      );
      expect(rules).toContain('no-restricted-imports');
    });

    it('permite plugin-os, process.platform e window.navigator no composition-root', async () => {
      const rules = await rulesViolatedBy(
        'src/composition-root.ts',
        `import { platform } from '@tauri-apps/plugin-os';\nexport const a = [platform, process.platform, window.navigator.platform];\n`,
      );
      expect(rules).toEqual([]);
    });

    it('infrastructure continua podendo usar outros plugins do Tauri', async () => {
      const rules = await rulesViolatedBy(
        'src/infrastructure/__fixture__.ts',
        `import { readTextFile } from '@tauri-apps/plugin-fs';\nexport const r = readTextFile;\n`,
      );
      expect(rules).toEqual([]);
    });
  });

  describe('dependências permitidas', () => {
    it('ui importa application e domain', async () => {
      const rules = await rulesViolatedBy(
        'src/ui/__fixture__.ts',
        `import { PageRegistry } from '../application/pages';\nimport { createDefaultSettings } from '../domain/settings';\nexport const x = [PageRegistry, createDefaultSettings];\n`,
      );
      expect(rules).toEqual([]);
    });

    it('infrastructure implementa portas da application', async () => {
      const rules = await rulesViolatedBy(
        'src/infrastructure/__fixture__.ts',
        `import type { Clock } from '../application/ports';\nexport type C = Clock;\n`,
      );
      expect(rules).toEqual([]);
    });

    it('composition-root importa infrastructure e ui', async () => {
      const rules = await rulesViolatedBy(
        'src/composition-root.ts',
        `import { SystemClock } from './infrastructure/platform/system-clock';\nimport { createExamplePage } from './ui/pages/example/example.page';\nexport const x = [SystemClock, createExamplePage];\n`,
      );
      expect(rules).toEqual([]);
    });
  });

  describe('regra 7: popover não pode perder o foco', () => {
    function sourcesUnder(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return sourcesUnder(path);
        return /\.(html|ts)$/.test(entry.name) && !entry.name.endsWith('.spec.ts') ? [path] : [];
      });
    }

    it('a ui não usa input type=color (o seletor nativo fecha o popover por blur)', () => {
      const offenders = sourcesUnder('src/ui').filter((path) => /type\s*=\s*["']color["']/.test(readFileSync(path, 'utf8')));
      expect(offenders).toEqual([]);
    });
  });
});
