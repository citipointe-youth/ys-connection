# Batch endpoint — one composed request per screen

**Date:** 2026-07-05
**Status:** Approved (design), pending implementation plan
**Motivation:** Production performance incident. Live load testing (2026-07-05) proved the
binding limit is Supavisor's free-tier **client-connection cap (`EMAXCONN`, limit 200)**, not
the `max_connections=60` backend limit. Each Vercel serverless instance opens up to `max`
pooler connections; under a concurrent burst Vercel spins up many instances, so total pooler
connections = `instances × max`. CMS pages fan out **5–9 separate API requests each**, which
multiplies invocations → instances → connections. Even 3 simultaneous Home loads currently
break (`max:2` baseline: 7 of 24 requests hit the 20s timeout). The sister Youth Camp Platform
is stable because it serves **one aggregated `/home` DTO per page** (~1 request/page vs 5–9).

## Goal

Collapse each screen's initial-load fan-out into a **single server-side-composed request**,
so a page load is 1 serverless invocation instead of 5–9. Target: every screen under 5s with
30–40 leaders using the app simultaneously, on the Supabase free tier.

Net connection math after this change: 30 users loading Home → 30 batch requests → ≤30
instances × `max:2` = **60 pooler connections**, comfortably under the 200 ceiling (and far
lower if Vercel Fluid Compute is enabled to pack requests onto fewer instances).

## Non-goals (YAGNI — explicitly out of this spec)

- Routing the on-demand, parameterized per-leader endpoints (`/connections/leader/:id/followup`,
  `/connections/leader/:id/summary`) through batch. They are click-triggered, not part of the
  initial-load spike, and take a `leaderId`.
- The `plannedupdate.md` precompute work (attended-latest booleans at import). Separate, sequenced
  after this lands and is measured.
- Removing or changing any existing endpoint. Batch is purely **additive**.
- Changing pool size, the timeout/soft-cancel machinery, or the diagnostics. Unchanged.

## The endpoint

`GET /batch?sections=overview,trends,connections` — `auth: true`.

- **Input:** `sections` = comma-separated list of section keys (validated against a whitelist).
- **Behavior:** resolve the actor context once (existing auth middleware), then run each
  requested section's handler concurrently via **`Promise.allSettled`** within this single
  invocation.
- **Output:** `{ results: Record<Section, unknown>, errors: Record<Section, string> }`
  - A fulfilled section → its DTO under `results[key]`.
  - A rejected section → a short message under `errors[key]` (the page renders everything else).
  - An unknown/unpermitted-for-this-role section key → an entry under `errors[key]`
    (`"unknown section"`), known sections still processed (tolerant of SPA version skew).
- **Bounded:** cap the number of sections per call to the whitelist size; ignore duplicates.

### Section registry (server-side)

A single map from section key → a function taking the resolved actor `ctx` and returning the
DTO, reusing the **existing services verbatim** (so RBAC scoping and per-service `ResponseCache`
are inherited, never reimplemented):

| Section key | Composed call |
|---|---|
| `overview` | `services.overview.getStats(ctx)` |
| `trends` | `services.trends.get(ctx)` |
| `students` | `services.student.list(ctx, {})` |
| `lifegroupStats` | `services.lifegroupStats.get(ctx)` |
| `connections` | `services.connection.listAll(ctx)` |
| `atRisk` | `services.atRisk.list(ctx)` |
| `settings` | `services.settings.get()` (takes no ctx) |
| `leaders` | `services.leader.list(ctx)` |

The batch handler/controller is constructed in `router.ts` with access to all these services
(the composition root already builds them). Validation of `sections` is done with Zod inside the
handler, per the repo's "validation inside the service/handler" rule.

### Why this is faster (two properties fall out for free)

1. **Query dedup finally works across a page.** `dedupeReads` (`src/utils/inflight-dedupe.ts`)
   coalesces concurrent no-arg repo reads (`students.findAll()`, etc.) — but only *within one
   invocation*. Today `/overview`, `/trends`, `/students`, `/lifegroups/stats` are separate
   invocations, so their shared `findAll()`s can't coalesce. Inside one batch invocation they
   collapse to one query each: fewer queries AND one pooler connection-set per page.
2. **Graceful partial render.** `allSettled` means one slow/failed section doesn't sink the page;
   the SPA renders the sections that succeeded. This also addresses the reported
   *"doesn't show all the data"* symptom (all-or-nothing → best-effort).

