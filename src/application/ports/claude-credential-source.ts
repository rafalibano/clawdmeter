export interface ClaudeCredential {
  expiresAt: number | null;
  subscriptionType: string | null;
}

export interface ClaudeCredentialSource {
  read(): Promise<ClaudeCredential>;
}
