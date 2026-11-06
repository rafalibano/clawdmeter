import { describe, expect, it } from 'vitest';
import { RateLimitedError } from '../../domain/rate-limit';
import { createFakeCommands, rejectWith } from '../testing/fakes';
import { AnthropicUsageGateway } from './anthropic-usage-gateway';

const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

describe('AnthropicUsageGateway', () => {
  const RECORDED = {
    five_hour: { utilization: 41.0, resets_at: '2026-11-05T17:00:00.504132+00:00' },
    seven_day: { utilization: 18.0, resets_at: '2026-11-08T12:00:00.504150+00:00' },
    extra_usage: { is_enabled: false },
  };

  it('calls claude_usage_fetch with the account and the client id and converts the JSON to a snapshot', async () => {
    const { commands, calls } = createFakeCommands(() => RECORDED);
    const snapshot = await new AnthropicUsageGateway(commands).fetch('account-1', CLIENT_ID);
    expect(calls).toEqual([{ command: 'claude_usage_fetch', args: { accountId: 'account-1', clientId: CLIENT_ID } }]);
    expect(snapshot.fiveHour).toEqual({ utilization: 41, resetsAt: Date.parse('2026-11-05T17:00:00.504Z') });
    expect(snapshot.sevenDay?.utilization).toBe(18);
  });

  it('claude_signin_required becomes a Claude connection problem', async () => {
    const { commands } = createFakeCommands(() => rejectWith('claude_signin_required', 'refresh rejected'));
    await expect(new AnthropicUsageGateway(commands).fetch('account-1', CLIENT_ID)).rejects.toMatchObject({
      problem: 'claude-signin-required',
    });
  });

  it('a keychain failure arrives as a generic storage error', async () => {
    const { commands } = createFakeCommands(() => rejectWith('keychain', 'locked'));
    await expect(new AnthropicUsageGateway(commands).fetch('account-1', CLIENT_ID)).rejects.toMatchObject({
      problem: 'unexpected',
      code: 'keychain-unavailable',
    });
  });

  it('kind rate_limited becomes RateLimitedError with the Retry-After in ms', async () => {
    const { commands } = createFakeCommands(() => rejectWith('rate_limited', 'limite', { retryAfterSecs: 120 }));
    const error = await new AnthropicUsageGateway(commands).fetch('account-1', CLIENT_ID).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterMs).toBe(120_000);
  });

  it('rate_limited without Retry-After carries no time', async () => {
    const { commands } = createFakeCommands(() => rejectWith('rate_limited', 'limite'));
    await expect(new AnthropicUsageGateway(commands).fetch('account-1', CLIENT_ID)).rejects.toMatchObject({ retryAfterMs: null });
  });

  it.each([['429'], ['500'], ['503']])('a generic HTTP %s error also becomes RateLimitedError', async (status) => {
    const { commands } = createFakeCommands(() => rejectWith('http', `Anthropic respondeu ${status}`));
    await expect(new AnthropicUsageGateway(commands).fetch('account-1', CLIENT_ID)).rejects.toBeInstanceOf(RateLimitedError);
  });

  it('a plain HTTP 4xx error keeps the message', async () => {
    const { commands } = createFakeCommands(() => rejectWith('http', 'Anthropic respondeu 403'));
    await expect(new AnthropicUsageGateway(commands).fetch('account-1', CLIENT_ID)).rejects.toThrow('Anthropic respondeu 403');
  });

  it('a response without recognizable windows fails', async () => {
    const { commands } = createFakeCommands(() => ({ surprise: true }));
    await expect(new AnthropicUsageGateway(commands).fetch('account-1', CLIENT_ID)).rejects.toThrow('neither five_hour nor seven_day');
  });
});
