import type { JsonFile } from './json-file';

export class LocalStorageJsonFile implements JsonFile {
  constructor(private readonly key: string) {}

  async read(): Promise<string | null> {
    return window.localStorage.getItem(this.key);
  }

  async write(text: string): Promise<void> {
    window.localStorage.setItem(this.key, text);
  }

  async watch(onChange: () => void): Promise<() => void> {
    const handler = (event: StorageEvent) => {
      if (event.key === this.key) onChange();
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }
}
