/** Wraps an async probe so it runs at most once per `ttlMs` per instance; concurrent callers share one call. */
export function cachedProbe<T>(probe: () => Promise<T>, ttlMs: number, now: () => number = Date.now): () => Promise<T> {
  let value: { v: T; at: number } | null = null;
  let inflight: Promise<T> | null = null;
  return async () => {
    if (value && now() - value.at < ttlMs) return value.v;
    if (inflight) return inflight;
    inflight = probe().then((v) => { value = { v, at: now() }; return v; }).finally(() => { inflight = null; });
    return inflight;
  };
}
