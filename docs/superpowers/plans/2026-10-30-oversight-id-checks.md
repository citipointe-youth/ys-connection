# Oversight role + ID Checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the `director` role to `oversight` (Phase 1, shippable alone), then add the optional ID Checks module: tick-only, encrypted, per-leader catch-up records with "Last time", a rhythm list, an admin grid, an archive and a per-leader export (Phase 2).

**Architecture:** Phase 1 is a data migration (`0052`) plus a mechanical sweep of code, tests and docs. Phase 2 adds two tables (`0053`), one repo pair (memory + Supabase, encryption only in the Supabase repo), one service with two pure helpers (question bank, rhythm), one controller under the new top-level `/id-checks`, and one delimited SPA block in `public/index.html`. The export is built in the SPA from the existing ticked-only leader route (no new route).

**Tech Stack:** TypeScript, Express, zod, postgres.js, vitest, single-file SPA (`public/index.html`), vendored SheetJS (`public/vendor/xlsx.full.min.js`).

**Spec:** `docs/superpowers/specs/2026-10-30-oversight-id-checks-design.md` (decisions A-M). Read it before any task; section numbers below (§7.4 etc.) point into it.

## Global Constraints

- Work only on branch `feature/oversight-id-checks` (lane worktrees branch from it and merge back into it). No merge to master, no push, no deploy, no ship, never touch production Supabase, never `taskkill /IM node.exe`.
- Commit trailer on every commit:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_014sNcg1youZ4tktm8ppXj3m`
- Full local check (end of every task that touches code): `npx tsc --noEmit && node scripts/check-spa-syntax.js && npx vitest run <the task's test files>`; the whole `npx vitest run` at each phase checkpoint.
- Layering `api → controllers → services → repositories (interfaces) → core`; RBAC only in `src/services/access-control.ts`; zod inside services; repos return deep clones; extensionless imports.
- Migrations idempotent (`if not exists`, guarded `update ... where`); jsonb via `sql.json(value)`; bump `LATEST_MIGRATION` in `src/core/schema-version.ts` with each file.
- SPA: no contractions in single-quoted strings; every user string through `esc()`; buttons min 44px; `fmtDay` for dates; `.rc` rows; `_here()`/`_still(h)` around awaits; no dark mode; no emoji. SPA function prefix `_ic` (grep first: it must collide with nothing).
- Fictional names only in tests, fixtures, seed and commits (Sample, Dummyton, Codeman).
- Notes never in logs, Error log, push, digests, bulk exports, fixtures or `console.error`; the per-leader export (decision M) is the only way out.
- No new npm dependency.
- `public/sw.js` `CACHE` is bumped exactly once per phase, in that phase's docs task (Tasks 4 and 17), never in a lane task.

## Review Focus

1. **Late autosave after Finish** (a debounced PUT with `finished:false` landing after the Finish PUT) must leave the row finished. Pinned in Task 9 (`finished never goes back`).
2. **Admin with no ticks** must get 404 on a leader route and an empty list, though `idcheck:use` passes. Pinned in Task 9 (`admin unticked = 404`).
3. **A tick for an account that later becomes a quad login or is deactivated** must stop granting access without deleting the tick. Pinned in Task 9 (`inert tick`).
4. **A draft in `localStorage` after the server confirmed** must be removed, and a draft from a different login must never restore (logout clears all `ysc.ic.` keys). Pinned in Task 14.
5. **Export by a session whose tick was removed after the leader page loaded** must produce no file (fresh fetch gets 404, toast, no download). Pinned in Task 16.

---

## Lanes (parallel subagents in separate worktrees)

```
Phase 1:  L-R1 [T1 -> T2]   ||   L-R2 [T3]          then  T4 (docs, joins both)   -> checkpoint P1
Phase 2:  T5 + T6 + T7 (base, one lane, small)
          L-S  [T8 -> T9 -> T10 -> T11]   ||   L-U [T12 -> (L-U1: T13 -> T14) || (L-U2: T15 -> T16)]
          then T17 (docs + SW bump), T18 (console docs, separate repo, any time after T7), T19 (final review)
```

Conflict rules:
- `public/index.html` is touched only by T3 (Phase 1) and by L-U (Phase 2). T12 creates one block `/* ── ID CHECKS MODULE ── */ ... /* ── END ID CHECKS ── */` with four empty marker lines `/*IC-LIST*/`, `/*IC-EDIT*/`, `/*IC-GRID*/`, `/*IC-EXPORT*/`. L-U1 inserts only above `/*IC-LIST*/` and `/*IC-EDIT*/`, L-U2 only above `/*IC-GRID*/` and `/*IC-EXPORT*/`, so the hunks never overlap. Hooks outside the block (`PAGE_MODULE`, `moreItems`, `render` dispatch, Setup switch, Full Reset line, logout) are all made in T12, except the Full Reset text line (T15, at ~line 6996, a region no other task touches).
- `public/sw.js`: L-S edits only the `API_RE` line (T11); the `CACHE` line only in T4/T17.
- `src/tests/fixtures/module-owners.json`, `module-tree.json`: only T7 (adds `idChecks: []`) and T12 (fills its page ids).
- Phase 1 test split: T2 owns every `src/tests/*.test.ts` that is **not** `*.spa.test.ts`; T3 owns `*.spa.test.ts` and `src/tests/fixtures/baseline-nav.json`. A non-spa test that greps `public/index.html` for a role string belongs to T3 (grep for `index.html` in the file first).
- `CLAUDE.md`, `README.md`, `DEPLOY.md`: only T4 and T17.
- Merge order into the feature branch: L-R1, L-R2, T4; then base, L-S, L-U1, L-U2, T17, T19. T18 lives in the console repo and merges nowhere. After each merge run the full check.

## Review set (MEDIUM, operator ruling for this plan; overrides spec §11)

