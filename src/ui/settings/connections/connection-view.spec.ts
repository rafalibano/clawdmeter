import { describe, expect, it } from 'vitest';
import { CONNECTION_PROBLEMS, errorStatus } from '../../../domain/connections';
import { toRowView } from './connection-view';

describe('toRowView', () => {
  it('conectado mostra a conta e oferece Desconectar', () => {
    const view = toRowView('github', { state: 'connected', account: 'dev' });
    expect(view).toMatchObject({ tone: 'ok', summary: 'Conectado · dev', busy: false });
    expect(view.actions.map((a) => a.label)).toEqual(['Desconectar']);
  });

  it('desconectado oferece Conectar e mostra a dica', () => {
    const view = toRowView('github', { state: 'disconnected', hint: 'Use o código' });
    expect(view).toMatchObject({ tone: 'idle', message: 'Use o código' });
    expect(view.actions.map((a) => a.label)).toEqual(['Conectar']);
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

  it('mensagem específica do status tem prioridade sobre a padrão', () => {
    expect(toRowView('claude', errorStatus('claude-expired', 'Conclua o login')).message).toBe('Conclua o login');
  });
});
