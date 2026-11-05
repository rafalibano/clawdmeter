import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { PageStateService } from '../../shell/page-state.service';
import { SESSIONS_PAGE } from './sessions-page-ref';
import { toSessionsView } from './sessions-view';

@Component({
  selector: 'dp-sessions-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sessions.component.html',
  styleUrl: './sessions.component.scss',
})
export class SessionsComponent {
  private readonly update = inject(PageStateService).of(SESSIONS_PAGE);

  protected readonly view = computed(() => {
    const update = this.update();
    return update?.status === 'ok' ? toSessionsView(update.data) : null;
  });

  protected readonly error = computed(() => {
    const update = this.update();
    return update?.status === 'error' ? update.error : null;
  });
}
