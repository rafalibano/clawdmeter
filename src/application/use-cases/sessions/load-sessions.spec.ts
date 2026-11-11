import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ATTENTION_CONFIG, type SessionUsage } from '../../../domain/sessions';
import { MINUTE_MS } from '../../../domain/time';
import { FakeClock } from '../../testing/fake-clock';
import { FakeProcessProbe, FakeSessionDirectory, FakeSessionUsageReader } from '../../testing/fake-usage-adapters';
import { LoadSessions } from './load-sessions';

const START = 1_800_000_000_000;

function file(pid: number, status: string, ageMs: number, sessionId?: string): string {
  return JSON.stringify({ pid, sessionId, status, cwd: `/work/app-${pid}`, statusUpdatedAt: START - ageMs, updatedAt: START - ageMs });
}

function usage(model: string): SessionUsage {
  return {
    model,
    contextTokens: 1_000,
    longContext: false,
    inputTokens: 1,
    outputTokens: 2,
    cacheReadTokens: 3,
    cacheCreationTokens: 4,
    subagents: [],
  };
}

let clock: FakeClock;
let directory: FakeSessionDirectory;
let probe: FakeProcessProbe;
let loadSessions: LoadSessions;

beforeEach(async () => {
  clock = new FakeClock();
  await clock.advance(START);
  directory = new FakeSessionDirectory();
  probe = new FakeProcessProbe();
  loadSessions = new LoadSessions(directory, probe, clock, DEFAULT_ATTENTION_CONFIG);
});

describe('LoadSessions', () => {
  it('only returns sessions with a live pid', async () => {
    directory.files = [file(1, 'busy', 1_000), file(2, 'idle', 1_000), file(3, 'shell', 1_000)];
    probe.alive = new Set([1, 3]);
    const data = await loadSessions.execute();
    expect(data.sessions.map((session) => session.pid).sort()).toEqual([1, 3]);
    expect(probe.probed.sort()).toEqual([1, 2, 3]);
  });

  it('a finished session disappears on the next read', async () => {
    directory.files = [file(1, 'busy', 1_000), file(2, 'idle', 1_000)];
    probe.alive = new Set([1, 2]);
    expect((await loadSessions.execute()).sessions).toHaveLength(2);
    probe.alive = new Set([1]);
    expect((await loadSessions.execute()).sessions.map((session) => session.pid)).toEqual([1]);
  });

  it('ignores unreadable files or files without a pid and removes repeated pids', async () => {
    directory.files = ['{ quebrado', '{"status":"idle"}', file(7, 'idle', 0), file(7, 'busy', 0)];
    probe.alive = new Set([7]);
    const data = await loadSessions.execute();
    expect(data.sessions).toHaveLength(1);
    expect(probe.probed).toEqual([7]);
  });

  it('sorts the ones that need attention first and returns the threshold configuration', async () => {
    directory.files = [file(1, 'busy', MINUTE_MS), file(2, 'idle', 20 * MINUTE_MS)];
    probe.alive = new Set([1, 2]);
    const data = await loadSessions.execute();
    expect(data.sessions.map((session) => session.pid)).toEqual([2, 1]);
    expect(data.attention).toEqual(DEFAULT_ATTENTION_CONFIG);
    expect(data.at).toBe(START);
  });

  it('empty folder: no sessions', async () => {
    expect((await loadSessions.execute()).sessions).toEqual([]);
  });

  it('without a usage reader the usage map is empty', async () => {
    directory.files = [file(1, 'busy', 0, 's-1')];
    probe.alive = new Set([1]);
    expect((await loadSessions.execute()).usage.size).toBe(0);
  });
});

describe('LoadSessions with a usage reader', () => {
  let reader: FakeSessionUsageReader;

  beforeEach(() => {
    reader = new FakeSessionUsageReader();
    loadSessions = new LoadSessions(directory, probe, clock, DEFAULT_ATTENTION_CONFIG, reader);
  });

  it('reads the usage of each live session by session id and folder, keyed by pid', async () => {
    directory.files = [file(1, 'busy', 0, 's-1'), file(2, 'idle', 0, 's-2'), file(3, 'idle', 0, 's-3')];
    probe.alive = new Set([1, 2]);
    reader.usage.set('s-1', usage('claude-opus-5-5'));
    const data = await loadSessions.execute();
    expect(reader.reads.sort()).toEqual([
      ['s-1', '/work/app-1'],
      ['s-2', '/work/app-2'],
    ]);
    expect([...data.usage.entries()]).toEqual([[1, usage('claude-opus-5-5')]]);
  });

  it('does not read a session without a session id or without a folder', async () => {
    directory.files = [file(1, 'busy', 0), JSON.stringify({ pid: 2, sessionId: 's-2', status: 'idle' })];
    probe.alive = new Set([1, 2]);
    const data = await loadSessions.execute();
    expect(reader.reads).toEqual([]);
    expect(data.sessions).toHaveLength(2);
    expect(data.usage.size).toBe(0);
  });

  it('a session whose transcript fails to read is left without usage and the others keep theirs', async () => {
    directory.files = [file(1, 'busy', 0, 's-1'), file(2, 'idle', 0, 's-2')];
    probe.alive = new Set([1, 2]);
    reader.failing.add('s-1');
    reader.usage.set('s-2', usage('claude-sonnet-5-5'));
    const data = await loadSessions.execute();
    expect(data.sessions).toHaveLength(2);
    expect([...data.usage.keys()]).toEqual([2]);
  });
});
