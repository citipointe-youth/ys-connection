# Oversight role + ID Checks: design

Date: 2026-10-30. Branch `feature/oversight-id-checks`, based on live `eb41ada` (ysc-v160, `LINK_REV` 21, latest migration `0051`).
Status: design approved by the operator (decisions A-M below; I-M are rulings of 2026-10-30). Next step: an implementation plan (superpowers:writing-plans).

Labels used below: **Operator's decision** (fixed, do not re-open), **Orchestrator's call** and **Builder's call**
(defaults chosen so the builder can plan without asking; change one only with a stated reason in the plan).

---

## 1. Intent (why)

The four quad overseers (Junior/Senior Girls/Guys) and the youth pastor hold regular one-on-one catch-ups with leaders,
using the church's "Effective ID Checks" PDF (Faith, Form, Family/Friends, Finances, Fruit, General). Today the notes live
in heads, phones and paper, so:

- nobody can see when a leader was last checked, or who is overdue;
- a follow-up by a second overseer (or the pastor) starts from nothing;
- what a leader said last time ("saving for a car", "struggling with a friendship") is lost before the next catch-up.

The app already has a ministry-wide role (`director`) and an optional-module pattern (Notices). This work renames that
role to **Oversight**, gives each overseer their own login, and adds an optional **ID Checks** module: a private,
per-leader record of catch-ups, shared only with the accounts the admin ticks for that leader.

## 2. Goals

1. Role `director` becomes `oversight` everywhere (data, code, labels, docs) with no loss of access for anyone.
2. Each oversight person signs in with their own login (accounts made by the admin in Admin > Accounts).
3. An oversight login sees a list of the leaders ticked for it, most urgent first, with last check date and status.
4. During a catch-up (phone first) they can run a check from the fixed question bank: tick questions asked, type notes per
   question, and write "notes for next time"; nothing typed is lost if the phone dies.
5. Next time, each question shows what was noted for it last time, and the whole previous check is readable beforehand.
6. A dated free note can be added to a leader between checks.
7. The admin controls who sees which leader, with one grid, and sets the ministry-wide rhythm.

## 3. Non-goals

- No editing of the question bank in the app (code change only).
- No reminders, emails, push alerts, digest lines or Home cards for due/overdue checks (the list is the reminder).
- No reports, bulk exports, CSV, charts or counts of ID checks anywhere, including the admin data export/backup. (Two listed
  exceptions: decision I, the admin's "Archived leaders' history" list shows name, entry count and last date, never notes;
  decision M, the deliberate per-leader export by a ticked account.)
- No read audit trail (same posture as prayers).
- No per-leader custom rhythm; no per-quad rhythm.
- No change to the Elvanto link contract (`LINK_REV` stays 21) and no console code change (docs + one fixture copy only, §8).
- The leader being checked never gets a view of their own record.

## 4. Anti-goals (things that would make this worse)

- **Not a safeguarding or incident register.** If a catch-up reveals a risk of harm, the overseer follows the church's
  Queensland safeguarding policy (Blue Card obligations, reporting lines) outside this app. The screen says so in one line.
  Notes are not evidence and the app must not invite people to treat them as such.
- **No role-based visibility of notes.** Admin or oversight role alone never reveals a note; only a tick does.
- **No new framework, sheet system or editor component.** Reuse the SPA's page pattern, `.rc` rows, `fmtDay`, `esc()`,
  native `<input type="date">` and `<textarea>`.
