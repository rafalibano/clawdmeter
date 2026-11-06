import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { ShellNavigation } from '../shell/shell-navigation.service';

@Component({
  selector: 'cm-settings-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="section" [attr.data-section]="name()">
      <button type="button" class="disclosure" [attr.aria-expanded]="isOpen()" (click)="toggle()">
        <span class="caret" aria-hidden="true">{{ isOpen() ? '▾' : '▸' }}</span>
        <span class="disclosure-title">{{ heading() }}</span>
        @if (!isOpen()) {
          <span class="summary"><ng-content select="[summary]" /></span>
        }
      </button>
      @if (isOpen()) {
        <ng-content />
      }
    </section>
  `,
  styleUrl: './settings-section.component.scss',
})
export class SettingsSectionComponent {
  readonly name = input.required<string>();
  readonly heading = input.required<string>();
  readonly defaultOpen = input(false);
  readonly openChange = output<boolean>();

  private readonly navigation = inject(ShellNavigation);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  private readonly chosen = signal<boolean | null>(null);
  protected readonly isOpen = computed(() => this.chosen() ?? this.defaultOpen());

  constructor() {
    effect(() => {
      const name = this.name();
      if (this.navigation.requestedSection() !== name) return;
      untracked(() => {
        this.chosen.set(true);
        this.navigation.consume(name);
        afterNextRender(
          () => {
            this.host.scrollIntoView?.({ block: 'start' });
            this.host.querySelector<HTMLElement>('.disclosure')?.focus();
          },
          { injector: this.injector },
        );
      });
    });
  }

  protected toggle(): void {
    const open = !this.isOpen();
    this.chosen.set(open);
    this.openChange.emit(open);
  }
}
