import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  untracked,
} from '@angular/core';
import { I18n } from '../../i18n';
import { PageStateService } from '../../shell/page-state.service';
import { allOpen, pruneKeys, toggleAllKeys, toggleKey } from './session-expansion';
import { SESSIONS_PAGE } from './sessions-page-ref';
import { nextFilter, toSessionsView, type SessionRowView, type SessionsFilter } from './sessions-view';

const FILTER_KEYS: Readonly<Record<string, 1 | -1>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

@Component({
  selector: 'cm-sessions-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sessions.component.html',
  styleUrl: './sessions.component.scss',
})
export class SessionsComponent {
  protected readonly i18n = inject(I18n);
  private readonly update = inject(PageStateService).of(SESSIONS_PAGE);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  private readonly expanded = signal<ReadonlySet<string>>(new Set());
  private readonly filter = signal<SessionsFilter>('all');

  protected readonly view = computed(() => {
    const update = this.update();
    return update?.status === 'ok' ? toSessionsView(update.data, this.i18n.localizer(), this.filter()) : null;
  });

  protected readonly error = computed(() => {
    const update = this.update();
    return update?.status === 'error' ? this.i18n.errorText(update) : null;
  });

  private readonly expandableKeys = computed(() =>
    (this.view()?.rows ?? []).filter((row) => row.details !== null).map((row) => row.key),
  );

  protected readonly allExpanded = computed(() => allOpen(this.expanded(), this.expandableKeys()));

  protected readonly hasDetails = (row: SessionRowView): boolean => row.details !== null;

  constructor() {
    effect(() => {
      const view = this.view();
      if (view === null) return;
      const keys = view.rows.map((row) => row.key);
      untracked(() => this.expanded.update((open) => pruneKeys(open, keys)));
    });
  }

  protected isExpanded(key: string): boolean {
    return this.expanded().has(key);
  }

  protected toggle(key: string): void {
    this.expanded.update((open) => toggleKey(open, key));
  }

  protected toggleAll(): void {
    this.expanded.update((open) => toggleAllKeys(open, this.expandableKeys()));
  }

  protected selectFilter(filter: SessionsFilter): void {
    this.filter.set(filter);
  }

  protected filterKey(event: KeyboardEvent, filter: SessionsFilter): void {
    const step = FILTER_KEYS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = nextFilter(filter, step);
    this.filter.set(next);
    afterNextRender(() => this.host.querySelector<HTMLElement>(`[data-filter="${next}"]`)?.focus(), {
      injector: this.injector,
    });
  }
}
