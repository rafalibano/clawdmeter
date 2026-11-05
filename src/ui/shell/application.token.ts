import { InjectionToken, type Provider } from '@angular/core';
import type { Application } from '../../application/application';

export const APPLICATION = new InjectionToken<Application>('APPLICATION');

export function provideApplication(application: Application): Provider {
  return { provide: APPLICATION, useValue: application };
}
