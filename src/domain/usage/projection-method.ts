export type ProjectionMethod = '24h' | '7d' | '14d' | 'since-reset';

export const PROJECTION_METHODS: readonly ProjectionMethod[] = ['24h', '7d', '14d', 'since-reset'];

export const DEFAULT_PROJECTION_METHOD: ProjectionMethod = '7d';

export function isProjectionMethod(value: unknown): value is ProjectionMethod {
  return PROJECTION_METHODS.includes(value as ProjectionMethod);
}