- Per task: the implementer's reviewer does one spec-compliance check of that task against the spec sections it names. Nothing else per task.
- At the end (T19): ONE `/code-review medium` over `git diff eb41ada...HEAD`, and ONE phone-width (390px) UX walkthrough with screenshots of: the ID Checks list, a check in progress showing "Last time", the Assign leaders grid, and the export sheet plus the opened .txt.
- Not run: ponytail audit, Impeccable pass, ultra review.

---

# Phase 1: `director` → `oversight`

### Task 1: Migration 0052 (role data + config key)

**Files:**
- Create: `supabase/migrations/0052_role_oversight.sql`
- Modify: `src/core/schema-version.ts` (`LATEST_MIGRATION = '0052'`)
- Test: `src/tests/role-oversight.migration.test.ts` (copy the harness of `src/tests/module-switchboard.migration.test.ts`)

**Interfaces:** Produces: DB with no `director` in `users.role`, `prayer_requests.created_by_role`, `connections.assigned_by_role`, `error_log.last_role`; `ministry_config.roles.enabled.oversight` carrying the old `director` value.

- [ ] **Step 1: Write the failing test.** Read the file text and assert it contains, each once: `update users set role = 'oversight' where role = 'director'`, the same for `prayer_requests.created_by_role`, `connections.assigned_by_role`, `error_log.last_role`; a `jsonb_set(ministry_config #- '{roles,enabled,director}', '{roles,enabled,oversight}', ministry_config->'roles'->'enabled'->'director')`; a guard `jsonb_typeof(ministry_config->'roles'->'enabled') = 'object'` and `? 'director'` and `not (... ? 'oversight')`. If the switchboard test runs SQL on `LINK_TEST_DATABASE_URL`, mirror that block too (skips locally): a row with `{"roles":{"enabled":{"director":false}}}` ends as `{"oversight":false}`; a double-encoded string row is untouched; running the file twice changes nothing.
- [ ] **Step 2:** `npx vitest run src/tests/role-oversight.migration.test.ts` → FAIL (file missing).
- [ ] **Step 3:** Write the migration (spec §7.1, guarded like `0050_module_switchboard.sql`); bump `LATEST_MIGRATION`.
- [ ] **Step 4:** `npx vitest run src/tests/role-oversight.migration.test.ts src/tests/schema-version.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(db): 0052 rename director role data to oversight`.

### Task 2: Server + non-SPA tests rename

**Files (modify):** `src/core/types/enums.ts` (`USER_ROLES`), `src/core/ministry-config.ts` (~150, `roles.enabled.oversight` default true + legacy preprocess), `src/services/account.service.ts:20`, `src/services/access-control.ts`, `src/services/settings.service.ts:20` (`OPTIONAL_ROLES`), `src/services/link.service.ts`, comments/strings in `src/app.ts`, `src/core/entities/{bus,prayer,user}.ts`, `src/core/link-contract.ts`, `src/services/{auth,bus,connection,dnc,followup,lifegroup-stats,link-rules,notice,prayer,student}.service*.ts`/`.ts`, `src/seed.ts`; every non-spa test under `src/tests/` that says `director`.
- Test: `src/tests/role-oversight.test.ts` (new)

**Interfaces:** Produces: `UserRole` includes `'oversight'`, not `'director'`; `ROLE_PERMISSIONS.oversight` = old director set; seed accounts `oversight` (role oversight, display "Oversight") and `oversight2` (role oversight, display "Oversight Two"); `MinistryConfigSchema` accepts legacy `roles.enabled.director` and reads it as `oversight`.

- [ ] **Step 1: Write the failing test** `role-oversight.test.ts`:
  - `USER_ROLES` contains `'oversight'` and not `'director'`.
  - For every `Action`, `can({role:'oversight',...}, a)` equals what director had: assert against a snapshot list taken from `git show eb41ada:src/services/access-control.ts` (paste the director action list into the test as a literal array).
  - `MinistryConfigSchema.parse({ roles: { enabled: { director: false } } }).roles.enabled.oversight === false`; with both keys set, `oversight` wins; output has no `director` key. (`parseMinistryConfig` lives in `src/repositories/supabase/supabase.settings.ts`; test the schema directly.)
  - Settings behaviour (`OPTIONAL_ROLES` at `settings.service.ts:20` is not exported, so test through the service): with memory repos and an active `oversight` account, the settings service update that turns `roles.enabled.oversight` off deactivates that account, and a quad account stays active.
  - Guard: `grep`-style scan of every `src/**/*.ts` outside `src/tests/` for `/\bdirector\b/i`; allowed only in `ministry-config.ts` (the legacy preprocess line, marked `// legacy key`). Expect zero other hits.
- [ ] **Step 2:** `npx vitest run src/tests/role-oversight.test.ts` → FAIL.
- [ ] **Step 3:** Do the sweep (spec §6 A table). User-facing server text: "Only the admin or an oversight login..." in `link.service.ts`. Seed per spec §7.10 (username `oversight`, plus `oversight2`). Legacy preprocess modelled on the `newYouthForms` boolean preprocess in `ministry-config.ts`.
- [ ] **Step 4:** Sweep non-spa tests: role strings, usernames (`'director'` login → `'oversight'`), test names. `npx tsc --noEmit && npx vitest run --exclude "**/*.spa.test.ts"` → PASS.
- [ ] **Step 5:** Commit `refactor: rename director role to oversight (server)`.

### Task 3: SPA rename (lane L-R2, parallel with T1-T2)

**Files:** Modify `public/index.html` (~90 hits: role arrays, `_ROLE_LABEL_DEFAULTS` label **"Oversight"**, role help text, More rules, `_navSlots` `pw`, comments), every `src/tests/*.spa.test.ts` that says director, `src/tests/fixtures/baseline-nav.json`.
- Test: `src/tests/role-oversight.spa.test.ts` (new)

**Interfaces:** Consumes the role string `'oversight'` (T2). Produces: SPA treats `oversight` exactly as it treated `director`.

