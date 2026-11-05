import { describe, expect, it } from 'vitest';
import { CONNECTION_PROBLEMS, GITHUB_CLI_HINTS, errorStatus } from '../../../domain/connections';
import { toRowView } from './connection-view';

describe('toRowView', () => {
  it('conectado mostra a conta e oferece Desconectar', () => {
    const view = toRowView('github', { state: 'connected', account: 'dev' });
    expect(view).toMatchObject({ tone: 'ok', summary: 'Conectado · dev', busy: false });
    expect(view.actions.map((a) => a.label)).toEqual(['Desconectar']);
  });

  it('desconectado oferece Conectar e mostra a dica', () => {
    const view = toRowView('microsoft', { state: 'disconnected', hint: 'Use o código' });
    expect(view).toMatchObject({ tone: 'idle', message: 'Use o código', signInOptions: false });
    expect(view.actions.map((a) => a.label)).toEqual(['Conectar']);
  });

  it('GitHub sem gh instalado: Instalar GitHub CLI e as alternativas pelo navegador e token', () => {
    const view = toRowView('github', {
      state: 'disconnected',
      hint: GITHUB_CLI_HINTS['not-installed'],
      cli: 'not-installed',
    });
    expect(view.message).toBe(
      'GitHub CLI não encontrado. Instale e conecte o GitHub CLI, ou entre pelo navegador com um código.',
    );
    expect(view.actions.map((a) => a.label)).toEqual(['Instalar GitHub CLI']);
    expect(view.signInOptions).toBe(true);
  });

  it('GitHub com gh sem login: Conectar GitHub CLI e as alternativas', () => {
    const view = toRowView('github', {
      state: 'disconnected',
      hint: GITHUB_CLI_HINTS['not-logged-in'],
      cli: 'not-logged-in',
    });
    expect(view.message).toBe('Conecte o GitHub CLI ou entre pelo navegador com um código.');
    expect(view.actions.map((a) => a.label)).toEqual(['Conectar GitHub CLI']);
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
    expect(view.actions.find((action) => action.kind === 'fix')?.label).toBe('Abrir ajustes do sistema');
  });

  it('token vencido do Claude orienta a abrir o Claude Code ou refazer o login', () => {
    expect(toRowView('claude', errorStatus('claude-expired')).message).toBe(
      'Token vencido — abra o Claude Code para renová-lo ou refaça o login.',
    );
  });

  it('mensagem específica do status tem prioridade sobre a padrão', () => {
    expect(toRowView('claude', errorStatus('claude-expired', 'Conclua o login')).message).toBe('Conclua o login');
  });
});
