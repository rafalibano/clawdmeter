export interface JsonFile {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
  watch(onChange: () => void): Promise<() => void>;
}
