# Architecture and key names

## Architecture

```
api (Express) → controllers → services → repositories (interfaces) → core
```

- **`src/core/`** — pure types, entities, enums, Zod schemas, errors. No imports from other layers.
- **`src/repositories/`** — interfaces (DB-swap surface) + in-memory implementations + `supabase/` layer.
- **`src/services/`** — all business logic + RBAC. Depend on repo *interfaces* only.
- **`src/api/`** — thin controllers → declarative route table (`http/router.ts`) → Express adapter. An `auth: true` route's handler takes `AuthedRequest` (`ctx` is non-null): the adapter returns 401 before it runs, so controllers do not re-check `req.ctx` (`auth-routes.test.ts` pins the 401 for every such route).
- **`src/container.ts`** — composition root. The ONLY file that names concrete repositories.
- **`src/app.ts`** — `createAppInstance()` factory: builds container, seeds data if `PERSISTENCE=memory`, builds routes.
- **`api/index.ts`** — Vercel serverless entry point; calls `createAppInstance()` and delegates to Express.

### Persistence modes

| `PERSISTENCE` | Backend |
|---|---|
| `memory` (default) | In-memory; seed data runs on startup |
| `supabase` | Supabase (Sydney); requires `DATABASE_URL` |

Seed data only runs when `PERSISTENCE=memory`. Production uses `PERSISTENCE=supabase`.

### Key service + repository names

- `ConnectionService` / `makeConnectionService` — connects students to leaders
- `IConnectionRepository` / `InMemoryConnectionRepository` / `SupabaseConnectionRepository`
- Supabase repositories live in `src/repositories/supabase/`
- `ministryConfig` (`src/core/ministry-config.ts`, `MinistryConfigSchema` + `MINISTRY_CONFIG_DEFAULTS`) is the single source of truth every repo and the SPA read from for per-deployment configuration (branding, labels, structure, roles, modules). Stored as `app_settings.ministry_config` jsonb; `PATCH /settings` deep-merges via `mergeMinistryConfig`. UI copy goes through `L(key)` labels; features through `modules.*` toggles. Setup presets (kept by ruling D3, 2026-10-19): a preset tap asks first, then sets only the fields some preset defines (cohort model, gender rule, Oversight/Quad, Connection Audit, Lifegroups, Export guides) from `MINISTRY_CONFIG_DEFAULTS` + that preset, so presets never pile up; every other field (link modules, intake, Bus, branding, labels, logins) is kept (CY-D1, `r19-preset-guard.spa.test.ts`). Status/quad colours are deliberately NOT configurable (categorical, not brand).
- `GET /manifest.json` is a dynamic route; there is no static `public/manifest.json` because Express serves static files before the route table, so a static file would shadow the route.
- Route timeout: every route fails fast with a retryable 503 after 20s (the 20 s guard in `express-adapter.ts`); CSV/audit import routes are exempt (`UNTIMED_ROUTES`), as is New person.
- `dedupeReads()` (`src/utils/inflight-dedupe.ts`): concurrent no-arg repo reads share one in-flight promise. Applied once, centrally, in `container.ts` at repo-construction time (Supabase repos only). `GET /batch` composes the stats services into one request.
- Stats caches (`overview`, `trends`, `lifegroup-stats`, 60 s, actor-keyed via `src/services/actor-key.ts`): **Known accepted trade-off**: invalidation is still manually sprinkled per mutation, not centrally enforced — a future write path that forgets to call `invalidate*Cache()` will silently serve stale data for up to 60s.
- Imports: both importers' delete+repopulate phases run inside one Postgres transaction (`sql.begin()`) when `PERSISTENCE=supabase` (`with-transaction.ts`, `bindImportRepos(tx)`).
- `APP_ORIGIN` env var: production CORS falls back to it before the hard-coded prod URL.

## Identity and house code rules (from the old root)

**YS Connection** (`ys-connection`, formerly `connection-made-simple`) — a youth ministry platform for YS Brisbane. Phone-first SPA backed by a TypeScript/Express API. Students are *connected* to leaders; "connection" is the core relationship entity. Backend-agnostic architecture identical in structure to the Youth Camp Platform.

- **GitHub:** `citipointe-youth/ys-connection` (migrated from `987tom1` 2026-06-22; renamed from `connection-made-simple` → `youth-connection` → `ys-connection` 2026-07-11; org owns the GitHub repo, Supabase org, and Vercel team)
- **Deployed:** https://ys-connection.vercel.app (Vercel team `citipointe-youth`; every `master` push builds and Vercel auto-promotes it to production)
- **Deploy:** state in `DEPLOY.md`; ship with `/ship` (`bash scripts/ship.sh <branch>`). Pushing `master` builds and goes live (auto-promote, since 2026-10-20).
- **UI release window (operator 2026-10-21):** Restart/ship blocked only Friday 17:30-20:00 and Sunday 10:00-12:00 (site time); any other time is fine. `scripts/ship.sh` has no gate for this: it is a rule for the shipper (ship and promote outside those windows).
- **Supabase:** Sydney region (`ap-southeast-2`), project ref `ltcblcudlzlzfcyzlhpc` — `PERSISTENCE=supabase` + `DATABASE_URL` env var
- **RBAC in one file**: `src/services/access-control.ts`. Never scatter role checks.
- **Validation inside services**: all external input parsed with Zod inside the service.
- **Repos return deep clones**: base repository clones on every read/write.
- **Extensionless imports**: ESM, `moduleResolution: "Bundler"`, no `.js` extensions.
- **Strict TypeScript**: `strict` + `noUncheckedIndexedAccess` + `noImplicitOverride`.
- **Writer rule (operator 2026-10-15):** new writers ship live (VERIFIED true); there is no practice/shadow stage and no operator first-click lock. Claude still never writes to live Elvanto or the prod DB itself.

Old root header (superseded by this slim set):
Guidance for Claude Code when working in this package. **Current truth first.** Every dated section up to 2026-10-15 lives in `docs/HISTORY.md`, verbatim and newest first, with an index; when the two disagree, this file wins on what is true now. `debug.md` is the symptom router (incidents, gotchas by symptom). The pre-trim file is `git show a71a2c0:CLAUDE.md`. Dated sections of the current round sit under "Current round" for one round, then move to `docs/HISTORY.md`.
