# Elvanto link (app side): implementation plan

Spec (binding, reviewed): `docs/superpowers/specs/2026-10-12-elvanto-link-app-design.md` ("the spec"), with its mockup
`docs/superpowers/specs/2026-10-12-door-checkin-mockup.html`. Frozen contract:
`docs/superpowers/specs/2026-10-11-elvanto-link-contract.md` + `src/tests/fixtures/elvanto-link/` (incl. `manifest.json`)
+ `src/core/link-contract.ts`. Decisions 1–19: `docs/superpowers/elvanto-link-progress.md` ("the ledger").
Conventions: repo `CLAUDE.md`.

Worktree `C:\Users\thoma\ysc-work\link`, branch `feat/elvanto-link-app`, starting at `834b8fd`.
This plan is the "how". When the plan and the spec disagree, the spec wins: stop and tell the orchestrator.

**This repo is public.** No tenant URL, real name, real id or token goes into code, tests, docs or commit messages.

---

## GUARDRAILS (every executor reads these first)

1. **Feature branch only.** Work on `feat/elvanto-link-app` in this worktree. Never check out or touch `master`.
2. **No push.** Nothing leaves this machine. The operator pushes, from the PC (Task H1).
3. **Commit only with explicit paths.** `git add <path> <path> ...`, never `git add -A` / `git add .` /
   `git commit -a` (untracked local dirs such as `supabase/.temp/` and `_design/` must never be swept in). Before
   each commit, `git diff --cached --name-only` must be a subset of the lane's file list below. Every commit message
   ends with:
   ```
   Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
   Claude-Session: https://claude.ai/code/session_01DP7w9MvCaeFQa6rMWQxFcZ
   ```
   Sonnet executors do not commit; they hand back, and the orchestrator reviews and commits.
4. **No Supabase MCP writes** (no `apply_migration`, `execute_sql` writes, `create_branch`, nothing). Migrations
   apply only in the Vercel production build. Never run `npm run migrate` against a prod URL.
5. **No Vercel env changes** (no `create_project_env` / `edit_project_env` / `vercel env`). The operator sets
   `LINK_SYNC_TOKEN`.
6. **Route checklist** for `/link` and `/sync` (both new top-level prefixes): `src/api/http/router.ts` +
   `vercel.json` `routes[0].src` regex + `public/sw.js` `API_RE` + bump `public/sw.js` `CACHE`. Only lane E edits
   `vercel.json` and `sw.js`; Task R1 re-bumps `CACHE` after the rework merge.
7. **`esc()` every user value** that goes into `innerHTML`: names, leader names, group and flow names, step names,
   service names, logins, device labels, reasons, `detail`, messages from the server.
8. **No apostrophes inside single-quoted SPA strings** (`'can't'` is a white-screen SyntaxError). Use double quotes
   or a template literal for any text with a contraction ("Can't read", "haven't been sent", "isn't connected").
9. **No dark mode.** Never add `prefers-color-scheme: dark` rules.
10. **Run `node scripts/check-spa-syntax.js` after every edit to `public/index.html`**, not only at the end.
11. **Never change the fixtures**, `manifest.json` or `src/core/link-contract.ts` (no wire-shape change to any Zod
    schema). If a fixture looks wrong, **stop and report**; do not "fix" it. `link-contract.test.ts` checks the
    manifest hashes. For the smoke run, copy fixtures to the scratchpad and edit the copies.
12. **TDD.** Write the listed tests first, watch them fail for the right reason, then implement.
13. **Verify command** (every task, before handing back; all three must pass):
    ```
    npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js
    ```
    `account.service.test.ts` "applying Complex deactivates the pre-existing grade7g…" is a known flaky ~5 s
    timeout on the laptop; re-run once before reporting it.
