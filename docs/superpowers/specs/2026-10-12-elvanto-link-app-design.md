# Elvanto link: app side (YS Connection) — design

Date: 2026-10-12 (rev 2: review `2026-10-12-elvanto-link-app-review.md` applied, plus ledger decisions 9–19).
Status: spec. Branch `feat/elvanto-link-app` (worktree `C:\Users\thoma\ysc-work\link`).
Binding inputs: the contract `2026-10-11-elvanto-link-contract.md` ("the contract"; §10.1 is the work list), the ledger
`docs/superpowers/elvanto-link-progress.md` (decisions 1–19), and the repo `CLAUDE.md`.
Mockup: `docs/superpowers/specs/2026-10-12-door-checkin-mockup.html`.

**This repo is public.** No tenant URL, real name or real id goes into code, tests, fixtures or docs.

Frozen and untouched: `src/core/link-contract.ts` and `src/tests/fixtures/elvanto-link/*` (incl. `manifest.json`).
No `/sync` body changes. §14 lists what the console side must change (wording only).

## 1. What we build

Leaders use five new screens. Each action becomes one `link_outbox` row. The console claims it over `/sync/*`, does
it in Elvanto and reports back. The screens show that result. Every action, and every "I am" switch, also goes into
an admin-exportable log (§6).

| Screen | Who (switch On) | Action types |
|---|---|---|
| **Check-in** (the door screen: check-in and check-out in one list) | every login | `checkIn`, `checkOut` |
| **First-timer check-in** (a tick on the New person form) | every login | `firstTimerCheckIn` |
| **Lifegroup report** (submit, or edit the last report) | logins that can see the group | `submitReport`, `editReport` |
| **Flow steps** (tick a step, add a note) | logins that can see the person | `completeStep` |
| **Elvanto link** (admin: status, matching, shadow check, activity log) | director, admin | none |

