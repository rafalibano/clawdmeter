import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import type { PullRequestSection } from '../../../application/pull-requests';
import { formatAge, type PullRequest, type PullRequestGroup, type SlaLevel } from '../../../domain/pull-requests';
import { APPLICATION } from '../../shell/application.token';
import { badgesFor, slaFor, type PullRequestBadge } from './pull-request-view';

const SLA_TITLES: Record<SlaLevel, string> = {
  fresh: 'Dentro do prazo',
  attention: 'Aberto há 3 dias ou mais',
  overdue: 'Aberto há 7 dias ou mais',
};

@Component({
  selector: 'dp-pull-request-sections',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .section {
      margin-bottom: 16px;
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
      color: var(--dp-muted);
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
      border-radius: var(--dp-radius-sm);
      background: var(--dp-surface);
      color: inherit;
      font-weight: 600;
      text-align: left;
      cursor: pointer;
    }
    .chevron {
      width: 10px;
      color: var(--dp-muted);
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
      border-bottom: 1px solid var(--dp-border);
      background: transparent;
      color: inherit;
      text-align: left;
      cursor: pointer;
    }
    .pr[data-sla='attention'] {
      border-left-color: var(--dp-sla-attention);
    }
    .pr[data-sla='overdue'] {
      border-left-color: var(--dp-danger);
    }
    .pr:hover {
      background: var(--dp-surface);
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
      color: var(--dp-muted);
      font-size: 11px;
    }
    .badge {
      padding: 0 6px;
      border-radius: var(--dp-radius-pill);
      border: 1px solid var(--dp-border);
      font-size: 11px;
    }
    .badge[data-tone='ok'] {
      color: var(--dp-ok-text);
      border-color: color-mix(in srgb, var(--dp-ok) 50%, transparent);
    }
    .badge[data-tone='info'] {
      color: var(--dp-info-text);
      border-color: color-mix(in srgb, var(--dp-info) 50%, transparent);
    }
    .badge[data-tone='bad'] {
      color: var(--dp-danger-text);
      border-color: color-mix(in srgb, var(--dp-danger) 50%, transparent);
    }
    .age[data-sla] {
      padding: 0 6px;
      border: 1px solid var(--dp-border);
      border-radius: var(--dp-radius-pill);
    }
    .age[data-sla='attention'] {
      border-color: var(--dp-sla-attention);
      background: var(--dp-sla-attention);
      color: var(--dp-sla-fg);
    }
    .age[data-sla='overdue'] {
      border-color: var(--dp-danger);
      background: var(--dp-danger);
      color: var(--dp-sla-fg);
    }
    .link {
      padding: 0;
      border: 0;
      background: none;
      color: var(--dp-accent-text);
      font-size: 12px;
      cursor: pointer;
    }
    .empty {
      margin: 6px 0;
      color: var(--dp-muted);
    }
  `,
  template: `
    @for (section of sections(); track section.id) {
      <section class="section" [attr.data-section]="section.id">
        <h2 class="heading">
          <span>{{ section.title }}</span>
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
            <span class="group-title">{{ group.title }}</span>
            <span class="count">{{ group.items.length }}</span>
          </button>
          @if (isOpen(section, group)) {
            @for (pr of group.items; track pr.id) {
              <button type="button" class="pr" [attr.data-pr]="pr.id" [attr.data-sla]="sla(pr)" [attr.title]="pr.title" (click)="open(pr)">
                <span class="title">{{ pr.title }}</span>
                <span class="meta">
                  <span>#{{ pr.number }}</span>
                  @if (showAuthor()) {
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
          <p class="empty">Nada por aqui.</p>
        }
        @if (section.total > section.shown) {
          <p class="muted">
            Mostrando {{ section.shown }} de {{ section.total }}.
            <button type="button" class="link" data-action="open-search" (click)="openUrl(section.searchUrl)">Ver todos no GitHub</button>
          </p>
        }
      </section>
    }
  `,
})
export class PullRequestSectionsComponent {
  private readonly openGitHubUrl = inject(APPLICATION).openGitHubUrl;
  private readonly toggled = signal<ReadonlySet<string>>(new Set());

  readonly sections = input.required<readonly PullRequestSection[]>();
  readonly now = input.required<number>();
  readonly showAuthor = input(false);

  protected countLabel(section: PullRequestSection): string {
    return section.total > section.shown ? `${section.shown}+` : String(section.shown);
  }

  protected isOpen(section: PullRequestSection, group: PullRequestGroup): boolean {
    const flipped = this.toggled().has(this.key(section, group));
    return group.collapsedByDefault ? flipped : !flipped;
  }

  protected toggle(section: PullRequestSection, group: PullRequestGroup): void {
    const key = this.key(section, group);
    this.toggled.update((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  protected age(pr: PullRequest): string {
    return formatAge(pr.createdAt, this.now());
  }

  protected sla(pr: PullRequest): SlaLevel | null {
    return slaFor(pr, this.now());
  }

  protected slaTitle(pr: PullRequest): string | null {
    const level = this.sla(pr);
    return level === null ? null : SLA_TITLES[level];
  }

  protected badges(pr: PullRequest): PullRequestBadge[] {
    return badgesFor(pr);
  }

  protected open(pr: PullRequest): void {
    this.openUrl(pr.url);
  }

  protected openUrl(url: string): void {
    void this.openGitHubUrl.execute(url).catch(() => undefined);
  }

  private key(section: PullRequestSection, group: PullRequestGroup): string {
    return `${section.id}/${group.key}`;
  }
}
