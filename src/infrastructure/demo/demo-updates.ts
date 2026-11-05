import type { AvailableUpdate, DownloadProgress, UpdateChecker } from '../../application/ports';
import { RateLimitedError } from '../../domain/rate-limit';
import { UpdateAccessError } from '../../domain/updates';

export type DemoUpdateScenario = 'latest' | 'available' | 'no-access' | 'rate-limited' | 'error' | 'install-error';

const SCENARIOS: readonly DemoUpdateScenario[] = ['latest', 'available', 'no-access', 'rate-limited', 'error', 'install-error'];
const CURRENT = '0.1.0';
const NEXT = '0.2.0';
const PACKAGE_BYTES = 8_000_000;
const STEPS = 10;
const STEP_MS = 150;

export function parseDemoUpdateScenario(value: string | undefined): DemoUpdateScenario {
  return SCENARIOS.find((scenario) => scenario === value) ?? 'latest';
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class DemoUpdateChecker implements UpdateChecker {
  constructor(
    private readonly scenario: DemoUpdateScenario,
    private readonly stepMs = STEP_MS,
  ) {}

  async currentVersion(): Promise<string> {
    return CURRENT;
  }

  async check(): Promise<AvailableUpdate | null> {
    switch (this.scenario) {
      case 'no-access':
        throw new UpdateAccessError();
      case 'rate-limited':
        throw new RateLimitedError(30 * 60_000);
      case 'error':
        throw new Error('demo update check failed');
      case 'latest':
        return null;
      default:
        return { version: NEXT, currentVersion: CURRENT, notes: null };
    }
  }

  async install(_token: string, onProgress: (progress: DownloadProgress) => void): Promise<void> {
    for (let step = 1; step <= STEPS; step++) {
      await wait(this.stepMs);
      onProgress({ downloaded: (PACKAGE_BYTES * step) / STEPS, total: PACKAGE_BYTES });
      if (this.scenario === 'install-error' && step === STEPS / 2) throw new Error('demo download failed');
    }
  }

  async restart(): Promise<void> {
    return;
  }
}
