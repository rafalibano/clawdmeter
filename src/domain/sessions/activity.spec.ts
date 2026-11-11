import { describe, expect, it } from 'vitest';
import { sessionActivity } from './activity';

describe('sessionActivity', () => {
  it('busy is active', () => {
    expect(sessionActivity({ status: 'busy' })).toBe('active');
  });

  it('idle, shell and unknown status are inactive', () => {
    expect(sessionActivity({ status: 'idle' })).toBe('inactive');
    expect(sessionActivity({ status: 'shell' })).toBe('inactive');
    expect(sessionActivity({ status: null })).toBe('inactive');
  });
});