- [ ] **Step 1: Write the failing test:** loading `public/index.html` text, `/\bdirector\b/i` matches zero times inside the inline script and markup (allow none); `extractFn(HTML,'moreItems')` run with `S.user.role='oversight'` returns the Import entry; `_ROLE_LABEL_DEFAULTS.oversight === 'Oversight'`; `_navSlots({role:'oversight'})` contains a `more` slot.
- [ ] **Step 2:** `npx vitest run src/tests/role-oversight.spa.test.ts` → FAIL.
- [ ] **Step 3:** Sweep `public/index.html` (every `'director'` → `'oversight'`, label text "Director" → "Oversight", help text "Admin and director..." → "Admin and oversight..."). Do not touch `public/sw.js`.
- [ ] **Step 4:** Sweep `*.spa.test.ts` + `baseline-nav.json`. `node scripts/check-spa-syntax.js && npx vitest run "src/tests/*.spa.test.ts"` → PASS.
- [ ] **Step 5:** Commit `refactor(spa): rename director role to oversight`.

### Task 4: Phase 1 docs + SW bump + checkpoint (after merging L-R1 and L-R2)

**Files:** `CLAUDE.md` (role table, seed table with `oversight`/`oversight2`, every "director" in current-truth sections; leave dated history sections), `README.md`, `DEPLOY.md` (rollback block below), current guides under `docs/` that are not history (`docs/DEPLOYING.md`, `docs/leader-handout.md` if they name the role; not `docs/HISTORY.md`, `CHANGELOG.txt`, old specs/plans), `public/sw.js` `CACHE` → next free `ysc-vN` (read the current value, add 1).

- [ ] **Step 1:** Edit docs. DEPLOY.md gets "Rollback below 0052: run before Instant Rollback" with the four reverse UPDATEs and the reverse `jsonb_set` (from Deploy notes below).
- [ ] **Step 2:** Bump `CACHE`.
- [ ] **Step 3: Checkpoint P1:** `npx tsc --noEmit && node scripts/check-spa-syntax.js && npx vitest run` → all PASS; `PERSISTENCE=memory npm run start`, sign in as `oversight` with the printed password, confirm Home loads and More holds Import (stop the server by its own PID / Ctrl+C only).
- [ ] **Step 4:** Commit `docs: oversight role rename + SW bump`.

---

# Phase 2: ID Checks

### Task 5: Question bank (base)

**Files:** Create `src/core/id-check-questions.ts`; Test `src/tests/id-check-questions.test.ts`.

**Interfaces:** Produces
```ts
export type IdCheckQuestion = { key: string; text: string; retired?: true };
export type IdCheckSection = { key: 'faith'|'form'|'family'|'finances'|'fruit'|'general'; title: string; subtitle: string; questions: IdCheckQuestion[] };
export const ID_CHECK_SECTIONS: readonly IdCheckSection[];
export const ID_CHECK_KEYS: ReadonlySet<string>; // every question key, retired included
```

- [ ] **Step 1: Test:** section keys in order `faith, form, family, finances, fruit, general`; question counts `10, 11, 10, 10, 9, 12` (62 total); keys are `<section><NN>` two-digit, unique; `faith01.text === "How's your relationship with God?"`; `form05.text === "Do you think that ___ is beneficial? What do you think about that?"`; `general12.text === 'Do you have any questions?'`; title of faith `'FAITH'`, subtitle `'their walk with God'` (SPA renders `title + ' – ' + subtitle`); no `retired` yet.
- [ ] **Step 2:** run → FAIL. **Step 3:** transcribe spec §9 exactly. **Step 4:** run → PASS. **Step 5:** commit `feat: ID check question bank`.

### Task 6: Rhythm (base)

**Files:** Create `src/services/id-check-rhythm.ts`; Test `src/tests/id-check-rhythm.test.ts`.

**Interfaces:** Produces
```ts
export type IdCheckStatus = 'overdue' | 'never' | 'dueSoon' | 'onTrack';
export function addMonths(ymd: string, n: number): string;          // clamps to month end
export function dueOn(today: string, cycleStart: string, intervalMonths: number, last: string | null): string;
export function statusOf(today: string, due: string, last: string | null): IdCheckStatus;
export function sortRows<T extends { dueOn: string; status: IdCheckStatus; name: string }>(rows: T[]): T[];
```

- [ ] **Step 1: Test** (spec §7.6 table): `addMonths('2026-08-31',6) === '2027-02-28'`; `addMonths('2027-08-31',6) === '2028-02-29'`; unset start: `dueOn('2026-10-30','',6,null) === '2026-10-30'`, `dueOn('2026-10-30','',6,'2026-05-01') === '2026-11-01'`; catch-up window: `dueOn(t,'2026-11-01',6,null) === '2027-01-01'` and `last='2026-10-01'` (before start) gives the same; normal: `dueOn(t,'2026-01-01',4,'2026-06-15') === '2026-10-15'`; start in the future + no last → `'never'` (no check ever and not overdue is always `never`; spec order overdue > never > dueSoon > onTrack); `statusOf('2026-10-30','2026-10-29','2026-04-01') === 'overdue'`; `'never'` beats dueSoon/onTrack when `last` null and not overdue; 30 days exactly is `dueSoon`, 31 is `onTrack`; sort: by `dueOn`, then `never` first on the same day, then name (`localeCompare`).
- [ ] **Step 2:** FAIL. **Step 3:** implement (UTC date math on `YYYY-MM-DD` strings). **Step 4:** PASS. **Step 5:** commit `feat: ID check rhythm`.

### Task 7: Config + module tree (base)

**Files:** Modify `src/core/ministry-config.ts` (`ModulesSchema.idChecks`, top-level `idChecks`), `src/core/module-tree.ts` (`{ key: 'idChecks', label: 'ID Checks' }` after `notices`), `src/tests/fixtures/module-tree.json` (regenerate = `JSON.stringify(MODULE_TREE)`), `src/tests/fixtures/module-owners.json` (add `"idChecks": []`, like `intakeAdmin`, so `module-completeness.spa.test.ts` stays green; T12 fills the four page ids); Test `src/tests/id-check-config.test.ts`.

