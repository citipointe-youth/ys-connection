# CLAUDE.md — Connection Made Simple

> **Scope:** the real **Connection Made Simple** app — TS/Express backend (`src/`) + `public/index.html` SPA. The offline demo and its full UI conventions live in `../youth app demo/CLAUDE.md`; this SPA is kept aligned to that demo. Project map: `../CLAUDE.md`.

Guidance for Claude Code when working in this package.

## What this is

**Connection Made Simple** (`connection-made-simple`) — a youth ministry platform for YS Brisbane. Phone-first SPA backed by a TypeScript/Express API. Students are *connected* to leaders; "connection" is the core relationship entity. Backend-agnostic architecture identical in structure to the Youth Camp Platform.

- **GitHub:** `987tom1/connection-made-simple`
- **Deployed:** https://connection-made-simple.vercel.app
- **Supabase:** Sydney region (`ap-southeast-2`) — `PERSISTENCE=supabase` + `DATABASE_URL` env var

## Commands

```bash
npm install
npm run dev          # backend + frontend on http://localhost:4300 (tsx watch)
npm run start        # same, no watch
npm run typecheck    # tsc --noEmit (strict)
npm run test         # vitest (71 tests)
```

Default port: **4300**. Set `PORT=xxxx` to override.

## Architecture

```
api (Express) → controllers → services → repositories (interfaces) → core
```

- **`src/core/`** — pure types, entities, enums, Zod schemas, errors. No imports from other layers.
- **`src/repositories/`** — interfaces (DB-swap surface) + in-memory implementations + JSON file persistence + `supabase/` layer.
- **`src/services/`** — all business logic + RBAC. Depend on repo *interfaces* only.
- **`src/api/`** — thin controllers → declarative route table (`http/router.ts`) → Express adapter.
- **`src/container.ts`** — composition root. The ONLY file that names concrete repositories.
- **`src/app.ts`** — `createAppInstance()` factory: builds container, seeds data if `PERSISTENCE=memory`, builds routes.
- **`api/index.ts`** — Vercel serverless entry point; calls `createAppInstance()` and delegates to Express.

## Persistence modes

| `PERSISTENCE` | Backend |
|---|---|
| `memory` (default) | In-memory; seed data runs on startup |
| `json` | In-memory + JSON files in `DATA_DIR` |
| `supabase` | Supabase (Sydney); requires `DATABASE_URL` |

Seed data only runs when `PERSISTENCE=memory`. Production uses `PERSISTENCE=supabase`.

## Key API routes

| Resource | Routes |
|---|---|
| Auth | `POST /auth/login`, `GET /auth/me`, `POST /auth/logout` |
| Students | `GET/POST /students`, `GET /students/search`, `GET/PATCH/DELETE /students/:id` |
| Leaders | `GET/POST /leaders`, `GET/PATCH/DELETE /leaders/:id` |
| Connections | `GET/POST /connections`, `GET /connections/export`, `GET /connections/student/:id`, `GET /connections/leader/:id`, `DELETE /connections/:studentId/:leaderId` |
| Overview | `GET /overview` |
| At-risk | `GET /at-risk`, `POST /at-risk/recompute` |
| Trends | `GET /trends` |
| Import | `POST /import/csv`, `GET /import/history` |
| Settings | `GET/PATCH /settings` |
| Admin | `POST /admin/reset`, `POST /admin/save-defaults`, `POST /admin/new-year`, `GET /admin/audit` |
| Accounts | `GET/POST /accounts/users`, `PATCH /accounts/users/:id`, etc. |

## Role hierarchy

| Role | Scope | Key capabilities |
|------|-------|-----------------|
| `grade` | Own grade + **own gender** | List own grade/gender students; manage leaders for their cohort; connect same-gender students from any grade. Each grade has separate female/male logins (e.g. `grade9f` / `grade9m`). |
| `quad` | Own quad (e.g. Girls Yr 7–9) | Full connection management **within their gender + bracket**: add leaders, connect/disconnect, edit/remove. Sees only same-gender leaders/students. |
| `director` | Ministry-wide | All of above + import CSV data |
| `admin` | All + back office | Everything + settings, accounts, year-rollover |

There is always exactly one `admin` account. It cannot be deleted.

## Quads

Four quads group students by age bracket + gender:
- `g79` — Girls Year 7–9
- `b79` — Boys Year 7–9
- `g1012` — Girls Year 10–12
- `b1012` — Boys Year 10–12

