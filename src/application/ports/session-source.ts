export interface SessionDirectory {
  readAll(): Promise<string[]>;
}

export interface ProcessProbe {
  isAlive(pid: number): Promise<boolean>;
}
