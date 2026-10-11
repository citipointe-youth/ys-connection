# October rework: implementation plan

Spec (binding, reviewed): `docs/superpowers/specs/2026-10-12-oct-rework-design.md`, including its
"Review resolution" table. Operator decisions: `C:\Users\thoma\ysc-work\link\docs\superpowers\elvanto-link-progress.md`
(items 1–5, 9, 10, 14, 15). Conventions: repo `CLAUDE.md`.

Worktree `C:\Users\thoma\ysc-work\rework`, branch `feat/oct-rework`, based on master `f105c46`.
This plan is the "how"; when the plan and the spec disagree, the spec wins. Tell the orchestrator.

---

## GUARDRAILS (every executor reads these first)

1. **Feature branch only.** Work on `feat/oct-rework` in this worktree. Never check out or touch `master`.
2. **No push.** Nothing leaves this machine. The operator pushes.
3. **Commit with explicit paths only.** `git add <path> <path> ...`, never `git add -A` / `git add .`
   (untracked local dirs such as `supabase/.temp/` and `_design/` must never be swept in). Every
   commit message ends with:
   ```
   Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
   Claude-Session: https://claude.ai/code/session_01DP7w9MvCaeFQa6rMWQxFcZ
   ```
   Sonnet executors do not commit; they hand back and the orchestrator reviews and commits.
4. **No Supabase MCP writes** (no `apply_migration`, no `execute_sql` writes). Migrations apply only in
   the Vercel production build. Never run `npm run migrate -- --force` against a prod URL.
5. **No Vercel env changes.** No `create_project_env` / `edit_project_env`, no `vercel env`.
6. **Route checklist** for any NEW top-level route: `src/api/http/router.ts` + `vercel.json` `routes[]`
   regex + `public/sw.js` `API_RE` + bump `CACHE`. This rework adds **no** new top-level route
   (`/leaders/...` and `/bus/...` already exist in all three); Task Z1 still checks that.
7. **`public/sw.js` `CACHE` is bumped exactly once**, in Task S2.4 (the last SPA task). Nobody else
   touches `sw.js`.
8. **`esc()` every user value** that goes into `innerHTML` (names, leader names, car names, suburbs,
   labels from the server).
9. **No apostrophes inside single-quoted SPA strings** (`'can't'` is a white-screen SyntaxError). Use
   double quotes or a template literal for any text with a contraction.
10. **Never add dark-mode rules** (`prefers-color-scheme: dark`). The app has no dark mode.
11. **Run `node scripts/check-spa-syntax.js` after every edit to `public/index.html`.**
12. **TDD:** write the listed tests first, watch them fail, then implement.
13. **Verify command** (every task, before handing back):
    ```
    npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js
    ```
    All three must pass. `account.service.test.ts` "applying Complex deactivates the pre-existing
    grade7g…" is a known flaky ~5 s timeout on the laptop; re-run once before reporting it.
14. **Stay inside your lane's file list.** If you need a file another lane owns, stop and report.
15. Out of scope: the More menu sheet / `openMore()` / its styling, the New person form, anything in the
    Elvanto link.

Model tags: **[Sonnet]** = mechanical, fully specified. **[Opus]** = judgement (RBAC, migration,
the bus suburb redaction, the server-owned retired-logins logic).

---

## Lanes and order

```
F (foundation) ──► B (leaders view-grades) ─┐
                ├► C (settings/accounts/labels)├─► Z (API wiring) ──► S1 (SPA Part A) ──► S2 (SPA B+C, sw.js) ──► V (verify + docs)
                ├► D (prayers server) ────────┤
                └► E (bus server) ────────────┘
```

- **F** first, alone. B, C, D, E start only after F is committed; they run in parallel.
- **Z** after B–E are all committed (it owns `container.ts` and `router.ts`, which B, C and E all need).
- **S1** then **S2**, one after the other: they both own `public/index.html`.
- **V** last.

### File ownership (no file is in two lanes)

