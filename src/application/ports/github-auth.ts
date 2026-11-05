import type { GitHubAccount, GitHubCliMissing } from '../../domain/connections';

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  intervalSeconds: number;
  expiresInSeconds: number;
}

export type GitHubCliToken = { token: string } | { missing: GitHubCliMissing };

export interface GitHubCliTokenSource {
  token(): Promise<GitHubCliToken>;
}

export interface GitHubDeviceFlow {
  start(): Promise<DeviceCode>;
  complete(code: DeviceCode, signal?: AbortSignal): Promise<string>;
}

export interface GitHubAccountGateway {
  inspect(token: string): Promise<GitHubAccount>;
}
