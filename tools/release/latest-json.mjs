import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const PACKAGES = [
  { suffix: '-setup.exe', platforms: ['windows-x86_64', 'windows-x86_64-nsis'], versioned: true },
  { suffix: '.msi', platforms: ['windows-x86_64-msi'], versioned: true },
  {
    suffix: '.app.tar.gz',
    platforms: ['darwin-aarch64', 'darwin-x86_64', 'darwin-aarch64-app', 'darwin-x86_64-app'],
    versioned: false,
  },
];

const PLATFORM_ORDER = [
  'windows-x86_64',
  'windows-x86_64-nsis',
  'windows-x86_64-msi',
  'darwin-aarch64',
  'darwin-x86_64',
  'darwin-aarch64-app',
  'darwin-x86_64-app',
];

function signedVersion(signature) {
  const trusted = Buffer.from(signature, 'base64')
    .toString('utf8')
    .split('\n')
    .find((line) => line.startsWith('trusted comment:'));
  return /(?:^|\s)version:(\S+)/.exec(trusted ?? '')?.[1];
}

export function buildLatestJson({ repo, tag, notes, pubDate, assetNames, signatures }) {
  const version = /^v(\d+\.\d+\.\d+\S*)$/.exec(tag)?.[1];
  if (!version) throw new Error(`Tag ${tag} is not v<semver>.`);
  const entries = {};
  for (const pkg of PACKAGES) {
    const names = assetNames.filter((name) => name.endsWith(pkg.suffix));
    if (names.length !== 1) {
      throw new Error(`Expected exactly one *${pkg.suffix} asset in the release, found ${names.length}: ${names.join(', ') || 'none'}.`);
    }
    const name = names[0];
    if (pkg.versioned && !name.includes(`_${version}_`)) throw new Error(`${name} is not version ${version}.`);
    const signature = signatures[`${name}.sig`];
    if (!signature) throw new Error(`${name}.sig is missing from the release.`);
    const signed = signedVersion(signature);
    if (signed !== version) throw new Error(`${name}.sig is signed for version ${signed ?? 'unknown'}, expected ${version}.`);
    const url = `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
    for (const platform of pkg.platforms) entries[platform] = { signature, url };
  }
  const platforms = Object.fromEntries(PLATFORM_ORDER.map((platform) => [platform, entries[platform]]));
  return { version, notes, pub_date: pubDate, platforms };
}

function main() {
  const [repo, tag, namesFile, signatureDir] = process.argv.slice(2);
  if (!repo || !tag || !namesFile || !signatureDir) {
    throw new Error('usage: latest-json.mjs <owner/repo> <tag> <file with one asset name per line> <directory with the .sig assets>');
  }
  const assetNames = readFileSync(namesFile, 'utf8').split('\n').filter(Boolean);
  const signatures = Object.fromEntries(
    assetNames.filter((name) => name.endsWith('.sig')).map((name) => [name, readFileSync(join(signatureDir, name), 'utf8')]),
  );
  const latest = buildLatestJson({
    repo,
    tag,
    notes: process.env.RELEASE_NOTES ?? '',
    pubDate: new Date().toISOString(),
    assetNames,
    signatures,
  });
  process.stdout.write(`${JSON.stringify(latest, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
