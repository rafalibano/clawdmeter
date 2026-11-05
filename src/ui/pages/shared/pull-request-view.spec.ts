import { describe, expect, it } from 'vitest';
import type { PullRequest } from '../../../domain/pull-requests';
import { Localizer } from '../../i18n';
import { badgesFor as badgesWith, slaFor } from './pull-request-view';

const PT = new Localizer('pt-BR');
const badgesFor = (pr: PullRequest) => badgesWith(pr, PT);

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
    expect(badges.map((badge) => badge.tone)).toEqual(['muted', 'bad', 'info', 'bad']);
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

describe('cores dos selos', () => {
  it('vermelho só para CI falhando e conflito; amarelo nunca vira selo de estado', () => {
    const all: PullRequest[] = [
      { ...BASE, ci: 'success', review: 'approved' },
      { ...BASE, ci: 'pending', review: 'review-required' },
      { ...BASE, ci: 'failure', review: 'changes-requested', merge: 'conflicting' },
    ];
    const red = all.flatMap((pr) => badgesFor(pr)).filter((badge) => badge.tone === 'bad');
    expect(red.map((badge) => badge.label)).toEqual(['✗ CI', 'Conflito']);
  });
});

describe('slaFor', () => {
  const DAY = 24 * 60 * 60_000;
  const NOW = 10 * DAY;

  it('classifica PR aberto pela idade desde a abertura', () => {
    expect(slaFor({ ...BASE, createdAt: NOW - 2 * DAY }, NOW)).toBe('fresh');
    expect(slaFor({ ...BASE, createdAt: NOW - 3 * DAY }, NOW)).toBe('attention');
    expect(slaFor({ ...BASE, createdAt: NOW - 7 * DAY }, NOW)).toBe('overdue');
  });

  it('PR mergeado ou fechado não tem SLA', () => {
    expect(slaFor({ ...BASE, state: 'merged', createdAt: 0 }, NOW)).toBeNull();
    expect(slaFor({ ...BASE, state: 'closed', createdAt: 0 }, NOW)).toBeNull();
  });
});
