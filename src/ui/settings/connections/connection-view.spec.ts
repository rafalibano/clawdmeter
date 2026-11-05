import { describe, expect, it } from 'vitest';
import { CONNECTION_PROBLEMS, errorStatus, noteStatus, type ConnectionId, type ConnectionStatus } from '../../../domain/connections';
import { Localizer } from '../../i18n';
import { toRowView as toRowViewWith } from './connection-view';

const PT = new Localizer('pt-BR');
const toRowView = (id: ConnectionId, status: ConnectionStatus, l: Localizer = PT) => toRowViewWith(id, status, l);

describe('toRowView', () => {
  it('conectado mostra a conta e oferece Desconectar', () => {
    const view = toRowView('github', { state: 'connected', account: 'dev' });
    expect(view).toMatchObject({ tone: 'ok', summary: 'Conectado · dev', busy: false });
    expect(view.actions.map((a) => a.label)).toEqual(['disconnect']);
  });

  it('desconectado oferece Conectar e mostra a dica', () => {
    const view = toRowView('microsoft', { state: 'disconnected', note: 'after-reset' });
    expect(view).toMatchObject({ tone: 'idle', message: 'Entre de novo com o código do GitHub ou cole um novo token.', signInOptions: false });
    expect(view.actions.map((a) => a.label)).toEqual(['connect']);
  });

  it('GitHub sem gh instalado: Instalar GitHub CLI e as alternativas pelo navegador e token', () => {
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

  it('GitHub com gh sem login: Conectar GitHub CLI e as alternativas', () => {
    const view = toRowView('github', {
      state: 'disconnected',
      note: 'github-cli-not-logged-in',
      cli: 'not-logged-in',
    });
    expect(view.message).toBe('Conecte o GitHub CLI ou entre pelo navegador com um código.');
    expect(view.actions.map((a) => a.label)).toEqual(['connect-github-cli']);
    expect(view.signInOptions).toBe(true);
  });

  it('GitHub conectado ou com erro não mostra as alternativas de entrada', () => {
    expect(toRowView('github', { state: 'connected', account: 'dev' }).signInOptions).toBe(false);
    expect(toRowView('github', errorStatus('github-unauthorized')).signInOptions).toBe(false);
  });

  it('verificando fica ocupado e sem botões', () => {
    expect(toRowView('claude', { state: 'checking' })).toMatchObject({ busy: true, tone: 'busy', actions: [] });
  });

  it('todo estado de erro mostra mensagem e um botão de conserto', () => {
    for (const problem of CONNECTION_PROBLEMS) {
      const view = toRowView('claude', errorStatus(problem));
      expect(view.tone).toBe('error');
      expect(view.message).toBeTruthy();
      expect(view.actions.some((action) => action.kind === 'fix')).toBe(true);
    }
  });

  it('notificações não verificáveis aparecem como "Não verificável", nunca como conectadas', () => {
    const view = toRowView('notifications', errorStatus('notifications-unverifiable'));
    expect(view).toMatchObject({ tone: 'error', summary: 'Não verificável' });
    expect(view.actions.find((action) => action.kind === 'fix')?.label).toBe('open-system-settings');
  });

  it('token vencido do Claude orienta a abrir o Claude Code ou refazer o login', () => {
    expect(toRowView('claude', errorStatus('claude-expired')).message).toBe(
      'Token vencido — abra o Claude Code para renová-lo ou refaça o login.',
    );
  });

  it('mensagem específica do status tem prioridade sobre a padrão', () => {
    expect(toRowView('claude', errorStatus('claude-expired', 'Conclua o login')).message).toBe('Conclua o login');
  });

  it('a mesma linha muda de texto com a língua', () => {
    const status = errorStatus('claude-expired');
    expect(toRowViewWith('claude', status, new Localizer('en')).message).toBe(
      'Token expired — open Claude Code to renew it or sign in again.',
    );
    expect(toRowViewWith('claude', status, new Localizer('es-MX')).message).toBe(
      'Token vencido — abre Claude Code para renovarlo o vuelve a iniciar sesión.',
    );
    expect(toRowViewWith('github', { state: 'connected', account: 'dev' }, new Localizer('en')).summary).toBe('Connected · dev');
  });

  it('notas do status levam o argumento (org, escopos) e vencem a mensagem padrão', () => {
    expect(toRowView('github', noteStatus('github-not-member', 'ask-invite', 'Mottu-ops')).message).toBe(
      'Peça o convite para a org Mottu-ops e clique em "Verificar de novo".',
    );
    expect(toRowView('github', noteStatus('github-missing-scope', 'missing-scopes', 'repo, read:org')).message).toBe(
      'Faltam: repo, read:org',
    );
    expect(toRowView('github', errorStatus('github-not-member')).message).toBe('Você não é membro da org Mottu-ops.');
  });
});
