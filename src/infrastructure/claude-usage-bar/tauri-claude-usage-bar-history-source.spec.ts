import { beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({ readTextFile: vi.fn(), stat: vi.fn() }));

vi.mock('@tauri-apps/api/path', () => ({
  homeDir: vi.fn(async () => '/home/dev'),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}));
vi.mock('@tauri-apps/plugin-fs', () => fs);

import { TauriClaudeUsageBarHistorySource } from './tauri-claude-usage-bar-history-source';

const FILE = '/home/dev/.config/claude-usage-bar/history.json';

describe('TauriClaudeUsageBarHistorySource', () => {
  beforeEach(() => {
    fs.readTextFile.mockReset();
    fs.stat.mockReset();
    fs.stat.mockResolvedValue({ size: 1_024 });
  });

  it('reads only the ClaudeUsageBar history.json and converts it to points', async () => {
    fs.readTextFile.mockResolvedValue(
      JSON.stringify({ dataPoints: [{ id: 'a', pct5h: 0.05, pct7d: 0.72, timestamp: '2026-10-06T17:12:03Z' }] }),
    );
    expect(await new TauriClaudeUsageBarHistorySource().read()).toEqual([
      { at: Date.parse('2026-10-06T17:12:03Z'), fiveHour: 5, sevenDay: 72 },
    ]);
    expect(fs.readTextFile).toHaveBeenCalledTimes(1);
    expect(fs.readTextFile).toHaveBeenCalledWith(FILE);
  });

  it('a missing or unreadable file becomes an empty list, without error', async () => {
    fs.readTextFile.mockRejectedValue(new Error('No such file'));
    expect(await new TauriClaudeUsageBarHistorySource().read()).toEqual([]);
  });

  it('invalid JSON becomes an empty list', async () => {
    fs.readTextFile.mockResolvedValue('{ quebrado');
    expect(await new TauriClaudeUsageBarHistorySource().read()).toEqual([]);
  });

  it('a file over 8 MiB is skipped from its size, before being read', async () => {
    fs.stat.mockResolvedValue({ size: 8 * 1024 * 1024 + 1 });
    expect(await new TauriClaudeUsageBarHistorySource().read()).toEqual([]);
    expect(fs.stat).toHaveBeenCalledWith(FILE);
    expect(fs.readTextFile).not.toHaveBeenCalled();
  });

  it('a stat failure becomes an empty list without reading', async () => {
    fs.stat.mockRejectedValue(new Error('No such file'));
    expect(await new TauriClaudeUsageBarHistorySource().read()).toEqual([]);
    expect(fs.readTextFile).not.toHaveBeenCalled();
  });

  it('a huge file is ignored without parsing', async () => {
    fs.readTextFile.mockResolvedValue(' '.repeat(9 * 1024 * 1024));
    expect(await new TauriClaudeUsageBarHistorySource().read()).toEqual([]);
  });
});
