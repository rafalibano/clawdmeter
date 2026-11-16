import { describe, expect, it } from 'vitest';
import { RateLimitedError } from '../../domain/rate-limit';
import { createFakeCommands, rejectWith } from '../testing/fakes';
import { AnthropicUsageResetsGateway } from './anthropic-usage-resets-gateway';

const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

const BLOCK = {
  eligible: true,
  at_limit: false,
  exhausted: [],
  grants: [{ id: 'g1', type: 'weekly', resets_left: 1, resets_total: 1, ends_at: '2026-11-20T00:00:00Z', usable_now: true }],
};

describe('AnthropicUsageResetsGateway', () => {
  it('calls claude_usage_resets_fetch with the account and the client id and parses the grants', async () => {
    const { commands, calls } = createFakeCommands(() => BLOCK);
    const resets = await new AnthropicUsageResetsGateway(commands).fetch('account-1', CLIENT_ID);
    expect(calls).toEqual([{ command: 'claude_usage_resets_fetch', args: { accountId: 'account-1', clientId: CLIENT_ID } }]);
    expect(resets?.grants).toHaveLength(1);
    expect(resets?.grants[0]).toMatchObject({ id: 'g1', type: 'weekly', usableNow: true, clears: ['sevenDay'] });
  });

  it('an absent, ineligible or empty block is null, not an error', async () => {
    for (const body of [null, {}, { eligible: false, ineligible_reason: 'surface', grants: [] }, { eligible: true, grants: [] }, 'x']) {
      const { commands } = createFakeCommands(() => body);
      await expect(new AnthropicUsageResetsGateway(commands).fetch('account-1', CLIENT_ID)).resolves.toBeNull();
    }
  });

  it('a malformed grant is skipped instead of failing the block', async () => {
    const { commands } = createFakeCommands(() => ({ ...BLOCK, grants: [{ nope: true }, ...BLOCK.grants] }));
    const resets = await new AnthropicUsageResetsGateway(commands).fetch('account-1', CLIENT_ID);
    expect(resets?.grants.map((grant) => grant.id)).toEqual(['g1']);
  });

  it('kind rate_limited becomes RateLimitedError with the Retry-After in ms', async () => {
    const { commands } = createFakeCommands(() => rejectWith('rate_limited', 'limite', { retryAfterSecs: 90 }));
    const error = await new AnthropicUsageResetsGateway(commands).fetch('account-1', CLIENT_ID).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterMs).toBe(90_000);
  });

  it.each([['429'], ['503']])('an HTTP %s error becomes RateLimitedError', async (status) => {
    const { commands } = createFakeCommands(() => rejectWith('http', `Anthropic respondeu ${status}`));
    await expect(new AnthropicUsageResetsGateway(commands).fetch('account-1', CLIENT_ID)).rejects.toBeInstanceOf(RateLimitedError);
  });

  it('claude_signin_required and keychain failures keep their domain error', async () => {
    const signin = createFakeCommands(() => rejectWith('claude_signin_required', 'refresh rejected'));
    await expect(new AnthropicUsageResetsGateway(signin.commands).fetch('account-1', CLIENT_ID)).rejects.toMatchObject({
      problem: 'claude-signin-required',
    });
    const keychain = createFakeCommands(() => rejectWith('keychain', 'locked'));
    await expect(new AnthropicUsageResetsGateway(keychain.commands).fetch('account-1', CLIENT_ID)).rejects.toMatchObject({
      code: 'keychain-unavailable',
    });
  });
});
