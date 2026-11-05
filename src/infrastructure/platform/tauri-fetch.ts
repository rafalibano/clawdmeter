import { fetch as pluginFetch } from '@tauri-apps/plugin-http';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const tauriFetch: FetchLike = (input, init) => pluginFetch(input, init);
