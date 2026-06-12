# CLAUDE.md — Youth Allocation Platform

> **Scope:** the real **youth allocation** app — TS/Express backend (`src/`) + `public/index.html` SPA. The offline demo and its full UI conventions live in `../youth app demo/CLAUDE.md`; this SPA is kept aligned to that demo. Project map: `../CLAUDE.md`. Sibling app: `../Camp Platform/CLAUDE.md`. Change workflow: `../CHANGE-PROMPTS.md`.

Guidance for Claude Code when working in this package.

> **Canonical demo location:** the maintained, deployed offline demo is
> `../youth app demo/allocation-platform.html` (served at
> https://yc-camp-demo.vercel.app/allocation-platform.html, alongside
> `allocation-exec.html` and `allocation-training.html`). All demos were consolidated
> into the sibling **`youth app demo/`** folder, which is now the Vercel deploy source
> (CLI deploys — see Project-4 CLAUDE.md). The old local `demo-site/` snapshot in this
> folder has been **removed** (it was a stale duplicate). `public/index.html` has been
> **aligned** to that demo; the demo's UI conventions are documented in
> `../youth app demo/CLAUDE.md` (see the "Demo-site UI patterns → moved" note below for
> where the real SPA diverges).

## What this is

A **youth ministry platform for YS Brisbane** — phone-first SPA backed by a TypeScript/Express API. Allocation is a core feature within a broader ministry insight and management tool. Backend-agnostic architecture identical in structure to the Youth Camp Platform.

## Commands

```bash
npm install
npm run dev          # backend + frontend on http://localhost:4300 (tsx watch)
npm run start        # same, no watch
npm run typecheck    # tsc --noEmit (strict)
npm run test         # vitest
```

Default port: **4300**. Set `PORT=xxxx` to override.

## Architecture

```
api (Express) → controllers → services → repositories (interfaces) → core
```

- **`src/core/`** — pure types, entities, enums, Zod schemas, errors. No imports from other layers.
- **`src/repositories/`** — interfaces (DB-swap surface) + in-memory implementations + JSON file persistence.
- **`src/services/`** — all business logic + RBAC. Depend on repo *interfaces* only.
- **`src/api/`** — thin controllers → declarative route table (`http/router.ts`) → Express adapter.
- **`src/container.ts`** — composition root. The ONLY file that names concrete repositories.

## Role hierarchy

