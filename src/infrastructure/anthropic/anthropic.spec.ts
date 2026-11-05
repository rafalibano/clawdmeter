import { describe, expect, it } from 'vitest';
import { createFakeFetch } from '../testing/fakes';
import { ANTHROPIC_USAGE_URL, AnthropicUsageGateway } from './anthropic-usage-gateway';

const RECORDED = {
  five_hour: { utilization: 41.0, resets_at: '2026-11-05T17:00:00.504132+00:00' },
  seven_day: { utilization: 18.0, resets_at: '2026-11-08T12:00:00.504150+00:00' },
  seven_day_oauth_apps: null,
  seven_day_opus: null,
  extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null, utilization: null },
};

describe('AnthropicUsageGateway', () => {
  it('chama o endpoint com Bearer e o header beta, sem nunca renovar o token', async () => {
    const { fetcher, requests } = createFakeFetch(() => ({ json: RECORDED }));
    await new AnthropicUsageGateway(fetcher).fetch('sk-ant-oat01-abc');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ url: ANTHROPIC_USAGE_URL, method: 'GET' });
    expect(requests[0]?.headers).toMatchObject({
      Authorization: 'Bearer sk-ant-oat01-abc',
      'anthropic-beta': 'oauth-2025-04-20',
    });
    expect(ANTHROPIC_USAGE_URL).toBe('https://api.anthropic.com/api/oauth/usage');
  });

  it('converte a resposta gravada em snapshot, ignorando campos extras', async () => {
    const { fetcher } = createFakeFetch(() => ({ json: RECORDED }));
    const snapshot = await new AnthropicUsageGateway(fetcher).fetch('t');
    expect(snapshot.fiveHour).toEqual({ utilization: 41, resetsAt: Date.parse('2026-11-05T17:00:00.504Z') });
    expect(snapshot.sevenDay?.utilization).toBe(18);
  });

  it('401 vira problema de conexão do Claude (sem refresh)', async () => {
    const { fetcher, requests } = createFakeFetch(() => ({ status: 401, json: { error: 'unauthorized' } }));
    await expect(new AnthropicUsageGateway(fetcher).fetch('t')).rejects.toMatchObject({ problem: 'claude-expired' });
    expect(requests).toHaveLength(1);
  });

  it('outros erros HTTP viram erro comum com o status', async () => {
    const { fetcher } = createFakeFetch(() => ({ status: 429 }));
    await expect(new AnthropicUsageGateway(fetcher).fetch('t')).rejects.toThrow('Anthropic respondeu 429');
  });

  it('resposta sem janelas reconhecíveis falha', async () => {
    const { fetcher } = createFakeFetch(() => ({ json: { surprise: true } }));
    await expect(new AnthropicUsageGateway(fetcher).fetch('t')).rejects.toThrow('sem five_hour nem seven_day');
  });
});
