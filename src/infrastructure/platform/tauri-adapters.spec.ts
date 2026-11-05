import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SECRET_KEYS } from '../../application/ports';
import { CodedError } from '../../domain/coded-error';
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
import { FakeTranslator } from '../../application/testing/fake-translator';
import { TauriUsageIndicator } from './tauri-usage-indicator';

describe('toDomainError', () => {
  it('maps keychain_denied and claude_code_missing to connection problems', () => {
    expect(toDomainError({ kind: 'keychain_denied', message: 'negado' })).toMatchObject({
      problem: 'keychain-denied',
      message: 'negado',
    });
    expect(toDomainError({ kind: 'claude_code_missing', message: 'x' })).toBeInstanceOf(ConnectionProblemError);
  });

  it('claude_expired becomes a connection problem and too_many_processes becomes a coded error', () => {
    expect(toDomainError({ kind: 'claude_expired', message: 'x' })).toMatchObject({ problem: 'claude-expired' });
    const busy = toDomainError({ kind: 'too_many_processes', message: 'limit of 4 simultaneous processes reached' });
    expect(busy).toBeInstanceOf(CodedError);
    expect(busy).toMatchObject({ code: 'too-many-processes' });
  });

  it('other kinds become PlatformCommandError with the kind preserved', () => {
    const error = toDomainError({ kind: 'timeout', message: 'demorou' });
    expect(error).toBeInstanceOf(PlatformCommandError);
    expect((error as PlatformCommandError).kind).toBe('timeout');
  });

  it('errors that do not come from Rust pass through', () => {
    expect(toDomainError(new Error('boom')).message).toBe('boom');
    expect(toDomainError('text').message).toBe('text');
  });
});

describe('TauriSecretStore', () => {
  it('talks to the secret_* commands', async () => {
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

  it('propagates a denied keychain as a connection problem', async () => {
    const { commands } = createFakeCommands(() => rejectWith('keychain_denied', 'negado'));
    await expect(new TauriSecretStore(commands).get('k')).rejects.toMatchObject({ problem: 'keychain-denied' });
  });
});

describe('TauriClaudeCredentialSource', () => {
  it('reads only the credential status in Rust: the token never crosses the IPC', async () => {
    const recorded = { expiresAt: 1767225600000, subscriptionType: 'max' };
    const { commands, calls } = createFakeCommands(() => recorded);
    expect(await new TauriClaudeCredentialSource(commands).read()).toEqual(recorded);
    expect(calls).toEqual([{ command: 'claude_credentials_status', args: undefined }]);
    expect(JSON.stringify(recorded)).not.toMatch(/token|refresh/i);
  });

  it('missing Claude Code becomes a typed problem', async () => {
    const { commands } = createFakeCommands(() => rejectWith('claude_code_missing', 'no credential'));
    await expect(new TauriClaudeCredentialSource(commands).read()).rejects.toMatchObject({
      problem: 'claude-code-missing',
    });
  });
});

describe('vault keys', () => {
  it('SECRET_KEYS is exactly the fixed list Rust accepts (secrets.rs)', () => {
    const source = readFileSync(resolve(__dirname, '../../../src-tauri/src/commands/secrets.rs'), 'utf8');
    const block = /ALLOWED_SECRET_KEYS: &\[&str\] = &\[([^\]]*)\]/.exec(source)?.[1] ?? '';
    const rust = [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]).sort();
    expect(rust.length).toBeGreaterThan(0);
    expect(Object.values(SECRET_KEYS).sort()).toEqual(rust);
  });
});

describe('system actions', () => {
  it('open URL, settings and terminal through the allowed commands', async () => {
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
  it('forwards program, arguments and timeout', async () => {
    const { commands, calls } = createFakeCommands(() => ({ code: 0, stdout: 'ok', stderr: '' }));
    const output = await new TauriProcessRunner(commands).run('gh', ['auth', 'token'], 5_000);
    expect(output.stdout).toBe('ok');
    expect(calls[0]).toEqual({ command: 'process_run', args: { program: 'gh', args: ['auth', 'token'], timeoutMs: 5_000 } });
  });
});

describe('TauriOAuthLoopback', () => {
  it('listens, waits for the code and cancels', async () => {
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
  it('sends title and body through the plugin', async () => {
    const sent: Array<{ title: string; body: string }> = [];
    await new TauriNotifier({ send: (notice) => sent.push(notice) }).notify({ title: 'Acabativa finished', body: 'US$ 0.12 · 5s' });
    expect(sent).toEqual([{ title: 'Acabativa finished', body: 'US$ 0.12 · 5s' }]);
  });
});

describe('TauriNotificationPermission', () => {
  const plugin = (result: 'granted' | 'denied' | 'default' = 'granted') => ({ request: async () => result });

  it.each(['granted', 'denied', 'prompt', 'unknown'] as const)('forwards the %s state from the Rust command', async (state) => {
    const { commands, calls } = createFakeCommands(() => state);
    expect(await new TauriNotificationPermission(commands, plugin()).status()).toBe(state);
    expect(calls[0]?.command).toBe('notification_permission_state');
  });

  it('an unknown value from Rust becomes "unknown", never "granted"', async () => {
    const { commands } = createFakeCommands(() => 'qualquer-coisa');
    expect(await new TauriNotificationPermission(commands, plugin()).status()).toBe('unknown');
    expect(toPermissionState(undefined)).toBe('unknown');
  });

  it('a command failure becomes "unknown"', async () => {
    const { commands } = createFakeCommands(() => rejectWith('io', 'falhou'));
    expect(await new TauriNotificationPermission(commands, plugin()).status()).toBe('unknown');
  });

  it('the plugin always returning granted on desktop does not hide the system block', async () => {
    const { commands } = createFakeCommands(() => 'denied');
    const permission = new TauriNotificationPermission(commands, plugin('granted'));
    expect(await permission.request()).toBe('denied');
  });
});

describe('TauriUsageIndicator', () => {
  const NOW = Date.UTC(2026, 10, 5, 12, 0);

  it('sends the percentages and the tooltip to tray_set_usage', async () => {
    const { commands, calls } = createFakeCommands(() => undefined);
    await new TauriUsageIndicator(commands, new FakeTranslator()).update(
      {
        fiveHour: { utilization: 24, resetsAt: NOW + 3_600_000 },
        sevenDay: { utilization: 51, resetsAt: null },
      },
      NOW,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe('tray_set_usage');
    expect(calls[0]?.args).toMatchObject({ fiveHour: 24, sevenDay: 51 });
    expect(String(calls[0]?.args?.['tooltip'])).toMatch(/^5h: 24% · \S+ \d{2}:\d{2} \| 7d: 51%$/);
  });

  it('a missing window or null snapshot become null (bar without data)', async () => {
    const { commands, calls } = createFakeCommands(() => undefined);
    const indicator = new TauriUsageIndicator(commands, new FakeTranslator());
    await indicator.update({ fiveHour: null, sevenDay: { utilization: 5, resetsAt: null } }, NOW);
    await indicator.update(null, NOW);
    expect(calls[0]?.args).toMatchObject({ fiveHour: null, sevenDay: 5 });
    expect(calls[1]?.args).toEqual({ fiveHour: null, sevenDay: null, tooltip: 'ClawdMeter · usage unavailable' });
  });

  it('propagates the command error', async () => {
    const { commands } = createFakeCommands(() => rejectWith('tray', 'no tray'));
    await expect(new TauriUsageIndicator(commands, new FakeTranslator()).update(null, NOW)).rejects.toMatchObject({ kind: 'tray' });
  });
});
