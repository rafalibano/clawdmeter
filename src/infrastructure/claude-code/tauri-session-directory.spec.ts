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

  it('reads only the .json files in ~/.claude/sessions', async () => {
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

  it('missing folder (Claude Code never ran): empty list without trying to read', async () => {
    fs.exists.mockResolvedValue(false);
    expect(await new TauriSessionDirectory().readAll()).toEqual([]);
    expect(fs.readDir).not.toHaveBeenCalled();
  });

  it('a file that disappears between listing and reading is ignored', async () => {
    fs.exists.mockResolvedValue(true);
    fs.readDir.mockResolvedValue([file('1.json'), file('2.json')]);
    fs.readTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith('1.json')) throw new Error('No such file');
      return '{"pid":2}';
    });
    expect(await new TauriSessionDirectory().readAll()).toEqual(['{"pid":2}']);
  });

  it('failing to list the folder propagates the error', async () => {
    fs.exists.mockResolvedValue(true);
    fs.readDir.mockRejectedValue(new Error('forbidden path'));
    await expect(new TauriSessionDirectory().readAll()).rejects.toThrow('forbidden path');
  });
});
