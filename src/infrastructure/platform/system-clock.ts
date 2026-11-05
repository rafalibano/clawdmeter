import type { Clock } from '../../application/ports';

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }

  every(intervalMs: number, task: () => void): () => void {
    const handle = setInterval(task, intervalMs);
    return () => clearInterval(handle);
  }
}
