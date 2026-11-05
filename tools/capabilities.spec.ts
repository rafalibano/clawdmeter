import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface Permission {
  identifier?: string;
  allow?: Array<{ url?: string }>;
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

  it('libera spawn, kill e terminal usados pelas runs de skills', () => {
    for (const permission of ['allow-process-spawn', 'allow-process-kill', 'allow-terminal-run', 'allow-open-url']) {
      expect(capability.permissions).toContain(permission);
    }
  });
});
