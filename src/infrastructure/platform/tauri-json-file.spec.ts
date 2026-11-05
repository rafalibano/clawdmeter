import { beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({
  exists: vi.fn(),
  mkdir: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  rename: vi.fn(),
  watch: vi.fn(),
}));

vi.mock('@tauri-apps/api/path', () => ({
  appConfigDir: vi.fn(async () => '/cfg/com.mottu.clawdmeter'),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}));
vi.mock('@tauri-apps/plugin-fs', () => fs);

import { TauriJsonFile } from './tauri-json-file';

interface WatchEvent {
  paths: string[];
}

function emitter() {
  const stop = vi.fn();
  let handler: (event: WatchEvent) => void = () => undefined;
  fs.watch.mockImplementation(async (_dir: string, callback: (event: WatchEvent) => void) => {
    handler = callback;
    return stop;
  });
  return { stop, emit: (...paths: string[]) => handler({ paths }) };
}

describe('TauriJsonFile', () => {
  beforeEach(() => {
    for (const mock of Object.values(fs)) mock.mockReset();
    fs.mkdir.mockResolvedValue(undefined);
    fs.writeTextFile.mockResolvedValue(undefined);
    fs.rename.mockResolvedValue(undefined);
  });

  it('read returns null when the file does not exist, without trying to read', async () => {
    fs.exists.mockResolvedValue(false);
    expect(await new TauriJsonFile('settings.json').read()).toBeNull();
    expect(fs.exists).toHaveBeenCalledWith('/cfg/com.mottu.clawdmeter/settings.json');
    expect(fs.readTextFile).not.toHaveBeenCalled();
  });

  it('read returns the file contents from the config folder', async () => {
    fs.exists.mockResolvedValue(true);
    fs.readTextFile.mockResolvedValue('{"a":1}');
    expect(await new TauriJsonFile('settings.json').read()).toBe('{"a":1}');
    expect(fs.readTextFile).toHaveBeenCalledWith('/cfg/com.mottu.clawdmeter/settings.json');
  });

  it('write ensures the folder before writing', async () => {
    const order: string[] = [];
    fs.mkdir.mockImplementation(async () => void order.push('mkdir'));
    fs.writeTextFile.mockImplementation(async () => void order.push('write'));
    await new TauriJsonFile('settings.json').write('text');
    expect(order).toEqual(['mkdir', 'write']);
    expect(fs.mkdir).toHaveBeenCalledWith('/cfg/com.mottu.clawdmeter', { recursive: true });
    expect(fs.writeTextFile).toHaveBeenCalledWith('/cfg/com.mottu.clawdmeter/settings.json', 'text');
  });

  it('writeAtomic writes to a .tmp and only then renames over the final file', async () => {
    const order: string[] = [];
    fs.writeTextFile.mockImplementation(async (path: string) => void order.push(`write ${path}`));
    fs.rename.mockImplementation(async (from: string, to: string) => void order.push(`rename ${from} ${to}`));
    await new TauriJsonFile('usage-history.json').writeAtomic('text');
    expect(order).toEqual([
      'write /cfg/com.mottu.clawdmeter/usage-history.json.tmp',
      'rename /cfg/com.mottu.clawdmeter/usage-history.json.tmp /cfg/com.mottu.clawdmeter/usage-history.json',
    ]);
  });

  it('writeAtomic does not rename if writing the temporary file fails', async () => {
    fs.writeTextFile.mockRejectedValue(new Error('disco cheio'));
    await expect(new TauriJsonFile('usage-history.json').writeAtomic('x')).rejects.toThrow('disco cheio');
    expect(fs.rename).not.toHaveBeenCalled();
  });

  it('quarantine renames the file to .corrupt, and does nothing if it does not exist', async () => {
    fs.exists.mockResolvedValue(true);
    await new TauriJsonFile('usage-history.json').quarantine();
    expect(fs.rename).toHaveBeenCalledWith(
      '/cfg/com.mottu.clawdmeter/usage-history.json',
      '/cfg/com.mottu.clawdmeter/usage-history.json.corrupt',
    );
    fs.rename.mockClear();
    fs.exists.mockResolvedValue(false);
    await new TauriJsonFile('usage-history.json').quarantine();
    expect(fs.rename).not.toHaveBeenCalled();
  });

  it('watch observes the folder without recursion, with a 150 ms debounce', async () => {
    emitter();
    await new TauriJsonFile('settings.json').watch(() => undefined);
    expect(fs.watch).toHaveBeenCalledTimes(1);
    expect(fs.watch.mock.calls[0]?.[0]).toBe('/cfg/com.mottu.clawdmeter');
    expect(fs.watch.mock.calls[0]?.[2]).toEqual({ recursive: false, delayMs: 150 });
  });

  it('watch only notifies events of the exact file, on POSIX and Windows paths', async () => {
    const { emit } = emitter();
    const onChange = vi.fn();
    await new TauriJsonFile('settings.json').watch(onChange);
    emit('/cfg/com.mottu.clawdmeter/settings.json');
    emit('C:\\Users\\x\\AppData\\Roaming\\com.mottu.clawdmeter\\settings.json');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('watch ignores similarly named files and other files in the folder', async () => {
    const { emit } = emitter();
    const onChange = vi.fn();
    await new TauriJsonFile('settings.json').watch(onChange);
    emit('/cfg/com.mottu.clawdmeter/old-settings.json');
    emit('/cfg/com.mottu.clawdmeter/settings.json.tmp');
    emit('/cfg/com.mottu.clawdmeter/other.json');
    emit('/cfg/settings.json/other.json');
    emit();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('watch notifies when the file is among several paths of the event', async () => {
    const { emit } = emitter();
    const onChange = vi.fn();
    await new TauriJsonFile('settings.json').watch(onChange);
    emit('/cfg/com.mottu.clawdmeter/other.json', '/cfg/com.mottu.clawdmeter/settings.json');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('watch returns the function that cancels the plugin observation', async () => {
    const { stop } = emitter();
    const unwatch = await new TauriJsonFile('settings.json').watch(() => undefined);
    unwatch();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
