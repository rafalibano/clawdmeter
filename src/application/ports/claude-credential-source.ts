export interface ClaudeCredential {
  accessToken: string;
  expiresAt: number | null;
  subscriptionType: string | null;
}

export interface ClaudeCredentialSource {
  read(): Promise<ClaudeCredential>;
}