- **No leaking:** notes never reach exports (meaning every existing bulk/ministry export, backup and the admin data
  export; the per-leader export of decision M is the one deliberate exception), digests, emails, server logs, Error log rows, push payloads, test fixtures with
  real names, or `console.error` output. (Orchestrator's call, §6.)
- No new tables beyond the two below; no per-question table.

## 5. Constraints (from the codebase)

- Layering: `api (Express) → controllers → services → repositories (interfaces) → core` (CLAUDE.md "Architecture").
  RBAC lives in `src/services/access-control.ts` only. Zod parsing inside services. Repos return deep clones.
- Composition root `src/container.ts` names concrete repos (memory + `src/repositories/supabase/`).
- New top-level route = **three registrations**: `src/api/http/router.ts`, `vercel.json` `routes[]` regex, `public/sw.js`
  `API_RE` (CLAUDE.md "Checklist: adding a new top-level API route"). `auth-routes.test.ts` and
  `route-registration.test.ts` pin these.
- Migrations: `supabase/migrations/`, next free is **`0052`**; bump `LATEST_MIGRATION` in `src/core/schema-version.ts`.
  Applied by the Vercel build (`scripts/migrate.ts`); never via the Supabase MCP. Snapshot prod DB before a release that
  adds tables. Keep files idempotent (`if not exists`, guarded `update ... where`).
- jsonb writes via `sql.json(value)`, never `JSON.stringify(x)::jsonb`.
- SPA (`public/index.html`): single-quoted strings must not contain contractions (`check-spa-syntax.js`); every user string
  through `esc()`; buttons min 44px; `.pg` bottom padding; no dark mode; `_here()`/`_still(h)` around awaits; bump
  `public/sw.js` `CACHE` (next free `ysc-vN` at ship time).
- Module plumbing guards: a new page id must be owned by one module in `src/tests/fixtures/module-owners.json`, every
  `PAGE_MODULE` value must be a `MODULE_TREE` key (`module-completeness.spa.test.ts`), and
  `src/tests/fixtures/module-tree.json` must equal `JSON.stringify(MODULE_TREE)` (`module-tree.test.ts`).
- Sessions: `resolveToken` re-reads the account (60 s per-instance cache), so a role change in the DB reaches live
  sessions within a minute; no forced logout needed.
- Real people's names never in tests, fixtures, docs or commits (use Sample, Dummyton, Codeman...).
- Ship windows: no ship Fri 17:30-20:00 or Sun 10:00-12:00 (Brisbane).

## 6. Decisions

### Operator's decisions (fixed)

**A. Rename `director` → `oversight`.** Oversight keeps every permission director has today. Each oversight person (four
quad overseers + youth pastor) gets their own login instead of one shared director login. Touch points:

| Where | Change |
|---|---|
| `users.role` | data `UPDATE users set role='oversight' where role='director'` (plain text column, no CHECK/enum) |
| `app_settings.ministry_config` | move `roles.enabled.director` → `roles.enabled.oversight` (keep its value) |
| `src/core/ministry-config.ts` (~line 150) | zod key `oversight` (default true); comment "Admin, Oversight, Grade, Quad, Leader" |
| `src/core/types/enums.ts` `USER_ROLES` + role comment | `'oversight'` |
| `src/services/account.service.ts:20` `CreateUserSchema.role` | `'oversight'` |
| `src/services/access-control.ts` | `ROLE_PERMISSIONS.director` → `oversight`; every `actor.role === 'director'` (lines ~144-435); comments |
| `src/services/settings.service.ts:20` `OPTIONAL_ROLES` | `'oversight'` |
| `src/services/link.service.ts` | role checks and user-facing messages ("Only the admin or an oversight login...") |
| `public/index.html` | ~90 occurrences: role arrays, `_ROLE_LABEL_DEFAULTS` (label **"Oversight"**), role help text, More-menu rules |
| `src/seed.ts` | seed account role + username (see §7) |
| tests (~64 files) | role strings, usernames, helper logins (`ROLES` list in `module-completeness.spa.test.ts`, etc.) |
| CLAUDE.md, README, current docs | role table, seed table, wording |
| Console repo `C:\Users\ThomasPC\src\wt24-console` | docs only: `docs/install-runbook.md:137,158`, `SETUP.md:71` "director or admin" → "oversight or admin" |

Other stored role strings (builder checks and decides, recommendation in §7): `prayer_requests.created_by_role`
(typed `UserRole` in `core/entities/prayer.ts`, so it **must** be migrated), `connections.assigned_by_role` (`0001:67`,
free text), `error_log.last_role` (`0019`, free text).

**B. New optional module "ID Checks"** (`modules.idChecks`, `'off' | 'on'`, default `'off'`), toggled like Notices.
Screens are for oversight logins; admins get the assignment grid (C) and see notes only where ticked.

**C. Assignment grid (admin only, admin area).** Rows = all **active** leaders, sorted by gender, then by their connected
students' grade(s). Columns = every oversight account and every admin account. A tick = that account sees that leader's
ID checks. A leader may be ticked for several accounts (shared follow-ups; the pastor may be ticked for all). Access is
**only** via ticks: every account ticked for a leader sees everything for that leader (all checks and notes, whoever
wrote them). Admins manage the grid but see no notes unless ticked (the operator trusts admins not to self-tick).

**D. Rhythm is global** (admin sets it in Settings): a cycle start date and a repeat interval in months (usually 4 or 6).
Whole quad caught up within the first 2 months after the start date; after that each leader is due `interval` months after
their own last check. The ID Checks list per oversight login shows its ticked leaders with last check date and status
(never / overdue / due soon / on track), most urgent first.

**E. Fixed question bank** from the "Effective ID Checks" PDF, seeded exactly (§9), not editable in the app.

**F. During a catch-up** (phone first, laptop fine; the leader usually does not see the screen): start a check for a
leader; per question either type a note or just tick "asked", mixed freely; plus a general "notes for next time" box.

**G. Last time:** opening a question in a later check shows what was noted for it last time. Before the next check the
whole previous check can be read.

**H. Random note:** an oversight login can add a dated free note to a leader between checks.

### Operator rulings, 2026-10-30 (fixed)

**I. ID-check history survives leader deletion.** Leaders are hard-deleted today (`DELETE /leaders/:id`, reachable by
quad/grade logins in scope; New Year Full Reset `leaders.deleteAll()`), and the allocations import with
`autoCreateLeaders` can rebuild the same person as a new leader id. None of these may destroy ID-check history. A deleted
leader's entries stay stored under the leader's name (archived). An admin can permanently clear them, or re-attach them to
an active leader, from an "Archived leaders' history" list on the admin's ID Checks grid page (§7.1, §7.7a). Admin still
cannot read the notes. Full Reset warns that ID-check history is kept.

**J. "Finish check".** A check has a Finish action. Only finished checks reset the due timer; an unfinished check shows
"In progress", can be resumed, does not affect the timer, and its per-question notes still feed "Last time" (§7.1, §7.6, §7.8).

**K. Only the author edits a check; every account ticked for the leader reads it** (was a builder's call, now accepted by
the operator). Delete stays author or any ticked account (orchestrator's call 3).

**L. Placement.** The module lives in the **More** tab as one entry named "ID Checks", visible to oversight **and admin**
logins only, and admins always see it (not only when ticked). There is no separate admin tab: admins see the assignment
grid and the archived-history list from More → ID Checks, and every account (oversight or admin) sees its own ticked
leaders there (§7.8).

**M. Per-leader export (operator request, 2026-10-30).** An account ticked for a leader can export that leader's ID-check
record. Rules:
- **Per leader, explicit:** one **Export** button on the leader page (`idcheck-leader`); nothing exports in bulk, on a
  timer or from the list/grid pages.
- **Only ticked accounts:** the data comes from `GET /id-checks/leaders/:id`, which already answers 404 unless the caller
  is ticked (7.4). The button re-fetches it fresh on tap (not from the SPA `Cache`), so the server tick check runs at
  export time. No new route. An admin who is not ticked has no leader page, so no export.
- **Contents:** every entry for the leader, newest first: all checks (each marked **Finished** or **In progress**) with
  date, author, every question asked (section, question text, Asked, note) and "Notes for next time", and every random
  note with date and author. Retired questions keep their text.
- **Formats (builder's call, no new dependency):** **plain text (.txt)**, required, built in the SPA and saved with the
  existing `_downloadText()` helper; and **Excel (.xlsx)**, because the SPA already lazy-loads the vendored SheetJS build
  (`_ensureXlsx()`, `public/vendor/xlsx.full.min.js`) and writes .xlsx for Connect Setup, Trends and Bus history, so it
  costs one small function. One sheet, one row per answered question / next-time note / random note (columns Date, Kind,
  Status, Author, Section, Question, Asked, Note). No Word (.docx): nothing in the repo writes .docx and it would need a
  new dependency. No CSV: .xlsx covers spreadsheet use and CSV would be a third format to keep in step.
- **Never cached, never logged:** `/id-checks*` is network-only in `sw.js`; the file is a `Blob` download that the SW
  never sees; no server log line, Error log row, `link_log` row or audit row is written for an export; the SPA keeps no
  copy after the download.
- The screen says, beside the button: "The file holds private notes. Keep it safe and delete it when done."

This is the only path by which notes leave the app; orchestrator's call 5 and 7.9 apply to everything else.

### Orchestrator's calls

1. **Autosave as you type** (no data loss on a flat battery).
2. A check can be **reopened and edited later**.
3. **Delete** allowed for the entry's author or any account ticked for that leader.
4. **"Last time" for a question** = the most recent other check for this leader (finished or in progress, decision J) where that question had a note or a tick.
5. Notes are sensitive: **never** in exports (except the per-leader export, decision M), digests, emails, logs, or Error
   log payloads.

## 7. Design (builder's calls marked)

### 7.1 Data (migrations)

Two migrations so the rename can ship on its own (**builder's call**: ship Part 1 first, Part 2 in a later release).

**`0052_role_oversight.sql`** (data only, idempotent):
- `update users set role='oversight' where role='director';`
- `update prayer_requests set created_by_role='oversight' where created_by_role='director';`
- **Builder's call (recommended):** also update `connections.assigned_by_role` and `error_log.last_role` the same way, so
  no screen ever prints the old word. They are labels only; nothing scopes on them.
- Move the config key, guarded like `0050_module_switchboard.sql` (skip non-object / double-encoded rows):
  `jsonb_set(ministry_config #- '{roles,enabled,director}', '{roles,enabled,oversight}', ministry_config->'roles'->'enabled'->'director')`
  where `roles.enabled` is an object that has `director` and lacks `oversight`.
- **Builder's call:** `MinistryConfigSchema` also accepts a legacy `roles.enabled.director` (preprocess, like the
  `newYouthForms` boolean) so a config saved by an old tab during the deploy minute still parses.
- **Rollback note for DEPLOY.md:** code below this build does not know `oversight`; `can()` fails closed, so those logins
  (and the console's `ELVANTO_SYNC_YS` login if it is one) would get 403s. Before an Instant Rollback below Part 1, run the
  reverse UPDATEs (written out in DEPLOY.md).

**`0053_id_checks.sql`** (additive, two tables, RLS enabled like `0028_notices.sql`):

```sql
create table if not exists id_check_access (           -- the grid: one row per tick
  leader_id uuid not null references leaders(id) on delete cascade,
  user_id   uuid not null references users(id)   on delete cascade,
  created_at timestamptz not null default now(),
  primary key (leader_id, user_id)
);
create table if not exists id_check_entries (          -- checks AND random notes
  id uuid primary key,                                 -- client-made, so autosave is an idempotent upsert
  leader_id uuid references leaders(id) on delete set null,  -- null = leader deleted: archived (decision I)
  leader_name text not null default '',                -- snapshot of the leader's name, refreshed on every save
  kind text not null check (kind in ('check', 'note')),
  held_on date not null,                               -- the catch-up / note date (Brisbane day)
  finished boolean not null default false,             -- decision J; checks only, notes ignore it
  author_id uuid not null,                             -- no FK: entries outlive a deleted account
  author_name text not null default '',
  content text not null,                               -- encrypted JSON envelope (7.2)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists id_check_entries_leader_idx on id_check_entries(leader_id, held_on desc);
```

**Decision I, how (builder's call, the simplest that works):** `leader_id` is nullable with `ON DELETE SET NULL`, plus a
`leader_name` snapshot, so no code path that deletes a leader (single delete, Full Reset, any future one) can touch the
history, and nothing in the leader repos changes. An entry with `leader_id is null` is **archived**: no list, leader page
or tick reaches it, so nobody reads it (not even its author). The service writes `leader_name` on every upsert from the
current leader record, so the snapshot is as fresh as the last save. `id_check_access` ticks for a deleted leader simply
cascade away. The archive list groups by `leader_name` (two deleted leaders with the same name show as one group; the
admin cannot tell them apart and does not need to). The memory repo has no FK, so it treats an entry whose `leader_id`
is not found in the leaders repo as archived (same result).

**Decision J, why a column:** `finished` is a plain column, not a field in the encrypted `content`, because the due-date
query (latest finished check per leader) must run in SQL without decrypting every row, and `finished` is not sensitive.
Rule (server-enforced): `finished` only moves false to true. An upsert that sends `false` for an already finished row
keeps it `true`, so a late autosave after Finish cannot reopen the check. Notes (`kind='note'`) are stored `false` and
ignore it. A finished check can still be edited by its author (orchestrator's call 2); it stays finished.

**Builder's call:** one entries table with `kind` instead of separate checks/notes tables. A note is
`{ text }`; a check is `{ answers: { [questionKey]: { asked: boolean, note: string } }, nextTime: string }`.
Limits (zod): note per question 4000 chars, `nextTime` and a random note 8000 chars; unknown question keys refused on write,
tolerated on read.

### 7.2 Encryption at rest (builder's call)

`content` is encrypted with the existing `src/utils/field-crypto.ts` (`maybeEncrypt`/`maybeDecrypt`, AES-256-GCM,
`FIELD_ENCRYPTION_KEY`), AAD `"id_check_entries:content:<id>"`, called **only** inside the new
`src/repositories/supabase/supabase.id-checks.ts`, exactly like `supabase.students.ts` does for phones. Memory persistence
and services stay unaware. Reason: these notes are more sensitive than phone numbers (faith, family, money; "sensitive
information" under the Privacy Act 1988), and the pattern already exists. Missing-key behaviour = same as phones.

### 7.3 Config

- `modules.idChecks: z.enum(['off','on']).default('off')` in `ModulesSchema` (`ministry-config.ts`), and a
  `MODULE_TREE` node `{ key: 'idChecks', label: 'ID Checks' }` in `src/core/module-tree.ts`; regenerate
  `src/tests/fixtures/module-tree.json`; add owners in `src/tests/fixtures/module-owners.json`.
  **Builder's call:** the console keeps a byte copy of `module-tree.json`; copy the new file into the console repo in the
  same small console commit as the docs wording (§8). No console code or `LINK_REV` change.
- Top-level `idChecks: { cycleStart: '' | 'YYYY-MM-DD', intervalMonths: int 1-12 default 6 }` in `MinistryConfigSchema`
  (and `MINISTRY_CONFIG_DEFAULTS_CLIENT` mirror). Saved through the existing `PATCH /settings` (`admin:manage`).
  It is visible in public `GET /settings`; it is not sensitive.

### 7.4 Permissions (`access-control.ts`)

- New actions: `'idcheck:use'` (oversight, admin) and `'idcheck:assign'` (admin).
- New helper `canSeeIdChecks(actor, tickedUserIds: Set<string>)`: `can(actor,'idcheck:use') && tickedUserIds.has(actor.id)`.
  The service loads the ticks and calls it; no role short-cut for admin.
- A tick may only name an **active oversight or admin** account (validated on write). If an account later changes role
  or is deactivated, its ticks stay in the table but are inert (role check fails). **Builder's call.**
- A leader that is not ticked for the caller answers **404** (same as missing), so the API never confirms who has records.
  **Builder's call.**
- Entry edit: **author only** (decision K; avoids two people overwriting one check; others ticked read it). Entry
  delete: author or any ticked account (orchestrator's call 3). Resuming an in-progress check is an edit, so only its
  author resumes it; other ticked accounts see "In progress (name)" and can read it.
- The archive routes (7.5) are `idcheck:assign` (admin only) and never return note text.

### 7.5 Service + routes

`src/services/id-check.service.ts` (`makeIdCheckService`), repo interface `IIdCheckRepository` in
`src/repositories/interfaces/entity-repositories.ts`, memory + supabase repos, controller
`src/api/controllers/id-check.controller.ts`, wiring in `container.ts`. Every method starts with `assertOn()` (module off =
`ModuleDisabledError`, 404, data kept), copied from `notice.service.ts`.

| Route (all `auth: true`) | Who | Does |
|---|---|---|
| `GET /id-checks` | idcheck:use | My ticked active leaders: `{id, name, gender, grades, lastCheckOn, dueOn, status, inProgress}` sorted (7.6), plus `questions` (the bank) and `rhythm`. `lastCheckOn` = latest **finished** check; `inProgress` = `{entryId, authorName, mine}` of the newest unfinished check, else null. An admin who is ticked for nobody gets an empty list |
| `GET /id-checks/leaders/:id` | ticked | All entries for the leader, newest first, decrypted, with author names and `mine` |
| `PUT /id-checks/entries/:id` | ticked (author for an existing row) | Upsert one entry `{leaderId, kind, heldOn, finished, content}` (`finished` only false to true, 7.1); returns `updatedAt` |
| `DELETE /id-checks/entries/:id` | author or ticked | Delete |
| `GET /id-checks/access` | idcheck:assign | Grid: rows (7.7), columns (active oversight + admin accounts), ticks |
| `PUT /id-checks/access` | idcheck:assign | `{userId, leaderIds: string[], on: boolean}`: one tick or a whole column |
| `GET /id-checks/archived` | idcheck:assign | Archived leaders' history: `[{name, count, lastOn}]` only, no notes |
| `POST /id-checks/archived/delete` | idcheck:assign | `{name}`: delete that group's entries for good |
| `POST /id-checks/archived/attach` | idcheck:assign | `{name, leaderId}`: re-attach that group's entries to an active leader (sets `leader_id`) |

Register `/id-checks` in `router.ts`, the `vercel.json` regex, and `sw.js` `API_RE` (network only: never cached by the SW).
The question bank is served by `GET /id-checks` from one core file, so the SPA has **no** mirror to keep in sync.

### 7.6 Due dates and status (pure function, `src/services/id-check-rhythm.ts`)

Inputs: today (Brisbane day via `structure.timeZone`), `cycleStart`, `intervalMonths`, the leader's latest **finished**
`kind='check'` `held_on` (`last`; decision J). An unfinished check is ignored here. Month adding clamps to month end (31 Aug + 6 = 28/29 Feb).

- No `cycleStart` set: `due = last ? last + interval : today`.
- `last` missing or before `cycleStart`: `due = cycleStart + 2 months` (the catch-up window).
- Otherwise: `due = last + interval`.
- Status: `overdue` if `today > due`; else `never` if no check ever; else `due soon` if `due - today <= 30 days`
  (**builder's call**: 30 days); else `on track`.
- Sort: `due` ascending, then `never` before others on the same day, then name.

Random notes and unfinished checks never move the due date. One small test file pins the table above (start in future,
catch-up window, month-end clamp, unset start, an unfinished check ignored).

### 7.7 Grid rows (builder's calls on detail)

Active leaders; group by gender (Girls, then Guys, then gender not set), then by the lowest grade among their connected,
not-graduated students (`connRepo.findByLeader` + students), then full name; leaders with no connected students last in
their group. Row meta shows the grades ("Gr 8, 9"). Columns show each account's display name and role label.

### 7.7a Archived leaders' history (decision I)

Admin only, on the grid page (7.8), under the grid: a list **Archived leaders' history** (hidden when empty), one `.rc`
row per `leader_name` group with name, entry count and last date (`fmtDay`), and two actions. Notes are never shown.

- **Delete forever** (two taps, "Delete all N entries for <name> for good? This cannot be undone.") calls
  `POST /id-checks/archived/delete`. This is also how a deletion request is met.
- **Re-attach** opens a picker of active leaders and calls `POST /id-checks/archived/attach`. The confirm names the target
  and says who is ticked for them ("Everyone ticked for <leader> will be able to read these notes."). Archived entries
  never move on their own, so a leader re-created under a new id (allocations import, delete and re-add) starts empty until
  an admin re-attaches; ticks must be set again for the new id. **Builder's call:** manual re-attach only, no automatic
  name matching (a wrong guess would show one person's private notes to another leader's overseers).

### 7.8 SPA (`public/index.html`)

- **Nav (decision L):** one More menu item "ID Checks" (icon from the existing icon set), next to the Notices item
  (~line 2656), shown to oversight **and admin** logins only, only when `modules.idChecks === 'on'`. Admins always see it,
  ticked or not; no other role sees it. There is no ID Checks entry in `ADMIN_TABS`. `PAGE_MODULE` gains `idchecks`,
  `idcheck-leader`, `idcheck-edit`, `idcheck-grid` → `'idChecks'`; `render()` sends Home when off (like `notices`).
- **List page (`idchecks`):** `.rc` rows: leader name + status pill (`.pill.bad` overdue, `.pill.warn` due soon,
  `.pill.neutral` never, `.pill.ok` on track), meta "Last check Fri 16 Oct · Due Mon 15 Feb" via `fmtDay` (last = latest finished check). A leader with an unfinished
  check also gets a second `.pill.info` "In progress" beside the status pill; it never replaces or changes the status. Empty state:
  "No leaders are ticked for you yet. Ask the admin." (an admin sees "No leaders are ticked for you yet. Tick some below.") If `cycleStart` is unset, one line says the admin has not set the start.
- **Leader page (`idcheck-leader`):** buttons **Start ID check** (reads **Resume ID check** and opens the caller's own
  newest unfinished check when there is one) and **Add note**; the previous finished check shown in full
  (its "notes for next time" first); then history, newest first, each entry with date, author, kind and an "In progress"
  pill on an unfinished check ("In progress (name)" if it is someone else's); Edit (author) and
  Delete (two taps) on each. One line: "Worried about someone's safety? Follow the safeguarding policy, not this app."
  An **Export** button (decision M) opens a two-choice sheet, Text file / Excel file, with the keep-safe line.
- **Check page (`idcheck-edit`):** date field (defaults today); the six sections as collapsible groups with their
  sub-titles; each question row has a 44px "Asked" tick and opens a `<textarea>`; when opened it shows "Last time
  (date): ..." muted above the box (orchestrator's call 4, computed in the SPA from the leader's entries already fetched).
  A tick or a non-empty note both count as asked. At the end "Notes for next time". A status line: "Saved 2:14pm" /
  "Not saved, retrying". Two buttons at the end: **Finish check** (flushes any pending save, then `PUT`s with
  `finished: true`, then returns to the leader page; this is the only thing that resets the due timer) and **Save and
  close** (returns with the check still in progress). Autosave never sets `finished`. A random note uses the same page
  with one box and a single **Done**.
- **Autosave (orchestrator's call 1, builder's detail):** the client makes the entry id when the page opens; every change
  schedules a `PUT /id-checks/entries/:id` (debounce ~1.5 s, plus on `visibilitychange`/`pagehide`). The first save
  creates the row. Unsaved text is held in `localStorage` under one key per entry id **only until the server confirms**,
  restored on reopen, removed on logout. The server compares nothing (author-only edits make last-write-wins safe).
- **Admin settings:** Youth Setup → Modules gets the ID Checks switch (beside Notices, ~line 7474) and, when on, the cycle
  start (`<input type="date">`) and interval (number, 1-12).
- **Grid page (`idcheck-grid`, admin only, More → ID Checks):** the list page shows admins an **Assign leaders** button
  (**builder's call:** a sub-page of the same More entry, so the phone list stays short; the operator's wording allows
  these as sections of the one page instead). The page holds the grid: sticky first column of leaders, one tick column
  per account, the grid scrolls sideways inside its card (no page side-scroll), each column header has "Tick all / Clear";
  then the Archived leaders' history list (7.7a). A tick saves at once (`PUT /id-checks/access`) and reverts with a toast
  on failure.
- **Full Reset warning:** the New Year wizard's Full Reset step (the gated step that runs `POST /admin/reset`) adds one
  line before it runs: "ID-check history is kept. Leaders are deleted, so it moves to Archived leaders' history in More,
  ID Checks." (text only, no new confirm).

### 7.9 Privacy rules (orchestrator's call 5, how)

- No logging of request bodies on these routes; errors carry codes only. Check `VALIDATION_ERROR` `details` never echo a
  value (zod issue messages for these schemas carry limits, not text) and that `error-log.service` records only code/route.
- `id_check_*` tables are excluded from every export, backup, digest and Connection Audit path (nothing reads them but
  the new service; a test greps `src/services` for the table/repo names outside the module's own files). The per-leader
  export (decision M) is built in the SPA from the ticked-only leader route, so it adds no server reader.
- No push, no Home card, no counts in `/batch`, overview or the console claim reply.
- SPA `Cache` holds `/id-checks*` responses in memory only (never the `localStorage` theme cache); `sw.js` never caches them.

### 7.10 Seed and tests

- **Seed (builder's call):** memory seed account `director` becomes username `oversight`, role `oversight`; add a second
  `oversight2` so shared ticks can be demoed; a few ticks and one fictional check (no real names). Update the CLAUDE.md
  seed table.
- **Tests:** the rename sweep; `id-check.service.test.ts` (tick-only access incl. admin not ticked = 404 and admin ticked
  = full read; author-only edit; delete rights; `finished` only false to true, and an unfinished check leaves `lastCheckOn` unchanged but still feeds "Last time"; deleting a leader (and `deleteAll`) keeps the entries as archived with their name, the ticks go, the admin list shows no text, delete-forever and re-attach work; More shows ID Checks to oversight and admin (admin unticked included) and to no other role; tick target must be oversight/admin; module off = 404; upsert idempotent);
  the rhythm test (7.6); the export (decision M: the text and xlsx row builders cover finished, in-progress and note
  entries and a retired question; an unticked caller gets 404 so no file); route registration/401 tests pick up `/id-checks` automatically; module-completeness fixtures.

## 8. Release outline

1. **Part 1 (rename)**: migration `0052`, sweep, SW bump, CLAUDE.md. Console commit (separate repo, not pushed by the
   builder unless told): docs wording + `module-tree.json` copy can wait for Part 2.
   Post-deploy: `/health` `schema.current` = `0052`; sign in as an oversight login; check the console's Friday upload login
   still works (its account becomes oversight; it must stay active and must not be one of the five personal logins).
2. **Operator task:** create the five personal oversight logins in Admin > Accounts; decide whether to keep the old shared
   login (only if the console uses it).
3. **Part 2 (ID Checks)**: migration `0053`, prod DB snapshot first, SW bump, `LATEST_MIGRATION`, curl
   `/id-checks` = JSON 401, module stays **off** until the admin turns it on and fills the grid.

## 9. Question bank (exact text, stable keys)

File `src/core/id-check-questions.ts`: `ID_CHECK_SECTIONS = [{ key, title, subtitle, questions: [{ key, text }] }]`.
Keys are permanent: re-wording keeps the key, a new question takes the next number, a dropped question stays with
`retired: true` (hidden on new checks, still shown in old ones). Never renumber or reuse a key.

**faith: FAITH, their walk with God**
faith01 How's your relationship with God? · faith02 What does spending time with God look like? · faith03 What are you
reading in the bible? · faith04 When do you usually pray? What do you pray for? · faith05 What's God been doing in your life
lately? · faith06 What's God been challenging you on? · faith07 What are your convictions? · faith08 What do you have faith
for? · faith09 What are your God dreams? · faith10 Who do you look up to?

**form: FORM, their character development**
form01 How's your heart? · form02 How's your mind/thoughts? · form03 How's your soul? · form04 How's your attitude? ·
form05 Do you think that ___ is beneficial? What do you think about that? · form06 What does God's word say about that? How
does that align with God's word? · form07 Are you good with conflict? Having hard conversations? · form08 Do you have any
questions you would like to ask? · form09 Is there something you are trying to work on in your character at the moment? ·
form10 What area do you want to grow in? · form11 What kind of person do you want to be? Leader?

**family: FAMILY/FRIENDS, their relationships with family & friends**
family01 What was it like growing up in your family? · family02 What's your family dynamic like? · family03 How did it
affect you? Does it still affect you? · family04 What's your relationship with your ___ like? · family05 Who are your people?
Who are your friends? · family06 Who speaks into your life? Who challenges you? · family07 Are there any relationships you
wish to be restored? · family08 Is there anyone in your life you have unforgiveness towards? · family09 What kind of
husband/wife do you want to be? (if applicable) · family10 Do you dream of having a family one day? What kind of family?

**finances: FINANCES, their stewardship of what God has entrusted us to**
finances01 Do you have any finance goals? Saving up for? Working towards? · finances02 What was the relationship like with
money and finances growing up? · finances03 What's your understanding of tithing and giving? · finances04 Do you find it
easy to be generous? · finances05 Do you believe God will provide for you financially? · finances06 What's an area of your
finances that you want to grow in? · finances07 Is this an area that you struggle in? · finances08 What's your mindset with
money? · finances09 Do you think you steward your finances well? · finances10 What are you believing for?

**fruit: FRUIT, the effectiveness of their ministry**
fruit01 How do you serve God in your life? · fruit02 Do you enjoy serving in church? · fruit03 Do you have a conviction about
building God's kingdom? · fruit04 What does that look like? · fruit05 Are the fruits of the spirit produced in your life?
(love, peace, joy, kindness, faithfulness, patience, gentleness, goodness, self control) · fruit06 What passions are in your
heart? · fruit07 What frustrates you ministry wise? What's an area in ministry you care about? · fruit08 What are you doing
to develop your skills etc? · fruit09 What's your God dream?

**general: GENERAL**
general01 What do you do for fun? · general02 What gets you excited for life? · general03 What was your childhood like? ·
general04 What's your story? · general05 Do you find 1 on 1 convos hard? · general06 Is there anything I can pray for
specifically? · general07 Is there anything specific you'd like to talk about? · general08 How can I support you better? ·
general09 How do you best feel loved? Love language? · general10 What's something you'd like accountability for? ·
general11 Is there something about your faith you'd like to learn more about? · general12 Do you have any questions?

Section titles on screen use the PDF's en dash: "FAITH – their walk with God". Question text is stored with straight
apostrophes as above; the file is TypeScript, so the SPA apostrophe rule does not apply.

## 10. Left to the builder

- Exact SPA function names (keep a single prefix, e.g. `_ic*`; check it collides with nothing), icon choice, copy polish.
- Whether the docs sweep touches `docs/HISTORY.md`, `CHANGELOG.txt` and old specs (recommended: no, they are history;
  update CLAUDE.md, README, DEPLOY.md, current guides).
- Debounce timing, retry back-off, and the exact draft key.
- Plan order and lane split (Part 1 is a mechanical sweep that suits one lane; Part 2 splits into server and SPA lanes).
- Any further simplification that keeps decisions A-L and the orchestrator's calls intact.

## 11. Review gates for the plan

Code review, ponytail audit, Impeccable (list, leader, check and grid screens at phone width), and a UX walkthrough as an
oversight login doing a real catch-up flow on a phone: start a check, tick/type, lock the phone mid-way, reopen, finish,
then start a second check and confirm "Last time" shows the right note.
