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
});
