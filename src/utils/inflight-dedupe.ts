// Coalesces concurrent callers of the same no-arg read into a single underlying
// call. Home/Trends fire several endpoints in parallel that each independently
// re-fetch the same full table (e.g. studentRepo.findAll()) — this collapses
// those into one query per burst instead of one per caller. Safe only for reads
// whose result doesn't vary by caller (actor-scoping happens after the fetch).
const inflight = new Map<string, Promise<unknown>>();

export function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const p = fn().finally(() => {
    // Clear before this promise's own .then chain runs so a late arrival
    // during the same tick can't attach to an entry that's about to vanish,
    // and a rejection is never served to callers that show up after it settles.
    inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}

// Monkey-patches specific no-arg methods on a repo instance so concurrent
// callers within the same warm instance share one underlying call. Only apply
// to reads that don't vary by caller (e.g. findAll/getSettings) — actor-scoping
// must happen after the fetch, in the service layer, not inside the repo.
export function dedupeReads<T extends object>(
  instance: T,
  keyPrefix: string,
  methodNames: readonly (keyof T)[],
): T {
  for (const name of methodNames) {
    const original = (instance[name] as unknown as () => Promise<unknown>).bind(instance);
    (instance as Record<string, unknown>)[name as string] =
      () => dedupe(`${keyPrefix}:${String(name)}`, original);
  }
  return instance;
}
