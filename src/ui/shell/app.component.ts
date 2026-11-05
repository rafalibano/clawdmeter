import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ThemeService } from '../theme/theme.service';
import { SettingsFacade } from './settings.facade';
import { ShellComponent } from './shell.component';

@Component({
  selector: 'cm-root',
  imports: [ShellComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (facade.ready()) {
    <cm-shell />
  }`,
})
export class AppComponent {
  protected readonly facade = inject(SettingsFacade);

  constructor() {
    inject(ThemeService);
  }
}
