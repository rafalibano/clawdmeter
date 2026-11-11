export interface LatestJson {
  version: string;
  notes: string;
  pub_date: string;
  platforms: Record<string, { signature: string; url: string }>;
}

export function buildLatestJson(input: {
  repo: string;
  tag: string;
  notes: string;
  pubDate: string;
  assetNames: string[];
  signatures: Record<string, string>;
}): LatestJson;
