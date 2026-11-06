import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { isListboxKey, moveHighlight, type AccountSwitchView } from './account-switch-view';

@Component({
  selector: 'cm-account-switch',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './account-switch.component.html',
  styleUrl: './account-switch.component.scss',
  host: { '(focusout)': 'leave($event)', '(document:click)': 'outside($event)' },
})
export class AccountSwitchComponent {
  readonly view = input.required<AccountSwitchView>();
  readonly label = input.required<string>();
  readonly picked = output<string>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  protected readonly open = signal(false);
  protected readonly highlighted = signal(-1);
  protected readonly listId = `cm-account-list-${Math.random().toString(36).slice(2, 8)}`;
  protected readonly activeDescendant = computed(() => {
    const option = this.view().options[this.highlighted()];
    return option === undefined ? null : this.optionId(option.id);
  });

  protected optionId(accountId: string): string {
    return `${this.listId}-${accountId}`;
  }

  protected toggle(): void {
    if (this.open()) this.close(true);
    else this.show();
  }

  protected buttonKey(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    this.show();
  }

  protected listKey(event: KeyboardEvent): void {
    const options = this.view().options;
    if (isListboxKey(event.key)) {
      event.preventDefault();
      this.highlighted.set(moveHighlight(this.highlighted(), event.key, options.length));
      this.scrollHighlighted();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const option = options[this.highlighted()];
      if (option !== undefined) this.choose(option.id);
      return;
    }
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      this.close(event.key === 'Escape');
    }
  }

  protected choose(accountId: string): void {
    this.close(true);
    if (accountId !== this.view().activeId) this.picked.emit(accountId);
  }

  protected leave(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && this.host.contains(next)) return;
    this.close(false);
  }

  protected outside(event: MouseEvent): void {
    if (this.open() && event.target instanceof Node && !this.host.contains(event.target)) this.close(false);
  }

  private show(): void {
    const options = this.view().options;
    this.highlighted.set(Math.max(0, options.findIndex((option) => option.active)));
    this.open.set(true);
    afterNextRender(
      () => {
        this.host.querySelector<HTMLElement>('[role="listbox"]')?.focus();
        this.scrollHighlighted();
      },
      { injector: this.injector },
    );
  }

  private close(refocus: boolean): void {
    if (!this.open()) return;
    this.open.set(false);
    if (refocus) this.host.querySelector<HTMLElement>('.switch')?.focus();
  }

  private scrollHighlighted(): void {
    const id = this.activeDescendant();
    if (id !== null) this.host.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView?.({ block: 'nearest' });
  }
}
