import { describe, expect, it } from 'vitest';
import type { PullRequest } from '../../../domain/pull-requests';
import { badgesFor } from './pull-request-view';

const BASE: PullRequest = {
  id: 'a',
  number: 1,
  title: 't',
  url: 'https://github.com/acme/api/pull/1',
  repo: 'acme/api',
  author: 'ana',
  state: 'open',
  isDraft: false,
  ci: 'none',
  review: 'none',
  merge: 'unknown',
  createdAt: 0,
  updatedAt: 0,
};

describe('badgesFor', () => {
  it('PR sem informação não tem selos', () => {
    expect(badgesFor(BASE)).toEqual([]);
  });

  it('mostra rascunho, CI, decisão de review e conflito', () => {
    const badges = badgesFor({ ...BASE, isDraft: true, ci: 'failure', review: 'changes-requested', merge: 'conflicting' });
    expect(badges.map((badge) => badge.label)).toEqual(['Rascunho', '✗ CI', 'Mudanças pedidas', 'Conflito']);
    expect(badges.map((badge) => badge.tone)).toEqual(['muted', 'bad', 'bad', 'bad']);
  });

  it('cobre os estados de CI e de review', () => {
    expect(badgesFor({ ...BASE, ci: 'success', review: 'approved' }).map((badge) => badge.label)).toEqual(['✓ CI', 'Aprovado']);
    expect(badgesFor({ ...BASE, ci: 'pending', review: 'review-required' }).map((badge) => badge.label)).toEqual([
      '… CI',
      'Aguardando review',
    ]);
  });

  it('PR já encerrado mostra o estado e esconde a decisão de review', () => {
    expect(badgesFor({ ...BASE, state: 'merged', review: 'approved' }).map((badge) => badge.label)).toEqual(['Mergeado']);
    expect(badgesFor({ ...BASE, state: 'closed' }).map((badge) => badge.label)).toEqual(['Fechado']);
  });
});
