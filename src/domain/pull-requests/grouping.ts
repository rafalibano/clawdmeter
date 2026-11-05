import type { PullRequest } from './pull-request';

export const DEPLOY_REPOS: readonly string[] = ['k8s', 'k8s-prod'];
export const DEPLOY_GROUP_KEY = '@deploy';

export interface PullRequestGroup {
  key: string;
  title: string;
  collapsedByDefault: boolean;
  items: PullRequest[];
}

export function repoName(repo: string): string {
  return repo.split('/').pop() ?? repo;
}

export function isDeployRepo(repo: string): boolean {
  return DEPLOY_REPOS.includes(repoName(repo));
}

export function mergeUnique(...lists: readonly (readonly PullRequest[])[]): PullRequest[] {
  const byId = new Map<string, PullRequest>();
  for (const list of lists) for (const item of list) if (!byId.has(item.id)) byId.set(item.id, item);
  return [...byId.values()];
}

export function groupByRepo(items: readonly PullRequest[]): PullRequestGroup[] {
  const repos = new Map<string, PullRequest[]>();
  const deploy: PullRequest[] = [];
  for (const item of items) {
    if (isDeployRepo(item.repo)) {
      deploy.push(item);
      continue;
    }
    repos.set(item.repo, [...(repos.get(item.repo) ?? []), item]);
  }
  const groups: PullRequestGroup[] = [...repos.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([repo, list]) => ({ key: repo, title: repo, collapsedByDefault: false, items: newestFirst(list) }));
  if (deploy.length > 0) {
    groups.push({ key: DEPLOY_GROUP_KEY, title: 'Deploy', collapsedByDefault: true, items: newestFirst(deploy) });
  }
  return groups;
}

function newestFirst(items: readonly PullRequest[]): PullRequest[] {
  return [...items].sort((a, b) => b.updatedAt - a.updatedAt);
}
