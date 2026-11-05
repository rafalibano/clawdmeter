import { describe, expect, it } from 'vitest';
import { RateLimitedError } from '../../domain/rate-limit';
import { createFakeCommands, rejectWith } from '../testing/fakes';
import { AnthropicUsageGateway } from './anthropic-usage-gateway';

describe('AnthropicUsageGateway', () => {
  const RECORDED = {
    five_hour: { utilization: 41.0, resets_at: '2026-11-05T17:00:00.504132+00:00' },
    seven_day: { utilization: 18.0, resets_at: '2026-11-08T12:00:00.504150+00:00' },
    extra_usage: { is_enabled: false },
  };

  it('chama claude_usage_fetch sem argumentos e converte o JSON em snapshot', async () => {
    const { commands, calls } = createFakeCommands(() => RECORDED);
    const snapshot = await new AnthropicUsageGateway(commands).fetch();
    expect(calls).toEqual([{ command: 'claude_usage_fetch', args: undefined }]);
    expect(snapshot.fiveHour).toEqual({ utilization: 41, resetsAt: Date.parse('2026-11-05T17:00:00.504Z') });
    expect(snapshot.sevenDay?.utilization).toBe(18);
  });

  it('claude_expired vira problema de conexão do Claude', async () => {
    const { commands } = createFakeCommands(() => rejectWith('claude_expired', 'login do Claude expirado'));
    await expect(new AnthropicUsageGateway(commands).fetch()).rejects.toMatchObject({ problem: 'claude-expired' });
  });

  it('cofre negado e Claude Code ausente chegam tipados', async () => {
    const denied = createFakeCommands(() => rejectWith('keychain_denied', 'negado'));
    await expect(new AnthropicUsageGateway(denied.commands).fetch()).rejects.toMatchObject({ problem: 'keychain-denied' });
    const missing = createFakeCommands(() => rejectWith('claude_code_missing', 'sem credencial'));
    await expect(new AnthropicUsageGateway(missing.commands).fetch()).rejects.toMatchObject({
      problem: 'claude-code-missing',
    });
  });

  it('kind rate_limited vira RateLimitedError com o Retry-After em ms', async () => {
    const { commands } = createFakeCommands(() => rejectWith('rate_limited', 'limite', { retryAfterSecs: 120 }));
    const error = await new AnthropicUsageGateway(commands).fetch().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterMs).toBe(120_000);
  });

  it('rate_limited sem Retry-After não traz tempo', async () => {
    const { commands } = createFakeCommands(() => rejectWith('rate_limited', 'limite'));
    await expect(new AnthropicUsageGateway(commands).fetch()).rejects.toMatchObject({ retryAfterMs: null });
  });

  it.each([['429'], ['500'], ['503']])('erro HTTP %s genérico também vira RateLimitedError', async (status) => {
    const { commands } = createFakeCommands(() => rejectWith('http', `Anthropic respondeu ${status}`));
    await expect(new AnthropicUsageGateway(commands).fetch()).rejects.toBeInstanceOf(RateLimitedError);
  });

  it('erro HTTP 4xx comum mantém a mensagem', async () => {
    const { commands } = createFakeCommands(() => rejectWith('http', 'Anthropic respondeu 403'));
    await expect(new AnthropicUsageGateway(commands).fetch()).rejects.toThrow('Anthropic respondeu 403');
  });

  it('resposta sem janelas reconhecíveis falha', async () => {
    const { commands } = createFakeCommands(() => ({ surprise: true }));
    await expect(new AnthropicUsageGateway(commands).fetch()).rejects.toThrow('sem five_hour nem seven_day');
  });
});
