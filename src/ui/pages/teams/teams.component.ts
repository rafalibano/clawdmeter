import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { CodedError } from '../../../domain/coded-error';
import type { ConnectionAction } from '../../../domain/connections';
import { I18n } from '../../i18n';
import { APPLICATION } from '../../shell/application.token';
import { ConnectionsFacade } from '../../shell/connections.facade';
import { PageStateService } from '../../shell/page-state.service';
import { isStale, toAgendaView, type MeetingRowView } from './agenda-view';
import { RETRY_ACTION, toFailureView } from './teams-failure-view';
import { TEAMS_PAGE } from './teams-page-ref';

const CLOCK_TICK_MS = 1_000;

@Component({
  selector: 'cm-teams-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
    .headline {
      margin: 0 0 10px;
      font-weight: 600;
    }
    .list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 0 0 10px;
      padding: 0;
      list-style: none;
    }
    .row {
      display: grid;
      grid-template-columns: 92px 1fr auto;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border: 1px solid var(--cm-border);
      border-radius: var(--cm-radius-md);
      background: var(--cm-surface);
    }
    .row[data-tone='now'] {
      border-color: var(--cm-accent);
    }
    .row[data-tone='past'] {
      opacity: 0.55;
    }
    .row[data-tone='cancelled'] .title {
      text-decoration: line-through;
    }
    .row[data-tone='cancelled'] {
      opacity: 0.55;
    }
    .time {
      font-variant-numeric: tabular-nums;
      color: var(--cm-muted);
    }
    .title {
      font-weight: 500;
      overflow-wrap: anywhere;
    }
    .detail,
    .hint {
      color: var(--cm-muted);
      font-size: 12px;
    }
    .badge {
      margin-left: 6px;
      padding: 1px 6px;
      border-radius: var(--cm-radius-pill);
      background: var(--cm-accent);
      color: var(--cm-accent-fg);
      font-size: 11px;
      font-weight: 400;
    }
    .btn {
      padding: 4px 10px;
      border: 1px solid var(--cm-control-border);
      border-radius: var(--cm-radius-btn);
      background: var(--cm-accent);
      color: var(--cm-accent-fg);
      cursor: pointer;
    }
    .btn:active:not(.secondary) {
      border-color: var(--cm-accent-active);
      background: var(--cm-accent-active);
      color: var(--cm-accent-fg-active);
    }
    .btn.secondary {
      background: transparent;
      color: var(--cm-fg);
    }
    .problem {
      padding: 10px;
      border: 1px solid var(--cm-border);
      border-radius: var(--cm-radius-md);
      background: color-mix(in srgb, var(--cm-danger) 14%, transparent);
    }
    .problem p {
      margin: 0 0 8px;
    }
    .actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    h2 {
      margin: 0 0 6px;
      font-size: 12px;
      color: var(--cm-muted);
      font-weight: 500;
    }
  `,
  template: `
    @if (failure(); as problem) {
      <div class="problem" role="alert">
        <p>{{ problem.message }}</p>
        <div class="actions">
          @for (action of problem.actions; track action.kind) {
            <button type="button" class="btn" [attr.data-action]="action.kind" (click)="run(action)">{{ i18n.actionText(action) }}</button>
          }
        </div>
      </div>
    } @else {
      @if (agenda(); as day) {
        @if (day.headline) {
          <p class="headline">{{ day.headline }}</p>
        }
        @if (day.allDay.length > 0) {
          <h2>{{ i18n.t('teams.allDay') }}</h2>
          <ul class="list">
            @for (row of day.allDay; track row.id) {
              <ng-container *ngTemplateOutlet="item; context: { $implicit: row }" />
            }
          </ul>
        }
        @if (day.rows.length > 0) {
          <ul class="list">
            @for (row of day.rows; track row.id) {
              <ng-container *ngTemplateOutlet="item; context: { $implicit: row }" />
            }
          </ul>
        } @else if (day.isEmpty) {
          <p class="hint">{{ i18n.t('teams.empty') }}</p>
        }
        @if (joinError(); as message) {
          <p class="hint" role="alert">{{ message }}</p>
        }
      } @else {
        <p class="hint">{{ i18n.t('common.loading') }}</p>
      }
    }

    <ng-template #item let-row>
      <li class="row" [attr.data-tone]="row.tone">
        <span class="time">{{ row.time }}</span>
        <span>
          <span class="title">{{ row.title }}</span>
          @if (row.badge) {
            <span class="badge">{{ row.badge }}</span>
          }
          @if (row.detail) {
            <div class="detail">{{ row.detail }}</div>
          }
        </span>
        @if (row.joinUrl) {
          <button type="button" class="btn" data-action="join" (click)="join(row)">{{ i18n.t('teams.join') }}</button>
        }
      </li>
    </ng-template>
  `,
  imports: [NgTemplateOutlet],
})
export class TeamsComponent {
  protected readonly i18n = inject(I18n);
  private readonly application = inject(APPLICATION);
  private readonly connections = inject(ConnectionsFacade);
  private readonly update = inject(PageStateService).of(TEAMS_PAGE);
  private readonly now = signal(this.application.clock.now());

  protected readonly joinError = signal<string | null>(null);

  protected readonly agenda = computed(() => {
    const update = this.update();
    return update?.status === 'ok' ? toAgendaView(update.data, this.now(), this.i18n.localizer()) : null;
  });

  protected readonly failure = computed(() => toFailureView(this.update(), this.i18n));

  private readonly stale = computed(() => {
    const update = this.update();
    return update?.status === 'ok' && isStale(update.data, this.now());
  });

  constructor() {
    effect(() => {
      if (this.stale()) void this.application.scheduler.refresh(TEAMS_PAGE.id);
    });
    const stop = this.application.clock.every(CLOCK_TICK_MS, () => this.now.set(this.application.clock.now()));
    inject(DestroyRef).onDestroy(stop);
  }

  protected async run(action: ConnectionAction): Promise<void> {
    if (action !== RETRY_ACTION) await this.connections.act('microsoft', action);
    await this.application.scheduler.refresh(TEAMS_PAGE.id);
  }

  protected async join(row: MeetingRowView): Promise<void> {
    this.joinError.set(null);
    try {
      await this.application.joinMeeting.execute(row.joinUrl);
    } catch (error) {
      this.joinError.set(
        error instanceof CodedError
          ? this.i18n.t(`error.${error.code}`, error.args)
          : this.i18n.t('error.meeting-open-failed'),
      );
    }
  }
}