Out of scope here (they are the rework stream's, contract §10.1 item 8 and decisions 2–5, 9, 14): login relabel,
grade filter, Prayers off, Bus read-only routes.

## 2. Rulings (binding for the plan)

### 2.1 One switch: `modules.newYouthForms`

- Every new screen and every `/link/*` route uses the existing switch `ministryConfig.modules.newYouthForms`
  (`off` / `shadow` / `on`). **No new module key.** The contract's `modules.elvantoLink` (§4, §10.1 item 6) is not
  built (decision 1). The app has no per-action switch.
- **Off:** nobody sees the screens. Every `/link/*` route answers 404 `MODULE_DISABLED`, the admin routes too.
- **Shadow:** the `admin` login only (every other login gets the same 404 and no More entry). **Matching and every
  other admin task happen in Shadow**, not in Off.
- **On:** every login that has the RBAC action (§7).
- `access-control.ts`: `canUseLink(actor, mode, action: 'link:use' | 'link:admin') = can(actor, action) &&
  modeAllows(actor, mode)`. `modeAllows` comes from the rework (`mode === 'on' || (mode === 'shadow' &&
  actor.role === 'admin')`); if the rework has not landed, lane B adds it with that body. Every service method reads
  the mode from settings and calls it.
- **`/sync/*` ignores the switch** (only the token decides), so the console can push mirrors and heartbeat at any
  time. **Exception:** while the switch is `off`, `POST /sync/claim` leases nothing (it still heartbeats and sweeps).
  Off is the stop button: queued rows wait; the 3-day sweep refuses old ones.
- **Live or practice per type is the console's** (`ysLink.shadow.<type>`, reported as `capabilities`). The app only
  shows it. "Go live one type at a time" happens on the console.
- **UI label:** the Youth Setup control is renamed **"Elvanto features"** (key unchanged; options unchanged). Help:
  "Turns on the screens that send to Elvanto: New person, Check-in, Lifegroup report and Flow steps. Shadow mode shows
  them to the admin login only, for testing. Off by default." The New person More entry keeps its name.

### 2.2 Attribution (decisions 6, 11; ledger 25 D2 reverses 17)

- **The app composes** `Self identified leader: <leaderName> — <note>` (name only when the leader wrote no note) in
  the `/sync/claim` row for flow steps and lifegroup reports and edits (ledger 25 D2, contract X1). The stored note
  stays the leader's own words (encrypted; `hasNote` still means the leader wrote something). The console adds
  nothing.
- **"I am" is required** for `submitReport`, `editReport` and `completeStep` (decision 11): `leaderId` must be given
  and be a real leader → else 400 "Pick who you are first." A junior `leader` login always uses its bound `leaderId`.
  So `by.leaderName` (= `leader_name`) is always a real leader name for these three types. (This makes `leaderId`
  required where contract §4.1 says optional: an app-side tightening, listed in §14.)
- `leader_name` for the other types: the "I am" leader's name if given, else the login's `displayName` (the column is
  `not null`).
- Leader note cap: 1,800 characters, and less for a long leader name, so the prefixed text fits 1,900 (400 above
  that, with the exact limit in the message).
- `hasNote` (contract §4) = raw note not null.

### 2.3 Which service (contract §5.5, amended)

One pure helper (§5.1). "The day" is today for check-ins and first-timers, and the report date for reports.
- **Friday:** the day's mirror services; exactly one → default. **Sunday:** the day's services that start at 10:15
  (Brisbane); exactly one → default. Otherwise, none, or two or more → no default; the leader picks.
- **Pick list:** mirror services with `ymd` in today−7 … today, newest first. A report also offers "No service".
- A report may be dated up to today−14, but the mirror keeps 7 past days. For an older report the form says "Older
  services are not listed. Pick No service, or do it in Elvanto." The server checks a report's service against
  `link_services` (contract §5.1), not against the pick list. An edit keeps the saved service unless changed.

### 2.4 Time, cut-off, check-out, latency

- **Today** = `brisbaneToday()` (UTC+10, no DST). Constants: `LINK_CUTOFF_DAYS = 3`, `LEASE_LOST_MS = 3_600_000`.
- **Check-out is on.** Enqueue rule (fixes the contract §5.1 gap for shadow and pending rows): allowed when the
  person's effective state (§5.3) is **in** — the mirror has them in, or their newest check-in row is `pending`,
  `claimed`, `sent`, `shadowed` or `unclear`. So check-out can be tested on the shadow Friday. If the check-in is
  still `pending` on the server, the phone's Undo cancels it instead (§9.2). Anything Elvanto disagrees with comes
  back from the console as `already` (not checked in) or a refusal.
- **Latency (decided):** the console claims every 60 s in the window, every 15 min outside. The phone never waits:
  taps are instant and queued (§9.2). The SPA re-reads its own open rows every 15 s and the screen data every 60 s,
  only while a link screen is visible (stops on `visibilitychange`). Services push cadence: 60 s on the shadow
  Friday, then the console decides (decision 16).

### 2.5 Migration `0017` and the deploy hazard (decisions 15, 19)

- `git mv` the draft to **`supabase/migrations/0017_elvanto_link.sql`**. The rework owns `0016`. Set
  `LATEST_MIGRATION = '0017'` (a test enforces it). The body stays **byte-for-byte** the draft, except: the header
  comment says it is the migration, and three statements are appended at the end:
  `alter table link_outbox add column if not exists report_id uuid;` (holds a `sent` submit's `reportId`; contract
  §5.1/§5.5 need it, the draft lacked it), the `link_log` table (§6.1), and its `enable row level security`.
- The old draft path keeps a one-line file: `-- Moved to supabase/migrations/0017_elvanto_link.sql (2026-10-12).`
- `src/tests/link-contract.test.ts` "draft SQL" block reads `supabase/migrations/*_elvanto_link.sql` and asserts
  **exactly one** match. The RLS rule test then also covers `link_log`.
- **New test** `src/tests/migration-numbers.test.ts`: fails when two files in `supabase/migrations/` share a 4-digit
  prefix (the runner records numbers only, so a duplicate is skipped forever with no error).
- **Hazard (corrected):** preview builds never migrate (`shouldRun` needs `VERCEL_ENV=production` and
  `PERSISTENCE=supabase`). **A merge to `master` migrates prod at build time, before the owner promotes.** The
  migration is additive, so that is safe. The real risk is a duplicate number, which the new test catches. After the
  build, read the line `Database up to date — …` and check that it names `0017`. If the rework has not merged first,
  `0016` is missing and the runner still applies `0017` (numbers need not be contiguous); keep the order anyway.

## 3. Shared types first (lane T, wave 0)

Two files that every other lane imports. Written first, exactly as below, so parallel lanes don't invent their own.

`src/core/link-types.ts`:

```ts
import type { z } from 'zod';
import type { ACTION_TYPES, STATUSES, PUSH_KINDS, REASONS, ResultItem as ResultItemSchema,
  ResultResponse as ResultResponseSchema } from './link-contract';

export type ActionType = (typeof ACTION_TYPES)[number];
export type Status = (typeof STATUSES)[number];
export type PushKind = (typeof PUSH_KINDS)[number];
export type Reason = (typeof REASONS)[number];
export type Capability = 'live' | 'shadow' | 'locked' | 'off';
export type Capabilities = Record<ActionType, Capability>;
export type Match = 'auto' | 'manual' | 'none' | 'ambiguous' | 'ignored';
export type IgnoredWhy = 'unknown-id' | 'not-leased' | 'already-final' | 'bad-transition';
export type ResultItem = z.infer<typeof ResultItemSchema>;
export type ResultReply = z.infer<typeof ResultResponseSchema>;

export interface OutboxRow {
  id: string; type: ActionType; payload: Record<string, unknown>;
  note: string | null;              // plaintext in memory; the Supabase repo encrypts/decrypts
  dedupeKey: string; serviceDate: string; studentId: string | null; personId: string | null;
  createdBy: string; leaderId: string | null; leaderName: string;
  status: Status; reason: string | null; detail: string | null;
  attempts: number; retryAt: string | null; leaseOwner: string | null; leaseUntil: string | null;
  resultAt: string | null; sentLogKey: string | null; reportId: string | null;
  createdAt: string; updatedAt: string;
}
export type NewOutboxRow = Pick<OutboxRow, 'id' | 'type' | 'payload' | 'note' | 'dedupeKey' | 'serviceDate' |
  'studentId' | 'personId' | 'createdBy' | 'leaderId' | 'leaderName'>;
export interface ConsoleRow { consoleId: string; label: string; lastSeenAt: string; contractVersion: number;
  consoleVersion: string; inWindow: boolean; pollSeconds: number; capabilities: Capabilities; }
export interface ClaimArgs { console: Omit<ConsoleRow, 'lastSeenAt'>; max: number; leaseSeconds: number;
  cutoffDays: number; leaseLostMs: number; }
export interface ClaimedRow { row: OutboxRow; reclaimed: boolean; noteUnreadable: boolean; }
export interface MirrorStateRow { kind: PushKind; takenAt: string; consoleId: string; rowCount: number; appliedAt: string; }
export interface LinkRosterRow { personId: string; firstName: string; lastName: string; gender: 'male' | 'female' | null;
  grade: number | null; kind: 'student' | 'leader' | 'other'; active: boolean; studentId: string | null; match: Match;
  updatedAt: string; }
export interface LinkServiceRow { serviceTimeId: string; serviceId: string; name: string; startsAt: string; ymd: string;
  rooms: { id: string; name: string }[]; checkedIn: { personId: string; roomId: string }[]; }
export interface LinkLastReport { reportId: string; date: string; time: string; didNotMeet: boolean; attendees: string[];
  guests: number; serviceTimeId: string | null; editable: boolean;
  blocked: 'multi-service' | 'unkept-notes' | 'member-left' | null; }
export interface LinkGroupRow { groupId: string; name: string; grade: number | null; gender: 'male' | 'female' | null;
  meets: string; members: { personId: string; name: string; leader: boolean }[];
  thisWeek: 'reported' | 'did-not-meet' | 'none' | 'later' | 'unreadable'; lastReport: LinkLastReport | null; }
export interface LinkFlowRow { rowId: string; flowId: string; flowName: string; stepId: string; stepName: string;
  stepOrder: number; personId: string | null; name: string; due: string | null; assignedTo: string; }
export type LogEvent = ActionType | 'identity' | 'cancel' | 'undo';
export interface LinkLogRow { id: string; at: string; userId: string; login: string; deviceId: string | null;
  deviceLabel: string | null; event: LogEvent; leaderId: string | null; leaderName: string | null;
  prevLeaderId: string | null; prevLeaderName: string | null;
  targetKind: 'person' | 'group' | 'flowRow' | 'action' | null; targetId: string | null; targetName: string | null;
  outboxId: string | null; outcome: string; }
```

`src/core/errors/link-errors.ts` (plus lane T adds `extra?: Record<string, unknown>` as a 4th constructor arg to
`AppError` in `src/core/errors/app-error.ts`, and `sendError` spreads it into the body):
`LinkUnavailable` (409 `LINK_UNAVAILABLE`, "Do this in Elvanto for now."), `LinkIdReused` (409 `LINK_ID_REUSED`),
`LinkEditInElvanto` (409 `LINK_EDIT_IN_ELVANTO`, extra `reason`), `LinkOpenDuplicate` (409 `LINK_DUPLICATE`, extra
`existingId`), `LinkTooLate` (409 `LINK_TOO_LATE`), `LinkNotYours` (403 `LINK_NOT_YOURS`, "Only the leader who
sent this can undo it."), `LinkOff` (503 `LINK_OFF`), `LinkContractMismatch` (409 `LINK_CONTRACT_MISMATCH`, extra
`expected: 1`), `SyncValidation` (400 `VALIDATION_ERROR`, for every `/sync` body or `:kind` error).

## 4. Data (lane A)

Tables: the contract §2 (draft SQL) + `report_id` + `link_log`. No FK to app tables. RLS on all.

### 4.1 `ILinkRepository` (`src/repositories/interfaces/link.repository.ts`)

```ts
interface ILinkRepository {
  insertAction(row: NewOutboxRow): Promise<OutboxRow>;   // throws LinkOpenDuplicate(existingId) on the open-row index
  getAction(id: string): Promise<OutboxRow | null>;
  listActions(f: { ids?: string[]; createdBy?: string; serviceDateFrom?: string; serviceDateTo?: string;
                   types?: ActionType[]; statuses?: Status[]; personId?: string; serviceTimeId?: string;
                   groupId?: string }): Promise<OutboxRow[]>;     // note is never decrypted here (always null)
  cancelPending(id: string): Promise<boolean>;            // update ... where id = $1 and status = 'pending'
  claim(a: ClaimArgs): Promise<ClaimedRow[]>;             // ONE transaction: console upsert + sweep + purge + lease
  applyResults(consoleId: string, items: ResultItem[], now: Date): Promise<ResultReply>;  // uses applyOutcome
  listConsoles(): Promise<ConsoleRow[]>;
  replaceMirror(kind: PushKind, rows: unknown[], meta: { takenAt: string; consoleId: string }):
    Promise<{ applied: boolean; rows: number }>;
  mirrorState(): Promise<MirrorStateRow[]>;
  roster(): Promise<LinkRosterRow[]>; services(): Promise<LinkServiceRow[]>;
  groups(): Promise<LinkGroupRow[]>; flows(): Promise<LinkFlowRow[]>;
  setMatches(changes: { personId: string; studentId: string | null; match: Match }[]): Promise<void>;
  addLog(rows: LinkLogRow[]): Promise<void>;
  listLog(f: { from: string; to: string; userId?: string; event?: LogEvent; limit: number }): Promise<LinkLogRow[]>;
}
```

- **Claim (one transaction, DB clock):** upsert `link_console` (`last_seen_at = now()`); sweep (`pending` older than
  `cutoffDays` → `refused`, `too-old`; `claimed` whose lease ended over `leaseLostMs` ago → `unclear`,
  `lease-lost`); purge (§4.3); lease up to `max` rows whose type's capability is not `off`, oldest first, `for update
  skip locked`: `pending` with `retry_at` null or ≤ now, or `claimed` with `lease_until < now() and lease_owner =
  consoleId` (`reclaimed: true`). Set `claimed`, owner, `lease_until`, `attempts + 1`. Decrypt each leased note
  **row by row**: a failure sets that row `refused`, `note-unreadable` and returns it with `noteUnreadable: true`
  (the service leaves it out).
- **`applyResults`:** per item, `select … for update` the row, run `applyOutcome` (§5.2), write the change with a
  guarded `update … where id = $1 and status = $old` (and `lease_owner = $consoleId` for a claimed row).
  A `retry` result clears `lease_owner` and `lease_until`.
- `replaceMirror` is one transaction; `takenAt` ≤ stored → `{ applied: false }`. `roster` upserts by `person_id`,
  never writes `student_id` or `match`, and sets `active = false` (and `updated_at`) for people missing from the push.
  The other kinds are a full replace. Writes `link_mirror_state`. Bulk writes use `bulk.ts` `chunk()`.
- `note` is written with `maybeEncrypt(raw, 'link_outbox.note:' + id)`. jsonb via `sql.json(v)` only.
- `insertAction` maps Postgres `23505` on `link_outbox_open_uq` to `LinkOpenDuplicate(existingId)` (reads the open row
  for that key). The memory repo applies the same rule itself.
- Files: `src/repositories/in-memory/link.repository.ts` (`InMemoryLinkRepository`; used for `memory` and `json`;
  not saved to disk; constructor option `{ decrypt?: (note: string, id: string) => string }`, default identity, so a
  test can make a note unreadable) and `src/repositories/supabase/supabase.link.ts` (`SupabaseLinkRepository`).
  Exports added to `src/repositories/interfaces/index.ts`, `src/repositories/in-memory/index.ts` and
  `src/repositories/supabase/index.ts` (lane A only touches these index files).

### 4.2 Tests (lane A)

- **One shared suite** `src/tests/helpers/link-repo-suite.ts`: `describeLinkRepo(name, makeRepo)`. Covers the
  open-row duplicate; cancel only from `pending`; claim (oldest first, `max`, reclaim by the same console only, an
  `off` type skipped, console row upserted); sweep (too-old after 3 days, lease-lost after 1 h); purge; a stale push
  not applied; roster keeps `student_id`/`match` and deactivates missing people; `retry` clears the lease;
  note-unreadable (memory: an injected `decrypt` that throws); log add/list.
- `src/tests/link.repository.test.ts` runs it on the memory repo. `src/tests/link.repository.supabase.test.ts` runs
  it on `SupabaseLinkRepository` **only when `LINK_TEST_DATABASE_URL` is set** (a scratch Supabase branch; never
  prod), else skips. Wave 4 runs it once before merge.
- SQL-text tests on `supabase.link.ts`: has `skip locked`, `now()`, `lease_owner =` in the reclaim and result
  conditions, `status in ('pending','claimed','unclear')` matching the index, `sql.json(`, and no `::jsonb`.

### 4.3 Retention (cheap minor, in the claim's purge step)

Delete roster rows inactive for 90+ days whose `match` is `none` or `ignored`. Set `note = null` on final rows
(`sent`, `refused`, `shadowed`, `cancelled`) older than 30 days. Delete `link_log` rows older than 400 days (a year
plus a term, for any look-back).

## 5. Rules and RBAC (lane B)

### 5.1 `src/services/link-rules.ts` (pure, no I/O; tests `src/tests/link-rules.test.ts`)

- Time: `brisbaneToday(now)`, `addDays(ymd, n)`, `weekdayOf(ymd)` (0 = Sunday), `brisbaneHHMM(iso)`.
- `pickList(services, today)`, `defaultService(day, services)` (§2.3), `lastMeetingDate(meets, today)` (latest date ≤
  today on the weekday named in `meets`; today if none) — the report form's default date.
- `dedupeKey(type, payload)` → exactly the contract §5.1 keys (`first:` key: lower case, spaces folded).

### 5.2 State rules (same file)

- `applyOutcome(row, item, consoleId, now)` → `{ next: Partial<OutboxRow> } | { ignored: IgnoredWhy }`, the contract
  §3.3 table exactly. `sent` stores `sentLogKey`, `reportId`, `personId`; `already` → `sent`, `reason='already'`;
  `retry` → `pending`, `retry_at = now + retrySeconds`, lease cleared; `resolved` from `unclear` by any console. A
  claimed row's result counts while `lease_owner = consoleId`, expired or not. Same outcome on a final row →
  `already-final`; else `unknown-id` / `not-leased` / `bad-transition`.
- `autoMatch(roster, students)` → contract §6 changes (reset dead `student_id`s; name key + equal gender; one →
  `auto`; several, or a twin roster key → `ambiguous`; none stays `none`; never touches `manual`/`auto`/`ignored`).
- `effectiveCheckState({ mirrorIn, mirrorTakenAt, rows })` → `{ in }` for
  one person and service. `rows` = that person's `checkIn`/`checkOut` rows for the service, newest first, without
  `cancelled` and `refused`. The newest row decides when it is `pending`, `claimed` or `unclear` (not yet known in
  Elvanto); when it is `shadowed` (practice never reaches Elvanto, so the mirror can never show it; the door
  reads practice from `action.status`, APP-38); or when it is `sent` **and** `resultAt + 120 s > mirrorTakenAt`
  (the mirror has not caught up yet; X11 / T-21 allows for the two clocks).
  Otherwise the mirror decides. Tests cover both orders (sent then kiosk check-out; sent check-out then kiosk
  check-in).

### 5.3 Other lane B files

- `src/services/access-control.ts`: actions `link:use` (all five roles), `link:admin` (director, admin);
  `modeAllows` (if absent) and `canUseLink` (§2.1). Tests in `src/tests/access-control.test.ts`.
- `src/services/import.service.ts`: `export` `parseGroupName` only.
- `src/config/env.ts`: `LINK_SYNC_TOKEN?: string`; shorter than 32 characters counts as unset.

## 6. Identity and action log (decision 12)

### 6.1 Table (in `0017`)

```sql
create table if not exists link_log (
  id uuid primary key, at timestamptz not null default now(),
  user_id uuid not null, login text not null,             -- users.id + username snapshot; no FK
  device_id text, device_label text,                      -- yap_device_id / _deviceLabel()
  event text not null,                                    -- identity | checkIn | ... | cancel | undo
  leader_id uuid, leader_name text,                       -- "I am" at the time (after, for a switch)
  prev_leader_id uuid, prev_leader_name text,             -- before, for a switch
  target_kind text, target_id uuid, target_name text,     -- person / group / flowRow / action
  outbox_id uuid, outcome text not null                   -- saved | replay | duplicate | refused:<code> | cancelled | too-late | logged
);
create index if not exists link_log_at_idx on link_log(at);
alter table link_log enable row level security;
```

No note text, phone or address goes into the log. `target_name` is the person's or group's display name (admin-only
data).

### 6.2 Write points (all server-side, in `link.service`)

- Every batch item (§9.1): actions (`saved`, `replay`, `duplicate`, `refused:<CODE>`), `cancel`, `undo`, and
  `identity`. One `addLog` call per batch. (The single `POST /link/actions` / `DELETE /link/actions/:id` routes were
  removed, X14 / T-42.)
- **The "I am" switch:** the shared picker `setMyLeaderId()` (used by Home, My Students, Bus, link screens) queues an
  `identity` item `{ from, to, at }` whenever the value changes and `_linkOn()` is true. It goes up with the next
  flush. While the switch is Off nothing is logged (no link actions exist then).
- The device comes from the batch envelope (`device: { id, label }`).

### 6.3 Admin view and export (`link:admin`)

- `GET /link/admin/log?from=&to=&login=&event=` → newest first, max 2,000 rows.
- Elvanto link page → **Activity** card: date range (default the last 7 days), filters for login and event, a list
  (time, login, device, "I am", event, target, outcome). An identity row reads "Cody → Sam (iPhone · Safari)".
- **Export:** an `.xlsx` built in the browser with the vendored SheetJS (`_ensureXlsx()`), file
  `elvanto-activity-YYYY-MM-DD.xlsx`, one sheet with the same columns.

## 7. RBAC summary

| | admin | director | quad | grade | leader |
|---|---|---|---|---|---|
| `link:use` (check-in, actions, batch, lifegroups, flows, status) | yes | yes | yes | yes | yes |
| `link:admin` (matching, shadow check, log, `detail`, cancel anyone's) | yes | yes | – | – | – |

Shadow narrows both to admin. Lifegroups and flows are scoped (§8.2). The door list has no scope.

## 8. Services (lanes C and D)

### 8.1 `src/services/sync.service.ts` (lane C)

`makeSyncService({ link, settings, students, users })`. Called after the token check (§10.1).
- **Version:** read `contractVersion` from the raw body first. A number other than 1 → `LinkContractMismatch` (409).
  Missing or not a number, any Zod failure, an unknown `:kind` → `SyncValidation` (400). Nothing applied.
- `claim(body)`: mode `off` → `max = 0`. `link.claim(...)` with `cutoffDays: 3`, `leaseLostMs`. Build each
  `ClaimRow`: `by.login` = `users.email` of `createdBy`; `by.leaderName` = `leaderName`; `note` = the raw note
  (decrypted). Rows with `noteUnreadable` are left out. Reply `{ contractVersion: 1, serverTime, rows }`.
- `result(body)` → `link.applyResults(...)`.
- `push(kind, body)`: `groups` → set `grade`/`gender` with `parseGroupName(name)`; `roster` → after an applied push,
  `autoMatch` against `students.findAll()`, save, reply `{ applied, rows, matched: { auto, ambiguous } }`; else
  `{ applied, rows }`.
- **Never log a `/sync` body or the `Authorization` header** (notes come back decrypted).
- Tests `src/tests/sync.service.test.ts` replay the frozen fixtures: `push-roster.json` (reply parses with
  `PushResponse`); `claim-request.json` after one row per type (reply parses with `ClaimResponse`, each payload with
  `PAYLOAD_SCHEMAS[type]`, `note` is the raw note); `result-request.json` (each outcome per §3.3, reply parses with
  `ResultResponse`). Also: version 2 → 409 `expected: 1`; missing version → 400; mode `off` leases nothing; an
  unreadable note is refused and left out.

### 8.2 `src/services/link.service.ts` (lane D)

`makeLinkService({ link, settings, students, leaders, users, serviceSessions, serviceAttendance, limiter })`. Every
method first does `canUseLink` → 404 `MODULE_DISABLED` when false.

- `status(actor)` → contract §4 shape. Online = seen within `2 × pollSeconds + 60 s`; capabilities from the newest
  console; `consoles` = seen in the last 10 min.
- `checkin(actor, serviceTimeId?)` → `{ today, services: pickList, defaultServiceTimeId }` and, for one service,
  `people: [{ personId, name, grade, leader, checkedIn, action, mine }]`: roster `active` rows of kind
  `student` and `leader`, both genders, sorted by last then first name. **Name, grade and the Leader mark only**
  (decision 13; no gender, phone or student id). `action` = newest row for that person and service, any login's
  (`{ id, type, status, reason }`); `mine` = `createdBy === actor.id`. `checkedIn` from
  `effectiveCheckState`. All reads in one `Promise.all`.
  **Also `leaders` (leader quick check-in, decision 20).** `people` is not enough: it holds Elvanto roster
  leaders, not the app's Leader records, and nothing links the two (roster matching links students only). So the
  read (for one service) adds `leaders: [{ leaderId, name, personId, checkedIn, action, mine }]`: every
  **active** app `Leader`, A–Z by `fullName`. `personId` comes from a read-time name match (no new column, no
  migration): the folded, lower-cased `fullName` equals an active roster row's `first + ' ' + last` (prefer kind
  `leader`; genders must agree when both are known). Exactly one hit → that `personId`; none or several → `null`
  ("Not linked"). Linked leaders get `checkedIn`/`action`/`mine` exactly as in `people`. Name only.
- `enqueue` (private) — the one code path for batch `action` items:
  1. Rate limit: `limiter` = `RateLimiter(300, 10 min)` keyed by `actor.id`, one hit per item. Over →
     `refused:RATE_LIMITED` (the phone keeps it queued and retries later).
  2. Replay (same id, same type + payload) → `replay`; same id, other body → `LINK_ID_REUSED`.
  3. Capability `off` (newest console) → `LINK_UNAVAILABLE`.
  4. Type checks (contract §5.1 + §2.3, §2.4 of this spec); scope; `leaderId` rules (§2.2); note only on note types,
     ≤ 1,800.
  5. **Same-action dedupe (decision 18):** for `checkIn`/`checkOut`, if the person's newest non-cancelled,
     non-refused row for that service is the same type → `duplicate` with `existingId` (two phones, one Elvanto
     action). Reports and flow steps rely on the open-row index (same key = same group+date, same row).
  6. Insert (`student_id` from the roster match; `service_date` per contract §5.1). `LinkOpenDuplicate` →
     `duplicate` with `existingId`. Success → `saved`.
  `editReport`: `reportId` must be the group's last report (mirror, or the `report_id` of the newest `sent` submit);
  not `editable` → `LINK_EDIT_IN_ELVANTO` + `reason`; `base` must equal it; `date = base.date`.
- `cancel(actor, id)` / `undo(actor, id)`: allowed only for **the same login and the same "I am" leader**
  (`createdBy === actor.id` and `leaderId === item.leaderId`, null = null) **or `link:admin`**; else
  `LinkNotYours`. `cancel` → `cancelPending`; not pending → `too-late`. `undo` (check-ins only): pending → cancel;
  otherwise enqueue a `checkOut` for the same person and service (check-out has no owner rule) → `saved` with the
  new id. Both are logged.
- `listActions(actor, q)` → contract §4 shape. Non-admin callers get only rows they created (`createdBy = actor.id`);
  `detail` only for `link:admin`.
- `lifegroups(actor)` → groups in scope (`canAccessGrade` + `canAccessGender` on the parsed grade/gender; ungraded →
  director/admin): `groupId, name, meets, members, thisWeek, lastReport (no notes), defaultDate, openAction`.
  **Last-report overlay:** the newest `sent` submit with a `report_id` and `resultAt` later than the groups mirror's
  `takenAt` is the `lastReport` (`editable: true`, `blocked: null`).
- `flows(actor)` → rows in scope (`canAccessStudent` on the roster grade/gender of `personId`; unknown →
  director/admin), by flow then step order: `rowId, flowName, stepName, name, due, assignedTo, openAction`.
- `rosterForMatching` / `setMatch` (`link:admin`): contract §4; candidates = same name key or same last name, with
  name, grade, gender, DOB.
- `shadowCheck(actor, date)` (`link:admin`), check-ins only, **only for a date that has a `service_sessions` row**
  (else one line "Not in the import", e.g. Sundays). For `checkIn` rows that date with status `sent` or `shadowed`:
  `matched`, `sent-not-imported` ("In Elvanto; in YS attendance after the next import."), `practice-matched`,
  `practice-missing`, `no-student`; plus the count of imported attenders with no link row.
- `log(actor, q)` (`link:admin`) → §6.3.
- Tests `src/tests/link.service.test.ts`: the switch (off → 404 incl. admin routes; shadow → admin only; on → all);
  every enqueue outcome (replay, reuse, unavailable, rate-limited, duplicate by key, duplicate by same-action, saved);
  check-out after a pending and after a shadowed check-in is allowed; "I am" required for the three note types; the
  1,800 cap; cancel by another login or another "I am" → `LINK_NOT_YOURS`, by admin → ok; undo of a sent check-in
  enqueues a check-out; `listActions` scope; lifegroup and flow scope (junior `leader` sees none); the overlay;
  `editReport` checks; shadow-check verdicts and the no-session date; a log row per item, incl. identity.

## 9. App API additions (lane D logic, lane E routes)

### 9.1 `POST /link/batch` (decision 18; app-only, not `/sync`)

```json
{ "device": { "id": "…", "label": "iPhone · Safari" },
  "items": [
    { "kind": "action", "id": "…uuid…", "type": "checkIn", "payload": { "serviceTimeId": "…", "serviceId": "…", "personId": "…" },
      "note": null, "leaderId": "…" },
    { "kind": "cancel", "id": "…outbox id…", "leaderId": "…" },
    { "kind": "undo",   "id": "…outbox id…", "leaderId": "…", "newId": "…uuid for the check-out…" },
    { "kind": "identity", "id": "…uuid…", "at": "2026-10-16T08:31:02.120Z", "from": "…|null", "to": "…|null" }
  ] }
```
- 1–50 items, processed **in order, each on its own** (one failing item never stops the rest). `leaderId` in the
  envelope of each item is the "I am" at the time of the tap.
- HTTP 200 whenever the envelope is valid (400 `VALIDATION_ERROR` otherwise; 404 when the switch hides it).
- Reply, one per item, same order:
  `{ "results": [ { "id": "…", "kind": "action", "outcome": "saved" | "replay" | "duplicate" | "refused",
  "existingId"?: "…", "code"?: "LINK_UNAVAILABLE", "message"?: "…", "action"?: { "id", "type", "status", "reason" } } ] }`.
  `cancel` → `cancelled` | `too-late` | `refused` (`LINK_NOT_YOURS`); `undo` → `cancelled` | `saved` (with
  `action` = the new check-out) | `refused`; `identity` → `logged`.
- Refused codes the phone keeps and retries: `RATE_LIMITED` and transient DB errors (the whole call 503s; the phone
  retries the batch, ids make it safe). All other refusals are final; the row shows the reason.
- Route untimed? No: 50 items stay well inside 20 s. Keep the 20 s guard.

### 9.2 The phone queue (SPA, F1; used by every link screen)

- **Instant:** a tap updates the row at once (pending style, "Waiting to send"). It never waits for the network.
- **Persistent queue:** `localStorage['ysc.lkq.' + S.user.id]` (try/catch), items as §9.1 with client UUIDs
  (`crypto.randomUUID()`). Survives reload, closing the app, no signal.
- **Flush** (`_lkFlush()`, one at a time): right after a tap (debounced 300 ms), on `online`, on `visibilitychange`
  to visible, on every later tap, and every 15 s while items remain. Up to 50 per POST, 20 s client timeout. On
  network error: back off 5 s, 15 s, 45 s, then every 60 s. iOS has no SW Background Sync; don't use it.
- **Per-item reply:** `saved`/`replay` → the row takes the server status; `duplicate` → adopt `existingId` as that
  person's row and show its status (no error); final `refused` → the reason line; `RATE_LIMITED` → stay queued, toast
  "Too many taps. Wait a minute."
- **Undo:** tap again while the item is still in the phone queue → remove it locally (nothing sent). After it was
  sent → queue `undo` (check-ins) or `cancel` (reports, flow steps); `too-late` on a cancel → "Already sent. Do it in
  Elvanto." `LINK_NOT_YOURS` → that message.
- **Pill** at the top of each link screen: "3 waiting to send" (amber) / "All saved" (green, fades) / red "Not saved —
  tap to retry" after the 45 s back-off step fails.
- **Logout or "I am" switch with unsent items:** a confirm "3 check-ins haven't been sent yet. Send them now?" →
  flush (wait up to 10 s) → then continue. If the flush fails, a second confirm offers "Log out anyway (they'll be
  lost)" / Stay. Logout then clears the queue and `LINK` (phones are shared).
- **Roster cached per service:** `LINK.people[serviceTimeId]` (memory only; not localStorage — minors' names), from
  `GET /link/checkin` once per service, revalidated every 60 s. Search (any word order) and the grade filter run on
  the phone. A refresh merges: server rows win, except items still in the local queue stay on top until confirmed.
- **Reports and flow steps** use the same queue and the same pill (decision 18).

## 10. HTTP (lane E)

### 10.1 Routes

- `src/api/http/types.ts`: `Route.sync?: true`.
- `src/api/http/express-adapter.ts`: a `sync` route skips `resolveContext`, the must-change-password check and the
  login limiter. `LINK_SYNC_TOKEN` unset (or < 32 chars) → 503 `LINK_OFF`. The header must be exactly
  `Bearer <token>`; compare `timingSafeEqual(sha256(bearer), sha256(token))` on the **raw** strings (do not reuse
  `codeMatches`, which folds case and dashes) → else 401 `UNAUTHORIZED`. `ctx = null`. Nothing logs headers or
  `/sync` bodies. The 20 s guard stays.
- Controllers `src/api/controllers/link.controller.ts` and `sync.controller.ts`, registered in
  `src/api/http/router.ts`:

| Route | Auth |
|---|---|
| `POST /sync/claim`, `POST /sync/result`, `POST /sync/push/:kind` | `sync: true`, `auth: false` |
| `GET /link/status`, `GET /link/checkin`, `GET /link/actions`, `POST /link/batch`, `GET /link/lifegroups`, `GET /link/flows` | session |
| `GET /link/admin/roster`, `POST /link/admin/roster/:personId`, `GET /link/admin/shadow-check?date=`, `GET /link/admin/log` | session |

`/link/batch`, `/link/admin/shadow-check` and `/link/admin/log` are app-only additions (not in contract §4).

- **Route checklist (all three):** `router.ts`; `vercel.json` `routes[0].src` gets `link|sync`; `public/sw.js`
  `API_RE` gets `link|sync`, and **lane E bumps `CACHE` once** to the next free `ysc-vNN` at merge time. SPA lanes
  never touch `sw.js`.
- `src/container.ts`: build the link repo (Supabase or memory), wrap its mirror reads with `dedupeReads(link,
  'link', ['roster', 'services', 'groups', 'flows', 'mirrorState', 'listConsoles'])`, build both services and the
  limiter.
- `src/services/setup.service.ts`: row `link`, state `optional`: "Elvanto link token: set" / "not set" / "too short
  (32+ characters)". Never shows the value.

### 10.2 Tests (lane E)

`src/tests/link.routes.test.ts`: every `/link` route is `auth: true`; every `/sync` route `sync: true`; `link` and
`sync` in `vercel.json` and `sw.js` `API_RE`. A live-server block (`createApp(...).listen(0)` + `fetch`, as
`setup.routes.test.ts` does): no token → 503 `LINK_OFF`; wrong or lower-cased token → 401; `Bearer` missing → 401;
right token + `claim-request.json` → 200; `/link/status` with no session → 401 JSON; `/link/batch` with a mixed batch
→ one result per item. `src/tests/setup.service.test.ts`: the three token states.

## 11. SPA (lanes F1–F4, one at a time, `public/index.html` only)

Rules: `esc()` on every user value; no apostrophe inside a single-quoted string; no dark-mode rules;
`node scripts/check-spa-syntax.js` after every edit. One block `/* ── LINK MODULE ── */`, CSS `/* LINK CSS */`, state
object `LINK`, helpers `_lk*`.

### 11.1 F1: shared parts, the queue, the door

- `_linkOn()` = the same rule as `_nyOn()`. `moreItems()` gains, when `_linkOn()`: Check-in (`link-checkin`),
  Lifegroup report (`link-groups`; not for a junior `leader`), Flow steps (`link-flows`; not for a junior
  `leader`), and for admin/director Elvanto link (`link-admin`). Sub-pages (back arrow). We only add entries; the
  More menu belongs to the other instance.
- Youth Setup relabel (§2.1). `setMyLeaderId()` queues the identity item (§6.2). `doLogout()` runs the unsent-items
  guard (§9.2), then clears the queue and `LINK`.
- The queue, flush and pill (§9.2).
- **Banner** `_lkBanner(types)` from `GET /link/status` (60 s): offline → amber "The console was last seen 4:12 pm.
  Actions are queued, not in Elvanto yet. Use the kiosk too."; a type in `shadow` → grey "Practice mode: not sent to
  Elvanto. Check in the usual way."; `checkOut` `locked` → "This isn't connected yet. Do it in Elvanto." (for
  check-out); `off` → that action is hidden. Admin: "2 consoles are running" when `consoles > 1`.
- **Status lines** `_lkStatusText(row)`: the contract §5.3/§5.4 leader lines word for word, plus two app lines:
  queued on the phone → "Waiting to send."; mirror-only in (no row) → "In Elvanto."
- **Door screen** (mockup frame 1), modelled on the camp daily check-in:
  1. Pill + banner. 2. Service line "Fri 16 Oct · Youth 6:30 pm" + Change; no default → the "Pick a service" sheet
  opens first (frame 2). 3. "New person (first time here)" button. 4. Search + Grade select (All, 7–12, Leaders). No
  gender filter or colour. 5. Summary "In 84 · Still to come 212". 6. "Still to come": grade chip (neutral `--chip`)
  or a **"Leader"** chip, name, status line, **Check in**; tapping the row does the same. 7. "Checked in · 84"
  (collapsed `<details>`) with **Check out**; practice rows show the practice line. 8. A row whose newest action is
  mine (local or `mine: true`) shows **Undo**.
  Re-render keeps the scroll position (the camp `_rCheckin` lesson).
- **Leader quick check-in** (decision 20; mockup frame 3), modelled on the camp app's daily check-in list. A
  **"Check in leaders"** button on the door screen (under New person) opens a bottom sheet for the chosen service
  (same service pick; no default → the Pick a service sheet first). It lists `leaders` from the check-in read, name
  only, A–Z, each in one of three states:
  - **Done**: `checkedIn` (incl. practice or a queued tap): a green tick and its status line; no box.
  - **Not linked**: `personId` null: greyed, "Not linked"; no box.
  - **Tickable**: a tick box, unticked by default.
  **"Tick all"** at the top ticks every tickable row (it reads "Untick all" once all are ticked). A sticky
  **Submit (N)** (disabled at 0) queues one ordinary `checkIn` per ticked leader (`{ serviceTimeId, serviceId,
  personId }`, `leaderId` = the device's "I am" if set) through the phone queue and `/link/batch` (§9): instant,
  deduped by (person, service, type) on the server, logged per action (§6). The sheet closes; those leaders show as
  Done. Same switch, any login. No contract, fixture or Zod change.

### 11.2 F2: lifegroup report

- Groups in scope: name, `meets`, `thisWeek` chip (Reported / Did not meet / No report / Later / Can't read), open
  action status.
- Group page: **Last report** card (date, service, did-not-meet, guests, ticked members; never notes); **Edit** when
  `editable`, else "Edit this report in Elvanto."
- Form: date (default `defaultDate`; today−14 … today; fixed for an edit), "Group did not meet" (clears and hides ticks
  and service), member ticks (leaders marked), guests 0–99, service (default §2.3; pick list; "No service"; the
  older-than-7-days line), note (max 1,800, counter), "Keep notes private", the line "Elvanto will show: Self
  identified leader: <name>". No "I am" yet → the picker opens first. A date equal to the last report's date →
  "There's already a report for that date. Edit it." (no send).

### 11.3 F3: flow steps

By flow, then step: name, due (red when past), assigned to. Tap → sheet: note (max 1,800), "Keep note private", the
"Elvanto will show" line, "Completing may send this step's message.", **Complete** (needs "I am"). A row with an open
action can't be completed again.

### 11.4 F4: first-timer tick and the admin page

- **New person form:** when `_linkOn()`, a tick "Check them in to <service>" (on by default when §2.3 gives a
  default; else a service select). New person always sends for real (ledger 23: master `382a35b` removed the
  `ELVANTO_FORMS_LIVE` gate). After a send where the student form went (`sent` or `unconfirmed`), queue
  `firstTimerCheckIn` (first/last name, grade `'7'`…`'12'` → number, gender `f`/`m` → `female`/`male`) as normal,
  subject to the shared switch (`_linkOn`) and the console (`firstTimerCheckIn` not `off`). Skip it (with a note on
  the result page) when a name is over 60 characters. It goes through the queue, so it still sends if the host left
  the screen.
- **Elvanto link page** (`link:admin`), four cards: **Status** (consoles, last seen, version, window, each type's
  mode, mirror ages, today's counts by status, `unclear` rows with `detail`, and the line "The link screens share the
  New person switch. To stop all data flow, also Turn off the link on the console."); **Matching** (Unmatched / Two possible;
  candidates with DOB; Match / Not in YS / Clear); **Shadow check** (date, default last Friday); **Activity**
  (§6.3, with Export).

### 11.5 SPA tests

`src/tests/link.spa.test.ts` (extract-and-run, `src/tests/helpers/extract-fn.ts`): `_lkStatusText` for every status,
reason and the two app lines; `_linkOn` per mode and role; `moreItems()` per role and mode; the door row markup has
no gender word or gender class and shows "Leader"; the queue keeps items across a simulated reload, removes a
locally undone item, adopts `existingId` on `duplicate`, keeps `RATE_LIMITED` items; the logout guard fires with
unsent items; `setMyLeaderId` queues an identity item only when `_linkOn()`.

## 12. Lanes (for the planner)

| Lane | Files (only these) | Needs |
|---|---|---|
| **T** types | `src/core/link-types.ts`, `src/core/errors/link-errors.ts`, `src/core/errors/app-error.ts`, `src/api/middleware/error.middleware.ts` | — |
| **A** data | `supabase/migrations/0017_elvanto_link.sql`, the old draft path (pointer line), `src/core/schema-version.ts`, `src/tests/link-contract.test.ts` (SQL path only), `src/tests/migration-numbers.test.ts`, `src/repositories/interfaces/link.repository.ts`, `src/repositories/in-memory/link.repository.ts`, `src/repositories/supabase/supabase.link.ts`, `src/repositories/{interfaces,in-memory,supabase}/index.ts`, `src/tests/helpers/link-repo-suite.ts`, `src/tests/link.repository.test.ts`, `src/tests/link.repository.supabase.test.ts` | T; `applyOutcome` (B) for its tests |
| **B** rules | `src/services/link-rules.ts`, `src/services/access-control.ts`, `src/services/import.service.ts` (export only), `src/config/env.ts`, `src/tests/link-rules.test.ts`, `src/tests/access-control.test.ts` | T |
| **C** sync | `src/services/sync.service.ts`, `src/tests/sync.service.test.ts` | A, B |
| **D** link | `src/services/link.service.ts`, `src/tests/link.service.test.ts` | A, B |
| **E** HTTP | `src/api/http/types.ts`, `src/api/http/express-adapter.ts`, `src/api/http/router.ts`, `src/api/controllers/link.controller.ts`, `src/api/controllers/sync.controller.ts`, `src/container.ts`, `src/services/setup.service.ts`, `vercel.json`, `public/sw.js`, `src/tests/link.routes.test.ts`, `src/tests/setup.service.test.ts` | C, D |
| **F1→F4** SPA | `public/index.html`, `src/tests/link.spa.test.ts` (one lane at a time) | this spec's shapes |

No file is in two lanes. Waves: **0** = T · **1** = A ∥ B · **2** = C ∥ D ∥ F1 · **3** = E ∥ F2 · then F3, F4 ·
**4** = orchestrator: the §13 run, `link.repository.supabase.test.ts` against a scratch branch, `CLAUDE.md` section
"Elvanto link (app side)", ledger. Rebase on the rework before wave 0 if it has landed (it touches
`access-control.ts`, `public/index.html`, `sw.js`, migrations). Every lane ends with
`npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`, commits with explicit paths, never pushes.

## 13. End-to-end test without prod

On the PC (Windows, where the console runs), in PowerShell, use `start` (a `tsx watch` restart would wipe the memory
outbox mid-test):

```powershell
$env:PERSISTENCE='memory'; $env:LINK_SYNC_TOKEN='<32+ random chars>'; $env:PORT='4300'; npm run start
```

1. Log in as `admin` / `demo1234`. Youth Setup → Elvanto features → **Shadow mode**.
2. Point the console at `http://localhost:4300` with the same token; all types `shadow`.
3. Check: `/link/status` shows the console; the four mirrors arrive; matching lists roster people (seed students are
   fake, so most are unmatched: expected); a check-in, a check-out of that check-in, a report, a flow tick and a
   first-timer each reach `shadowed` (check-out may be `refused`, `locked`); the Activity log shows each, and an
   "I am" switch. New person always sends for real: use a real first-timer, or delete the test submission in Elvanto
   afterwards. Never use a made-up person.
4. Turn Wi-Fi off on the phone, tap three check-ins, turn it on: the pill goes "3 waiting" → "All saved".
5. Real Elvanto data then sits in that local memory process only; nothing is written to disk or committed.

## 14. Console-side change and contract deviations

**Attribution (ledger 25 D2, contract X1; reverses decision 17):** the APP builds
`Self identified leader: <leaderName> — <note>` (or the name alone) in the `/sync/claim` row for `submitReport`,
`editReport` and `completeStep`. The console sends `note` as received and adds nothing; an edit appends it after
Elvanto's existing notes. The stored note stays the leader's own words, capped at enqueue so the prefixed text fits
1,900. The 2,000-character `note-too-long` check counts the whole text.

App-side deviations from the contract prose (no schema or fixture change): `modules.elvantoLink` not built (one
switch); `leaderId` required for the three note types; check-out also allowed after a pending/shadowed check-in
(§2.4); same-action dedupe and `/link/batch`, `/link/admin/shadow-check`, `/link/admin/log` added; `report_id` and
`link_log` added in `0017`.

## 15. Handoff (operator, in order)

1. **Merge order:** rework (`0016`) first, then this branch (`0017`). Preview builds never migrate. Merging to
   `master` migrates prod at build time (additive, safe); read back `Database up to date — …` naming `0017` before
   promoting.
2. **Token:** `LINK_SYNC_TOKEN` (32+ random chars) in Vercel **Production**; redeploy; promote. Same value in the
   console's Credential Manager entry. `curl -s -X POST https://ys-connection.vercel.app/sync/claim` → JSON 401;
   `curl -s https://ys-connection.vercel.app/link/status` → JSON 401. Admin → System check: "token: set".
3. **Tell the console orchestrator** about §14 (signature wording).
4. **Shadow mode + matching:** switch = Shadow; the console pushes the roster; the admin matches people on the
   Elvanto link page.
5. **Shadow Friday:** console types all `shadow`. The admin, at the door next to the kiosk, checks people in and out,
   adds a first-timer, submits a report, ticks a step. New person always sends for real: use a real first-timer, or
   delete the test submission in Elvanto afterwards. After the 21:00 export/import: Shadow check for that Friday
   (expect `practice-matched`), and look over the Activity log.
6. **Go live one type at a time, on the console:** reports, then flows, then check-in. The operator makes each type's
   first live send while the app is still in Shadow.
7. **Switch On.** Every login sees the screens. Watch the first live Friday's `unclear`/`refused` rows.
8. Stop button: switch **Off** (screens gone, nothing claimed; queued rows wait or expire after 3 days). Pushes keep
   applying while the switch is Off (a stale or empty roster on the next switch-on would break the door list, and the
   data is the same minimal set either way). The link screens share the New person switch. To stop all data flow,
   also Turn off the link on the console.

## 16. Open questions

None blocking. (Rev 1's three were decided: "I am" required = decision 11; push cadence = decision 16; leaders on the
door list, marked "Leader" = decision 13.)

## 17. Review resolution

| Item | Resolution |
|---|---|
| I1 attribution | **Superseded** by ledger 25 D2 (contract X1): the app prefixes `Self identified leader: <name> — <note>` in the claim row; the console adds nothing (§14) |
| I2 matching while Off | Matching happens in Shadow; Off hides everything (§2.1, §15 step 4) |
| I3 check-out after pending/shadowed | Allowed (§2.4); tests in §8.2 |
| I4 first-timer in dry run | **Superseded** (ledger 23): New person always sends for real; the first-timer is queued after every send where the student form went (§11.4) |
| I5 lane circle / shared types | Lane T, wave 0, exact types (§3); index files named (§4.1) |
| I6 migration number / hazard | `0017` now; hazard rewritten; duplicate-number test (§2.5, §15) |
| I7 mirror vs `sent` | `sent` wins only until a newer services push (§5.2) |
| I8 Supabase repo tests | Shared suite, scratch-branch run, decrypt hook, SQL-text tests (§4.2) |
| I9 rate limit / cancel | 600 per 10 min per login, new inserts only (replays and duplicates never count; B12); cancel same login + same "I am" or admin, logged (§8.2) |
| Decision 12 log | `link_log` in `0017`, write points, admin view, xlsx (§6) |
| Decision 18 queue | Phone queue, `/link/batch`, per-item reply, same-action dedupe (§9, §8.2) |
| Decision 20 leader quick check-in | `leaders` added to the check-in read (read-time name match, no migration); sheet with Tick all + sticky Submit (N) (§8.2, §11.1) |
| Decision 13 leaders | "Leader" chip on the door list (§8.2, §11.1) |
| M1 token compare | Raw strings, exact `Bearer`, never logged (§10.1) |
| M2 missing version | Missing → 400, wrong → 409; all `/sync` errors `VALIDATION_ERROR` (§8.1) |
| M3 `users` dep, `leader_name` | Added; fallback = login display name (§2.2, §8.1) |
| M4 `leaderId` required | Listed as a deviation (§14) |
| M5 report service > 7 days | Form line + server checks `link_services` (§2.3) |
| M6 `LINK_DUPLICATE` in SPA | `duplicate` adopts `existingId` (§9.2) |
| M7 "my own row" | `mine` field + local queue; cleared on logout (§8.2, §9.2) |
| M8 mockup strings | Two app lines defined; mockup matches (§11.1) |
| M9 `listActions` scope | Non-admin: own rows only (§8.2) |
| M10 draft SQL edit | Byte-for-byte + appended statements; exactly one glob match; pointer file (§2.5) |
| M11 retention | Purge in the claim (§4.3) |
| M12 shadow check Sundays | Only dates with a session (§8.2) |
| M13 `modeAllows`, item 8 | `canUseLink` on `modeAllows`; item 8 is the rework's (§1, §2.1) |
| M14 polling load | `Promise.all`, `dedupeReads`, stop when hidden (§2.4, §8.2, §10.1) |
| M15 §10 practicalities | PowerShell, `npm run start`, 60-char name check (§13, §11.4) |
| Checklist: setup test file, retry lease | `setup.service.test.ts` named; `retry` clears the lease (§10.2, §5.2) |
| Checklist: console upsert in claim | Done in the claim's one transaction (§4.1) |
| Deferred | None |