| Lane | Owns (source) | Owns (tests) |
|---|---|---|
| F | `src/core/ministry-config.ts`, `src/core/types/enums.ts`, `src/core/entities/leader.ts`, `src/core/schema-version.ts`, `src/migrate/runner.ts`, `supabase/migrations/0016_leader_view_grades.sql`, `src/services/access-control.ts` | `src/tests/ministry-config.test.ts`, `src/tests/quad-labels.test.ts` (new), `src/tests/schema-version.test.ts`, `src/tests/migrate-runner.test.ts`, `src/tests/access-control.test.ts` |
| B | `src/repositories/interfaces/entity-repositories.ts`, `src/repositories/in-memory/in-memory.repositories.ts` (also serves json mode via its persistence adapter), `src/repositories/supabase/supabase.leaders.ts`, `src/services/leader.service.ts`, `src/api/controllers/leader.controller.ts` | `src/tests/leader.service.test.ts`, `src/tests/leader.repo-view-grades.test.ts` (new) |
| C | `src/services/settings.service.ts`, `src/services/setup.service.ts`, `src/services/account.service.ts`, `src/services/cohort-account-layout.ts`, `src/services/overview.service.ts`, `src/services/trends.service.ts`, `src/services/lifegroup-stats.service.ts` | `src/tests/settings.service.test.ts`, `src/tests/setup.service.test.ts`, `src/tests/account.service.test.ts`, `src/tests/cohort-account-layout.test.ts`, `src/tests/overview.service.test.ts`, `src/tests/trends.service.test.ts`, `src/tests/lifegroup-stats.service.test.ts` |
| D | `src/services/prayer.service.ts` | `src/tests/prayer.service.test.ts` |
| E | `src/services/bus-logic.ts`, `src/services/bus.service.ts`, `src/api/controllers/bus.controller.ts` | `src/tests/bus-logic.test.ts`, `src/tests/bus.service.test.ts`, `src/tests/bus.cars.test.ts` (new) |
| Z | `src/container.ts`, `src/api/http/router.ts` (and reads, never edits, `vercel.json` / `public/sw.js`) | `src/tests/oct-rework.routes.test.ts` (new) |
| S1 | `public/index.html` | `src/tests/spa-oct-simple-logins.test.ts` (new), plus any existing SPA test it must update (`spa-setup.test.ts`) |
| S2 | `public/index.html`, `public/sw.js` | `src/tests/spa-oct-prayers-bus.test.ts` (new), plus `new-youth.spa.test.ts` / `spa-bus.test.ts` if they need updating |
| V | `CLAUDE.md` | none |

Notes on ownership:
- Lane B adds `setViewGrades` to `ILeaderRepository`; it is the only lane that edits
  `entity-repositories.ts`. If C needs a repo method that does not exist, stop and report.
- Lanes B and C add **optional** dependencies to `makeLeaderService` / `makeSetupService` so that
  `container.ts` still compiles unchanged; Lane Z passes them in.

---

## Lane F — Foundation (sequential, one executor)

### Task F1 [Sonnet] — Config schema: `logins` and `modules.prayers`
Files: `src/core/ministry-config.ts`, `src/tests/ministry-config.test.ts`.

Tests first (`ministry-config.test.ts`):
- `MinistryConfigSchema.parse({})` gives `logins = { simple: false, retiredGradeIds: [], gradeRoleWasOn: true }`
  and `modules.prayers === true`.
- An old stored config with no `logins` key and no `modules.prayers` still parses (use a realistic
  pre-rework blob: `modules` with `busMinistry`, `newYouthForms`, etc.).
- `mergeMinistryConfig(base, { logins: { simple: true } })` keeps `retiredGradeIds`/`gradeRoleWasOn`
  from base (deep merge, not replace).
- `MINISTRY_CONFIG_DEFAULTS.logins.simple === false`, `MINISTRY_CONFIG_DEFAULTS.modules.prayers === true`.

Change: add the `logins` object exactly as the spec's Data model §1 (with the SERVER-OWNED comment) and
`modules.prayers: z.boolean().default(true)`. Export a `type LoginsConfig` if convenient. Do NOT touch the
SPA mirror (`MINISTRY_CONFIG_DEFAULTS_CLIENT`); that is S1/S2.

Verify: the verify command.

### Task F2 [Sonnet] — `quadLabelFor` and the Leader field
Files: `src/core/types/enums.ts`, `src/core/entities/leader.ts`, `src/tests/quad-labels.test.ts` (new).

Tests first:
- `quadLabelFor('g79', false) === QUAD_LABELS.g79` for all four quads.
- `quadLabelFor(q, true)`: `g79` → `Junior Girls`, `b79` → `Junior Guys`, `g1012` → `Senior Girls`,
  `b1012` → `Senior Guys`.
- `QUAD_LABELS` values each contain exactly one en dash (`–`, U+2013) and no hyphen-minus range
  (canonical string; the cohort layout and the off-rename both use it).

Change: add `export function quadLabelFor(quad: Quad, simple: boolean): string` next to `QUAD_LABELS`.
If any `QUAD_LABELS` value uses a hyphen, fix it to the en dash here (and note it in the hand-back).
Add `viewGrades?: Grade[] | null` to `Leader` (optional, so existing literals compile).

### Task F3 [Opus] — Migration 0016 + duplicate-version guard
Files: `supabase/migrations/0016_leader_view_grades.sql`, `src/core/schema-version.ts`,
`src/migrate/runner.ts`, `src/tests/schema-version.test.ts`, `src/tests/migrate-runner.test.ts`.

Tests first:
- `schema-version.test.ts`: existing "equals the highest filename" test now passes with `'0016'`; add
  "migration versions are unique" over the real `supabase/migrations` folder.
