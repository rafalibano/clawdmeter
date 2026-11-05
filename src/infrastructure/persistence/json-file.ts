export interface JsonFile {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
  watch(onChange: () => void): Promise<() => void>;
}

export interface AtomicJsonFile extends JsonFile {
  writeAtomic(text: string): Promise<void>;
  quarantine(): Promise<void>;
}
