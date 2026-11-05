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

  it('read devolve null quando o arquivo não existe, sem tentar ler', async () => {
    fs.exists.mockResolvedValue(false);
    expect(await new TauriJsonFile('settings.json').read()).toBeNull();
    expect(fs.exists).toHaveBeenCalledWith('/cfg/com.mottu.clawdmeter/settings.json');
    expect(fs.readTextFile).not.toHaveBeenCalled();
  });

  it('read devolve o conteúdo do arquivo na pasta de config', async () => {
    fs.exists.mockResolvedValue(true);
    fs.readTextFile.mockResolvedValue('{"a":1}');
    expect(await new TauriJsonFile('settings.json').read()).toBe('{"a":1}');
    expect(fs.readTextFile).toHaveBeenCalledWith('/cfg/com.mottu.clawdmeter/settings.json');
  });

  it('write garante a pasta antes de gravar', async () => {
    const order: string[] = [];
    fs.mkdir.mockImplementation(async () => void order.push('mkdir'));
    fs.writeTextFile.mockImplementation(async () => void order.push('write'));
    await new TauriJsonFile('settings.json').write('texto');
    expect(order).toEqual(['mkdir', 'write']);
    expect(fs.mkdir).toHaveBeenCalledWith('/cfg/com.mottu.clawdmeter', { recursive: true });
    expect(fs.writeTextFile).toHaveBeenCalledWith('/cfg/com.mottu.clawdmeter/settings.json', 'texto');
  });

  it('writeAtomic grava num .tmp e só então renomeia sobre o arquivo final', async () => {
    const order: string[] = [];
    fs.writeTextFile.mockImplementation(async (path: string) => void order.push(`write ${path}`));
    fs.rename.mockImplementation(async (from: string, to: string) => void order.push(`rename ${from} ${to}`));
    await new TauriJsonFile('usage-history.json').writeAtomic('texto');
    expect(order).toEqual([
      'write /cfg/com.mottu.clawdmeter/usage-history.json.tmp',
      'rename /cfg/com.mottu.clawdmeter/usage-history.json.tmp /cfg/com.mottu.clawdmeter/usage-history.json',
    ]);
  });

  it('writeAtomic não renomeia se a gravação do temporário falhar', async () => {
    fs.writeTextFile.mockRejectedValue(new Error('disco cheio'));
    await expect(new TauriJsonFile('usage-history.json').writeAtomic('x')).rejects.toThrow('disco cheio');
    expect(fs.rename).not.toHaveBeenCalled();
  });

  it('quarantine renomeia o arquivo para .corrupt, e não faz nada se ele não existe', async () => {
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

  it('watch observa a pasta sem recursão, com debounce de 150 ms', async () => {
    emitter();
    await new TauriJsonFile('settings.json').watch(() => undefined);
    expect(fs.watch).toHaveBeenCalledTimes(1);
    expect(fs.watch.mock.calls[0]?.[0]).toBe('/cfg/com.mottu.clawdmeter');
    expect(fs.watch.mock.calls[0]?.[2]).toEqual({ recursive: false, delayMs: 150 });
  });

  it('watch só notifica eventos do arquivo exato, em paths POSIX e Windows', async () => {
    const { emit } = emitter();
    const onChange = vi.fn();
    await new TauriJsonFile('settings.json').watch(onChange);
    emit('/cfg/com.mottu.clawdmeter/settings.json');
    emit('C:\\Users\\x\\AppData\\Roaming\\com.mottu.clawdmeter\\settings.json');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('watch ignora arquivos de nome parecido e outros arquivos da pasta', async () => {
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

  it('watch notifica quando o arquivo está entre vários paths do evento', async () => {
    const { emit } = emitter();
    const onChange = vi.fn();
    await new TauriJsonFile('settings.json').watch(onChange);
    emit('/cfg/com.mottu.clawdmeter/other.json', '/cfg/com.mottu.clawdmeter/settings.json');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('watch devolve a função que cancela a observação do plugin', async () => {
    const { stop } = emitter();
    const unwatch = await new TauriJsonFile('settings.json').watch(() => undefined);
    unwatch();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
