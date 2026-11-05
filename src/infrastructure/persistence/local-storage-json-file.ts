import type { AtomicJsonFile } from './json-file';

export class LocalStorageJsonFile implements AtomicJsonFile {
  constructor(private readonly key: string) {}

  async read(): Promise<string | null> {
    return window.localStorage.getItem(this.key);
  }

  async write(text: string): Promise<void> {
    window.localStorage.setItem(this.key, text);
  }

  writeAtomic(text: string): Promise<void> {
    return this.write(text);
  }

  async quarantine(): Promise<void> {
    const text = window.localStorage.getItem(this.key);
    if (text === null) return;
    window.localStorage.setItem(`${this.key}.corrupt`, text);
    window.localStorage.removeItem(this.key);
  }

  async watch(onChange: () => void): Promise<() => void> {
    const handler = (event: StorageEvent) => {
      if (event.key === this.key) onChange();
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }
}
