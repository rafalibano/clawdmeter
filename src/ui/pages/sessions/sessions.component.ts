import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { I18n } from '../../i18n';
import { PageStateService } from '../../shell/page-state.service';
import { allOpen, pruneKeys, toggleAllKeys, toggleKey } from './session-expansion';
import { SESSIONS_PAGE } from './sessions-page-ref';
import { toSessionsView, type SessionRowView } from './sessions-view';

@Component({
  selector: 'cm-sessions-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sessions.component.html',
  styleUrl: './sessions.component.scss',
})
export class SessionsComponent {
  protected readonly i18n = inject(I18n);
  private readonly update = inject(PageStateService).of(SESSIONS_PAGE);
  private readonly expanded = signal<ReadonlySet<string>>(new Set());

  protected readonly view = computed(() => {
    const update = this.update();
    return update?.status === 'ok' ? toSessionsView(update.data, this.i18n.localizer()) : null;
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
}
