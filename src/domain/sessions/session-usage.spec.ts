import { describe, expect, it } from 'vitest';
import { contextShare, contextWindow, shortModel, type SessionUsage } from './session-usage';

function usage(overrides: Partial<SessionUsage> = {}): SessionUsage {
  return {
    model: 'claude-opus-5-5',
    contextTokens: 250_000,
    longContext: false,
    inputTokens: 10,
    outputTokens: 20,
    cacheReadTokens: 300,
    cacheCreationTokens: 40,
    subagents: [],
    ...overrides,
  };
}

describe('contextWindow', () => {
  it('1M for the current families and 200K for the older Claude 4 and 3 models', () => {
    for (const model of [
      'claude-fable-5',
      'claude-mythos-5',
      'claude-opus-5-5',
      'claude-opus-4-6',
      'claude-opus-4-8',
      'claude-sonnet-5-5',
      'claude-sonnet-4-6',
      'claude-haiku-5-5',
    ]) {
      expect(contextWindow(model, false), model).toBe(1_000_000);
    }
    for (const model of ['claude-opus-4-5-20251101', 'claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-3-7-sonnet-latest']) {
      expect(contextWindow(model, false), model).toBe(200_000);
    }
  });

  it('the 1M beta wins over the table; unknown or missing model has no window', () => {
    expect(contextWindow('claude-sonnet-4-5', true)).toBe(1_000_000);
    expect(contextWindow(null, true)).toBe(1_000_000);
    expect(contextWindow('gpt-x', false)).toBeNull();
    expect(contextWindow(null, false)).toBeNull();
  });
});

describe('contextShare', () => {
  it('divides the context of the last reply by the window and caps at 100%', () => {
    expect(contextShare(usage())).toBe(0.25);
    expect(contextShare(usage({ model: 'claude-haiku-4-5', contextTokens: 250_000 }))).toBe(1);
  });

  it('without a known window or without context there is no share', () => {
    expect(contextShare(usage({ model: 'local-model' }))).toBeNull();
    expect(contextShare(usage({ contextTokens: null }))).toBeNull();
  });
});

describe('shortModel', () => {
  it('drops the claude- prefix and keeps other names as they are', () => {
    expect(shortModel('claude-opus-5-5')).toBe('opus-5-5');
    expect(shortModel('sonnet')).toBe('sonnet');
    expect(shortModel(null)).toBeNull();
  });
});
