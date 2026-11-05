import type { UsageGateway } from '../../application/ports';
import { ConnectionProblemError } from '../../domain/connections';
import { parseUsageResponse, type UsageSnapshot } from '../../domain/usage';
import type { FetchLike } from '../platform/tauri-fetch';

export const ANTHROPIC_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
export const ANTHROPIC_OAUTH_BETA = 'oauth-2025-04-20';

export class AnthropicUsageGateway implements UsageGateway {
  constructor(private readonly fetcher: FetchLike) {}

  async fetch(accessToken: string): Promise<UsageSnapshot> {
    const response = await this.fetcher(ANTHROPIC_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'anthropic-beta': ANTHROPIC_OAUTH_BETA,
        Accept: 'application/json',
      },
    });
    if (response.status === 401) throw new ConnectionProblemError('claude-expired');
    if (!response.ok) throw new Error(`Anthropic respondeu ${response.status} em /api/oauth/usage`);
    return parseUsageResponse(await response.json());
  }
}
