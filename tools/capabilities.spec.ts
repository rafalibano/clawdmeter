import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface Permission {
  identifier?: string;
  allow?: Array<{ url?: string; path?: string }>;
  deny?: Array<{ path?: string }>;
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
  it('allows the GitHub GraphQL POST in plugin-http', () => {
    expect(httpAllowlist().some((pattern) => matches(pattern, 'https://api.github.com/graphql'))).toBe(true);
  });

  it('does not allow hosts outside the list', () => {
    expect(httpAllowlist().some((pattern) => matches(pattern, 'https://example.com/graphql'))).toBe(false);
  });

  it('plugin-fs rename only applies inside $APPCONFIG (atomic history write)', () => {
    const rename = capability.permissions.filter(
      (permission): permission is Permission => typeof permission === 'object' && permission.identifier === 'fs:allow-rename',
    );
    expect(rename).toHaveLength(1);
    expect((rename[0]?.allow ?? []).map((entry) => entry.path)).toEqual(['$APPCONFIG/**']);
  });

  it('denies every fs command access to the migration markers in $APPDATA/.migration', () => {
    const global = capability.permissions.find(
      (permission): permission is Permission => typeof permission === 'object' && permission.identifier === 'fs:scope',
    );
    expect((global?.deny ?? []).map((entry) => entry.path)).toEqual(['$APPDATA/.migration', '$APPDATA/.migration/**']);
  });

  it('allows a local notification at the end of skill runs', () => {
    expect(capability.permissions).toContain('notification:allow-notify');
  });

  it('allows spawn, kill and terminal used by skill runs', () => {
    for (const permission of ['allow-process-spawn', 'allow-process-kill', 'allow-terminal-run', 'allow-open-url']) {
      expect(capability.permissions).toContain(permission);
    }
  });

  it('does not expose global-shortcut to the webview: the shortcut is registered only in Rust', () => {
    const shortcut = capability.permissions.filter((permission) =>
      (typeof permission === 'string' ? permission : (permission.identifier ?? '')).startsWith('global-shortcut:'),
    );
    expect(shortcut).toEqual([]);
  });

  it('updates go only through the app updater commands, never the updater plugin API', () => {
    for (const permission of ['allow-updater-check', 'allow-updater-install', 'allow-updater-restart']) {
      expect(capability.permissions).toContain(permission);
    }
    const plugin = capability.permissions.filter((permission) =>
      (typeof permission === 'string' ? permission : (permission.identifier ?? '')).startsWith('updater:'),
    );
    expect(plugin).toEqual([]);
  });

  it('the updater config carries the public key and requires the signed version', () => {
    const config = JSON.parse(readFileSync(join(__dirname, '../src-tauri/tauri.conf.json'), 'utf8')) as {
      bundle: { createUpdaterArtifacts?: boolean };
      plugins?: { updater?: { pubkey?: string; requireSignedVersion?: boolean; endpoints?: unknown } };
    };
    const updater = config.plugins?.updater;
    expect(config.bundle.createUpdaterArtifacts).toBe(true);
    expect(updater?.requireSignedVersion).toBe(true);
    expect(updater?.endpoints).toBeUndefined();
    expect(Buffer.from(updater?.pubkey ?? '', 'base64').toString('utf8')).toMatch(/^untrusted comment: minisign public key: [0-9A-F]+\n\S+\n?$/);
  });

  describe('ClaudeUsageBar history', () => {
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

    it('file read and stat only, and only of history.json', () => {
      expect(reaching(HISTORY).map((scope) => scope.identifier)).toEqual(['fs:allow-read-text-file', 'fs:allow-stat']);
      const own = fsScopes().filter((scope) => scope.path.includes('claude-usage-bar'));
      expect(own).toEqual([
        { identifier: 'fs:allow-read-text-file', path: '$HOME/.config/claude-usage-bar/history.json' },
        { identifier: 'fs:allow-stat', path: '$HOME/.config/claude-usage-bar/history.json' },
      ]);
    });

    it('credentials.json in the same folder and the folder itself stay outside any scope', () => {
      expect(reaching('/home/dev/.config/claude-usage-bar/credentials.json')).toEqual([]);
      expect(reaching('/home/dev/.config/claude-usage-bar')).toEqual([]);
      expect(reaching('/home/dev/.config/claude-usage-bar/history.json.bak')).toEqual([]);
    });
  });
});
