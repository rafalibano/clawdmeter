import { RateLimitedError } from '../../domain/rate-limit';
import {
  INITIAL_UPDATE_SNAPSHOT,
  UPDATE_CHECK_TICK_MS,
  UpdateAccessError,
  isCheckDue,
  isNewerVersion,
  isRateLimited,
  rateLimitedUntil,
  type UpdateErrorReason,
  type UpdateSchedule,
  type UpdateSnapshot,
  type UpdateStatus,
} from '../../domain/updates';
import type { GitHubSession } from '../pull-requests/github-session';
import type { Clock, Unsubscribe, UpdateChecker } from '../ports';

type SnapshotListener = (snapshot: UpdateSnapshot) => void;

export class Updates {
  private snapshot: UpdateSnapshot = INITIAL_UPDATE_SNAPSHOT;
  private readonly schedule: UpdateSchedule = { lastAttemptAt: null, blockedUntil: null };
  private readonly listeners = new Set<SnapshotListener>();
  private stopTimer: (() => void) | null = null;
  private busy = false;

  constructor(
    private readonly checker: UpdateChecker,
    private readonly github: GitHubSession,
    private readonly clock: Clock,
  ) {}

  get current(): UpdateSnapshot {
    return this.snapshot;
  }

  subscribe(listener: SnapshotListener): Unsubscribe {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  start(): Unsubscribe {
    if (this.stopTimer === null) {
      this.stopTimer = this.clock.every(UPDATE_CHECK_TICK_MS, () => void this.checkIfDue());
      void this.loadCurrentVersion();
      void this.checkIfDue();
    }
    return () => this.stop();
  }

  stop(): void {
    this.stopTimer?.();
    this.stopTimer = null;
  }

  async checkIfDue(): Promise<void> {
    if (isCheckDue(this.schedule, this.clock.now())) await this.check();
  }

  async checkNow(): Promise<void> {
    if (isRateLimited(this.schedule, this.clock.now())) {
      if (this.snapshot.status.state !== 'available') this.fail('check', 'rate-limited', null);
      return;
    }
    await this.check();
  }

  async install(): Promise<void> {
    const status = this.snapshot.status;
    const version = status.state === 'available' || status.state === 'error' ? status.version : null;
    if (version === null || this.busy) return;
    this.busy = true;
    try {
      const token = await this.token();
      if (token === null) return this.setStatus({ state: 'github-required' });
      this.setStatus({ state: 'downloading', version, downloaded: 0, total: null });
      await this.checker.install(token, ({ downloaded, total }) =>
        this.setStatus({ state: 'downloading', version, downloaded, total }),
      );
      this.setStatus({ state: 'installed', version });
    } catch (error) {
      this.fail('install', this.reasonOf(error), version);
    } finally {
      this.busy = false;
    }
  }

  restart(): Promise<void> {
    return this.checker.restart();
  }

  private async check(): Promise<void> {
    const state = this.snapshot.status.state;
    if (this.busy || state === 'downloading' || state === 'installed') return;
    this.busy = true;
    try {
      const token = await this.token();
      if (token === null) return this.setStatus({ state: 'github-required' });
      this.schedule.lastAttemptAt = this.clock.now();
      this.setStatus({ state: 'checking' });
      const update = await this.checker.check(token);
      this.snapshot = {
        ...this.snapshot,
        lastCheckedAt: this.clock.now(),
        currentVersion: update?.currentVersion ?? this.snapshot.currentVersion,
      };
      const newer = update !== null && isNewerVersion(update.version, update.currentVersion);
      this.setStatus(newer ? { state: 'available', version: update.version, notes: update.notes } : { state: 'up-to-date' });
    } catch (error) {
      this.fail('check', this.reasonOf(error), null);
    } finally {
      this.busy = false;
    }
  }

  private async token(): Promise<string | null> {
    try {
      return await this.github.token();
    } catch {
      return null;
    }
  }

  private async loadCurrentVersion(): Promise<void> {
    try {
      const currentVersion = await this.checker.currentVersion();
      this.publish({ ...this.snapshot, currentVersion });
    } catch {
      return;
    }
  }

  private reasonOf(error: unknown): UpdateErrorReason {
    if (error instanceof RateLimitedError) {
      this.schedule.blockedUntil = rateLimitedUntil(this.clock.now(), error.retryAfterMs);
      return 'rate-limited';
    }
    return error instanceof UpdateAccessError ? 'no-access' : 'failed';
  }

  private fail(during: 'check' | 'install', reason: UpdateErrorReason, version: string | null): void {
    this.setStatus({ state: 'error', during, reason, version });
  }

  private setStatus(status: UpdateStatus): void {
    this.publish({ ...this.snapshot, status });
  }

  private publish(snapshot: UpdateSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
}
