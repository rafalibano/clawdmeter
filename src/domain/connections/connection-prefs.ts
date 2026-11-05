import type { GitHubAuthMethod } from './github';

export interface ConnectionPrefs {
  claude: { enabled: boolean };
  github: { method: GitHubAuthMethod | null };
  microsoft: { account: string | null };
}

export function createDefaultConnectionPrefs(): ConnectionPrefs {
  return { claude: { enabled: true }, github: { method: null }, microsoft: { account: null } };
}

const GITHUB_METHODS: readonly string[] = ['gh-cli', 'device-flow', 'pat'];

export function parseConnectionPrefs(raw: unknown): ConnectionPrefs {
  const defaults = createDefaultConnectionPrefs();
  if (typeof raw !== 'object' || raw === null) return defaults;
  const source = raw as Record<string, unknown>;
  const claude = source['claude'] as { enabled?: unknown } | undefined;
  const github = source['github'] as { method?: unknown } | undefined;
  const microsoft = source['microsoft'] as { account?: unknown } | undefined;
  return {
    claude: { enabled: typeof claude?.enabled === 'boolean' ? claude.enabled : defaults.claude.enabled },
    github: {
      method:
        typeof github?.method === 'string' && GITHUB_METHODS.includes(github.method)
          ? (github.method as GitHubAuthMethod)
          : null,
    },
    microsoft: { account: typeof microsoft?.account === 'string' ? microsoft.account : null },
  };
}
