import type { ConnectionId } from '../../domain/connections';
import { isPageEnabled, type AppSettings, type PageId } from '../../domain/settings';
import type { PageModule } from './page-module';

export class PageRegistry {
  private readonly modules = new Map<PageId, PageModule>();

  constructor(modules: readonly PageModule[]) {
    for (const module of modules) {
      if (this.modules.has(module.id)) throw new Error(`Duplicate page: ${module.id}`);
      this.modules.set(module.id, module);
    }
  }

  all(): PageModule[] {
    return [...this.modules.values()];
  }

  get(id: PageId): PageModule | undefined {
    return this.modules.get(id);
  }

  enabled(settings: AppSettings): PageModule[] {
    return this.all().filter((module) => isPageEnabled(settings, module.id));
  }

  requiredConnections(settings: AppSettings): ConnectionId[] {
    const connections = new Set<ConnectionId>();
    for (const module of this.enabled(settings)) {
      for (const connection of module.requiredConnections) connections.add(connection);
    }
    return [...connections];
  }

  listedConnections(settings: AppSettings): ConnectionId[] {
    const connections = new Set<ConnectionId>(this.requiredConnections(settings));
    for (const module of this.enabled(settings)) {
      for (const connection of module.optionalConnections?.(settings) ?? []) connections.add(connection);
    }
    return [...connections];
  }
}
