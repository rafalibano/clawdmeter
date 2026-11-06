import type { PullRequestGateway } from '../../application/ports';
import { ConnectionProblemError } from '../../domain/connections';
import type { PullRequest, PullRequestList } from '../../domain/pull-requests';
import type { DemoWorld } from './demo-world';

const DEMO_LATENCY_MS = 350;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function pr(
  id: number,
  repo: string,
  title: string,
  author: string,
  ageMs: number,
  overrides: Partial<PullRequest> = {},
): PullRequest {
  const now = Date.now();
  return {
    id: `PR_demo_${id}`,
    number: id,
    title,
    url: `https://github.com/${repo}/pull/${id}`,
    repo,
    author,
    state: 'open',
    isDraft: false,
    ci: 'success',
    review: 'none',
    merge: 'mergeable',
    createdAt: now - ageMs,
    updatedAt: now - ageMs / 2,
    ...overrides,
  };
}

function demoData(): Record<string, PullRequest[]> {
  return {
    mine: [
      pr(101, 'acme/api', 'feat: endpoint de saldo por conta', 'dev-demo', 2 * DAY_MS, { review: 'approved' }),
      pr(102, 'acme/api', 'fix: timeout na consulta de extrato', 'dev-demo', 5 * HOUR_MS, { ci: 'pending', review: 'review-required' }),
      pr(87, 'acme/web', 'refactor: componente de tabela', 'dev-demo', 6 * DAY_MS, { ci: 'failure', merge: 'conflicting', review: 'changes-requested' }),
      pr(34, 'acme/mobile', 'wip: nova tela de onboarding', 'dev-demo', 3 * HOUR_MS, { isDraft: true, ci: 'none' }),
      pr(12, 'acme/k8s', 'chore: scale up api replicas', 'dev-demo', 1 * DAY_MS, { review: 'review-required' }),
    ],
    assigned: [
      pr(220, 'acme/api', 'feat: webhook de conciliação', 'ana-dev', 1 * DAY_MS, { review: 'review-required' }),
      pr(61, 'acme/web', 'fix: layout do extrato no mobile', 'bruno-dev', 3 * DAY_MS, { ci: 'pending', review: 'changes-requested' }),
      pr(15, 'acme/k8s', 'chore: ajuste de HPA do worker', 'carla-dev', 5 * HOUR_MS),
    ],
    toReview: [
      pr(210, 'acme/api', 'feat: configuration cache', 'ana-dev', 4 * HOUR_MS, { review: 'review-required' }),
      pr(55, 'acme/web', 'fix: focus in the confirmation modal', 'bruno-dev', 1 * DAY_MS, { ci: 'failure', review: 'review-required' }),
      pr(13, 'acme/k8s-prod', 'chore: imagem da api v1.4.2', 'ana-dev', 2 * HOUR_MS, { review: 'review-required' }),
      pr(14, 'acme/k8s', 'chore: worker memory limits', 'carla-dev', 3 * DAY_MS, { review: 'review-required' }),
    ],
    reviewedOpen: [
      pr(205, 'acme/api', 'feat: cursor pagination', 'bruno-dev', 2 * DAY_MS, { review: 'approved' }),
      pr(52, 'acme/web', 'feat: tema escuro', 'carla-dev', 4 * DAY_MS, { review: 'changes-requested', ci: 'pending' }),
    ],
    reviewedRecent: [
      pr(199, 'acme/api', 'fix: arredondamento de valores', 'ana-dev', 9 * DAY_MS, { state: 'merged', review: 'approved' }),
      pr(10, 'acme/k8s-prod', 'chore: imagem da api v1.4.1', 'bruno-dev', 12 * DAY_MS, { state: 'merged', review: 'approved' }),
      pr(9, 'acme/k8s', 'chore: novo cronjob de limpeza', 'carla-dev', 15 * DAY_MS, { state: 'merged', review: 'approved' }),
    ],
  };
}

export class DemoPullRequestGateway implements PullRequestGateway {
  constructor(private readonly world: DemoWorld) {}

  async search<K extends string>(
    _token: string,
    queries: Record<K, string>,
    limit: number,
  ): Promise<Record<K, PullRequestList>> {
    await pause(DEMO_LATENCY_MS);
    const { github } = this.world;
    if (github.unauthorized) throw new ConnectionProblemError('github-unauthorized');
    if (github.missingScope) throw new ConnectionProblemError('github-missing-scope');
    if (github.orgAccess !== 'ok') throw new ConnectionProblemError('github-org-access');
    const data = demoData();
    const result = {} as Record<K, PullRequestList>;
    for (const key of Object.keys(queries) as K[]) {
      const all = data[key] ?? [];
      result[key] = { items: all.slice(0, limit), total: all.length };
    }
    return result;
  }
}
