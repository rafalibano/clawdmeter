export interface JsonFile {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
  watch(onChange: () => void): Promise<() => void>;
}

export interface AtomicJsonFile extends JsonFile {
  writeAtomic(text: string): Promise<void>;
  quarantine(): Promise<void>;
}

export interface JsonFileDirectory {
  file(name: string): AtomicJsonFile;
  exists(name: string): Promise<boolean>;
  rename(from: string, to: string): Promise<void>;
  remove(name: string): Promise<void>;
}
