export interface Clock {
  now(): number;
  every(intervalMs: number, task: () => void): () => void;
}
