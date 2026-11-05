import { beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({ exists: vi.fn(), readDir: vi.fn(), readTextFile: vi.fn() }));

vi.mock('@tauri-apps/api/path', () => ({
  homeDir: vi.fn(async () => '/home/dev'),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}));
vi.mock('@tauri-apps/plugin-fs', () => fs);

import { TauriSessionDirectory } from './tauri-session-directory';

const file = (name: string) => ({ name, isFile: true, isDirectory: false, isSymlink: false });

describe('TauriSessionDirectory', () => {
  beforeEach(() => {
    for (const mock of Object.values(fs)) mock.mockReset();
  });

  it('lê só os .json de ~/.claude/sessions', async () => {
    fs.exists.mockResolvedValue(true);
    fs.readDir.mockResolvedValue([
      file('111.json'),
      file('222.json'),
      file('notas.txt'),
      { name: 'sub', isFile: false, isDirectory: true, isSymlink: false },
    ]);
    fs.readTextFile.mockImplementation(async (path: string) => `conteudo:${path}`);
    expect(await new TauriSessionDirectory().readAll()).toEqual([
      'conteudo:/home/dev/.claude/sessions/111.json',
      'conteudo:/home/dev/.claude/sessions/222.json',
    ]);
    expect(fs.exists).toHaveBeenCalledWith('/home/dev/.claude/sessions');
    expect(fs.readDir).toHaveBeenCalledWith('/home/dev/.claude/sessions');
  });

  it('pasta inexistente (Claude Code nunca rodou): lista vazia sem tentar ler', async () => {
    fs.exists.mockResolvedValue(false);
    expect(await new TauriSessionDirectory().readAll()).toEqual([]);
    expect(fs.readDir).not.toHaveBeenCalled();
  });

  it('arquivo que some entre a listagem e a leitura é ignorado', async () => {
    fs.exists.mockResolvedValue(true);
    fs.readDir.mockResolvedValue([file('1.json'), file('2.json')]);
    fs.readTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith('1.json')) throw new Error('No such file');
      return '{"pid":2}';
    });
    expect(await new TauriSessionDirectory().readAll()).toEqual(['{"pid":2}']);
  });

  it('falha ao listar a pasta propaga o erro', async () => {
    fs.exists.mockResolvedValue(true);
    fs.readDir.mockRejectedValue(new Error('forbidden path'));
    await expect(new TauriSessionDirectory().readAll()).rejects.toThrow('forbidden path');
  });
});
