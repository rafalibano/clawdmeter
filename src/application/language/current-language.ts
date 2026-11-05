import { DEFAULT_LANGUAGE, type AppLanguage } from '../../domain/settings';

export class CurrentLanguage {
  private language: AppLanguage = DEFAULT_LANGUAGE;

  get value(): AppLanguage {
    return this.language;
  }

  set(language: AppLanguage): void {
    this.language = language;
  }
}
