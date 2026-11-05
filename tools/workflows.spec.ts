import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const WORKFLOWS = join(ROOT, '.github/workflows');
const files = readdirSync(WORKFLOWS).filter((name) => name.endsWith('.yml'));
const read = (name: string) => readFileSync(join(WORKFLOWS, name), 'utf8');

const USES = /^\s*- uses: (\S+)@(\S+)(.*)$/gm;

describe('GitHub Actions workflows', () => {
  it('every action is pinned by SHA with the version comment next to it', () => {
    for (const name of files) {
      const uses = [...read(name).matchAll(USES)];
      expect(uses.length, name).toBeGreaterThan(0);
      for (const [, action, ref, rest] of uses) {
        expect(ref, `${name}: ${action}`).toMatch(/^[0-9a-f]{40}$/);
        expect(rest, `${name}: ${action}`).toMatch(/^\s+# (v\d+(\.\d+)*|stable)\s*$/);
      }
    }
  });

  it('every actions/checkout uses persist-credentials: false', () => {
    for (const name of files) {
      const text = read(name);
      const checkouts = text.split('\n').flatMap((line, index) => (line.includes('uses: actions/checkout@') ? [index] : []));
      expect(checkouts.length, name).toBeGreaterThan(0);
      const lines = text.split('\n');
      for (const index of checkouts) {
        expect(lines.slice(index + 1, index + 4).join('\n'), name).toContain('persist-credentials: false');
      }
    }
  });

  it('the CI and release toolchain is the same as rust-toolchain.toml', () => {
    const channel = /channel = "([^"]+)"/.exec(readFileSync(join(ROOT, 'rust-toolchain.toml'), 'utf8'))?.[1];
    expect(channel).toMatch(/^\d+\.\d+\.\d+$/);
    for (const name of files) {
      const toolchains = [...read(name).matchAll(/toolchain: (\S+)/g)].map((match) => match[1]);
      expect(toolchains.length, name).toBeGreaterThan(0);
      for (const toolchain of toolchains) expect(toolchain, name).toBe(channel);
    }
  });

  it('dependabot covers actions, cargo and npm every week', () => {
    const text = readFileSync(join(ROOT, '.github/dependabot.yml'), 'utf8');
    for (const ecosystem of ['github-actions', 'cargo', 'npm']) {
      expect(text).toContain(`package-ecosystem: ${ecosystem}`);
    }
    expect(text.match(/interval: weekly/g)).toHaveLength(3);
    expect(text).toContain('directory: /src-tauri');
  });
});
