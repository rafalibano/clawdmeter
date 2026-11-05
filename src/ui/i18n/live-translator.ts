import type { CurrentLanguage } from '../../application/language';
import type { ApplicationMessageKey, MessageArgs, Translator } from '../../application/ports';
import { Localizer } from './localizer';

export class LiveTranslator implements Translator {
  constructor(private readonly current: CurrentLanguage) {}

  get locale(): string {
    return this.localizer.locale;
  }

  t(key: ApplicationMessageKey, args?: MessageArgs): string {
    return this.localizer.t(key, args);
  }

  cost(usd: number): string {
    return this.localizer.cost(usd);
  }

  private get localizer(): Localizer {
    return new Localizer(this.current.value);
  }
}
