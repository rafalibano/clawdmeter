import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

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

  private readonly chosen = signal<boolean | null>(null);
  protected readonly isOpen = computed(() => this.chosen() ?? this.defaultOpen());

  protected toggle(): void {
    this.chosen.set(!this.isOpen());
  }
}
