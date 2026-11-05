import { describe, expect, it } from 'vitest';
import { ConnectionProblemError } from '../../domain/connections';
import { createFakeCommands, rejectWith } from '../testing/fakes';
import { PlatformCommandError, toDomainError } from './tauri-commands';
import { TauriClaudeCredentialSource } from './tauri-claude-credential-source';
import { TauriNotificationPermission, toPermissionState } from './tauri-notification-permission';
import { TauriNotifier } from './tauri-notifier';
import { TauriOAuthLoopback } from './tauri-oauth-loopback';
import { TauriProcessRunner } from './tauri-process-runner';
import { TauriSecretStore } from './tauri-secret-store';
import { TauriSystemSettings, TauriTerminalLauncher, TauriUrlOpener } from './tauri-system-actions';
import { TauriUsageIndicator } from './tauri-usage-indicator';

describe('toDomainError', () => {
  it('mapeia keychain_denied e claude_code_missing para problemas de conexão', () => {
    expect(toDomainError({ kind: 'keychain_denied', message: 'negado' })).toMatchObject({
      problem: 'keychain-denied',
      message: 'negado',
    });
    expect(toDomainError({ kind: 'claude_code_missing', message: 'x' })).toBeInstanceOf(ConnectionProblemError);
  });

  it('demais kinds viram PlatformCommandError com o kind preservado', () => {
    const error = toDomainError({ kind: 'timeout', message: 'demorou' });
    expect(error).toBeInstanceOf(PlatformCommandError);
    expect((error as PlatformCommandError).kind).toBe('timeout');
  });

  it('erros que não vêm do Rust passam adiante', () => {
    expect(toDomainError(new Error('boom')).message).toBe('boom');
    expect(toDomainError('texto').message).toBe('texto');
  });
});

describe('TauriSecretStore', () => {
  it('fala com os commands secret_*', async () => {
    const { commands, calls } = createFakeCommands((command) => (command === 'secret_get' ? 'valor' : undefined));
    const store = new TauriSecretStore(commands);
    expect(await store.get('k')).toBe('valor');
    await store.set('k', 'v');
    await store.delete('k');
    expect(calls).toEqual([
      { command: 'secret_get', args: { key: 'k' } },
      { command: 'secret_set', args: { key: 'k', value: 'v' } },
      { command: 'secret_delete', args: { key: 'k' } },
    ]);
  });

  it('propaga keychain negado como problema de conexão', async () => {
    const { commands } = createFakeCommands(() => rejectWith('keychain_denied', 'negado'));
    await expect(new TauriSecretStore(commands).get('k')).rejects.toMatchObject({ problem: 'keychain-denied' });
  });
});

describe('TauriClaudeCredentialSource', () => {
  it('devolve a credencial gravada do Rust (sem refresh token)', async () => {
    const recorded = { accessToken: 'sk-ant-oat01-abc', expiresAt: 1767225600000, subscriptionType: 'max' };
    const { commands, calls } = createFakeCommands(() => recorded);
    expect(await new TauriClaudeCredentialSource(commands).read()).toEqual(recorded);
    expect(calls[0]?.command).toBe('claude_credentials_read');
    expect(JSON.stringify(recorded)).not.toContain('refresh');
  });

  it('Claude Code ausente vira problema tipado', async () => {
    const { commands } = createFakeCommands(() => rejectWith('claude_code_missing', 'sem credencial'));
    await expect(new TauriClaudeCredentialSource(commands).read()).rejects.toMatchObject({
      problem: 'claude-code-missing',
    });
  });
});

describe('ações de sistema', () => {
  it('abrem URL, ajustes e terminal pelos commands permitidos', async () => {
    const { commands, calls } = createFakeCommands(() => undefined);
    await new TauriUrlOpener(commands).open('https://example.com');
    await new TauriSystemSettings(commands).openNotifications();
    await new TauriTerminalLauncher(commands).run({ program: 'claude', args: ['/login'] });
    expect(calls).toEqual([
      { command: 'open_url', args: { url: 'https://example.com' } },
      { command: 'open_system_settings', args: { pane: 'notifications' } },
      { command: 'terminal_run', args: { program: 'claude', args: ['/login'], cwd: null } },
    ]);
  });
});

describe('TauriProcessRunner', () => {
  it('repassa programa, argumentos e timeout', async () => {
    const { commands, calls } = createFakeCommands(() => ({ code: 0, stdout: 'ok', stderr: '' }));
    const output = await new TauriProcessRunner(commands).run('gh', ['auth', 'token'], 5_000);
    expect(output.stdout).toBe('ok');
    expect(calls[0]).toEqual({ command: 'process_run', args: { program: 'gh', args: ['auth', 'token'], timeoutMs: 5_000 } });
  });
});

