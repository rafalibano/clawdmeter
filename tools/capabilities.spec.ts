import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface Permission {
  identifier?: string;
  allow?: Array<{ url?: string; path?: string }>;
}

const capability = JSON.parse(readFileSync(join(__dirname, '../src-tauri/capabilities/default.json'), 'utf8')) as {
  permissions: Array<string | Permission>;
};

function httpAllowlist(): string[] {
  return capability.permissions.flatMap((permission) =>
    typeof permission === 'object' && permission.identifier === 'http:default'
      ? (permission.allow ?? []).flatMap((entry) => entry.url ?? [])
      : [],
  );
}

function matches(pattern: string, url: string): boolean {
  const source = pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${source}$`).test(url);
}

describe('capability default', () => {
  it('libera o POST do GraphQL do GitHub no plugin-http', () => {
    expect(httpAllowlist().some((pattern) => matches(pattern, 'https://api.github.com/graphql'))).toBe(true);
  });

  it('não libera hosts fora da lista', () => {
    expect(httpAllowlist().some((pattern) => matches(pattern, 'https://example.com/graphql'))).toBe(false);
  });

  it('rename do plugin-fs só vale dentro de $APPCONFIG (escrita atômica do histórico)', () => {
    const rename = capability.permissions.filter(
      (permission): permission is Permission => typeof permission === 'object' && permission.identifier === 'fs:allow-rename',
    );
    expect(rename).toHaveLength(1);
    expect((rename[0]?.allow ?? []).map((entry) => entry.path)).toEqual(['$APPCONFIG/**']);
  });

  it('libera notificação local para o fim das runs de skills', () => {
    expect(capability.permissions).toContain('notification:allow-notify');
  });

  it('libera spawn, kill e terminal usados pelas runs de skills', () => {
    for (const permission of ['allow-process-spawn', 'allow-process-kill', 'allow-terminal-run', 'allow-open-url']) {
      expect(capability.permissions).toContain(permission);
    }
  });

  describe('histórico do ClaudeUsageBar', () => {
    const FS_PERMISSION = /^fs:/;
    const HISTORY = '/home/dev/.config/claude-usage-bar/history.json';

    function fsScopes(): Array<{ identifier: string; path: string }> {
      return capability.permissions.flatMap((permission) =>
        typeof permission === 'object' && FS_PERMISSION.test(permission.identifier ?? '')
          ? (permission.allow ?? []).map((entry) => ({ identifier: permission.identifier!, path: entry.path ?? '' }))
          : [],
      );
    }

    function pathMatches(pattern: string, path: string): boolean {
      const source = pattern
        .replace('$HOME', '/home/dev')
        .split('**')
        .map((chunk) => chunk.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*'))
        .join('.*');
      return new RegExp(`^${source}$`).test(path);
    }

    const reaching = (path: string) => fsScopes().filter((scope) => pathMatches(scope.path, path));

    it('só leitura de arquivo, e só do history.json', () => {
      expect(reaching(HISTORY).map((scope) => scope.identifier)).toEqual(['fs:allow-read-text-file']);
      const own = fsScopes().filter((scope) => scope.path.includes('claude-usage-bar'));
      expect(own).toEqual([{ identifier: 'fs:allow-read-text-file', path: '$HOME/.config/claude-usage-bar/history.json' }]);
    });

    it('credentials.json da mesma pasta e a própria pasta ficam fora de qualquer escopo', () => {
      expect(reaching('/home/dev/.config/claude-usage-bar/credentials.json')).toEqual([]);
      expect(reaching('/home/dev/.config/claude-usage-bar')).toEqual([]);
      expect(reaching('/home/dev/.config/claude-usage-bar/history.json.bak')).toEqual([]);
    });
  });
});
