import { describe, expect, it } from 'vitest';
import {
  CONNECTION_PROBLEMS,
  claudeSignInStatus,
  errorStatus,
  noteStatus,
  type ConnectionId,
  type ConnectionStatus,
} from '../../../domain/connections';
import { Localizer } from '../../i18n';
import { toRowView as toRowViewWith } from './connection-view';

const PT = new Localizer('pt-BR');
const toRowView = (id: ConnectionId, status: ConnectionStatus, l: Localizer = PT) => toRowViewWith(id, status, l);

describe('toRowView', () => {
  it('connected shows the account and offers Disconnect', () => {
    const view = toRowView('github', { state: 'connected', account: 'dev' });
    expect(view).toMatchObject({ tone: 'ok', summary: 'Conectado · dev', busy: false });
    expect(view.actions.map((a) => a.label)).toEqual(['disconnect']);
  });

  it('disconnected offers Connect and shows the hint', () => {
    const view = toRowView('microsoft', { state: 'disconnected', note: 'after-reset' });
    expect(view).toMatchObject({ tone: 'idle', message: 'Entre de novo com o código do GitHub ou cole um novo token.', signInOptions: false });
    expect(view.actions.map((a) => a.label)).toEqual(['connect']);
  });

  it('GitHub without gh installed: Install GitHub CLI and the browser and token alternatives', () => {
    const view = toRowView('github', {
      state: 'disconnected',
      note: 'github-cli-not-installed',
      cli: 'not-installed',
    });
    expect(view.message).toBe(
      'GitHub CLI não encontrado. Instale e conecte o GitHub CLI, ou entre pelo navegador com um código.',
    );
    expect(view.actions.map((a) => a.label)).toEqual(['install-github-cli']);
    expect(view.signInOptions).toBe(true);
  });

  it('GitHub with gh not logged in: Connect GitHub CLI and the alternatives', () => {
    const view = toRowView('github', {
      state: 'disconnected',
      note: 'github-cli-not-logged-in',
      cli: 'not-logged-in',
    });
    expect(view.message).toBe('Conecte o GitHub CLI ou entre pelo navegador com um código.');
    expect(view.actions.map((a) => a.label)).toEqual(['connect-github-cli']);
    expect(view.signInOptions).toBe(true);
  });

  it('GitHub connected or in error does not show the sign-in alternatives', () => {
    expect(toRowView('github', { state: 'connected', account: 'dev' }).signInOptions).toBe(false);
    expect(toRowView('github', errorStatus('github-unauthorized')).signInOptions).toBe(false);
  });

  it('checking is busy and has no buttons', () => {
    expect(toRowView('claude', { state: 'checking' })).toMatchObject({ busy: true, tone: 'busy', actions: [] });
  });

  it('every error state shows a message and a fix button', () => {
    for (const problem of CONNECTION_PROBLEMS) {
      const view = toRowView('claude', errorStatus(problem));
      expect(view.tone).toBe('error');
      expect(view.message).toBeTruthy();
      expect(view.actions.some((action) => action.kind === 'fix')).toBe(true);
    }
  });

  it('unverifiable notifications show as "Not verifiable", never as connected', () => {
    const view = toRowView('notifications', errorStatus('notifications-unverifiable'));
    expect(view).toMatchObject({ tone: 'error', summary: 'Não verificável' });
    expect(view.actions.find((action) => action.kind === 'fix')?.label).toBe('open-system-settings');
  });

  it('Claude without accounts tells to add one and the account that must sign in again is named', () => {
    expect(toRowView('claude', errorStatus('claude-no-account')).message).toBe(
      'Nenhuma conta do Claude ainda. Adicione uma em Ajustes > Contas do Claude.',
    );
    const view = toRowView('claude', claudeSignInStatus('Trabalho'));
    expect(view.message).toBe('Faça login de novo na conta Trabalho.');
    expect(view.actions.map((action) => action.label)).toEqual(['reauthenticate-claude', 'recheck', 'disconnect']);
    expect(toRowView('claude', { state: 'connected', account: 'Trabalho' }).summary).toBe('Conectado · Trabalho');
  });

  it('the status-specific message takes priority over the default one', () => {
    expect(toRowView('claude', errorStatus('claude-signin-required', 'Conclua o login')).message).toBe('Conclua o login');
  });

  it('the same row changes text with the language', () => {
    const status = claudeSignInStatus('Work');
    expect(toRowViewWith('claude', status, new Localizer('en')).message).toBe('Sign in to the Work account again.');
    expect(toRowViewWith('claude', status, new Localizer('es-MX')).message).toBe('Inicia sesión de nuevo en la cuenta Work.');
    expect(toRowViewWith('github', { state: 'connected', account: 'dev' }, new Localizer('en')).summary).toBe('Connected · dev');
  });

  it('status notes carry the argument (org, scopes) and win over the default message', () => {
    expect(toRowView('github', noteStatus('github-not-member', 'ask-invite', 'Mottu-ops')).message).toBe(
      'Peça o convite para a org Mottu-ops e clique em "Verificar de novo".',
    );
    expect(toRowView('github', noteStatus('github-missing-scope', 'missing-scopes', 'repo, read:org')).message).toBe(
      'Faltam: repo, read:org',
    );
    expect(toRowView('github', errorStatus('github-not-member')).message).toBe('Você não é membro da org Mottu-ops.');
  });
});
