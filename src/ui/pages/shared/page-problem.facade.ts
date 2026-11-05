import { Injectable, inject } from '@angular/core';
import { FIX_FOR, type ConnectionId, type ConnectionProblem } from '../../../domain/connections';
import { APPLICATION } from '../../shell/application.token';

@Injectable({ providedIn: 'root' })
export class PageProblemFacade {
  private readonly application = inject(APPLICATION);

  report(connection: ConnectionId, problem: ConnectionProblem, message: string): void {
    this.application.connections.report.execute(connection, problem, message);
  }

  async fix(pageId: string, connection: ConnectionId, problem: ConnectionProblem): Promise<void> {
    await this.application.connections.fix.execute(connection, FIX_FOR[problem]);
    await this.application.scheduler.refresh(pageId);
  }

  retry(pageId: string): Promise<void> {
    return this.application.scheduler.refresh(pageId);
  }
}
