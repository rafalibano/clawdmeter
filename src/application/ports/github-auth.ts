import type { GitHubAccount } from '../../domain/connections';

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  intervalSeconds: number;
  expiresInSeconds: number;
}

export interface GitHubCliTokenSource {
  token(): Promise<string | null>;
}

export interface GitHubDeviceFlow {
  start(): Promise<DeviceCode>;
  complete(code: DeviceCode): Promise<string>;
}

export interface GitHubAccountGateway {
  inspect(token: string): Promise<GitHubAccount>;
}