| Role | Scope | Key capabilities |
|------|-------|-----------------|
| `grade` | Own grade + **own gender** | List own grade/gender students; manage leaders for their cohort; allocate same-gender students from any grade. Each grade has separate female/male logins (e.g. `grade9f` / `grade9m`). |
| `quad` | Own quad (e.g. Girls Yr 7–9) | Full allocation **within their gender + bracket**: add leaders, allocate/de-allocate, edit/remove (new leaders auto-set to the quad's gender; year focus limited to the bracket). Sees only same-gender leaders/students. |
| `director` | Ministry-wide | All of above + import CSV data |
| `admin` | All + back office | Everything + settings, accounts, year-rollover |

There is always exactly one `admin` account. It cannot be deleted.

### Grade login gender scoping

Grade accounts carry a `gender` field. `scopeS` and `scopeL` filter by it so each login sees only their cohort (e.g. Grade 9 Girls login sees only female Grade 9 students and female-scoped leaders). The cross-grade search in the allocation picker still operates across all same-gender students ministry-wide.

## Quads

Four quads group students by age bracket + gender:
- `g79` — Girls Year 7–9
- `b79` — Boys Year 7–9
- `g1012` — Girls Year 10–12
- `b1012` — Boys Year 10–12

Quad is computed automatically from `grade + gender` via `computeQuad()` in enums.

## Cross-grade allocation rule

Grade logins can search for and allocate students from OTHER grades as long as the student shares the same gender as the leader. This supports the use case where a leader works across grades.

## Key design rules

- **RBAC in one file**: `src/services/access-control.ts`. Never scatter role checks.
- **Validation inside services**: all external input parsed with Zod inside the service.
- **Repos return deep clones**: base repository clones on every read/write.
- **Extensionless imports**: ESM, `moduleResolution: "Bundler"`, no `.js` extensions.
- **Strict TypeScript**: `strict` + `noUncheckedIndexedAccess` + `noImplicitOverride`.

## Frontend files

| File | Purpose |
|------|---------|
| `public/index.html` | Implementation-ready SPA — calls the Express backend via relative API paths. **Aligned to the canonical demo** (Home attendance hero + by-quad tiles, interactive student-detail leader assignment, in-picker de-allocate, condensed My Students + filters, quad add/edit/allocate parity, trends grpBar, at-risk prev-term line, safe-area header). |
| `../youth app demo/allocation-platform.html` | Standalone offline demo (deployed) — all API calls handled by embedded MockAPI. The source of truth for UI/UX; the local `demo-site/` was removed. |

> **Backend note:** the `quad` role now has `leader:write` (full add/edit/allocate scoped to its gender + year bracket — see `quadGenderOf`/`quadGradesOf` in `access-control.ts` and `leader.service.ts`, covered by `src/tests/leader.service.test.ts`).

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
| `grade8f@youth.ministry` | grade | Grade 8 Girls |
| `grade8m@youth.ministry` | grade | Grade 8 Boys |
| `grade9f@youth.ministry` | grade | Grade 9 Girls |
| `grade9m@youth.ministry` | grade | Grade 9 Boys |
| `grade10f@youth.ministry` | grade | Grade 10 Girls |
| `grade10m@youth.ministry` | grade | Grade 10 Boys |
| `grade11f@youth.ministry` | grade | Grade 11 Girls |
| `grade11m@youth.ministry` | grade | Grade 11 Boys |
| `grade12f@youth.ministry` | grade | Grade 12 Girls |
| `grade12m@youth.ministry` | grade | Grade 12 Boys |

Quick login buttons in the demo: admin, director, g79, b79, grade7f, grade7m, grade10f, grade10m

## Demo-site UI patterns → moved

The demo's UI conventions now live with the demo: **`../youth app demo/CLAUDE.md`** ("Demo-site UI patterns" section). `public/index.html` is kept **aligned** to `../youth app demo/allocation-platform.html` (last aligned 2026-06-11, incl. Connection Audit + People Flow + xlsx).

**Where the real SPA diverges from the demo (per-layer notes):**
- The demo computes everything from its full in-memory mock; the real SPA only shows what the Express API returns. Where the API lacks demo-only data — per-student attendance/lifegroup **dot rows** and **unique-attender counts** — the SPA **approximates with real aggregates** (Fridays/Lifegroup % and counts). No per-week lifegroup tracking was added.
- **The server enforces what the demo did client-side:** allocation de-dup lives in `POST /allocations` (no client `addAllocation`/`dedupeAllocations`); quad add/edit/allocate is authorised by the backend (`leader:write` + `quadGenderOf`/`quadGradesOf` scoping, tested in `src/tests/leader.service.test.ts`).
- **Function names differ** from the demo: `showStudentDetail`/`assignSD`/`unassignSD`/`sdLeaderSearch`, `openStudentPicker`/`remPick`/`pickerSyncBg`, `renderMyStudents` (+`_lvF`/`tLvF`), `renderHome` (+`_hAttTile`/`toggleHomeQuad`), `grpBar`/`trendArrow`. Phone-mode uses `env(safe-area-inset-top)` (var `--safe-t`) rather than the demo's fixed `padding-top:50px`.
- **Connection Audit (ported 2026-06-11, same module contract as the demo):** one CSS block + one `CA` script block (`/* ── CA MODULE … ── */`) + 4 lines tagged `/*CA-HOOK*/`; remove = delete blocks + grep-delete hook lines (proven by `../_ca-dev/ca-spa-remove-test.mjs`). Data via async `CA.load()` → `/students` + `/trends` + `/settings` (refreshes on hub entry). Divergences from the demo CA: **personal trend is rate-based** (current vs prev term — no per-student per-session API); **lifegroup health uses 12 grade×gender cohorts** (no `/lifegroups` route); the deck sparkline uses `/trends` ministry sessions (server-side outlier flags); Connect/Decision/Team/**People Flow** uploads are client-side localStorage (`ca_audit_v3` — v3 added the flows upload; bump on shape change), cleared by Full Reset via the `adminAction` hook; CA CSS uses its own `--ca-*` tokens and the SPA class vocabulary (`stat-grid`, `c-danger`, `quad-g79`, emoji icons). People Flow → per-leader per-term follow-up table ("New-person follow-up" dropdown on `ca-overview`; `flowStats()`, SLAs 7/7/14d, term = completion quarter). **All uploads + the Import page accept .xlsx** via the core `readXlsx()` helper (native `DecompressionStream`, date serials → ISO; the Import page bridges xlsx → `rowsToCsv` → `parseCSV` → `POST /import/csv`). Verify with `../_ca-dev/ca-spa-harness.mjs` (fetch-stubbed, 54 assertions).

## Demo ↔ real SPA function map

When aligning `public/index.html` to `../youth app demo/allocation-platform.html`, use this to jump straight to the matching code instead of reading/diffing whole files. **Same-named** functions are omitted — `render`, `go`, `renderHome`, `renderLeaders`, `renderTrends`, `renderAtRisk`, `statCard`, `avgAtt`, `grpBar`, `trendArrow`, `quadGender`, `quadGrades`, `fmtBday`, `toggleHomeQuad`, `_homeQuadOpen`, `_trQuadOpen`, `_trGradeOpen`, `_lvF`, `tLvF`, `remPick`, `pickerSyncBg`, `assignSD`, `unassignSD`, `sdLeaderSearch`, `sdEligibleLeaders` all keep their names.

| Demo (`allocation-platform.html`) | Real SPA (`public/index.html`) |
|-----------------------------------|--------------------------------|
| `_DB` + `MockAPI` / `api()` | real `fetch` via the `API` helper (`API.get/post/patch/del`) |
| `overview(actor)` (local compute) | `GET /overview` |
| `buildTrends()` | `GET /trends` |
| `scopeS` / `scopeL` (client scoping) | server-side scoping — the API already returns scoped data |
| `showSD` | `showStudentDetail` |
| `openPicker` | `openStudentPicker` |
| `addPick` | `addAllocFromPicker` |
| `fPicker` | `filterPicker` |
| `renderLeaderView` | `renderMyStudents` |
| `attTile` | `_hAttTile` |
| `homeGradeMini` | `_hGradeMini` |
| `svcSessFor` (per-session from `hist`) | no equivalent — avg comes from `/trends`, uniques counted from `/students` |
| `glHist` (synthesised lifegroup dots) | no equivalent — approximated by Lifegroup aggregates (no per-week data) |
| `renderAllocate` / `renderMyQuad` / `renderQuadView` | router redirects `allocate`/`my-quad`/`quad-view` → `renderLeaders` |
| `persist()` / `restorePersistedData()` (localStorage) | no equivalent — state lives in the backend |
| CA module (whole Connection Audit) | same names — ported as a delimited block; data via `CA.load()` → `/students` + `/trends` + `/settings`; `QL`→`QLBL`, `cq()`→`s.quad`, `closeM`→`closeModal`, `fmtDM`→module-local `fmtD` |

> Keep this table current when a Tier‑2/3 change adds or renames a ported function.

## Environment variables

```
PORT=4300
NODE_ENV=production
PERSISTENCE=json          # optional: saves to DATA_DIR/*.json
DATA_DIR=./data
CORS_ORIGINS=*
```