**Interfaces:** Produces `ministryConfig.modules.idChecks: 'off'|'on'` (default `'off'`), `ministryConfig.idChecks: { cycleStart: '' | string /*YYYY-MM-DD*/; intervalMonths: number /*int 1-12, default 6*/ }`.

- [ ] **Step 1: Test:** defaults `modules.idChecks === 'off'`, `idChecks` `{cycleStart:'', intervalMonths:6}`; `intervalMonths: 13` and `0` fail parse; `cycleStart: '2026-13-01'` fails; `'2026-11-01'` passes; `MODULE_TREE` has `idChecks`; `module-tree.test.ts` passes after regeneration.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** `npx vitest run src/tests/id-check-config.test.ts src/tests/module-tree.test.ts src/tests/module-*.test.ts` → PASS (all must pass, `module-completeness.spa.test.ts` included). **Step 5:** commit `feat: idChecks module switch and rhythm config`.

### Task 8: Entity, repo interface, memory + Supabase repos, migration 0053 (L-S)

**Files:**
- Create `src/core/entities/id-check.ts`; `supabase/migrations/0053_id_checks.sql` (spec §7.1 SQL verbatim, plus `alter table ... enable row level security` like `0028_notices.sql`); `src/repositories/supabase/supabase.id-checks.ts`; in-memory class in `src/repositories/in-memory/in-memory.repositories.ts` (or a new `in-memory/id-checks.repository.ts` if that file pattern is used for newer repos, e.g. `unsent.repository.ts`)
- Modify `src/repositories/interfaces/entity-repositories.ts`, `src/core/schema-version.ts` (`'0053'`)
- Test `src/tests/id-check.repository.test.ts`

**Interfaces:** Produces
```ts
// core/entities/id-check.ts
export type IdCheckAnswer = { asked: boolean; note: string };
export type IdCheckCheckContent = { answers: Record<string, IdCheckAnswer>; nextTime: string };
export type IdCheckNoteContent = { text: string };
export interface IdCheckEntry {
  id: string; leaderId: string | null; leaderName: string; kind: 'check' | 'note';
  heldOn: string; finished: boolean; authorId: string; authorName: string;
  content: IdCheckCheckContent | IdCheckNoteContent; createdAt: string; updatedAt: string;
}
export interface IdCheckTick { leaderId: string; userId: string }

// interfaces/entity-repositories.ts
export interface IIdCheckRepository {
  init(): Promise<void>;
  findEntry(id: string): Promise<IdCheckEntry | null>;
  listByLeader(leaderId: string): Promise<IdCheckEntry[]>;               // held_on desc, updated_at desc
  lastFinished(leaderIds: string[]): Promise<Map<string, string>>;      // leaderId -> latest finished check held_on
  inProgress(leaderIds: string[]): Promise<Map<string, { id: string; authorId: string; authorName: string }>>; // newest unfinished check
  upsert(e: IdCheckEntry): Promise<IdCheckEntry>;                       // finished = stored.finished OR e.finished; kind/authorId never change on update
  deleteEntry(id: string): Promise<void>;
  ticks(): Promise<IdCheckTick[]>;
  ticksForLeader(leaderId: string): Promise<IdCheckTick[]>;
  setTicks(userId: string, leaderIds: string[], on: boolean): Promise<void>;
  archivedGroups(): Promise<{ name: string; count: number; lastOn: string }[]>;
  deleteArchived(name: string): Promise<number>;
  attachArchived(name: string, leaderId: string, leaderName: string): Promise<number>;
}
```
Memory repo constructor takes `leaderExists: (id: string) => Promise<boolean>`; any entry whose `leaderId` fails it is read as archived (`leaderId: null`), and its ticks are ignored (spec §7.1 Decision I). Supabase repo: `content` = `maybeEncrypt(JSON.stringify(content), 'id_check_entries:content:' + id)` on write, `JSON.parse(maybeDecrypt(...))` on read (see `supabase.students.ts`); the `finished` OR in SQL (`on conflict (id) do update set finished = id_check_entries.finished or excluded.finished`); `kind`, `author_id`, `author_name`, `created_at` not in the update set. Export `toRow`/`fromRow` for the test.

- [ ] **Step 1: Test** (memory repo, plus `toRow`/`fromRow` with a test `FIELD_ENCRYPTION_KEY` set in `beforeAll`): upsert twice with same id = one row; `finished:true` then `finished:false` stays true; `lastFinished` ignores unfinished and notes; `inProgress` returns newest unfinished check; leader deleted (`leaderExists` false) → `listByLeader` empty, `archivedGroups()` = `[{name:'Sample Dummyton',count:2,lastOn:'2026-10-20'}]`, `attachArchived` moves both to a new leader id and sets `leaderName`; `deleteArchived` returns 2; `toRow` content starts with `v1.` and contains no plain note text; `fromRow(toRow(e))` deep-equals `e`; migration file contains both `create table if not exists` and `on delete set null`; `LATEST_MIGRATION === '0053'`.
  Real-DB block, `describe.skipIf(!process.env.LINK_TEST_DATABASE_URL)` (same gating and setup as `src/tests/helpers/link-repo-suite.ts`; runs in CI on the throwaway postgres): with the Supabase repo on a migrated DB, deleting a leader row sets its entries' `leader_id` to null (SET NULL) and removes its `id_check_access` rows (CASCADE); `archivedGroups`, `deleteArchived`, `attachArchived` give the same results as the memory repo; upsert `finished:true` then `finished:false` reads back `true`; `kind` and `author_id` are unchanged by a second upsert.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** `npx tsc --noEmit && npx vitest run src/tests/id-check.repository.test.ts src/tests/schema-version.test.ts` → PASS. **Step 5:** commit `feat(db): 0053 id check tables and repositories`.

### Task 9: Permissions (L-S)

**Files:** Modify `src/services/access-control.ts`; Test `src/tests/id-check.access-control.test.ts`.

