import { pageRef } from '../../../application/pages';

export interface ExampleData {
  loadedAt: number;
  loads: number;
}

export const EXAMPLE_PAGE = pageRef<ExampleData>('example');