- `migrate-runner.test.ts`: `listMigrationFiles` on a temp dir with `0016_a.sql` and `0016_b.sql` throws
  `MigrationAbort` naming both files; `runMigrations` with a duplicated `files` array throws
  `MigrationAbort` **before** any `db` call (assert the fake db saw no query).

Change:
- `0016_leader_view_grades.sql`: header comment (what + why + "additive; live code before this rework
  never names the column"), then `alter table leaders add column if not exists view_grades int[];`.
  Nothing else (no backfill: decision 14).
- `LATEST_MIGRATION = '0016'`.
- `runner.ts`: a duplicate check in `listMigrationFiles` and again at the top of `runMigrations`.
  Error text: `Two database changes share version 0016: <a>, <b>. Renumber one.`
- Judgement points: keep `BASELINE_MAX = '0014'` unchanged; do not reorder or edit any shipped file.

### Task F4 [Opus] — Access control: `canWithConfig`, `modeAllows`, `canSetViewGrades`
Files: `src/services/access-control.ts`, `src/tests/access-control.test.ts`.

Tests first:
- `canWithConfig`: quad + `bus:coordinate` + `simple:true` → false; quad + `simple:false` → true; for
  every role × every `Action`, with `simple` true and false, `canWithConfig === can` except that one cell
  (loop over the role list and the action union).
- `modeAllows`: `on` → true for all roles; `shadow` → admin only; `off` → false for all.
- `canUseNewYouth` unchanged: keep the existing cases green, add a table for all roles × modes.
- `canSetViewGrades(actor, leaderId)`: quad/director/admin → true for any id; leader → true only for
  `actor.leaderId === leaderId`; leader on another id → false; grade → false.

Change: add the three functions as in the spec (RBAC change §; Bus "Who sees it" §; The grade filter
"Who may write"). Rewrite `canUseNewYouth` as `can(actor,'intake:write') && modeAllows(actor, mode)`.
`ROLE_PERMISSIONS` stays static. `canWithConfig` takes `Pick<MinistryConfig,'logins'>`.

**Lane F done:** orchestrator reviews and commits F1–F4 (one commit per task or one lane commit), then
starts B, C, D, E in parallel.

---

## Lane B — Leader `viewGrades` (after F)

### Task B1 [Sonnet] — Repository method and column
Files: `src/repositories/interfaces/entity-repositories.ts`, `src/repositories/in-memory/in-memory.repositories.ts`,
`src/repositories/supabase/supabase.leaders.ts`, `src/tests/leader.repo-view-grades.test.ts` (new).

Tests first (in-memory repo; json mode is the same class with a persistence adapter):
- `setViewGrades(id, [9,10])` then `findById` returns `viewGrades: [9,10]`; `setViewGrades(id, null)`
  returns `null`.
- After `setViewGrades`, a `save(leaderWithoutViewGrades)` and a `saveMany([...])` of the same id
  **keep** `viewGrades` (mirrors the Supabase upsert that never lists the column).
- A leader never given a value reads `viewGrades` as `undefined` or `null` (both mean "use my grades").

Change:
- `ILeaderRepository.setViewGrades(id: string, grades: Grade[] | null): Promise<void>`.
- In-memory: implement; in `save`/`saveMany`, when the incoming leader has `viewGrades === undefined`,
  carry the stored value forward.
- Supabase: `toLeader` maps `view_grades` → `viewGrades` (null stays null); `setViewGrades` runs
  `update leaders set view_grades = ${grades} where id = ${id}` (int array or null). Do **not** add
  `view_grades` to the `save`/`saveMany` column lists. Read the existing select to be sure the column
  comes back (`select *` or an explicit list — add it to an explicit list if there is one).
- Check `src/repositories/supabase/with-transaction.ts` still compiles (it constructs the leader repo).

### Task B2 [Opus] — `LeaderService.setViewGrades` + controller method
Files: `src/services/leader.service.ts`, `src/api/controllers/leader.controller.ts`,
`src/tests/leader.service.test.ts`.

Tests first:
- quad `g79` sets `[7,9]` on any leader → saved; sets `[10]` → 400 (outside bracket).
- admin sets `[6]` with `gradeMin 7` → 400 (outside `gradeRange(structure)`); with Include Grade 6 → ok.
- `null` → saved as null ("back to my grades").
- `[]` → 400 (an empty pick is never saved).
- leader role on own `leaderId` → ok; on another → 403; grade role → 403 (via `canSetViewGrades`).
- unknown leader id → 404.
- `updateSmsTemplate`, `updateGrades` and an import-style `saveMany` after `setViewGrades` leave
  `viewGrades` unchanged.

Change:
- `makeLeaderService(leaders, settings?: ISettingsRepository)` — the new param is **optional**; without
  it, use `MINISTRY_CONFIG_DEFAULTS.structure`. (Z1 wires it.)
- `setViewGrades(actor, id, input)`: Zod `{ grades: z.array(z.number().int()).min(1).nullable() }`;
  `ForbiddenError` unless `canSetViewGrades`; range check against `gradeRange(structure)`; for a quad
  caller also `quadGradesOf(actor.quad)`; dedupe + sort; `leaders.setViewGrades`; return the fresh leader.
- Controller: `setViewGrades(req)` → `leader.setViewGrades(req.actor, req.params.id, req.body)`. No route
  yet (Z1).

---

## Lane C — Settings, setup, accounts, labels (after F)

Run C2–C5 before C1 if one executor does the lane (C1 is the biggest and uses `QUAD_LABELS` the same way
C4 does).

### Task C2 [Sonnet] — New installs default to Simple logins
Files: `src/services/setup.service.ts`, `src/tests/setup.service.test.ts`.

Tests first:
- After `createFirstAdmin`, stored config has `logins.simple === true`, `logins.gradeRoleWasOn === true`,
  `roles.enabled.grade === false`.
- Call order: the settings write happens **before** `users.createFirstAdmin` (spy on both; assert order).
- If `users.createFirstAdmin` throws, the settings write already happened and a second attempt still
  succeeds.
- With no `settings` dep, `createFirstAdmin` behaves exactly as before (old tests stay green).

Change: add optional `settings?: ISettingsRepository` to the deps object; before the user create,
`settings.updateSettings({ ministryConfig: mergeMinistryConfig(current.ministryConfig, { logins: { simple: true, gradeRoleWasOn: true }, roles: { enabled: { grade: false } } }) })`.
`src/seed.ts` does not change.

### Task C3 [Sonnet] — Account guard while Simple logins is on
Files: `src/services/account.service.ts`, `src/tests/account.service.test.ts`.

Tests first (Simple on): create a `grade` account → 400 "Turn off Junior/Senior logins first";
`toggleStatus` on an inactive grade account → 400; `update` that sets `status: 'active'` on a grade
account → 400; deactivating a grade account → allowed; creating a quad/director account → allowed.
Simple off: all of the above allowed (existing tests unchanged).

Change: a local `simpleOn()` reading `settings.getSettings()`; guard the three paths. Exact message
text from the spec.

### Task C4 [Sonnet] — Cohort layout: canonical labels + Simple-on target
Files: `src/services/cohort-account-layout.ts`, `src/tests/cohort-account-layout.test.ts`.

Tests first:
- Complex target quads use `QUAD_LABELS[quad]` as display name (existing assertions updated only if
  their strings were the old local copy — keep the visible text identical).
- Complex with `simple: true`: target = the 4 quads only, no grade accounts, display names
  `quadLabelFor(q, true)`.
- `planCohortAccountLayout` with Simple on does not mark the 4 quads for creation when they exist.

Change: replace the local `QUAD_TARGETS` labels with `QUAD_LABELS`; `buildTargetAccounts` takes
`simple` (from `cfg.logins.simple` via the caller in `account.service.ts` — that caller is in C's own
file, so update `planCohortLayout`/`applyCohortLayout` to pass it).

### Task C5 [Sonnet] — Server quad labels
Files: `src/services/overview.service.ts`, `src/services/trends.service.ts`,
`src/services/lifegroup-stats.service.ts` and their three test files.

Tests first: each service with `logins.simple: true` returns `byQuad[].label === quadLabelFor(quad, true)`;
with the default config, the old labels (existing tests stay green).

Change: at lines ~132 / ~233 / ~310 replace `QUAD_LABELS[quad]` with
`quadLabelFor(quad, cfg.logins.simple)`. Each already reads settings; if one does not, read it from the
settings repo it already has (overview's is optional — default to `false` when absent). The 60 s caches
are already cleared on every settings save; do not add cache keys.

### Task C1 [Opus] — Settings: server-owned fields, the rule, on/off, quad renames
Files: `src/services/settings.service.ts`, `src/tests/settings.service.test.ts`.

Tests first (all from the spec's "Tests to add" for `settings.service.test.ts`):
- **On:** with active `grade7g`, `grade8b` and inactive `grade9g`: one `updateSettings` call carries
  `simple: true`, `retiredGradeIds = [ids of grade7g, grade8b]`, `gradeRoleWasOn = true`,
  `roles.enabled.grade = false` (assert the write count is 1 and the ids are in that same write); then
  exactly those two are inactive; `grade9g` untouched.
- **On, Grade already off**, one active grade account left behind → it is retired and listed;
  `gradeRoleWasOn = false`.
- **Quads renamed by `quad` field:** a quad whose username was edited to `girls-junior` is still
  renamed to `Junior Girls`; result exposes `renamedQuads: 4` (or the count present).
- **Server-owned:** while on, a patch with `logins.retiredGradeIds: []`, a patch with a foreign id, and
  a patch with `gradeRoleWasOn: false` each leave the stored values unchanged.
- **Off:** listed ids that are still inactive `grade` users come back active; a listed id now
  `role: 'quad'`, a deleted id and an already-active id are skipped; `roles.enabled.grade` restored from
  `gradeRoleWasOn`; list cleared in the same write; quads renamed back to `QUAD_LABELS[quad]`.
- **Rule:** while on (or turning on), `structure.cohortModel: 'none'` → 400; `roles.enabled.quad: false`
  → 400; message "Turn off Junior/Senior logins first".
- **Grade forced off:** a patch with `roles.enabled.grade: true` while on → stored stays false.
- Existing role-disable cascade tests stay green.

Change (judgement — keep it in one readable block inside `update()`):
1. Read `before`. Strip `patch.ministryConfig?.logins?.retiredGradeIds` and `.gradeRoleWasOn`.
2. Merge. Carry forward stored `retiredGradeIds`/`gradeRoleWasOn`.
3. Validate the rule against the merged config when `merged.logins.simple` is true → `BadRequestError`.
4. If on: force `roles.enabled.grade = false`.
5. Off→on: collect active `grade` ids via `users.findByRole('grade')` **before** the write; put them,
   `gradeRoleWasOn = before.roles.enabled.grade`, into the merged config; write once; then deactivate
   exactly those ids; then rename quads.
6. On→off: `roles.enabled.grade = before.logins.gradeRoleWasOn`; `retiredGradeIds = []`; write once;
   reactivate each listed id only if the user exists, `role === 'grade'` and `status === 'inactive'`;
   rename quads back.
7. Let the existing generic role-disable cascade run as today (harmless duplicate).
8. Quad rename helper: select `users.findByRole('quad')`, set `displayName` from the `quad` field, save
   only those that change, return the count. Return it on the update result (e.g. `renamedQuads`) so the
   SPA can toast "Renamed N quad logins". Keep the controller response shape backwards compatible
   (add a field, do not rename one).

---

## Lane D — Prayers server (after F)

### Task D1 [Sonnet] — `requirePrayersModule`
Files: `src/services/prayer.service.ts`, `src/tests/prayer.service.test.ts`.

Tests first: with `modules.prayers: false`, each of `list`, `listByStudent`, `create`, `update`,
`setStatus`, `remove`, `exportCsv`, `importCsv` rejects with `ModuleDisabledError` (404,
`MODULE_DISABLED`) — one `it.each` over the 8; with `prayers: true` the existing tests pass; with no
`settingsRepo` (3rd arg omitted) every method works (on).

Change: `async function requirePrayersModule()` (no-op without `settingsRepo`; else throw
`ModuleDisabledError('Prayers')` when `ministryConfig.modules.prayers === false`); call it first in all 8
methods. Data is never deleted.

---

## Lane E — Bus server (after F)

### Task E1 [Opus] — Strict `suburbOnly`
Files: `src/services/bus-logic.ts`, `src/tests/bus-logic.test.ts`.

Tests first: the four rows of the spec table plus `"8 Smith St, Carina QLD 4152, Australia"` → `"Carina"`.
Add: a lower-case state (`carina qld 4152`) → `""` unless the spec regex matches it (the spec regex is
case-sensitive for states — keep it so; assert `""`); `"Mount Gravatt East QLD 4122"` as its own comma
part → `"Mount Gravatt East"`; a part `"Wynnum Rd QLD 4178"` → `""` (street word); export `STREET_WORDS`.

Change: add `suburbOnly` and `STREET_WORDS` exactly as the spec. `suburbOf` stays unchanged.

### Task E2 [Opus] — Quad loses `bus:coordinate` under Simple logins
Files: `src/services/bus.service.ts`, `src/tests/bus.service.test.ts`.

Tests first:
- Simple on, quad, no `as=`: run view `canCoordinate === false`; Generate → 403; `setDropped` on a rider
  in another car → 403.
- Simple on, quad, `as=<leaderId in coordinatorLeaderIds>` → `canCoordinate === true`, Generate allowed.
- Simple off, quad: unchanged (coordinates).
- admin/director unchanged in both modes.

Change: `allowed()` calls `canWithConfig(ctx.actor, action, c)` instead of `can(...)`; the
`coordinatorLeaderIds` elevation after it is untouched. Confirm by grep that `allowed()` is the only
`bus:coordinate` path (`gate()` and `setDropped` use it).

### Task E3 [Opus] — `carsView`, `canSeeCars`, and the junior-leader redaction
Files: `src/services/bus.service.ts`, `src/api/controllers/bus.controller.ts`, `src/tests/bus.cars.test.ts` (new).

Tests first (`bus.cars.test.ts`, use `src/tests/helpers/bus-fixtures.ts`):
- `newYouthForms: 'off'` → 404 for admin; `'shadow'` → admin 200, director 404, quad 404;
  `'on'` → every `bus:use` login 200.
- `GET /bus/run` `canSeeCars` matches the same table for each mode.
- Output with `as=<some leader>` deep-equals output without `as=`.
- Cars sorted by stop order; `leaderNames` present; `unassigned` = count of running riders with no car.
- **Key allow-list walk:** recurse through the whole response; fail on any key outside
  `{serviceDate, version, readOnly, cars, name, colourIndex, leaderNames, stops, stop, grade, suburb, dropped, unassigned}`.
- **Leak checks:** fixtures with addresses `"Unit 3, 24 Wynnum Rd, Carina QLD 4152, Australia"`,
  `"24 Wynnum Rd Carina QLD 4152"` and `"24 Wynnum Rd"`: every `suburb` has no digit and does not match
  `STREET_WORDS`; no string value anywhere contains `streetOf(addr)` or the full address; no phone digits.
- Same suburb assertions on the junior-leader `buildView` (role `leader`).

Change:
- `carsView(ctx)`: `gate(ctx,'bus:use')`; 404 (`NotFoundError` or `ModuleDisabledError` — match what the
  New person 404 uses) unless `modeAllows(ctx.actor, c.modules.newYouthForms)`; ignore `ctx.as`;
  build from the running run-vehicles + `ridingOf(run.id)` sorted by `stopOrder`; `readOnly: true`;
  rider `grade` (null if unknown); `suburb: suburbOnly(address)`; `dropped: !!droppedAt`. Never spread a
  repo object into the output: construct each object literal field by field.
- `buildView` adds `canSeeCars: modeAllows(ctx.actor, c.modules.newYouthForms)`; extend `BusRunView`.
- Junior-leader redaction in `buildView` (line ~377): `suburbOf` → `suburbOnly`.
- Controller: `cars(req)` → `busSvc.carsView(ctxOf(req))`. No route yet (Z1).

---

## Lane Z — API wiring (after B, C, D, E are committed)

### Task Z1 [Sonnet] — Container + routes
Files: `src/container.ts`, `src/api/http/router.ts`, `src/tests/oct-rework.routes.test.ts` (new).

Tests first (follow `prayer.routes.test.ts` / `bus.routes.test.ts` style):
- `PATCH /leaders/:id/view-grades` with no token → 401 JSON; as quad with `{grades:[7]}` → 200 and the
  leader has `viewGrades: [7]`; as grade → 403.
- `GET /bus/run/cars` with no token → 401 JSON; admin in Shadow → 200; quad in Shadow → 404.

Change:
- `container.ts`: `makeLeaderService(leaders, settings)`; `makeSetupService({ ..., settings })`.
- `router.ts`: `PATCH /leaders/:id/view-grades` next to `/leaders/:id/grades`;
  `GET /bus/run/cars` next to `GET /bus/run` (register before any `/bus/run/:param` route, if one exists).
- Route checklist: confirm `leaders` and `bus` are already in the `vercel.json` regex and `sw.js`
  `API_RE`; change neither. Say so in the hand-back.

---

## Lane S1 — SPA Part A: Simple logins (after Z)

All tasks edit `public/index.html` only. SPA tests use `src/tests/helpers/extract-fn.ts`
(`extractFn`/`loadFns`) against the real HTML. Run `node scripts/check-spa-syntax.js` after every edit.

### Task S1.1 [Sonnet] — Config mirror, `_simpleLoginsOn`, `quadLabel`
Tests first (`spa-oct-simple-logins.test.ts`): `quadLabel('b1012')` with Simple off → old label, on →
`Senior Guys`; `_simpleLoginsOn()` false with `{}` config.

Change:
- `MINISTRY_CONFIG_DEFAULTS_CLIENT`: add `logins: { simple: false }` (only `simple`) and
  `modules.prayers: true`.
- `_simpleLoginsOn()`; `quadLabel(q)` returns the Simple name when on.
- Route every quad label through `quadLabel()`: run
  `grep -nE "QUAD_LABELS|QLBL|QUAD_LABELS_LOCAL|Girls Yr|Boys Yr|q\.label" public/index.html` and fix each
  hit (`quadChip` ~1429, Connection Audit `QLBL`, account-form option lists, Home and Trends tiles,
  header role badge). Where a server `label` is rendered, use `quadLabel(q.quad)`. List every changed
  site in the hand-back.

### Task S1.2 [Opus] — Youth Setup: toggle, confirm, preset keep, grey-outs, draft reset, file strip, layout mirror
Tests first:
- `pickMinistryPreset('simple')` keeps the draft's `logins` and `modules.prayers`.
- The confirm-diff helper (extract it as a pure `_setupRiskyDiff(saved, draft)`) reports
  `logins.simple` and `modules.prayers` changes and nothing else.
- `exportSettingsFile()` output and `_parseSettingsFile()` result carry `logins.simple` and never
  `retiredGradeIds` / `gradeRoleWasOn`.
- `buildTargetAccountsClient` with Complex + Simple on → 4 quads, Simple names, no grade accounts.
- After a successful `saveMinistrySetup()`, `_setupDraft === null`.

Change:
- Structure & Roles card: **Junior/Senior logins** toggle with a `helpTip` (double-quoted text).
- `confirmSaveMinistrySetup()`: if `_setupRiskyDiff` is non-empty, show the spec's confirm text with N =
  active grade accounts from `_adminData.users`; red warning when `busMinistry.coordinatorLeaderIds` is
  empty. (The Prayers-off export confirm is S2.1; this task only makes the diff include `prayers`.)
- After save: toast "Renamed N quad logins" when the response carries the count; `_setupDraft = null`;
  rebuild the shell if `_navSig()` changed (existing path).
- While Simple is on: grey out the Grade role checkbox, the cohort-model select and the Simple preset
  button, each with a tooltip.
- Accounts screen: hide the Grade section while Simple is on (`roles.enabled.grade` is already false;
  confirm the existing skip covers it).
- Mirror the Simple-on target in `buildTargetAccountsClient`.

### Task S1.3 [Opus] — Grade filter core: `_vgGrades`, `_vgBar`, saving, preview rules
Tests first:
- `_vgGrades()`: no "I am" pick → null (whole bracket) and the hint text; leader with no saved filter →
  `leader.grades` ∩ bracket; saved `viewGrades` → those ∩ bracket; out-of-bracket only → whole bracket;
  non-quad login → null.
- `_vgBar` actions: **All** saves the full bracket; **My grades** saves `null`; unticking the last chip
  does nothing.
- Saves are debounced 600 ms (fake timers): three taps → one `PATCH /leaders/<id>/view-grades`.
- With `_previewStash` set: taps change the in-memory filter, `API.patch` is never called.
- `enterPreview` and `exitPreview` both clear `yap_leader_id`.
- `doLogout` does not touch view grades (they live on the server).

Change: implement the helpers exactly as the spec's "The grade filter" (Effective grades, UI, Saving,
Account preview). After a save, update the `/leaders` cache entry for that leader (no full refetch).
`esc()` nothing new is user text here, but the hint and chip labels go through `_gradeWord()`.

### Task S1.4 [Sonnet] — Apply the filter on six screens
Tests first: for each screen a pure filter helper is extracted and tested with a quad login + a filter
of `[8]`: Health, Upcoming Birthdays, Student Search keep only grade 8; Connect Setup counts filtered
students only and keeps a leader card whose `grades` overlap **or** is `[]`; Prayers keeps student
prayers by grade and general prayers whose `createdByGrades` overlaps or is null; Home narrows only the
quad's "Attendance by Grade" tiles and "Birthdays this week" (hero totals unchanged).

Change: render `_vgBar()` at the top of those six screens for quad logins while Simple is on; it replaces
the screens' own grade chips for those logins only (admin/director keep their chips). Not narrowed:
Home hero totals, Trends, My Connections, Bus, Connection Audit.

---

## Lane S2 — SPA Parts B and C (after S1)

### Task S2.1 [Sonnet] — Prayers off: `_prayersOn`, gating, Modules toggle, `MODULE_DISABLED` refresh
Tests first (`spa-oct-prayers-bus.test.ts`):
- `_prayersOn()` true with `{}`; false with `modules.prayers:false`.
- `moreItems()` leaves Prayers out when off.
- `render()` with `S.page='prayers'` and Prayers off goes home.
- The `MODULE_DISABLED` handler refetches `/settings`, rebuilds the shell when `_navSig()` changed, then
  `go('home')`.

Change: every item in the spec's "SPA, when off" list (moreItems, leader Home quick-action grid ~2631,
`render()`, `_prefetch`, My Connections fetch/summary/pray button ~3630, student-profile "+ Prayer"
~4510, New Year Refresh export/re-import shown as "skipped" and counted done like CA). Modules card gets a
Prayers toggle; turning it off opens "Export prayers first? [Download CSV] [Turn off]" (download =
existing `GET /prayers/export`).

### Task S2.2 [Sonnet] — `_navSlots`
Tests first: Prayers on + Bus on → slot is More; Prayers off + Bus on + New person off → slot is the Bus
tab (`{id:'bus', ic:'bus', label:L('busMinistry')}`); Prayers off + only New person → New person tab with
`action:'nyOpen()'`; Prayers off + nothing → no slot, bottom bar has 4 items, `quickActionItems()` is
unchanged versus the slot-present case; Prayers on alone → plain Prayers tab. Run for every role.

Change: `_navSlots()` returns `_navItemsBase()` with the `prayers` item resolved per the spec table
(null when empty); `bottomNavItems = _navSlots().slice(0,5).filter(Boolean)`,
`quickActionItems = _navSlots().slice(5)` (filter nulls), `navItems = _navSlots().filter(Boolean)`.
Do not touch `openMore()` or its styling. Update `new-youth.spa.test.ts` only if an assertion depended on
the old slicing; say so in the hand-back.

### Task S2.3 [Sonnet] — Bus All cars tab
Tests first: `renderBus` tab list includes `allcars` only when `v.canSeeCars`; `_busAllCarsHtml` escapes
car, leader and rider names and suburbs (feed `<b>` and assert escaped), shows a tick for dropped, has no
buttons; `busRefresh()` fetches `/bus/run/cars` only when `BUS.tab === 'allcars'`; `doLogout` clears
`BUS.cars`; `BUS.view` is never written by the cars fetch.

Change: per the spec's Part C "SPA" section. Remember the `?now=` query every `/bus` call carries.

### Task S2.4 [Sonnet] — Service worker cache bump (once)
Files: `public/sw.js`. Read the current `CACHE` (`ysc-v89` at `f105c46`) and bump by one. `API_RE` does
not change. No test; run the verify command.

---

## Lane V — Final verification and docs (last)

### Task V1 [Opus] — Final verification
1. `git status` shows only intended files; `git diff f105c46 --stat` lists only files named in this plan.
2. The verify command passes; record the test count.
3. `grep -n "0016_" supabase/migrations` shows exactly one file; `LATEST_MIGRATION === '0016'`.
4. `grep -nE "prefers-color-scheme" public/index.html` adds nothing new.
5. `grep -nE "'[^'\n]*\b(can|don|won|isn|doesn|hasn|didn)'t" public/index.html` — no new hits in changed
   lines.
6. Review the bus allow-list test and the settings on/off tests line by line against the spec.
7. Local smoke run (`npm run dev`, memory mode): log in as `b1012`, turn Simple on as admin, reopen,
   check the badge reads "Senior Guys", the Grades bar shows, Assign is gone; turn it off, check grade
   accounts return. Turn Prayers off; check More/slot behaviour. Set New person to Shadow; check All cars
   as admin only.
8. Run `/code-review` (high) on the branch diff; fix or list findings.

### Task V2 [Sonnet] — CLAUDE.md "Resume here"
Files: `CLAUDE.md`. Add a dated section "October rework (2026-10-12)" with a **▶ Resume here** block:
state (built on `feat/oct-rework`, not pushed/promoted), one short paragraph per part (A Simple logins,
B Prayers off, C All cars), the server-owned `retiredGradeIds`/`gradeRoleWasOn` rule, the duplicate-
migration guard, the new routes (`PATCH /leaders/:id/view-grades`, `GET /bus/run/cars`), the SW cache
value, the rollout steps below, and open owner calls. Change the migrations note "the next migration is
`0016`" to **`0017`** (`0016` = `leaders.view_grades`; the Elvanto link takes `0017`, decision 15). Add
the two routes to the Key API routes table.

---

## Operator rollout (in this order)

1. **Export prayers.** Admin → Prayers export CSV (or Youth Setup Modules → Download CSV) **before**
   anything else; keep the file.
2. **Push / promote.** Merge `feat/oct-rework` to `master` and push. Every push to `master` runs
   `0016` on prod at build time, before promotion (safe: one nullable column the live code never names).
3. **Read back the build log** line `Database up to date — …` (it must count the new `0016`) and only
   then promote the build in the Vercel dashboard. `/health` must report `schema.current = 0016`.
4. **curl the new routes** on the promoted URL: `curl -s -X PATCH https://ys-connection.vercel.app/leaders/x/view-grades`
   and `curl -s https://ys-connection.vercel.app/bus/run/cars` must each return a **JSON 401**, not HTML.
   Nothing changes for YS Brisbane yet (`logins.simple` false, `prayers` true; All cars only in Shadow
   for admin, or On).
5. **Flip Simple logins for YS Brisbane when ready** (1–2 weeks, with the check-in release, on a weekday):
   first fill Bus settings → coordinators and check each can pick themselves in "I am…"; then turn it on
   and check: no Grade section in Accounts; toast "Renamed 4 quad logins"; badge "Senior Guys" after
   reopening; on Senior Guys, picking Cody Cobb shows Year 10 in Health and still does on another phone;
   a quad login with no coordinator pick has no Assign tab; a coordinator pick does. Tell users to reopen
   the app; old grade logins stop within 12 h.
6. **Turn Prayers off** (Youth Setup → Modules), using the export from step 1 (or export again first).