**Interfaces:** Produces actions `'idcheck:use'` (oversight, admin) and `'idcheck:assign'` (admin); `canSeeIdChecks(actor: Actor, tickedUserIds: Set<string>): boolean` = `can(actor,'idcheck:use') && tickedUserIds.has(actor.id)`; `isIdCheckTickTarget(u: User): boolean` = active and role in `['oversight','admin']`.

- [ ] **Step 1: Test:** each role × both actions (only oversight+admin use, only admin assign); `canSeeIdChecks(admin, new Set())` false (**admin unticked**); `canSeeIdChecks(admin, new Set([admin.id]))` true; quad actor ticked → false (**inert tick**); `isIdCheckTickTarget` false for an inactive oversight and for quad.
- [ ] **Step 2-5:** FAIL → implement → PASS → commit `feat: idcheck permissions`.

### Task 10: Service (L-S)

**Files:** Create `src/services/id-check.service.ts`; Test `src/tests/id-check.service.test.ts`.

**Interfaces:** Consumes T5-T9. Produces `makeIdCheckService(deps: { repo: IIdCheckRepository; leaders: ILeaderRepository; users: IUserRepository; connections: IConnectionRepository; students: IStudentRepository; settings: ISettingsRepository; now?: () => Date })` returning:
```ts
list(a: Actor): Promise<{ leaders: ListRow[]; questions: readonly IdCheckSection[]; rhythm: { cycleStart: string; intervalMonths: number }; today: string }>;
  // ListRow = { id; name; gender; grades: number[]; lastCheckOn: string|null; dueOn: string; status: IdCheckStatus; inProgress: { entryId: string; authorName: string; mine: boolean } | null }
leader(a: Actor, leaderId: string): Promise<{ leader: { id: string; name: string }; entries: (IdCheckEntry & { mine: boolean })[] }>;
upsert(a: Actor, id: string, body: unknown): Promise<{ updatedAt: string; finished: boolean }>;
remove(a: Actor, id: string): Promise<void>;
grid(a: Actor): Promise<{ rows: { id; name; gender; grades: number[] }[]; columns: { id; name; role }[]; ticks: IdCheckTick[] }>;
setAccess(a: Actor, body: unknown): Promise<void>;       // { userId, leaderIds: string[] (1-500), on: boolean }
archived(a: Actor): Promise<{ name: string; count: number; lastOn: string }[]>;
archivedDelete(a: Actor, body: unknown): Promise<{ deleted: number }>;     // { name }
archivedAttach(a: Actor, body: unknown): Promise<{ moved: number }>;       // { name, leaderId }
```
Rules: a **deactivated** (not deleted) leader is treated as not found everywhere (list, leader route, grid rows, attach target), so their history stays hidden until reactivated; no extra UI (orchestrator ruling 2026-10-30, known limit, spec §7.1). Every method starts with `assertOn()` (copy from `notice.service.ts`: module off → `ModuleDisabledError`); not ticked / not found / inactive leader → `NotFoundError` (same message as missing); upsert body zod `{ leaderId: uuid, kind: 'check'|'note', heldOn: YYYY-MM-DD, finished: boolean, content }` with content `{answers: record(key in ID_CHECK_KEYS → {asked, note ≤4000}), nextTime ≤8000}` for checks, `{text ≤8000}` for notes; unknown question key refused (400, issue message carries no value); existing row: author only (`ForbiddenError`), `leaderId` must match the stored one; notes store `finished:false`; `leaderName`/`authorName` set from current records; today = `new Intl.DateTimeFormat('en-CA',{ timeZone: config.structure.timeZone }).format(now())`; delete: author or ticked; grid rows sorted per spec §7.7 (gender Girls/female, Guys/male, unset; then lowest grade of connected not-graduated students, none last; then name), columns = active users with `isIdCheckTickTarget`; setAccess refuses a non-target user (400) and inactive/unknown leader ids (400). No `console.*`, no errorLog calls with content.

- [ ] **Step 1: Test** (memory repos + seed helpers; spec §7.10 list): tick-only access (oversight unticked 404, admin unticked 404 + empty list, admin ticked full read); module off = `MODULE_DISABLED` on every method; author-only edit (other ticked account → 403), ticked non-author can read; delete by author and by other ticked account OK, by unticked → 404; **finished never goes back** (PUT finished true, then PUT false → stays true, `lastCheckOn` = that day); unfinished check leaves `lastCheckOn` null and gives `inProgress {mine:true}` (and `mine:false` with authorName for another ticked account); note never moves `dueOn`; unknown question key → 400 and the error `details` JSON does not contain the submitted note text; upsert idempotent (same body twice = one entry); deactivated leader → 404 on the leader route and absent from list/grid, and reactivating restores access with entries intact; leader delete (`leaders.delete` and `leaders.deleteAll`) → entries archived with name, ticks gone, `archived()` has no `content`/`text` key anywhere (JSON scan), `archivedDelete` and `archivedAttach` work and are admin-only; tick target quad → 400; grid sort order with three fictional leaders.
- [ ] **Step 2-4:** FAIL → implement → `npx tsc --noEmit && npx vitest run src/tests/id-check.service.test.ts` PASS. **Step 5:** commit `feat: id check service`.

### Task 11: Controller, routes, wiring, seed, privacy guard (L-S)

**Files:** Create `src/api/controllers/id-check.controller.ts`; Modify `src/api/http/router.ts` (9 routes, spec §7.5 table; `/id-checks/archived/delete` and `/attach` registered before any `:id` route), `vercel.json` routes regex (add `id-checks`), `public/sw.js` `API_RE` only (add `id-checks`), `src/container.ts` (repo by `useSupabase`, memory repo gets `leaderExists: async (id) => !!(await leaders.findById(id))`, service, `init()`), `src/seed.ts` (memory only: two ticks for `oversight` and one shared with `oversight2`; one finished fictional check for "Sample Dummyton" with two answers and a next-time note); Test `src/tests/id-check.privacy.test.ts`.

