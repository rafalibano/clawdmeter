import {
  CONNECTIONS,
  createDefaultConnectionPrefs,
  type ConnectionId,
  type ConnectionPrefs,
  type GitHubOrgAccess,
} from '../../domain/connections';
import type { NotificationPermissionState } from '../../application/ports';

export interface DemoWorld {
  claude: { missing: boolean; expired: boolean; keychainDenied: boolean };
  github: { ghLoggedIn: boolean; unauthorized: boolean; missingScope: boolean; orgAccess: GitHubOrgAccess };
  microsoft: { expired: boolean };
  notifications: NotificationPermissionState;
  failOnce: Set<ConnectionId>;
  prefs: ConnectionPrefs;
}

const ERRORS_SHORTHAND = 'claude:claude-expired,github:github-missing-scope,microsoft:microsoft-expired,notifications:notifications-blocked';
const DEMO_ACCOUNT = 'dev@mottu.com.br';

export function parseDemoScenario(search: string): Map<ConnectionId, string> {
  const raw = new URLSearchParams(search).get('demo') ?? '';
  const expanded = raw === 'errors' ? ERRORS_SHORTHAND : raw;
  const known = new Set<string>(CONNECTIONS.map((connection) => connection.id));
  const scenario = new Map<ConnectionId, string>();
  for (const entry of expanded.split(',')) {
    const [id, value] = entry.split(':');
    if (id && value && known.has(id)) scenario.set(id as ConnectionId, value);
  }
  return scenario;
}

export function createDemoWorld(search: string): DemoWorld {
  const scenario = parseDemoScenario(search);
  const world: DemoWorld = {
    claude: { missing: false, expired: false, keychainDenied: false },
    github: { ghLoggedIn: false, unauthorized: false, missingScope: false, orgAccess: 'ok' },
    microsoft: { expired: false },
    notifications: 'granted',
    failOnce: new Set(),
    prefs: createDefaultConnectionPrefs(),
  };

  const claude = scenario.get('claude');
  world.claude.keychainDenied = claude === 'keychain-denied';
  world.claude.expired = claude === 'claude-expired';
  world.claude.missing = claude === 'claude-code-missing';
  if (claude === 'disconnected') world.prefs.claude.enabled = false;

  const github = scenario.get('github');
  if (github !== undefined && github !== 'disconnected') {
    world.github.ghLoggedIn = true;
    world.prefs.github.method = 'gh-cli';
    world.github.unauthorized = github === 'github-unauthorized';
    world.github.missingScope = github === 'github-missing-scope';
    if (github === 'github-org-access') world.github.orgAccess = 'sso-required';
    if (github === 'github-not-member') world.github.orgAccess = 'not-member';
  }

  const microsoft = scenario.get('microsoft');
  if (microsoft !== undefined && microsoft !== 'disconnected') {
    world.prefs.microsoft.account = DEMO_ACCOUNT;
    world.microsoft.expired = microsoft === 'microsoft-expired';
  }

  const notifications = scenario.get('notifications');
  if (notifications === 'notifications-blocked') world.notifications = 'denied';
  if (notifications === 'notifications-unverifiable') world.notifications = 'unknown';
  if (notifications === 'disconnected') world.notifications = 'prompt';

  for (const [id, value] of scenario) if (value === 'unexpected') world.failOnce.add(id);
  return world;
}
