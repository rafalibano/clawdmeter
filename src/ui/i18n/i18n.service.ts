import { Injectable, computed, inject } from '@angular/core';
import type { ConnectionAction, ConnectionProblem } from '../../domain/connections';
import type { ErrorArgs, ErrorCode } from '../../domain/coded-error';
import { GITHUB_ORG } from '../../domain/connections';
import { SettingsFacade } from '../shell/settings.facade';
import { Localizer, hasMessage, type MessageArgs, type MessageKey } from './localizer';

@Injectable({ providedIn: 'root' })
export class I18n {
  private readonly settings = inject(SettingsFacade);

  readonly localizer = computed(() => new Localizer(this.settings.settings().language));
  readonly language = computed(() => this.settings.settings().language);

  t(key: MessageKey, args?: MessageArgs): string {
    return this.localizer().t(key, args);
  }

  pageTitle(id: string, fallback: string): string {
    const key = `page.${id}`;
    return hasMessage(key) ? this.t(key) : fallback;
  }

  problemText(problem: ConnectionProblem): string {
    return this.t(`problem.${problem}`, { org: GITHUB_ORG });
  }

  actionText(action: ConnectionAction): string {
    return this.t(`action.${action.label}`);
  }

  errorText(error: { error: string; problem?: ConnectionProblem; code?: ErrorCode; args?: ErrorArgs }): string {
    if (error.code !== undefined) return this.t(`error.${error.code}`, error.args);
    if (error.problem !== undefined && error.error === error.problem) return this.problemText(error.problem);
    return error.error;
  }
}
