import { describe, expect, it } from 'vitest';
import { createFakeCommands } from '../testing/fakes';
import { TauriProcessProbe } from './tauri-process-probe';

describe('TauriProcessProbe', () => {
  it('asks the process_is_alive command about the pid', async () => {
    const { commands, calls } = createFakeCommands((_, args) => args?.['pid'] === 4242);
    const probe = new TauriProcessProbe(commands);
    expect(await probe.isAlive(4242)).toBe(true);
    expect(await probe.isAlive(1)).toBe(false);
    expect(calls).toEqual([
      { command: 'process_is_alive', args: { pid: 4242 } },
      { command: 'process_is_alive', args: { pid: 1 } },
    ]);
  });
});
