import { describe, expect, it } from 'vitest';
import { createFakeCommands, rejectWith } from '../testing/fakes';
import { PlatformCommandError } from './tauri-commands';
import { TauriSessionUsageReader, toSessionUsage } from './tauri-session-usage-reader';

const REPLY = {
  model: 'claude-opus-5-5',
  contextTokens: 412_000,
  longContext: true,
  inputTokens: 10,
  outputTokens: 20,
  cacheReadTokens: 300,
  cacheCreationTokens: 40,
  subagents: [{ id: 'agent-a', agentType: 'Explore', model: 'claude-haiku-5-5', startedAt: '2026-11-10T15:00:00.000Z' }],
};

describe('toSessionUsage', () => {
  it('reads the numbers, the model and the subagents with their start as epoch ms', () => {
    expect(toSessionUsage(REPLY)).toEqual({
      ...REPLY,
      subagents: [{ id: 'agent-a', agentType: 'Explore', model: 'claude-haiku-5-5', startedAt: Date.parse('2026-11-10T15:00:00.000Z') }],
    });
  });

  it('null or a non-object reply means no usage', () => {
    expect(toSessionUsage(null)).toBeNull();
    expect(toSessionUsage('x')).toBeNull();
  });

  it('malformed fields fall back to empty values and subagents without an id are dropped', () => {
    expect(
      toSessionUsage({
        model: '',
        contextTokens: 'big',
        longContext: 'yes',
        inputTokens: -1,
        outputTokens: Number.NaN,
        subagents: [null, { agentType: 'x' }, { id: 'agent-b', agentType: 3, startedAt: 'not a date' }],
      }),
    ).toEqual({
      model: null,
      contextTokens: null,
      longContext: false,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      subagents: [{ id: 'agent-b', agentType: null, model: null, startedAt: null }],
    });
  });
});

describe('TauriSessionUsageReader', () => {
  it('calls session_usage with the session id and folder', async () => {
    const { commands, calls } = createFakeCommands(() => REPLY);
    const usage = await new TauriSessionUsageReader(commands).read('s-1', '/work/app');
    expect(usage?.model).toBe('claude-opus-5-5');
    expect(calls).toEqual([{ command: 'session_usage', args: { sessionId: 's-1', cwd: '/work/app' } }]);
  });

  it('a missing transcript is null and a Rust error propagates', async () => {
    expect(await new TauriSessionUsageReader(createFakeCommands(() => null).commands).read('s', '/w')).toBeNull();
    const failing = new TauriSessionUsageReader(createFakeCommands(() => rejectWith('invalid_argument', 'invalid session id')).commands);
    await expect(failing.read('s', '/w')).rejects.toBeInstanceOf(PlatformCommandError);
  });
});
