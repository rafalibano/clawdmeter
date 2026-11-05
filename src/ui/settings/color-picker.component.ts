import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { I18n } from '../i18n';
import type { AccentPreset } from '../theme/accent-presets';
import { parseHexInput } from '../theme/color';

@Component({
  selector: 'dp-color-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './color-picker.component.html',
  styleUrl: './color-picker.component.scss',
})
export class ColorPickerComponent {
  protected readonly i18n = inject(I18n);

  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly presets = input.required<readonly AccentPreset[]>();
  readonly marked = input(true);
  readonly picked = output<string>();

  private readonly draft = signal<string | null>(null);

  protected readonly text = computed(() => this.draft() ?? this.value());
  protected readonly invalid = computed(() => this.draft() !== null && parseHexInput(this.draft() ?? '') === null);

  protected pick(color: string): void {
    this.draft.set(null);
    this.picked.emit(color);
  }

  protected type(event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    this.draft.set(text);
    const color = parseHexInput(text);
    if (color !== null) this.picked.emit(color);
  }

  protected settle(): void {
    this.draft.set(null);
  }
}
