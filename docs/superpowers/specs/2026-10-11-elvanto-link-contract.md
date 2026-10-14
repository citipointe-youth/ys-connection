# YS Connection ↔ Elvanto Sync Console link — step 0 contract

Date: 2026-10-11. Status: spec (step 0 of the link), review fixes applied
(`C:\Users\ThomasPC\src\link-run\spec-review.md`). Amended in place 2026-10-12 (brief decisions 9–13: service choice,
past-service check-ins, check-out on, §12 answers), and again 2026-10-12 with the cross-device triage's text-only change set
X1–X17 (no fixture, schema, `/sync/*` shape, reason code or status changes). v1 was never released, so `contractVersion` stays `1`.
**X18 (2026-10-13, UX batch T6):** two new action types `addGroupMember` / `removeGroupMember`, two optional capability
keys, reason codes `group-unknown` and `leader-member`, `LINK_REV` 3. Optional additions only, so `contractVersion`
stays `1` (see §5.6).
**X19 (2026-10-13, UX batch T4):** youth intake + consents in the app (admin only). Four action types `intakeAnswer`,
`intakeSave`, `consentSave`, `intakeText`; push kinds `intakePlan` / `consentPlan`; outcome `planned`; optional
`steps` / `stop` on result items; reasons `needs-you`, `plan-changed`, `saved-before`, `chain-not-done`, `bad-answer`;
four optional capability keys; an optional claim-reply `intake` hint; `LINK_REV` 4. Optional additions only, so
`contractVersion` stays `1` (see §5.7). Design: Project 13 `ys-connection/2026-10-13-intake-consent-app-spec.md`.
Run brief: `C:\Users\ThomasPC\src\link-run\brief.md` (binding).
Repos: YS Connection branch `feature/elvanto-link-contract`; Elvanto Sync Console (Project 11.1) branch
`feature/ys-link-contract`.

**This repo is public.** This spec, the fixtures and the tests hold no tenant URL, no real names and no real ids.

## 1. Goal and shape

Leaders act in YS Connection (the app). The console (Project 11.1, a local Windows host) is the only thing that talks to
Elvanto.

```
 leader phone ──/link/*──▶ YS Connection (Vercel + Supabase) ◀──/sync/*── console (Windows, Playwright) ──▶ Elvanto
                            link_outbox  (UP: one row per action)     claim → run 11.1 writer → result
                            link_* mirrors (DOWN: pushed by console)  push roster/services/groups/flows
```

- **UP:** the app writes one `link_outbox` row per leader action. The console polls, leases rows, runs the existing
  Interact writer, and reports a result. The app shows the result to the leader.
- **DOWN:** the console reads Elvanto and pushes small mirror tables. The app never calls Elvanto and holds no Elvanto
  credential. The console holds no database credential.
- **Auth:** the console uses one sync token (env var). Leaders use their normal session. RBAC and validation stay in
  the app; Elvanto safety rules (read first, sent-log, refusals) stay in the console.

### 1.1 Decisions adopted

All operator decisions in the brief are binding. Every controller default is adopted. This spec adds:

| Topic | Decision |
|---|---|
| Migration | Step 0 writes a **draft** only: `docs/superpowers/specs/2026-10-11-elvanto-link-0016.draft.sql`. It is outside `supabase/migrations/`, so no build applies it and `LATEST_MIGRATION` stays `'0015'`. The YS stream's first feature commit moves it into `migrations/` under the next free number (`0016` today) and bumps the constant. |
| Heartbeat | The claim call is the heartbeat. A console with nothing to do still claims every poll. |
| Chunking | None. The largest push (roster, ~600 rows) is ~100 KB. Zod caps a push at 5,000 rows (Vercel's body limit is 4.5 MB). |
| Free text | Leader notes live in one encrypted column (`link_outbox.note`). `payload` holds ids and small values only. |
| Report notes | Never pushed down. An edit keeps Elvanto's notes and appends the leader's new note. |
| Check-out | **On in v1** (decision 10). No writer exists in 11.1 yet; it is built after one capture (§5.5). Until then the console reports `checkOut` as `locked`, then `shadow`, then `live`. |
| Which service | The app picks the service and sends `serviceTimeId` in the payload (decision 11, §5.5). The console never chooses one. |
| Room | The app does not pick a room. The console picks it by roster `kind` (§5.2). |
| "Today" | One helper, `brisbaneToday()`: Brisbane = UTC+10, no DST (as `sent-log.js` does). Used for `service_date`, "today" checks and the cut-off. Vercel runs in UTC. |
| Two prefixes | `/sync/*` (console, sync token) and `/link/*` (leaders, session). |

## 2. Data model

The full SQL is the draft file above. All tables are new. **No foreign key to `students`, `leaders`, `users` or the
service/lifegroup tables** (Bus pattern, `0011`): Full Reset and the weekly import must never touch link rows. RLS is
on for every table.

### 2.1 `link_outbox` — one row per leader action (UP)

| Column | Notes |
|---|---|
| `id uuid` PK | Made on the phone. The idempotency key. |
| `type` | `checkIn`, `checkOut`, `submitReport`, `editReport`, `completeStep`, `firstTimerCheckIn`. |
| `payload jsonb` | Typed per type (§5.1). Ids and small values only. Write via `sql.json(v)`. |
| `note text` | **Encrypted** (`maybeEncrypt(v, 'link_outbox.note:'+id)`). ≤ 1,900 chars. |
| `dedupe_key` | Per type (§5.1). A partial unique index blocks a second open row. |
| `service_date date` | Brisbane date the action belongs to (server clock). |
| `student_id`, `person_id` | App student (from the roster match at enqueue) and Elvanto person. `person_id` is null for `firstTimerCheckIn` until the console reports it. |
| `created_by` | `users.id` of the login. The login name is joined from `users.email` at read time. |
| `leader_id`, `leader_name` | Self-identified leader (unverified) and a name snapshot (else the login's display name). |
| `status` | `pending`, `claimed`, `sent`, `refused`, `unclear`, `shadowed`, `cancelled`. |
| `reason`, `detail` | Stable code (§5.4) and the console's PII-free sentence. `sent` + `reason = 'already'` = Elvanto already had it. |
| `attempts`, `retry_at` | +1 per claim; not claimable before `retry_at`. |
| `lease_owner`, `lease_until` | Console holding the lease; DB clock. |
| `result_at` | When the result arrived. Shown to the leader as the save time. |
| `sent_log_key` | The 11.1 sent-log key (in shadow: the key it would use). |
| `created_at`, `updated_at` | |

Indexes: unique `dedupe_key` where status in (`pending`, `claimed`, `unclear`); the claim scan on `created_at` where
status in (`pending`, `claimed`); `service_date`.

### 2.2 Mirrors (DOWN)

| Table | Key | Columns | Replace rule |
|---|---|---|---|
| `link_roster` | `person_id` | `first_name`, `last_name`, `gender`, `grade`, `kind` (`student`/`leader`/`other`), `active`, `student_id` (unique), `match` (`auto`/`manual`/`none`/`ambiguous`/`ignored`) | Upsert by `person_id`. Missing from a push → `active = false`. **A push never writes `student_id` or `match`.** |
| `link_services` | `service_time_id` | `service_id`, `name`, `starts_at`, `ymd`, `rooms` (`[{id,name}]`), `checked_in` (`[{personId,roomId}]`) | Full replace (the past 7 days + the next 7 days, Brisbane dates; incl. the Sunday 10:15 Connect). |
| `link_groups` | `group_id` | `name`, `grade`, `gender`, `meets`, `members` (`[{personId,name,leader}]`), `this_week`, `last_report` (§3.4) | Full replace (YS lifegroups only). `grade`/`gender` are set **by the app** from the name with `parseGroupName` (`import.service.ts`, to be exported) — the same rule the app's lifegroup stats use. |
| `link_flow_people` | `row_id` | `flow_id`, `flow_name`, `step_id`, `step_name`, `step_order`, `person_id` (null if unresolved), `name`, `due`, `assigned_to` | Full replace (configured flows only). |

No phone, email, address, date of birth, note text, form answer or pick-up code is mirrored.

### 2.3 Sync state

| Table | Key | Columns |
|---|---|---|
| `link_console` | `console_id` | `label`, `last_seen_at`, `contract_version`, `console_version`, `in_window`, `poll_seconds`, `capabilities` (`{type: 'live'\|'shadow'\|'locked'\|'off'}`) |
| `link_mirror_state` | `kind` | `taken_at`, `console_id`, `row_count`, `applied_at` |

"Console last seen" = `max(last_seen_at)`. Online = seen within `2 × poll_seconds + 60 s`. Capabilities shown to
leaders come from the console with the latest `last_seen_at`.

### 2.4 Gotchas the later streams must keep

- **jsonb:** write with `this.sql.json(v)`, never `${JSON.stringify(v)}::jsonb` (CLAUDE.md "jsonb double-encoding").
- **Encryption:** only `supabase.*` repos encrypt. Decrypt `note` **per row**: a row that fails to decrypt is set
  `refused`, `note-unreadable` and left out of the claim batch (one bad row must not stop the queue).
- **RLS:** every new table gets `enable row level security` in the same file (the step 0 test checks this by rule).
- **Bulk writes:** `src/repositories/supabase/bulk.ts` `chunk()` inside one `sql.begin`.
- **Memory mode:** an in-memory repo mirrors the Supabase one.

## 3. Console API `/sync/*`

**Base address (X15).** The app is served at its host root. The console calls `<origin>/sync/<path>`, whatever path the
saved address holds.

### 3.1 Auth and errors

- Header `Authorization: Bearer <token>`. The app compares SHA-256 digests with `crypto.timingSafeEqual` (the
  `setup.service.ts` pattern) against `LINK_SYNC_TOKEN`. No rate limiting: a 32+ char random token cannot be guessed,
  and revocation is the control.
- Route table: add `sync?: true` to `Route` (`src/api/http/types.ts`). In `express-adapter.ts`, a `sync` route skips
  `resolveContext` and checks the token instead (`ctx = null`, `auth: false`).
- Every body carries `contractVersion` (`1`) and `consoleId` (a UUID the console makes once and keeps).
- All `/sync` routes are `POST` (the route table has no `PUT`).
- Error bodies are `{ code, message }` today (`sendError`). Add an optional `extra` object to `AppError` that
  `sendError` spreads, for `expected` (below) and `existingId`/`reason` (§4.1).

| HTTP | `code` | When | Console does |
|---|---|---|---|
| 401 | `UNAUTHORIZED` | Missing or wrong token | Stop polling. Toast "YS link token rejected" (no PII). Re-read the token once. |
| 503 | `LINK_OFF` | `LINK_SYNC_TOKEN` unset | Idle, retry in 15 min. |
| 409 | `LINK_CONTRACT_MISMATCH` | `contractVersion` ≠ the app's | Stop. Toast. Body has `expected`. |
| 400 | `VALIDATION_ERROR` | Envelope or a row fails Zod (incl. > 5,000 rows) | Alert. Nothing was applied. |
| 503 | existing transient codes | DB hiccup | Back off 1, 2, 4 … 15 min. |

**Errors (X15).** The console already treats a 500 like a 503 and backs off. The app will answer deadlock,
serialisation and statement-timeout errors with 503. That is deferred with T-25 (D4), so until then they can arrive as
a raw 500, which the console also backs off on.

### 3.2 `POST /sync/claim` (lease + heartbeat)

Request:
```json
{
  "contractVersion": 1,
  "consoleId": "8f5a1c2e-0000-4000-8000-000000000001",
  "consoleLabel": "laptop",
  "consoleVersion": "11.1@185d8d6",
  "inWindow": true,
  "pollSeconds": 60,
  "capabilities": { "checkIn": "shadow", "checkOut": "locked", "submitReport": "shadow",
                    "editReport": "shadow", "completeStep": "shadow", "firstTimerCheckIn": "shadow" },
  "max": 3,
  "leaseSeconds": 180
}
```
`max` 0–20 (default 3; `0` = heartbeat only, sent while the Friday sync holds `run.lock`). `leaseSeconds` 30–600.

Server, in one transaction:
1. Upsert `link_console` (heartbeat fields, `last_seen_at = now()`).
2. **Sweep** (whichever console polls): `pending` rows with `created_at` older than the cut-off (3 days, §12 Q1) →
   `refused`, `too-old`. `claimed` rows whose lease expired more than 1 h ago → `unclear`, `lease-lost` (they may have
   been sent; the operator resolves them as usual). **X6:** the sweep's `lease-lost` step skips rows whose `lease_owner`
   is the console making the claim. That console reclaims them instead (same console only, as now).
3. Lease up to `max` rows of types whose capability is not `off` (`locked` rows are claimed and answered `refused`,
   `locked`), oldest first, `for update skip locked`:
   `pending` with `retry_at` null or ≤ now, or `claimed` with `lease_until` < now and `lease_owner = consoleId`
   (**reclaim: same console only**). Set `claimed`, `lease_owner`, `lease_until`, `attempts + 1`.

Response 200:
```json
{
  "contractVersion": 1,
  "serverTime": "2026-10-16T08:31:02.120Z",
  "rows": [
    { "id": "…", "type": "checkIn", "attempts": 1, "reclaimed": false,
      "createdAt": "2026-10-16T08:30:55.000Z", "serviceDate": "2026-10-16",
      "by": { "login": "grade8b", "leaderName": "Test Leader" },
      "payload": { "serviceTimeId": "…", "serviceId": "…", "personId": "…" },
      "note": null }
  ]
}
```
`note` is decrypted here (TLS only). `note` is the text to write, not only the leader's own words (X1, §7.1). The
console claims again at once when `rows.length === max`, and drops any reclaimed id it is still working on.

**Paused (X14).** A heartbeat with `inWindow: true` and `max: 0` means paused for the weekly sync. The app then shows
"Paused for the weekly sync. Check-ins go through after it." Outside the window, a pending row adds "Goes to Elvanto
within 15 minutes."

**Reclaimed rows (X6).** On a reclaimed row the console reads its sent-log first. `confirmed` (or resolved as landed) →
`sent`, with that line's key as `sentLogKey`, and for a first-timer the `personId` taken from that key. `pending` or
`not-confirmed` → `unclear`. No line → run normally. Before it runs any row that has no sent-log line, the console
refuses `too-old` if `createdAt` is past the 3-day cut-off. The rows of one claim run in the order given. The one
exception: first-timer rows may run after the others. If a claim reply comes after the console's timeout, its rows stay
leased until the lease ends, and the next claim reclaims them (accepted).

### 3.3 `POST /sync/result`

The console reports **each row as soon as it finishes** (up to 20 per call).

```json
{ "contractVersion": 1, "consoleId": "…", "results": [
  { "id": "…", "outcome": "sent", "sentLogKey": "checkIn:service:…:…" },
  { "id": "…", "outcome": "sent", "sentLogKey": "submitReport:lifegroup:…:20261016", "reportId": "…" },
  { "id": "…", "outcome": "sent", "sentLogKey": "checkIn:service:…:…", "personId": "…" },
  { "id": "…", "outcome": "already" },
  { "id": "…", "outcome": "refused", "reason": "report-exists", "detail": "There's already a report for that date. Edit it instead." },
  { "id": "…", "outcome": "unclear", "sentLogKey": "…", "detail": "Elvanto may not have saved this." },
  { "id": "…", "outcome": "retry", "retrySeconds": 300, "reason": "awaiting-approval" },
  { "id": "…", "outcome": "shadowed", "sentLogKey": "checkIn:service:…:…" },
  { "id": "…", "outcome": "resolved", "landed": true }
] }
```

| `outcome` | From | To | Required |
|---|---|---|---|
| `sent` | `claimed` | `sent` | `sentLogKey`; `reportId` for `submitReport` when known (X5); `personId` for `firstTimerCheckIn` |
| `already` | `claimed` | `sent`, `reason = 'already'` | — |
| `refused` | `claimed` | `refused` | `reason` |
| `unclear` | `claimed` | `unclear` | `sentLogKey` |
| `retry` | `claimed` | `pending`, `retry_at = now + retrySeconds` (60–3600) | `reason` (`console-busy`, `awaiting-approval`, `console-cannot-read`); `awaiting-approval` retries every 300 s in the window and every 900 s outside it (X7) |
| `shadowed` | `claimed` | `shadowed` | `sentLogKey` (the key it would use) |
| `resolved` | `unclear` (**any console**) | `landed: true` → `sent`, `reason` and `detail` null; `false` → `refused`, `not-landed`, `detail` null | `landed` |

**Resolved and ids (X5).** `resolved` with `landed: true` → `sent`, with `reason` and `detail` set to null. With
`landed: false` → `refused`, `not-landed`, and `detail` set to null. `already` and `resolved` carry no ids. A
`submitReport` settled by `resolved` or by a reclaim (X6) may have no `reportId`. It gets one from the next `groups`
push (the "required" above becomes "when known"). A first-timer answered `already` (the kiosk got there first) keeps
`personId` null.

A result for a `claimed` row is accepted while `lease_owner = consoleId`, **expired or not**. Anything else →
`ignored`. Response 200 (valid envelope): `{ "applied": ["…"], "ignored": [{ "id": "…", "why": "already-final" }] }`,
`why` ∈ `unknown-id`, `not-leased`, `already-final`, `bad-transition`.

**Idempotency:** the same outcome again for a row already in that final state → `already-final` (not an error). A row
is never re-sent because a result call failed: the console retries unreported results; after a crash it reclaims the
row and asks its own sent-log first (§8.3).

### 3.4 `POST /sync/push/:kind` — `roster`, `services`, `groups`, `flows`

Envelope: `{ "contractVersion": 1, "consoleId": "…", "takenAt": "2026-10-16T08:30:00.000Z", "rows": [ … ] }`

| Kind | Row |
|---|---|
| `roster` | `{ personId, firstName, lastName, gender: "male"\|"female"\|null, grade: 7–12\|null, kind: "student"\|"leader"\|"other" }` |
| `services` | `{ serviceTimeId, serviceId, name, startsAt, ymd, rooms: [{ id, name }], checkedIn: [{ personId, roomId }] }` |
| `groups` | `{ groupId, name, meets, members: [{ personId, name, leader }], thisWeek: "reported"\|"did-not-meet"\|"none"\|"later"\|"unreadable", lastReport: null \| { reportId, date, time, didNotMeet, attendees: [uuid], guests, serviceTimeId\|null, editable, blocked: reason\|null } }` |
| `flows` | `{ rowId, flowId, flowName, stepId, stepName, stepOrder, personId\|null, name, due\|null, assignedTo }` |

Rules:
- One push = the whole kind, in one transaction. One bad row rejects the push (400).
- **X10:** `rows: []` is a valid full replace and means "none now". The console sends it once when the flow list goes
  from some rows to none. People checked in to "No room" are not in `services.checkedIn`.
- **Order:** `takenAt` equal to or older than the stored one → 200 `{ "applied": false }`. Otherwise apply and store
  `link_mirror_state`.
- `roster` runs the auto-match (§6) after the upsert. Response: `{ "applied": true, "rows": 612, "matched": { "auto": 3, "ambiguous": 1 } }`
  (`matched` only for `roster`).
- `lastReport.editable` comes from the edit form the console already reads: `false` with `blocked` =
  `multi-service`, `unkept-notes` or `member-left` (the `reportRead` checks). `service-not-offered` is known only at
  send time.

## 4. App API `/link/*` (leaders)

Session auth. **X14:** the link screens stay under the New person switch (`newYouthForms`, D1 decided 2026-10-12), not a
separate `modules.elvantoLink`; revisit before leaders get access. Off → `ModuleDisabledError` 404.
Two new RBAC actions in `access-control.ts`: `link:use` (all five roles) and `link:admin` (director, admin).

| Method + path | Action | Returns |
|---|---|---|
| `GET /link/status` | `link:use` | `{ console: { lastSeenAt, online, inWindow, pollSeconds, capabilities, consoles: n }, mirrors: { roster: { takenAt }, … } }` |
| `GET /link/checkin?serviceTime=<uuid>` | `link:use` | The pick list (mirror services with `ymd` from today−7 to today, newest first; the default marked, §5.5); for one service: `people: [{ personId, name, grade, checkedIn, action: { id, type, status, reason } \| null }]` — roster `student` + `leader`, both genders, **name + grade only** |
| `POST /link/batch` | `link:use` | Per-item results (§4.1). **X14:** `/link/batch` replaces the single `POST /link/actions` and `DELETE /link/actions/:id` routes (removed). |
| `GET /link/actions?ids=…` or `?serviceDate=&type=` | `link:use` | `[{ id, type, status, reason, detail?, createdAt, resultAt, leaderName, login, hasNote }]` (`detail` for `link:admin` only) |
| `GET /link/lifegroups` | `link:use` | Groups in scope: `name`, `meets`, `members` (name, leader), `thisWeek`, `lastReport` (no notes), open actions |
| `GET /link/flows` | `link:use` | Flow people in scope: `flowName`, `stepName`, `name`, `due`, `assignedTo`, open action |
| `GET /link/admin/roster?match=none\|ambiguous` | `link:admin` | Roster rows + candidate students (name, grade, gender, DOB from `students`) |
| `POST /link/admin/roster/:personId` | `link:admin` | `{ studentId: uuid \| null, ignore?: true }` → `manual` / `none` / `ignored` |

Scope: check-in has none (operator decision 4). Lifegroups: `canAccessGrade` on the group grade plus
`canAccessGender` on its gender; ungraded groups → director/admin. Flows: `canAccessStudent` on the roster grade/gender
of `personId`; unknown → director/admin. The junior `leader` role gets check-in only (`canAccessGrade` is false for
it, so lifegroups and flows are empty); the role is off by default.

**Route checklist (all three, CLAUDE.md):** add `link` and `sync` to `src/api/http/router.ts`, the `vercel.json`
`routes[0].src` regex and `public/sw.js` `API_RE`; bump the `sw.js` `CACHE`; add a `link.routes.test.ts` like
`bus.routes.test.ts`; after deploy, `curl` each prefix unauthenticated (expect JSON 401).

### 4.1 One action item in `POST /link/batch`

Each action item in a `/link/batch` call (X14) is checked as below. A cancel item is one
`update … where id = $1 and status = 'pending'` → `cancelled`; 0 rows → `LINK_TOO_LATE`.

```json
{ "id": "…uuid made on the phone…", "type": "submitReport",
  "payload": { "groupId": "…", "date": "2026-10-16", "didNotMeet": false, "attendees": ["…"], "guests": 2, "notesPrivate": false,
               "serviceTimeId": "…" },
  "note": "Good night, talked about …", "leaderId": "…" }
```

Checked in this order:

| Result | HTTP | `code` |
|---|---|---|
| Same `id` already stored, same `type` + payload (jsonb `=`) | 200 | — (replay; returns the row) |
| Same `id`, different body | 409 | `LINK_ID_REUSED` |
| Capability `off` (from the latest console; none seen yet → allowed, and the banner says "console not seen"). `locked`, `shadow` and `live` are allowed | 409 | `LINK_UNAVAILABLE` ("Do this in Elvanto for now.") |
| Edit of a non-editable last report | 409 | `LINK_EDIT_IN_ELVANTO` + `reason` |
| Bad payload / scope | 400 / 403 | `VALIDATION_ERROR` / `FORBIDDEN` |
| Insert hits `link_outbox_open_uq` (Postgres 23505) | 409 | `LINK_DUPLICATE` + `existingId` |
| Created | 201 | — |

`leaderId` is optional; the server snapshots `leader_name`. The SPA reuses the Bus "I am" choice for the device.

## 5. Action types

### 5.1 Payloads (Zod in `src/core/link-contract.ts`)

All ids are lower-case UUIDs. Dates are `YYYY-MM-DD` (Brisbane).

| `type` | `payload` | `note` | `dedupe_key` | App checks at enqueue |
|---|---|---|---|---|
| `checkIn` | `{ serviceTimeId, serviceId, personId }` | none | `checkIn:<st>:<person>` | service in the pick list (`link_services`, `ymd` from today−7 to today); person `active` |
| `checkOut` | `{ serviceTimeId, personId }` | none | `checkOut:<st>:<person>` | as above, and checked in to that service (mirror or a `sent` check-in) |
| `submitReport` | `{ groupId, date, didNotMeet, attendees: [uuid], guests: 0–99, notesPrivate, serviceTimeId: uuid\|null }` | optional | `report:<group>:<date>` | group in scope; date ≤ today and ≥ today−14; attendees ⊆ members; `didNotMeet` ⇒ no attendees and `serviceTimeId` null; `serviceTimeId` null or in `link_services` |
| `editReport` | `{ groupId, reportId, date, didNotMeet, attendees, guests, notesPrivate, serviceTimeId, base: { date, didNotMeet, attendees, guests, serviceTimeId } }` | optional, **appended** | `report:<group>:<date>` | `reportId` = the group's last report (mirror, or the `reportId` of this group's latest `sent` submit); `editable`; `base` = that report; `serviceTimeId` = `base.serviceTimeId` (kept) unless the leader picked another (null or in `link_services`) |
| `completeStep` | `{ rowId, flowId, stepId, personId\|null, notePrivate }` | optional | `complete:<row>` | row in `link_flow_people`, in scope |
| `firstTimerCheckIn` | `{ serviceTimeId, serviceId, firstName, lastName, grade: 7–12\|null, gender: "male"\|"female" }` | none | `first:<st>:<lower first last>` | service in the pick list (default today's); names 1–60 chars |
| `addGroupMember` (X18) | `{ groupId, personId }` | none | `addMember:<group>:<person>` | group in scope; admin, director, or the "I am" leader leads the group; person an active roster row (not `other`) in scope; not a member now |
| `removeGroupMember` (X18) | `{ groupId, personId }` | none | `removeMember:<group>:<person>` | as above; a member now and not a leader of the group |

`service_date` = the service's `ymd`, the report `date`, or today (flows). `student_id` is filled from the roster match.

### 5.2 Console mapping onto 11.1

**The seam:** the console calls `getInteractApi().handle(method, path, params, body)` — the same singleton
`gui/server.js` uses. That call already holds the one write lock (`exclusive`), the `run.lock` check and the
error-to-`{ error, sent, step }` mapping. Each call runs inside `sentLog.withVia({ via: 'ys', link: <outbox id> })`, so
each sent-log line names the outbox row (ids only).

**Room and flows (X16; console departures already built).** The room comes from the person's Demographics ticks
(console spec §0), not from roster `kind`. No room → `refused`, `no-room`. A `completeStep` for a flow that is not in
the console's flow list → `refused`, `locked`. Console defaults: `max: 3`, `leaseSeconds: 300`.

| `type` | Call | Body the console builds | Sent-log key |
|---|---|---|---|
| `checkIn` | `POST /api/interact/checkin` | `{ input: { service, serviceTime, person, room } }` | `checkIn:service:<st>:<person>` |
| `checkOut` | **new** route + writer, built from the capture (§5.5; finds the check-in id by reading the room). Until it exists: `refused`, `locked`, nothing sent | `{ input: { serviceTime, person } }` | `checkOut:service:<st>:<person>` |
| `submitReport` | `POST /api/interact/lifegroup` | `{ action: 'submitReport', input: { group, date: dd/mm/yyyy, time, didNotMeet, service, attendees, guests, notes, notesPrivate } }`; `time` from `meets`, else the form's; `service` = the payload's `serviceTimeId` (`''` when null); if Elvanto does not offer it for the date, the writer's read refuses it → `service-not-offered`; `notes` = `note` as received | `submitReport:lifegroup:<group>:<yyyymmdd>` |
| `editReport` | `POST /api/interact/lifegroup` | same + `report`; `time` = the saved one; `service` = the payload's `serviceTimeId` (`''` when null; the app sends the saved one unless the leader changed it); `notes` = Elvanto's notes + `\n` + `note` as received; refuse `report-changed` if the form ≠ `base` (incl. its service), `service-not-offered` as for submit, `note-too-long` if the whole text is over 2,000 chars | `editReport:lifegroup:<group>:<report>` |
| `completeStep` | `GET /api/interact/complete-form?row=` then `POST /api/interact/complete` | `{ row, note: `note` as received, private, assignTo: the modal's pre-selected assignee, actions: [], key: 'complete:ys:<row>', role: 'ys' }` — the route gets one optional `{ key, role }` pass-through (today it always logs `complete:manual:<row>`, which is B2-exempt) | `complete:ys:<row>` (never twice) |
| `firstTimerCheckIn` | `GET /api/interact/youth-plan?mode=intake&date=<serviceDate>`, then as `checkIn` | the student form with the same first + last name (case and spaces folded) → its approved person | `checkIn:service:<st>:<person>` |

### 5.3 State machine and outcome map

```
            enqueue                claim                     result
 (app) ───────────▶ pending ──────────────▶ claimed ──┬──▶ sent       (confirmed, or already)
                     ▲  │ cancel                      ├──▶ refused    (nothing sent; reason)
                     │  ▼                             ├──▶ unclear ──resolved──▶ sent | refused(not-landed)
                     │ cancelled                      ├──▶ shadowed   (shadow mode; nothing sent)
                     └──────── retry (busy, awaiting approval) ◀──┘
 sweep: pending past the cut-off → refused(too-old); claimed with a lease lost > 1 h → unclear(lease-lost)
```

The console maps each reply by `err.category` + `err.sent`, **never by HTTP status**, first match wins:

| # | 11.1 reply | `outcome` |
|---|---|---|
| 1 | 200 `{ ok, at }` | `sent` |
| 2 | 200 `{ already: true }`; "Already checked in"; check-out "not checked in" (via `reason`) | `already` |
| 3 | `sent === 'unknown'`, or an error with no `sent` | `unclear` |
| 4 | `busy`, `act-busy`, `sent-log` | `retry`, `console-busy` |
| 5 | `sent-log-blocked` | `retry`, `console-busy`, 300 s (X4; the row runs again, reading first, once the open key is settled) |
| 6 | `sent-log-stuck` | `already` |
| 7 | `elvanto-shape`, `elvanto-timeout`, `elvanto-unavailable`, `elvanto-login`, `browser-launch` with `sent: false` | `retry`, `console-cannot-read`; after 1 h from `createdAt` → `refused`, `console-cannot-read` |
| 8 | `bad-input` with a known `reason` | `refused`, that reason |
| 9 | `bad-input` with no `reason` | `refused`, `unknown` |
| 10 | 423 | `refused`, `locked` |
| — | operator "It landed" / "It did not land" on a link key | `resolved`, `landed: true` / `false` |

The check-in read failure is re-thrown as `bad-input` today (`elvanto-write.js` checkIn `read`); the console stream
gives it `reason: 'console-cannot-read'` so it lands in row 7, not row 9.

What the leader sees:

| Status | Leader text | Admin also sees |
|---|---|---|
| `pending` | "Waiting for the console." (+ "Console last seen 7:02 pm" if offline); `awaiting-approval`: "Waiting for the new-person form to be approved." | attempts, retry time |
| `claimed` | "Sending to Elvanto…" | console label |
| `sent` | "In Elvanto ✓ 7:02 pm" (`already`: "Already in Elvanto ✓"; `already` on a flow step, X9: "Done once already ✓. If it's back on the list, do it in Elvanto.") | sent-log key |
| `shadowed` | By type (X9). Check-in and first-timer: "Practice mode: not sent to Elvanto. Check in the usual way." Check-out: "Practice mode: not sent to Elvanto. Check out the usual way." Report, edit and flow step: "Practice mode: not sent to Elvanto. Do it in Elvanto as usual." | would-send key |
| `refused` | The reason line (§5.4) | `detail` |
| `unclear` | "Not sure it saved. The admin is checking Elvanto." | sent-log key |
| `cancelled` | "Cancelled." | — |

### 5.4 Reason codes (stable; `detail` carries the console's sentence)

| Code | Leader line |
|---|---|
| `locked` | "This isn't connected yet. Do it in Elvanto." |
| `no-room` | "No room for this person. Check in on the kiosk." On a check-out (X9): "They aren't in a room in Elvanto. Check them out in Elvanto." |
| `person-unknown` | "This person isn't in Elvanto any more." |
| `report-exists` | "There's already a report for that date. Edit it." |
| `report-not-found`, `report-changed` | "This report changed in Elvanto. Reload and try again." |
| `member-left`, `not-in-group` | "Someone ticked isn't in this group now. Reload." |
| `multi-service`, `unkept-notes`, `note-too-long` | "Edit this report in Elvanto." |
| `service-not-offered` | "Elvanto doesn't offer that service for this date. Pick another, or do it in Elvanto." |
| `did-not-meet-conflict` | "Untick everyone, or untick Group did not meet." |
| `step-moved`, `assignee-needed` | "This step changed in Elvanto. Do it there." |
| `ambiguous-first-timer` | "Two new people have this name. Check in on the kiosk." |
| `too-old` | "Too late to send. Do it in Elvanto." |
| `not-landed` | "It didn't save. Do it in Elvanto." |
| `console-cannot-read`, `unknown` | "The console couldn't do this. Do it in Elvanto." |
| `lease-lost` | (unclear) "Not sure it saved. The admin is checking Elvanto." |
| `note-unreadable` | "This note couldn't be read. Do it in Elvanto." |
| `group-unknown` (X18) | "This group isn't in Elvanto any more. Reload." |
| `leader-member` (X18) | "Remove a leader in Elvanto." |
| `needs-you` (X19) | "The family needs a look first. Nothing more was sent." |
| `plan-changed` (X19) | "Something changed in Elvanto. Review the family again." |
| `saved-before` (X19) | "Saved before but not showing in Elvanto. Check in Elvanto." |
| `chain-not-done` (X19) | "Finish saving the family before the parent text." |
| `bad-answer` (X19) | "That answer no longer fits this date. Refresh." |
| `already`, `console-busy`, `awaiting-approval` | not a refusal (see §5.3) |

**X9:** codes are unchanged; the leader line is picked by type. `detail` is for the admin only. The console takes it
from its own table keyed by reason (no PII, 300 chars at most), never from a route's message.

11.1 refusals are English text today (`bad('…')`). The console stream adds a `reason` property next to each `bad()` the
link uses; the console never maps text.

### 5.5 Per-type notes

- **Which service (decision 11).** The app chooses; the payload carries it (`serviceTimeId` for reports, check-ins,
  check-outs and first-timers). Default: on a Friday, that day's service; on a Sunday, that day's service that starts
  at 10:15 (Connect). Any other day, more than one candidate, or a default not in the mirror → the leader picks from the
  pick list (mirror services with `ymd` from today−7 to today, newest first). A report also offers "No service"
  (`null`). For a report the day is the report `date`; for a check-in it is today. The console sends that service. If
  Elvanto does not offer it for the report date → `refused`, `service-not-offered`. An edit keeps the saved service
  unless the leader changes it.
- **Check-in:** the writer reads every room first. B2-exempt role `service`, so a re-check-in after a check-out works.
  Check-in, check-out and first-timer may target a recent past service from the pick list, not only today's. The 3-day
  cut-off for queued rows (§3.2 sweep) is unchanged.
- **Check-out (on in v1, decision 10):** no writer exists in 11.1 yet. It is built after one capture: the console
  orchestrator, with Claude in Chrome, checks the operator's own record (L12) OUT of one stated service in Elvanto while
  reading the network request (the capture), then checks it back IN. That one record, that one service, out then in;
  nothing else live. The writer is then built from the capture. Until the writer exists the console reports `checkOut`
  as `locked` (rows are claimed and answered `refused`, `locked`: "This isn't connected yet. Do it in Elvanto."), then
  `shadow`, then `live` after the operator's first live send. The app offers check-out the whole time.
- **Last report / edit:** the app shows `lastReport` (attendees, did-not-meet, guests; never notes). Edit is offered
  only for that report, only when `editable`. After a link submit, the app overlays the row's payload + `reportId` as
  the last report until the next `groups` push. Elvanto wins: `base` must still match at send time.
- **Flow tick + note:** one Complete per row. If the step sends a text or email, it goes when the step completes; the
  confirm says "Completing may send this step's message."
- **First-timer:** enqueued with the new-person form (later YS stream), with the service from the pick list. Form pending or not yet listed → `retry`,
  `awaiting-approval` (5 min). Approved, one name match → check-in → `sent` with `personId`. Two or more →
  `refused`, `ambiguous-first-timer`. Never approved → the sweep refuses it `too-old`.
  **X7:** `awaiting-approval` retries every 300 s in the window and every 900 s outside it. Once a first-timer row is
  24 h old and still not approved, or its name never matched, the console answers `refused`, `too-old`. The console
  reads the intake week that holds the service date. Two intake rows that resolve to the same person count as one
  match, not `ambiguous-first-timer`. A student side with a hold or an unfinished step (for example an archived
  profile) is not approved yet.

### 5.6 Lifegroup member changes (X18, 2026-10-13)

- **Payload** `{ groupId, personId }` (strict, lower-case uuids). The app sets `personId` and `student_id` on the row.
- **Capabilities.** `ClaimRequest.capabilities` gains optional `addGroupMember` and `removeGroupMember`. A missing key
  means the console cannot do that type: the app never leases such a row to that console (the claim leases only listed
  types that are not `off`) and refuses a new one at enqueue (`LINK_UNAVAILABLE`, as `off`). With no console seen yet
  the row is queued. A row nobody claims is swept `refused`, `too-old` after 3 days. The console sends the two keys
  **only when the app's `linkRev` >= 3**: an older app's capabilities object is strict and answers 400 to unknown keys.
- **Results.** Done in Elvanto → `sent` (`sentLogKey`). Already that way in Elvanto (already a member / not a member) →
  `already`. Group gone → `refused`, `group-unknown`. Person gone → `refused`, `person-unknown`. The person leads the
  group (remove) → `refused`, `leader-member`. Writer not built or locked → `refused`, `locked`. Practice → `shadowed`.
  A write it cannot confirm → `unclear` (the admin checks Elvanto).
- **Ordering.** An add and a remove for the same person never both wait: the app cancels the pending opposite row
  (answer `cancelled`) or refuses while it is claimed (`LINK_STILL_SENDING`). Many different people may wait at once.
- **Mirrors.** Until the next `groups` push the app applies sent changes to the members list itself. The console should
  push `groups` soon after a member change is `sent`. A report's attendees are still checked against the pushed members.

### 5.7 Youth intake + consents (X19, 2026-10-13)

- **Handshake.** The console sends the capability keys `intakeAnswer`, `intakeSave`, `consentSave`, `intakeText` and
  claims those types only when the app's reply `linkRev` >= 4. The app adds `intake: { mode: 'off'|'on', hurry, refresh:
  [{mode:'intake'|'consent', date}] (<= 4) }` to the claim reply only when the claim said `linkRev` >= 4. `mode` is the
  app's `intakeAdmin` module (Off = push nothing); `hurry` = an intake row is pending or the admin opened Intake in the
  last 30 min (claim again in 10 s); `refresh` = dates the admin asked for (push them in this tick). The app offers the
  Intake screen only when the newest console's `link_rev` >= 4.
- **Pushes** `POST /sync/push/intakePlan` and `/consentPlan`: one (mode, date) per push, `{ contractVersion, consoleId,
  takenAt, date, cut, inputs (intake only), rows <= 100 }`, a full replace of that date (`takenAt` <= stored: `{applied:
  false}`). Every object is strict: an unknown key (suburb, address, email) rejects the push (400). Strings are cut,
  not refused. `rows: []` clears the date. Fixtures `push-intake.json`, `push-consent.json`.
- **Payloads** (strict): `intakeAnswer { date, family[1..2], choices (<= 2), pairs (<= 1), undo }` with an encrypted
  note `IntakeNote { fixes, keeps }` (<= 1,900); `intakeSave { date, row, confirmed[1..20], one }` (`one` = exactly one
  key); `consentSave { date, row, confirmed[1..4] }`; `intakeText { date, row, key }` (`complete:parent:` only).
  Dedupe `ia:` / `is:` / `cs:` / `it:<date>:<row>`. The intakeAnswer note is not attributed (no leader prefix).
- **Results.** `planned` (an answer applied and the date re-pushed; the row becomes `sent`, reason `planned`). `sent`,
  `already`, `refused`, `unclear`, `shadowed` may carry `steps[] { key, action, role, outcome: confirmed | already |
  not-sent | unconfirmed | locked | shadowed, at }` (<= 20) and `stop { code, text <= 200 }`; an intake `sentLogKey` is
  the step key (<= 400). Fixtures `claim-response-rev4.json`, `result-request-intake.json`, `batch-intake.json`.
- **App rules.** Admin only (`intake:admin`), module `intakeAdmin` Off / On (default Off). Save / Text / consent Save
  are refused `INTAKE_STALE` (409) when the plan is over 2 h old, and 400 when a key is not in the stored plan of that
  row. An intake row waits at most 24 h (swept `refused`, `too-old`); its note is dropped once final; the row is
  deleted after 14 days. Plan rows are encrypted at rest and deleted after 14 days; module Off deletes them all.

### 5.8 Leader names + flow steps (LINK_REV 5, 2026-10-14b T8/T12)

- **Optional only**, contract version stays 1. Either side at rev 4 keeps working.
- **`POST /sync/leaders`** (sync token, body `{ contractVersion, consoleId }`) -> `{ contractVersion, names: string[] }`:
  each active app leader's full name, trimmed, distinct. The console asks only when the app's claim reply said
  `linkRev` >= 5 (an older app has no such route). The console searches Elvanto by each name and adds to the roster
  push, as kind `leader` (no Demographic filter), the one non-archived person whose folded name (case, spaces, hyphens,
  apostrophes, dots) is that name; none or several = left out (the app shows Not linked). Results are cached (found 24 h,
  not found 6 h). The app's leader match keys on the same fold (`matchFold`).
- **Flows push `steps`** (optional, <= 2000): `[{ flowId, flowName, stepId, stepName, stepOrder }]`, every step of each
  pushed flow, empty ones included. Stored with the flows mirror state (migration `0024`); a push without it stores none
  and the app lists steps from the rows. `GET /link/flows` returns `steps` to every login (the hidden step left out for
  a non-admin), so an empty step shows as "Step name · 0".

## 6. Identity and matching

- **Elvanto person id is authoritative.** Every action carries `personId`. Students get one only through
  `link_roster.student_id` (no new column on `students` in v1).
- **Roster source:** the console reads Elvanto people in the configured categories, two lists (`student`, `leader`).
  **No such reader exists today** (the CSV exports carry no ids); the console stream builds it and the operator runs a
  read-only probe first.
- **Auto-match** (after every roster push): first reset any row whose `student_id` is no longer in `students` to
  `none` (Full Reset makes new ids). Then, for rows with `match = 'none'`: the import's name key
  (`lower(first) + ' ' + lower(last)`) with equal gender. Exactly one student → `auto`. More than one student, or
  another roster row with the same key → `ambiguous`. None → stays `none`.
- **Manual:** admins match or ignore in `/link/admin/roster` (they see the student's DOB from `students`). A push never
  overwrites `manual`, `auto` or `ignored`. The unique index stops two people pointing at one student; for an Elvanto
  duplicate profile the admin matches one and ignores the other.
- **One name fold (X8).** For every name match: Unicode NFKD with the accents removed, curly quotes made straight,
  lower case, no spaces round a hyphen, runs of spaces made one space, and trimmed. It is used by the console's
  first-timer match, the app's first-timer dedupe key (`first:<st>:<fold(first)> <fold(last)>`), the app's roster
  auto-match key and its leader-name mapping. A short name still does not match a full name. X7's 24 h refusal covers
  that case.
- **Unmatched people still work:** check-in lists the roster, not app students. Matching only links app features.
- **First-timers** reach the roster after approval; the next CSV import creates the student; the next auto-match links
  them.

## 7. Attribution, shadow mode, cadence, minimisation, token

### 7.1 Attribution

Every row records the login (`created_by`) and the self-identified leader (`leader_id`, `leader_name`, unverified).
Elvanto shows the operator's admin as the author. **X1 (D2 decided 2026-10-12): the app prefixes the name.** For
`submitReport`, `editReport` and `completeStep`, the app puts the self-identified leader's name in front of the note
text it sends in the claim row's `note`: `Self identified leader: <leaderName> — <note>`. When the leader wrote no
note, `note` is `Self identified leader: <leaderName>` alone. The console adds nothing and changes nothing: Submit and
Complete send `note` as received, and Edit sends Elvanto's notes + `\n` + `note` as received, never replacing an older
line. Check-in, check-out and first-timer carry no text (`note` null). The app stores the leader's own note and builds
the prefixed text when it builds the claim row. It caps the leader's own note so the prefixed text fits the existing
1,900-char `note` cap, so the cap is unchanged. `note-too-long` on an edit counts the whole text (2,000). The fixtures
stay as they are: their notes are valid example text. Check-in and check-out attribution is the outbox row plus the
sent-log `link` id.

### 7.2 Shadow mode

Per type, in the console's `config.json` (`ysLink.shadow.<type>`, default **true**; a PC-only key, like `ysUrl`). In
shadow the console validates, reads first and builds the request, stops before the send (nothing sent, no sent-log
line), and reports `shadowed` with the key it would use (or `already` / `refused`). Capabilities in the claim tell the
app which types are practice. The comparison against the Friday import is the app's reconciliation (§8.6). The operator
makes the first live send of each type (11.1 rule).

**Practice and the sent-log (X12).** Practice does not ask the sent-log. So it can answer `shadowed` for a key that
live would answer `already` or `retry`. This is accepted.

**Go live and the practice Friday (X13).** Turn a type live outside the window, when no rows of that type wait. The
operator makes the first live action and checks it in Elvanto. A `shadowed` check-in does not count as "in" when the
app checks for a duplicate check-in. On the practice Friday, check-ins are compared with the import. For reports,
edits and flow steps, the admin compares the would-send keys by hand. New person always sends for real, so never test
it with a made-up person.

### 7.3 Polling cadence

The poller lives in the console server process (`gui/server.js`, a timer), not Task Scheduler: it needs the Interact
session and its write lock. Window: on a Brisbane day with a YS service (`isBrisbaneYs`), **first start − 90 min to
last start + 4 h** (6:30 pm → 5:00–10:30 pm). **X3:** if the services read fails, the console stays in the window and
reads again in 5 min. "No YS service today" is kept for one hour, then read again.

| What | In window | Outside |
|---|---|---|
| Claim (+ heartbeat) | every 60 s (`max: 0` while `run.lock` is held) | every 15 min |
| Push `services` (incl. who is checked in) | every 5 min | hourly |
| Push `groups` | — | hourly (outside the window only) |
| Push `flows` | every 15 min, only while the console's flow list is not empty | same |
| Push `roster` | at window start, only once both console category lists are set | every 6 h, same condition |

**X2:** until both console category lists are set there is no roster push and the door list is empty. A failed push
waits for its normal interval, like a good one. Claims are timed from the start of the last tick.

Screens overlay the leader's own outbox rows on the mirrors, so no push follows a write.

### 7.4 Data minimisation

| Screen | Gets | Never |
|---|---|---|
| Door check-in | name, grade, checked in, row status (both genders, one list) | gender, phone, DOB, category, notes, stats |
| Lifegroup report | group name, meets, member names + leader flag, last report (date, attendees, did-not-meet, guests) | report notes, phones |
| Flows | flow + step name, person name, due, assigned-to name | notes history, form answers |
| Admin matching | roster name, grade, gender; candidate students | phone |
| Status banner | console last seen, window, practice/live per type | anything personal |

New data leaving Elvanto is exactly the brief's DOWN list. Leader notes go UP only, encrypted at rest; other leaders see
`hasNote`, never the text.

### 7.5 Sync token

| Item | Rule |
|---|---|
| Value | ≥ 32 random chars; the setup checklist (later) generates one like `SESSION_SECRET`. |
| App side | `LINK_SYNC_TOKEN` in Vercel (Production). Rotate: set a new value, redeploy, update the console (a minute of 401 only queues rows). Unset → `/sync/*` 503 `LINK_OFF`. |
| Console side | Windows Credential Manager (new target in `config.credentials`), read with `auth.read()` like the Interact session's Elvanto login. Never in `config.json`, a log or a URL. |
| Can | Lease and report outbox rows; read the decrypted `note` of a leased row; replace the four mirrors; update `link_console`. |
| Cannot | Read students, leaders, connections, phones, prayers or any other table; create or cancel outbox rows; change matches or settings; reach any non-`/sync` route. |
| Revoke | Clear the env var and redeploy: every `/sync` call fails at once; queued rows wait. |

## 8. Failure modes

### 8.1 Console offline on a Friday

Laptop asleep (Modern Standby) or console closed → no claims. Rows stay `pending`; the check-in screen shows "The
console was last seen 4:12 pm. Check-ins are queued, not in Elvanto yet. Use the kiosk too." When the console returns
it drains the queue; rows past the cut-off are already `too-old` (the sweep runs on any claim).

### 8.2 Elvanto changed (UI or page shape)

11.1 parsers refuse unknown shapes. Before the send → `retry` for up to 1 h, then `refused`, `console-cannot-read`,
plus a PII-free console toast. After the send → `unclear` (the sent-log blocks the key). A push that fails to read
sends nothing; mirrors keep their last snapshot (`takenAt` shows its age).

### 8.3 Partial batch / crash mid-row

Each row is reported as soon as it is done. A crash between send and result: the same console reclaims the row
(`reclaimed: true`) and looks up its sent-log by `link` id first: `confirmed` → `sent`; `pending`/`not-confirmed` →
`unclear`; no line → run normally (read-first still guards). If that console never returns (reinstall, new host), the
sweep moves the row to `unclear`, `lease-lost` after 1 h. **X6:** the sweep skips rows leased by the console making
the claim; that console reclaims them and its sent-log decides (§3.2).

### 8.4 Clock skew

Leases, `retry_at`, the sweep and `service_date` use the database/server clock. The console clock decides only its
window and `takenAt` order (one console). **X11:** `takenAt` is the console's server-corrected time (the console clock
plus the offset from `serverTime`), taken when the read starts. The app lets a person's own outbox row decide their
state while `resultAt + 120 s > takenAt`.

### 8.5 Two consoles

Leases are per row, so one row never runs twice. The open-row unique index stops two rows for the same thing. Sent-logs
are per machine, so 11.1's read-first is the cross-machine guard (as for intake, R2d). `GET /link/status` reports
`consoles: n` seen in the last 10 minutes; n > 1 shows an admin warning. Recommended: one console.

### 8.6 The Friday import and app check-ins

**Stopping (X17).** Turning the New person switch (which the link screens share) Off stops the screens only. Mirrors
still arrive. To stop all data flow, also Turn off the link on the console.

- The import replaces sessions and attendance. **Outbox rows are a separate table with no FK**, so nothing the app
  queued vanishes: `pending`, `refused` and `unclear` check-ins stay visible with their status after the import.
- The Friday sync holds `run.lock` (8:30–8:50 pm cascade); the console sends `max: 0` then. The 8:30 pm export may miss
  check-ins sent after it starts; the next week's export is a full replace of the term, so they appear then.
- **Reconciliation (read-time, no new column):** for `sent` and `shadowed` check-ins with a `student_id`, the app
  compares against `service_attendance` for that date after an import. Agree → nothing. In Elvanto but not imported →
  "In Elvanto; in YS attendance after the next import." Shadowed and imported → "Practice matched." This is also the
  shadow-mode comparison.

## 9. Step 0 deliverables (only these)

| # | Repo | File | What |
|---|---|---|---|
| 1 | YS | this spec | — |
| 2 | YS | `docs/superpowers/specs/2026-10-11-elvanto-link-0016.draft.sql` | The tables. Written, **not applied** (outside `supabase/migrations/`; `LATEST_MIGRATION` unchanged). |
| 3 | YS | `src/core/link-contract.ts` | `LINK_CONTRACT_VERSION = 1`, type/status/outcome/reason lists, Zod schemas for every `/sync` body (§3) and every payload (§5.1). No routes, no services. |
| 4 | YS | `src/tests/fixtures/elvanto-link/*.json` | The canonical fixtures (below). Fake names, fake UUIDs (`…-4000-8000-…`). |
| 5 | YS | `src/tests/link-contract.test.ts` | One vitest file (below). |
| 6 | 11.1 | `spike/fixtures/ys-link/*.json` | A copy of #4. |
| 7 | 11.1 | `spike/verify-ys-link-contract.js` | One verify script (below). Joins the suite by rule. |

**Fixtures** (11 files): `manifest.json` (`{ "contractVersion": 1, "files": { "<name>": "<sha256>" } }`),
`claim-request.json`, `claim-response.json` (one row per type), `result-request.json` (one result per outcome),
`result-response.json`, `push-roster.json`, `push-services.json`, `push-groups.json`, `push-flows.json`,
`push-response.json`, `errors.json` (one body per §3.1 code). Hashes are SHA-256 of `JSON.stringify(JSON.parse(file))`,
so a CRLF checkout does not break them.

**How 11.1 gets the same copy:** from the committed blob, never from a CRLF working file:
`git -C <ys> show feature/elvanto-link-contract:src/tests/fixtures/elvanto-link/<f> > <11.1>/spike/fixtures/ys-link/<f>`
for each file, then compare blob hashes (`git hash-object` in 11.1 = `git rev-parse <branch>:<path>` in YS).
YS is the source of truth. A contract change bumps `contractVersion`, regenerates `manifest.json`, and is copied in the
same session. (The 2026-10-12 amendment kept `1`: v1 was never released.)

**YS test asserts:** manifest hashes match; `manifest.contractVersion === LINK_CONTRACT_VERSION`; every request/response
fixture parses with its schema; every claim row's payload parses with its type's schema; `errors.json` codes are the
§3.1 set; a bad mutation of each request (missing `contractVersion`, unknown type, non-UUID id) is rejected; **by rule**,
every `create table` in the draft SQL has a matching `enable row level security`.

**11.1 test asserts** (no framework, no network, `LOCALAPPDATA` redirected to a temp dir before the first `require`):
manifest hashes and version (`CONTRACT_VERSION = 1` in the test for now); for each claim row, the §5.2 mapping (inline
in the test as the reference; the console stream moves it to `src/ys-link.js`) builds an input that
`createWriter({ reader: stub, session: stub, verified: {} }).run(name, input)` answers with **423** (validation,
read-first and builder pass; nothing sent; no sent-log line); `completeStep` is checked through `complete()` with
`sendVerified: false`; `checkOut` maps to no writer, answers `refused`, `locked`, and its capability is `locked`; a
check-in to the past service in `push-services.json` also answers 423; a report service Elvanto does not offer is
refused by the writer's read (`service-not-offered`), nothing sent; every `result-request.json` outcome
appears in the §5.3 map copied into the test.

Step 0 does **not** touch `supabase/migrations/`, the router, `vercel.json`, `sw.js`, the SPA, repos, services, or any
11.1 `src/` file.

## 10. Later streams

### 10.1 YS Connection orchestrator

1. Move the draft SQL into `supabase/migrations/` under the next free number; bump `LATEST_MIGRATION`.
2. Repos: `ILinkRepository` (in-memory + Supabase; `sql.json`; per-row `note` decryption).
3. `link.service.ts`: enqueue (§4.1, incl. the 23505 → `LINK_DUPLICATE` catch), status, cancel, screens' reads (mirror
   + outbox overlay), auto-match, admin match, reconciliation query. `link:use` / `link:admin` in `access-control.ts`.
   Export `parseGroupName` from `import.service.ts`; one `brisbaneToday()` helper.
4. `sync.service.ts`: claim (sweep + lease, `skip locked`), result transitions (§3.3), pushes (§3.4).
5. `AppError.extra` + `sendError` spread. Routes: `/link/*`, `/sync/*` in the router, `vercel.json`, `sw.js` (`CACHE`
   bump); `Route.sync` + token check in `express-adapter.ts`; `link.routes.test.ts`.
6. `modules.elvantoLink` flag + Youth Setup toggle; setup checklist row for `LINK_SYNC_TOKEN` (optional state).
7. SPA: nav hub tile; check-in screen; lifegroup report + last report + edit; flows tick + note; status banner; admin
   matching; new-person form wiring to `firstTimerCheckIn`.
8. Also on this orchestrator's list (brief): role relabel (Junior/Senior Guys/Girls) + per-device grade filter, prayers
   module off, bus read-only routes.

### 10.2 Sync console orchestrator

1. `src/ys-link.js`: HTTP client (token via `auth.read`, a timeout on every call), the §5.2 mapping through
   `getInteractApi().handle()`, the §5.3 outcome map, the poller timer in `gui/server.js` (§7.3), drain, backoff.
2. 11.1 changes: a `reason` on each `bad()` the link uses (incl. the check-in read failure); the optional `{ key, role }`
   pass-through on `POST /api/interact/complete`; `reportId` returned by `submitReport` (its confirm already reads it);
   the `checkOut` route + writer, built from the Claude in Chrome capture (§5.5; `VERIFIED: false` until then, reported
   `locked`, then `shadow`, then `live`).
3. Sent-log: `withVia({ via: 'ys', link })` writes `via` + `link` (UUID, whitelisted); a lookup by `link` id for
   reclaims; the Unclear saves panel shows link rows, and resolving one reports `resolved` up.
4. Readers: the roster people reader (new; operator probe first); pushes for services (+ rooms, check-ins), groups
   (+ last report form, `editable`), flows (configured flow ids; `personIdForRow`).
5. Config: `ysLink { consoleId, flows, categories, shadow }` (PC-only keys; placeholders only in `run-settings.js`; the
   publish leak scan still passes); a Setup row "YS link" (token present, last claim OK).
6. The operator's first live send per type. Later: move to the standalone/church host (Project 16).

## 11. Risks found while researching

1. **Two 11.1 gaps:** no people reader with ids (the roster), and no check-out writer yet (built after the capture, §5.5).
2. **The Friday sync's `run.lock`** blocks Interact writes inside the service window (8:30–8:50 pm), and the laptop
   sleeps (Modern Standby). Both delay check-ins; neither loses them.
3. **Small 11.1 seams** the link needs: refusal reason codes, the `complete` key pass-through, `reportId` from a submit,
   and the sent-log `link` id (§10.2.2–3).

## 12. Open questions (with recommendations)

1. **Cut-off for queued and first-timer actions.** **Decided 2026-10-12:** 3 days, as recommended (the sweep refuses
   older `pending` rows `too-old`); the operator still confirms once, by hand, that a past-service check-in works.
2. **Check-out in v1.** **Decided 2026-10-12:** on in v1; the writer is built from one Claude in Chrome capture (§5.5),
   reported `locked`, then `shadow`, then `live`.
3. **Report service link.** **Decided 2026-10-12:** the app picks (Friday → that day's service, Sunday → 10:15 Connect,
   else the leader picks) and sends `serviceTimeId`; `pick-service` is gone (§5.5).
4. **Roster categories.** Which Elvanto categories make the roster? Recommend: a console setting with two lists
   (`student`, `leader`), set at the PC, after the operator's read-only probe. **Still open.**
5. **Services push cadence (review L11).** A push every 60 s reads every occupied room, now for 14 days of services.
   Consider every 5 min (the outbox overlay already shows the leader's own check-ins at once). **Still open:** the
   operator's call.

Note (decision 12, not a contract change): Junior/Senior (quad) logins do **not** get `bus:coordinate`. It is part of a
product-wide login simplification (every location, not only the YS config), done in the YS Connection rework (§10.1
item 8); it ships behind a flag with the check-in release. `link:use` / `link:admin` above are unchanged.
