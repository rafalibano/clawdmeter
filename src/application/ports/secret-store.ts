export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export const SECRET_KEYS = {
  githubToken: 'github.token',
  microsoftRefreshToken: 'microsoft.refresh-token',
} as const;
