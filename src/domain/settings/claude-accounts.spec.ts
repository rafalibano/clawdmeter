import { describe, expect, it } from 'vitest';
import { DEFAULT_CLAUDE_OAUTH_CLIENT_ID, defaultClaudeSettings, effectiveClaudeClientId } from './claude-accounts';

const CUSTOM = '11111111-2222-4333-8444-555555555555';

describe('effectiveClaudeClientId', () => {
  it('is the default client id while useDefaultClientId is on, even with a custom id kept', () => {
    expect(effectiveClaudeClientId(defaultClaudeSettings())).toBe(DEFAULT_CLAUDE_OAUTH_CLIENT_ID);
    expect(effectiveClaudeClientId({ useDefaultClientId: true, clientId: CUSTOM })).toBe(DEFAULT_CLAUDE_OAUTH_CLIENT_ID);
  });

  it('is the custom id when the default is off', () => {
    expect(effectiveClaudeClientId({ useDefaultClientId: false, clientId: CUSTOM })).toBe(CUSTOM);
  });

  it('never sends an invalid or empty custom id', () => {
    for (const clientId of ['', 'not-a-uuid']) {
      expect(effectiveClaudeClientId({ useDefaultClientId: false, clientId })).toBe(DEFAULT_CLAUDE_OAUTH_CLIENT_ID);
    }
  });
});