**Interfaces:** Produces the HTTP API (spec §7.5). `GET /id-checks/leaders/:id` response = `leader()` result; `PUT /id-checks/entries/:id` = `upsert()` result.

- [ ] **Step 1: Test** `id-check.privacy.test.ts`: (a) scan `src/**/*.ts` excluding `src/tests/` and the module's own files (`id-check*.ts`, `supabase.id-checks.ts`, the in-memory repo, `container.ts`, `entity-repositories.ts`, `router.ts`, the controller) for `id_check_` / `IdCheckRepository` / `idCheck` service use → zero hits (no export/backup/digest/audit reader); (b) `id-check.controller.ts` and `id-check.service.ts` contain no `console.` and no `errorLog`. `route-registration.test.ts` and `auth-routes.test.ts` must pick up `/id-checks` with no edit (each `auth:true` route → 401).
- [ ] **Step 2:** FAIL (until routes exist the route tests also fail on the new router lines; write router lines last to see it). **Step 3:** implement. **Step 4:** `npx tsc --noEmit && npx vitest run src/tests/id-check*.test.ts src/tests/route-registration.test.ts src/tests/auth-routes.test.ts` → PASS. **Step 5:** commit `feat: /id-checks routes`.

### Task 12: SPA plumbing (L-U; needs T7 merged; API shapes from T10 Interfaces)

**Files:** Modify `public/index.html`: create the ID CHECKS block (after the NOTICES block ~line 1860) with the four markers; `PAGE_MODULE` += `idchecks`, `idcheck-leader`, `idcheck-edit`, `idcheck-grid` → `'idChecks'`; `function _icOn()` (module on and role in `['oversight','admin']`); `moreItems()` entry after Notices `{ id:'idchecks', ic:<existing icon, e.g. 'clipboard' or 'id'>, label:'ID Checks', mbl:'ID Checks', open:"go('idchecks')" }`; `render()` guard (off or not allowed → `go('home')`, like notices ~2827) and dispatch for the four pages; Youth Setup → Modules switch beside Notices (~7474) plus, when on, cycle start `<input type="date">` and interval `<input type="number" min="1" max="12">` via `_setupSet('idChecks.cycleStart'|'idChecks.intervalMonths', ...)`; `MINISTRY_CONFIG_DEFAULTS_CLIENT` mirror; logout clears every `localStorage` key starting `ysc.ic.` (try/catch); `src/tests/fixtures/module-owners.json` owners for the four page ids. Test `src/tests/id-checks-nav.spa.test.ts`.

**Interfaces:** Produces `_icOn(): boolean`, page ids, the block markers; render functions are stubs `renderIdChecks()`, `renderIdCheckLeader()`, `renderIdCheckEdit()`, `renderIdCheckGrid()` that later tasks fill.

- [ ] **Step 1: Test:** `moreItems()` includes `idchecks` for `oversight` and `admin` with module on; not for quad/grade/leader; none when off; `module-completeness.spa.test.ts` and `module-tree.test.ts` pass; setup HTML contains `id="setup-idchecks"` and the two rhythm inputs only when on; the four markers appear exactly once.
- [ ] **Step 2-4:** FAIL → implement → `node scripts/check-spa-syntax.js && npx vitest run src/tests/id-checks-nav.spa.test.ts src/tests/module-*.test.ts` PASS. **Step 5:** commit `feat(spa): ID Checks plumbing`.

### Task 13: List + leader pages (L-U1)

**Files:** `public/index.html` (above `/*IC-LIST*/`); Test `src/tests/id-checks-list.spa.test.ts`.

