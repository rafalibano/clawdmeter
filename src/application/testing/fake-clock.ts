import type { Clock } from '../ports';

interface Timer {
  intervalMs: number;
  nextAt: number;
  task: () => void;
}

export class FakeClock implements Clock {
  private current = 0;
  private readonly timers = new Set<Timer>();

  now(): number {
    return this.current;
  }

  every(intervalMs: number, task: () => void): () => void {
    const timer: Timer = { intervalMs, nextAt: this.current + intervalMs, task };
    this.timers.add(timer);
    return () => this.timers.delete(timer);
  }

  activeTimers(): number {
    return this.timers.size;
  }

  async advance(ms: number): Promise<void> {
    const target = this.current + ms;
    await flushPromises();
    for (;;) {
      const due = [...this.timers].filter((timer) => timer.nextAt <= target).sort((a, b) => a.nextAt - b.nextAt)[0];
      if (!due) break;
      this.current = due.nextAt;
      due.nextAt += due.intervalMs;
      due.task();
      await flushPromises();
    }
    this.current = target;
  }
}

export function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