### Timeout / connection behavior

- `/batch` is a normal timed route (NOT in `UNTIMED_ROUTES`), so it keeps the 20s `withTimeout`
  ceiling. With deduped, fast queries running in parallel it should finish well under that.
- It runs on one instance with `max:2`; the deduped distinct queries (students, sessions,
  attendance, lifegroups, weeks, connections, leaders — each once) pipeline 2-at-a-time. Small
  data (677 students, ~22k/2.9k attendance rows), so a few round trips → sub-second in the warm
  case.

## SPA integration (minimal, `public/index.html`)

Principle: **batch seeds the existing per-endpoint client cache**, so existing screen renderers
work unchanged.

1. **`SECTION_TO_PATH` map** (SPA): `overview→'/overview'`, `trends→'/trends'`,
   `students→'/students'`, `lifegroupStats→'/lifegroups/stats'`, `connections→'/connections'`,
   `atRisk→'/at-risk'`, `settings→'/settings'`, `leaders→'/leaders'`.
2. **`API.batch(sections)` helper**: `GET /batch?sections=…`, then for each returned section,
   `Cache.set(SECTION_TO_PATH[key], results[key])`. Sections in `errors` are left uncached (a
   later individual read or revalidate can retry them). Drives `#nprog` as one request.
3. **`_prefetch()`** fires **one** `API.batch([...all common sections])` instead of ~7 parallel
   `API.get()`s. Existing renderers (`Cache.get('/overview')`, etc.) hit the seeded cache.
4. **Per-screen stale revalidation**: each `_revalidate<Page>()` helper calls `API.batch(<that
   screen's sections>)` instead of firing that screen's individual endpoints. Screens keep their
   existing `<PAGE>_PATHS` + stale-while-revalidate structure; only the fetch call changes.
5. **Service worker** (`public/sw.js`): add `batch` to `API_RE` (network-only, never
   cache-first — critical, per the documented `API_RE` gotcha) and bump the cache name
   (`cms-v21` → `cms-v22`).

Screens still read from `Cache` by the same keys; a cache miss for an individual endpoint (e.g.
a direct `API.get('/overview')` still used somewhere) continues to hit the individual endpoint —
those endpoints remain live. So this degrades safely if any screen isn't migrated.

## Error handling

- Section-level: `allSettled` → `errors[key]`. SPA renders present sections; a section in
  `errors` shows that screen-section's normal empty/error state.
- Endpoint-level: invalid `sections` param (empty, all-unknown) → the handler returns
  `{ results:{}, errors:{…} }` with 200 (partial-success semantics), not a hard 4xx, so a
  version-skewed SPA never hard-fails a page load. (A completely missing `sections` param → 400.)

## Testing

- **New:** `src/tests/batch.controller.test.ts` (or `batch.service.test.ts`) — in-memory
  services: (a) requested sections composed into `results`; (b) an unknown section lands in
  `errors`, known ones still returned; (c) a section whose service throws lands in `errors`
  while siblings succeed (allSettled behavior); (d) RBAC — a grade actor's batch returns the
  same scoped data the individual endpoints return (compose the existing scoping, don't bypass).
- **Regression:** existing per-endpoint tests unchanged (endpoints untouched).
- **Load verification:** re-run the controlled load test (`scratchpad/loadtest.mjs`) against a
  Home that uses `/batch`; expect the EMAXCONN 500s and 20s timeouts to disappear at 10–30
  concurrent Home loads. This is the acceptance criterion.

## Rollout / revert

- Additive endpoint + SPA prefetch swap + SW bump. Revert = point `_prefetch`/revalidate back at
  the individual `API.get()`s and drop `batch` from `API_RE`; the backend endpoint can stay
  (harmless if unused).
- Ship backend + SPA together (the SW `controllerchange` auto-reload picks up the new SPA).

## Acceptance criteria

1. `GET /batch?sections=…` returns composed `{results,errors}`, RBAC-scoped identically to the
   individual endpoints (verified by tests).
2. Home (and the migrated screens) issue **one** batch request on load instead of 5–9.
3. Controlled load test at 10–30 concurrent Home loads shows **no `EMAXCONN` 500s and no 20s
   timeouts** (vs the current baseline where 3 concurrent already fails).
4. `npm run typecheck` clean, `npm run test` green, SPA `node --check` OK.
