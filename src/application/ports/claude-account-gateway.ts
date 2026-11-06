export interface ClaudeLoginStart {
  loginId: string;
  authorizeUrl: string;
  state: string;
  redirectUri: string;
  manualAuthorizeUrl: string;
}

export interface ClaudeLoginRequest {
  loginId: string;
  accountId: string;
  code?: string;
  timeoutMs?: number;
}

export interface ClaudeLoginResult {
  expiresAt: number | null;
  email: string | null;
}

export interface ClaudeAccountStatus {
  signedIn: boolean;
  expiresAt: number | null;
  needsLogin: boolean;
}

export interface ClaudeAccountGateway {
  begin(clientId: string): Promise<ClaudeLoginStart>;
  complete(request: ClaudeLoginRequest): Promise<ClaudeLoginResult>;
  cancel(loginId: string): Promise<void>;
  status(accountId: string): Promise<ClaudeAccountStatus>;
  remove(accountId: string): Promise<void>;
}
