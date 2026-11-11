export function toggleKey(open: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(open);
  if (!next.delete(key)) next.add(key);
  return next;
}

export function allOpen(open: ReadonlySet<string>, keys: readonly string[]): boolean {
  return keys.length > 0 && keys.every((key) => open.has(key));
}

export function toggleAllKeys(open: ReadonlySet<string>, keys: readonly string[]): ReadonlySet<string> {
  if (!allOpen(open, keys)) return new Set([...open, ...keys]);
  return new Set([...open].filter((key) => !keys.includes(key)));
}

export function pruneKeys(open: ReadonlySet<string>, keys: readonly string[]): ReadonlySet<string> {
  const kept = [...open].filter((key) => keys.includes(key));
  return kept.length === open.size ? open : new Set(kept);
}
