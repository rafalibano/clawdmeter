export interface MicrosoftSession {
  account: string;
}

export interface MicrosoftAuthorizer {
  signIn(): Promise<MicrosoftSession>;
  accessToken(): Promise<string>;
  signOut(): Promise<void>;
}
