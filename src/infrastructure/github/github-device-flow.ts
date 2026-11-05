import type { DeviceCode, GitHubDeviceFlow } from '../../application/ports';
import { ConnectionProblemError } from '../../domain/connections';
import { AUTH_CONFIG, requireClientId, type AuthConfig } from '../config/auth-config';
import type { FetchLike } from '../platform/tauri-fetch';

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const SLOW_DOWN_STEP_SECONDS = 5;

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

export type Sleep = (ms: number) => Promise<void>;

const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class GitHubDeviceFlowAuthorizer implements GitHubDeviceFlow {
  constructor(
    private readonly fetcher: FetchLike,
    private readonly config: AuthConfig['github'] = AUTH_CONFIG.github,
    private readonly sleep: Sleep = realSleep,
  ) {}

  async start(): Promise<DeviceCode> {
    const clientId = requireClientId(this.config.clientId, 'GitHub OAuth App');
    const response = await this.post(DEVICE_CODE_URL, { client_id: clientId, scope: this.config.scopes.join(' ') });
    if (!response.ok) throw new Error(`GitHub respondeu ${response.status} ao pedir o código do dispositivo`);
    const body = (await response.json()) as DeviceCodeResponse;
    return {
      deviceCode: body.device_code,
      userCode: body.user_code,
      verificationUri: body.verification_uri,
      intervalSeconds: body.interval,
      expiresInSeconds: body.expires_in,
    };
  }

  async complete(code: DeviceCode): Promise<string> {
    const clientId = requireClientId(this.config.clientId, 'GitHub OAuth App');
    let interval = code.intervalSeconds;
    let waited = 0;
    while (waited < code.expiresInSeconds) {
      await this.sleep(interval * 1000);
      waited += interval;
      const response = await this.post(ACCESS_TOKEN_URL, {
        client_id: clientId,
        device_code: code.deviceCode,
        grant_type: DEVICE_GRANT,
      });
      const body = (await response.json()) as TokenResponse;
      if (body.access_token) return body.access_token;
      switch (body.error) {
        case 'authorization_pending':
          break;
        case 'slow_down':
          interval += SLOW_DOWN_STEP_SECONDS;
          break;
        case 'access_denied':
          throw new ConnectionProblemError('github-unauthorized', 'Acesso negado no GitHub.');
        case 'expired_token':
          throw new ConnectionProblemError('github-unauthorized', 'O código expirou. Tente de novo.');
        default:
          throw new ConnectionProblemError('github-unauthorized', body.error_description ?? body.error ?? 'Falha no login');
      }
    }
    throw new ConnectionProblemError('github-unauthorized', 'O código expirou. Tente de novo.');
  }

  private post(url: string, body: Record<string, string>): Promise<Response> {
    return this.fetcher(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
}
