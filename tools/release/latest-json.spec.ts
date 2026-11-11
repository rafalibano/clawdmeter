import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildLatestJson, type LatestJson } from './latest-json.mjs';

const published: LatestJson = JSON.parse(readFileSync(join(__dirname, 'fixtures/latest-0.2.2.json'), 'utf8'));
const signatureOf = (platform: string) => published.platforms[platform].signature;

const ASSETS = [
  'ClawdMeter_0.2.2_universal.dmg',
  'ClawdMeter_0.2.2_x64-setup.exe',
  'ClawdMeter_0.2.2_x64-setup.exe.sig',
  'ClawdMeter_0.2.2_x64_en-US.msi',
  'ClawdMeter_0.2.2_x64_en-US.msi.sig',
  'ClawdMeter_universal.app.tar.gz',
  'ClawdMeter_universal.app.tar.gz.sig',
];
const SIGNATURES = {
  'ClawdMeter_0.2.2_x64-setup.exe.sig': signatureOf('windows-x86_64-nsis'),
  'ClawdMeter_0.2.2_x64_en-US.msi.sig': signatureOf('windows-x86_64-msi'),
  'ClawdMeter_universal.app.tar.gz.sig': signatureOf('darwin-aarch64-app'),
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
  it('rebuilds the published v0.2.2 latest.json exactly, with the same keys in the same order', () => {
    const latest = build();
    expect(latest).toEqual(published);
    expect(Object.keys(latest)).toEqual(Object.keys(published));
    expect(Object.keys(latest.platforms)).toEqual(Object.keys(published.platforms));
    expect(latest.platforms['windows-x86_64']).toEqual(latest.platforms['windows-x86_64-nsis']);
  });

  it('refuses a package missing from the release or its signature', () => {
    expect(() => build({ assetNames: ASSETS.filter((name) => !name.endsWith('.msi')) })).toThrow('*.msi');
    expect(() => build({ signatures: { ...SIGNATURES, 'ClawdMeter_universal.app.tar.gz.sig': '' } })).toThrow('ClawdMeter_universal.app.tar.gz.sig is missing');
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
