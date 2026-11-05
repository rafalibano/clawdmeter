import { getVersion } from '@tauri-apps/api/app';
import { Channel } from '@tauri-apps/api/core';
import type { AvailableUpdate, DownloadProgress, UpdateChecker } from '../../application/ports';
import { UpdateAccessError } from '../../domain/updates';
import { PlatformCommandError, type TauriCommands } from '../platform/tauri-commands';

export type DownloadEvent = { event: 'progress'; data: DownloadProgress } | { event: 'finished' };

export interface DownloadChannel {
  onmessage: (event: DownloadEvent) => void;
}

interface RawUpdate {
  version: string;
  currentVersion: string;
  notes?: string | null;
}

const ACCESS_STATUS = /\b(401|403|404)\b/;

export function toUpdateError(error: unknown): unknown {
  if (error instanceof PlatformCommandError && error.kind === 'http' && ACCESS_STATUS.test(error.message)) {
    return new UpdateAccessError(error.message);
  }
  return error;
}

export class TauriUpdateChecker implements UpdateChecker {
  constructor(
    private readonly commands: TauriCommands,
    private readonly appVersion: () => Promise<string> = getVersion,
    private readonly createChannel: () => DownloadChannel = () => new Channel<DownloadEvent>(),
  ) {}

  currentVersion(): Promise<string> {
    return this.appVersion();
  }

  async check(token: string): Promise<AvailableUpdate | null> {
    try {
      const raw = await this.commands.call<RawUpdate | null>('updater_check', { token });
      return raw === null ? null : { version: raw.version, currentVersion: raw.currentVersion, notes: raw.notes ?? null };
    } catch (error) {
      throw toUpdateError(error);
    }
  }

  async install(token: string, onProgress: (progress: DownloadProgress) => void): Promise<void> {
    const channel = this.createChannel();
    channel.onmessage = (message) => {
      if (message.event === 'progress') onProgress({ downloaded: message.data.downloaded, total: message.data.total ?? null });
    };
    try {
      await this.commands.call<void>('updater_install', { token, onEvent: channel });
    } catch (error) {
      throw toUpdateError(error);
    }
  }

  restart(): Promise<void> {
    return this.commands.call<void>('updater_restart');
  }
}
