import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const WORKFLOWS = join(ROOT, '.github/workflows');
const files = readdirSync(WORKFLOWS).filter((name) => name.endsWith('.yml'));
const read = (name: string) => readFileSync(join(WORKFLOWS, name), 'utf8').replace(/\r\n/g, '\n');

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

  it('cargo audit and deny also run weekly, without the build matrix', () => {
    const text = read('ci.yml');
    expect(text).toMatch(/schedule:\n\s+- cron: '\d+ \d+ \* \* \d'/);
    expect(text).toContain("if: github.event_name != 'schedule'");
    const supplyChain = text.slice(text.indexOf('supply-chain:'));
    expect(supplyChain).not.toContain('if:');
    expect(supplyChain).toContain('cargo audit');
  });

  it('the release signs the updater artifacts and publishes latest.json only after every platform passed', () => {
    const text = read('release.yml');
    expect(text).toContain('TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}');
    expect(text).toContain('TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}');
    expect(text).toContain('includeUpdaterJson: true');
    expect(text).toContain('releaseDraft: true');
    expect(text).not.toContain('releaseDraft: false');
    expect(text).toContain('--bundles app,dmg');
    expect(text).toContain('--bundles msi,nsis');
    const release = text.slice(text.indexOf('\n  release:'), text.indexOf('\n  publish:'));
    expect(release).toContain('needs: draft');
    expect(release).toContain('fail-fast: false');
    const publish = text.slice(text.indexOf('\n  publish:'));
    expect(publish).toContain('needs: release');
    expect(publish).toContain('environment: release');
    expect(publish).toMatch(/permissions:\n\s+contents: write/);
    for (const platform of ['darwin-aarch64', 'darwin-x86_64', 'windows-x86_64']) expect(publish).toContain(platform);
    expect(publish).toContain('-F draft=false');
    expect(publish).not.toContain('${{ github.ref_name }}"');
    expect(text.indexOf('-F draft=false')).toBeGreaterThan(text.indexOf('- name: Check the macOS signature'));
  });

  it('the macOS release is signed by the stable certificate and fails without it', () => {
    const text = read('release.yml');
    const importStep = text.slice(text.indexOf('- name: Import the macOS signing certificate'), text.indexOf('- uses: tauri-apps/tauri-action'));
    expect(text.indexOf('- name: Import the macOS signing certificate')).toBeGreaterThan(text.indexOf('- run: yarn install'));
    expect(importStep).toContain("if: runner.os == 'macOS'");
    for (const name of ['APPLE_CERTIFICATE', 'APPLE_CERTIFICATE_PASSWORD']) {
      expect(importStep).toContain(`${name}: \${{ secrets.${name} }}`);
    }
    expect(importStep).toContain('APPLE_SIGNING_IDENTITY: ClawdMeter Self-Signed');
    expect(text).not.toContain('secrets.APPLE_SIGNING_IDENTITY');
    expect(importStep).toContain(' -x -T /usr/bin/codesign');
    expect(importStep).toContain('Missing secrets in the release environment');
    expect(importStep).toContain('exit 1');
    const tauriStep = text.slice(text.indexOf('- uses: tauri-apps/tauri-action'), text.indexOf('- name: Check the macOS signature'));
    expect(tauriStep).not.toContain('APPLE_CERTIFICATE');
    expect(text).toContain('Authority=$APPLE_SIGNING_IDENTITY');
    expect(text).toContain('security delete-keychain "$SIGNING_KEYCHAIN"');
    expect(readFileSync(join(ROOT, 'src-tauri/tauri.conf.json'), 'utf8')).toContain('"signingIdentity": "-"');
  });

  it('dependabot covers actions, cargo and npm every week', () => {
    const text = readFileSync(join(ROOT, '.github/dependabot.yml'), 'utf8').replace(/\r\n/g, '\n');
    for (const ecosystem of ['github-actions', 'cargo', 'npm']) {
      expect(text).toContain(`package-ecosystem: ${ecosystem}`);
    }
    expect(text.match(/interval: weekly/g)).toHaveLength(3);
    expect(text).toContain('directory: /src-tauri');
  });
});
