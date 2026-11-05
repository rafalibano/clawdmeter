import { isRunning, type SkillRun } from '../../domain/skills';
import type { StreamingProcessHandle, Unsubscribe } from '../ports';

type BoardListener = (runs: SkillRun[]) => void;

export class SkillRunBoard {
  private readonly runs = new Map<string, SkillRun>();
  private readonly handles = new Map<string, StreamingProcessHandle>();
  private readonly cancelled = new Set<string>();
  private readonly listeners = new Set<BoardListener>();

  list(): SkillRun[] {
    return [...this.runs.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  get(id: string): SkillRun | undefined {
    return this.runs.get(id);
  }

  finished(): SkillRun[] {
    return this.list().filter((run) => !isRunning(run));
  }

  isSkillRunning(skillId: string): boolean {
    return this.list().some((run) => run.skillId === skillId && isRunning(run));
  }

  put(run: SkillRun): void {
    this.runs.set(run.id, run);
    this.emit();
  }

  hydrate(history: readonly SkillRun[]): void {
    for (const run of history) if (!this.runs.has(run.id)) this.runs.set(run.id, run);
    this.emit();
  }

  attach(id: string, handle: StreamingProcessHandle): void {
    if (this.runs.get(id) && isRunning(this.runs.get(id)!)) this.handles.set(id, handle);
  }

  handleOf(id: string): StreamingProcessHandle | undefined {
    return this.handles.get(id);
  }

  release(id: string): void {
    this.handles.delete(id);
  }

  markCancelled(id: string): void {
    this.cancelled.add(id);
  }

  wasCancelled(id: string): boolean {
    return this.cancelled.has(id);
  }

  subscribe(listener: BoardListener): Unsubscribe {
    this.listeners.add(listener);
    listener(this.list());
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const snapshot = this.list();
    for (const listener of this.listeners) listener(snapshot);
  }
}