**Interfaces:** Consumes `GET /id-checks`, `GET /id-checks/leaders/:id`, `DELETE /id-checks/entries/:id`. Produces `_icGet(path): Promise<any>`, `_icListHtml(data, isAdmin): string`, `_icLeaderHtml(data, userId): string`, `_icLastTime(entries, currentId, qKey): { on: string; note: string; asked: boolean } | null` (spec orchestrator's call 4: newest other check, finished or not, where `a.asked || a.note.trim()` is truthy for that key).

Copy (exact): pills overdue `.pill.bad` "Overdue", due soon `.pill.warn` "Due soon", never `.pill.neutral` "Never", on track `.pill.ok` "On track", in progress `.pill.info` "In progress"; meta `Last check <fmtDay> · Due <fmtDay>` (no "Last check" part when null); empty "No leaders are ticked for you yet. Ask the admin." / admin "No leaders are ticked for you yet. Tick some below."; unset start "The admin has not set the start date yet."; admin sees an **Assign leaders** button → `go('idcheck-grid')`. Leader page: **Start ID check** / **Resume ID check** (own newest unfinished), **Add note**, **Export** (wired in T16; button rendered here calling `_icExportOpen(leaderId)`), previous finished check in full (next-time notes first), history newest first (date, author, "Check"/"Note", "In progress" or "In progress (name)"), Edit (author only), Delete (two taps, "Delete for good?"), line "Worried about someone's safety? Follow the safeguarding policy, not this app." `API.get` (`public/index.html:1128`) always reads the 30 s `Cache` first, so every `/id-checks*` GET goes through one helper `_icGet(path)` that deletes that path from `Cache` (its per-key delete if it has one, else `Cache.clear()`) and then calls `API.get(path)`; never the theme `localStorage` cache (spec §7.9). So every read, and every read after a PUT/DELETE/tick, is fresh.

- [ ] **Step 1: Test** (`extractFn`): pill per status; in-progress pill beside status pill; empty states per role; Resume label when `inProgress.mine`; Edit absent on another author's entry; `_icLastTime` picks the newest other check where the key was asked, skips the current entry, returns null when none, and skips an answer `{asked:false, note:'   '}`; `_icGet` with a primed `Cache` entry for `/id-checks` still calls the network stub; every name in output passes through `esc()` (feed `<b>x</b>` and assert escaped).
- [ ] **Step 2-4:** FAIL → implement → `node scripts/check-spa-syntax.js && npx vitest run src/tests/id-checks-list.spa.test.ts` PASS. **Step 5:** commit `feat(spa): ID Checks list and leader pages`.

### Task 14: Check / note editor with autosave (L-U1)

**Files:** `public/index.html` (above `/*IC-EDIT*/`); Test `src/tests/id-checks-edit.spa.test.ts`.

**Interfaces:** Consumes `PUT /id-checks/entries/:id`, `_icLastTime` (T13). Produces `_icEditHtml(state): string`, `_icSchedule()`, `_icFlush(): Promise<boolean>`, `_icFinish()`, `_icDraftKey(id) => 'ysc.ic.' + id`.

Behaviour (spec §7.8): entry id `crypto.randomUUID()` on open; date field default today; six collapsible sections titled `title + ' – ' + subtitle`; questions with `retired: true` are hidden on a new check but shown on an existing check that already has an answer for them; per question a 44px "Asked" tick and a `<textarea>` revealed on open, with muted "Last time (<fmtDay>): <note or 'Asked'>" above it; "Notes for next time" box; status line "Saved 2:14pm" / "Not saved, retrying"; every change writes the draft to `localStorage[_icDraftKey(id)]` and schedules a PUT (debounce 1500 ms; also on `visibilitychange` hidden and `pagehide`); retry back-off 2 s, 5 s, 15 s then every 30 s; draft removed when the PUT that carried that exact state returns 2xx; on reopen a draft newer than the server's `updatedAt` is restored; autosave always sends `finished:false`; **Finish check** = flush, then PUT `finished:true`, then `go('idcheck-leader')`; **Save and close** = flush then back; note mode = one box + **Done**.

- [ ] **Step 1: Test** (fake timers + stub `API.put`): one PUT after 1.5 s of typing; draft key present before the reply, gone after a 2xx; a 503 keeps the draft and shows "Not saved, retrying"; Finish sends a final `finished:true` after any pending save and no later PUT carries `finished:false`; reopen restores the draft text; logout removes every `ysc.ic.` key and a draft under another user's session never restores (draft value stores `uid`, restore checks it); Last time line rendered for a question with an earlier note; a retired question (stub bank with one `retired:true`) is absent on a new check and present on an old check that answered it.
- [ ] **Step 2-4:** FAIL → implement → syntax check + `npx vitest run src/tests/id-checks-edit.spa.test.ts` PASS. **Step 5:** commit `feat(spa): ID check editor with autosave`.

### Task 15: Assign grid + archived history + Full Reset line (L-U2)

**Files:** `public/index.html` (above `/*IC-GRID*/`, plus the New Year Full Reset step card ~line 7019); Test `src/tests/id-checks-grid.spa.test.ts`.

**Interfaces:** Consumes `GET/PUT /id-checks/access`, `GET /id-checks/archived`, `POST /id-checks/archived/delete|attach`. Produces `_icGridHtml(data): string`, `_icTick(userId, leaderIds, on)`, `_icArchHtml(rows): string`.

Grid (spec §7.8): sticky first column, one tick column per account (display name + role label), sideways scroll inside its card (no page side-scroll at 390px), row meta grades "Gr 8, 9" via `_gradeWord()`-style label, per column "Tick all" / "Clear"; a tick saves at once and reverts + toast "Could not save. Try again." on failure. Archive list "Archived leaders' history" hidden when empty; rows name, "N entries", last `fmtDay`; **Delete forever** two taps "Delete all N entries for <name> for good? This cannot be undone."; **Re-attach** picker of active leaders, confirm "Everyone ticked for <leader> will be able to read these notes." Full Reset line: "ID-check history is kept. Leaders are deleted, so it moves to Archived leaders' history in More, ID Checks." **Apostrophe hazard:** `resetText` is interpolated into a single-quoted `confirmType({...body:'${resetText}...'})` onclick (~7019-7020), so the line must NOT go into `resetText`. Add it only to the card text: `_wizStepCard(4, 'Full Reset', resetText + (icOn ? ' ' + IC_RESET_KEPT : ''), ...)` with `const IC_RESET_KEPT = "ID-check history is kept. ...";` (double-quoted); the onclick keeps plain `resetText`. Archive rows: onclick passes the row's index into the last-loaded list (`_icArchDel(3)`, `_icArchAttach(3)`), never the name; the handler reads `IC.arch[i].name`.

- [ ] **Step 1: Test:** grid HTML has one column per account and checked boxes for ticks; failed PUT reverts the box; archive hidden for `[]`; confirm copy exact; no element of the archive HTML contains note text (input rows have no text field); a group named `O'Brien Sample` renders escaped and its onclick holds only an index; Full Reset with the module on: the card HTML contains the kept line, and the Full Reset button's onclick body parses (`new Function(body)` does not throw).
- [ ] **Step 2-4:** FAIL → implement → syntax check + test PASS. **Step 5:** commit `feat(spa): ID Checks grid and archive`.

### Task 16: Per-leader export (L-U2)

**Files:** `public/index.html` (above `/*IC-EXPORT*/`); Test `src/tests/id-checks-export.spa.test.ts`.

**Interfaces:** Consumes `GET /id-checks/leaders/:id` through `_icGet` (T13; always deletes the `Cache` entry first, so the export is a fresh server-checked read), `ID_CHECK` sections from the list payload (`questions`), `_downloadText(filename, text, mime)`, `_ensureXlsx()`. Produces `_icExportText(leader, entries, sections): string`, `_icExportRows(leader, entries, sections): string[][]`, `_icExportOpen(leaderId)`, `_icExportGo(kind: 'txt'|'xlsx')`.

Spec decision M. Sheet: two buttons **Text file** / **Excel file**, line "The file holds private notes. Keep it safe and delete it when done." Text layout, per entry newest first:
```
ID checks: <leader name>
Exported <fmtDay today> by <user display name>

== Check, <fmtDay heldOn>, <author> (Finished | In progress) ==
FAITH – their walk with God
- <question text> [Asked]
  <note>
...
Notes for next time:
<nextTime>

== Note, <fmtDay heldOn>, <author> ==
<text>
```
Only asked or noted questions are listed; a key not in the bank prints as the key. xlsx: one sheet "ID checks", header `Date, Kind, Status, Author, Section, Question, Asked, Note`, one row per answered question, one row per non-empty next-time (Question "Notes for next time"), one row per note (Kind "Note"). Filenames `id-checks-<leader name with non-alphanumerics as ->-<today>.txt|.xlsx`; text mime `text/plain`. On 404 (tick removed): toast "You no longer have access to this leader.", no download. No `console.*`, no server call other than the GET.

- [ ] **Step 1: Test:** `_icExportText` for a fixture with one finished check, one in-progress check (with a retired/unknown key) and one note contains "(Finished)", "(In progress)", "== Note,", the section heading with en dash, "[Asked]", the next-time text, and omits unasked questions; `_icExportRows` header exact and row count = answered + next-time + notes; `_icExportGo` with a primed `Cache` entry for the leader path still hits the network stub; with a stubbed 404 it calls no download; with 200 calls `_downloadText` once with `text/plain` (txt) and `XLSX.writeFile` once (xlsx, stub `_ensureXlsx`).
- [ ] **Step 2-4:** FAIL → implement → syntax check + test PASS. **Step 5:** commit `feat(spa): per-leader ID check export`.

### Task 17: Phase 2 docs + SW bump (after merging L-S, L-U1, L-U2)

**Files:** `CLAUDE.md` (Modules: an "ID Checks" section of ≤12 lines: tables, encryption seam, tick-only rule, archive, export, privacy rules; API routes row; seed table `oversight2`; Migrations line `0052`, `0053`), `DEPLOY.md` (Part 2 checklist from Deploy notes), `public/sw.js` `CACHE` + 1.

- [ ] **Step 1:** Edit docs. **Step 2:** bump `CACHE`. **Step 3:** full check `npx tsc --noEmit && node scripts/check-spa-syntax.js && npx vitest run` → all PASS. **Step 4:** commit `docs: ID Checks module + SW bump`.

### Task 18: Console docs wording (separate repo, any time after T7)

**Repo:** `C:\Users\ThomasPC\src\wt24-console`. **Files:** `docs/install-runbook.md:137,158`, `SETUP.md:71`, the console's byte copy of `module-tree.json` (find it: `git -C C:/Users/ThomasPC/src/wt24-console ls-files | grep module-tree.json`).

- [ ] **Step 1:** `git -C C:/Users/ThomasPC/src/wt24-console status` must be clean (else stop and report); `git -C C:/Users/ThomasPC/src/wt24-console switch -c feature/oversight-wording`.
- [ ] **Step 2:** "director or admin" → "oversight or admin" on those lines (and any other `director` role wording there); copy YS `src/tests/fixtures/module-tree.json` over the console copy byte for byte (`cp`).
- [ ] **Step 3:** Run the console test that compares its module-tree copy, if one exists (grep its tests for `module-tree.json`) → PASS. Never `require`/run console runners to check syntax.
- [ ] **Step 4:** Local commit `docs: oversight wording + module tree copy` with the trailer. No push, no merge, no console restart.

### Task 19: Final medium review (no ship)

- [ ] **Step 1:** `/code-review medium` over `git diff eb41ada...HEAD`; fix findings that are bugs, one commit per fix with a test; re-run the full check.
- [ ] **Step 2:** UX walkthrough at 390px width on `PERSISTENCE=memory npm run start` (port 4300; stop it by its own PID only): turn ID Checks on as `admin`, set cycle start; as `oversight`: list (screenshot 1), open "Sample Dummyton", Start ID check, tick two, type a note, reload the page mid-way (draft restores), Finish; start a second check and open the same question (screenshot 2: "Last time"); as `admin`: Assign leaders grid (screenshot 3); as `oversight`: Export → Text file and open the file (screenshot 4: sheet + file). Save screenshots under `C:\Users\ThomasPC\src\oversight-review-2026-10-30\`.
- [ ] **Step 3:** Confirm `git status` clean, branch not pushed. Stop. Deploy is the operator's (notes below).

---

## Deploy notes for tomorrow (operator; not part of this plan's execution)

1. **Part 1 first (0052):** outside Fri 17:30-20:00 / Sun 10:00-12:00. After the build: log shows `0052` applied and `Database up to date`; `/health` `schema.current = 0052`; sign in as an oversight login; the console's Friday upload login still works (it is now `oversight`; keep it active, not one of the five personal logins). Then create the five personal oversight logins in Admin > Accounts.
2. **Part 2 (0053):** snapshot the prod DB first (adds tables); `FIELD_ENCRYPTION_KEY` already set (required). After the build: `/health` `schema.current = 0053`; `curl -s https://ys-connection.vercel.app/id-checks` → JSON 401. Module stays Off until the admin turns it on, sets the cycle start and fills the grid.
3. **Console docs:** committed locally by T18 on console branch `feature/oversight-wording` (`wt24-console`); merge it with Part 2. No console code, no `LINK_REV` change.
4. **Rollback below Part 1** (run in the Supabase SQL editor BEFORE an Instant Rollback, else oversight logins get 403):
   ```sql
   update users set role = 'director' where role = 'oversight';
   update prayer_requests set created_by_role = 'director' where created_by_role = 'oversight';
   update connections set assigned_by_role = 'director' where assigned_by_role = 'oversight';
   update error_log set last_role = 'director' where last_role = 'oversight';
   update app_settings set ministry_config = jsonb_set(ministry_config #- '{roles,enabled,oversight}', '{roles,enabled,director}', ministry_config->'roles'->'enabled'->'oversight')
    where id = 'global' and jsonb_typeof(ministry_config) = 'object' and jsonb_typeof(ministry_config->'roles'->'enabled') = 'object' and ministry_config->'roles'->'enabled' ? 'oversight';
   ```
   Rollback below Part 2 needs nothing (0053 is additive; the tables stay unused).
