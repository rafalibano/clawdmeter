import { buildForecasts, type ProjectionMethod, type UsageForecasts, type UsageHistory, type UsageSnapshot } from '../../../domain/usage';

export class ProjectUsage {
  execute(history: UsageHistory, snapshot: UsageSnapshot, now: number, method: ProjectionMethod): UsageForecasts {
    return buildForecasts(history, snapshot, now, method);
  }
}