Quad is computed automatically from `grade + gender` via `computeQuad()` in enums.

## Key design rules

- **RBAC in one file**: `src/services/access-control.ts`. Never scatter role checks.
- **Validation inside services**: all external input parsed with Zod inside the service.
- **Repos return deep clones**: base repository clones on every read/write.
- **Extensionless imports**: ESM, `moduleResolution: "Bundler"`, no `.js` extensions.
- **Strict TypeScript**: `strict` + `noUncheckedIndexedAccess` + `noImplicitOverride`.
- **Connection lock**: `AppSettings.connectionLockDate` — if set and today >= lockDate, non-admin writes are blocked.

## Key service + repository names

- `ConnectionService` / `makeConnectionService` — connects students to leaders
- `IConnectionRepository` / `InMemoryConnectionRepository` / `SupabaseConnectionRepository`
- Supabase repositories live in `src/repositories/supabase/`

## Seed demo accounts (password: `demo1234`)

| Email | Role | Scope |
|-------|------|-------|
| `admin@youth.ministry` | admin | All |
| `director@youth.ministry` | director | All |
| `g79@youth.ministry` | quad | Girls Yr 7–9 |
| `b79@youth.ministry` | quad | Boys Yr 7–9 |
| `g1012@youth.ministry` | quad | Girls Yr 10–12 |
| `b1012@youth.ministry` | quad | Boys Yr 10–12 |
| `grade7f@youth.ministry` | grade | Grade 7 Girls |
| `grade7m@youth.ministry` | grade | Grade 7 Boys |
| `grade8f–grade12m@youth.ministry` | grade | Grade 8–12 Girls/Boys |

Quick login buttons in the demo: admin, director, g79, b79, grade7f, grade7m, grade10f, grade10m

## Environment variables

```
PORT=4300
NODE_ENV=production
PERSISTENCE=supabase     # production; use "memory" for local dev with seed data
DATABASE_URL=<supabase-connection-string>
DATA_DIR=./data          # only used for PERSISTENCE=json
CORS_ORIGINS=*
```

## Frontend

`public/index.html` — phone-first SPA that calls the Express backend via relative API paths. Kept aligned to `../youth app demo/allocation-platform.html` (the canonical offline demo, deployed at https://yc-camp-demo.vercel.app). See `../youth app demo/CLAUDE.md` for demo UI conventions.

**Connection Audit module** is ported into the SPA as a delimited block (`/* ── CA MODULE … ── */`); remove = delete blocks + grep-delete `/*CA-HOOK*/` lines. Data via `CA.load()` → `/students` + `/trends` + `/settings`.

### SPA architecture

**Persistent shell** — header + nav are built once on login via `_initShell()` and never rebuilt. All page navigations update only `<main id="page-main">` via `setApp(h)`. The `_shellReady` flag gates this; set to `false` on logout.

**Client-side cache** — `Cache` object (30-second TTL) wraps all `API.get()` calls. Cache is invalidated on every write (connections, leaders, settings, import, admin, users). After login `_prefetch()` fires background fetches for all 7 common endpoints so navigations after the first are instant.

**Cache-skip spinner** — render functions check `_allCached(...paths)` before showing the loading spinner; cached navigations render immediately.

**Scroll reset** — `setApp()` calls `window.scrollTo(0, 0)` on every navigation.

### Icon system

All icons are inline SVG via the `IC` path registry. Helper functions:

| Function | Size | Use |
|---|---|---|
| `icN(k)` | 22 px | Nav, buttons, titles |
| `icS(k)` | 16 px | Inline, chips, small buttons |
| `icLg(k)` | 32 px | Large feature icons |
| `icEmpty(k)` | 48 px | Empty-state backgrounds |

Current IC keys: `home, users, chart, alert, id, upload, settings, link, edit, trash, lock, unlock, logout, target, check, key, info, clipboard, pie, group, deck, chevr, chevd, arru, arrd, arrr, xmark`

No emoji or Unicode symbol characters anywhere in the SPA — everything is SVG.

### Service worker (`public/sw.js`)

- Cache name: `cms-v2` (bump on breaking changes to force eviction)
- HTML shell (`/`): **network-first** — always fetches fresh HTML when online, falls back to cache offline
- API routes: **network-only** (never cached)
- Other assets: **cache-first**
- SW registration in the HTML listens for `controllerchange` and reloads the page automatically when a new SW activates after a deploy — no manual cache clearing needed.
