import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildLatestJson, type LatestJson } from './latest-json.mjs';

const published: LatestJson = JSON.parse(readFileSync(join(__dirname, 'fixtures/latest-0.2.2.json'), 'utf8'));
const signatureOf = (platform: string) => published.platforms[platform].signature;

const APPIMAGE = 'ClawdMeter_0.2.2_amd64.AppImage';
const signedFor = (file: string, version: string) =>
  Buffer.from(
    `untrusted comment: signature from tauri secret key\nRUQ=\ntrusted comment: timestamp:1794403000\tfile:${file}\tversion:${version}\nAA==\n`,
  ).toString('base64');

const ASSETS = [
  'ClawdMeter_0.2.2_universal.dmg',
  'ClawdMeter_0.2.2_x64-setup.exe',
  'ClawdMeter_0.2.2_x64-setup.exe.sig',
  'ClawdMeter_0.2.2_x64_en-US.msi',
  'ClawdMeter_0.2.2_x64_en-US.msi.sig',
  'ClawdMeter_universal.app.tar.gz',
  'ClawdMeter_universal.app.tar.gz.sig',
  APPIMAGE,
  `${APPIMAGE}.sig`,
  'ClawdMeter_0.2.2_amd64.deb',
];
const SIGNATURES = {
  'ClawdMeter_0.2.2_x64-setup.exe.sig': signatureOf('windows-x86_64-nsis'),
  'ClawdMeter_0.2.2_x64_en-US.msi.sig': signatureOf('windows-x86_64-msi'),
  'ClawdMeter_universal.app.tar.gz.sig': signatureOf('darwin-aarch64-app'),
  [`${APPIMAGE}.sig`]: signedFor(APPIMAGE, '0.2.2'),
};

const build = (overrides: Partial<Parameters<typeof buildLatestJson>[0]> = {}) =>
  buildLatestJson({
    repo: 'rafalibano/clawdmeter',
    tag: 'v0.2.2',
    notes: published.notes,
    pubDate: published.pub_date,
    assetNames: ASSETS,
    signatures: SIGNATURES,
    ...overrides,
  });

describe('latest.json built at publish', () => {
  it('keeps the published v0.2.2 macOS and Windows entries exactly, with the same keys in the same order', () => {
    const latest = build();
    const { 'linux-x86_64-appimage': linux, ...withoutLinux } = latest.platforms;
    expect(linux).toBeDefined();
    expect({ ...latest, platforms: withoutLinux }).toEqual(published);
    expect(Object.keys(latest)).toEqual(Object.keys(published));
    expect(Object.keys(latest.platforms)).toEqual([...Object.keys(published.platforms), 'linux-x86_64-appimage']);
    expect(latest.platforms['windows-x86_64']).toEqual(latest.platforms['windows-x86_64-nsis']);
  });

  it('offers the AppImage only to AppImage installs, never as the linux-x86_64 fallback a .deb install would read', () => {
    const latest = build();
    expect(latest.platforms['linux-x86_64-appimage']).toEqual({
      signature: SIGNATURES[`${APPIMAGE}.sig`],
      url: `https://github.com/rafalibano/clawdmeter/releases/download/v0.2.2/${APPIMAGE}`,
    });
    expect(Object.keys(latest.platforms).filter((platform) => platform.startsWith('linux'))).toEqual(['linux-x86_64-appimage']);
  });

  it('refuses a package missing from the release or its signature', () => {
    expect(() => build({ assetNames: ASSETS.filter((name) => !name.endsWith('.msi')) })).toThrow('*.msi');
    expect(() => build({ assetNames: ASSETS.filter((name) => !name.endsWith('.AppImage')) })).toThrow('*.AppImage');
    expect(() => build({ signatures: { ...SIGNATURES, 'ClawdMeter_universal.app.tar.gz.sig': '' } })).toThrow('ClawdMeter_universal.app.tar.gz.sig is missing');
    expect(() => build({ signatures: { ...SIGNATURES, [`${APPIMAGE}.sig`]: '' } })).toThrow(`${APPIMAGE}.sig is missing`);
  });

  it('refuses packages or signatures of another version', () => {
    expect(() => build({ tag: 'v0.2.3' })).toThrow('is not version 0.2.3');
    const renamed = ASSETS.map((name) => name.replace('0.2.2', '0.2.3'));
    const signatures = Object.fromEntries(Object.entries(SIGNATURES).map(([name, value]) => [name.replace('0.2.2', '0.2.3'), value]));
    expect(() => build({ tag: 'v0.2.3', assetNames: renamed, signatures })).toThrow('signed for version 0.2.2, expected 0.2.3');
  });

  it('refuses a tag that is not v<semver>', () => {
    expect(() => build({ tag: '0.2.2' })).toThrow('is not v<semver>');
  });
});
