import { bootstrapApplication } from '@angular/platform-browser';
import { provideApplication } from './ui/shell/application.token';
import { AppComponent } from './ui/shell/app.component';
import { createComposition } from './composition-root';

bootstrapApplication(AppComponent, {
  providers: [provideApplication(createComposition())],
});
