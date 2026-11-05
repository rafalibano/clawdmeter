import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { isRunning, type RunFix, type SkillDefinition } from '../../../domain/skills';
import { I18n } from '../../i18n';
import { APPLICATION } from '../../shell/application.token';
import { PageStateService } from '../../shell/page-state.service';
import { PageErrorComponent } from '../shared/page-error.component';
import { SKILLS_PAGE } from './skills-page-ref';
import { SkillsFacade } from './skills.facade';
import { toRunView, type RunView } from './run-view';

const CLOCK_TICK_MS = 1_000;

@Component({
  selector: 'cm-skills-page',
  imports: [PageErrorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .heading {
      margin: 0 0 6px;
      font-size: 13px;
      font-weight: 600;
    }
    .section {
      margin-bottom: 16px;
    }
    .card {
      margin-bottom: 10px;
      padding: 10px 12px;
      border: 1px solid var(--cm-border);
      border-radius: var(--cm-radius-md);
      background: var(--cm-surface);
    }
    .row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .grow {
      flex: 1;
      min-width: 0;
    }
    .name {
      font-weight: 600;
    }
    .muted {
      color: var(--cm-muted);
      font-size: 12px;
    }
    .btn {
      padding: 3px 10px;
      border: 1px solid var(--cm-control-border);
      border-radius: var(--cm-radius-btn);
      background: var(--cm-bg);
      color: inherit;
      cursor: pointer;
    }
    .btn.primary {
      border-color: var(--cm-accent);
      background: var(--cm-accent);
      color: var(--cm-accent-fg);
    }
    .btn.primary:active:not(:disabled) {
      border-color: var(--cm-accent-active);
      background: var(--cm-accent-active);
      color: var(--cm-accent-fg-active);
    }
    .btn:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .status[data-status='running'] {
      color: var(--cm-accent-text);
    }
    .status[data-status='succeeded'] {
      color: var(--cm-ok-text);
    }
    .status[data-status='failed'] {
      color: var(--cm-danger-text);
    }
    .log {
      margin: 6px 0 0;
      padding: 0;
      list-style: none;
      font-size: 12px;
    }
    .log li {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .log .tool {
      color: var(--cm-muted);
    }
    .result {
      margin: 6px 0 0;
      max-height: 160px;
      overflow: auto;
      padding: 6px;
      border-radius: var(--cm-radius-sm);
      background: var(--cm-bg);
      font: inherit;
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .problem {
      margin: 6px 0 0;
      padding: 6px 8px;
      border-radius: var(--cm-radius-sm);
      background: color-mix(in srgb, var(--cm-danger) 12%, transparent);
    }
    .problem p {
      margin: 0 0 6px;
    }
    .error {
      margin: 6px 0 0;
      color: var(--cm-danger-text);
      font-size: 12px;
    }
    .actions {
      display: flex;
      gap: 6px;
      margin-top: 6px;
    }
  `,
  template: `
    @let state = update();
    @if (state === undefined) {
      <p class="muted">{{ i18n.t('common.loading') }}</p>
    } @else if (state.status === 'error') {
      <cm-page-error pageId="skills" connection="claude" [message]="state.error" [code]="state.code" [args]="state.args" />
    } @else {
      @if (facade.error(); as message) {
        <p class="error" role="alert">{{ message }}</p>
      }
      <section class="section" [attr.aria-label]="i18n.t('skills.heading')">
        <h2 class="heading">{{ i18n.t('skills.heading') }}</h2>
        @for (skill of state.data.skills; track skill.id) {
          <div class="card row" [attr.data-skill]="skill.id">
            <div class="grow">
              <div class="name">{{ skill.name }}</div>
              <div class="muted">{{ i18n.t('skills.budget', { prompt: skill.prompt, budget: i18n.localizer().budget(skill.maxBudgetUsd) }) }}</div>
            </div>
            <button
              type="button"
              class="btn primary"
              data-action="run"
              [disabled]="isRunning(skill)"
              (click)="facade.run(skill.id)"
            >
              {{ i18n.t('skills.run') }}
            </button>
          </div>
        } @empty {
          <p class="muted">{{ i18n.t('skills.noSkills') }}</p>
        }
      </section>

      <section class="section" [attr.aria-label]="i18n.t('skills.runs')">
        <h2 class="heading">{{ i18n.t('skills.runs') }}</h2>
        @for (run of runViews(); track run.id) {
          <article class="card" [attr.data-run]="run.id" [attr.data-status]="run.status">
            <div class="row">
              <span class="name grow">{{ run.name }}</span>
              <span class="status" [attr.data-status]="run.status">{{ run.statusLabel }}</span>
              <span class="muted">{{ run.duration }}</span>
              @if (run.cost; as cost) {
                <span class="muted">{{ cost }}</span>
              }
            </div>

            @if (run.running) {
              <ul class="log">
                @for (entry of run.recentLog; track $index) {
                  <li [class.tool]="entry.kind === 'tool'">{{ entry.kind === 'tool' ? '⚙ ' + entry.text : entry.text }}</li>
                }
              </ul>
              <div class="actions">
                <button type="button" class="btn" data-action="cancel" (click)="facade.cancel(run.id)">{{ i18n.t('skills.cancel') }}</button>
              </div>
            }

            @if (run.error; as error) {
              <p class="error">{{ error }}</p>
            }

            @if (run.problem; as problem) {
              <div class="problem" role="alert" [attr.data-problem]="problem.fix">
                <p>{{ problem.message }}</p>
                <button type="button" class="btn primary" data-action="fix" (click)="fix(problem.fix, run.id)">{{ problem.label }}</button>
              </div>
            }

            @if (!run.running && run.resultText) {
              <pre class="result">{{ run.resultText }}</pre>
            }

            @if (run.canContinue) {
              <div class="actions">
                <button type="button" class="btn" data-action="continue" (click)="facade.continueInTerminal(run.id)">
                  {{ i18n.t('skills.continue') }}
                </button>
              </div>
            }
          </article>
        } @empty {
          <p class="muted">{{ i18n.t('skills.noRuns') }}</p>
        }
      </section>
    }
  `,
})
export class SkillsComponent {
  protected readonly facade = inject(SkillsFacade);
  protected readonly i18n = inject(I18n);
  private readonly pageState = inject(PageStateService);
  private readonly clock = inject(APPLICATION).clock;
  private readonly now = signal(this.clock.now());

  protected readonly update = computed(() => this.pageState.get(SKILLS_PAGE));
  protected readonly runViews = computed<RunView[]>(() => this.facade.runs().map((run) => toRunView(run, this.now(), this.i18n.localizer())));

  constructor() {
    const stop = this.clock.every(CLOCK_TICK_MS, () => this.now.set(this.clock.now()));
    inject(DestroyRef).onDestroy(stop);
  }

  protected isRunning(skill: SkillDefinition): boolean {
    return this.facade.runs().some((run) => run.skillId === skill.id && isRunning(run));
  }

  protected fix(fix: RunFix, runId: string): void {
    void this.facade.fix(fix, runId);
  }
}
