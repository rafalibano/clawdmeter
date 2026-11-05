import { describe, expect, it } from 'vitest';
import { MINUTE_MS } from '../../domain/time';
import { INITIAL_UPDATE_SNAPSHOT } from '../../domain/updates';
import { Localizer } from '../i18n';
import { bannerView, canCheckNow, lastCheckText, statusText, updatesSummary } from './update-view';

const pt = new Localizer('pt-BR');
const en = new Localizer('en');

describe('update view', () => {
  it('shows "Nova versão X · Atualizar" in the banner', () => {
    expect(bannerView(pt, { state: 'available', version: '0.2.0', notes: null })).toEqual({
      text: 'Nova versão 0.2.0',
      action: 'install',
      dismissible: false,
    });
  });

  it('shows the download percent when the size is known', () => {
    expect(bannerView(en, { state: 'downloading', version: '0.2.0', downloaded: 1, total: 4 })?.text).toBe(
      'Downloading 0.2.0… 25%',
    );
    expect(bannerView(en, { state: 'downloading', version: '0.2.0', downloaded: 1, total: null })?.text).toBe(
      'Downloading 0.2.0…',
    );
  });

  it('asks before restarting and offers to retry a failed install', () => {
    expect(bannerView(pt, { state: 'installed', version: '0.2.0' })).toEqual({
      text: 'Versão 0.2.0 instalada. Reiniciar agora?',
      action: 'restart',
      dismissible: true,
    });
    expect(bannerView(en, { state: 'error', during: 'install', reason: 'failed', version: '0.2.0' })?.action).toBe(
      'retry-install',
    );
    expect(bannerView(en, { state: 'error', during: 'check', reason: 'failed', version: null })).toBeNull();
    expect(bannerView(en, { state: 'up-to-date' })).toBeNull();
  });

  it('tells to connect GitHub when there is no GitHub connection', () => {
    expect(statusText(pt, { state: 'github-required' })).toBe('Conecte o GitHub para receber atualizações.');
    expect(statusText(en, { state: 'error', during: 'check', reason: 'rate-limited', version: null })).toContain('limited');
  });

  it('formats the last check and the summary', () => {
    expect(lastCheckText(en, INITIAL_UPDATE_SNAPSHOT, 0)).toBe('never');
    expect(lastCheckText(en, { ...INITIAL_UPDATE_SNAPSHOT, lastCheckedAt: 0 }, 5 * MINUTE_MS)).toContain('5 min');
    expect(updatesSummary(en, { ...INITIAL_UPDATE_SNAPSHOT, currentVersion: '0.1.0' })).toBe('Version 0.1.0');
    expect(updatesSummary(en, { ...INITIAL_UPDATE_SNAPSHOT, status: { state: 'available', version: '0.2.0', notes: null } })).toBe(
      'Version 0.2.0 is available',
    );
  });

  it('blocks "check now" while busy', () => {
    expect(canCheckNow({ state: 'checking' })).toBe(false);
    expect(canCheckNow({ state: 'downloading', version: '1', downloaded: 0, total: null })).toBe(false);
    expect(canCheckNow({ state: 'installed', version: '1' })).toBe(false);
    expect(canCheckNow({ state: 'up-to-date' })).toBe(true);
  });
});