14. **Stay inside your lane's files.** If you need a file another lane owns, stop and report.
15. **Never log** a `/sync` body, the `Authorization` header, or a leader note.
16. Out of scope: the More menu sheet itself (`openMore()`, its styling; we only add entries to `moreItems()`),
    login relabel, grade filter, Prayers off, Bus read-only routes (all the rework's), and the console (Project 11.1).
17. **Do not depend on the rework** (`feat/oct-rework`) for anything except Task R1. Lane B adds `modeAllows` if it is
    not in `access-control.ts`.

Model tags: **[Sonnet]** = mechanical, fully specified. **[Opus]** = judgement (sync token auth, RLS/migration,
outbox state machine, the batch route and dedupe, the phone queue, cancel/undo ownership, the action log).

---

## Lanes and file ownership

Order: **T → (A ∥ B) → (C ∥ D ∥ F1) → (E ∥ F2) → F3 → F4 → V/R/H**. `public/index.html` and
`src/tests/link.spa.test.ts` belong to one F lane at a time: F1, then F2, then F3, then F4, never two at once.

| Lane | Files (only these; "new" = created by this lane) |
|---|---|
| **T** types | `src/core/link-types.ts` (new), `src/core/errors/link-errors.ts` (new), `src/core/errors/app-error.ts`, `src/api/middleware/error.middleware.ts`, `src/tests/link-errors.test.ts` (new) |
| **A** data | `supabase/migrations/0017_elvanto_link.sql` (new, by `git mv`), `docs/superpowers/specs/2026-10-11-elvanto-link-0016.draft.sql` (pointer line), `src/core/schema-version.ts`, `src/tests/link-contract.test.ts` (draft-SQL block only), `src/tests/migration-numbers.test.ts` (new), `src/repositories/interfaces/link.repository.ts` (new), `src/repositories/in-memory/link.repository.ts` (new), `src/repositories/supabase/supabase.link.ts` (new), `src/repositories/interfaces/index.ts`, `src/repositories/in-memory/index.ts`, `src/repositories/supabase/index.ts`, `src/tests/helpers/link-repo-suite.ts` (new), `src/tests/link.repository.test.ts` (new), `src/tests/link.repository.supabase.test.ts` (new) |
| **B** rules | `src/services/link-rules.ts` (new), `src/services/access-control.ts`, `src/services/import.service.ts` (one `export` keyword), `src/config/env.ts`, `src/tests/link-rules.test.ts` (new), `src/tests/access-control.test.ts` |
| **C** sync | `src/services/sync.service.ts` (new), `src/tests/sync.service.test.ts` (new) |
| **D** link | `src/services/link.service.ts` (new), `src/tests/link.service.test.ts` (new) |
| **E** HTTP | `src/api/http/types.ts`, `src/api/http/express-adapter.ts`, `src/api/http/router.ts`, `src/api/controllers/link.controller.ts` (new), `src/api/controllers/sync.controller.ts` (new), `src/container.ts`, `src/services/setup.service.ts`, `vercel.json`, `public/sw.js`, `src/tests/link.routes.test.ts` (new), `src/tests/setup.service.test.ts`, `src/tests/express-adapter.sync.test.ts` (new) |
| **F1→F4** SPA | `public/index.html`, `src/tests/link.spa.test.ts` (new in F1) |
| **Orchestrator** | `docs/superpowers/elvanto-link-progress.md`, `CLAUDE.md`, this plan; Task R1 (merge) may touch any file, only to resolve conflicts |

**No file is in two lanes.** Check: every path above appears in exactly one row (the lane rows were built from spec
§12; the only additions are three new test files, `link-errors.test.ts` (T), `migration-numbers.test.ts` (A, already
named in spec §2.5) and `express-adapter.sync.test.ts` (E), which no other lane names). `access-control.ts` is B only;
`setup.service.ts` and `sw.js` are E only; `index.html` is F only. Lanes that run at the same time (A∥B, C∥D∥F1,
E∥F2) share no file. Imports across lanes are fine; edits are not.

Dependencies: A1–A3 and B1–B3 need T. **A4 needs B2** (`applyOutcome`). C needs A4 + B. D needs A4 + B. E needs C + D.
F1 needs only this spec's shapes (its tests are extract-and-run). F2–F4 need F1.

Waves: **0** = T1 · **1** = A1, A2, A3 ∥ B1, B2, B3, then A4 · **2** = C1, C2 ∥ D1–D6 ∥ F1.1–F1.3 · **3** = E1–E3 ∥ F2 ·
then F3, F4.1, F4.2 · **4** = V1, V2, R1, V3, V4, H1.

---

## Wave 0 — Lane T

### Task T1 [Sonnet] — Shared types and link errors
Verify: `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`
Files: `src/core/link-types.ts`, `src/core/errors/link-errors.ts`, `src/core/errors/app-error.ts`,
`src/api/middleware/error.middleware.ts`, `src/tests/link-errors.test.ts`.

Tests first (`link-errors.test.ts`):
- Each class has the spec §3 status, `code` and message: `LinkUnavailable` 409 `LINK_UNAVAILABLE` "Do this in
  Elvanto for now."; `LinkIdReused` 409 `LINK_ID_REUSED`; `LinkEditInElvanto` 409 `LINK_EDIT_IN_ELVANTO` + extra
  `reason`; `LinkOpenDuplicate` 409 `LINK_DUPLICATE` + extra `existingId`; `LinkTooLate` 409 `LINK_TOO_LATE`;
  `LinkNotYours` 403 `LINK_NOT_YOURS` "Only the leader who sent this can undo it."; `LinkOff` 503 `LINK_OFF`;
  `LinkContractMismatch` 409 `LINK_CONTRACT_MISMATCH` + extra `expected: 1`; `SyncValidation` 400 `VALIDATION_ERROR`.
- `sendError` with a fake `res`: a `LinkOpenDuplicate('x')` body is `{ code, message, existingId: 'x' }`; a plain
  `AppError` with no `extra` gives the same body as today (no new keys).
- `LinkContractMismatch` and `SyncValidation` bodies parse with `ErrorBody` from `link-contract.ts`.
- A compile-only block: `const t: ActionType = 'checkIn'`, `const c: Capabilities = {…all six…}`.

Change:
- `link-types.ts`: copy spec §3 **exactly** (every interface and type alias; `import type` only).
- `app-error.ts`: optional 4th constructor arg `extra?: Record<string, unknown>`, stored as a readonly field.
  No existing subclass changes.
- `error.middleware.ts`: `sendError` spreads `err.extra` into the JSON body after `code`/`message` (extra cannot
  overwrite `code` or `message`).

---

## Wave 1 — Lanes A and B (parallel; A4 waits for B2)

### Task A1 [Opus] — Migration 0017, pointer file, duplicate-number guard
Verify: `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`
Files: `supabase/migrations/0017_elvanto_link.sql`, the old draft path, `src/core/schema-version.ts`,
`src/tests/link-contract.test.ts`, `src/tests/migration-numbers.test.ts`.

Tests first:
- `migration-numbers.test.ts` (new): reads `supabase/migrations/`, groups file names by their 4-digit prefix, and
  fails naming both files when two share a prefix. Also a pure case on a literal list
  `['0016_a.sql', '0016_b.sql']` → reports `0016` (helper local to the test file).
- `link-contract.test.ts`, "draft SQL" block only: read `supabase/migrations/` and keep names matching
  `/^\d{4}_elvanto_link\.sql$/`; assert **exactly one** match; run the existing RLS-by-rule test on it (so it now
  also covers `link_log`); assert it contains `add column if not exists report_id uuid` and
  `create index if not exists link_log_at_idx`. Change nothing else in that file.
- The existing `schema-version.test.ts` ("equals the highest filename") must pass with `'0017'` (no edit).

Change:
- `git mv docs/superpowers/specs/2026-10-11-elvanto-link-0016.draft.sql supabase/migrations/0017_elvanto_link.sql`.
- Edit only the header comment (it now says it is migration `0017` of the Elvanto link, additive, rework owns
  `0016`). Append at the end, in this order: `alter table link_outbox add column if not exists report_id uuid;`,
  the `link_log` table and index exactly as spec §6.1, `alter table link_log enable row level security;`.
- Re-create the old draft path holding one line:
  `-- Moved to supabase/migrations/0017_elvanto_link.sql (2026-10-12).`
- `LATEST_MIGRATION = '0017'`.
- Byte check (judgement point): `git show 834b8fd:docs/superpowers/specs/2026-10-11-elvanto-link-0016.draft.sql`
  into the scratchpad, `diff` it with the new file: only the header lines and the appended tail may differ.
- Do not touch `src/migrate/runner.ts` (the rework's F3 adds the runner-level guard there).

### Task A2 [Opus] — `ILinkRepository`, shared suite, in-memory repo (everything except results)
Verify: `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`
Files: `src/repositories/interfaces/link.repository.ts`, `src/repositories/interfaces/index.ts`,
`src/repositories/in-memory/link.repository.ts`, `src/repositories/in-memory/index.ts`,
`src/tests/helpers/link-repo-suite.ts`, `src/tests/link.repository.test.ts`.

Tests first (`link-repo-suite.ts` exports `describeLinkRepo(name, make)`; `make()` returns
`{ repo, backdate(table: 'link_outbox' | 'link_roster' | 'link_log', id, column, iso), cleanup() }` so the
Supabase run can age rows with a real DB clock):
- `insertAction` returns the row (`pending`, `attempts 0`); a second open row with the same `dedupeKey` throws
  `LinkOpenDuplicate` whose `existingId` is the first row's id; after the first is `cancelled`, the key is free again.
- `listActions` filters (ids, createdBy, date range, types, statuses, personId, serviceTimeId, groupId); `note` is
  always `null` in its rows.
- `cancelPending` true only from `pending`; false from `claimed`/final.
- `claim`: upserts the console row (`listConsoles` shows it, `lastSeenAt` set); leases oldest first, at most `max`;
  sets `claimed`, owner, `leaseUntil`, `attempts + 1`; skips a type whose capability is `off`; `max: 0` leases
  nothing but still upserts and sweeps; a `pending` row with `retryAt` in the future is skipped; a `claimed` row with
  an ended lease is re-leased **only** by the same console (`reclaimed: true`).
- Sweep: `pending` created 3+ days ago → `refused`, `too-old`; `claimed` whose lease ended over `leaseLostMs` ago →
  `unclear`, `lease-lost`.
- Purge (spec §4.3): inactive roster rows 90+ days with `match` `none`/`ignored` deleted (an `auto` one kept);
  `note` nulled on final rows older than 30 days; `link_log` rows older than 400 days deleted.
- Note unreadable: `make` with an injected `decrypt` that throws → the leased row comes back `noteUnreadable: true`
  and is stored `refused`, `note-unreadable`; the other rows in the same claim are fine.
- `replaceMirror`: stale `takenAt` (≤ stored) → `{ applied: false }` and nothing changes; roster upserts by
  `personId`, never writes `studentId`/`match`, sets `active = false` (and `updatedAt`) for people missing from the
  push; the other three kinds replace fully; `mirrorState` shows each kind's `takenAt`, `consoleId`, `rowCount`.
- `setMatches` writes `studentId` + `match`; `addLog` / `listLog` (date range, userId, event, limit, newest first).
- `link.repository.test.ts` runs the suite on `InMemoryLinkRepository`.

Change:
- Interface exactly spec §4.1. `applyResults` is declared; in this task the memory repo's body throws
  `new Error('applyResults: Task A4')` and the suite has no results cases yet.
- `InMemoryLinkRepository` (constructor options `{ decrypt?: (note, id) => string; now?: () => Date }`; defaults
  identity and the real clock; `now` is the memory stand-in for the DB clock). Deep-clone on every read and write.
  Not saved to disk (used for `memory` and `json`).
- Export both from their `index.ts`.

### Task A3 [Opus] — `SupabaseLinkRepository` (RLS tables, one-transaction claim)
Verify: `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`
Files: `src/repositories/supabase/supabase.link.ts`, `src/repositories/supabase/index.ts`,
`src/tests/link.repository.supabase.test.ts`.

Tests first (`link.repository.supabase.test.ts`):
- **SQL-text block (always runs)**, reading `supabase.link.ts` as text: has `skip locked`; uses `now()` for every
  time compare; has `lease_owner =` in the reclaim and the result conditions; has
  `status in ('pending','claimed','unclear')` exactly as the `link_outbox_open_uq` index predicate in `0017`; uses
  `sql.json(`; contains no `::jsonb` and no `JSON.stringify(`; never `console.` / `logger.` a note.
- **DB block:** `describeLinkRepo('supabase', …)` **only when `LINK_TEST_DATABASE_URL` is set** (else
  `describe.skip`). `make()` connects, runs `0017` (idempotent), truncates the `link_*` tables, and `backdate` runs an
  `update … set <column> = $iso where id = $id` on the scratch DB. Never prod: refuse to run when the URL host
  matches the prod project ref in `CLAUDE.md` (`ltcblcudlzlzfcyzlhpc`).

Change:
- `claim` is **one** `sql.begin()`: console upsert (`last_seen_at = now()`), sweep, purge, then
  `select … for update skip locked` (oldest first, capability not `off`, `retry_at is null or retry_at <= now()`, or
  reclaim `lease_until < now() and lease_owner = $consoleId`), then update to `claimed`. Decrypt notes **row by
  row** with `maybeDecrypt(note, 'link_outbox.note:' + id)`; a throw sets that row `refused`, `note-unreadable`
  inside the same transaction.
- `insertAction` writes `note` with `maybeEncrypt(raw, 'link_outbox.note:' + id)`; catches `23505` on
  `link_outbox_open_uq`, reads the open row for that key, throws `LinkOpenDuplicate(existingId)`.
- `replaceMirror` is one transaction; bulk writes via `bulk.ts` `chunk()`; jsonb only via `sql.json(v)`.
- `listActions` never decrypts (note `null`). `applyResults` throws `'applyResults: Task A4'` for now.
- Export from `src/repositories/supabase/index.ts`.

### Task B1 [Sonnet] — Pure time, service and dedupe helpers
Verify: `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`
Files: `src/services/link-rules.ts`, `src/tests/link-rules.test.ts`.

Tests first: `brisbaneToday` at 13:59Z and 14:00Z (the day flips at 14:00Z; no DST); `addDays` across a month and a
year end; `weekdayOf('2026-10-16') === 5`; `brisbaneHHMM('2026-10-16T08:30:00Z') === '18:30'`; `pickList` keeps
`ymd` in today−7 … today, newest first, drops a future service; `defaultService`: Friday with one service → it;
Friday with two → none; Sunday with one 10:15 service (Brisbane) → it; Sunday with a 10:15 and a 17:00 → the 10:15;
a weekday → none; `lastMeetingDate('Tuesday', <a Friday>)` → that week's Tuesday, `('', today)` → today;
`dedupeKey` for all six types equals contract §5.1 (`first:` key lower case, inner spaces folded:
`first:<st>:alex  sample` → `first:<st>:alex sample`). Add `LINK_CUTOFF_DAYS = 3`, `LEASE_LOST_MS = 3_600_000`.

Change: the functions in spec §5.1, pure, no I/O, no `Date.now()` inside (the caller passes `now`).

### Task B2 [Opus] — Outbox state machine, auto-match, effective check state
Verify: `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`
Files: `src/services/link-rules.ts`, `src/tests/link-rules.test.ts`.

Tests first:
- `applyOutcome(row, item, consoleId, now)`: one case per row of contract §3.3 / §5.3. `sent` stores `sentLogKey`,
  `reportId`, `personId`, `resultAt`; `already` → `sent` + `reason 'already'`; `refused` / `unclear` / `shadowed`
  store `reason`/`detail`; `retry` → `pending`, `retryAt = now + retrySeconds`, `leaseOwner`/`leaseUntil` null;
  `resolved` from `unclear` by **any** console; a claimed row counts while `leaseOwner === consoleId`, lease expired
  or not; another console on a claimed row → `{ ignored: 'not-leased' }`; same outcome on a final row →
  `already-final`; a different outcome on a final row → `bad-transition`; `null` row → `unknown-id`.
- `autoMatch(roster, students)`: dead `studentId` reset to `none`; name key + equal gender, one student → `auto`;
  two students, or two roster rows with the same key → `ambiguous`; none stays `none`; `manual`, `auto`, `ignored`
  rows never change.
- `effectiveCheckState`: mirror only; newest row `pending`/`claimed`/`unclear` decides; `shadowed` decides with
  `practice: true`; `sent` decides only while `resultAt > mirrorTakenAt`; `cancelled`/`refused` ignored. Both
  orders: sent check-in then a kiosk check-out (newer mirror says out → out); sent check-out then a kiosk check-in
  (newer mirror says in → in).

Change: spec §5.2, pure.

### Task B3 [Sonnet] — RBAC, `parseGroupName` export, `LINK_SYNC_TOKEN`
Verify: `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`
Files: `src/services/access-control.ts`, `src/tests/access-control.test.ts`, `src/services/import.service.ts`,
`src/config/env.ts`.

Tests first (`access-control.test.ts`): `link:use` true for all five roles; `link:admin` for director and admin
only; `modeAllows` table (on → all; shadow → admin only; off → none) **only if this task adds it**; `canUseLink`
for 5 roles × 3 modes × 2 actions (shadow + director + `link:admin` → false).

Change:
- Add the two actions to the role table. If `modeAllows` is absent, add it with the body in spec §2.1
  (`mode === 'on' || (mode === 'shadow' && actor.role === 'admin')`); leave `canUseNewYouth` as it is.
  Add `canUseLink(actor, mode, action)`.
- `import.service.ts`: add `export` to `parseGroupName`. Nothing else.
- `env.ts`: `export function readLinkSyncToken(e = process.env): string | undefined` (trimmed; under 32 characters
  → `undefined`), and `LINK_SYNC_TOKEN: readLinkSyncToken()` in `env`. Callers that must see test changes (the
  adapter, setup) call the function per request.

### Task A4 [Opus] — `applyResults` in both repos (after B2 is committed)
Verify: `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`
Files: `src/repositories/in-memory/link.repository.ts`, `src/repositories/supabase/supabase.link.ts`,
`src/tests/helpers/link-repo-suite.ts`.

Tests first (suite): replay `src/tests/fixtures/elvanto-link/result-request.json` against rows inserted with the
fixture ids and leased to the fixture `consoleId` → the reply parses with `ResultResponse`; each row's status
follows §3.3; `retry` clears the lease and sets `retryAt`; a result for a row leased by another console is
`ignored: not-leased`; an unknown id is `unknown-id`; a repeat of the same results is all `already-final` with no
change; `resolved` on an `unclear` row from a second console works.

Change: per item, read the row (Supabase: `select … for update` inside one `sql.begin()`), call `applyOutcome`,
write with a guarded `update … where id = $1 and status = $old` (plus `and lease_owner = $consoleId` for a claimed
row). A guarded update that hits 0 rows → `ignored` with the matching reason. `report_id` is written on `sent`.
SQL-text test from A3 stays green.

---

## Wave 2 — Lanes C, D and F1 (parallel)

### Task C1 [Opus] — `sync.service`: version gate, claim, result
Verify: `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`
Files: `src/services/sync.service.ts`, `src/tests/sync.service.test.ts`.

Tests first (memory repo, fixtures read with `readFileSync`, never edited):
- Version: `contractVersion: 2` → `LinkContractMismatch` with `expected: 1`; missing or a string → `SyncValidation`;
  a Zod failure → `SyncValidation`; nothing applied in any of these.
- Claim: insert one row per type (payloads built from the push fixtures, a note on the three note types), then
  `claim(claim-request.json)` → reply parses with `ClaimResponse`; each `payload` parses with
  `PAYLOAD_SCHEMAS[type]`; `note` is the **raw** note (no "Self identified leader" prefix: decision 17);
  `by.login` is the creator's `users.email`; `by.leaderName` is the snapshot.
- Mode `off` → nothing leased, but the console row is upserted (heartbeat) and the sweep ran.
- An unreadable note (memory repo with a throwing `decrypt`) → that row is left out of `rows` and is `refused`.
- Result: `result(result-request.json)` after leasing the fixture ids → parses with `ResultResponse`.
- No logging: spy on `console.*` and `src/utils/logger.ts`; a claim with a note never logs the note or the body.

Change: `makeSyncService({ link, settings, students, users })` per spec §8.1. Read `contractVersion` from the raw
body before Zod. `cutoffDays: LINK_CUTOFF_DAYS`, `leaseLostMs: LEASE_LOST_MS`; mode from settings
(`modules.newYouthForms`); `off` → `max: 0`.

### Task C2 [Sonnet] — `sync.service`: pushes
Verify: `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`
Files: `src/services/sync.service.ts`, `src/tests/sync.service.test.ts`.

Tests first: each `push-*.json` fixture → applied, `rows` = row count; the reply parses with `PushResponse`; a
second push with the same `takenAt` → `{ applied: false }`; groups get `grade`/`gender` from `parseGroupName`
(e.g. a "Year 9 Girls" style name → 9/female; an unparsable name → null/null); roster → after an applied push
`autoMatch` runs against `students.findAll()` and the reply has `matched: { auto, ambiguous }`; an unknown `:kind`
→ `SyncValidation`.

Change: `push(kind, body)` per spec §8.1.

### Task D1 [Sonnet] — `link.service`: skeleton, the switch, status, check-in read
Verify: `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`
Files: `src/services/link.service.ts`, `src/tests/link.service.test.ts`.

Tests first:
- The switch, for **every** public method (incl. the admin ones): off → 404 `MODULE_DISABLED` for all roles incl.
  admin; shadow → admin allowed, director and others 404; on → by RBAC (`link:admin` methods 403 for quad/grade/leader).
- `status`: online = seen within `2 × pollSeconds + 60 s`; capabilities from the newest console; `consoles` counts
  those seen in the last 10 min; mirror ages from `mirrorState`; no console yet → `online: false`, capabilities null.
- `checkin(actor)` → `{ today, services, defaultServiceTimeId }`; `checkin(actor, st)` adds `people`: active
  `student` + `leader` roster rows, both genders, sorted last then first name; each row's keys are exactly
  `personId, name, grade, leader, checkedIn, practice, action, mine` (assert there is **no** `gender`, phone or
  `studentId` key); `action` = the newest row for that person and service by any login; `mine` =
  `createdBy === actor.id`; `checkedIn`/`practice` from `effectiveCheckState`.

Change: `makeLinkService({ link, settings, students, leaders, users, serviceSessions, serviceAttendance, limiter,
now? })` (`now` defaults to `() => new Date()`; tests pass a fixed clock). Every method starts with
`canUseLink(actor, mode, action)` → `ModuleDisabledError` when false (404 for both mode and RBAC misses on `link:use`;
RBAC miss on `link:admin` under On → `ForbiddenError`). All reads in one `Promise.all`.

### Task D2 [Opus] — Enqueue and dedupe
Verify: `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`
Files: `src/services/link.service.ts`, `src/tests/link.service.test.ts`.

Tests first, one per outcome in spec §8.2 step order: `refused:RATE_LIMITED` on the 301st item in 10 min
(fake limiter); `replay` (same id, same type + payload, returns the row); `LINK_ID_REUSED` (same id, other body);
`LINK_UNAVAILABLE` (newest console says `off` for that type; no console yet → allowed); type checks per contract §5.1
(service not in pick list, person inactive, report date > today or < today−14, attendees not members,
`didNotMeet` with attendees, `serviceTimeId` not in `link_services`, names over 60 characters); note on a non-note
type → 400; note over 1,800 → 400 (1,800 ok); "I am" required for `submitReport`/`editReport`/`completeStep`
(missing or unknown `leaderId` → 400 "Pick who you are first."); a junior `leader` login always gets its bound
`leaderId`; `leader_name` fallback to the login's `displayName` for the other types; same-action dedupe: a second
`checkIn` for the same person and service from another login → `duplicate` + `existingId` (one row in the outbox);
`checkOut` after a `pending` and after a `shadowed` check-in → `saved`; `checkOut` with no effective check-in →
400; report duplicate by key → `duplicate` + `existingId`; `saved` fills `student_id` from the roster match and
`service_date` per contract §5.1. `editReport`: not the group's last report → 400; `editable: false` →
`LINK_EDIT_IN_ELVANTO` + `reason`; `base` differs → 400; `date !== base.date` → 400; the overlay (`report_id` of the
newest `sent` submit) counts as the last report.

Change: `enqueue(actor, item, device)` returns `{ outcome, action?, existingId?, code?, message? }` and never
throws for an item-level refusal (the single route maps the result to the contract §4.1 status codes). One path for
`POST /link/actions` and batch `action` items.

### Task D3 [Opus] — Cancel, undo, `listActions` (ownership)
Verify: `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`
Files: `src/services/link.service.ts`, `src/tests/link.service.test.ts`.

Tests first: cancel by the same login and the same "I am" → `cancelled`; same login, other "I am" →
`LINK_NOT_YOURS`; other login → `LINK_NOT_YOURS`; `null`/`null` "I am" counts as the same; director/admin (On) can
cancel anyone's; not `pending` → `too-late`; undo of a `pending` check-in → `cancelled`; undo of a `sent` check-in →
a new `checkOut` with `newId` (`saved`, `action` = the new row); undo of a non-check-in → 400; `listActions`: a
non-admin sees only rows they created; `detail` only for `link:admin`; shape per contract §4 (`hasNote` = raw note not
null; `login` = creator's `users.email`).

Change: `cancel(actor, id, leaderId, device)`, `undo(actor, id, leaderId, newId, device)`, `listActions(actor, q)`
per spec §8.2.

### Task D4 [Opus] — `/link/batch` processing and the action log
Verify: `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`
Files: `src/services/link.service.ts`, `src/tests/link.service.test.ts`.

Tests first:
- Envelope: 0 items or 51 items → 400 `VALIDATION_ERROR`; a bad item shape → 400 for the whole call; switch hides it
  → 404.
- A mixed batch (action, duplicate action, cancel, undo, identity, a refused action) → one result per item, same
  order, each per spec §9.1; one failing item does not stop the next.
- A non-`AppError` from the repo on item 3 → the whole call fails 503 (reuse the 503 path the route timeout uses;
  check `src/utils/timeout.ts` / `express-adapter.ts`), so the phone retries the batch; replaying the same batch
  then gives `replay` for items 1–2.
- Log: exactly one `addLog` call per batch, one row per item: action → `saved`/`replay`/`duplicate`/`refused:<CODE>`;
  cancel → `cancelled`/`too-late`/`refused:LINK_NOT_YOURS`; undo; identity → `logged` with
  `prevLeaderId/Name` = `from`, `leaderId/Name` = `to`; `login` = `users.email` snapshot; device from the envelope;
  `target_kind/id/name` (person, group, flowRow, action); **no** note text, phone or address in any row.
- The single routes' service calls (`enqueue`, `cancel`) write one log row each, with the device from headers.

Change: `batch(actor, body)` per spec §9.1 and §6.2. Items run in order, each in its own try/catch.

### Task D5 [Sonnet] — Lifegroups and flows reads
Verify: `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`
Files: `src/services/link.service.ts`, `src/tests/link.service.test.ts`.

Tests first: `lifegroups`: a grade login sees only its grade+gender groups; quad its bracket+gender; an ungraded
group only for director/admin; a junior `leader` sees none; `lastReport` never carries notes; the overlay (newest
`sent` submit with `report_id` and `resultAt` later than the groups mirror's `takenAt` → `lastReport`, `editable:
true`, `blocked: null`); `defaultDate` = `lastMeetingDate(meets, today)`; `openAction` = the open row for that group.
`flows`: scope by the roster grade/gender of `personId` (`canAccessStudent`); unknown person → director/admin only;
order by flow, then step order; `openAction` per row.

Change: per spec §8.2.

### Task D6 [Sonnet] — Admin: matching, shadow check, log read
Verify: `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`
Files: `src/services/link.service.ts`, `src/tests/link.service.test.ts`.

Tests first: `rosterForMatching({ match })` returns rows + candidates (same name key or same last name; name, grade,
gender, DOB); `setMatch` → `manual` / `none` / `ignored` (`ignore: true`); a student already matched to another
person → 409. `shadowCheck(date)`: no `service_sessions` row for the date → one line "Not in the import"; else
verdicts `matched`, `sent-not-imported`, `practice-matched`, `practice-missing`, `no-student` for `checkIn` rows
`sent`/`shadowed`, plus the count of imported attenders with no link row. `log(q)`: newest first, max 2,000, filters
`from`/`to`/`login`/`event`. All three are `link:admin` (403 for others under On).

Change: per spec §8.2 and §6.3.

### Task F1.1 [Sonnet] — SPA shared parts: switch, entries, relabel, status lines, banner
Verify: `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`
Files: `public/index.html`, `src/tests/link.spa.test.ts`.

Tests first (`link.spa.test.ts`, extract-and-run with `src/tests/helpers/extract-fn.ts`): `_linkOn` per mode × role
(same rule as `_nyOn`); `moreItems()` per role and mode (Check-in for all; Lifegroup report and Flow steps not for a
junior `leader`; Elvanto link for admin/director only; none when off); `_lkStatusText` for every status and reason
in contract §5.3/§5.4 **word for word**, plus "Waiting to send." (queued on the phone) and "In Elvanto."
(mirror-only); `_lkBanner` lines (offline with the last-seen time, practice mode, check-out locked, `off` hides,
"2 consoles are running" for admin only).

Change: one block `/* ── LINK MODULE ── */`, CSS `/* LINK CSS */`, state object `LINK`, helpers `_lk*`. Pages
`link-checkin`, `link-groups`, `link-flows`, `link-admin` are sub-pages (back arrow). Youth Setup: label
**"Elvanto features"** and the help text from spec §2.1 exactly (key and options unchanged). `GET /link/status`
every 60 s only while a link page is visible (stop on `visibilitychange` hidden). Only add `moreItems()` entries.

### Task F1.2 [Opus] — The phone queue, flush, pill, identity and logout guard
Verify: `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`
Files: `public/index.html`, `src/tests/link.spa.test.ts`.

Tests first (localStorage and `fetch` stubs): an item survives a simulated reload (re-extract the functions, same
storage); `crypto.randomUUID()` ids; tapping again while queued removes the item locally (nothing sent); flush sends
at most 50 per POST, one flush at a time; `saved`/`replay` take the server status; `duplicate` adopts `existingId`;
`RATE_LIMITED` stays queued and toasts "Too many taps. Wait a minute."; a final `refused` shows the reason; a network
error backs off 5 s, 15 s, 45 s, then 60 s and the pill turns red after the 45 s step fails; `setMyLeaderId` queues an
`identity` item `{ from, to, at }` only when the value changes **and** `_linkOn()`; `doLogout` with unsent items
asks first, flushes (10 s), offers "Log out anyway (they'll be lost)" on failure, then clears the queue and `LINK`;
`_lkMerge(serverPeople, queue)`: server rows win except items still queued.

Change: spec §9.2. Key `localStorage['ysc.lkq.' + S.user.id]` in try/catch. Triggers: 300 ms after a tap, `online`,
`visibilitychange` visible, every later tap, every 15 s while items remain. 20 s client timeout. No SW Background
Sync. After send, undo → `undo` item (check-ins) or `cancel` (reports, steps); `too-late` → "Already sent. Do it in
Elvanto."; `LINK_NOT_YOURS` → its message. Device = `yap_device_id` + `_deviceLabel()`.

### Task F1.3 [Sonnet] — The door screen
Verify: `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`
Files: `public/index.html`, `src/tests/link.spa.test.ts`.

Tests first: door row markup has no gender word, no gender class and no gender colour; a leader row shows the
"Leader" chip, a student row its grade chip (neutral `--chip`); search matches words in any order; the grade select
(All, 7–12, Leaders) filters; summary "In N · Still to come M"; a row whose newest action is mine shows **Undo**;
practice rows show the practice line; every name passes through `esc()` (a name with `<b>` renders as text).

Change: mockup frames 1 and 2, spec §11.1 items 1–8. `LINK.people[serviceTimeId]` in memory only (never
localStorage), loaded once per service from `GET /link/checkin`, revalidated every 60 s and its own open rows every
15 s while visible. No default service → the "Pick a service" sheet first. Re-render keeps the scroll position.

---

## Wave 3 — Lane E and F2 (parallel)

### Task E1 [Opus] — Sync token auth in the adapter
Verify: `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`
Files: `src/api/http/types.ts`, `src/api/http/express-adapter.ts`, `src/tests/express-adapter.sync.test.ts`.

Tests first (a tiny route table with one `sync: true` stub route and one session route, `listen(0)` + `fetch`):
token unset → 503 `LINK_OFF`; token of 31 characters → 503; correct header → handler runs with `ctx === null`;
wrong token, lower-cased token, `bearer <token>` (lower-case scheme), extra spaces, no header → 401 `UNAUTHORIZED`
JSON; a sync route never calls `resolveContext` and is not blocked by must-change-password; the 20 s guard still
applies; a spy on `console.*`/logger sees neither the header nor the body; `req.headers` gives `x-device-id` and
`x-device-label` to session routes.

Change: `Route.sync?: true`; `HttpRequest.headers?: { deviceId?: string; deviceLabel?: string }`. For a sync route:
`readLinkSyncToken()` per request (unset → `LinkOff`); require the header to be exactly `Bearer <token>`; compare
`timingSafeEqual(sha256(bearer), sha256(token))` on the raw strings (do not reuse `codeMatches`). No new log line.

### Task E2 [Sonnet] — Controllers, router, container, route checklist
Verify: `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`
Files: `src/api/controllers/link.controller.ts`, `src/api/controllers/sync.controller.ts`, `src/api/http/router.ts`,
`src/container.ts`, `vercel.json`, `public/sw.js`, `src/tests/link.routes.test.ts`.

Tests first (`link.routes.test.ts`, like `bus.routes.test.ts` + `setup.routes.test.ts`): every `/link/*` route is
`auth: true`; every `/sync/*` route is `sync: true` and `auth: false`; the route list equals spec §10.1's table;
`vercel.json` `routes[0].src` matches `/link/status` and `/sync/claim`; `sw.js` `API_RE` matches `/link/x` and
`/sync/x`. Live block (`createApp(...).listen(0)`, memory, `process.env.LINK_SYNC_TOKEN` set for the block):
`claim-request.json` with the right token → 200 and parses with `ClaimResponse`; `/link/status` with no session →
401 JSON; `/link/batch` as admin in Shadow with a mixed batch → 200, one result per item; `POST /link/actions` maps
`saved` → 201, `replay` → 200, `duplicate` → 409 `LINK_DUPLICATE` + `existingId`.

Change: thin controllers (no logic); router entries per spec §10.1; `container.ts` builds the link repo (Supabase
or memory), wraps mirror reads with `dedupeReads(link, 'link', ['roster', 'services', 'groups', 'flows',
'mirrorState', 'listConsoles'])`, builds both services and `new RateLimiter(300, 10 min)`; `vercel.json` regex gains
`link|sync`; `sw.js` `API_RE` gains `link|sync` and `CACHE` goes `ysc-v89` → `ysc-v90` (the one bump on this branch;
R1 re-bumps). `/sync/*` routes stay timed (20 s).

### Task E3 [Sonnet] — Setup checklist row
Verify: `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`
Files: `src/services/setup.service.ts`, `src/tests/setup.service.test.ts`.

Tests first: the `link` row, state `optional`, label "Elvanto link token: set" / "Elvanto link token: not set" /
"Elvanto link token: too short (32+ characters)"; the value never appears in the result (assert the JSON has no
token substring).

Change: one row built from the env passed to the service (raw length check for "too short").

### Task F2 [Sonnet] — Lifegroup report screens
Verify: `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`
Files: `public/index.html`, `src/tests/link.spa.test.ts`.

Tests first: the group list chip per `thisWeek` (Reported / Did not meet / No report / Later / "Can't read" in
double quotes); the Last report card never shows notes; Edit shown only when `editable`, else "Edit this report in
Elvanto."; "Group did not meet" clears and hides ticks and service; a date equal to the last report's date shows
"There's already a report for that date. Edit it." and queues nothing; the note counter stops at 1,800; no "I am" →
the picker opens first; the item goes into the shared queue as `submitReport`/`editReport` with the raw note (no
prefix); the line "Elvanto will show: Self identified leader: <name>" is escaped.

Change: spec §11.2 and §2.3 (service default, pick list, "No service", the older-than-7-days line).

---

## After wave 3 — F3, then F4

### Task F3 [Sonnet] — Flow steps
Verify: `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`
Files: `public/index.html`, `src/tests/link.spa.test.ts`.

Tests first: rows grouped by flow then step; a past `due` is red; a row with an open action cannot be completed;
the sheet needs "I am"; note max 1,800; "Keep note private" maps to `notePrivate`; the "Completing may send this
step's message." line (double-quoted string); queued as `completeStep`.

Change: spec §11.3.

### Task F4.1 [Sonnet] — First-timer tick on the New person form
Verify: `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`
Files: `public/index.html`, `src/tests/link.spa.test.ts`.

Tests first (a pure helper `_lkFirstTimerDecision(result, capability, names)`): queued when the student form is not
`failed` and it was a live send; queued on a dry run only when the `firstTimerCheckIn` capability is not `live`;
skipped (with the result-page note) when a name is over 60 characters; grade `'7'`…`'12'` → number, gender `f`/`m`
→ `female`/`male`; tick on by default only when §2.3 gives a default, else a service select; nothing shown when
`_linkOn()` is false.

Change: spec §11.4 first bullet. Hook after the existing send in `nySend`; do not change the New person send
itself.

### Task F4.2 [Sonnet] — Elvanto link admin page and activity export
Verify: `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`
Files: `public/index.html`, `src/tests/link.spa.test.ts`.

Tests first: four cards render (Status, Matching, Shadow check, Activity); an identity log row reads
"Cody → Sam (iPhone · Safari)" style with all three values escaped; the export file name is
`elvanto-activity-YYYY-MM-DD.xlsx`; the Shadow check date defaults to the last Friday; the page is not reachable
for quad/grade/leader.

Change: spec §11.4 second bullet and §6.3. Export with `_ensureXlsx()` (vendored SheetJS), one sheet, same columns
as the list.

---

## Wave 4 — Orchestrator

### Task V1 [Opus] — End-to-end smoke, no prod
Verify: steps 3–10 pass, then `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`
No file changes (outputs go to the scratchpad; results to the ledger in V4). **Do not edit any file under `src/`
while the server runs**: `npm run dev` is `tsx watch`, and a restart wipes the memory outbox.

1. Make a token: `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"` (32 chars). Keep it
   in a shell variable only.
2. Start (Bash, `run_in_background`):
   `PERSISTENCE=memory LINK_SYNC_TOKEN=$LT PORT=4300 npm run dev`. (PowerShell equivalent:
   `$env:PERSISTENCE='memory'; $env:LINK_SYNC_TOKEN='…'; $env:PORT='4300'; npm run dev`.)
3. Unauthenticated: `curl -s localhost:4300/link/status` and `curl -s -X POST localhost:4300/sync/claim` → JSON 401.
   A lower-cased token → 401. `-H "Authorization: Bearer $LT" -d '{"contractVersion":2,…}'` → 409 `expected: 1`;
   no version → 400.
4. Log in: `POST /auth/login` `{"email":"admin","password":"demo1234"}` → session token `$ST`. `GET /link/status` →
   404 `MODULE_DISABLED` (Off). `PATCH /settings` `{"ministryConfig":{"modules":{"newYouthForms":"shadow"}}}` →
   `GET /link/status` 200. Log in as `director` → `/link/status` 404 in Shadow.
5. Scratch copies: a small node script copies the four `push-*.json` and `result-request.json` into
   `<scratchpad>/link-smoke/`, sets the first service's `ymd` to today (Brisbane) and `startsAt` to today 18:30
   Brisbane, and `takenAt` to now. **Never write under `src/tests/fixtures/`**; afterwards
   `git status --porcelain src/tests/fixtures` must be empty.
6. Push all four kinds with the token → `applied: true`, roster reply has `matched`; push roster again →
   `applied: false`. `GET /link/admin/roster?match=none` lists the people (seed students are fake: unmatched is
   expected).
7. `POST /link/batch` (session, device `{ id: "smoke", label: "curl" }`) with the six types using the fixture ids
   `0a000000-…-000000000001` … `…006` and payloads from the scratch mirrors, a `leaderId` from `GET /leaders`, a
   second `checkIn` for the same person with a new id (→ `duplicate` + `existingId`) and an `identity` item → one
   result per item. Re-POST the same batch → `replay`.
8. `POST /sync/claim` with `claim-request.json` (as is) → rows for the leased ids; notes raw; `by.leaderName` set.
   Then `POST /sync/result` with the scratch `result-request.json` → reply parses; `GET /link/actions?ids=…` shows
   §3.3 statuses; any `ignored` item is explained (e.g. a type not leased).
9. `GET /link/admin/log` shows one row per batch item and the identity row (no note text).
   `GET /link/admin/shadow-check?date=<today>` → "Not in the import" (the memory seed has no session today).
10. Off is the stop button: queue one `checkIn` (new person), switch Off, `POST /sync/claim` → `rows: []`; switch
    back to Shadow → it leases.
11. Optional, PC only: point the console at `http://localhost:4300` with the same token (all types `shadow`) and
    run spec §13 steps 3–4 (incl. the Wi-Fi-off pill test on a phone).
12. Stop the server. Write the pass/fail per step (no tokens, no ids from real data) for V4.

### Task V2 [Opus] — Supabase repo suite on a scratch database (conditional)
Verify: the Supabase suite passes (or is recorded as not run), then `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`
Run `LINK_TEST_DATABASE_URL=<url> npx vitest run src/tests/link.repository.supabase.test.ts` **only if the operator
gives a scratch database URL** (a throwaway Supabase branch or local Postgres they created). Never create one with the
Supabase MCP. Never prod (the test refuses the prod ref). If no URL is given, record "Supabase suite: not run, needs
a scratch DB" in the ledger and in the handoff, and continue.

### Task R1 [Opus] — Merge the October rework (after it lands)
Verify: `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`
Gate: `feat/oct-rework` is finished (its V1 passed and its commits are final), or already merged into `master`.
If it has not landed when everything else is done, stop after V3, do V4/H1 with "R1 pending" in the handoff, and
run R1 + V3 + H1 again later.

1. `git merge --no-ff feat/oct-rework` (or `master` if the rework is already in it). Merge, do not rebase: the
   branch already has a merge commit and reviewed commits.
2. Resolve conflicts:
   - Migrations: keep both `0016_leader_view_grades.sql` and `0017_elvanto_link.sql`.
     `ls supabase/migrations | cut -c1-4 | sort | uniq -d` prints nothing. `LATEST_MIGRATION = '0017'`.
   - **Only one duplicate-number guard test survives.** The rework adds "migration versions are unique" in
     `src/tests/schema-version.test.ts` (plus a runner check in `src/migrate/runner.ts`, which stays). If that test is
     present, `git rm src/tests/migration-numbers.test.ts`. Then
     `grep -rln "versions are unique\|share a .*prefix\|uniq" src/tests` lists one guard test file only.
   - `src/services/access-control.ts` + its test: keep the rework's `modeAllows` (and its tests); delete the copy B3
     added, if any; keep `link:use`, `link:admin`, `canUseLink`.
   - `public/sw.js`: keep `API_RE` with `link|sync` and every rework prefix; `CACHE` = one above the higher of the two
     branches' values (e.g. both `ysc-v90` → `ysc-v91`).
   - `public/index.html`: keep both. Our `moreItems()` entries, the "Elvanto features" label and the link block sit
     beside the rework's `_navSlots`, Simple-logins toggle and Prayers gating. If the rework gates `moreItems()`
     (Prayers off), the link entries still depend only on `_linkOn()`. Run `node scripts/check-spa-syntax.js`.
   - `src/services/setup.service.ts`, `CLAUDE.md`, the ledger: keep both sides' rows and sections.
3. Run the verify command; `npx vitest run src/tests/link src/tests/schema-version.test.ts src/tests/migrate-runner.test.ts`
   once more on its own. Commit the merge with an explicit file list.

### Task V3 [Opus] — Final verification
Verify: `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`
1. The verify command passes; record the test count.
2. Frozen files: `git diff --stat 834b8fd -- src/tests/fixtures/elvanto-link src/core/link-contract.ts` is empty, and
   the manifest test passes.
3. Route checklist: `grep -n "link|sync\|sync|link" vercel.json public/sw.js`; `/link` and `/sync` in `router.ts`;
   `CACHE` bumped vs `master`.
4. Migrations: one `*_elvanto_link.sql`; no duplicate prefix; `LATEST_MIGRATION === '0017'`.
5. SPA: `grep -n "prefers-color-scheme" public/index.html` adds nothing; every new `innerHTML` interpolation in the
   LINK block goes through `esc()` (read the block once); no `'…'t …'` contraction in single quotes (grep
   `'[^'\n]*[a-z]'(t|s|re|ve|ll|d) ` in the block).
6. No secrets or real data: `git diff master... | grep -i "bearer [A-Za-z0-9_-]\{20,\}\|ltcblcudlzlzfcyzlhpc.*password"`
   finds nothing new; no real names in tests.
7. Logs: `grep -n "console\.\|logger\." src/services/sync.service.ts src/api/controllers/sync.controller.ts` shows no
   body/header logging.
8. If R1 ran: re-run V1 steps 3, 4 and 7 against the merged branch.
9. `/code-review` (high) on `git diff master...` and fix real findings in the owning lane's files.

### Task V4 [Sonnet] — CLAUDE.md "Resume here" and the ledger
Verify: `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`
Files: `CLAUDE.md`, `docs/superpowers/elvanto-link-progress.md` (orchestrator commits).
- Add a section **"Elvanto link (app side) (2026-10-12)"** after "New youth forms", starting with **"▶ Resume here
  (state as of <date>)"**: branch + commit; what is built; migration `0017` (rework owns `0016`); routes `/link/*`,
  `/sync/*` (checklist done, `CACHE` value); the one switch (`newYouthForms`: Off hides everything and stops claims;
  Shadow = admin only); `LINK_SYNC_TOKEN` (32+ chars, Production only, operator sets it); V1 results; V2 run or not;
  R1 done or pending; the operator steps below; the console-side wording change (spec §14); deviations (spec §14);
  test count. Then a short reference: files per layer, the queue key `ysc.lkq.<userId>`, `link_log` retention 400
  days, "never log `/sync` bodies".
- Ledger: add a "Build" entry per wave (commits), V1/V2/R1 results, and the handoff commit.

### Task H1 [Sonnet] — Handoff bundle for the PC
Verify: `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js` on the commit you bundle, then `git bundle verify`
1. Write into the ledger: branch `feat/elvanto-link-app`, bundle path, whether R1 is in it, and the PC commands
   below. The orchestrator commits the ledger (explicit path).
2. `git status --porcelain` is clean for tracked files; `git rev-parse HEAD` → the commit `<H>`.
3. `git bundle create "C:\Users\thoma\OneDrive\ys-link-app.bundle" feat/elvanto-link-app`, then
   `git bundle verify "C:\Users\thoma\OneDrive\ys-link-app.bundle"`.
4. Write `C:\Users\thoma\OneDrive\ys-link-app.txt` (outside the repo, so `<H>` stays true) with exactly:
   branch `feat/elvanto-link-app`, commit `<H>`, "R1 (rework merged): yes/no", "V2 (Supabase suite): run/not run",
   and the PC commands:
   `git fetch "<OneDrive>\ys-link-app.bundle" feat/elvanto-link-app:feat/elvanto-link-app`, then
   `git rev-parse feat/elvanto-link-app` must equal `<H>`.
5. Report branch, commit and bundle path to the operator. No push.

---

## Operator steps (in this order, after H1)

1. **Set `LINK_SYNC_TOKEN`**: 32+ random characters, Vercel **Production** only. Put the same value in the
   console's Credential Manager entry.
2. **Push and promote after the rework.** The rework (`0016`) goes to `master` and is promoted first. Then merge this
   branch (with R1 in it) to `master` and push. A push to `master` migrates prod at build time (additive, safe).
   Read the build log line **`Database up to date — …`** and check it names `0017`, then promote in the Vercel
   dashboard.
3. **Check the routes:** `curl -s https://ys-connection.vercel.app/link/status` and
   `curl -s -X POST https://ys-connection.vercel.app/sync/claim` must each return a **JSON 401** (not HTML, not 503
   `LINK_OFF`). Admin → System check shows "Elvanto link token: set". Tell the console orchestrator the spec §14
   wording change ("Self identified leader: …").
4. **Shadow Friday:** Youth Setup → Elvanto features → Shadow; the console pushes the roster; the admin matches people
   on the Elvanto link page. With all console types `shadow`, the admin checks people in and out at the door next to
   the kiosk, adds a first-timer, submits a report and ticks a step. After the **21:00 export/import**, run Shadow
   check for that Friday (expect `practice-matched`) and read the Activity log. Go live one type at a time on the
   console (reports, flows, then check-in) while the app is still in Shadow.
5. **Switch On.** Every login sees the screens. Watch the first live Friday's `unclear`/`refused` rows. Stop button:
   switch Off (screens gone, nothing claimed; queued rows wait or expire after 3 days).

---

## Task list (32)

T1 · A1 · A2 · A3 · B1 · B2 · B3 · A4 · C1 · C2 · D1 · D2 · D3 · D4 · D5 · D6 · F1.1 · F1.2 · F1.3 · E1 · E2 · E3 ·
F2 · F3 · F4.1 · F4.2 · V1 · V2 · R1 · V3 · V4 · H1