describe('TauriOAuthLoopback', () => {
  it('escuta, espera o code e cancela', async () => {
    const { commands, calls } = createFakeCommands((command) => {
      if (command === 'oauth_loopback_listen') return { id: '1', port: 53124 };
      if (command === 'oauth_loopback_wait') return { code: 'the-code' };
      return undefined;
    });
    const loopback = new TauriOAuthLoopback(commands);
    expect(await loopback.listen()).toEqual({ id: '1', port: 53124 });
    expect(await loopback.waitForCode('1', 'st', 1000)).toBe('the-code');
    await loopback.cancel('1');
    expect(calls.map((call) => call.command)).toEqual([
      'oauth_loopback_listen',
      'oauth_loopback_wait',
      'oauth_loopback_cancel',
    ]);
    expect(calls[1]?.args).toEqual({ id: '1', expectedState: 'st', timeoutMs: 1000 });
  });
});

describe('TauriNotifier', () => {
  it('envia título e corpo pelo plugin', async () => {
    const sent: Array<{ title: string; body: string }> = [];
    await new TauriNotifier({ send: (notice) => sent.push(notice) }).notify({ title: 'Acabativa concluída', body: 'US$ 0.12 · 5s' });
    expect(sent).toEqual([{ title: 'Acabativa concluída', body: 'US$ 0.12 · 5s' }]);
  });
});

describe('TauriNotificationPermission', () => {
  const plugin = (result: 'granted' | 'denied' | 'default' = 'granted') => ({ request: async () => result });

  it.each(['granted', 'denied', 'prompt', 'unknown'] as const)('repassa o estado %s do command Rust', async (state) => {
    const { commands, calls } = createFakeCommands(() => state);
    expect(await new TauriNotificationPermission(commands, plugin()).status()).toBe(state);
    expect(calls[0]?.command).toBe('notification_permission_state');
  });

  it('valor desconhecido do Rust vira "unknown", nunca "granted"', async () => {
    const { commands } = createFakeCommands(() => 'qualquer-coisa');
    expect(await new TauriNotificationPermission(commands, plugin()).status()).toBe('unknown');
    expect(toPermissionState(undefined)).toBe('unknown');
  });

  it('falha do command vira "unknown"', async () => {
    const { commands } = createFakeCommands(() => rejectWith('io', 'falhou'));
    expect(await new TauriNotificationPermission(commands, plugin()).status()).toBe('unknown');
  });

  it('o plugin sempre devolver granted no desktop não esconde o bloqueio do sistema', async () => {
    const { commands } = createFakeCommands(() => 'denied');
    const permission = new TauriNotificationPermission(commands, plugin('granted'));
    expect(await permission.request()).toBe('denied');
  });
});

describe('TauriUsageIndicator', () => {
  const NOW = Date.UTC(2026, 10, 5, 12, 0);

  it('manda os percentuais e o tooltip para tray_set_usage', async () => {
    const { commands, calls } = createFakeCommands(() => undefined);
    await new TauriUsageIndicator(commands).update(
      {
        fiveHour: { utilization: 24, resetsAt: NOW + 3_600_000 },
        sevenDay: { utilization: 51, resetsAt: null },
      },
      NOW,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe('tray_set_usage');
    expect(calls[0]?.args).toMatchObject({ fiveHour: 24, sevenDay: 51 });
    expect(String(calls[0]?.args?.['tooltip'])).toMatch(/^5h: 24% · reseta \d{2}:\d{2} \| 7d: 51%$/);
  });

  it('janela ausente ou snapshot nulo viram null (barra sem dado)', async () => {
    const { commands, calls } = createFakeCommands(() => undefined);
    const indicator = new TauriUsageIndicator(commands);
    await indicator.update({ fiveHour: null, sevenDay: { utilization: 5, resetsAt: null } }, NOW);
    await indicator.update(null, NOW);
    expect(calls[0]?.args).toMatchObject({ fiveHour: null, sevenDay: 5 });
    expect(calls[1]?.args).toEqual({ fiveHour: null, sevenDay: null, tooltip: 'Dev Pulse · usage indisponível' });
  });

  it('propaga o erro do command', async () => {
    const { commands } = createFakeCommands(() => rejectWith('io', 'sem bandeja'));
    await expect(new TauriUsageIndicator(commands).update(null, NOW)).rejects.toMatchObject({ kind: 'io' });
  });
});
