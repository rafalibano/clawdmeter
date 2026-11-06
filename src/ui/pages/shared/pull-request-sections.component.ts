import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { PullRequestSection } from '../../../application/pull-requests';
import { DEPLOY_GROUP_KEY, formatAge, type PullRequest, type PullRequestGroup, type SlaLevel } from '../../../domain/pull-requests';
import { I18n } from '../../i18n';
import { APPLICATION } from '../../shell/application.token';
import { hasGroups } from './pull-request-groups';
import { PullRequestGroupsState } from './pull-request-groups.state';
import { badgesFor, slaFor, type PullRequestBadge } from './pull-request-view';

@Component({
  selector: 'cm-pull-request-sections',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .toolbar {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 6px;
    }
    .toggle-all {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 6px;
      border: 0;
      border-radius: var(--cm-radius-sm);
      background: transparent;
      color: var(--cm-muted);
      font-size: 12px;
      cursor: pointer;
    }
    .toggle-all:hover {
      background: var(--cm-hover);
      color: var(--cm-fg);
    }
    .section {
      margin-bottom: 18px;
    }
    .heading {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      margin: 0 0 6px;
      font-size: 13px;
      font-weight: 600;
    }
    .count,
    .muted {
      color: var(--cm-muted);
      font-size: 12px;
      font-weight: 400;
    }
    .group-head {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 4px 6px;
      border: 0;
      border-radius: var(--cm-radius-sm);
      background: var(--cm-surface);
      color: inherit;
      font-weight: 600;
      text-align: left;
      cursor: pointer;
    }
    .chevron {
      width: 10px;
      color: var(--cm-muted);
    }
    .group-title {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pr {
      display: block;
      width: 100%;
      padding: 6px 8px;
      border: 0;
      border-left: 3px solid transparent;
      border-bottom: 1px solid var(--cm-border);
      background: transparent;
      color: inherit;
      text-align: left;
      cursor: pointer;
    }
    .pr[data-sla='attention'] {
      border-left-color: var(--cm-sla-attention);
    }
    .pr[data-sla='overdue'] {
      border-left-color: var(--cm-danger);
    }
    .pr:hover {
      background: var(--cm-hover);
    }
    .title {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-top: 2px;
      color: var(--cm-muted);
      font-size: 11px;
    }
    .badge {
      padding: 0 6px;
      border-radius: var(--cm-radius-pill);
      border: 1px solid var(--cm-control-border);
      font-size: 11px;
    }
    .badge[data-tone='ok'] {
      color: var(--cm-ok-text);
      border-color: color-mix(in srgb, var(--cm-ok) 50%, transparent);
    }
    .badge[data-tone='info'] {
      color: var(--cm-info-text);
      border-color: color-mix(in srgb, var(--cm-info) 50%, transparent);
    }
    .badge[data-tone='bad'] {
      color: var(--cm-danger-text);
      border-color: color-mix(in srgb, var(--cm-danger) 50%, transparent);
    }
    .age[data-sla] {
      padding: 0 6px;
      border: 1px solid var(--cm-border);
      border-radius: var(--cm-radius-pill);
    }
    .age[data-sla='attention'] {
      border-color: var(--cm-sla-attention);
      background: var(--cm-sla-attention);
      color: var(--cm-sla-fg);
    }
    .age[data-sla='overdue'] {
      border-color: var(--cm-danger);
      background: var(--cm-danger);
      color: var(--cm-sla-fg);
    }
    .link {
      padding: 0;
      border: 0;
      background: none;
      color: var(--cm-accent-text);
      font-size: 12px;
      cursor: pointer;
    }
    .empty {
      margin: 6px 0;
      color: var(--cm-muted);
    }
  `,
  template: `
    @if (hasGroups()) {
      <div class="toolbar">
        <button type="button" class="toggle-all" data-action="toggle-all" (click)="toggleAll()">
          <span aria-hidden="true">{{ allOpen() ? '▾' : '▸' }}</span>
          {{ allOpen() ? i18n.t('prs.collapseAll') : i18n.t('prs.expandAll') }}
        </button>
      </div>
    }
    @for (section of sections(); track section.id) {
      <section class="section" [attr.data-section]="section.id">
        <h2 class="heading">
          <span>{{ sectionTitle(section) }}</span>
          <span class="count">{{ countLabel(section) }}</span>
        </h2>
        @for (group of section.groups; track group.key) {
          <button
            type="button"
            class="group-head"
            [attr.data-group]="group.key"
            [attr.aria-expanded]="isOpen(section, group)"
            (click)="toggle(section, group)"
          >
            <span class="chevron" aria-hidden="true">{{ isOpen(section, group) ? '▾' : '▸' }}</span>
            <span class="group-title">{{ groupTitle(group) }}</span>
            <span class="count">{{ group.items.length }}</span>
          </button>
          @if (isOpen(section, group)) {
            @for (pr of group.items; track pr.id) {
              <button type="button" class="pr" [attr.data-pr]="pr.id" [attr.data-sla]="sla(pr)" [attr.title]="pr.title" (click)="open(pr)">
                <span class="title">{{ pr.title }}</span>
                <span class="meta">
                  <span>#{{ pr.number }}</span>
                  @if (section.showAuthor) {
                    <span>{{ pr.author }}</span>
                  }
                  <span class="age" [attr.data-sla]="sla(pr)" [attr.title]="slaTitle(pr)">{{ age(pr) }}</span>
                  @for (badge of badges(pr); track badge.label) {
                    <span class="badge" [attr.data-tone]="badge.tone">{{ badge.label }}</span>
                  }
                </span>
              </button>
            }
          }
        } @empty {
          <p class="empty">{{ i18n.t('prs.empty') }}</p>
        }
        @if (section.total > section.shown) {
          <p class="muted">
            {{ i18n.t('prs.showing', { shown: section.shown, total: section.total }) }}
            <button type="button" class="link" data-action="open-search" (click)="openUrl(section.searchUrl)">{{ i18n.t('prs.seeAll') }}</button>
          </p>
        }
      </section>
    }
  `,
})
export class PullRequestSectionsComponent {
  private readonly openGitHubUrl = inject(APPLICATION).openGitHubUrl;
  private readonly groups = inject(PullRequestGroupsState);
  protected readonly i18n = inject(I18n);

  readonly scope = input.required<string>();
  readonly sections = input.required<readonly PullRequestSection[]>();
  readonly now = input.required<number>();

  protected countLabel(section: PullRequestSection): string {
    return section.total > section.shown ? `${section.shown}+` : String(section.shown);
  }

  protected readonly hasGroups = computed(() => hasGroups(this.sections()));
  protected readonly allOpen = computed(() => this.groups.allOpen(this.scope(), this.sections()));

  protected sectionTitle(section: PullRequestSection): string {
    return this.i18n.t(`prs.section.${section.id as 'mine' | 'assigned' | 'to-review' | 'reviewed'}`);
  }

  protected groupTitle(group: PullRequestGroup): string {
    return group.key === DEPLOY_GROUP_KEY ? this.i18n.t('prs.group.deploy') : group.title;
  }

  protected isOpen(section: PullRequestSection, group: PullRequestGroup): boolean {
    return this.groups.isOpen(this.scope(), section.id, group);
  }

  protected toggle(section: PullRequestSection, group: PullRequestGroup): void {
    this.groups.toggle(this.scope(), section.id, group);
  }

  protected toggleAll(): void {
    this.groups.toggleAll(this.scope(), this.sections());
  }

  protected age(pr: PullRequest): string {
    return formatAge(pr.createdAt, this.now());
  }

  protected sla(pr: PullRequest): SlaLevel | null {
    return slaFor(pr, this.now());
  }

  protected slaTitle(pr: PullRequest): string | null {
    const level = this.sla(pr);
    return level === null ? null : this.i18n.t(`prs.sla.${level}`);
  }

  protected badges(pr: PullRequest): PullRequestBadge[] {
    return badgesFor(pr, this.i18n.localizer());
  }

  protected open(pr: PullRequest): void {
    this.openUrl(pr.url);
  }

  protected openUrl(url: string): void {
    void this.openGitHubUrl.execute(url).catch(() => undefined);
  }
}
