# CLAUDE.md — YS Connection

> **Scope:** the real **YS Connection** app (formerly "Connection Made Simple") — TS/Express backend (`src/`) + `public/index.html` SPA. The offline demo and its full UI conventions live in `../youth app demo/CLAUDE.md`; this SPA is kept aligned to that demo. Project map: `../CLAUDE.md`.

Guidance for Claude Code when working in this package.

## What this is

**YS Connection** (`ys-connection`, formerly `connection-made-simple`) — a youth ministry platform for YS Brisbane. Phone-first SPA backed by a TypeScript/Express API. Students are *connected* to leaders; "connection" is the core relationship entity. Backend-agnostic architecture identical in structure to the Youth Camp Platform.

- **GitHub:** `citipointe-youth/ys-connection` (migrated from `987tom1` 2026-06-22; renamed from `connection-made-simple` → `youth-connection` → `ys-connection` 2026-07-11; org owns the GitHub repo, Supabase org, and Vercel team)
- **Deployed:** https://ys-connection.vercel.app (Vercel team `citipointe-youth`; `master` pushes build, the owner promotes to production)
- **Deploy:** state in `DEPLOY.md`; ship with `/ship` (`bash scripts/ship.sh <branch>`). Pushing `master` builds; the owner promotes.
- **Supabase:** Sydney region (`ap-southeast-2`), project ref `ltcblcudlzlzfcyzlhpc` — `PERSISTENCE=supabase` + `DATABASE_URL` env var

## Commands

```bash
npm install
npm run dev          # backend + frontend on http://localhost:4300 (tsx watch)
npm run start        # same, no watch
npm run typecheck    # tsc --noEmit (strict)
npm run test         # vitest (406 tests as of 2026-07-30; check `npx vitest run` output for the current count)
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
| Students | `GET/POST /students`, `GET /students/search`, `GET/PATCH/DELETE /students/:id`. `GET /students` takes `?crossGrade=1` — widens a grade/quad login's scoping from "own grade/bracket + own gender" to "own gender only" (Connect Setup's Add Students picker; see "Add Students picker now actually offers a broadened leader's other grade(s)" below) |
| Leaders | `GET/POST /leaders`, `GET/PATCH/DELETE /leaders/:id`, `PATCH /leaders/:id/sms-template` (self-service; since 2026-10-17 the leader must be in `leaderInScope`, the Home-picker rule — no creator check; see the SMS templates note below), `PATCH /leaders/:id/grades` (self-service grade broadening; since 2026-10-17 the leader must be in `leaderInScope` — no creator check; see "Leader self-service grade broadening" below). `GET /leaders/:id` is also `leaderInScope` (403) since 2026-10-17 |
| Prayers | `GET/POST /prayers`, `GET /prayers/export`, `POST /prayers/import`, `GET /prayers/student/:studentId`, `PATCH /prayers/:id`, `PATCH /prayers/:id/status`, `DELETE /prayers/:id` — `student_id` is nullable (a "general" prayer has no student); a general prayer is scoped by its creator's grade+gender, not read-role RBAC (see "Prayers screen" in debug.md for the gotchas) |
| Connections | `GET/POST /connections` (also takes `?crossGrade=1`, same widening as `/students` above), `GET /connections/export` (own-gender-only for grade/quad, unconditionally), `GET /connections/student/:id`, `GET /connections/leader/:id`, `DELETE /connections/:studentId/:leaderId`, `GET /connections/allocations/export`, `POST /connections/allocations/import` (admin-only allocation CSV round-trip; body optionally takes `autoCreateLeaders: true` — see "Admin bug/improvement batch" below) |
| Overview | `GET /overview` |
| At-risk | `GET /at-risk`, `POST /at-risk/recompute` |
| Trends | `GET /trends` |
| Lifegroup stats | `GET /lifegroups/stats` (per-lifegroup/grade/quad/overall, current + previous term + weekly series) |
| Import | `POST /import/csv`, `GET /import/history`, `DELETE /import/history` (clear log), `DELETE /import/history/:id` (remove one) |
| Settings | `GET/PATCH /settings` |
| Setup | `GET /setup/status` (public while no admin exists, else admin only), `POST /setup/admin` (first admin, needs `SETUP_CODE`; rate-limited) |
| Admin | `POST /admin/reset` (clears students+leaders+connections+attendance **and connection_audits** — see below), `POST /admin/clear-service-group` (clears service/lifegroup data, **keeps** students+connections+leaders, resets student aggregates), `GET /admin/audit` (log kept; unreachable from the SPA since the Audit tab was removed) |
| Connection audits | `POST/GET /audits`, `GET/DELETE /audits/:year`, `GET /audits/export-all` / `POST /audits/import-all` (admin-only full-table backup/restore — see "New Year Refresh wizard" below; registered before `/audits/:year` since Express matches route registration order) |
| Accounts | `GET/POST /accounts/users`, `PATCH /accounts/users/:id`, `POST /accounts/users/password` (admin resets another account), `POST /accounts/me/password` (self-service, requires current password — distinct endpoint, no admin:manage needed; returns `{ ok, token }` — a freshly-issued session token, since `mustChangePassword` is baked into the token at login and this is the one write that needs the caller's own token refreshed — see "Forced password change" gotcha below), `POST /accounts/cohort-layout/preview` / `POST /accounts/cohort-layout/apply` (admin-only "Apply account layout" dry-run/apply pair — see "Admin bug/improvement batch" below) |
| New youth forms | `POST /intake/new-youth` (`intake:write`, module `newYouthForms` off / shadow / on, off by default; always live since 2026-10-12) — submits Citipointe's two public Elvanto connect forms; see "New youth forms" below |
| Elvanto link (session) | `GET /link/status`, `GET /link/checkin` (`?serviceTime=` adds that service's people and leaders), `GET /link/actions` (`?ids=` or `?serviceDate=`), `POST /link/batch` (every write: actions, cancel, undo, identity), `GET /link/lifegroups` (groups carry `grade`, `gender`, `history` <= 8, sorted 6-12 girls then boys), `GET /link/flows` (rows add `grade`, `gender`, `mobile`, `mobileIsParent`, `assignedLeaderId`, `assignedLeaderName`), `POST /link/flows/assign` (`{flowId, personId, leaderId|null}` -> `{ok}`; 404 module off, 403 out of scope, 400 unknown leader); **admin only** (`link:admin`; directors lost it): `GET /link/admin/roster`, `POST /link/admin/roster/:personId`, `GET /link/admin/shadow-check`, `GET /link/admin/log`; `GET /link/status` adds `consoleLinkRev` / `appLinkRev`. Each screen is behind its own module switch (check-in / lifegroup report / flows); see "UX batch (2026-10-12)" |
| Elvanto link (console) | `POST /sync/claim`, `POST /sync/result`, `POST /sync/push/:kind` — no session: `Authorization: Bearer <LINK_SYNC_TOKEN>`, checked in the adapter. 503 `LINK_OFF` while the token is unset |

**Checklist: adding a new top-level API route.** This has caused two separate production
incidents (`/manifest.json` 2026-07-11, `/prayers` 2026-07-18) from the same root cause. The
second incident's own writeup notes the lesson from the first "apparently didn't stick as a
checklist item" — hence this checklist. A new top-level resource needs registering in **all
three** of:
1. `src/api/http/router.ts` — the Express route table.
2. `vercel.json`'s `routes[]` regex allowlist — Vercel's edge routing runs BEFORE Express;
   a path not in the regex falls through `{"handle":"filesystem"}` to the SPA catch-all and
   returns the HTML shell with a **200**, which fails client-side as a confusing JSON-parse
   error, not a clean 404.
3. `public/sw.js`'s `API_RE` — otherwise the route gets cache-first treatment and can serve
   stale/HTML responses.

Then `curl` the new route post-deploy and confirm JSON + the right auth status code (401/403
unauthenticated) — not just "some 2xx came back".

**Clearing import history ≠ deleting data.** The Import screen's "Clear All" and per-row
trash only remove `import_records` log rows. `service_sessions.import_id` /
`lifegroup_weeks.import_id` are **`ON DELETE SET NULL`** (archived migration `013`, now folded
into `0001_baseline_schema.sql` — see the migrations note below; they were `CASCADE` before,
which silently wiped attendance in production while the in-memory dev path didn't — a nasty
divergence). Deleting the actual attendance is the job of admin → **Clear
Service/Group data** (`clearServiceGroupData`), which deletes sessions/weeks/attendance
directly and resets student aggregates. `import_id` is provenance only (imports are
full-replace; `deleteByImport` is unused), so nulling it is safe.

The Import screen's **new-vs-known preview** (`previewServiceImport`) counts against a fresh
`/students` fetch, NOT the 30s `Cache.get` — that cache expires and is wiped by `Cache.clear()`
after every import, which made a re-upload preview show everyone as "new" with 0 updates even
though the server correctly matched them by name.

## Migrations — consolidated, so old numbers are ARCHIVED numbers

`supabase/migrations/` holds **`0001`–`0008`** (4-digit): `0001_baseline_schema.sql` is the full
end-state, then `0002_rls`, `0003_seed_accounts`, `0004_backfill_grade_gender`, and the four
prayer migrations `0005`–`0008`. The original **`001`–`020`** (3-digit) are preserved verbatim in
**`supabase/migrations_archive/`** — historical record only, outside the CLI's scanned folder.

**So: any 3-digit migration number cited in the dated sections below (e.g. "migration `013`",
"`018_ministry_config`") refers to an ARCHIVED file, not something you will find in
`supabase/migrations/`.** Its effect is folded into `0001_baseline_schema.sql`. Don't go looking
for it, and don't renumber a new migration to match one — the next migration is `0026` (`0025` = quad rename keyed on `users.quad` (fixes `0022`, which matched old usernames prod never had), `0024` = `link_mirror_state.steps` (2026-10-14b T12), `0023` = `newperson_unsent` (T10), `0022` = quad account rename (T4), `0021` = intake (T4), `0020` = link group members (T6), `0019` = error_log (T3), `0018` = UX batch: `link_console.link_rev`, `link_flow_people` grade/gender/encrypted mobile, `link_flow_assign`, `link_groups.history`; `0017` = Elvanto link tables; `0016` = `leaders.view_grades`; `0015` = role `statement_timeout`, now in a migration so a new database gets it; `0014` = bus history, `0013` = bus leader pref_grades, `0009` = `users.login_history`, `0010` = `users.login_devices`, `0011` = Bus Ministry tables, `0012` = bus consent + drop-off).

**Migrations now apply automatically in the Vercel production build** (`scripts/migrate.ts`, `npm run migrate`, `vercel-build`): it records versions in `schema_migrations`, baselines `<= 0014` once for a database that already has `users` + `bus_run_edits` (Citipointe), holds an advisory lock, and prints `Database up to date — N of N changes applied (K new).` Rules: files stay additive; no `create index concurrently`; never edit a shipped file (`0003` was the one exception, now an empty comment); bump `LATEST_MIGRATION` in `src/core/schema-version.ts` with every new file (a test enforces it).

## Role hierarchy

| Role | Scope | Key capabilities |
|------|-------|-----------------|
| `leader` | **Own connected students only** | Junior leader, bound to one `Leader` record via `Actor.leaderId`. Read-only: `student:read` (+sensitive, for call sheets), `leader:read`, `atrisk:read`, `prayer:read`/`prayer:write`. **No** `connection:write`, `leader:write`, `overview:read`, import or admin. Defaults **off** (`ministryConfig.roles.enabled.leader`) — opt in via Youth Setup → Roles. |
| `grade` | Own grade + **own gender** | List own grade/gender students; manage leaders for their cohort; connect same-gender students from any grade. Each grade has separate girls/boys logins (e.g. `grade9g` / `grade9b` — see the username convention under Seed demo accounts; `…f`/`…m` is an older scheme). |
| `quad` | Own quad (e.g. Girls Yr 7–9) | Full connection management **within their gender + bracket**: add leaders, connect/disconnect, edit/remove. Sees only same-gender leaders/students. |
| `director` | Ministry-wide | All of above + import CSV data |
| `admin` | All + back office | Everything + settings, accounts, year-rollover |

There is always exactly one `admin` account. It cannot be deleted. Director/Grade/Quad default
**on** and Leader defaults **off**; all four are toggled in Youth Setup → Roles
(`ministryConfig.roles.enabled`), which is UI-level only — `account.service.ts` does not gate
account creation on it.

**Scoping reality:**
- `Actor.gender` is **derived at sign-in** (`auth.service.deriveActorGender`): quad logins
  from their quad; grade logins from the **username convention** (`grade7g`→female, `grade7b`→male,
  or a "girls"/"boys" word). An ungendered grade account (`grade7@`) → `gender: null` → sees
  **both** genders (back-compat). `access-control` exposes `genderScopeOf` + `canAccessStudent`
  (`canAccessGrade && canAccessGender`); every read path (students, at-risk, trends,
  lifegroup-stats, overview, connections, leaders) scopes grade+quad via `canAccessStudent`.
- So a gendered grade login sees **only its grade + gender** across home, leaders/connect,
  my-students, trends, at-risk and search. `director`/`admin` = all. UI leader filters:
  `grade` → none, `quad` → grade-only (own bracket), `director`/`admin` → grade + gender.
- Connect exception: a `grade`/`quad` login may connect/search a student of **another grade**
  but only of **their own gender** (`student.get`/`search` are gender-only; `connection.assign`
  enforces the leader-gender match; the picker keeps searches within the leader's gender).
  Since 2026-10-17 the other-grade student comes back **without mobile / parent phone**
  (`studentRecordVisible` + the `phonesHidden` strip in `student.service`); the picker and detail
  modal need names only. `GET /connections/student/:id` follows the same rule.

**Status model:** there are **no manual at-risk thresholds**. `atRiskStatus` (`computeStatus`
in `atrisk.service.ts`) is **threshold-free** and mirrors the SPA's `attendQual`: never-engaged
(no attendance this OR previous term) → `regular`; attended before but **neither** service nor
lifegroup this term → `stopped`; a stream's rate dropped **≥20pts** vs last term (or a stream
stopped) → `declining`; otherwise `regular`. It feeds the My Students chips, the leader-card
"at risk" counts, and the home At-Risk highlight. Student search + the At-Risk screen compute
the same model client-side (`attendQual`/`qualChips`, ±20pts), and the At-Risk page additionally
filters out never-engaged youth (`_hasAttended`). Keep `computeStatus` and `attendQual` in sync.

**Connection counts:** only students who **attended** a service or lifegroup in the current
OR previous term are "connectable" (`_hasAttended` in the SPA; `attended` in `overview.service`).
Never-attended students are excluded from connected / unconnected / total counts (so they're
never "unconnected") and hidden from the quick-add picker's default view — but stay **searchable**
to add, and still appear if already assigned.

## Quads

Four quads group students by age bracket + gender:
- `g79` — Girls Year 7–9 (Grade 6 joins when Include Grade 6 is on); login `juniorgirls`, "Junior Girls"
- `b79` — Boys Year 7–9 (same); login `juniorguys`, "Junior Guys"
- `g1012` — Girls Year 10–12; login `seniorgirls`, "Senior Girls"
- `b1012` — Boys Year 10–12; login `seniorguys`, "Senior Guys"

The quad **values** (`users.quad`, `computeQuad`) are still `g79`/`b79`/`g1012`/`b1012`; only the **usernames** and display names changed (migration `0025`, keyed on `users.quad`; `0022` was a no-op on prod, whose logins were `quad79g`/`quad79b`/`quad1012g`/`quad1012b`; 2026-10-14b; `QUAD_USERNAMES` in `enums.ts` feeds `cohort-account-layout.ts` and `seed.ts`; passwords unchanged). Simple logins stays off; turning it off still renames the display names back to "Girls Yr 7–9" etc. (existing, pinned behaviour).

Quad is computed automatically from `grade + gender` via `computeQuad()` in enums.

## Term model (this-term vs previous-term)

Attendance is split into the **current** and **previous** term everywhere; "this term"
is the default, previous is shown as a comparison.

- **Boundaries** come from gaps between consecutive **service dates** > `termGapDays`
  (default 14), Saturday-bucketed so service Fridays and lifegroup Mondays land in the
  same Sat–Fri week. Only the last two terms are kept; resilient across the calendar-year
  boundary (last year's T4 as previous + this year's T1 as current). Pure helpers:
  `src/services/terms.ts` (`computeTerms`, `classifyDate`, `saturdayOf`).
- **Per-student aggregates** (`svc*`, `grp*`, `prev*` on `Student`) are computed **at
  import time** by `src/services/aggregates.ts` (`computeStudentAggregates`). BOTH
  imports (service and lifegroup) recompute BOTH streams from the authoritative
  service boundaries (lifegroup falls back to its own week-gaps when no service data),
  so the split is import-order-independent. Holiday-gap weeks classify to neither term
  and are excluded. **Re-import is required** for these fields to reflect new logic —
  trends/lifegroup-stats compute live and update immediately.
- `import` is the **sole writer** of `prev*` (new-year rollover only wipes data).
- `GET /trends` ministry block is **whole-ministry for every login** (a grade/quad
  login still sees ministry-wide unique + average there); `byQuad`/`byGrade` stay
  scoped. The "Improving/Declining" badge is the trend WITHIN the current term.
- `GET /lifegroups/stats` (`lifegroup-stats.service.ts`) is the per-lifegroup /
  grade / quad / overall source — current + previous term, role-scoped. Each
  `TermAgg` has `uniqueAttenders`, `avgPerWeek`, `weeksRan`, `members` (enrolled =
  distinct students the scope ran for), `totalVisits` (Σ weekly attenders). Notes:
  - **Average denominator depends on scope:** grade / quad / overall use **VALID
    SERVICES in the term** — `avgPerWeek = totalVisits / (valid Fridays meeting the
    floor that term)`, falling back to `weeksRan` when there's no service data —
    which normalises those averages to the service calendar. An **individual
    lifegroup** instead divides by the **weeks THAT group met** (`weeksRan`), so its
    average reflects its own cadence. (`termAgg`'s `divideByWeeksRan` flag, set by
    `statForGroup`.)
  - Each `QuadLifegroupStat` carries a **gendered** per-grade breakdown (`q.grades`);
    the SPA uses that for the director drilldowns (not the combined top-level `byGrade`).
  - **Deliberate attribution:** per-LIFEGROUP counts ALL its attenders; per-grade /
    quad / overall count only attenders whose OWN `grade`/`quad` matches. So a single
    lifegroup can show more unique attenders than its grade total when it draws in
    other-grade / no-grade students — kept on purpose as a "reaching beyond its year"
    signal. Don't "fix" it to roll up by the group's grade.

## Key design rules

- **RBAC in one file**: `src/services/access-control.ts`. Never scatter role checks.
- **Validation inside services**: all external input parsed with Zod inside the service.
- **Repos return deep clones**: base repository clones on every read/write.
- **Extensionless imports**: ESM, `moduleResolution: "Bundler"`, no `.js` extensions.
- **Strict TypeScript**: `strict` + `noUncheckedIndexedAccess` + `noImplicitOverride`.

## OPEN — raise on the next update: the import handlers write to `#import-status` unguarded

Reported 2026-08-16 from Project 11.1 (the Elvanto Sync Console), which drives this app's CSV
import with Playwright. **No fix has been made here; this is a note, not a change.**

`uploadServiceImport()` / `uploadGroupImport()` in `public/index.html` (~line 4932) do:

```js
const statusEl = document.getElementById('import-status');
const rows = window._pendingServiceRows; window._pendingServiceRows = null;
if (!rows) return;
if (_importBusy) { toast('An import is already in progress'); return; }
_importBusy = true;
statusEl.innerHTML = `...Uploading ${rows.length} rows…`;   // <-- no null check
try { const result = await API.post('/import/csv', { rows, filename }, 90000); ...
```

If the import view has been re-rendered away by the time the confirm button is clicked —
`renderImport()`'s cold branch `setApp(shell(''))` produces a `<main>` with **neither**
`#csv-file` nor `#import-status` while `S.page` is still `'import'` — then `statusEl` is `null`
and that first `innerHTML` write throws `Cannot set properties of null`. Three consequences,
in order of how badly they hurt:

1. **The throw happens BEFORE `API.post`, so no import request is ever sent.** Nothing is
   imported, and nothing says so.
2. **The staged rows have already been consumed** (`window._pendingServiceRows = null` runs
   two lines earlier), so the click cannot simply be repeated — the file must be re-selected.
3. **`_importBusy` is left `true` forever**, because the throw precedes the `try`/`finally`
   that would reset it. Every subsequent import attempt in that tab hits
   `toast('An import is already in progress')` and returns. Only a reload clears it.

From an inline handler this is silent: the exception is swallowed, the UI shows nothing, and a
human sees a click that did nothing. It was found only because the automation captures
`page.on('pageerror')`.

Suggested fix when someone is next in this file (all three are small and independent):

- `if (!statusEl) return;` — or better, re-render the import view and retry, since by then the
  rows are already gone.
- Move `_importBusy = true` inside the `try`, or reset it in a `catch`, so a throw cannot wedge
  the page.
- Don't cold-re-render the import page while `window._pendingServiceRows` is non-null or a
  modal is open — `_revalidateImport()` is currently guarded only against re-entrancy.

**What is NOT established:** what emptied the `/import/history` cache and triggered the cold
render mid-flow. Project 11.1's `debug.md` §U has the full evidence, including the DOM snapshots
either side of the click. Project 11.1 now defends itself against this (it detects the signature,
re-stages and clicks once more, and only ever does so when it has positive evidence that no POST
was sent) — so the automation is no longer blocked on it, but the underlying handler is still
unguarded for human users.

## Key service + repository names

- `ConnectionService` / `makeConnectionService` — connects students to leaders
- `IConnectionRepository` / `InMemoryConnectionRepository` / `SupabaseConnectionRepository`
- Supabase repositories live in `src/repositories/supabase/`

## Seed demo accounts

| Username | Role | Scope |
|-------|------|-------|
| `admin` | admin | All |
| `director` | director | All |
| `juniorgirls` | quad | Junior Girls (quad `g79`) |
| `juniorguys` | quad | Junior Guys (quad `b79`) |
| `seniorgirls` | quad | Senior Girls (quad `g1012`) |
| `seniorguys` | quad | Senior Guys (quad `b1012`) |
| `grade7` … `grade12` | grade | one per grade (the in-code seed has one account per grade) |

**This table describes `PERSISTENCE=memory` only.** `0003_seed_accounts.sql` is now an empty comment (2026-10-10): a new Supabase database has no accounts and the first `admin` is created on the setup screen with `SETUP_CODE` (see "Multi-location rollout" below).

Local `PERSISTENCE=memory` dev/demo mode: password `demo1234` for all of the above,
same as before. **Historical (databases that ran the old `0003`):** every account
inserted by `0003_seed_accounts.sql` (`supabase/migrations/` — the pre-2026-07
history of this seed data, back when it used fake `@youth.ministry` emails, lives
archived in `supabase/migrations_archive/002_seed_admin.sql` /
`005_seed_users.sql` / `017_must_change_password.sql`) is flagged
`must_change_password = true` inline at insert — the account holder must set their
own password via `POST /accounts/me/password` (or the forced first-login screen)
before anything else is reachable. See "Forced password change" under Security
notes.

**Username convention:** grade logins use **`g` (girls) / `b` (boys)** suffixes —
e.g. `grade7g`, `grade7b` (NOT `…f` / `…m`, an earlier naming scheme). Usernames are
**editable** in admin → Accounts → Edit (`account.service.update` accepts `email`
with a uniqueness check — the field is internally still named `email`, it's just
not treated as one anywhere in the app), so the actual logins can be renamed to
this scheme.

**`gender` is now set explicitly on every seeded grade account** (migration `0003`
inserts it; migration `0004` backfills it for a database `0003` already ran
against) rather than being inferred from the `g`/`b` suffix at sign-in time —
see "Admin bug/improvement batch" below for why (the grade-change auto-rename
needs it to tell a still-default account name from a customised one).

## Environment variables

```
PORT=4300
NODE_ENV=production      # LOCAL/other hosts only. Do NOT set NODE_ENV in Vercel: it makes Vercel skip devDependencies, so `tsx` is missing in the build.
PERSISTENCE=supabase     # production; use "memory" for local dev with seed data
DATABASE_URL=<supabase-connection-string>
DATA_DIR=./data          # only used for PERSISTENCE=json
CORS_ORIGINS=*
APP_ORIGIN=https://<your-deployment>.vercel.app   # CORS fallback when CORS_ORIGINS is unset
SESSION_SECRET=<random>  # REQUIRED in production, or session tokens can be forged
SETUP_CODE=<16+ chars>   # first-run admin creation (setup screen); ignored once an admin exists
GOOGLE_SA_JSON=<key file as one line>   # Bus; replaces the three GOOGLE_SA_* vars (they still work; JSON wins if both set)
GOOGLE_MAPS_API_KEY=<key>               # Bus; always required
LINK_SYNC_TOKEN=<32+ chars>             # Elvanto link console (/sync/*); unset or shorter = /sync answers 503 LINK_OFF
VAPID_PUBLIC_KEY=<base64url>            # Notice alerts (web push). Any of the three unset = alerts silently off
VAPID_PRIVATE_KEY=<base64url>           #   ("Alerts aren't set up yet"). Make a pair: npx web-push generate-vapid-keys
VAPID_SUBJECT=<mailto: or https: URL>   #   Contact sent to the push services, e.g. https://ys-connection.vercel.app

# Required whenever PERSISTENCE=supabase — read directly from process.env by
# src/utils/field-crypto.ts, NOT via src/config/env.ts. Encrypts students.mobile and
# students.parent_phone at rest. See the "Phone field encryption at rest" section below.
FIELD_ENCRYPTION_KEY=<base64, 32 bytes>
FIELD_ENCRYPTION_KEY_ID=<id>
FIELD_ENCRYPTION_KEY_PREV=<base64>    # only during a key rotation
FIELD_ENCRYPTION_KEY_PREV_ID=<id>     # only during a key rotation
```

⚠ **`FIELD_ENCRYPTION_KEY` is a hard runtime dependency of nearly every read endpoint** once
any row is encrypted — a whole-table read maps every row through the decrypt, so one
undecryptable value fails the entire query (Home / `/overview` / `/trends` / `/students` /
`/connections` together). It must be set in prod env **before or with** any deploy that ships
the encryption-aware code, never after. Losing it = losing both phone columns permanently.

**GOTCHA — production `DATABASE_URL` must use the connection POOLER, not the direct
connection.** On Vercel serverless, the direct connection (`db.<ref>.supabase.co:5432`)
fails because Supabase now serves it over IPv6 only and Vercel functions are IPv4. Use the
Supavisor pooler with the `postgres.<ref>` username:
`postgresql://postgres.<ref>:<password>@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres`.

**Use SESSION mode (port `5432`), NOT transaction mode (`6543`).** The transaction-mode
pooler intermittently handed back dead connections (queries dispatched, no response, 20 s
timeout → 503) under this app's serverless + burst pattern — the root cause of the 2026-07
outage. Session mode fixed it; see the "✅ RESOLVED" note in the incident history below for
the full evidence and the connection-ceiling mitigation levers.

The `0015` migration now carries the role `statement_timeout = '15s'` (wrapped so it can never fail a deploy); the manual `ALTER ROLE` step in the incident notes below is no longer needed for a new database.

## Frontend

`public/index.html` — phone-first SPA that calls the Express backend via relative API paths. Kept aligned to `../youth app demo/allocation-platform.html` (the canonical offline demo, deployed at https://yc-camp-demo.vercel.app). See `../youth app demo/CLAUDE.md` for demo UI conventions.

**Connection Audit module** is ported into the SPA as a delimited block (`/* ── CA MODULE … ── */`); remove = delete blocks + grep-delete `/*CA-HOOK*/` lines. The per-quad funnel is the integration ladder built from `D.students` (grade×gender cohorts).

**Audits are server-stored (since 2026-06-21).** The audit is now a **self-contained, year-keyed snapshot** rather than a live read + localStorage overlay:
- Backend: `connection_audits` table (migration `009`, one row per calendar year, `jsonb` snapshot). Routes `POST/GET /audits`, `GET/DELETE /audits/:year` (director/admin via `import:run`). `ConnectionAuditService` runs the *same* term/aggregate engine the importer uses on the uploaded YTD CSVs — it does **not** touch the live tables. Live importer is untouched.
- Pure helpers: `src/services/year-terms.ts` (`computeAllTerms` → N labelled terms `<year>-T<ordinal>`), `year-aggregates.ts` (`computeYearAggregates` → per-term student aggregates), `attendance-build.ts` (name-keyed CSV→model builders, audit-only; importer keeps its own merge path).
- SPA: the Data tab uploads the **full YTD service + group CSVs** plus the 4 CRM overlays (team/connect/decision/flows) as one audit (`CA.saveAudit()` → `POST /audits`); `CA.load()` now derives `D` from the loaded snapshot scoped to the selected term, NOT from live endpoints. A **year picker** + **term/YTD switcher** (`CA.setYear`/`CA.setTerm`) drive the view; the latest term of a mid-term upload is flagged `inProgress`. Re-uploading a year overwrites it (latest-per-year).
- **Lifegroup Health in audit mode:** the per-named-lifegroup Health table is built
  **from the snapshot** — `snapshot.lgStatsByTerm` (`buildLifegroupStats`, server-side) →
  `_auditLgStats(sel, prev)` assembles the `byQuad→grades→lifegroups` shape `lifegroupRows()`
  expects. No live `/lifegroups/stats` call. (This needs `audits` in the SW `API_RE` — see
  the SW gotcha — or a stale snapshot is served and the table reads empty.)
- **Term / YTD date filtering in the SPA (`model()`):** connect/decision rows are filtered by `inPeriod(r.date)` (ISO string comparison). A specific term bounds to that term's `startDate`/`endDate`; **year-to-date (`TERM==='ALL'`) bounds to the UNION of the audit's term dates** (`min startDate … max endDate`) — the CRM exports carry the full submission history, so without this bound prior-year rows (and stray future-dated entries, e.g. a mis-typed "decision date" of 2028) leaked into the YTD funnel. Undated rows are always included. Note this is a safety net: `parseRows` already selects the **"Date Submitted"** column (not DOB / not the free-text "when did you make a decision" field), so the old years visible in the raw CSV aren't normally the date used. Team rows carry no dates — for a specific term, a team member only reaches stage 5 if they also attended that term (`sA>0 || gA>0`); YTD counts the full roster.
- **CRM CSV parsing (`parseRows` / `parseMatrixRows`):** `parseRows` handles lean one-row-per-person exports with a name column and an optional date column; the date column is matched by exact name first ("date", "decision date", "connect date") then by any header containing `\bdate\b` that isn't birth/DOB-related. `parseMatrixRows` handles the service-attendance matrix format (date-format column headers, Y/yes/1/true cells per row per session) — connect takes the earliest Y date, decision takes the latest. `upload()` tries matrix first for connect/decision, falls back to `parseRows`.
- **Known edge case:** the term `endDate` is the Saturday of the last service week. Decisions/connects recorded on the Friday of that same week fall after `endDate` and are excluded from the term (attributed to neither term, but appear in YTD).
- **v1 limitations:** the Friday session sparkline depends on live `/trends` (null in audit
  mode, since `load()` sets `trends:null`) → it renders empty in the audit; the
  funnel/overview/people/Lifegroup-Health work per-term. Term ordinals derive from each
  term's calendar-year start, so a ministry year crossing the Dec/Jan boundary may mislabel.

- **Connection allocations** (admin only): Admin → Data tab exports/imports a student↔leader
  allocation CSV (`First Name,Last Name,Grade,Gender,Leader`, one pair per row, grouped by
  student). Import is name-matched and column-agnostic to grade/gender, syncs per student
  (students absent from the file are untouched), skips a student's removals if any of their
  leader names is unmatched, and returns a report of unmatched/ambiguous names. Logic lives in
  the pure `src/services/connection-allocations.ts`; `parseAllocationCSV` in the SPA preserves
  all columns (unlike attendance `parseCSV`).
- **Connect Setup export** (`exportConnectCSV()`, all roles — own-gender-only for grade/quad):
  `GET /connections/export` now returns structured rows (`ConnectionService.exportCsv` /
  `ExportRow`, not a CSV string); the SPA builds an **.xlsx** workbook client-side via the
  same vendored SheetJS build used to read Excel imports (`_ensureXlsx()`), lazy-loaded on
  click. One row per leader (name/grade/gender only) followed by that leader's connected
  students (their own grade/gender — not the leader's — plus Health/Youth %/Lifegroup %/DOB/
  Mobile/Parent Mobile), grouping relies on the rows already being sorted leader-then-student.
  **Independent of** the admin-only allocations export/import above — separate route, service
  method (`exportCsv` vs `exportAllocations`), and frontend function
  (`exportConnectCSV()` vs `exportAllocationsCSV()`); changing one doesn't affect the other.

### Elvanto export guide (2026-07-03)

Two screenshot walkthroughs teach users how to produce the upload files in Elvanto, shown in a
full-screen step viewer (`#exportGuide` overlay; `.eg-*` CSS; `EXPORT_GUIDES`/`openExportGuide`/
`_egDraw`/`_egGo`/`_egZoom`/`_egTs`/`_egTe` — ported from the Camp Platform's import guide):
- **`openExportGuide('import')`** — button on the main Import screen (`renderImport`). 2 steps:
  Service Individual Attendance (Friday Nights) and Group Individual Attendance. Both steps carry
  an amber **date-range note** (`_EG_DATE_NOTE`): the app reads only the current + previous term,
  "This calendar year" is fine mid-year, but in **Term 1** the user must set a Custom range
  starting from the beginning of last year's Term 4.
- **`openExportGuide('audit')`** — button in the Connection Audit Data tab upload card (`rData`).
  4 steps: Student Team (= Service Individual Attendance with the **Sunday 10:15am** service),
  Decision Form export, New Child/Youth form export (the "New Connect" file), and People Flow
  Steps Detail report (the flows file).
- Steps flick via Back/Next buttons, dot indicators, or touch swipe (≥48px); screenshots
  tap-to-zoom to a 220%-width horizontally-scrollable view (`.eg-imgwrap.zoom`). Images live in
  **`public/img/export-help/*.png`** (same-origin, CSP `img-src 'self'` covers them, cache-first
  in the SW — bump the SW cache if an image is replaced).

### Grade-login UX overhaul (2026-07-03)

A punch list of small UI fixes/renames, mostly targeted at the `grade` login but shared
across roles wherever the same screen/component is used:
- **Nav renames** (all roles, `navItems()`): `At Risk` → `At Risk & Rising`, `Leaders & Connect`
  → `Connect Setup`, `My Students` → `My Connections`. (`At Risk & Rising` was renamed again,
  later the same day, to **`Health`** — see the note below.) Bottom-nav two-line labels (`mbl`) use a
  shared `.ni-lbl` pattern (first line normal, second line smaller/faded) for any label that
  wraps — keep new multi-word nav labels on this pattern rather than plain wrapped text, or the
  bottom nav's row heights look uneven.
- **Nav reorder** — grade-only: bottom-4 is now Home / At Risk & Rising / My Connections /
  Connect Setup (was Home / My Students / Leaders & Connect / At Risk), with Student Search
  dropped from grade's quick actions. Quad/director/admin keep their existing bottom-4 order,
  just relabeled.
- **Connect Setup icon** changed from the people icon (`users`, shared with My Connections) to
  an arrow (`arrr`).
- **Home hero card**: "Groups" → "Lifegroups" (hero card + the `_hAttTile` Attendance-by-Quad/Grade
  tiles); the "Grade X" role badge no longer shows on the hero card itself (still shows in the
  persistent header — that's `roleBadge(u)` at a different call site, untouched); "Quick Actions"
  subtitle removed above the quick-action button grid.
- **Home follow-up section**: heading "This week's follow-up" → "Follow Up"; a `helpTip()`
  explains these are students who attended recently but weren't seen last time; "Not seen at
  Friday"/"Not seen at Lifegroup" reworded to "Not Seen Last Friday (D/M)" / "Not At A Lifegroup
  Last Week (ending D/M)"; `_followupListHtml` rows show name only (grade/gender/birthday
  dropped to keep rows compact).
- **Upcoming Birthdays**: rows drop grade, gender, and the parent phone number — only the
  student's own mobile (if present) plus "turns N" and their leader(s).
- **Connect Setup (`renderConnectView`)**: title and the Add Leader/Export CSV buttons sit on
  one row (`align-items:center`, not `flex-start` against a two-line title+subtitle block); a
  read-only "Students not Connected (N)" `.drop` dropdown sits below the Total/Connected/Pending
  stat row (named "Unallocated students" until 2026-07-03); the grade-only "Tap Add Students…"
  tip alert is gone (redundant with the tooltip). Per leader: grade/gender and the "N students"
  count share one line (`justify-content:space-between`, ellipsis on the grade/gender span so a
  long list still doesn't push the count off); the student preview (`.connect-students`) caps to
  a ~3-row scroll window (`max-height:126px`, was a hard `slice(0,8)` + "+N more/View all" link)
  with a persistent faint scrollbar thumb (`::-webkit-scrollbar-thumb` + `scrollbar-color`) since
  a touch scrollbar only flashes during an active drag and is easy to miss in such a short list.
- **At Risk & Rising tiles** (screen since renamed to `Health` — see below): grade logins don't see the quad chip (constant/uninformative for a
  single-grade login); grade/gender + the qualifier chips moved to their own second line below
  the name (was crowding the name line). Qualifier chips get a dedicated `_arQualChips(s)` (NOT
  the shared `qualChips(s)` used by Search/admin table/student detail, which is untouched):
  rising/declining drop the "Rising"/"Declining" word and show just the coloured arrow icon +
  stream name at a smaller size (`.ic-xs`, 12px vs the normal 16px `icS`), and "Service" → "Youth"
  for that arrow variant specifically (the "Stopped …" wording, which uses the alert icon rather
  than an arrow, is untouched — wasn't in scope).
- **My Students**: the big centered leader-identity card above the list is gone (redundant with
  the "I am…" dropdown right above it); each student row's Yr/gender/birthday moves onto the name
  line in smaller text (was its own `li-sub` line, making rows taller); "Fridays" stream label →
  "Youth".
- **Mobile viewport fixes**: `overscroll-behavior-y:contain` on `html`/`body` stops the native
  rubber-band bounce from dragging the whole page past the sticky header/fixed bottom nav;
  `min-height:100vh;min-height:100dvh` (vh first as a fallback) on `body`/`#app` so the fixed
  bottom nav doesn't visually jump as a mobile browser's URL bar hides/shows mid-scroll — both
  ported from fixes already proven in the camp platform, adapted to this SPA's window-scroll
  architecture (the camp app instead uses a fixed-height `.app` frame with per-screen absolute
  `.screen` containers).

### SPA architecture

**Persistent shell** — header + nav are built once on login via `_initShell()` and never rebuilt. All page navigations update only `<main id="page-main">` via `setApp(h)`. The `_shellReady` flag gates this; set to `false` on logout.

**Client-side cache** — `Cache` object (30-second TTL) wraps all `API.get()` calls. Cache is invalidated on every write (connections, leaders, settings, import, admin, users). After login `_prefetch()` fires background fetches for all 7 common endpoints so navigations after the first are instant.

**Stale-while-revalidate navigation** — every page render function (`renderHome`, `renderTrends`, `renderConnect`, `renderUpcomingBirthdays`, `renderMyStudents`, `renderStudents`, `renderAtRisk`, `renderImport`, `renderAdmin`, plus the CA module's own pages) follows the same `<PAGE>_PATHS` + `allFresh`/`haveStale` pattern: all-fresh renders straight from cache; any-stale paints instantly from `Cache.getStale(...)` and revalidates in the background via a `_revalidate<Page>()` helper that re-renders only if `S.page` hasn't changed; nothing cached at all just shows an empty `<main>` until data arrives (2026-07-03: no more full-page spinner placeholder — see the `#nprog` note below). `renderLeaders`/`renderQuadView`/`renderMyQuad`/`renderNotifications` are dead/unreachable code (not in the `render()` dispatch table) and were deliberately left on the old `_allCached` pattern.

**Global loading bar (`#nprog`)** — a thin accent-coloured bar, reference-counted via `_npStart`/`_npDone` called from the `API` IIFE's `r()`. Since `API.get` only calls `r()` on a cache miss, cached reads never trigger it — only real network requests do. **Position (2026-07-03):** `top` is *not* a fixed `0` — `_positionNprog()` measures `.hdr`'s rendered height and sets it inline so the bar sits at the header's bottom edge (falls back to `0` pre-login, before `.hdr` exists); called after `_initShell()`, after `renderLogin()`, and on `resize`. It used to sit at literal `top:0`, overlapping the notch/status-bar strip and the header's own gradient — functionally firing but effectively invisible. Ported from the camp platform, which anchors the same bar to its header's bottom edge natively (`position:absolute;bottom:-1px` inside the header); CMS's window-scroll architecture needs the bar to also work pre-login (no `.hdr` yet), hence the JS measurement instead of DOM nesting. The full-page loading **spinner** placeholder (`.loading`/`.spin`/`.lt`) that used to fill `<main>` while a screen's data was uncached has been removed — `#nprog` alone is the loading signal now. `.spin` still exists at its original small inline size for three contextual action-feedback spots (Recompute button, Import parsing/reading messages) that show *what* is in progress, not just *that* something is.

**Scroll handling** — the **window** is the scroller (`.pg` is not). `setApp()` resets
to top only when navigating to a DIFFERENT page (`S.page !== _lastRenderedPage`) and
**preserves** `window.scrollY` on same-page re-renders, so opening a dropdown doesn't
jump to the top. Don't re-add per-page `.pg.scrollTop` save/restore — it's a no-op.

**Collapsible dropdowns** — Home/Trends quad→grade→lifegroup dropdowns are **pre-rendered
hidden and toggled in-DOM** (no re-render), like the At-Risk sections. Pattern: a `.drop`
card with a `.drop-head` (`onclick="_drop('uniqueId')"`, chevron `.drop-chev`) and a
`.drop-body` (hidden until the card gets `.open`); direct-child CSS selectors so nesting
works. This avoids a re-render flash when the 30s cache has expired. `_hAttTile`
(opts.dropId) and `_lgGradeBlock(g, showPrev, gsfx, id)` emit this structure. Don't bring
back expand-state vars / `renderHome()`/`renderTrends()` toggles.

**Stale-render guard** — `renderHome`/`renderTrends` capture `S.page` before their
`await Promise.all(...)` and bail before the final `setApp` if `S.page` changed, so a slow
`/lifegroups/stats` on a page you've left can't overwrite the new page (the stuck-spinner /
wrong-page bug when switching menus fast).

**Gendered tile labels** — `_loginGender(u)` (quad→quad gender; grade→username `…g`/`…b`) +
`_gsfx(gender)` (" Girls"/" Boys") append the gender to grade/quad tiles whose numbers are
gender-specific (e.g. "Grade 11 Boys").

**Shared display helpers** (defined near `quadChip`): `termRow(...)` renders "This term … ·
Last term …" (student search, My Students, at-risk); `isRising(s)` / `_hasAttended(s)` /
`attendQual(s)` classify students; `fmtPhone`/`callPhone`/`phoneLink` format numbers (space
after the 4th & 7th digit) and tap-to-call. **`callPhone` (2026-07-03)** shows a Call /
Message / Cancel action sheet via the shared `modal()` — iOS's native `tel:` confirmation
can't be extended with a "Message" option, so this replaced the old bare `confirm('Call
…?')`. Applies everywhere `phoneLink` is used (all roles, every screen with a phone number).

### Icon system

All icons are inline SVG via the `IC` path registry. Helper functions:

| Function | Size | Use |
|---|---|---|
| `icN(k)` | 22 px | Nav, buttons, titles |
| `icS(k)` | 16 px | Inline, chips, small buttons |
| `icLg(k)` | 32 px | Large feature icons |
| `icEmpty(k)` | 48 px | Empty-state backgrounds |

Current IC keys (as of 2026-07-30 — grep `const IC = {` in `public/index.html` for the live set):
`home, users, chart, alert, id, upload, settings, link, edit, trash, lock, unlock, logout, target,
check, key, info, clipboard, pie, group, deck, chevr, chevd, arru, arrd, arrr, arrl, xmark, bell,
cake, cross, heart, genderF, genderM, eye, plus`

No emoji or Unicode symbol characters anywhere in the SPA — everything is SVG, **with one
deliberate exception**: `pray` (2026-07-25). A hand-drawn SVG redraw of the reference praying-
hands glyph lost too much detail at 16-22px (nav/list sizes) to read as anything but an abstract
blob, and a set of thin fanned-finger/thumb strokes visually collided with the app's own
chevron/arrow icons. `pray` is now a raster PNG (`public/img/icons/prayer-mask.png` — the
reference glyph, background thresholded to alpha=0 so only the linework is opaque) rendered via
CSS `mask-image` + `background-color:currentColor` (the `.ic-png-mask` class), NOT `<img>` —
this preserves the same currentColor-driven recoloring every other icon gets (answered=green/
pending=blue on the student-list prayer summary, nav active-tab tint), which a plain `<img>`
tag can't do. `icN`/`icS`/`icLg`/`icEmpty` all special-case `k==='pray'` to emit a masked
`<span>` instead of an inline `<svg>`; the raw `IC['pray']` call site (student-list prayer
summary) does the same. `pray` is intentionally NOT in the `IC` registry object anymore — don't
re-add an SVG path there for it.

### Service worker (`public/sw.js`)

- Cache name: `ysc-v53` as of 2026-07-30 (bump on any SPA/asset change to force eviction — see the dated changelog for the running history; check `public/sw.js`'s `CACHE` constant for the current value)
- **Excel import** (all upload points — main import, allocations, every Connection Audit slot):
  `readXlsx(buf)` now uses the vendored **SheetJS** build (`public/vendor/xlsx.full.min.js`),
  **lazy-loaded** via `_ensureXlsx()` only when an Excel file is chosen (same-origin, so CSP
  `script-src 'self'` allows it). It returns the same 2D string array (ISO dates) the callers
  expect, so `rowsToCsv`→`parseCSV`/`parseAllocationCSV`/`parseMatrixRows` are unchanged. Swapped
  from the old hand-rolled DecompressionStream reader for robustness on arbitrary Excel exports
  (legacy `.xls`, 1904 date system, sheet order). `_extractHeaderDate` accepts ISO + DD/MM/YYYY.
- HTML shell (`/`): **network-first** — always fetches fresh HTML when online, falls back to cache offline
- API routes: **network-only** (never cached), matched by `API_RE`
- Other assets: **cache-first**
- SW registration in the HTML listens for `controllerchange` and reloads the page automatically when a new SW activates after a deploy — no manual cache clearing needed.
- **GOTCHA:** every API resource MUST be listed in `API_RE`. A missing one (this bit
  us with `lifegroups`) falls through to the cache-first asset path and can get the
  SPA HTML cached under its URL, breaking JSON parsing (symptom: "… unavailable").
  When adding a new top-level API route, add it to `API_RE` and bump the cache name.
  This bit us with `audits`: its GET routes fell through to cache-first, so a saved
  audit never re-fetched (symptoms: "audit doesn't persist", "lifegroup data not
  showing" — a snapshot cached before the lgStats fix was served forever). `audits`
  is now in `API_RE` as of `cms-v6`.

## Notifications (web push) — removed 2026-07-11; notice alerts added 2026-10-15

The old push feature was removed 2026-07-11 (archived to `../Archive/push-notifications-2026-07-11/`).
Its `push_subscriptions`/`notifications`/`notification_recipients` tables may still exist in prod;
**never reuse those names** (`create table if not exists` would silently keep the old shape).
Notice alerts (2026-10-15) are a fresh port from MyYouthCamp: see "Notice alerts" under Run 2026-10-15.

## Trend qualifiers

- Rising/declining fire only when a stream's attendance **rate** moved **≥ 20 percentage
  points** vs the previous term (raised from 5pts). Threshold lives in **both** the
  backend (`atrisk.service.ts`, `trends.service.ts` groupSummary) and the SPA
  (`isRising`, `_streamQual`, and the CA module rate trends) — keep them in sync.

### Screen rename + operational hardening (2026-07-03)

- **`At Risk & Rising` → `Health`**: new heart icon, subtitle dropped, added a `Stable`
  category for previously-uncategorized students, shrunk card height. `_arQualChips`/
  `qualChips` and the underlying `computeStatus`/`attendQual` model are unchanged — this
  was a rename + display tweak, not a scoring change.
- **Admin**: the Audit tab was removed from Admin Settings (the backend `/admin/audit`
  route and its log are kept, just unreachable from the SPA — nothing in the frontend
  calls it). Deleting an account now requires typing its username to confirm.
- **Connection Audit**: the separate audit-hub and deck-preview screens were deleted;
  the CA tab nav moved to the top of the module and the YTD/term strip was dropped in
  favour of the `scopeBar()` year+period picker described elsewhere in this doc.
- **DB timeout gotcha**: production logs showed `/lifegroups/stats` occasionally hanging
  the full 60s and surfacing a raw Vercel platform timeout instead of a clean error, and
  idle Postgres connections closing after only 10s — shorter than a normal logout-then-
  login pause, forcing every post-login query to reopen a fresh connection. Fix: every
  route now fails fast with a retryable 503 after 20s instead of riding to the platform's
  hard 60s limit (CSV/audit import routes are exempt — they're expected to run long); the
  idle-connection timeout was raised 10s → 30s.

### Bug fixes, New Year Data Refresh wizard, SMS templates (2026-07-04)

- **Connect Setup**: removed the per-leader "N at risk" tile badge (added only the day
  before — turned out not to be wanted).
- **Home**: admin/director's "Attendance by Quad" renamed to **`Youth By Quad`** and
  stripped down to youth-only numbers (no Lifegroups row/columns) — the separate
  "Lifegroups by Quad" section below already covers that, so showing it twice was
  redundant. `_hAttTile` gained an `opts.hideLifegroupRow` flag for this; quad's own
  "Attendance by Grade" tiles (which still show a Lifegroups row) are untouched since
  `_hGradeMini` — the admin/director-only per-grade dropdown renderer — was the only
  thing simplified.
- **Click a lifegroup → see who attended**: added to the main Trends lifegroup tab, the
  Home lifegroup dropdowns (quad/director/admin), and Connection Audit's own Lifegroup
  Health tab. Live-app screens hit a new `GET /lifegroups/:id/members` endpoint
  (`lifegroup-stats.service.ts`); the CA tab reads a `roster` array now included in each
  named lifegroup's per-term stat inside the audit snapshot (`AuditLgStat.roster`,
  `attendance-build.ts`). Audits saved before this shipped won't have a roster until
  re-uploaded/re-finalized. **Gotcha**: the SPA's `_lgCombine()` (merges per-term stats
  into one when the CA scope spans several terms, e.g. "Year to date") rebuilds each
  lifegroup entry from a fixed field list — any new per-lifegroup field (like `roster`)
  needs to be explicitly folded into that merge or it silently disappears whenever more
  than one term is selected, even though a single-term view shows it fine.
- **Connection Audit people tab**: dropped the colored initial-circle avatar; stage/
  year/gender now sit inline with the name on one line instead of two, shrinking row
  height.
- **Connection Audit lifegroup tab + Executive Brief deck**: named lifegroups display
  with a `"Brisbane - YS - "` prefix and trailing `"Lifegroup"` stripped when present
  (`lgDisplayName()`), display-only — underlying data/exports keep the full name. Note
  this is independent of `import.service.ts`'s own `shortName` derivation (which strips
  everything before the *first* `" - "` at import time) — the two aren't composed, so
  `AuditLgStat.name` always uses the un-stripped `fullName`/raw uploaded name to keep
  CSV-audit-upload and live-finalize snapshots displaying consistently.
- **Admin → New Year Refresh** (new 4th Admin tab): a gated, in-order checklist through
  the existing pieces needed to roll into a new year — nothing here is a new capability,
  it's the existing Export/Reset/Import endpoints walked in the one order that actually
  works, since Full Reset deletes the leaders that the allocations import needs to match
  against, and re-importing the lifegroup CSV is what recreates them (`(leader)`-tagged
  names). Steps: (1) Export Allocations CSV + finalize this year's Connection Audit
  snapshot straight from live data (new `ConnectionAuditService.finalizeFromLive`,
  `POST /audits/finalize-live` — reuses `computeYearAggregates`/a live-data variant of
  `buildLifegroupStats`, sourced from live tables instead of parsed CSVs; CRM overlays
  are left empty and a later manual CA upload for the same year overwrites it, same
  idempotent-per-year behavior as the normal upload path); (2) Full Reset (unchanged
  typed-RESET flow); (3) a reminder card to re-import attendance CSVs, unlocked by an
  explicit "I've done this" acknowledgement (no reliable server-side signal for this);
  (4) Import Allocations. Wizard state is in-memory only — re-opening the tab always
  starts fresh.
- **Removed "Save Defaults"**: it wrote a snapshot of accounts+leaders to an `app_defaults`
  table that nothing in the codebase ever read back (no restore path existed anywhere) —
  dead write-only functionality that didn't fit the refresh flow above. Removed the
  button, route, service method, `ISnapshotRepository` + both implementations, and the
  `AppDefaults` entity; dropped the `app_defaults` table (migration `015`).
- **Call-sheet SMS templates**: `callPhone`/`phoneLink` gained an optional `firstName`
  param (all 6 call sites updated). The action sheet is now Call / Message (default
  `"Hey {first name} "` via an `sms:` `body=` param) / **Message Custom** (shown only
  when the device's self-identified leader, `getMyLeaderId()`, has a saved template) /
  Cancel. New `Leader.smsTemplate: string | null` (migration `014`), with a placeholder
  `<first name>` substituted case-insensitively at send time. Saved via a **dedicated**
  `PATCH /leaders/:id/sms-template` endpoint rather than the general leader `update()` —
  the general endpoint's ownership checks (grade logins can only edit leaders *they*
  created) would reject most self-identified leaders, since most are auto-created by CSV
  import (`createdByGrade: null`); there's no server-verified binding between an Actor
  and "the leader they identify as" anyway, so the template — a low-stakes preference,
  not an RBAC-sensitive field — skips that check. Editable from a new box under the Home
  Follow Up section. **`sms:` URL gotcha**: `encodeURIComponent` does not escape `'`
  (it's a valid URI char), so a name/template containing an apostrophe (e.g. "D'Angelo")
  would break out of the single-quoted JS string in the `onclick` attribute — `_smsHref()`
  manually replaces `'` → `%27` after encoding, the same reason `phoneLink()`'s raw digits
  are stripped of `'`/`\` before interpolation.

### Home-load performance investigation + fixes (2026-07-05)

Investigated persistent "home screen is slow" / login-hiccup reports. Seven days of Vercel
logs showed this wasn't a chronic drip — every failure (7×503 + 1×504) clustered in one
~7-minute window, all triggered by a single `POST /import/group-csv` call that hit Vercel's
60s hard function timeout while it held connections other concurrent requests needed.

- **`statement_timeout` wasn't actually being enforced.** `client.ts`'s `postgres()` config
  sets `connection: { statement_timeout: 15000 }`, but the driver only sends this once, as a
  Postgres wire-protocol startup parameter — it isn't re-applied per query. Through Supabase's
  Supavisor **transaction-mode** pooler, the physical backend behind a client connection can
  change between transactions, silently dropping that setting after the first one. Live
  evidence: a trivial 24-row `select * from lifegroups where id = $1` was caught in
  `pg_stat_activity` **actively running for 4+ minutes**. Fixed at the database role level
  instead — the same pattern Supabase's own `authenticator`/`anon` roles already use (they carry
  `statement_timeout` in `rolconfig`): `ALTER ROLE postgres SET statement_timeout = '15s'`,
  enforced by Postgres itself regardless of pooling mode. **This is a production DB config
  change, not in the codebase or migrations** — if the DB is ever recreated, re-apply it.
- **Redundant DB fan-out on every Home/Trends load.** Home fires 5 parallel HTTP requests
  (`/overview`, `/trends`, `/students`, `/lifegroups/stats`, `/connections`); Trends fires an
  overlapping 4. Between them they independently re-fetch the same full tables —
  `studentRepo.findAll()` alone ran 4 separate times for one Home load. Fixed two ways:
  - **In-flight de-dupe** (`src/utils/inflight-dedupe.ts`, `dedupeReads()`): concurrent callers
    of the same no-arg repo read (`findAll`/`getSettings`/`findActive`) now share one in-flight
    promise instead of firing duplicate queries. Applied once, centrally, in `container.ts` at
    repo-construction time — Supabase repos only, in-memory test repos are untouched. Safe
    because none of these reads vary by caller; actor-scoping happens after the fetch, in the
    service layer.
  - **`overview.service.ts` now caches like the other two stats services.** It was the only one
    of the three (`trends.service.ts`, `lifegroup-stats.service.ts`, `overview.service.ts`) with
    no `ResponseCache`. Mirrors their exact pattern (60s TTL, actor-keyed via the now-shared
    `src/services/actor-key.ts` — previously duplicated verbatim in both other files).
    Invalidated on every write that changes students/leaders/connections: both
    `import.service.ts` call sites, `connection.service.ts`'s `assign`/`unassign`/
    `importAllocations`, and — a pre-existing gap found while auditing this — `admin.service.ts`'s
    `reset()`/`clearServiceGroupData()`, which previously invalidated **none** of the three
    stats caches (a full data wipe could leave Home showing pre-wipe numbers for up to 60s).
    **Known accepted trade-off**: invalidation is still manually sprinkled per mutation, not
    centrally enforced — a future write path that forgets to call `invalidate*Cache()` will
    silently serve stale data for up to 60s. Each of the three has a comment flagging this.
- **`importGroupCsv` had more round-trips than its data volume justified** (677 students / 24
  lifegroups / 2894 attendance rows shouldn't take 60+ real seconds). `lifegroup_attendance`
  cascades from BOTH `lifegroups` (`lifegroup_id` FK) and `lifegroup_weeks` (`week_id` FK) on
  delete cascade, so the explicit `lifegroupAttendanceRepo.deleteAll()` run before the other two
  truncates was provably redundant — dropped it, and the remaining two truncates now run
  concurrently. Leader saves went through one `save()` call per leader — added
  `ILeaderRepository.saveMany` (mirrors `SupabaseStudentRepository.saveMany`'s chunked bulk
  upsert) and switched `importGroupCsv` to one bulk call. Merged two sequential read
  `Promise.all` batches into one (nothing forced the split). **Explicitly not done**: wrapping
  the import in a `sql.begin()` transaction for atomicity — a killed/crashed import can still
  leave lifegroup tables truncated-but-not-repopulated. Flagged as a follow-up, not fixed here.
- **Upload spinner**: `uploadServiceImport`/`uploadGroupImport` (Import tab) now show the
  existing `.spin` element (same class already used for the parsing/reading phase) during the
  "Uploading…" status, plus a module-level `_importBusy` guard against a second concurrent
  import — the confirm modal closes immediately on click, before the upload starts, so
  re-parsing and re-confirming a file mid-upload could otherwise fire a second request.

New tests: `src/tests/overview.service.test.ts` (cache hit + invalidation), plus a case in
`import.service.test.ts` asserting leader saves go through `saveMany` once, not `save()` N times.

### Removed "click a lifegroup → see who attended" from the main app (2026-07-05)

The feature added the day before (Home lifegroup dropdowns + the main Trends lifegroup tab)
was pulled back out: it wasn't a useful part of the workflow there, and `getMembers` was
**self-contained and per-click** — every click re-fetched full `students`/`lifegroupWeeks`/
`lifegroupAttendance`/`sessions` tables and recomputed term boundaries from scratch rather than
sharing `get()`'s cached closure, so it was a real (if intermittent) load spike on Home/Trends,
consistent with the slowness reports.
- `GET /lifegroups/:id/members` route, `LifegroupStatsService.getMembers`, and the controller
  method are deleted (dead once the only caller was removed). `_lgGroupRow` (Home/Trends) is
  back to a plain, non-clickable row.
- **Connection Audit's own Lifegroup Health tab is untouched** — it never called this endpoint.
  `CA.showLgRoster()` reads `roster` straight off the loaded audit snapshot (already in memory),
  so the "who attended" capability still lives there, which is where it was ported from
  originally.

### Home follow-up timeout fix (2026-07-05)

Production logs (Vercel runtime logs, post the fan-out/caching fixes above) still showed
occasional 20s timeouts on `GET /connections/leader/:id/followup` — the Home "Follow Up"
leader-picker endpoint. Unlike the Home fan-out (5 endpoints fetched in one `Promise.all`),
`FollowupService.leaderFollowup` (`followup.service.ts`) chained its reads **sequentially**:
`findById`/`findByLeader`/students `findAll` (already parallel) → `sessionRepo.findValid()` →
conditionally `svcAttRepo.findBySession()` → `weekRepo.findAll()` → conditionally
`grpAttRepo.findAll()` — up to 6 round-trips end to end, holding a pooled DB connection open
for the sum of their latencies instead of the max. Fixed by moving the 5 mutually-independent
reads (leader, connections, students, valid sessions, weeks, lifegroup attendance) into one
`Promise.all`; only `svcAttRepo.findBySession()` still runs after, since it needs the latest
session's id from the batch first. Same root cause and same fix shape as the Home/Trends
fan-out fix, just on a different (click-triggered, not initial-load) endpoint — the global
`#nprog` bar is reference-counted across every API call, so a slow endpoint triggered by an
on-page interaction (the follow-up picker, the now-removed lifegroup click-through) reads to
the user as "Home is still loading" even though Home's own initial fetch already finished.

### Production performance incident — full history + handoff for independent review (2026-07-05)

**For a fresh Claude instance picking this up.** The user has asked for an independent
review/continuation of an ongoing production performance incident. Read this whole
section before touching code — it's the complete history so far, not just the latest
state.

**Symptom timeline:**
1. A "click a lifegroup → see who attended" feature was added to the live app (commit
   `bb3a932`, 2026-07-04), then removed the next day (`a3f10b8`) because its `getMembers`
   endpoint re-fetched full tables per click and was a load spike. **Confirmed by grep +
   diff against pre-feature code: no residual code from this feature remains in any
   live-request path** (`lifegroup-stats.service.ts`, `import.service.ts`,
   `attendance-build.ts` all checked). The only surviving change is a `roster` field used
   solely by the Connection Audit snapshot builder (on-demand, pure in-memory JS, not
   called during Home/Trends/lifegroup-stats requests) — **rule this theory out**, don't
   re-investigate it.
2. Real issue: `GET /overview`, `/students`, `/trends`, `/lifegroups/stats`, and
   `/connections/leader/:id/followup` started intermittently hitting the 20s route
   timeout → 503, all together, unrelated endpoints at once.
3. **2026-07-05, later same day**: after several fix attempts (below), the user reports
   the app "at least loading" but **very slow, and not showing all the data when it does
   load**. This last symptom (partial/incomplete data on a page that does render) is
   **new and not yet root-caused** — see "Open questions" below.

**Target end state**: page loads **under 5 seconds** per screen, with **30-40 leaders
using the app simultaneously** (this is a small church youth ministry team, not a
high-traffic consumer app — the DB is tiny: ~677 students, ~22k service_attendance rows,
~2.9k lifegroup_attendance rows. The infra ceiling, not data volume, is the constraint).
**Constraint: Supabase free tier** — user has explicitly said no upgrade for now, so
`max_connections=60` and whatever Supavisor's free-tier pool size is are hard limits to
design within, not levers to pull.

**Root cause (confirmed via live diagnostics, not guessed):** `withTimeout()`
(`src/utils/timeout.ts`) rejected on its 20s deadline but didn't stop the underlying DB
query. Each serverless instance only has `max: 2` Postgres connections
(`src/repositories/supabase/client.ts`). An abandoned query kept a connection tied up
indefinitely; any later request that got scheduled onto that same connection queued up
behind it — that's why unrelated endpoints failed together. Confirmed live: a query
dispatched fast but not actually returning for ~19-99s while sitting behind another
query on the same connection, and a driver-level `Postgres.js : Unknown Message` protocol
desync consistent with a connection being reused while still processing abandoned work.

**Diagnostics added (kept, still deployed, safe to leave in place)**:
- `src/utils/request-context.ts` — an `AsyncLocalStorage`-based per-request context
  (id, route, start time, and a `pendingQueries` set).
- `src/api/http/express-adapter.ts` — logs `[reqtiming] <id> <route> start/done/failed`
  around every route.
- `src/repositories/supabase/client.ts` — postgres.js's `debug` hook logs
  `[db-dispatch] conn=<n> <id> <route> +<ms> :: <query>` whenever a query is actually
  handed to a connection (never logs bound parameters — PII).
- Read these via `vercel logs <deployment-url> --json` (or the production alias
  `https://ys-connection.vercel.app`) filtered on `reqtiming`/`db-dispatch`.
  This is by far the fastest way to get real evidence instead of guessing — use it
  before proposing any fix.

**Fix attempts, in order, with results:**

| # | Commit(s) | What it did | Result |
|---|-----------|-------------|--------|
| 1 | `b8703a9`, `68075a2`, `887c230` (earlier session, same day) | Parallelized `leaderFollowup`'s reads; added a client-side retry-once-on-503; lowered pool `max` 5→2, raised `idle_timeout`/`max_lifetime`, staggered Home's prefetch | **Did not stop the incident** — confirmed still failing minutes after deploy (see `plannedupdate.md`, written at the time as a same-day handoff) |
| 2 | `704f84c` | Added the diagnostics above (no behavior change) | N/A — instrumentation only, this is what made the rest possible |
| 3 | `ad848fc` | `withTimeout` now cancels a request's in-flight queries (postgres.js's real `query.cancel()`) via the `pendingQueries` set, instead of abandoning them | **Partial fix.** Confirmed live: `.cancel()` only hard-aborts a query that's the one *actively* being processed on its connection right now; one already sent but queued behind another query on the same connection just gets soft-marked and keeps waiting its turn — one request's queries were re-dispatched ~79s after being "cancelled" |
| 4 | `bf395e5` (**reverted** by `6c4bc04`) | Escalated to force-destroying the whole DB client on timeout | **Regression, caught within ~5 min and reverted.** `api/index.ts` caches the built app/container once per warm serverless instance; `container.ts` passes the `sql` client into every repository once at that same time. Destroying the module-level singleton never reached those already-built repos, which kept a dead reference — every subsequent query on that instance failed instantly with `CONNECTION_ENDED` |
| 5 | `ade64a6` (current) | Same goal as #4, different mechanism: `getSqlClient()` now returns a **permanent stable proxy** that repos capture once as always, but every call through it re-resolves the *real* underlying client at the moment of use (`getRealClient()`). `destroySqlClient()` only swaps what's underneath — no repo/container/api change needed. Verified against a standalone Node simulation of the exact "capture once, then destroy, then reuse the same reference" scenario that broke #4, *before* wiring it into the real client | **Confirmed working better, not fully clean.** Live traffic post-deploy: 0 full 20s timeouts (down from ~30 in an equal-length window right before), 0 `CONNECTION_ENDED` cascades (regression from #4 confirmed gone), but 6 `CONNECTION_DESTROYED` fast-fails (< 400ms) — expected collateral: destroying a stuck connection also fails any other request using that exact connection at that instant. Surfaces as a 503, which the existing retry-once-on-503 (`68075a2`) should mask client-side. Connection IDs climb steadily post-destroy (2→3→6→7→10→11), confirming recovery is clean |

**Open questions for the reviewer:**
1. **"Not showing all the data when it does load"** (reported after fix #5 was live) —
   not yet investigated. Hypotheses to check first: (a) the SPA's `Cache`/stale-while-
   revalidate pattern (`public/index.html`, 30s TTL) rendering a page from a partial set
   of the parallel fetches if one sub-request 503'd and the retry-once logic didn't cover
   it, while others succeeded; (b) `dedupeReads()` (`src/utils/inflight-dedupe.ts`)
   sharing an in-flight promise across concurrent callers — if that shared query's
   connection gets destroyed mid-flight, does *every* caller sharing it get a clean
   error, or does one silently get a partial/wrong result? (c) whether the CSV import's
   own long-running connection (`UNTIMED_ROUTES` in `express-adapter.ts`) could itself be
   the thing occupying a connection that then gets force-destroyed by an unrelated
   request's timeout, corrupting the import. Start from the `[reqtiming]`/`[db-dispatch]`
   logs on a real repro, don't guess.
2. **Residual delayed dispatches**: a handful of `[db-dispatch]` lines still show a query
   for an *already-completed* request dispatching many seconds late (observed up to
   +9674ms). Not currently blocking new requests (they get a fresh connection instead of
   queuing), but not fully explained — likely an abandoned query left running in the
   background until its connection is eventually destroyed by someone else's timeout.
3. **Whether `max: 2` connections is still the right number** given the actual target is
   30-40 *simultaneous* leaders — this was tuned down from 5 during fix attempt #1 to
   reduce connection-acquisition burst, but with the stable-proxy destroy mechanism now
   in place, it may be worth re-measuring rather than assuming 2 is still optimal.
4. Whether `<5s per screen` is achievable at all on the free-tier connection ceiling
   without also reducing the number of round trips per page — Home/Trends already fan
   out 5-9 parallel requests per load (see the "Home-load performance investigation"
   section above); each of those still does several sequential-ish queries internally
   (see the `[db-dispatch]` traces in this section's history for `/lifegroups/stats`,
   `/trends`, etc.). Consider whether the real fix is architectural (fewer, cheaper
   queries per screen, e.g. the precompute plan in `plannedupdate.md`) rather than
   further connection-pool tuning.

**Also read**: `plannedupdate.md` (untracked, in the repo root) has the same history in
more granular, chronological form, including a separate precompute proposal
("attended latest service/lifegroup at import time") that would reduce
`leaderFollowup`'s query count independent of the connection issue above.

### Incident continuation — DEFINITIVE root cause found + batch fix shipped (2026-07-05, independent review)

A later session independently reviewed the above against **live evidence** (Vercel runtime
logs + a controlled load test against production using a real grade login) instead of trusting
the prior conclusions. Findings, in order:

1. **The prior "verified fixed" (`ade64a6`) was a false positive.** Live logs showed a fresh
   503 cluster still firing under real traffic; the `CONNECTION_DESTROYED` fast-fails were NOT
   all sub-400ms (several were 5–10s). The destroy-on-timeout hook was **amplifying** the
   cascade: one request's timeout called `destroySqlClient()`, force-ending the shared client
   and killing OTHER concurrent requests' in-flight queries.

2. **Reverted the incident-era escalations toward the sister Camp Platform's proven-simple
   config, then load-tested each step:**
   - Removed the destroy-on-timeout hook (`app.ts` no longer wires `onRouteTimeout`). Relies on
     the role-level `statement_timeout=15s` (confirmed applied on the prod DB) like the Camp app.
   - Tried `max:2→5` (to match Camp) — **load testing proved this WRONG for CMS** and it was
     reverted back to `max:2`. See next point.

3. **TRUE root cause #1 — Supavisor free-tier CLIENT-connection cap (`EMAXCONN`, limit 200),
   not `max_connections=60`.** Under a concurrent burst Vercel spins up many instances; total
   pooler connections = `instances × max`, so `max:5` hit the 200 ceiling ~2.5× sooner than
   `max:2`. Pool tuning **cannot** solve the target concurrency — the lever is fewer requests
   per page (each Home load fanned out 5–9 requests → 5–9 invocations → instances → connections).

4. **Shipped `GET /batch` (`ff9b2ac`) — the structural fix for the fan-out.** Composes the
   existing services (`overview/trends/students/lifegroupStats/connections/atRisk/settings/
   leaders`) into ONE request via `Promise.allSettled` (graceful partial render; `dedupeReads`
   now coalesces shared table reads across sections). SPA: `API.batch(paths)` fetches the
   batchable paths in one `/batch` call and **seeds the client cache under each path's own key**,
   so every screen renderer is unchanged; `_prefetch`, all 9 `_revalidate<Page>` helpers, and
   `renderHome`'s cold branch now batch. `sw.js` `API_RE` gains `batch`; cache `cms-v21→v22`.
   **Verified in-browser** (login + Home + Trends render, console clean, each screen = 1 batch
   request, zero individual fan-out) and **190+7 tests pass**. This **eliminated the `EMAXCONN`
   500s**. Endpoint is additive — every standalone endpoint still works; easy revert.

5. **TRUE root cause #2 (the deepest one) — abandoned transactions LEAK Supavisor backend
   slots.** After batch, the pooler still saturated under a simultaneous cold burst. Traces
   showed only 2 queries dispatch per batch (`max:2`) then **20s of silence**. `pg_stat_activity`
   revealed why: queries stuck **`state='active'`, `wait_event='ClientRead'` for 4–9 MINUTES** —
   the Postgres/pooler backend waiting on a client (the Vercel function) that already died on its
   20s timeout. `statement_timeout` can't reap these (they're not executing SQL). They accumulate
   until the pooler's backend pool is exhausted → every endpoint 503s together → each 503 orphans
   another query → **death spiral**, slow to recover (minutes). This is the real mechanism behind
   the whole incident — "unrelated endpoints fail together" = shared exhausted pooler.
   - **Operational remedy** if the pooler is ever saturated by orphans (symptom: even a single
     `/auth/login` takes 20s→503 while `/health` is fine): terminate them in the Supabase SQL
     editor —
     ```sql
     select pid, pg_terminate_backend(pid), now()-query_start
     from pg_stat_activity
     where state='active' and wait_event='ClientRead'
       and pid<>pg_backend_pid() and now()-query_start > interval '60 seconds';
     ```
     (Claude cannot run `pg_terminate_backend` — it's blocked as a destructive prod-infra action;
     the human must run it.)

**Remaining work (the real fix for root cause #2 — NOT yet done):**
- **Stop the leak at the source (server-side reaping).** `statement_timeout` doesn't cover an
  abandoned `active`/`ClientRead` backend. Investigate + apply the right reaper: Supavisor pooler
  `client_idle_timeout` (Dashboard → Database → Connection Pooling) and/or aggressive TCP
  keepalives; `idle_in_transaction_session_timeout` at the role level covers the
  idle-in-transaction variant. Goal: orphaned backends reaped in seconds, not minutes.
- **Remove the write-on-every-read.** `SupabaseSettingsRepository.getSettings()`
  (`supabase.settings.ts:62`) runs an `insert into app_settings … on conflict do update` on
  EVERY call (it was one of the stuck queries). Make it `SELECT` first, insert the default only
  if missing — removes a write (and a heavier transaction to orphan) from every stats request.
- **Precompute the heavy aggregates** (`plannedupdate.md` + extend to trends/overview/
  lifegroup-stats): each stats load scans full tables (`service_attendance` ~22k rows) in JS;
  precomputing into a small table at import time makes reads one cheap indexed query, cutting
  both query cost and the window for a timeout→orphan.
- **Re-verify with a STAGGERED-arrival load test** (users over ~15s, not one instant). The
  single-client herd test overstates instance concentration; real spread-out usage may already
  be acceptable with batch alone. (Note: heavy load testing orphans transactions and degrades
  prod — always clear orphans afterward with the SQL above, and prefer gentle staggered tests.)

Load-test scripts live in the session scratchpad (`loadtest.mjs` = per-endpoint fan-out,
`loadtest-batch.mjs` = post-fix batch pattern, `loadtest-realistic.mjs` = staggered arrivals).
Test login used: `grade11b`. Current live state: `max:2`, no destroy hook, `GET /batch` shipped,
diagnostics still in place.

### ✅ RESOLVED — the actual root cause was the pooler CONNECTION MODE (2026-07-06)

A further independent review (again driven by live evidence — Vercel runtime logs,
`pg_stat_activity`, direct `EXPLAIN ANALYZE`, and in-browser reproduction) found that the
whole multi-day incident had **two distinct causes, neither of which was the app code,
the data, or the earlier "orphaned transaction / pool exhaustion" theory** (that was a
downstream *symptom*, not the disease). Both are now fixed and deployed.

**How it was isolated (the decisive evidence):**
- Rolling the app all the way back to the pre-incident commit (`6ecbc76`) did **not** fix
  it, and a full Supabase project restart did **not** fix it → it was neither the app code
  nor a transient pooler state.
- The database itself was proven healthy: `select * from service_attendance` (all ~22k
  rows) runs in **4.5 ms**; `pg_stat_activity` showed ~10/60 connections, no locks, no
  stuck queries; backends execute every query in <1 s and go idle.
- Yet the app hung: `[db-dispatch]` traces showed queries dispatched to the wire in ~1 ms,
  then **20 s of silence → route timeout → 503**. The hang was **intermittent and tied to
  establishing a NEW connection** (it died on fresh `conn=3`, mid `pg_type` init). Warm,
  already-established connections were always fast (12/12 logins at ~0.5 s).

**Root cause #1 — the outage: transaction-mode Supavisor pooler intermittently hands back
DEAD connections.** On the free-tier **transaction-mode** pooler (port `6543`), a
newly-established connection was occasionally TCP-connected + authenticated but **never
returned a response to any query on it** — so the request hung to the 20 s timeout. This
spikes exactly when 30–40 leaders arrive at once (a burst of cold starts / new
connections). The earlier "abandoned transactions leak backend slots" was the death-spiral
this *triggered*, not the origin.
- **Fix (shipped): switch the pooler from transaction mode to SESSION mode.** In the Vercel
  `DATABASE_URL`, change the pooler port `6543` → **`5432`** (same host/user/password).
  Session mode gives each connection a dedicated backend for its lifetime and does not
  exhibit the dead-connection behaviour. Verified live: `/overview`, `/trends`,
  `/lifegroups/stats`, `/auth/login` all went from 503@20 s to **200 in <1 s**. This is the
  single change that ended the outage.

**Root cause #2 — a separate, long-standing login lockout: the login rate limiter was keyed
by RAW IP.** `express-adapter.ts` limited logins to 10 per IP per 15 min (in-memory). The
real audience is 30–40 leaders behind **one shared church/school NAT IP**, so the whole team
collectively got 10 logins / 15 min → everyone past that got a 15-min `429`. Present in every
version (so rollback couldn't remove it) and in-memory (so a DB restart couldn't clear it),
which is why it masked/compounded the outage.
- **Fix (shipped, `664e9f7`): re-key the limiter by IP + account** (falls back to IP-only if
  username absent) and raise the per-account cap to 30/15 min. Per-account brute-force protection
  is retained; it's best-effort throttling, not a hard boundary.

**Also done in the same pass:**
- **RLS enabled** on the four tables that migration 006 missed (`connection_audits`,
  `notifications`, `notification_recipients`, `push_subscriptions`) — see migration
  `016_enable_rls_remaining.sql`. Safe because the app connects as the `postgres` owner and
  bypasses RLS (the other 12 tables already ran this way).
- **Incident diagnostics removed** now that the cause is known: the `[reqtiming]` logs
  (`express-adapter.ts`), the `[db-dispatch]` postgres.js `debug` hook (`client.ts`), and the
  unused `destroySqlClient()` / `TimeoutHook` machinery. The 20 s route timeout and the
  per-request query-cancellation were **kept** (they're safety nets, not diagnostics).

**Session-mode trade-off + mitigation levers (if the connection ceiling is ever hit).**
Session mode holds a dedicated backend per app connection (transaction mode multiplexed
them), so the ceiling is `max_connections = 60`. **Correction 2026-10-09:** the binding limit is the Supavisor session **Pool Size (15)** — `EMAXCONNSESSION … pool_size: 15` fired 52× since July (3× on 2026-10-09 right after a deploy). Raise Pool Size in the dashboard (≈30 is safe at max_connections 60). **2026-10-14:** it recurred after two deploys ~40 min apart (bus /trends /prayers 500s). `isTransientDbError` (`src/utils/transient-db.ts`) now maps `XX000` + `(EMAXCONN…)` to a 503 the SPA retries, and `trackForCancellation` (`client.ts`) no longer runs nested sql`` fragments as standalone queries (postgres.js `.then()` executes; ~571 syntax errors/h since 13 Oct). Pool Size raise still pending (operator). At current usage this is comfortable (~5–20
of 60), and it should still serve 30–40 leaders because connections are per *Vercel instance*
(not per user — Fluid Compute packs many users onto few instances at `max: 2` each) and the
`GET /batch` endpoint already cut requests-per-screen. **If a real Friday-night session ever
approaches the limit** (symptom: new connections failing / queueing under peak load), the
levers, in order of preference:
1. **Lower the app's `idle_timeout`** in `client.ts` (currently 120 s) so idle backends free
   their slot faster — more headroom without touching infra. (Reconnects are cheap + reliable
   in session mode, unlike the transaction-mode dead-connection issue we escaped.)
2. **Raise the Supavisor Pool Size** (Supabase Dashboard → Database → Connection Pooling),
   staying under `max_connections = 60`.
3. **Keep the app's `max` low** (currently 2) so total held backends = instances × max stays
   bounded.
Do **not** stress-test production to find the limit — heavy load testing is what degraded the
pooler during the incident. Watch the connection count during a real session instead.

### Small bug/polish punch list (2026-07-06)

- **Student Search table**: desktop `.dt` table headers are now clickable to sort (Name, Gr,
  Gender, DOB, Youth, Lifegroup, Status); Youth/Lifegroup sort by this-term % only (last-term
  stays a comparison, not a sort key), Status sorts worst-first (stopped/declining ahead of
  stable/rising). The **Quad** chip is removed from both the desktop table (its own column) and
  the mobile card (was inline in the `li-sub` line) — grade + gender already identify it.
- **Connection Audit "Stage 1" renamed to "Interacted"** everywhere it appears — the `STG` label
  map, the Integration ladder / funnel rung labels, the People-tab stage filter dropdown, and the
  executive brief's per-quad funnel viz + methodology slide. A new `helpTip` next to the
  Overview's "Interacted" rung explains it: "Everyone who attended a service, attended a
  lifegroup, or submitted a New Connect/Decision form."
- **People tab per-student badge**: the chip on each person's row (list + detail popup) changed
  from "Stage 1 · First contact" to a compact `STG_SHORT` form — "1 - Interacted", "2 - Youth",
  "3 - Regular", "4 - Lifegroup", "5 - S-Team". The Stage filter dropdown keeps the old
  "Stage N · Label" format (just with the renamed word).
- **Tooltip clipped on a widescreen laptop**: `_clampTip()` only clamped against the raw
  viewport, but `.pg` caps at `max-width:1000px` and centers itself — on a wide screen there's a
  dead zone between the true viewport edge and `.pg`'s own edge, and `overflow-x:clip` on
  `.pg`/body/html silently sliced off any popup that fell in it (worst case: the scope bar's
  Year tooltip, whose "?" sits close to `.pg`'s left edge on every Connection Audit page). Fixed
  by clamping against the nearest ancestor with clipping/scrolling overflow instead of the
  viewport.
- **Parent-number SMS default message**: `phoneLink`/`callPhone` gained an `isParent` flag (all 6
  call sites updated — the 2 that fall back between `mobile`/`parentPhone` pass
  `!s.mobile && !!s.parentPhone`). Tapping a parent's number now defaults the Message text to
  "Hey, `<First Name>`'s leader here, " instead of "Hey `<First Name>` ".
- **Funnel wording**: rung 4's label changed from "Attended a lifegroup this term" to "Attended
  a lifegroup this period" (shared `rungs` array, so this also updates the Overview's
  Integration ladder — the same wording covers both a single-term view and Year-to-date).
- **Fixed: Overview's "In a lifegroup" tile vs. the Integration ladder's "Attended a lifegroup"
  rung showed different numbers.** Root cause: `model()`'s `stage` calc promoted any active
  Student Team member straight to stage 5, *regardless of whether they currently attend a
  lifegroup* — so the ladder's cumulative "stage ≥ 4" count (rung 4) included team members with
  `gA===0`, while the Overview tile (`students.filter(s=>s.gA>0)`) correctly didn't. This wasn't
  a double-counting-multiple-lifegroups bug (each student's `gA` is already a single summed
  attendance count, term-scoped, independent of how many named groups they attended) — it was
  team status silently overriding the lifegroup check. **Fix**: stage 5 now additionally
  requires `gA>0` (`(teamActive&&s.gA>0)?5:...`), matching the ladder's own documented "counts
  people at that stage or beyond" semantics, so `stage>=4` and the "In a lifegroup" tile now
  agree for every matched student. Side effect (intentional): a team member NOT currently in a
  lifegroup now shows their true highest reached rung (e.g. "3 - Regular") instead of "5 -
  S-Team" on their People-tab badge — this surfaces exactly the "on team but disengaged from
  their lifegroup" case the audit is meant to catch, rather than masking it. `p.team` (used by
  the person-detail "Journey" popup and the executive brief's `teamN`, now computed directly as
  `m.people.filter(p=>p.team).length` instead of the old `atLeast(5)`) still reflects true team
  roster membership regardless of this reclassification, so "how many serve on Student Team"
  in the executive brief is unaffected. **Edge case closed on request**: an audit-only
  team-roster entry with no matching platform student (`caOnly` people, `s===null`) has no `gA`
  to check at all, so it used to still be promoted to stage 5 unconditionally. Capped at stage 1
  instead (there's no way to confirm they're currently in a lifegroup), so rung 4 can never run
  ahead of the "In a lifegroup" tile even with an unmatched Team CSV name. `team:true` is
  unaffected, so they still show as team in the person-detail Journey popup and in `teamN`.

### Admin/Connect Setup punch list + New Year Refresh audit backup/restore (2026-07-09)

- **New Year Refresh wizard reworked to 6 steps.** Step 1 ("Export & Finalize Baseline")
  used to both export allocations AND call `finalize-live` — split so step 1 is just
  "Export Allocations". New step 2 "Export Configuration Audit Data" downloads the
  **entire `connection_audits` table** as one JSON file (`GET /audits/export-all`) before
  step 3's Full Reset wipes it; new step 6 "Re-import Configuration Audit Data" restores
  it after step 5 (`POST /audits/import-all`, upserts by year id). Both routes are
  admin-only and registered **before** `/audits/:year` in `router.ts` — Express matches
  routes in registration order, so a param route registered first would swallow the
  static ones.
- **Full Reset now also wipes `connection_audits`.** Previously a Full Reset left last
  year's frozen audit snapshots (which contain per-student rows) behind — silently
  defeating the point of a "full" reset. `admin.service.ts`'s `reset()` now also
  `findAll()` + `delete()`s every row in that table.
- **Self-service password change**, distinct from the admin's existing "reset another
  account" flow: `POST /accounts/me/password` (verifies current password, no
  `admin:manage` needed — any authenticated actor can change their own). Key icon on
  Connect Setup, next to Export CSV. The admin's own "Reset password" flow (Accounts tab)
  now shows the new password **once**, in a copyable box — there's no way to retrieve it
  later since it's bcrypt-hashed one-way.
- **Connection Audit funnel bug — CRM overlays wiped by a partial re-upload.** The Data
  tab's `saveAudit()` replaces the WHOLE year's snapshot; if the admin re-uploaded just
  Service/Group attendance without also restaging Team/Connect/Decision/Flows, those
  overlays silently reset to `[]` (Zod defaults), collapsing the "Interacted" funnel rung
  down to equal "Came to Youth" (the only source of stage-1-only people is
  `hasConnect`/`hasDecision` marks + unmatched `caOnly` names). Fixed with a `carry()`
  fallback in `saveAudit()`: an unstaged slot now falls back to `AUDIT.uploads.<kind>`
  from the currently-loaded year instead of defaulting to empty; the Data tab UI shows
  "N rows carried over from `<year>`" so it's not silently invisible.
- **Quad funnel breakdown couldn't see unmatched people, even after the fix above.**
  `rFunnel()`'s per-quad panel filtered on `p.s && p.s.quad===q` — an unmatched
  (`caOnly`) Connect/Decision submitter has `p.s===null`, so they were structurally
  excluded from every quad's breakdown even though the overall funnel counted them. Since
  the Connect/Decision CRM export actually carries grade + gender columns, `parseRows`/
  `parseMatrixRows` now read them (optional — absent on exports that don't have them), and
  every `people.push(...)` (both matched-student and `caOnly`) now carries a `quad` field
  — computed via a client-side `computeQuad(grade, gender)` (mirrors
  `src/core/types/enums.ts`) for `caOnly` people, straight from `s.quad` for matched ones.
  All 4 quad-filtering call sites (`rFunnel`, the People tab's quad filter, the exec
  brief's `quadFunnelViz`) now read `p.quad` instead of `p.s.quad`. The one exception,
  `exportQuad()`'s follow-up CSV export, still requires `p.s` truthy — it dereferences
  `p.s.gT`/`p.s.grade`/`p.s.ph`, which only a matched student record has.
- **Leader self-service grade broadening, gender stays locked.** A grade/quad login
  editing a leader (Connect Setup's pencil icon) can now check grades outside their own
  bracket, so they can see and connect students from those grades too — same rationale
  as the SMS-template carve-out: most leaders are auto-created by CSV import
  (`createdByGrade: null`), so the general `update()` endpoint's ownership check would
  otherwise reject almost everyone. New `PATCH /leaders/:id/grades` /
  `LeaderService.updateGrades()` skips that check entirely and only ever touches
  `grades`. In the Edit Leader modal, `lockGender = role==='grade'||role==='quad'` shows
  gender as a disabled, read-only select for those two roles (admin/director unaffected);
  `submitEditLeader()` sends grades through the new endpoint (always succeeds) and
  name/active best-effort through the general endpoint (silently skipped if you don't own
  the leader — that's a pre-existing restriction, not a regression).
- Also: Data tab gained a "Go to Import" shortcut; allocations export is now date-stamped
  (`allocations-YYYY-MM-DD.csv`, matching the audit backup file); `.pg`'s bottom padding
  halved (was `76px`, pure dead space on desktop where the mobile bottom-nav it was
  clearing doesn't even render); the Connect Setup "Add Students" picker no longer
  repaints the page behind it on every single add/remove (only once, on close) — the
  per-toggle repaints were clobbering the admin's scroll position; Health tab cards gained
  a profile-icon button; student profile's "Leader Assignments" dropped the redundant
  "Connect →" button and the "search a leader to assign" results list (not the already-
  connected list) got the same capped-scroll treatment as Connect Setup's student
  preview, with gender/grade dropped from each row.
- **Add Students picker now actually offers a broadened leader's other grade(s).**
  `updateGrades` (above) only ever touched the *Leader* record's `grades` — but the
  picker's underlying student pool came from `GET /students` (and the leader-card counts
  from `GET /connections`), both server-scoped by the *actor's own* single
  grade/bracket (`student.service.ts`'s `list()`, `connection.service.ts`'s `listAll()`).
  So broadening a leader to a second grade didn't change what the picker could even see —
  the other grade's students never reached the client. Fixed with a `crossGrade` filter
  flag: when true, `list()`/`listAll()` swap the "own grade/bracket + own gender" check
  for "own gender only" (the same relaxation `assign()`, `student.service.ts`'s
  `get()`/`search()`, and the CSV export already applied — see the "cross-grade connect
  exception" comments). Wired as two extra `/batch` sections (`studentsConnect`,
  `connectionsConnect`) and two dedicated cache keys (`/students?crossGrade=1`,
  `/connections?crossGrade=1` — `Cache.del()` now also matches `?`-suffixed variants of a
  base path) so Health/People/Data/Trends/Birthdays/My Students keep the narrower,
  grade-scoped `/students` and `/connections` untouched — **only** Connect Setup's own
  `CONNECT_PATHS` requests the widened variant. `exportCsv` (Connect Setup's "Export CSV"
  button, the only caller) got the same own-gender-only swap, unconditionally, so a
  leader's cross-grade connections don't silently vanish from their own export either.
  Within each of the picker's three buckets (not assigned / assigned elsewhere / assigned
  here), students now sort with the logged-in login's own grade(s) first
  (`_pickByOwnGradeFirst`, derived from `S.user.grade` or `quadGrades(S.user.quad)`), so a
  broadened leader's home grade still reads at the top with the extra grade below it.

### Connect Setup: "unallocated students" scoping + sort fix (2026-07-10)

- **Bug**: a quad login's Total/Connected/Pending stat tiles and "Students not Connected"
  dropdown were inflated by students outside their own quad bracket — e.g. a Girls Yr 7–9
  quad login also saw Girls Yr 10–12 students counted there. Root cause: both are computed
  from `students`, which Connect Setup fetches with `?crossGrade=1` so the leader cards and
  Add Students picker can surface other-grade/other-bracket same-gender students to connect
  (intentional — see the "Add Students picker" entries above) — but that widened list was
  being reused, unfiltered, for the aggregate counts too.
- **Fix**: `renderConnectView()` now derives `connectable` through an `inOwnScope` filter
  (`s.quad === u.quad` for quad logins, `s.grade === u.grade` for grade logins, unfiltered for
  director/admin) before computing Total/Connected/Pending and the unallocated list.
  `students`/`_aS.students` itself stays unfiltered, so the leader cards and the Add Students
  picker still show/allow cross-grade connections exactly as before — only the two aggregate
  displays were narrowed. Verified in-browser (a quad login's totals dropped to match its own
  bracket; a leader was still connectable to an out-of-bracket same-gender student via the
  picker, and that connection didn't move the quad's own counts).
- **Also**: the "Students not Connected" list now sorts grade-ascending first, then
  alphabetically within each grade (`unallocated.sort(...)` in the same function) — relevant
  for quad/director/admin logins whose list spans multiple grades; a no-op for grade logins.

### Generalisation phases 1–5, 8 — "Connection Made Simple" → "Youth Connection" (2026-07-10)

A separate Claude session ("Generalisation of the app" project, sibling docs
at `../Generalisation of the app/`) is making this app deployable by **any**
youth ministry, not just YS Brisbane, via per-deployment configuration. This
session owned phases 1–5 and 8 of the design (`03-generalisation-design.md`);
phases 6–7 (structure/gender config, the new `leader` role) are a separate
Opus session — see `11-handoff-to-opus.md` for what it needs to know. Work
happened on branch `generalisation-phase-1` (rollback tag `pre-generalisation`
on `master`); **the YS Brisbane invariant held throughout**: with
`ministry_config = '{}'` (the default), every screen/import/export behaves
identically to before this work, verified after every phase.

- **Config storage**: one `ministry_config jsonb` column on `app_settings`
  (migration `018`), `MinistryConfigSchema` + `MINISTRY_CONFIG_DEFAULTS` in
  `src/core/ministry-config.ts` — the single source of truth every repo and
  the SPA read from. `PATCH /settings` deep-merges a partial `ministryConfig`
  patch via `mergeMinistryConfig`; a submitted `logoSvg` is sanitised
  (`sanitiseLogoSvg`, a denylist — not a real HTML parser). **Fixed a
  pre-existing bug while here**: `settings.service.ts.update()` now calls
  `invalidateOverviewCache()`/`invalidateTrendsCache()`/`invalidateLgStatsCache()`
  on every write — previously a settings change (even `termGapDays`) served
  stale stats for up to 60s with no invalidation hook at all.
- **Youth Ministry Setup wizard** (Admin → Settings → "Open Setup"): a
  4-preset picker (large-graded-au / two-bracket / small-flat / micro) that
  PATCHes the full merged `ministryConfig` + preset-scaled
  `serviceMinAttendance` in one call. **Gotcha fixed during implementation**:
  switching presets must always merge onto a clean `MINISTRY_CONFIG_DEFAULTS`
  baseline, never onto whatever the previous preset left in place — otherwise
  picking "large-graded-au" after "small-flat" wouldn't actually revert
  `modules.connectionAudit`/`roles.model`/etc. Steps 1–5 (branding/
  terminology/structure/roles/modules fine-tuning UI, beyond the preset
  picker) are stubbed (`/* SETUP-STEP-STUB */` in `renderMinistrySetup()`) —
  filled in by later work.
- **Theming**: the CA module's `--ca-*` CSS vars now re-point at the main
  `--accent`/`--navy`/etc. tokens (previously duplicated by value); the
  funnel/ladder colour ramps (previously 5 hardcoded hex arrays, two places)
  now generate from `branding.accent` via HSL lightness steps
  (`accentRamp`/`accentRampPairs`); the Executive Brief deck's inline CSS
  template interpolates `branding.accent`/`navy` and finally reads the
  long-dormant `ministryName` hook from the right (nested) path. Status/quad
  colours are deliberately NOT configurable (categorical, not brand).
  `applyTheme()`/`L()` (label lookup) live near the top of `index.html`'s
  main script, right after the `S` state object; a `THEME_CACHE_KEY`
  localStorage blob lets the login screen theme itself synchronously before
  `/settings` even resolves. **`GET /settings` is now fetched unconditionally
  at boot** (`boot()`), not just post-login as before — it's a public route,
  so the login screen genuinely can be themed pre-auth now, which it
  previously wasn't despite being able to.
- **`GET /manifest.json`** is now a dynamic route (`manifest.controller.ts`)
  templating name/short_name/theme_color from settings — the static
  `public/manifest.json` was **deleted** (Express serves static files before
  the route table, so it would otherwise always shadow the dynamic route).
  `brandMark()` renders a sanitised custom `logoSvg` when set.
  `install.html` derives its domain from `location.host` instead of a
  hardcoded production URL.
- **Label sweep**: `L(key)` (backed by `ministryConfig.labels`) replaced a
  first pass of "Lifegroup"/"Lifegroups" literals across Home, Trends,
  Health, Student Search, Connect Setup's xlsx export, and the CA module's
  tab bar + Lifegroup Health heading. **Deliberately not touched**: "Friday"
  (tied to `structure.serviceDayOfWeek`, which is functional — it also drives
  `_fridayLabel()`'s date math and week bucketing — and is phase 6/Opus
  scope, not just a label), "Student Team"/"Youth" labels beyond what's
  listed above, and the rest of the CA module's copy. `lgDisplayName()` now
  reads `labels.groupNameStrip` (prefix list) and `labels.smallGroup`
  (suffix) instead of the hardcoded `"Brisbane - YS - "` / `"Lifegroup"`.
- **Module toggles** (`ministryConfig.modules.*`): Connection Audit
  (`connectionAudit`, default `true`) — nav items gone, `ca-*` routes bounce
  home, and `ConnectionAuditService`'s 6 remaining methods (down from 7 —
  **the orphaned `POST /audits/finalize-live` route, controller method,
  service method, and its only caller `buildLiveLifegroupStats` helper were
  deleted** — confirmed zero SPA callers first) throw a new 404-shaped
  `ModuleDisabledError` via `requireCaModule(settings)` when off. The New
  Year Refresh wizard's steps 2/6 (audit backup/restore) render as "skipped"
  and count as satisfied for gating when CA is off, so step 3 (Full Reset)
  doesn't permanently block waiting on an audit export that'll never happen.
  Push notifications (`pushNotifications`, default `false` — matches
  today's hidden state) replaces all 5 `PUSH-HIDDEN` comment sites with a
  real config check (header bell + badge, `navItems()` × 4 roles, the
  notifications route, `doLogin()`'s permission request). Lifegroups
  (`lifegroups`, default `true`) hides the Trends tab, Home's "Lifegroups by
  Quad" section, and quad's per-grade lifegroup dropdown — display-only, the
  underlying at-risk/aggregate math already tolerates zero lifegroup data.
  `exportGuides` (`'elvanto'` default / `'hidden'`) gates both Elvanto
  walkthrough buttons.
- **Import atomicity** (the top-priority item, independent of
  generalisation): both importers' delete+repopulate phases now run inside
  one Postgres transaction (`sql.begin()`) when `PERSISTENCE=supabase` — a
  crash/kill between the truncate and the repopulate previously left the
  tables **truncated-but-empty** (a documented data-loss gap). New
  `src/repositories/supabase/with-transaction.ts`'s `bindImportRepos(tx)`
  rebuilds the 8 Supabase repos an import touches, bound to the
  transaction-scoped client instead of the shared module-level one; in-memory/
  JSON mode is unaffected (`sql: null`, no transaction primitive needed).
  Verified with a fake transactional `sql.begin` that snapshots/restores
  in-memory repos around a simulated mid-write throw
  (`import-atomicity.test.ts`) — a real kill-mid-import run against a
  scratch Supabase project is still the recommended manual check before this
  ships to production, since no fully-in-memory test can prove a real
  Postgres `ROLLBACK`.
- **Import report**: `ImportResult`/`GroupImportResult` gain a `report` field
  (`skippedRows` with a readable per-field reason, `nameCollisions` for two
  rows in the same upload sharing a name key) — no more silent `continue` on
  a bad row. The Import screen shows a "View import report" button when
  nonzero, reading from a module-level `_lastImportReport` var rather than
  inlining JSON into an `onclick` attribute (same apostrophe-escaping
  concern as `_smsHref()` elsewhere in this file).
- **Import dialect config** (`ministryConfig.import.*`): `dateOrder`
  (`'DMY'` default) reinterprets an ambiguous slash-separated date, but any
  date component `>12` auto-resolves to "day" regardless of the setting.
  Grade text (`"Year 7"`, `"Grade 9"`, `"7th"`) is now preprocessed into a
  bare integer before the existing 7–12 range check (range itself stays
  hardcoded — phase 6/Opus owns `structure.gradeMin/gradeMax`). `leaderTag`
  (`'leader'` default) makes the group importer's `"(leader)"` name-tag
  regex configurable. **Not done** (flagged, not silently skipped):
  client-side header-synonym matching and the long-format
  (Planning-Center-style) CSV pivot — both need real fixture data from a
  non-Elvanto export to implement safely.
- **Packaging**: `package.json` renamed `connection-made-simple` →
  `youth-connection` (code-side only — GitHub/Vercel dashboard renames are a
  manual owner step, not attempted). New `APP_ORIGIN` env var
  (`src/config/env.ts`) — production CORS falls back to it before the
  hardcoded YS Brisbane URL, so a new deployment sets one env var instead of
  editing code; the existing deployment needs no env changes. New
  `README.md` + `docs/DEPLOYING.md` covering the full deploy path incl. the
  statement_timeout and session-mode-pooler gotchas already documented
  elsewhere in this file.
- **SW cache**: bumped once per phase that touched `public/index.html`/
  `sw.js` (`cms-v22` at the start of this work → `cms-v27` by the end);
  `API_RE` gained `manifest\.json`.
- **Test suite**: 190+ → 237, all additive (no existing test was modified to
  make it pass, per the YS Brisbane invariant) — `ministry-config.test.ts`,
  `settings.service.test.ts`, `manifest.controller.test.ts`,
  `import-atomicity.test.ts` are new; `connection-audit.service.test.ts` lost
  3 `finalizeFromLive` tests and gained 2 module-toggle tests (net −1);
  `import.service.test.ts` gained report + dialect coverage.

### Generalisation phases 6–7 — structure config + the `leader` role (2026-07-11)

The Opus session that owned design doc §8 phases 6 (structure config) and 7 (the
new `leader` role). Built on the phase 1–5/8 `ministryConfig` foundation; the **YS
Brisbane invariant held throughout** — all-defaults (`ministry_config = '{}'`) is
byte-identical to before, and the full prior test suite (237) passes unmodified.
237 → **281 tests** (all additive). Branch `generalisation-phase-1`; migrations
`019`/`020` are additive (`add column if not exists`), so the `pre-generalisation`
rollback recipe still holds.

- **Multi-grade grade accounts (§5.1a, phase 6a).** A `grade` login can now span
  **one or more** grades. `User`/`Actor` gained `grades: Grade[]` + an explicit
  `gender` field **alongside** the legacy single `grade` (NOT replacing it — the
  existing `access-control.test.ts` builds actors with `grade` and old signed
  tokens carry only `grade`, so both must keep working). `access-control.actorGrades()`
  returns `grades ?? [grade]`; every `actor.grade` scoping read (`canAccessGrade`
  grade case, `leader.service`, `connection.service`, `lifegroup-stats`,
  `actor-key` — which MUST key on the full set or two multi-grade accounts collide
  their scoped caches) uses it. `deriveActorGender` prefers the explicit gender,
  falling back to the `grade7g`/`grade7b` username convention for untouched
  single-grade accounts. Account form: grade `<select>` → grade checkboxes
  (`ugcb`) + a gender-scope select. `account.service` stores `grade = grades.length===1 ? grades[0] : null`.
- **Structure config threading (§5.1/§5.2, phase 6b).** `access-control`'s
  `canAccessGrade`/`genderScopeOf`/`canAccessGender`/`canAccessStudent` gained an
  **optional** `StructureScope` param (`{cohortModel, genderPolicy}`) — undefined =
  today's `grades-quads`+`strict`, so existing tests/callers are unchanged.
  **⚠ Superseded 2026-07-12 — see "Bug 8 follow-up" below.** This paragraph
  originally had cohortModel `'none'` short-circuit BOTH grade AND gender
  scoping to visible for everyone (the design's "known trap"). That's no
  longer true: a Simple ministry's grade/quad accounts are now scoped to
  their assigned grades/gender exactly like a Complex ministry's. Left here
  for history; don't rely on the old behavior.
  `genderPolicy` `soft`/`off` drops gender scoping (still true, independent
  of cohortModel). Services pass
  `settings.ministryConfig.structure`; `overview` + `student` gained an **optional**
  `settingsRepo` (defaults when absent, so their existing test constructors are
  unmodified). Under `'none'`, `overview`/`trends`/`lifegroup-stats` return empty
  `byQuad`/`byGrade` (whole-ministry totals still show — nothing excluded; the SPA
  self-hides the empty sections + `_cohorted()` guards the student-derived
  "Connection by Grade").
- **Grade range** is `gradeRange(structure)` (`src/core/ministry-config.ts`),
  replacing every literal `[7..12]` iteration in the aggregate builders and the
  SPA (`_gradeList()`); the import `ServiceRowSchema` is now a factory bound to
  `gradeMin`/`gradeMax`, so an out-of-range grade is *reported*, not silently
  nulled.
- **serviceDayOfWeek** generalises `terms.ts`'s `saturdayOf(iso, serviceDayOfWeek=5)`
  to "week ends the day after the service day" (Friday default = the old Sat–Fri
  buckets, byte-identical). Threaded through `aggregates.ts`, `import.service.ts`
  (its own `weekStartOf` now delegates to `saturdayOf` so the anchor can't drift),
  `trends`, `lifegroup-stats`. SPA: `_fridayLabel`, the follow-up "Not Seen Last
  {day}" heading, the Trends tab, and the settings help text read `_serviceDayName()`.
  `year-aggregates.ts` (Connection Audit only) is deliberately left Friday-anchored
  — CA week math is out of the live-app scope. Tested in `service-day.test.ts`
  (a Wednesday-service ministry's term boundaries).
- **The `leader` role (§5.2, phase 7).** A junior leader: read-only
  (`student:read`+sensitive, `atrisk:read`, `leader:read`; **no** `connection:write`,
  `leader:write`, `overview:read`, import, admin), bound to one `Leader` record via
  `Actor.leaderId`/`User.leaderId`, seeing **only that leader's connected students**.
  Enforced server-side in every reachable read path: `student.service`
  list/get/search, `atrisk.service` (both gained an optional `connRepo`),
  `connection.service` (`listAll` own-only; `listByLeader`/`listByStudent` guarded
  by `assertLeaderSelf`/a connection check), `followup.leaderFollowup` (forces the
  actor's own `leaderId`). `overview` is simply not permitted (403). SPA: a slim
  `navItems` (Home / My Connections / Health / Birthdays), a lite `renderLeaderHome`
  (own follow-up, no overview fetch), `getMyLeaderId()` locks a leader login to its
  bound record, `_roleLabel()` drives config-aware role badges + the account-form
  role dropdown (flat model → Youth Pastor / Senior Leader / Junior Leader) + a
  leader-record picker; `render()` bounces a leader off any other page. Youth
  pastor / senior leader are pure label mappings onto admin / director.
- **Youth Ministry Setup wizard**: the Structure + Roles fine-tuning step (was a
  `SETUP-STEP-STUB`) is now real — cohortModel / grade word / grade range / gender
  policy / service day / role model / role labels, with an **orphaned-accounts
  warning** when switching cohortModel to `'none'` with grade/quad accounts present
  (never deletes — just flags). Branding/terminology/module editors remain phase
  2/3 stubs. **Grade range and the orphan warning were reworked 2026-07-12 —
  see "Bug 8 follow-up" below** (grade range is now an "Include Grade 6"
  toggle, not raw min/max fields; the warning now points at "Apply account
  layout" instead of manual Accounts edits).
- **Deliberate choices / deviations** (also in `../Generalisation of the app/12-handoff-final.md`):
  the seed (`src/seed.ts`) stays graded — it IS the YS Brisbane reference; a flat
  deployment uses the small-flat preset + manual account creation (design §7.1).
  Push `getUsersForTarget` is left graded-only — correctly **inert** under flat (no
  grade/quad accounts exist to target, and push defaults off). Manual student
  create/update (`student.service`) keeps a 7–12 bound (import is the config-aware
  path; manual add is admin-only and rare). `leader.service`'s grade/quad-scoped
  leader *management* stays strict-gendered (only reachable by grade/quad logins,
  which only exist under the graded model). Follow-up's leaderId override
  silently self-scopes a `leader` (returns their own list, never 403) — secure by
  construction.
- **SW cache**: `cms-v28` → **`cms-v31`** across phases 6a/6b/7. No new top-level
  API route was added, so `API_RE` is unchanged.

### Generalisation went LIVE + first-deploy incidents + Setup editors (2026-07-11)

The whole generalisation branch (phases 1–8, not just 6–7) was merged to `master`
and deployed to production (first time any of it went live — prod was
pre-generalisation `cms-v22`, DB at migration 017). Prod Supabase
(`ltcblcudlzlzfcyzlhpc`) migrated 017 → **020** (additive `add column if not
exists`: 018 ministry_config, 019 users.grades/gender, 020 users.leader_id);
existing data untouched (20 users / 677 students / 60 connections),
`ministry_config = '{}'` so behaviour is byte-identical. App name is now **"Youth
Connection"** (branding default). Two incidents surfaced on first real use, both
fixed:

- **`/manifest.json` served the SPA HTML** (broke the PWA manifest). Phase 8
  deleted static `public/manifest.json` for a dynamic Express route but didn't add
  it to **`vercel.json`'s `routes[]`** (which runs before Express). Fix: route
  `^/manifest\.json` → `/api/index.ts`. **Lesson: a new top-level route served by
  the function on Vercel must be added to `vercel.json` routes[], not just the
  Express router** (and to `sw.js` `API_RE`).
- **jsonb double-encoding → full app lockout.** Saving Setup stored
  `ministry_config` as a jsonb *string*; `getSettings()` (run on ~every request)
  threw in `MinistryConfigSchema.parse` → every `/settings` 500'd → whole SPA +
  Admin unreachable, unfixable in-app (recovered via `update app_settings set
  ministry_config='{}'::jsonb`). Root cause: `` `${JSON.stringify(cfg)}::jsonb` `` —
  postgres.js sees the `::jsonb` cast, types the param jsonb, and re-`JSON.stringify`s
  the already-stringified string. **Fix: write jsonb via `sql.json(value)`, never
  `JSON.stringify(x)::jsonb`** (fixed `supabase.settings.ts` + `supabase.users.ts`
  grades — same latent bug, never yet triggered on prod; `connection-audit.ts`
  already did it right). Also made the READ resilient (`parseMinistryConfig`:
  unwrap a stringified blob, fall back to defaults instead of throwing) so a bad
  config can't brick the app again. Tests: `ministry-config-encoding.test.ts`.

**Setup wizard — Branding / Terminology / Modules editors + deploy hand-off (built
2026-07-11).** The wizard's `renderMinistrySetup()` (public/index.html) now has
fully-editable **Branding** (`branding.*` incl. colour pickers + logo SVG),
**Terminology** (`labels.*`, incl. `groupNameStrip` as a per-line array via
`_setupSetList`), and **Modules** (`modules.*` toggles + `exportGuides`) cards,
alongside the existing Structure/Roles. No backend change — all flow through
`saveMinistrySetup()` → `PATCH /settings`. A final **"Deploy this setup to another
church"** card synthesises a tailored Supabase+Vercel deployment guide from the
current config (`_deployGuideText`), copyable/downloadable (`copyDeployGuide` /
`downloadDeployGuide`). Still stubbed: none of Setup — Branding/Terminology/Modules
were the last stubs. SW `cms-v31` → **`cms-v32`**. (Handoff brief that scoped this:
`SETUP-EDITORS-HANDOFF.md` at repo root.)

### Rename completed: "Connection Made Simple" → "Youth Connection" → "YS Connection" (2026-07-11)

Phase 8 (above) deliberately left the GitHub repo and Vercel project names untouched
("manual owner steps, not attempted"). Those manual steps are now done, in two
hops on the same day:

1. `citipointe-youth/connection-made-simple` → `citipointe-youth/youth-connection`
   (GitHub repo rename, `gh repo rename`; GitHub auto-redirects the old URL).
2. `citipointe-youth/youth-connection` → `citipointe-youth/ys-connection` — the
   owner decided the generic "Youth Connection" name should instead be
   "YS Connection" (matches `ministryConfig.branding.ministryName` default,
   "Youth Society Brisbane"). Same GitHub rename mechanism, plus the Vercel
   project was renamed via the dashboard (`connection-made-simple` → `ys-connection`
   directly, skipping the intermediate name) — production URL is now
   `https://ys-connection.vercel.app`. `APP_ORIGIN` was updated in Vercel's
   production env vars to match, and `vercel link` was re-run locally to refresh
   `.vercel/project.json` (project ID unchanged: `prj_jL3k8C9zHYw3lEbCFPNnvEct2DUX`).

Code/doc changes that went with it: `package.json` name → `ys-connection`;
`MINISTRY_CONFIG_DEFAULTS.branding.appName` (and the SPA's mirrored
`MINISTRY_CONFIG_DEFAULTS_CLIENT`) default → **"YS Connection"** (was "Youth
Connection" — this changes the default seen by anyone who hasn't set their own
branding in Setup, i.e. still-current YS Brisbane); `<title>`/install-page/push
fallback strings in `public/index.html` / `install.html` / `sw.js` updated to
match; SW cache bumped `cms-v32` → **`ysc-v33`** (also dropped the `cms` —
"Connection Made Simple" — abbreviation from the cache-name prefix); `env.ts`'s
`PROD_DEFAULT_ORIGIN` fallback and `.env.example`'s CORS comment updated to
`ys-connection.vercel.app`. `ministry-config.test.ts` / `manifest.controller.test.ts`
updated to assert the new default. Local git remote repointed to
`github.com/citipointe-youth/ys-connection.git`.

**Not renamed (deliberately)**: historical/dated CLAUDE.md sections above this
one, `CHANGELOG.txt`, and old `docs/superpowers/plans|specs/*` — they're a
point-in-time record of what the app was called when that work happened, not
live documentation. If a ministry other than YS Brisbane deploys their own copy
via Setup, "YS Connection" is just the seed default — it's fully overridable
(`branding.appName`) the same as before.

### Roles fix: dropped the "Senior/Junior Leader" relabeling; roles are now on/off toggles, not renames (2026-07-11)

Phase 7 (above) shipped `roles.model` ('graded'/'flat') + `roles.labels`
(free-text per-role names), defaulting the flat preset to Youth Pastor/Senior
Leader/Junior Leader — a misreading of what was actually wanted. **Senior/
junior was meant to describe a GRADE RANGE split (senior = Yr 10-12, junior =
Yr 7-9), not a pair of roles with different permissions.** That's already
covered by the existing multi-grade `grade` account feature (§5.1a, phase
6a) — assign one broad account grades 10-12 for a "senior" login, another
7-9 for "junior"; no role change needed for that at all.

- **`roles.model`/`roles.labels` removed**, replaced by `roles.enabled: {
  director, grade, quad, leader }` (`src/core/ministry-config.ts`). Role
  names are fixed everywhere — Admin, Director, Grade, Quad, Leader — no
  per-deployment renaming. Admin always exists and isn't toggleable;
  Director/Grade/Quad default **on** (today's YS Brisbane behaviour under
  `{}` config); Leader defaults **off** for every preset, including
  small-flat/micro (previously it was silently on under 'graded' and
  relabeled "Junior Leader" under 'flat' — neither was actually wanted by
  default). Grade is toggleable too (not fixed-on like Admin) so a ministry
  can run on Leader-only logins instead of Grade logins if it wants.
- **`small-flat`/`micro` presets** now set `roles.enabled: { director: false,
  quad: false }` instead of relabeling — a simple ministry manages everything
  through Admin + (multi-grade) Grade accounts by default, with
  Director/Grade/Quad/Leader all available as opt-in toggles in Setup →
  Roles if a ministry wants a different mix.
- **SPA**: `_roleLabel()` returns the fixed name directly (no more reading
  `ministryConfig.roles.labels`); `_accRoleOptions()` (the account-creation
  role `<select>`) now reads `roles.enabled.{director,grade,quad,leader}`
  instead of `roles.model === 'flat'` — admin is unconditional, the other
  four are only offered when enabled (an already-assigned-but-since-disabled
  role stays selectable for that one account, same guard as before). Setup's
  Roles card shows Admin as a fixed checked-and-disabled row (so its tooltip
  is reachable even though it's not a real toggle) above four checkboxes
  (Director/Grade/Quad/Leader), replacing the old "Role model" dropdown +
  free-text label inputs.
- **UI-only, same as the field it replaced**: nothing server-side gates
  account creation by `roles.enabled` (mirrors how `roles.model` was never
  enforced server-side either) — `account.service.ts`'s role validation is
  unchanged. No live accounts were affected: prod `ministry_config` is still
  `{}`, so Director/Quad stayed on and Leader stayed off throughout this
  change.
- Tests: `ministry-config.test.ts` updated (`roles.enabled.*` assertions
  replace the old `roles.model`/`roles.labels` ones).
- **SW cache**: `ysc-v34` → `ysc-v35` → `ysc-v36` → **`ysc-v37`** (public/
  index.html changed three times: the initial toggle rework, adding the
  Grade toggle + the fixed Admin row, then the syntax-error fix below.
- **Incident: white screen in production** — the Admin row's `helpTip(...)`
  call used a single-quoted JS string whose text contained an apostrophe
  ("...and it **can't** be turned off."), which closed the string early and
  left a trailing `t be turned off.')` as invalid tokens — a hard
  `SyntaxError` in the app's one inline `<script>` block, so **nothing** ran
  (not just that row — the whole SPA). The app already has this exact
  pattern flagged: earlier `helpTip(...)` calls whose text contains an
  apostrophe use **double quotes** instead (e.g. the Health tab's "hasn't
  been to Youth..." tip) — this one didn't follow it. **Lesson**: any
  contraction (can't/won't/doesn't/isn't/hasn't/...) inside a single-quoted
  JS string literal in this file is a syntax error, not just a stray
  character — grep `helpTip\('[^']*'(t|s|re|ve|ll|d)\b` (or similar) for
  apostrophes before shipping new inline help text, and verified here with
  `node --check` on the extracted `<script>` body (533–6842), the same
  syntax-check convention documented for Project 1's single-file apps.

### Bug/polish punch list — password-change token bug, role-disable cascade, Youth Setup reorg (2026-07-11)

- **Fixed: blank page after first-login "Set Password & Continue"** (previously
  needed refresh + sign out + sign back in). Root cause: `mustChangePassword`
  is baked into the signed session token at login (`toActor()`/`signSession()`
  in `auth.service.ts`) and `resolveToken()` trusts the embedded actor with no
  DB re-check — so `changeOwnPassword()` clearing the DB flag left the
  client's existing token still enforcing `MUST_CHANGE_PASSWORD` (403) on
  every route except the 3 allowlisted ones for the rest of its 12h TTL. Only
  a fresh login (new token) worked around it. Fix: new `AuthService.
  issueTokenFor(userId)` mints a token from current DB state;
  `POST /accounts/me/password` (`account.controller.ts`) now returns
  `{ ok, token }` and both frontend call sites (`submitMustChangePassword`,
  the Connect Setup "Change Your Password" modal) call `API.setToken()` with
  it before re-rendering.
- **Fixed: Branding logo-mode buttons ("Default mark"/"Paste SVG"/"Upload
  image") didn't work.** `logoMode` was derived purely from whether
  `branding.logoSvg`/`logoImage` already had content — so picking "Paste SVG"
  before typing anything left both still `null`, and the next re-render
  recomputed `logoMode` back to `'default'`, snapping the picker (and the
  textarea/file input it gates) back before you could use it. Fix: a
  transient `_logoModeOverride` var, set the instant a mode button is
  clicked, used as the fallback when neither field has content yet; reset
  whenever the setup draft is freshly loaded (`_ensureSetupDraft`).
- **New: disabling a role in Youth Setup (Director/Grade/Quad/Leader) now
  deactivates its accounts and hides its Accounts-screen section.**
  `settings.service.ts`'s `update()` diffs `roles.enabled` before vs. after
  the merge; any role that flips `true→false` bulk-deactivates every
  currently-active `User` of that role (`IUserRepository.findByRole`).
  Re-enabling a role later does **not** auto-reactivate — deliberate, so an
  account an admin separately deactivated for an unrelated reason isn't
  silently un-deactivated by an unrelated toggle; reactivation stays manual
  via the existing per-account lock/unlock. The Accounts screen
  (`renderAdminView`) now also skips a role's whole group when
  `roles.enabled.<role> === false`, not just when it happens to have zero
  accounts.
- **My Students: added the same "Custom Message Template" editor Home's
  Follow Up section has**, right below the leader picker once a leader is
  selected — so a leader doesn't have to go back to Home to edit it. Both
  spots now share `_smsTemplateBoxHtml()`/`_saveSmsTemplate()` (was
  Home-only, named `_saveFollowupSmsTemplate`).
- **Youth Setup reorg**: "Save Youth Setup" moved from the top of the tab to
  the bottom, now behind a confirm modal (`confirmSaveMinistrySetup()` — it's
  live config for every user, not a per-device preference); the preset-picker
  card gained a "Pre-set Configurations" heading; the standalone Attendance
  card is gone — Min Attendance/Term Gap moved to the bottom of Structure &
  Roles with `helpTip()` tooltips instead of inline paragraphs, and the
  "students are flagged as..." paragraph (redundant with the Health tab's own
  tooltip) was dropped; Terminology's disabled/read-only "Small group
  (plural)" row was removed (the plural has been auto-derived since the
  2026-07-11 entry above — this just stopped rendering the leftover dead
  field); the standalone Import card was merged into Modules (now "Modules &
  Import"); Branding's "Reset to defaults" button moved into the card's own
  header row, next to the title, via a new optional `headerActionHtml` param
  on `_setupCard()`.
- **Dropdown `<select>` styling**: `.fs` previously had no custom arrow at
  all (relied on each browser's inconsistent native one, with no reserved
  padding) — added a fixed, centered SVG chevron + right padding so the
  arrow position is consistent and doesn't crowd the selected text.
- **Lifegroups module gating gaps closed**: the Home hero card's two
  "Lifegroups" summary-table rows (this-term and prev-term) and the Import
  screen's "Service or Group" copy/tooltip were unconditional even when
  `modules.lifegroups` is off — everywhere else on Home already respected it.
  New shared `_lifegroupsOn()` helper (mirrors `_exportGuidesOn()`).
- **Trends export** (`exportTrendsCSV`, quad/director/admin only): now builds
  an `.xlsx` via the same vendored SheetJS used elsewhere (was a fixed-name
  `trends.csv` text blob) with a dated filename (`trends-YYYY-MM-DD.xlsx`);
  the Grp/lifegroup columns are now also skipped when `modules.lifegroups`
  is off, same gating as above.
- **SW cache**: `ysc-v39` → **`ysc-v40`**.
- New/updated tests: `auth.service.test.ts` (`issueTokenFor`),
  `settings.service.test.ts` (role-disable deactivation cascade, 5 new cases).

### Admin bug/improvement batch (2026-07-12)

An admin-reported punch list, worked through in three passes. Bugs 1-7 below are
independent small fixes; bug 8 (cohort model / account layout) grew into the
biggest change and is split into its own subsections.

**Bugs 1-7:**
- **Grade-change auto-rename now also syncs display name** (was: username only).
  `suggestEmail()` (public/index.html) tracks `_acctAutoEmail`/`_acctAutoName` —
  a field is only overwritten while its current value still equals what this
  logic last generated (or is empty), so a grade/gender edit keeps a
  still-default name in sync but never clobbers a name the admin already
  customised (bug 3's ask). Scoped to `role==='grade'` only.
- **Seed grade accounts get an explicit `gender`** — see the Seed demo accounts
  section above (migrations `0003`/`0004`).
- **Inactive accounts sort to the bottom of their role group** in Accounts
  (`renderAdminView`) — a stable sort layered after the existing grade-number/
  quad-label ordering.
- **Grade/quad account rows get a light girls/boys background tint**
  (`.li.acct-girls`/`.acct-boys`) via the existing `_loginGender()` helper.
- **Allocation re-import gained an opt-in "auto-create unmatched leaders"
  checkbox** (Admin → Data tab, default OFF). `POST /connections/allocations/
  import` takes `autoCreateLeaders: true`; `deriveLeadersToCreate()`
  (`connection-allocations.ts`) derives grade(s)/gender from whichever
  already-matched students in the file are paired with that unmatched leader
  name (null gender if they disagree), `connection.service.ts` creates the
  `Leader` rows via `leaderRepo.saveMany` before planning the sync so those
  rows resolve as matched instead of landing in `unmatchedLeaders`. Report
  gained `leadersCreated`.
- **Youth Setup terminology fields got tooltips** explaining where each one
  actually shows up in the app (see the terminology-wiring entry just below —
  two of these tooltips went stale within the same day and got corrected).

**Bug 8 — Cohort model / Simple ministry, in the order it actually shipped:**

1. **"Apply account layout"** (`src/services/cohort-account-layout.ts`, new
   file) — a separate, explicit, typed-confirm action in Youth Setup
   (`POST /accounts/cohort-layout/preview` then `/apply`) that reconciles
   Accounts with the ministry's cohort model, decoupled from Save. `Complex`
   target = one grade account per grade + the 4 quads; `Simple` target = 6
   grade-bracket accounts (2 genders × 3 brackets), no quads.
   `planCohortAccountLayout` diffs by username (case-insensitive) against
   existing accounts — matches are left completely alone, unmatched active
   grade/quad accounts are **deactivated, never deleted**, missing targets are
   **created** with a random one-time password (`mustChangePassword: true`,
   shown once in the result modal). `account.service.ts` gained
   `planCohortLayout`/`applyCohortLayout`; needs `ISettingsRepository` now
   (`makeAccountService(users, settings)` — 2 args, was 1; 3 test files
   updated).
2. **Simple preset also disables Director** (was: Admin+Director+Grade;
   now Admin+Grade only) — `PRESET_CONFIGS.simple`/`PRESET_CONFIGS_CLIENT`
   set `roles.enabled.director: false`, reusing the existing generic
   role-disable-deactivates-accounts cascade in `settings.service.ts`.
3. **Cohort model dropdown relabelled Complex/Simple** (was "Grades + quads
   (graded)" / "No cohorting (flat)") — **UI label only**, the stored enum
   values (`'grades-quads'`/`'none'`) are unchanged.
4. **Real scoping bug found and fixed**: `cohortModel: 'none'` used to make
   `canAccessGrade`/`genderScopeOf` (`access-control.ts`) bypass ALL grade/
   gender access control for every login — the documented "known trap" ("under
   'none' nothing may be hidden by grade or gender"). This made a Simple
   ministry's own boys/girls-bracket accounts (from #1 above) purely cosmetic
   labels with **zero actual restriction** — a "Girls 7/8" login could see
   Boys 11/12 students too. Fixed: grade/quad accounts are now scoped by their
   assigned grades/gender identically under both cohort models. cohortModel
   now ONLY changes account layout (#1) and report-breakdown granularity
   (`overview`/`trends`/`lifegroup-stats` still hide `byQuad`/`byGrade` under
   `'none'` — that part is unchanged and is a reporting choice, not a security
   one). `visibility-matrix.test.ts` rewritten — 'none' now asserts the SAME
   visibility as 'grades-quads' throughout, not "everyone sees everyone."
   **If you're touching `canAccessGrade`/`genderScopeOf` again: do not
   reintroduce a `cohortModel === 'none'` bypass** — see the superseded-note
   left in the phase 6b entry above.
5. **"Include Grade 6" toggle** replaces the old Lowest/Highest grade number
   inputs in Structure & Roles — the top grade is always 12 in practice, so
   the only real question is whether the ministry also takes grade 6 straight
   from kids' church. `_setupSetGrade6()` sets `structure.gradeMin` to 6 or 7
   and forces `gradeMax` to 12 in one PATCH. `gradeBrackets()`
   (`cohort-account-layout.ts`) reworked to anchor brackets from the TOP down
   (`11-12`, `9-10`, ...) and fold any remainder into the LOWEST bracket
   instead of spawning a new one — grade 6 included → lowest bracket becomes
   `6-7-8`, not a separate 4th Simple account. Complex is unaffected by this
   change (still one account per grade in range, so grade 6 there just adds 2
   accounts: Grade 6 Girls/Boys).
6. **"Apply account layout" is always visible** (was: only shown while the
   draft's cohort model differed from the saved one), greyed out when Accounts
   already match. Enablement is computed **client-side**, via a mirror of the
   backend's plan logic (`_gradeBracketsClient`/`buildTargetAccountsClient`/
   `planCohortAccountLayoutClient` in public/index.html — keep in sync with
   `cohort-account-layout.ts` the way `MINISTRY_CONFIG_DEFAULTS_CLIENT` etc.
   already mirror their backend counterparts) against `_adminData.users` +
   the SAVED settings, so a Grade-6-toggle-only change (same cohort model)
   still surfaces the button, and there's no extra round-trip on every
   Youth Setup render. The button always targets the SAVED cohort/grade
   range, never the unsaved draft — save Youth Setup first if you just
   changed either.
7. **Changing the Cohort model dropdown directly now also auto-selects
   Director/Quad** the same way the preset buttons do (`_setupSetCohortModel()`
   — Complex turns both on, Simple turns both off), without resetting the
   rest of the draft the way `pickMinistryPreset()` does.
8. **Every Youth Setup tooltip rewritten** for plain language (no assumed
   knowledge of the app's internals — "login" not "actor"/"scope", no
   `cohortModel`/`genderPolicy` literal values in the copy) and trimmed for
   length, after an initial pass had gotten dense/jargon-heavy. Two
   Terminology tooltips (Service / Service night wording) had to be corrected
   twice the same day: once because the terminology-wiring work below made
   their "not really used yet" wording stale, and again for the plain-language
   pass.

**`labels.service`/`labels.serviceNight` terminology wiring**, done alongside
the above after discovering (while writing bug 7's tooltips) that both fields
were mostly decorative — `service` ("Youth") had exactly one real call site
(`L('service')`) and `serviceNight` ("Friday Nights") had zero. Both are now
threaded through Home, Trends, Health, Student Search, Connect Setup's export,
and the whole Connection Audit module (funnel labels, Data-tab slots/toasts,
the deck, the Elvanto export-guide instructions). Two module-scope `const`s had
to become functions since they were evaluated once at script-parse time, before
`S.settings`/`L()` had anything to read — **`STG`/`STG_SHORT` → `STG()`/
`STG_SHORT()`** (stage-name maps) and **`EXPORT_GUIDES` → `EXPORT_GUIDES()`**
(the Elvanto walkthrough content); every call site updated to call them.
Deliberately left un-wired: the Elvanto guide's literal Elvanto UI values that
aren't this app's own terminology (e.g. "Demographics: Youth" is an Elvanto
filter option name, not `labels.service`), and the two preset-picker
description strings in `MINISTRY_PRESETS_INFO` (still a frozen module-scope
array — same staleness risk as `STG` used to have, but low-traffic enough
(shown once, pre-customisation) that it wasn't worth converting too). A
follow-up pass also caught missed `labels.smallGroup`/`smallGroupPlural`/
`structure.gradeLabel` spots (the Lifegroups module toggle label, CA
lifegroup-health table headers, Data-tab group slot/toasts, a few CSV headers,
the Elvanto guide's "Lifegroup" category-name mentions) — grep for a bare
`'Lifegroup'`/`'Grade'` string literal before adding new UI copy; the
correct call is `L('smallGroup')`/`L('smallGroupPlural')`/`_gradeWord()`.

### Admin account preview (2026-07-12)

Admin → Accounts gets a **"Preview"** button on every **active `grade`/`quad`** account row
(not director/leader/admin). Clicking it drops the admin into a real, fully-functional session
as that account — same nav, same server-side RBAC scoping, real reads AND writes (the app has
no per-write attribution today and the admin explicitly wanted read+write parity, not a
read-only simulation) — with a persistent amber banner ("Previewing: *name*" + Exit Preview)
visible on every screen until they exit. Design rationale + rejected alternatives (a `?viewAs=`
query-param override; a pure client-side simulation mirroring the Youth Camp Platform's
same-user "at-camp preview") are in
`docs/superpowers/specs/2026-07-12-admin-account-preview-design.md`.

- **Backend**: `POST /accounts/users/:id/preview` (admin-only) → `AccountService.previewAccount`
  validates the target is active + grade/quad, then `AuthService.issueTokenFor(id,
  { mustChangePassword: false })` mints it a real session token. `issueTokenFor` gained an
  optional `actorOverrides` param for this (all existing call sites unaffected). The endpoint's
  JSON response ALSO forces `mustChangePassword:false` on the returned `user` object, not just
  the token — the frontend renders off `S.user.mustChangePassword` directly, separately from
  whatever's embedded in the token, so both had to be overridden or previewing a
  never-logged-in account would immediately show *that* account's forced-password screen.
  **⚠ Updated 2026-07-12 (independent review follow-up, same day)** — the minted token now uses
  a short 1h TTL (`PREVIEW_TOKEN_TTL_MS`), not the normal 12h; see "Independent review
  follow-up" below.
- **Frontend**: `enterPreview(id)`/`exitPreview()` (public/index.html) swap `API`'s token +
  `S.user`, `Cache.clear()`, and rebuild the persistent shell (`_initShell()`) — nav, role
  badge, and screen visibility all come for free since it's swapping in a real actor, not
  duplicating RBAC client-side. The admin's own session is stashed in a module-level
  `_previewStash` var, mirrored to `localStorage['yap_preview_stash']` so a page refresh
  mid-preview doesn't strand the admin — restored at the top of `boot()`. Both `exitPreview()`
  and `doLogout()` clear the stash.
  - **Gotcha this surfaced**: `boot()`'s `/auth/me` refresh (used to restore `S.user` after any
    page reload) reads the raw DB record, which doesn't know a preview session is in progress —
    without re-applying the `mustChangePassword:false` override there too, a page refresh
    mid-preview of an account with a genuinely-unset password would re-trigger its forced-
    password screen even though the initial preview response had already suppressed it.
- **Explicitly not built** (decided during brainstorming, matches "the app is already agnostic
  about who makes changes"): no write-blocking, no audit/logging of preview sessions.
- **Follow-up, same day**: the Preview button/banner now use a dedicated `eye` icon (was
  reusing `id`, the profile-view icon, which read ambiguously). A confirm modal
  (`confirmEnterPreview(id)` — looks the account up from `_adminData.users` rather than passing
  `displayName` through the `onclick` string, avoiding the apostrophe-escaping gotcha noted
  under Connect Setup's SMS templates above) now asks "Do you want to preview the *X* login?"
  before `enterPreview()` actually runs — the brainstorming decision above to skip a
  confirmation step was revisited and reversed.

### Admin account protection now locks the username, not the display name (2026-07-12)

Bug fix: `isProtectedAdmin()` (`account.service.ts`, mirrored client-side as `_isProtectedAdmin()`
in `public/index.html`) used to key off `displayName === 'Admin'` and lock *that* field — backwards,
since the display name is a cosmetic label and the username (`email` field) is the actual login
credential. Now keys off `email === 'admin'` (the seeded bootstrap username) — that account's
username is permanently locked, its display name is freely editable like any other account's.
Falls back to `displayName === 'Admin'` too (OR, not replace) so an account already renamed away
from username "admin" under the old rules doesn't silently lose protection — this matters because
`email` used to be the freely-editable field, so a real admin may already have changed it in
production before this fix shipped. Same swap applied in three places: `AccountService.update()`
(guard moved from `patch.displayName` to `patch.email`), `toggleStatus()`/`remove()` (guard
condition swapped to `isProtectedAdmin()`, error text now interpolates the account's current
`displayName` instead of hardcoding "Admin"), and the Edit Account modal (Username input now
`disabled` for the protected account instead of Display Name).

### Independent review follow-up: SVG-logo XSS closed, preview token TTL shortened, cohort-layout drift detection (2026-07-12)

An independent Six-Thinking-Hats review of the preceding few days' generalisation/Youth Setup/
account-preview work (user-requested, not a bug report) surfaced one live issue and two
lower-severity gaps. Fixed the same session, choosing the lightest fix that closes each gap now
rather than the heavier "proper" version of each — see the review's Green Hat for what was
deliberately not built.

- **Removed raw-SVG-paste branding entirely — this was a live XSS gap, not a theoretical one.**
  `sanitiseLogoSvg()`'s denylist regex (`\son\w+\s*=\s*(["']).*?\1`) required a QUOTED attribute
  value to strip an event handler — an unquoted payload like `<svg onload=alert(1)>` passed
  straight through untouched. `brandMark()` then rendered `branding.logoSvg` via raw `innerHTML`,
  and it renders on the **public, pre-auth login screen** (branding themes the login page before
  `/settings` even resolves — see "Theming" under Generalisation phases 1–5 above). Net effect:
  a careless or compromised admin pasting SVG from an untrusted source could persist an XSS
  hitting every visitor before they log in. Decided to drop the feature rather than harden the
  sanitiser (a real SVG sanitiser is more machinery than a rarely-used paste-in-code option
  earns; the raster upload-and-crop path already covers the real use case). `branding.logoSvg`
  is gone from `MinistryConfigSchema` entirely — Zod silently strips an unknown key on the next
  `mergeMinistryConfig`, so even a raw API PATCH can't resurrect it (verified live against a
  running server: PATCHing `{branding:{logoSvg:"..."}}}` round-trips with no `logoSvg` key at
  all). `sanitiseLogoSvg`/`DANGEROUS_SVG_RE` deleted from `ministry-config.ts`; Setup → Branding's
  Logo picker is now Default mark / Upload image only. SW cache `ysc-v40` → **`ysc-v41`**.
- **Admin account-preview tokens now expire in 1h, not the normal 12h**
  (`PREVIEW_TOKEN_TTL_MS`, `auth.service.ts`). A preview mints a real, fully-privileged session
  token for the target account that sits in the admin's browser `localStorage` *alongside* their
  own stashed token — shortening its life meaningfully bounds that extra exposure window without
  needing server-side token revocation (tokens stay stateless everywhere else in this app too).
  `issueTokenFor()` gained an optional third `ttlMs` param for this only; every other call site
  is unaffected and still defaults to 12h. `exitPreview()` itself needed no change — it was
  already a pure client-side token swap with no server round-trip, so it still works instantly
  even after the preview token has expired.
- **"Apply account layout" now flags (never auto-fixes) accounts that have drifted from what
  their username implies.** The plan only ever matched existing vs. target accounts by
  USERNAME — an account whose actual `grades`/`gender`/`quad`/`role` no longer matched what its
  username implies was silently treated as "already correct" and never resurfaced, even though
  the feature reads to an admin as a reconciliation tool. `planCohortAccountLayout()`
  (`cohort-account-layout.ts`) now also returns a `mismatched` list (id/username/displayName/
  reason) for username-matched accounts whose fields disagree with their target spec —
  informational only, per this feature's existing "never silently edit a matched account" rule.
  `ExistingAccountLite` gained optional `grades`/`gender`/`quad` fields, only compared when a
  caller actually supplies them (so existing unit tests that construct bare `{id,role,email,
  displayName,status}` objects are unaffected); `account.service.ts`'s two callers
  (`planCohortLayout`/`applyCohortLayout`) now pass them through from the real user record.
  Surfaced as a non-blocking warning in the "Apply account layout" preview modal
  (`_showCohortLayoutPreview`), listing each mismatched account and why. The client-side
  enablement mirror (`planCohortAccountLayoutClient`) is untouched — a mismatch doesn't change
  whether the button reads "already aligned", only what the preview modal shows once clicked.
- Tests: `ministry-config.test.ts`/`settings.service.test.ts` updated (assert a `logoSvg` patch
  is dropped, not sanitised — the old sanitiser-specific cases are gone with the feature);
  `auth.service.test.ts` gained `ttlMs` coverage; `account.controller.test.ts` asserts the
  preview endpoint passes `PREVIEW_TOKEN_TTL_MS`; `cohort-account-layout.test.ts` gained 6 cases
  for `mismatched` (role/grades/gender/quad drift, inactive accounts ignored, a clean match never
  flagged). 341 tests total (was 335), typecheck clean.

### Home "Birthdays this week" re-scoped off the leader identity (2026-07-13)

The Follow Up card's "Birthdays this week" list was sourced entirely from
`GET /connections/leader/:id/followup`'s `birthdays` field — which, like the rest of that
endpoint, is scoped to whichever leader identity the user self-identified as
(`getMyLeaderId()`), i.e. only THAT leader's own connected students. That's the right scope
for the "Not seen at Friday/Lifegroup" lists (the point of self-identifying), but wrong for
birthdays, which should reflect the login's own grade/quad, not one leader's connection
subset.

- `grade`/`quad` roles: Home now computes "birthdays this week" client-side from its own
  already role-scoped `/students` fetch (`_scopedWeeklyBirthdays()`, public/index.html) —
  restricted to "connectable" students (`_hasAttended`, attended this or previous term, same
  rule Home's connection counts use) — instead of `data.birthdays`. `_isBirthdayInWeek()` is a
  frontend port of `followup.service.ts`'s `isBirthdayInWeek` — **keep them in sync**.
- `admin`/`director` roles: the Birthdays-this-week card is suppressed entirely (not just
  scoped wider) — ministry-wide "this week" wasn't a useful view there per the bug report.
- Dedicated junior-`leader` role (a real individual leader's own login, not grade/quad staff)
  is **unchanged** — their own connected students already ARE their scope, so it still reads
  `data.birthdays` from the followup endpoint.
- The card is still gated behind picking a leader identity on Home (unchanged UX) — only the
  *source* of the birthdays list changed once shown, via a module-level `_homeBirthdaysCtx`
  (`undefined` = leader-scoped `data.birthdays`, `null` = suppress, array = grade/quad-scoped)
  set once per Home render and read by `renderHomeFollowup()`, which is itself re-invoked with
  no args from the "Not you?"/pick-a-leader `onclick` handlers.
- Backend `followup.service.ts` is untouched — `leaderFollowup`'s own `birthdays` field is
  still leader-scoped and still used for the `leader` role; grade/quad/admin/director just stop
  reading it.
- `public/sw.js` cache bumped `ysc-v41` → `ysc-v42` (SPA JS changed).

### Prayers feature + a real deployment incident: the custom domain does NOT auto-alias (2026-07-18)

Shipped a `Prayers` module (`feat/prayers` → `master`): per-student or "general" (no student)
prayer requests, admin/director CSV export/import, a New Year Refresh wizard step, a nav tab,
and a per-student summary on My Connections. New table `prayer_requests` (migrations
`0005`/`0006`; `student_id` nullable — general prayers have none), `PrayerService`/
`IPrayerRepository`/Supabase impl, `prayer:read`/`prayer:write` RBAC actions (student-resolved
scoping, same pattern as connections). SW cache `ysc-v42` → `ysc-v44`.

**Deployment incident + the real root cause (not a code bug).** Earlier the same day, pushing
the unrelated `3a7bbc6` login-form fix to `master` appeared to break production — every route
failed with a platform-level `EnvFileReadError` loading env vars, before app code even ran. A
session rolled back to the prior deployment via `vercel rollback` and it looked resolved. But
re-investigating to re-ship that fix surfaced the ACTUAL mechanism, confirmed by direct testing:

- **This project's custom production domain (`ys-connection.vercel.app`) does NOT
  automatically re-alias to the newest deployment** — not on `git push` to `master`, and not
  on a manual `vercel deploy --prod`. Both successfully create a new `Ready` deployment
  targeted at `production`, but the custom domain keeps pointing at whatever it was last
  EXPLICITLY aliased to (`vercel alias set <new-deployment-url> ys-connection.vercel.app`).
  Only the default `<project>-<team>.vercel.app` alias updates automatically. This is a
  project/domain configuration quirk (most Vercel projects DO auto-promote all production
  domains) — not something to "fix" in code, just something to always do as a manual step.
- **So what actually happened**: the login-form deploy went out, someone ran the manual
  alias step, and THAT promotion is what exposed users to the `EnvFileReadError` — a separate,
  apparently one-off Vercel platform runtime glitch (build succeeded/`Ready`; the code in
  `src/config/env.ts` only reads `process.env`, no file I/O, so nothing in this repo could throw
  that error). Rolling back re-aliased to the prior deployment, which "fixed" it. Redeploying
  the exact same commit later the same day (fresh build + fresh manual alias) worked fine — 200s
  on `/`, `/auth/me`, `/manifest.json`, `/settings` all healthy, confirming it was transient.
- **Practical takeaway for every future deploy to this project**: after `git push origin
  master` (or `vercel deploy --prod`), don't assume the push alone updates
  `ys-connection.vercel.app`. Verify with `vercel inspect ys-connection.vercel.app` (check the
  `id` matches your new deployment) and if not, run `vercel alias set <new-deployment-url>
  ys-connection.vercel.app` explicitly, then re-verify with a few `curl` health checks
  (`/`, `/auth/me` should 401 not 500, `/settings` should return real JSON) before trusting it.
- **Also learned**: `vercel inspect <deployment-id-or-url>` prints an "Aliases" section that
  lists domains the deployment is *eligible* to hold (production-target + rollback-candidate
  domains) — it does NOT reliably show which domain is *currently* live on it. Two different
  deployments can both list the same alias there. To find the deployment TRULY live behind a
  domain, `vercel inspect <the-domain-itself>` (not a `-xxxxx-` deployment URL) is authoritative.
- **Confirmed again the same day**: every subsequent push to `master` (the docs commit above,
  then the Prayers UI-polish commit below) each produced its own new deployment, and NEITHER
  auto-aliased `ys-connection.vercel.app` either — this is a standing characteristic of this
  project, not a one-off. `vercel alias set <new-deployment-url> ys-connection.vercel.app` is a
  required manual step after every single deploy to this project, full stop.

### Prayers UI polish (2026-07-18, same day as the feature shipped)

User-requested tweaks to the just-shipped Prayers screen and the leader-identity picker on
Home/My Students, deployed the same day:

- **Add Prayer FAB raised ~1cm**: `.pfab`'s `bottom` `76px` → `114px` so it sits clear of the
  bottom nav more comfortably.
- **Add/Edit Prayer modal's "For" field**: the "Not about a specific student — mark as general"
  sentence-styled link (and its "Change" counterpart) is gone, replaced by a small `Student` /
  `General` tab pair above the student search box. Only shown for a brand-new, not-yet-locked
  prayer (adding one from a student's own profile, or editing an existing prayer, still shows
  the locked chip/general label with no toggle — unchanged). `_prayerUsePicker()`/
  `_prayerUseGeneral()` now also swap the two tab buttons' active styling in addition to
  toggling which body (search box vs. general label) is visible.
- **Leader-identity "Not you?" control made an obvious button** on both screens it appears —
  Home's Follow Up card (pre-existing, was `btn-ghost btn-sm` at a tiny `11px`, read as a faint
  text link) and a new equivalent added to My Students (didn't exist before; sits next to the "I
  am…" label once a leader is chosen, doing the same `setMyLeaderId(null)` reset). Both now use
  `btn-secondary btn-sm`, the same visible-button style used elsewhere in the app (e.g. the
  Cancel button in every modal).
- SW cache `ysc-v44` → `ysc-v45`.

### iOS keyboard-dismiss viewport gap fix (2026-07-18, same day)

User-reported (with screenshot) from the Prayers screen: after typing in a text field and
dismissing the keyboard, a strip of body background appeared below the fixed bottom nav —
WebKit had left it laid out against the stale keyboard-open viewport height. Fixed with
`_fixViewportGap()` (next to `_positionNprog()`): a same-position `scrollTo` nudge on
`visualViewport.resize`, with a delegated `focusout` fallback, forces a relayout. Not
reproduced locally (no iOS device in this environment) — tuned from the report alone, so
re-verify against a fresh screenshot if it recurs rather than assuming this fully covers it.
SW cache `ysc-v45` → `ysc-v46`. See debug.md's "Mobile viewport / iOS Safari quirks" entry.

### General-prayer scoping + a real junior-leader access bug fixed (2026-07-18, same day)

A follow-up question ("which account types see a general prayer created by each account
type?") surfaced that general (no-student) prayers were completely unscoped — visible to
every account with `prayer:read`, i.e. everyone, regardless of who created it. User asked for
real scoping and found a second, more serious bug in the process.

- **General prayers now inherit a grade+gender domain from their creator.**
  `access-control.ts`'s `generalPrayerCreatorScope(actor, structure)` computes it at creation
  time (`grade` role → own grade(s)+gender; `quad` role → bracket grades ([7,8,9]/[10,11,12])
  + quad gender; `admin`/`director`/`leader` → `{grades:null, gender:null}`, meaning no
  boundary). `canAccessGeneralPrayer(viewer, createdByGrades, createdByGender, structure)` is
  the read-side check: `admin`/`director`/`leader` viewers always see everything; a `grade`/
  `quad` viewer needs a grade overlap AND (if both sides have one) a gender match with the
  creator's stored scope. Net effect: a grade account's general prayer stays within its own
  grade+gender; a quad's is visible to every grade within its bracket+gender (and to other
  quads/grades that happen to overlap); admin/director-created ones stay ministry-wide, same
  as before. New nullable columns `created_by_grades` (jsonb)/`created_by_gender` (text) on
  `prayer_requests` (migration `0007`, additive) — existing rows are `NULL`/`NULL`, which
  reads as "no boundary" (backward-compatible: prayers created before this shipped stay
  visible to everyone, not retroactively hidden). Enforced on **both** `list()` (read) and
  `update`/`setStatus`/`remove` (write) — not just visibility, so a grade/quad actor can't act
  on a general prayer outside their own domain even by guessing/enumerating its id.
- **Real bug found and fixed: a junior `leader` could never see or create a prayer for even
  their own connected student.** `canAccessStudent()` → `canAccessGrade()`'s switch statement
  only handles `admin`/`director`/`grade`/`quad` — role `leader` falls to `default: return
  false`, unconditionally, for every grade. Every other service that scopes the `leader` role
  (`student.service.ts`, `atrisk.service.ts`, `connection.service.ts`) special-cases
  `actor.role === 'leader'` and resolves their own connected students via `connRepo` instead
  of `canAccessStudent` — `prayer.service.ts` never got that treatment, so any student-linked
  prayer create/read/edit by a `leader` actor threw `ForbiddenError`, even for their own
  connections. This was untested (`prayer.access-control.test.ts` only asserted the coarse
  `can()` RBAC grant, never the actual scoping) and undocumented until this fix. `makePrayerService`
  now takes an optional 4th `connRepo: IConnectionRepository` param (wired in `container.ts`);
  a `leader` actor's student-linked reads/writes now resolve via
  `connRepo.findByStudentAndLeader`/`findByLeader` instead of `canAccessStudent`.
- **Deliberately left open**: a `leader`-created general prayer stays visible to everyone
  (same as admin/director) — a junior leader is bound to one `Leader` record, not a grade/
  gender cohort, so there's no boundary to derive. Not asked for either direction; flagging in
  case a future request wants leader-created general prayers scoped some other way (e.g. to
  just that leader's own connected students' grades/genders).
- Tests: `prayer.access-control.test.ts` gained `generalPrayerCreatorScope`/
  `canAccessGeneralPrayer` coverage; `prayer.service.test.ts`'s old "visible to everyone" test
  (asserting the now-wrong unscoped behavior) was replaced with the full scoping matrix
  (grade/quad/admin-director creators × grade/quad/admin-director viewers) plus two new tests
  for the junior-leader fix. 357 → 366 tests.

### Incident: every /prayers request has been silently misrouted since the feature shipped (2026-07-18)

The admin tried to add a prayer and got a generic failure toast. Vercel runtime logs showed
**zero** `/prayers` requests ever reaching the function (`get_runtime_logs` grouped by
`requestPath` over the last 2h listed every other route the admin's session hit, never
`/prayers`) — the request wasn't crashing server-side, it was never arriving.

- **Root cause**: `vercel.json`'s `routes[]` has its own explicit allowlist regex
  (`^/(auth|students|leaders|...)`) separate from Express's `router.ts` and `sw.js`'s
  `API_RE` — routing at Vercel's edge happens *before* the request ever reaches
  `/api/index.ts`. This morning's Prayers feature work added `prayers` to the Express router
  and to `sw.js`'s `API_RE` (both correct, both tested) but never to `vercel.json` — the exact
  same class of bug as the 2026-07-11 `/manifest.json` incident documented earlier in this
  file ("a new top-level route served by the function on Vercel must be added to
  `vercel.json` routes[], not just the Express router"), which apparently didn't stick as a
  checklist item. Any unmatched path falls through `{"handle":"filesystem"}` to the catch-all
  `{"src":"/(.*)","dest":"/index.html"}` — so `GET /prayers` was returning the raw SPA HTML
  shell with a **200**, not an error. `API.post('/prayers', ...)` then called `res.json()` on
  HTML (not JSON), threw, and surfaced as a generic toast — nothing about the failure pointed
  at "wrong route" from the client side alone.
- **Fix**: added `prayers` to `vercel.json`'s regex. Verified directly with `curl` (not just
  typecheck/tests, which can't catch this class of bug at all — it's pure infra routing):
  `GET /prayers` now returns `401 {"code":"UNAUTHORIZED",...}`, matching every other
  protected route, instead of `200 text/html`.
- **Process gap this exposes**: my own post-deploy health checks for every prayers-related
  deploy today checked `/`, `/auth/me`, `/settings`, `/manifest.json` — never `/prayers`
  itself, so this shipped silently through 5+ deploys before a real user hit it.
  **Lesson for next time a new top-level API resource is added anywhere in this app: verify
  the exact new route with `curl` post-deploy (check for JSON + the expected auth status
  code, not just "some 2xx/4xx came back"), not just adjacent/already-covered routes.**
  Consider adding an automated check (e.g. a smoke-test script hitting every `SECTION_OF`/
  route-table entry) rather than relying on someone remembering this by hand a third time.

### "Added by" on a prayer now records the account login, not the self-identified leader (2026-07-18, same day)

Once the routing incident above was fixed, the user tried again and pointed out `submitPrayer()`
was sending `createdByLabel: _myLeaderLabel()` — the per-device "I am…" leader picker's name
(the same one Home/My Students use for follow-up scoping), not the actual authenticated
account. `prayer.service.ts`'s `create()` already defaults `createdByLabel` to the actor's own
`displayName` when the client omits it — the frontend just needed to stop overriding that with
the leader identity. Fixed by dropping `createdByLabel` from the POST body entirely (letting
the server default apply) and removing `_myLeaderLabel()`, which had no other callers. SW cache
`ysc-v46` → `ysc-v47`. Existing prayers created before this fix keep whatever label they were
given — not backfilled, wasn't asked for.

### Bug: both Elvanto export-guide buttons had been dead since 2026-07-12 (2026-07-30)

Reported as "the 'How do I export these files from Elvanto?' button isn't working on the data
import screen". It threw a `TypeError` and opened nothing — and the **same bug silently killed
the Connection Audit Data tab's guide button too**, since both go through the one viewer.

- **Root cause**: the 2026-07-12 terminology-wiring pass (see "Admin bug/improvement batch"
  above) converted `EXPORT_GUIDES` from a module-scope `const` object into a **function**
  `EXPORT_GUIDES()`, so its copy would pick up a customised `labels.serviceNight`/`smallGroup`
  at call time instead of freezing them at script-parse time — the same treatment `STG`/
  `STG_SHORT` got in that pass. But while every `STG`/`STG_SHORT` call site was updated, the
  three `EXPORT_GUIDES` call sites were **not**: `openExportGuide`, `_egGo` and `_egDraw` kept
  indexing it as the plain object it used to be (`EXPORT_GUIDES[key]`). Indexing a function by
  a non-existent property returns `undefined`, so `openExportGuide` fell to its `'import'`
  default and then threw on `EXPORT_GUIDES[_egKey].title` — `Cannot read properties of
  undefined (reading 'title')`. An `onclick` handler that throws fails silently to the user:
  the overlay never gets its `.show` class, so the button reads as simply doing nothing.
- **Fix**: one accessor, `_egGuide(key)` → `EXPORT_GUIDES()[key]`, used by all three call
  sites. Grepped the two sibling functions converted in the same pass (`STG(`/`STG_SHORT(`) —
  both clean, no other instance of this mistake in the file.
- **Why nothing caught it for 18 days**: the guides are pure inline SPA JS with no test
  coverage, and `typecheck`/`test` can't see inside `public/index.html` at all. Closed with
  `src/tests/export-guide.test.ts` (4 tests, 406 → **410**) — it extracts the REAL
  `EXPORT_GUIDES`/`_egGuide`/`openExportGuide`/`_egGo`/`_egDraw` bodies out of the shipped
  HTML by name and runs them against a small DOM stub, the same extract-and-evaluate pattern
  `logo-crop-math.test.ts` already established. All 4 failed with the exact production
  `TypeError` before the fix.
- **Lesson (this file's second instance of it)**: converting a module-scope `const` to a
  function in `public/index.html` is a **call-site-wide change** — `X[k]` on a function is not
  a syntax error, not a type error, and not a test failure here; it's a silent `undefined`
  that only surfaces when a user clicks. When making a config/label value lazy this way, grep
  every bare `NAME[` and `NAME.` reference in the same commit, not just the ones you happened
  to be editing.
- SW cache bumped `ysc-v53` → **`ysc-v54`**.

## Phone field encryption at rest (students.mobile / students.parent_phone) — implemented 2026-07-18

Both fields are encrypted at rest with AES-256-GCM (`src/utils/field-crypto.ts`, ported from
the Youth Camp Platform's field-encryption feature) so raw DB access (incl. Supabase staff/SQL
editor) reveals only ciphertext, while every service/export still sees plaintext. Design:
`docs/superpowers/specs/2026-07-18-phone-field-encryption-design.md`; plan:
`docs/superpowers/plans/2026-07-18-phone-field-encryption.md`.

- **Scope + seam:** the codec is called ONLY inside `supabase.students.ts` (`toStudent`/
  `save`/`saveMany`, via `encryptPhoneFields()`). Services, `memory`/`json` persistence, and the
  SPA are all unaware encryption exists. No schema migration — both fields are plain `text`
  columns, encrypted in place (unlike the camp platform, which needed new `*_enc` columns for
  its array/jsonb fields).
- **Envelope:** `v1.<keyId>.<iv>.<tag>.<ct>` — the `v1.` prefix lets reads tolerate a table
  that's any mix of ciphertext + not-yet-migrated plaintext, and makes the backfill idempotent.
  Bound via AAD to `"students:<column>:<id>"`.
- **Key:** `FIELD_ENCRYPTION_KEY` (base64, 32 bytes) in Vercel prod env — a key distinct from the
  camp platform's. Losing it = losing the two phone fields permanently (the security property,
  not a bug).
- **Rollout:** deploy the encryption-aware code → run `scripts/backfill-field-encryption.ts`
  against prod (idempotent/resumable) → verify no non-null value lacks the `v1.` prefix →
  `VACUUM FULL students;` to physically purge leftover plaintext row versions from disk.
- **Manual prod SQL can no longer read/write these two columns** — values are opaque ciphertext
  after the backfill runs. Edits must go through the app. **Never hand-copy or hand-edit a
  ciphertext value between rows** — the AAD binds each value to its own `students:<column>:<id>`,
  so a copied value fails GCM auth-tag verification on read. Because every list/search read maps
  the *entire* row set through `toStudent()` in one pass, **one row with an undecryptable value
  (wrong key, corruption, a hand-copied ciphertext) fails the whole query** — not just that
  student — taking down Home/`/overview`/`/trends`/`/students`/`/connections` together. This is
  the intended fail-closed property (a wrong/missing key must not silently show garbled phone
  numbers), but it means `FIELD_ENCRYPTION_KEY` is a hard runtime dependency of nearly every read
  endpoint once any row is encrypted — **it must be set in Vercel prod env before or with any
  deploy that ships this code**, not after.
- **Key rotation runbook (not yet needed, but documented for when it is):** set
  `FIELD_ENCRYPTION_KEY_PREV`/`FIELD_ENCRYPTION_KEY_PREV_ID` to the retiring key/id, promote a new
  key to `FIELD_ENCRYPTION_KEY`/`FIELD_ENCRYPTION_KEY_ID`, re-run
  `scripts/backfill-field-encryption.ts` (re-encrypts every row under the new active key, tolerated
  mid-rotation by the dual-key decrypt), then remove the `_PREV` vars once verified. Never rotate by
  hand-editing rows.

## Security notes

- **XSS:** all user-supplied strings (names, usernames, notification title/message,
  lifegroup names) are HTML-escaped via the global `esc()` helper before going into
  `innerHTML`. A `Content-Security-Policy` meta tag in `index.html` is defence-in-depth
  (`'unsafe-inline'` is required by the inline-script/onclick architecture; its value is
  blocking external script/resource loads + base-uri/form-action). **Always wrap new
  user-data interpolations in `esc()`** — including `e.message`/`err.message` (server errors can echo names). The 2026-10-12 audit found raw leader names (student detail, Connect picker note), import filenames and error messages; all now go through `esc()`, and `src/tests/spa-xss-escape.test.ts` pins the two name sinks. Residual gap: a few `onclick` handlers pass names
  as JS-string args with only `'`-escaping — don't widen that surface.
  **Ship gate (2026-10-17):** `src/tests/spa-xss-guard.test.ts` fails the suite on any `.name/.label/.email/...` read inside an HTML template literal that is not wrapped in `esc()` (or a `SAFE_WRAPPERS` helper that escapes itself, e.g. `_ikKv`; reviewed exceptions go in its `ALLOW` map with a reason). Gaps by design: bare identifiers, string concatenation, JS-string-in-attribute (see `review-2026-10-16/S2-xss-taint.md`).
- **Session token** is stored in `localStorage` (`yap_token`). Accepted risk, mitigated by
  the escaping + CSP above; switch to an httpOnly cookie if that ever regresses. Admin account
  preview (2026-07-12) stashes a SECOND live token alongside it during a preview session — its
  TTL is deliberately short (`PREVIEW_TOKEN_TTL_MS`, 1h) specifically to bound that extra window;
  see "Independent review follow-up" above.
  **Revocation (2026-10-17, F5):** `resolveToken` re-reads the account (per-instance cache 60 s) and returns the current role/scope, `null` when inactive; the token carries `pw` = sha256(password_hash)[0:16], so an admin reset or a self-change signs out every other device within a minute (the self-change caller gets a fresh token from `POST /accounts/me/password`; a fingerprint mismatch forces one uncached re-read so that token works at once). A sign-in (and `issueTokenFor`) drops that instance's cached row, so a reactivated account signs in at once. **Logout is still stateless (operator ruling 2026-10-17) — to sign a shared login out everywhere, change its password.** Tokens from before this deploy carry no `pw` and are honoured until their 12 h expiry. `users.token_version` deliberately not added (operator ruling: revoke by password fingerprint; a migration is only needed for "sign out everywhere without a new password"). `mustChangePassword` now follows the DB (the old stale-flag gotcha is gone); a preview token's `mustChangePassword: false` override still wins.
- **SPA shell headers (2026-10-17, F6):** Express's security headers never reached `/`, `index.html`, `sw.js` on Vercel (served by the filesystem handler). `vercel.json` now has a `routes` entry with `headers` + `continue: true` (legacy `routes` cannot coexist with a `headers` block) mirroring `express-adapter.ts`, plus `Content-Security-Policy: frame-ancestors 'none'`. No Cache-Control there: the shell and `sw.js` stay cacheable. `route-registration.test.ts` pins it; verify with `curl -sI` after deploy.
- **Admin-supplied branding markup**: the one raw-`innerHTML` custom-branding path
  (`branding.logoSvg`, rendered unescaped by design so admins could paste `<svg>` markup) was
  **removed entirely 2026-07-12** after an independent review found its denylist sanitiser didn't
  catch unquoted event-handler attributes (`<svg onload=alert(1)>`) — see "Independent review
  follow-up" above. `branding.logoImage` (a raster data URI, no markup) is the only custom-logo
  path now. If a future change ever reintroduces raw markup rendered via `innerHTML`, use a real
  sanitiser (e.g. a proper SVG-profile DOMPurify build), not a hand-rolled regex denylist.
- **CORS:** in production, `CORS_ORIGINS` defaults to the prod domain (never `*`); override
  via env. **`SESSION_SECRET` must be set in production** or tokens can be forged.
- **ACCEPTED RISK — Bus coordinator rights are a soft guard (operator ruling 2026-10-12).** Any logged-in
  user who picks a coordinator in "I am" (`as=`) gets that coordinator's Bus screens, including Past
  nights with riders' home addresses. `coordinatorLeaderIds` stays public in `GET /settings`. The
  check only prevents accidental edits; the operator chose this. Future audits: do not re-flag it.
- **Never commit Supabase CLI local state.** `supabase/.temp/` is gitignored (2026-07-03) — it
  holds the linked-project ref / pooler URL / tool versions and must stay out of git. Use explicit
  paths (not `git add -A`) when committing so untracked local dirs (`supabase/.temp/`, `_design/`)
  aren't swept in.
- **Prayer-request text is stored plaintext at rest** — intentional decision, not an oversight.
  Unlike `students.mobile` and `students.parent_phone` (which are AES-256-GCM encrypted), prayer
  text is stored unencrypted in `prayer_requests.text` and appears as-is in CSV exports. No
  audit trail of reads either. If requirements change in the future, revisit this decision
  alongside the phone-field encryption pattern (`src/utils/field-crypto.ts`).
- **Forced password change (2026-07-09).** `User.mustChangePassword` / `Actor.mustChangePassword`
  is embedded in the signed session token (`toActor()` in `auth.service.ts`) and enforced in
  `express-adapter.ts` right after `resolveContext`: any route without `allowMustChangePassword:
  true` on its `Route` entry throws `MustChangePasswordError` (403, code `MUST_CHANGE_PASSWORD`)
  for a flagged actor. Only `GET /auth/me`, `POST /auth/logout`, and `POST
  /accounts/me/password` are allowlisted. The frontend mirrors this in `render()` — a flagged
  `S.user` gets `renderMustChangePassword()` (full-page, blocks the whole app) instead of the
  normal shell. `changeOwnPassword` is the only path that clears the flag; `create()` defaults
  new admin-created accounts to `false` (not in scope — see migration 017's comment for why the
  scope is deliberately narrow: only the historically-seeded accounts, not every admin-set
  password). This exists because `002_seed_admin.sql` / `005_seed_users.sql` and this file used
  to document a shared default password in plaintext next to real account usernames, in a *public*
  repo — see `017_must_change_password.sql`.
  **Gotcha (fixed 2026-07-11):** because the flag is baked into the token at login and
  `resolveToken()` trusts it with no DB re-check, clearing the DB flag alone left the
  caller's existing token still enforcing the gate for the rest of its 12h TTL (blank
  page after "Set Password & Continue" — needed a manual sign-out/back-in to get a
  fresh token). Fixed by `AuthService.issueTokenFor(userId)` minting a new token from
  current DB state; `POST /accounts/me/password` returns it and both frontend call
  sites swap to it via `API.setToken()`. If a similar per-token claim is ever added,
  it needs this same refresh-on-change treatment or it'll reproduce this bug.

### Password-manager save hardening on login + change-password forms (2026-07-24)

Mirrors a fix shipped to the sibling camp app. Goal: get iOS Safari (especially older
versions) and Chrome/Edge/Android to more reliably offer to **save** a credential after
login or a password change. SPA-only, no backend/schema change.

- **Safari has no Credential Management API** — the only lever there is a genuine `<form>`
  submit with correct `autocomplete` tokens and stable field `name`s; this is a hardening
  pass, not a guaranteed prompt. **Old iOS in particular may still decline to prompt for a
  brand-new credential** — autofilling an already-saved one is the reliable path there.
  Chrome/Edge/Android additionally get a programmatic nudge via the feature-detected
  `navigator.credentials.store(new PasswordCredential(...))` call (new shared helper
  `_offerSaveCredential(id, password)`, public/index.html) — wrapped in `try/catch` +
  `.catch()` so it can never block or break a real login/password-change on a browser
  without the API (i.e. Safari: silent no-op).
- **Login form** (`renderLogin`/`doLogin`) was already a real `<form id="lform">` with
  `name="username"`/`name="password"` and the right `autocomplete` tokens — only added
  `autocapitalize="none" autocorrect="off" spellcheck="false"` to the username field, and
  the `_offerSaveCredential` call right after a successful login (before `go('home')` tears
  down the form).
- **"Set a New Password" forced gate** (`renderMustChangePassword`/`submitMustChangePassword`)
  was NOT a real form before this — a bare `<div>` block with a keydown listener for Enter.
  Now wrapped in `<form id="mcpform">` (hidden `username` field carrying `S.user.email`, so
  the manager associates the new password with the right account, since this form has no
  visible username input), native `submit` listener instead of the keydown hack, and
  `_offerSaveCredential(S.user.email, pw1)` after a successful change.
- **Connect Setup's self-service "Change Your Password" modal**
  (`showChangeOwnPassword`/`submitChangeOwnPassword`) had no `<form>` and no `autocomplete`
  attributes at all. Same treatment: `<form id="cpwform">` (hidden username field, real
  `autocomplete="current-password"`/`"new-password"` tokens), submit listener wired right
  after `modal(...)` renders it (the `modal()` helper is just an innerHTML swap — no
  post-render hook of its own, so every modal that needs one wires it itself, same pattern
  `renderLogin` already used). **Gotcha avoided**: the modal's Cancel button had to get an
  explicit `type="button"` once it moved inside the `<form>` — a bare `<button>` inside a
  form defaults to `type="submit"`, so without this, clicking Cancel would have also fired
  the form's `submit` listener (closing the modal AND calling `submitChangeOwnPassword()`
  with empty fields, surfacing a spurious "enter your current password" error).
- `submitSetPassword` (admin resets **another** account's password from Admin → Accounts) was
  deliberately left untouched — that credential belongs to a different account than the one
  authenticated in this browser session, so offering to save it here would associate the wrong
  credential with this device.
- **SW cache bumped** `ysc-v47` → `ysc-v48` (`public/sw.js`) since the login/change-password
  HTML changed — the SW's network-first HTML fetch means this isn't strictly required for the
  shell itself, but the version bump keeps other cached assets consistent with prior
  convention in this file.

### Bug: couldn't scroll to the true bottom of Prayers / My Connections / Setup (2026-07-24)

**Root cause**: `.pg`'s bottom padding (the clearance reserved so the fixed `.bot-nav` doesn't
cover the last bit of scrolled content) was halved `76px` → `38px` on 2026-07-09, reasoned as
"more than the mobile bottom-nav it exists to clear, and pure dead space on desktop." That
reasoning was wrong on both counts: (a) `.bot-nav`'s actual rendered height is ~57-68px
(`6px` top padding + a `~46px` nav-item — `22px` icon + `3px` gap + a ~13px text line + `4px`
top/bottom padding each — + `6px` bottom padding, taller still if a role's bottom-5 includes a
2-line-wrapped label like "My Connections") — so 38px undershot the real clearance needed by
20px+; (b) the desktop dead-space concern was already handled independently by
`@media(min-width:768px){.pg{padding:20px 24px...}}`, which replaces the padding entirely
(`.bot-nav` is `display:none` there) — the mobile base value never affected desktop at all, so
halving it only ever broke mobile without fixing anything on desktop. This app's own `#toast`
(`bottom:76px`) and `.pfab` (`bottom:114px` = 76 + a comfort margin, per the 2026-07-18 note
above) already used ~76-114px as the known-working clearance for this same nav, corroborating
that 38px was the actual regression, not the original 76px being excessive. **Fix**: restored
`.pg`'s base (mobile) padding-bottom to `76px` (public/index.html, the `/* Page */` rule near
the top of the `<style>` block) — a revert to the pre-2026-07-09 value, not a new number.
Every screen was equally affected in principle, but it only became visibly *blocking* on tall,
list-heavy screens (Prayers, My Connections, Connect Setup) whose last row is often an
actionable button sitting flush at the true end of the document — shorter screens never scroll
far enough to expose the same ~20px shortfall.

### Login form hardened further for iOS "Add to Home Screen" standalone mode (2026-07-24)

Follow-up to the password-manager pass above, after a report that the save-password prompt
still sometimes doesn't appear on iOS specifically when signing into a *different* existing
account **from the installed home-screen app** (this app sets
`apple-mobile-web-app-capable=yes`, so "Add to Home Screen" launches it in a standalone
`WKWebView`, not a regular Safari tab — standalone web apps have a long-documented, less
reliable password-save experience than Safari tabs, which this pass cannot fully paper over).
Two small, low-risk changes to `renderLogin()`/`doLogin()` (public/index.html):
- `<form id="lform">` now has a real `method="post" action="/auth/login"` instead of
  `action="#" onsubmit="return false"` — the inline `onsubmit` was redundant with the
  `addEventListener('submit', ...)` listener already doing the real `preventDefault()` +
  `doLogin()` dispatch, and a genuine-looking action is the more standard "this is a real
  form" signal for a password manager to key off (the attribute is never actually used to
  navigate — JS always intercepts the submit — this only matters for the no-JS fallback case
  and for how seriously AutoFill treats the form).
- **The intermittent ("sometimes") part of the symptom** is the interesting bit — that phrasing
  points at a race, not an always-broken path. `doLogin()` used to call `go('home')`
  synchronously right after `_offerSaveCredential(...)`, which wipes `#app`'s innerHTML
  (`render()`) — including the just-submitted password field — in the same tick. Safari's
  save-heuristic partly relies on noticing that field disappear from the DOM shortly *after*
  submit; giving it zero time to react before the field is gone is a plausible reason it'd work
  sometimes (whenever the heuristic's own check happened to run first) and not others. Wrapped
  the navigation in `setTimeout(() => go('home'), 150)` — 150ms is imperceptible to a user but
  gives WebKit a beat. This is a hardening/timing nudge, not a verified root-cause fix (there's
  no way to instrument Safari's internal AutoFill heuristic from this codebase to confirm it) —
  if reports continue after this, the next step is an on-device test comparing a regular Safari
  tab (should already work reliably) against the installed home-screen app (the harder case) to
  isolate whether this is inherent to standalone mode regardless of timing.
- **SW cache bumped** `ysc-v48` → `ysc-v49` (`public/sw.js`) since the login HTML changed again.

### Second login-screen help link: `/save-password.html` (2026-07-30)

Ported back from the camp app (which had itself copied `install.html` from here). The two
password-manager passes above are best-effort — iOS in particular, and *especially* the
installed standalone app, can simply decline to offer the save prompt — so there needs to be a
manual fallback a non-technical leader can follow on their own phone rather than a support
call. **Static page, not an in-app screen**: the SPA shell isn't up on the login screen, which
is exactly why `install.html` is a separate file too.

- **`public/save-password.html` (NEW)** — three cards: iPhone/iPad (Settings → Passwords, or the
  standalone Passwords app on iOS 18+), Android (Chrome → Google Password Manager), and a
  closing "Tip" card saying the pop-up usually appears by itself and these steps are only for
  when it doesn't. Structure/copy from the camp app; **styling, logo mark and page chrome are
  copied from this repo's own `install.html`** so the two help pages read as siblings (indigo
  `#4f46e5`, the circle/arcs mark — none of the camp app's violet/tent branding came across).
- **It keeps `install.html`'s `/settings` fetch block** (`GET /settings` is a public route, so a
  rebranded deployment gets its own `ministryConfig.branding.appName` in the `<title>` and the
  `.js-appname` span in the Tip card). The camp app dropped that block — it has no such field.
  The `.js-host` → `location.host` line is kept for the same reason `install.html` has it.
- **The highlighted "The address to save" block near the top is load-bearing** — every numbered
  step points back at it ("type the address shown in the box above"), because a password manager
  entry is worthless if the domain doesn't match. The camp version calls it "the purple box";
  here the steps deliberately say **"the box above"** with no colour word, since `branding.accent`
  is configurable per deployment and a hardcoded colour name could end up simply wrong.
- **Login screen** (`renderLogin`, public/index.html): the existing UA-gated tip paragraph
  (`/iPhone|iPad|iPod|Android/`) now carries a **second line in the same `<p>`** — "Password not
  saving? — how to save it manually" — same `var(--ink-faint)` / `var(--accent)` treatment as the
  Home Screen line, plus `line-height:1.9` now that it wraps to two lines. Same gate: desktop
  never sees either link.
- **CSP**: this repo sets **no CSP response header** (`express-adapter.ts` sets nosniff/frame/
  referrer/permissions/COOP/CORP/HSTS only; `vercel.json` has no `headers` block). The only
  policy is the `<meta>` in `index.html`, which applies to that document alone — so the inline
  `<script>` in `save-password.html` is unaffected, exactly as `install.html`'s already is.
- **SW cache bumped** `ysc-v52` → `ysc-v53` (`public/sw.js`) — `public/index.html` changed.
  The new page rides the normal cache-first static path (it is not an API route, so `API_RE`
  needs no change).

## 2026-10-02 — Term-start fixes (Login Activity automated, devices, phone/SPA hardening)

Plan: `docs/superpowers/plans/2026-10-02-term-start-fixes.md` (Task 3 UI and Task 7 superseded/dropped).

- **Login Activity (Admin tab)** is automated: per account it shows last login (Brisbane time, with
  year), logins in the last 30 days (`15+` when the 15-entry `loginHistory` cap is full) and the number
  of distinct devices; expand a row for the device list (label, first/last seen, count) and recent
  logins. Chips: All / Never logged in / Quiet 30+ days. No manual date input.
- **Data**: migration `0009` `users.login_history` (jsonb, newest first, capped 15) and `0010`
  `users.login_devices` (jsonb, newest-first by last use, capped `MAX_LOGIN_DEVICES` = 10).
  `SupabaseUserRepository.save()` upserts both columns unconditionally — **apply new migrations to prod
  BEFORE aliasing the new code**, or every user save fails. `AuthService.login` records both inside its
  fail-open try block (a recording failure never blocks login). The SPA sends `deviceId` (random UUID in
  localStorage `yap_device_id`, deliberately NOT cleared on logout) and `deviceLabel` (`_deviceLabel(UA)`,
  e.g. "iPhone · Safari"). Grade/quad accounts are shared, so several devices per account is normal;
  clearing site data counts as a new device.
- **Naming rule**: Login Activity helpers are all `_la*`. `_relTime` is the Prayers helper; the two once
  collided (later declaration wins) — never reuse that name. `src/tests/spa-term-start.test.ts` pins it.
- **Auth**: `boot()` only clears the token on a 401 (a 503/network blip no longer logs people out). Any
  401 on an authenticated request calls `_handleAuthExpired()`: mid-preview it restores the admin
  session from `_previewStash`; otherwise it logs out with a toast. Logout also clears the per-user
  filter keys (`yap_ar_filter`, `yap_prayer_filter`, `yap_connect_filters`, `yap_leader_id`).
- **SW registration**: reload on `controllerchange` only if the page already had a controller (not on
  first install), once only; `reg.update()` on `visibilitychange`. Cache bumped `ysc-v55` → `ysc-v56`.
- **Other SPA fixes**: Prayers CSV export now includes Created By Grades/Gender, Created At, Answered At
  (round-trips through the importer); student search matches tokens in any order and the inputs disable
  autocapitalize/autocorrect; import-report row numbers are `+2` (header + 1-based); `_setImportStatus`
  is null-safe so a missing `#import-status` can't leave `_importBusy` stuck.
- **Phone CSS**: quick-link grid goes 1-column ≤380px; landscape (`max-height:500px`) bottom nav is a
  compact row; `(pointer:coarse)` raises `.btn-sm`/`.tbbtn`/`.btn-icon` to 40px; admin tab bar has a
  right-edge fade; text floor 11px (chart `.ccol-*` micro-labels 10px). Real-device touch/safe-area
  behaviour was not tested.
- **Tooling**: `node scripts/check-spa-syntax.js` parses the inline script (run after every SPA edit);
  `src/tests/helpers/extract-fn.ts` (`extractFn`/`loadFns`) evaluates real function bodies from the HTML.
- `npm audit fix` (non-force) moved express 4.22.3, body-parser, qs and a few transitive patch versions.
  Never run `npm audit fix --force` (it wants @vercel/node 17, a breaking change).

### Multi-location rollout (2026-10-10)

Spec `docs/superpowers/specs/2026-10-10-multi-location-rollout-design.md`. Other locations run their own fork + Supabase + Vercel + Google project; guides are `docs/DEPLOYING.md` and `docs/GOOGLE-SETUP.md` (ASD-STE100; `node scripts/check-guide-style.js` checks them).
- **Setup**: no `SESSION_SECRET`/admin no longer kills the app. `GET /setup/status` drives a first-run checklist in the SPA (Generate + Copy for `SESSION_SECRET`, `FIELD_ENCRYPTION_KEY`, `SETUP_CODE`), then `POST /setup/admin` creates the user `admin`. Admin has a **System check** tab with the same checklist.
- **403 text changed**: "The setup code is wrong. In Vercel, open Settings > Environment Variables. Copy SETUP_CODE again." (generated values live only in browser memory).
- **Google**: `GOOGLE_SA_JSON` (+ `GOOGLE_MAPS_API_KEY`); Bus settings has **Test Google connection** (`POST /bus/google-check`, 5 rows). `scripts/google-setup.sh` runs in Cloud Shell; the guide pastes it pinned to a commit SHA (`COMMIT_SHA` placeholder until pushed).
- **`/health`** reports `db` and `schema {current, expected}`.
- **Settings file**: Youth Setup "Use this setup at another location" (Download/Load settings file) replaces the old in-app deploy-guide card.
- `/setup` is in `router.ts`, the `vercel.json` regex and `sw.js` `API_RE`.

### New youth forms (2026-10-11)

**▶ Resume here (state as of 2026-10-12):** built, reviewed and **merged to `master` and pushed 2026-10-12** (the laptop build, 12 commits after `052bcc8`, then the More menu commit the same day). **Not promoted yet**: `ys-connection.vercel.app` changes only when the owner promotes the build in Vercel. New person is Off by default, so after promotion what everyone sees is: (a) the grade/leader nav swap; (b) the leader Home quick-action buttons in the new order; (c) **More** in the Prayers slot for every login, because Bus Ministry is on in prod, so there are 2 modules (Prayers, Bus); and (d) one SW cache refresh (`ysc-v89`). Shadow mode then has to be switched on in Youth Setup. Sends are live (the `ELVANTO_FORMS_LIVE` gate was removed 2026-10-12, owner). Left to do, in order:
1. **Owner:** promote the build; `curl -s -X POST https://ys-connection.vercel.app/intake/new-youth` must return a JSON 401.
2. **Owner:** phone-width visual check (Claude never did one): the New person form, the warn and result pages, the More sheet, the swapped navs, a refusal from the bottom of the form, and leaving mid-send.
3. **Operator: plan Task 0** (live capture in their own browser → `D:\ys-connection-intake\capture.md`). Then Claude pastes `SUCCESS` into `elvanto-forms.ts` and adds a captured-reply test (see the OPEN ITEM below).
4. ~~Set `ELVANTO_FORMS_LIVE=1`~~: the gate was removed 2026-10-12 (owner); every deployment, local dev included, sends live. The owner tests through the app and deletes test submissions in Elvanto. Citipointe approved the feature 2026-10-11.

**Owner calls still open (parked, not bugs):**
- **Wording:** "Check the forms list in Elvanto" assumes Elvanto access, which shared-login hosts may not have. Maybe "Ask the youth admin to check Elvanto". (Final review M7.)
- **Carry-over:** a Brisbane settings file loaded at another location carries `newYouthForms`, but it can't send there without that location's own `ELVANTO_FORMS_LIVE`. (M8.)
- **Late POST:** no server deadline before the student POST, so if the settings read stalls, the student form can still be sent after the phone gave up. The host sees "we don't know", and nothing is auto-resent. (M2.)

**Deferred minors:**
- Two toasts can collide on the toast timer.
- A Youth Setup save that changes the nav rebuilds the whole shell, so the scroll position is lost.
- In json mode, a legacy boolean `newYouthForms` gets a server 404.
- `classifyPost` treats 201/202/204/408/429 as `failed`. Revisit with the Task 0 capture.
- The Bus "New Person" regex test is weak.
- `account.service.test.ts` "applying Complex deactivates the pre-existing grade7g…" sometimes times out (~5 s) on the laptop. This predates the feature and was ignored.
- From the 2026-10-12 independent Opus review of `052bcc8..f105c46` (verdict: ready to promote):
  - M-1: several SPA tests check that a string is present rather than running the code.
  - M-3: toggling Bus in Youth Setup now rebuilds the whole shell (a brief blank and extra prefetch).
  - M-5: focus doesn't move into the More sheet.
  - M-2 (More with Prayers alone stays a plain Prayers tab) is the owner's chosen behaviour.

A host types a new student and one parent into the **New person** screen (its user-facing name since 2026-10-11; every internal name stays: route `/intake/new-youth`, page id `new-youth`, module key `newYouthForms`, `_ny*`/`ny*`). The app sends Citipointe Brisbane's two public Elvanto connect forms (student, then parent). No Elvanto account is needed. Built on branch `feat/new-youth-forms`, merged to `master` (deleted after the merge); no migration.
- **Route:** `POST /intake/new-youth` (`new-youth.controller.ts` → `new-youth.service.ts`). RBAC `intake:write`, granted to all five roles. Module `ministryConfig.modules.newYouthForms` has **three states**, **off by default** (Youth Setup → Modules, an Off / Shadow mode (admin only) / On select):
  - *Off:* nobody sees it; the server answers 404 (`ModuleDisabledError`).
  - *Shadow mode:* only the `admin` login sees it and can send. Every other role gets the same 404 and sees no page or More entry. The decision is `canUseNewYouth(actor, mode)` in `access-control.ts`, called by the service.
  - *On:* every role with `intake:write`.
  - The old boolean still parses (`true` = on, `false` = off) via `z.preprocess`, so a stored config from before needs no migration. The SPA reads a legacy boolean the same way (`_nyModeOf`).
  - Shadow mode controls **who** may use it only. Sends are always live (gate removed 2026-10-12).
  - *The More menu (2026-10-12; replaced the shadow-mode "Prayers chooser" and the New person Home tile):*
    - `moreItems()` lists the modules this login can use right now: Prayers (always), Bus Ministry (`_busOn()`), and New person (`_nyOn()`). Later, add service check-in and the lifegroup report here.
    - With 2+ entries, `navItems()` replaces the `prayers` item **in place** with `{ id:'more', ic:'grid', label:'More', action:'openMore()' }` for every role, in the bottom and desktop navs. With Prayers alone the slot stays a plain Prayers tab.
    - `openMore()` opens the standard `modal()` bottom sheet (`.more-list` / `.more-row`). The current page's row is marked `.on` and **only closes the sheet**: re-running `nyOpen()` there would wipe the form or an unknown-outcome result (independent review I-1, fixed 2026-10-12). The More nav links carry `aria-haspopup="dialog"`. New person's entry is `nyOpen()`, which never wipes an in-flight send.
    - More lights up on any page it lists (`_updateNavActive`). `prayers` stays a root page with no back arrow (`_isRootPage`); `bus` and `new-youth` stay sub-pages as before.
    - The leader Home quick-action grid uses `_navItemsBase()`, so it still shows a plain Prayers button.
    - New person has **no Home tile** (owner, 2026-10-12). Bus keeps its Home tile.
    - `_initShell` builds both navs with `_navClick(it)`. Saving Youth Setup rebuilds the shell when `_navSig()` changed (More appearing or going), so no reload is needed.
  - *Nav swap (2026-10-11):* the bottom nav for `grade` is now Home | Health | My Connections | Prayers | Setup, and for `leader` Home | Prayers | Health | My Connections | Birthdays. Other roles are unchanged. The swap applies in every module state, Off included. The leader's Home quick-action grid follows the nav order, so it changed too (Prayers / Health / My Connections / Birthdays).
- **Always live since 2026-10-12** (owner removed the `ELVANTO_FORMS_LIVE` gate: `container.ts` passes `{ live: true }`, so local dev and previews send real forms too). The service keeps its dry-run path for tests: Live is the explicit opt-in: `makeNewYouthService(settings, opts)` posts only when `opts.live === true`, so a caller that omits the option gets a dry run. A dry run still fetches both forms and checks their shape, then returns `skipped`/`skipped` with `dryRun: true`. The SPA says "Test mode: nothing was sent to Elvanto." Set it for **Vercel Production only**.
- **Where Elvanto's markup lives:** `src/services/elvanto-forms.ts` only (form ids, field names, option ids, the body builders). It was captured 2026-10-11. Fixtures: `src/tests/fixtures/elvanto-student-form.html` and `elvanto-parent-form.html`. One location is hard-coded; move it into `ministryConfig` when a second location forks.
- **The shape check:** before any POST the service fetches both live forms and runs `shapeProblems()`. It refuses with 502 `ELVANTO_FORM_CHANGED` if a field or option id we post is missing, if the form has an input we do not post, or if the honeypot is missing. Nothing is sent. The message tells the host to use the welcome-desk form and tell the admin. **If the church edits a form, refresh the fixtures and the constants in `elvanto-forms.ts` together.**
- **Reply classifier:** `classifyPost()` returns `sent`, `failed`, `unconfirmed` or `skipped`. A 5xx, a timeout, or a reply it cannot read is `unconfirmed` (Elvanto may have saved it). A reply that is the form again (`name="save"`) is `failed`. If the student form is `failed`, the parent form is not sent. Only the `SUCCESS` table can give `sent`.
- **2026-10-12 live test (owner):** a send from the app landed both forms in Elvanto, and both replies were accepted-looking (not `failed`). So with no `SUCCESS` rule set, `classifyPost` now returns `sent` for a redirect or a 200 that isn't the form again; a rule, if set, still narrows it. The text below is the earlier state.
- **(Superseded) OPEN ITEM: the live capture (plan Task 0) has NOT been done.** `SUCCESS` is `null` for both forms, so every accepted-looking reply is `unconfirmed` and the screen says "check the forms list in Elvanto". It never says `sent`. **Task 0 is a hard condition before going live.** Until it is done the classifier's `failed` rule (a 200 that shows the form again) is also unverified, so a real success page that contains a form would read as "wasn't accepted" and invite re-sends. When `capture.md` exists (in the operator's `ys-connection-intake` folder, plan Task 0 Step 6): paste each form's success redirect or marker into `SUCCESS`, add a test with the captured replies, and decide whether the student mobile becomes optional. **Student mobile is required until then.**
- **Never auto-resend.**
  - *Dedupe:* the key is a hash of first name, last name, date of birth, parent mobile and which forms. In live mode an `unconfirmed` mark is written **before** the form GETs, so a second tap while the first is still running gets `unconfirmed` + `repeat: true`. The mark is cleared if the GETs fail or the form has changed. The final result is kept for 2 minutes, except when either form was rejected (`failed`), so a fixed retry goes through.
  - *Rate limit:* 60 sends per hour per login. Logins are shared (`grade9g`), so a busy night needs headroom.
  - Both are **in memory, per serverless instance**. A double tap normally lands on the same warm instance. Move them to a DB row if that stops holding.
- **Timeouts:** each form GET 8 s (the two run in parallel, and a 30x is never followed: `redirect: 'manual'`, so it reads as unreachable); each POST 10 s. The route is in `UNTIMED_ROUTES` (`express-adapter.ts`), because the 20 s guard's 503 "try again" could arrive after the student form is already in Elvanto and invite a duplicate. The SPA's send uses a 45 s client timeout. The server's worst case is about 28 s (8 s GETs + two 10 s POSTs) plus the settings read, inside the SPA's 45 s wait and Vercel's 60 s. **Watch item:** a local dry-run smoke test saw the first send fail with 502 `ELVANTO_UNREACHABLE` (a cold fetch over the old 5 s limit, now 8 s) and the next ones succeed. If hosts still see this, raise `GET_TIMEOUT_MS` in `new-youth.service.ts`.
- **SPA** (`/* NEW-YOUTH */` block in `public/index.html`; grep `NEW-YOUTH`, `_nyMessage`, `nySend`):
  - A refusal **before any POST** is recognised by the server's error **code**, not the status: `BAD_REQUEST`, `MODULE_DISABLED`, `RATE_LIMITED`, `ELVANTO_UNREACHABLE`, `ELVANTO_FORM_CHANGED` (`API` attaches `err.code`). The form stays with the inputs kept, and the red card sits directly above Send and is scrolled into view (the form is long and `setApp` keeps the scroll position). Everything else, including a bare 502 from Vercel itself when a function dies, is an unknown outcome.
  - An unknown outcome of a full send shows a **warn result page** (the student's name, "We don't know if the forms went in. Check the forms list in Elvanto before sending again.") with a deliberate "Back to the form" button, never a pre-filled form with a ready Send button. It never says "try again".
  - `nySend` holds its own state object (`const mine = NY`). If the host leaves the screen mid-send, the reply is shown in an 8 s toast and never repaints or wipes the next entry. The More entry calls `nyOpen()`, which does not reset while a send is in flight; coming back mid-send shows a "Sending..." page.
  - A 401 mid-send draws nothing: the session handler has already shown the login screen.
  - "Send the parent form again" appears only when the student form is in and the parent form failed. If that retry fails, the screen stays on the result page, so the student form is never sent twice.
  - "Add a brother or sister" keeps the parent details and sends the student form only. It is offered only when neither form failed (so it never competes with "Send the parent form again").
  - Logout clears the screen's state (`nyReset()`).
  - Only the host's own name is stored, in `localStorage` `ysc.nyHost`, on that device.
- **No personal data is stored or logged.** Validation errors name the field only (fixed `LABELS` strings), never the value. Names are tidied to match Project 11.1's `capName`, so 11.1 does not offer a capital fix on a form this app sent. Phones go out as bare `04XXXXXXXX`.
- **`/intake` is registered in all three places** (house checklist): `router.ts`, the `vercel.json` regex, and `public/sw.js` `API_RE`. After deploy, `curl -s -X POST https://<deployment>/intake/new-youth` must return a **JSON 401**, not HTML.
- **SW cache** `ysc-v87` → `ysc-v88` → `ysc-v89` (More menu).
- **Going live (operator, plan Task 6):** first run on a preview deployment in dry run. Then, **only when Task 0 is done** (`capture.md` written, `SUCCESS` pasted into `elvanto-forms.ts`, captured-reply test green), **Citipointe has approved (given) and the owner has promoted the build**, set `ELVANTO_FORMS_LIVE=1` for Production only and redeploy. Pushing `master` does not promote prod: the owner promotes.
- **Tests:** `elvanto-forms.test.ts`, `new-youth.service.test.ts`, `new-youth.controller.test.ts`, `new-youth.spa.test.ts`, plus `access-control.test.ts` and `ministry-config.test.ts`. 1047 tests pass in total (74 files).

## Elvanto link (app side) (2026-10-12)

**State:** pushed to master `cbe0255`, migration `0017` applied on prod; V2 (the real-Postgres repository suite)
passed on prod 41/41 on 2026-10-12 with the 8 link tables empty before and after. Triage sections A, B and C done
(`docs/superpowers/elvanto-link-progress.md` is the ledger; `docs/superpowers/reviews/2026-10-12-link-review-outcomes-app.md`
holds the binding rulings). Contract: `docs/superpowers/specs/2026-10-11-elvanto-link-contract.md` (v1, text amendments
X1-X17); app spec: `docs/superpowers/specs/2026-10-12-elvanto-link-app-design.md`. The other half is Project 11.1, the
Elvanto Sync Console on the office PC, which talks to Elvanto; this app never does.

**2026-10-12 afternoon:** the console is connected to prod and **all six action types are Live** (owner ruling: "shadow"
means the app's admin-only menus, `modules.newYouthForms = shadow`, not practice sends). Same day fix: the Lifegroup
report screen sat on "Loading..." forever because `lgDisplayName` was declared inside the Connection Audit IIFE, so the
first group painted threw a `ReferenceError` (an unhandled rejection; the 25 s request timeout never fires because the
request already succeeded). It now sits above `/* ── CA MODULE START ── */`; `src/tests/link-globals.test.ts` guards it.
**A helper the link block calls must be global: nothing inside `const CA=(()=>{ … })()` is reachable from outside.**

**Architecture**
- **Phone → app:** a tap goes into a per-login queue in localStorage (`ysc.lkq.<user id>`, try/catch, memory-only after
  a storage error) and is flushed in batches of up to 50 to `POST /link/batch` (right away, on `online`, on
  `visibilitychange`, on the next tap). Every item has a client UUID, so a retry is a `replay`. There are no single write
  routes any more (T-42). The SPA block is `/* ── LINK MODULE ── */` in `public/index.html` (`_lk*`, state `LINK`):
  door check-in (`link-checkin`), leader quick check-in, lifegroup reports (`link-groups`), flow steps (`link-flows`), the
  admin page (`link-admin`), and the first-timer tick on New person.
- **App → Elvanto:** the console polls `POST /sync/claim` (heartbeat + lease of pending outbox rows), reports
  `POST /sync/result`, and pushes mirrors (`roster`, `services`, `groups`, `flows`) with `POST /sync/push/:kind`.
  `link.service.ts` (leaders/admin), `sync.service.ts` (console), pure `link-rules.ts` (service day, dedupe, outbox state
  machine, auto-match, effective check state), `core/link-contract.ts` (Zod, frozen fixtures in
  `src/tests/fixtures/elvanto-link/`, LF-only via `.gitattributes`), `ILinkRepository` (in-memory + `supabase.link.ts`).
- **Data:** migration `0017` = 8 tables `link_outbox`, `link_roster`, `link_services`, `link_groups`, `link_flow_people`,
  `link_console`, `link_mirror_state`, `link_log`. Notes in `link_outbox.note` are encrypted with
  `FIELD_ENCRYPTION_KEY` (AAD `link_outbox.note:<id>`). `link_log` is the identity + action log (admin view and xlsx
  export). The claim note carries `Self identified leader: <name> — <note>` (X1).
- **Rules worth knowing:** "I am" (the self-identified leader) is required for reports and flow steps; a check-in tap
  older than 3 days is refused (`LINK_TOO_OLD`, counted from the tap); a late item changed by someone else after the tap
  is `LINK_STALE`; rate limit 600 new rows per 10 min per login; dedupe by (person, service, type).
- **The switch:** since 2026-10-12 each screen has its own switch (`modules.newYouthForms`, `checkin`, `lifegroupReport`,
  `flows`; Off / Shadow (admin only) / On; see "UX batch"); there is no `modules.elvantoLink`. Off is the stop button for that
  screen: `/link/*` answers 404 and the claim leases nothing, but mirrors still arrive. To stop all data flow, also
  turn off the link on the console. There is no practice/shadow stage for link writers (operator ruling 2026-10-15): every action type is live, and the app shows no practice banner.
- **Routes:** the house checklist applies: `/link` and `/sync` are in `router.ts`, the `vercel.json` regex and `sw.js`
  `API_RE`. The `/sync` routes are `sync: true` in the route table (no session; the adapter checks the token, exact and
  timing-safe, never logged).

**`LINK_SYNC_TOKEN`** (Vercel, Production only; the same value in the console's link settings).
- `/sync/*` refuses with 503 `LINK_OFF` while the token is unset or under 32 characters (after trimming), so the
  console cannot claim or push until it is set. A wrong token is 401. Admin → System check shows the token row
  (set / too short / not set; never the value).
- The adapter reads it per request (`readLinkSyncToken`), so a new value takes effect as soon as the deploy carrying it
  is promoted.
- **Set or rotate it** (outside the service window; queued rows just wait):
  1. Make a token: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` (43 characters).
  2. Vercel → Settings → Environment Variables → `LINK_SYNC_TOKEN` (Production) → paste → redeploy. The owner
     promotes the build (pushes and redeploys do not move `ys-connection.vercel.app` on their own).
  3. Paste the same token into the console's link settings (Project 11.1). Between steps 2 and 3 the console gets 401
     and backs off; nothing is lost.
  4. Check: the admin Elvanto link page shows the console Online within a poll or two.
  5. A leaked token: do steps 1-4 at once. The old token stops working when the new build is promoted.

## 2026-10-13 UX batch (T1-T7)

**▶ Resume here** (branch `feat/ux-batch-2026-10-13`, tip `a430b98`, 2001 tests pass / 1 skip, typecheck clean, SW `ysc-v99`, migrations through `0021`, next migration was `0022` (now `0025`), nothing pushed). Run files: `src/ux-run-2026-10-13/` (rulings.md, ledger.md, t4/t6 contract deltas, reviews/consolidated.md). Spec for T4: Project 13 `ys-connection/2026-10-13-intake-consent-app-spec.md` (rulings R1-R7 in its section 14). The console half (Project 11.1, branch `feat/ux-group-members`) is built: T6 `2ca3ad0`, T4 `5916bac`/`7d7eb24`/`42cba41`, review fix C `2c6152f`; `npm test` 10078 pass.

**What shipped (by T-number)**
- **T1** admin tab strip: `ADMIN_TABS` array + `_adminTabsHtml(cur)` renders pills and a `<select>`; under 768px only the select shows (CSS scoped to `.admin-tabs`/`.admin-tabsel`, because `.tbbar` is shared with Bus). New admin tabs go in `ADMIN_TABS`.
- **T2** New person guards (SPA): top-level `toAuMobile`/`tidyName` are ports of `elvanto-forms.ts` (parity test `new-youth.guards.test.ts`); `_nyFieldMsgs/_nyShowMsgs/_nyBlur/_nyRaw/NY_ERR_IDS`; `_nyRead` tidies names (only all-lower or ALL-CAPS) and normalises mobiles. Blocks: bad mobile (04 + 10 digits), postcode not 4 digits, parent name = student name (marks both parent fields). Warns only: parent mobile = student mobile. No email field exists on the form, so no email guard. Errors use `.ny-err`; a blocked Send focuses the first `aria-invalid` field.
- **T3** admin Error log tab. `services.errorLog.record({category:'server'|'link'|'elvanto-form'|'client', code, route, status?, role?, count?})` never throws, waits at most 2 s, and is throttled to one DB write per fingerprint per 30 s per instance (the skipped count is carried into `n`; the sweep's `setCount` path is never throttled). It stores code, route, status, role, time and a fixed message only: never names, phones or values. Logged: every 5xx (adapter; `ELVANTO_*` -> `elvanto-form`), a crashed link batch item, console refused/unclear results (grouped by type + code, one record with `count`), claim sweep too-old/lease-lost, note-unreadable, New person unconfirmed/failed, SPA `onerror`/`unhandledrejection`/API 5xx + network. Stuck link rows pending over 24 h are counted per type when the tab opens (set, not incremented). Routes `GET /admin/errors`, `PATCH/DELETE /admin/errors/:id`, `DELETE /admin/errors?category=` (all `admin:manage`); `POST /admin/errors/client` (any login, 20 per 10 min per login + 10 per page load). **Client whitelist:** the report route must be in the router table (`errorLog.setKnownRoutes()` from `buildRoutes`), otherwise it is stored as `page`; an unknown code becomes `HTTP_<status>` or `CLIENT_ERROR`. Grouped by fingerprint with count + first/last seen; Minimise / Ignore (hidden, not flagged new, repeats still counted) / Delete (reappears if it recurs); category filter + Delete all (arm text names the count; Ignore toasts how to undo; a failed load has Try again). 90-day purge; "New" badge per device (localStorage). `sendError` split into `errorResponse()` + send; `createApp` takes the log as 4th arg.
- **T5** lifegroup report: per group a collapsed members list (`GET /link/lifegroups/:groupId/members`); tap a student -> `showStudentDetail(id,{two:true})` (2-column). Existing access rules (`canAccessStudent`); unmatched or no access -> name + roster grade only. A newly added student is not tickable on the report until the next groups push.
- **T6** lifegroup add / remove student: new link types `addGroupMember` / `removeGroupMember` `{groupId, personId}`; `GET /link/youth` (picker over `link_roster`, grade filter); `canEditGroupMembers` = admin, director, or I-am-leader of that group. The app shows Pending until the result; an opposite pending change cancels the first. Refusal reasons `group-unknown`, `leader-member`, `already`. Refused or too-old rows land in the error log. Table `link_group_members` (migration `0020`). The console writer reuses `addMember`/`removeMember` in `elvanto-write.js` (Lifegroups shapes, **uncaptured, medium confidence**) and ships LIVE by operator ruling.
- **T7** Bus: "All cars" tab removed; a collapsed `<details>` "All cars" (`_busAllCarsSection`, `BUS.carsOpen`) sits under My car. `/bus/run/cars` is fetched on expand and polled every 10 s only while open; access unchanged (`canSeeCars`). No count until first expand (O3).
- **T4** Intake + Consents (app side). Contract X19: **`LINK_REV` 2 -> 4** (rev 3 = member types, rev 4 = intake types). Each rev adds optional capability keys (member keys, then four intake keys); capabilities are `Partial`, so an older console that lists no key is never leased that type (an in-memory claim bug that leased unlisted types was fixed: a missing type means off). The console sends the new keys only after the app's claim reply says `linkRev >= 3` / `>= 4`. Strict `intakePlan` / `consentPlan` pushes (unique row keys per push, Suburb diff must be blank), `planned` outcome, per-step `steps`/`stop` on results, claim `hint` (refresh asks + "hurry"). Routes `GET /link/intake(?mode=&date=)`, `GET /link/intake/row`, `POST /link/intake/refresh` (`intake:admin`). Module **`modules.intakeAdmin`**, off | on, **default Off**: 404 when off, 403 for non-admin; admin only. SPA: More > Form Approve & Consent (named "Intake" until 2026-10-14b) with Intakes / Consents tabs, family review, Save sheet, parent-text card, "Console last seen" banner, Youth Setup switch. Tables `link_intake_dates` / `link_intake_rows` / `link_intake_view` (RLS on); row detail encrypted with AAD `link_intake_rows.detail:<mode>:<date>:<key>`; phones + DOB encrypted, no address/allergy/medical. `link_outbox` gains `steps`/`stop` jsonb. Expiry: a queued intake item not leased in 24 h -> Refused too-old (error log); a plan older than 2 h is greyed stale and `INTAKE_STALE` 409 blocks acting on it; rows are purged 14 days after creation; intake notes are nulled once final. Intake items bypass the localStorage queue (only `ysc.intakeTab` is stored). New person's student form carries a submission ref `<host> (YS-XXXXXX)` on the host answer so the console pairs student + parent ("From app"). **Intake Off save** clears the intake tables, cancels pending intake rows (status `cancelled`) and strips the intake capability keys from the claim (`link_console` stores the stripped caps); see `intake.off()` / `onIntakeOff`. An Off module never leases intake rows. **Hourly purge:** one `purgeIfDue()` (hourly) used by `list()` and `hint()`, so the 14-day PII purge still runs with the console off.
- **Review fixes** (19 items R1-R19 from 5 reviewers + 1 collector): R1 a failed answer POST sets `I.resend[key]` and Save/Text are blocked until it is resent; R2 a refresh ask is offered only while under 10 min old (`REFRESH_ASK_MS`); R5/R6/R8/R9/R19 as above (plus `Uuid` exported once from `link-contract.ts`); R10 the Intake poll repaint skips while a field has focus (`pendingDraw`, repaint on `focusout`); R11 `.el-top` is a real button and a global Enter/Space handler covers `[role=button]`; R13-R18 touch targets, "Not now" / "Text the parent", `ik-dot`, `_ikFix` autofocus + Enter, `_ikUndo` confirm. Console: R3 `pollMsNow()` (hurry 10 s, 60 s while intake is on outside the window, else 900 s), R4 one re-claim when the app's rev changes the capabilities, R7 per-row parent picker.

**Console defaults (11.1):** `intakeSave` / `consentSave` / `intakeText` Practice; `intakeText` is also locked without `SEND_VERIFIED`; Lifegroup add / remove LIVE; `intakeAnswer` has no Setup switch (no Elvanto write). A missing shadow key takes the shipped default.

**Migrations:** `0019` error_log, `0020` link_group_members (renumbered from 0019 at integration, two lanes had taken the same number), `0021` intake (tables above + `link_outbox.steps/stop`). `LATEST_MIGRATION` was 0021 here (now `0025`, next `0026`). **`FIELD_ENCRYPTION_KEY` is required** (intake detail, phones and DOB are encrypted); set it in Vercel before the promote.

**Operator rulings (2026-10-13):** T1-T8 in `rulings.md`; T6 writer ships live; T4 spec first, then approved. Review questions: **O1** keep members LIVE, but the operator does a supervised add + remove first. **O2** the pre-promote checklist below. **O3** no "All cars" count until first expand. **O4** keep the provisional ruling tags (D25, D20(b), D26, D17(b)) on the Intake screen until settled, then delete `_ikDTag`/`_ikD26`/`_ikTagHtml`. **O5** an `unclear` intake outbox row is deleted after 14 days (the console Unclear-save box is where it is settled).

**PRE-PROMOTE CHECKLIST (ruling O2). Do these in order, do not skip.**
1. Settle the pending 2026-10-12 promote (`bd44614` / `0ad9653`) first, so a failure traces to one batch.
2. **Snapshot the prod DB.** Migrations 0019-0021 and their Supabase repos have never run on real Postgres; the V2 real-DB suite does not cover `error_log` or the intake tables.
3. Push; read the Vercel build log: it must count through 0021 ("K new" migrations applied, then `Database up to date`).
4. `curl -s https://<new-deployment>/health` -> `schema.current` = `0021`.
5. Against the new deployment each of these must return a JSON 401 (not 500, not HTML): `curl -s /admin/errors`; `curl -s -X POST /admin/errors/client`; `curl -s /link/lifegroups/x/members`; `curl -s /link/youth`; `curl -s /link/intake`.
6. Only then promote in Vercel (the custom domain does not auto-alias; see debug.md).

**ROLLOUT ORDER:** app promote first (a console still at rev 2 keeps working: it leases no member or intake type and the SPA hides those controls), then merge + restart the console (the first roster build takes minutes; keep it outside the service window).

**OPERATOR LIVE TEST (nothing here is automated)**
1. Lifegroup members, supervised, on a test student in a test group: add, check Elvanto, remove, check Elvanto, then add twice to see the `already` refusal. Keep `lifegroupReport` in Shadow until it passes. `e2e-ys-link.js` is not extended for rev 3/4; skip it if this passes.
2. Intake: leave `intakeAdmin` Off first. Turn it On for one Friday with `intakeSave` / `consentSave` in Practice and compare the Form Approve & Consent screen with the console Youth intake tab. Then move Practice -> Live one step at a time.
3. Parent text last: `intakeText` stays locked until one `SEND_VERIFIED` SMS reaches a staff phone; then Practice -> Live.
4. Browser checks (admin select at phone width, Error log tab, Form Approve & Consent screens, All cars section) are the operator's.

**DEFER list (from the consolidated review)**
- Perf: S6 `groupMembers` does `students.findAll()` + phone decrypt per open members list (add a by-ids read if logs show it); S7 no index on `link_outbox (payload->>'groupId')` (add `link_outbox_group_idx` in `0022` past ~50k rows); S8 a push clears a refresh ask made during its read (fix with `case when refresh_asked_at <= excluded.taken_at` plus real-DB tests); S10 three plan reads per `intakeAnswer`; S11 three to four Elvanto page loads per member add + a full groups push (trim once the writer is proven); C9 the consent push is a whole-date Elvanto read every 5 min while hurry (cache 10 min if slow); C6 the 300 s / 3-row lease can be outlived by a long chain (no double write; claim 1 when intake rows are present if seen).
- Design: S9 the console re-pushes the plan before queueing the result (by design); C3 push stamp is set on a read failure; C4 `takenAt` is the call time, not the cache time; C5 an unreadable person id is refused `console-cannot-read` after 1 h, not `person-unknown`; H3 archived group not refused and leader check is link-only on the console member path; H6 show "waiting since" + "Console last seen" on Pending member changes; H7 3-day member expiry vs 24 h intake expiry; H10 the app's `keep` carries no values (push kept values = contract change, or label Keep advisory); H12 add an HTML-in-name test per new view; H15 fixtures carry the tenant host (already public in `elvanto-forms.ts`; check the 11.1 publish denylist).
- Cleanup: P7 `_ikPast` inflector; P8 `_ikReasons` duplicates the console DETAIL; P12 six UUID regex copies in the console; P13 `ys-intake.js` re-derives the Brisbane day; P14 `REASONS = Object.keys(DETAIL)`; P15 `isLive` alias in `ys-link.js`.
- UI: U15 member rows nest buttons inside `role=button` (Keep missing on a pending remove when add is off); U16 Add queues on one tap, `youthErr` has no Retry; U18 console `appAnswersLine` shows time only (add weekday).
- Open from lanes: the real-DB V2 suite lacks `error_log` and the intake tables; the ">3 days old" intake warning needs a parseable date; the client rate limit is in-memory per instance; `LINK_SYNC_TOKEN` unset makes a `LINK_OFF` row increment each poll; a 503 can be up to 2 s slower when the DB is down; unknown person id retries `cannot-read`; form `at` not built.
- SW cache: this branch bumps `ysc-v98` (live) to `ysc-v99` once for the whole batch; no further bump needed unless more SPA changes land after a release.

- **T4 fix (2026-10-14, SW `ysc-v105`, migration `0025`):** `0025` renames the quad logins by `users.quad`; `doLogin` now calls `_quadIamPrompt` (the stray call in `submitCreateAdmin` is gone, admin is never a quad); `doLogout` no longer removes `yap_leader_id`, so the "I am" pick persists across logout. Test: `quad-iam.spa.test.ts`.
- **Junior/Senior Home + nav (2026-10-14, SW `ysc-v106`):** quad nav = the grade nav (Home | Health | My Connections | Prayers | Setup; quick actions Trends (hero pill), Student Search, Birthdays). Home has an All / per-grade button row under the hero (`_homeGradeBar`, grades from `quadGrades`). All = the quad Home over the whole bracket (`_vgBar` is no longer on Home; other screens keep it). A grade draws the grade-N login's Home through the same `_renderHomeInner`: `_homeViewUser(qu, g)` makes a grade-role view user; `sc`, stats and the lifegroup average narrow to that grade. Default `_homeGrade()`: the saved pick (`localStorage yap_home_grade.<userId>`, 'all' or N) wins, else the "I am" filter's grade when `_vgGrades()` is exactly one, else All. `_navItemsBase(u)`/`_navSlots(u)`/`quickActionItems(u)` take an optional user. Tests: `quad-iam.spa.test.ts`.
- **Setup "Inactive leaders (N)" (2026-10-14, SW `ysc-v106`):** a collapsed `<details>` at the bottom of Setup (`_inactiveLeadersHtml`), hidden when none. Data: `GET /leaders?inactive=1` (`LeaderService.list(actor, {inactive:true})`: `repo.findAll()` filtered to `active === false`, same role scoping as `/leaders`, and `leader:write` required, i.e. the roles that have Setup). Fetched once in the background; `Cache.del('/leaders')` drops it too. Each row's Edit opens `showEditLeader`, whose Active box reactivates. Tests: `leader.service.test.ts`, `setup-inactive-leaders.spa.test.ts`.

## UX batch 2026-10-14b (lanes A-E merged + pushed to master 2026-10-14; SW `ysc-v103`; migrations `0022`-`0024`; `LINK_REV` 5)

**▶ Resume here.** Run files: `src/ux-run-2026-10-14b/` (rulings.md T1-T13, ledger.md). Pushed, **not promoted**; the operator promotes in Vercel. Console half (Project 11.1, lanes E + F) merges after the promote.

- **T1/T2/T3 Lifegroups:** grade chips `_lkGrFilter` (only with 2+ grades; localStorage `yap_lk_grade`), rows tinted by gender (`--girl-light` / `--boy-light`), tile "Last report <date> · Attendance: N" (string-concat bug fixed). Detail: no Service row, tighter `.lk-mem`. **Add report** (`_lkAddReport`, `LINK.rf.add`) sits under the week's reports; the leader picks the date (default meeting day); a same-date report is a **warning**, not a refusal (add flow only).
- **T4 Quad accounts:** usernames `juniorgirls` / `juniorguys` / `seniorgirls` / `seniorguys` (migration `0022`, idempotent; ids, passwords and `users.quad` unchanged; see "Quads"). A quad login with no saved leader gets a one-time "Who are you?" (`_quadIamPrompt` -> `_lkIamPick`, `yap_leader_id`; `yap_iam_skip` re-offers after 24 h). The `_vgActive` grade filter covers every quad login (Simple logins on or off); the initial filter is the leader's grades within the bracket, else the whole bracket.
- **T5 Rename:** the "Intake" screen is now **Form Approve & Consent** (nav, h1, Setup text). Tabs stay Intakes / Consents; route `link-intake` and module `intakeAdmin` unchanged.
- **T6 Consents empty:** not a bug. Consent date D lists first forms submitted on D-7 that are approved, so it is often legitimately empty. The Consents tab's empty state says "No students to check for this date. Students appear here the Friday after their first form."; Intakes keeps "No families for this date."
- **T14 Consent timing (2026-10-14, pushed to master; SW `ysc-v104`):** the window closes **Friday 9:00** Brisbane (was 12:00). The console pushes the coming Friday's consent date **early** with only the students whose parent already replied (fully actionable); everyone else is added at 9:00 that Friday ("No reply: assume consent"). The app accepts a consent date up to 7 days ahead (`refresh` and the claim `hint`); intake dates stay not-after-today. Consents empty state: "Parents who reply show here straight away. Everyone else is added at 9am Friday."; the help and the late-form hold say 9 am.
- **T7 Form Approve screen** (intake-spec): two-column `_ikCompareHtml` (diffs highlighted for parent name + parent mobile only; links from `detail.links` by Student…/Parent… prefix). Hold wording `IK_HOLD`, `_ikHoldText`, `_ikNext`, `_ikHoldReason`, `_ikConseq`, `_ikIssueText` is a port of 11.1 `ix-logic.js`: **keep the two in sync**. No editable cells; "Keep as is" and Undo keep (`_ikUnkeep`) are the only phone answers. D-codes only on the Save sheet; the "Answers last changed" banner is gone; done steps under a collapsed "Already done". `_ikPerson` / `_ikWho` deleted.
- **T8 Leaders not linked:** `POST /sync/leaders` (active leader full names) feeds the console's Elvanto name search; exactly one non-archived folded-name hit joins the roster as kind `leader`. App: `rosterPersonMatcher` uses `matchFold` for leaders, as for students. Hint: "Not linked: not found in Elvanto by this exact name (or more than one match). Ask the admin to fix the name."
- **T9 Check-in past service:** the `_lkDayOk` confirm is gone; `_lkNoTonight` is hidden when the selected service is not today (`LINK.okDay` unused).
- **T10 Unsent new people:** table `newperson_unsent` (migration `0023`, RLS on). A failed, unconfirmed, 502-unreachable or `FORM_CHANGED` New person submit stores only the unsent forms, encrypted (AAD `newperson_unsent.payload:<id>`); purged lazily after 14 days; a later clean send for the same person deletes it. Admin tab **Unsent new people**: `GET /admin/unsent`, `POST /admin/unsent/:id/retry` (an unconfirmed row needs `{confirm:true}`, else 409 `UNSENT_CHECK_ELVANTO`: it may have saved, check Elvanto first), `DELETE /admin/unsent/:id`; all `admin:manage`, UNTIMED. Without `FIELD_ENCRYPTION_KEY` nothing is stored (error log `UNSENT_SAVE_FAILED`). No PII in logs.
- **T11 Hidden flow step:** Flow Steps screen only, non-admin logins only. `stepHidden(actor,row,picks)` returns false for `isAdminRole` (admin/director see and can complete it); `flowRowVisible` and the `completeStep` guard take the actor; `GET /link/flows` `steps` are filtered with the same call. '' = first step, `none` = nothing, a step id = that step. No intake screen is touched.
- **T12 Empty flow steps:** the flows push takes optional `steps` (ordered, per flow; migration `0024`, nullable jsonb `link_mirror_state.steps`). `GET /link/flows` returns them minus the hidden step for non-admins; an older console without `steps` falls back to the rows' steps. SPA renders every step "Step · 0", collapsed when empty. Contract §5.8.
- **`LINK_REV` 4 -> 5** (T8 + T12). The admin Elvanto link page shows "Console out of date" until the 11.1 console is merged and restarted.

**PRE-PROMOTE CHECKLIST (2026-10-14b).**
1. `FIELD_ENCRYPTION_KEY` set in Vercel (T10 stores nothing without it).
2. Read the Vercel build log of the pushed commit: it must apply `0022`, `0023`, `0024` and print `Database up to date`.
3. `curl -s https://<new-deployment>/health` -> `schema.current` = `0024`.
4. JSON 401 (not 500, not HTML) from the new deployment: `curl -s <dep>/admin/unsent`; `curl -s -X POST <dep>/sync/leaders`.
5. Promote in Vercel. Tell the quad leaders their new usernames (passwords unchanged).
6. Then 11.1: merge lanes E + F, `npm test`, publish.sh + diff check + push publish, restart the console (`cmd /c .\kill_server.bat`, then `start_console.bat`).

## UX batch 2026-10-14 (on master 05c3bab, pushed 2026-10-14; SW `ysc-v102`; no migration)

- **Elvanto link is an Admin tab:** `ADMIN_TABS` gains `['link','Elvanto link']`; `switchAdminTab('link')` goes to the `link-admin` page, which renders the same tab list (`_adminTabsHtml('link')`), and any other tab from there goes back to `admin`. It is no longer a More entry (an admin with every module off now gets a plain Prayers slot).
- **Lifegroup report:** the week view lists every report in the week (`_lkWeekReports`), with a warning when two share a day ("edit one: untick everyone, Guests 0"); each card shows `Sent by` (the app submit's "I am" leader, `by` added to the `/link/lifegroups` view from sent `submitReport` rows; null for a report made in Elvanto) and a collapsed native `<details class="lk-here">` for who came. The existing Edit path zeroes a duplicate; the console half (11.1 `reportRead`/`reportConfirm`) now lets an edit keep its date beside a same-day duplicate and confirms it by its own id.
- **Matching (auto-match loosened):** `autoMatch` keys on `matchFold` (X8 fold minus spaces/hyphens/apostrophes/dots; first and last kept apart, so a surname alone never matches) and `genderFits` (gender blocks only when both sides are male/female and differ; null or YS `other` is unknown). Cause: Olivia Antonucci-Cook was `female` in Elvanto and `other` in YS (51 YS students are `other`). Grade still breaks a same-name tie; held/manual/ignored rows untouched; every roster push re-runs it over `none`/`ambiguous`. Admin card: candidates are same-surname YS students whose first name starts alike (either way) or grade is within 1, minus any held by an active roster person; labels `Elvanto:` / `In YS:` / `born`, tab "Several possible", Set by hand split into Matched by hand / Marked Not in YS.
- **Flow steps:** the hidden step is never listed, completed or assigned on the Flow Steps screen for a **non-admin** login (admin/director always see and can complete it; 2026-10-14b T11). Default = step 0 (see the Step 0 rule under "UX batch (2026-10-12)"); Youth Setup → Modules picks it per flow (`modules.flowHiddenStep[flowId]`: missing/'' = first step, `none`, or a step id; `stepHidden()` in `link.service.ts`). The picker lists `steps` from `GET /link/flows` (admin only, every pushed step). Stored in `ministry_config` jsonb, so no migration. Intake is unchanged.
- **Elvanto gender wins (operator 2026-10-14):** a matched pair (auto or manual) whose `matchFold` first + last and grade agree takes Elvanto's male/female (`genderFixes` in `link-rules.ts`, written by `saveGenderFixes` with quad recomputed). Runs on every roster push and on a manual Match; never writes blank, no write when equal, never logs names.

## UX batch (2026-10-12)

**▶ Resume here** (branch `fix/ux-batch-2026-10-12`, 1813 tests pass, SW `ysc-v97`, migration `0018`, nothing pushed). Spec `docs/superpowers/specs/2026-10-12-ux-batch.md` (T1-T15). Console side (Project 11.1) is built: roster push (people the link has seen: ~10 weeks of check-ins, YS lifegroup members, flow people; Youth/YASplus demographic; grade -> student else leader), names on check-ins, flow person grade/gender/mobile, group history 8, `linkRev` handshake, and a "YS app out of date" warning on its Setup row.
**Operator rollout, in order:** push master -> read the build log for `Database up to date` counting `0018` -> owner promotes in Vercel -> `curl -s -X POST https://ys-connection.vercel.app/link/flows/assign` must be a JSON 401 -> merge + restart the console well before Friday's service (first roster build takes minutes; keep it outside the service window) -> Youth Setup: New person On; Check-in / Lifegroup report / Flow steps stay Shadow for Friday 16 Oct.

**Why:** prod `link_services` held Fri 9 Oct (255 checked in) and Sun 11 Oct (40) but `link_roster` had 0 rows (W7 never built) and the app named people only through the roster, so past check-ins showed nobody; the same empty roster hid every flow from grade/quad logins. See debug.md "Elvanto link: UX batch incidents".

**What shipped (by T-number)**
- T1 `LINK_REV = 2` both sides, `LINK_CONTRACT_VERSION` still 1, every addition optional (`linkRev`, `checkedIn[].firstName/lastName` cut to 60, `GroupRow.history` newest 8, `FlowRow` grade/gender/mobile/mobileIsParent). Admin Elvanto link page shows "Console out of date" when `consoleLinkRev < appLinkRev`.
- T2 `Grade` accepts 6..12. T3 a checked-in person with no roster row is listed from the pushed name (`noRoster: true`); door check-in stays unscoped.
- T4 flows: own grade/gender first, then the roster; mobile encrypted at rest (AAD `link_flow_people.mobile:<row_id>`; a decrypt failure reads as null and logs the row id only). T5 flow steps UI: collapsed per step, counts + overdue, A-Z, grade chip, tap row -> sheet with `sms:` link (`Hey <first name> `), warnings removed.
- T6 flow assignment (app only, never sent to Elvanto): table `link_flow_assign`, pruned by each flows push; Home card "My flow people". Leader must exist and be active in `makeLeaderService(...).list(actor)`.
- T7 check-in: big search, nothing listed until typing, collapsed "Checked in · N", "Check in leaders" at the bottom. T8 lifegroup report: history 8, week view back/forward, Edit or Submit per week, "Last report" label.
- T9 Elvanto link admin: admin only, header tooltips. T10 modules. T11 New person: "check them in" card removed, DOB free text DD/MM/YYYY (sends YYYY-MM-DD). T12 admin tab strip keeps `scrollLeft` (fixed in `setApp`). T13 grade 6 junior. T15 grade 6 accepted wherever a grade is entered.
- Post-merge `f401e4e` removed dead first-timer state; the flaky bcrypt cohort test got a 20 s timeout.

**Rules worth knowing**
- **Modules per feature:** `modules.newYouthForms` (New person), `checkin`, `lifegroupReport`, `flows`, each off | shadow | on. A stored config without the new keys inherits `newYouthForms` (prod shadow -> nothing changes on deploy). Bus "All cars" follows the Bus module only. `gate(actor, features)` in `link.service.ts`: `/link/checkin` = checkin OR lifegroupReport; `/link/lifegroups` = lifegroupReport; flows + assign = flows; each batch item is refused `MODULE_DISABLED` when its own screen is off; the claim leases nothing only when all three are off. SPA: `_linkOn(feature)`, `_linkAdminOn()`; the no-arg `_linkOn()` = any usable. `renderLink` guards per page.
- **`link:admin` is admin only**, whatever the module states (directors see only their own rows in `/link/actions`, cannot cancel others'). Admin therefore always has a More entry.
- **Step 0 = `stepOrder <= 1`** (the console numbers every Elvanto step from 1, empty ones included): since 2026-10-14b hidden from **non-admin** logins by default (admin/director never; `stepHidden(actor,row,picks)`) (per flow: Youth Setup → Modules, `modules.flowHiddenStep`) (it is the 7-day wait, moved on its own after contact consent or 6.5 days; the Form Approve & Consent screen is its one view), filtered server-side and refused (403) on complete/assign.
- **Grade 6:** junior (quads g79/b79, `computeQuad` 6..9) and the Simple-logins Grade 6 lock is gone. One entry rule, `assertGradesInRange(structure, grades)` in `ministry-config.ts` (uses `gradeRange`): grade 6 is accepted only when Include Grade 6 is on, in student/account/leader create + update, `PATCH /leaders/:id/grades` and New person (Elvanto option `807c9c80-3825-11e1-9229-ea942707ad51`). Zod floors widened 7 -> 6; the range check enforces.
  T14b: ONE junior bracket, `quadGradesOf(quad, structure)` (access-control.ts): 6-9 when `gradeMin` is 6, else 7-9; `canAccessGrade`, lifegroup-stats grades and the client `quadGrades`/`_juniorMin` all follow it. Server quad labels via `quadLabelFor(quad, false, gradeMin)` read 'Yr 6-9' when on. Service-attendance rows accept grade 6. Tests: grade6-quad.test.ts.
- **Check-out for no-roster people:** `checkOut` is accepted for a personId in that service's pushed `checkedIn` list even with no roster row; `checkIn` for them stays refused.
- **Edit of an older week's report:** `editReport` finds its base by `reportId` in [overlay last, mirror lastReport, history]; the 14-day rule is for submit only.
- **Push tolerance:** an over-long pushed name/history is cut, not a 400 for the whole push. Old console + new app and new console + old app both work (everything optional, missing `linkRev` = 1; the console sends grade 6 only when the app's rev >= 2).

**Deferred / open**
- Connection Audit CSV builder (`attendance-build.ts`) and the SPA CA loop (`gr=7..12`) still refuse grade 6 (not config-aware).
- Review NITs skipped: `FEATURES` list duplicated in `sync.service.ts` and the SPA; ~25 lines of trims.
- A group-history edit that swaps who came without changing counts shows late on the app until the console restarts.
- V2 (real-Postgres suite) does not cover `link_flow_assign`; 0018 is covered by SQL-text tests only.
- A lifegroupReport-only login gets the full door list from `/link/checkin` (spec-allowed).
- Browser checks (DOB mask, tab-strip scroll, flow sheet, week view) are the operator's.

## October rework (2026-10-12)

**▶ Resume here** (branch `feat/oct-rework`, plan `docs/superpowers/plans/2026-10-12-oct-rework.md`; 1280 tests, 81 files pass; SW `ysc-v91`; migration `0016`)

**What shipped**
- **Simple logins** (its own module switch). Labels become Junior and Senior. The grade logins are retired, and this is reversible (`gradeRoleWasOn` remembers the old state). Each leader gets a server-side grade filter, `leaders.view_grades`. While Simple is on, the quad loses `bus:coordinate`, and Grade 6 blocks it. The view-grades save sends `expect`, and a stale value gets a 409.
- **Prayers module switch.** Prayers can be turned off in Youth Setup → Modules. Turning it on needs a reload.
- **Bus "All cars" read-only view.** Suburb only, name + grade. Gated by the `newYouthForms` switch. Route `GET /bus/run/cars`.
- **Nav-slot rules.** Slots follow the module switches; a switched-off module leaves no empty slot.

**Deferred** (from `docs/superpowers/reviews/2026-10-12-rework-triage.md`)
- **Pre-existing leak:** junior-leader `GET /bus/run` still carries each car's `endsAddress` (six-hat M7). `_busMapsLinks` reads it, so it needs its own change and test.
- viewGrades writes are not chained: an out-of-order save can leave the older pick, and a `GET /leaders` landing after a save can restore the old value (reliability M3).
- Two near-simultaneous opposite flips (reliability M2): the next save repairs it; no lock.
- Before `0016` is applied the view-grades PATCH is a raw 500 (reliability M6); preview testing only.
- A quad may set any leader's filter, and there is one filter per leader across brackets (six-hat M3, edge M3). By design.
- Docs still owed in this file (six-hat M6 advisory quad restriction; M8 "kept except Full Reset and student delete"; M9 routes, migration, Grade 6 limit, 12 h tail; edge M10 Prayers-on needs a reload).
- Turning Simple off always restores Grade from `gradeRoleWasOn`, ignoring an unticked Grade box (edge M6).
- `enterPreview` / `exitPreview` don't reset the BUS session fields (edge M11; cosmetic, nothing leaks).
- All cars rows use `.li` (tappable look) and a hard-coded `Y9` chip (ui M6); Youth Setup toggle rows are 22 px (ui M9, pre-existing); "My grades" never shows an on state (ui M7).
- SPA source-regex tests that only check a string is present (false-pos-neg M7, ponytail M8).
- The flip loops are serial `save` calls (speed M7); fine at ~16 accounts.
- Prayers turned off makes every phone rebuild the shell and prefetch once (speed M4).

**Migration note:** `0016` = `leaders.view_grades` (one nullable column). The Elvanto link branch took `0017` when it merged this rework; the next migration number is `0018`.

**Operator rollout (in order)**
1. **Export prayers** first: Admin → Prayers export CSV (or Youth Setup Modules → Download CSV). Keep the file.
2. **Push / promote.** Merge `feat/oct-rework` to `master` and push. Every push runs `0016` on prod at build time, before promotion (safe: one nullable column the live code never names).
3. **Read the build log** for `Database up to date — …` (it must count `0016`), then promote in the Vercel dashboard. `/health` must show `schema.current = 0016`.
4. **curl the new routes** on the promoted URL: `curl -s -X PATCH https://ys-connection.vercel.app/leaders/x/view-grades` and `curl -s https://ys-connection.vercel.app/bus/run/cars` must each return a **JSON 401**, not HTML. Nothing changes for YS Brisbane yet (`logins.simple` false, `prayers` true; All cars only in Shadow for admin, or On).
5. **Flip Simple logins for YS Brisbane when ready** (1–2 weeks, with the check-in release, on a weekday). First fill Bus settings → coordinators and check each can pick themselves in "I am…". Then turn it on and check: no Grade section in Accounts; toast "Renamed 4 quad logins"; badge "Senior Guys" after reopening; on Senior Guys, picking Cody Cobb shows Year 10 in Health and still does on another phone; a quad login with no coordinator pick has no Assign tab; a coordinator pick does. Tell users to reopen the app; old grade logins stop within 12 h.
6. **Turn Prayers off** (Youth Setup → Modules), using the export from step 1 (or export again first).

## Bus Ministry (2026-10-05) — optional module, admin-only on prod

Drop-home car runs after the service night. Spec: `docs/superpowers/specs/2026-10-05-bus-ministry-design.md`; plans: `…-bus-ministry-r1-core.md`, `…-bus-ministry-r2-r3-google-analysis.md`.

### ▶ Resume here (state as of 2026-10-06 late, owner bug-list batch — see History)
- **Visible to every login since 2026-10-09** (owner decision; `visibility`/`regionCode` settings removed, address search always `au`). `ctxOf` rejects a `?now=` >36 h from the server clock. First real use Fri 2026-10-09.
- **2026-10-09:** `dcd4422` (settings fields removed, Students "Add several" tick-list sheet) and `b91a337` (Past page: `GET /bus/history`, logged past edits `PATCH /bus/runs/:id/riders/:riderId` + `bus_run_edits`, removed riders kept as `notRiding`, `leader_snap`, `was_guest`, 3-sheet xlsx export with full addresses; spec `docs/superpowers/specs/2026-10-09-bus-past-history.md`). Owner to promote `b91a337` **after** the 2026-10-09 run. Neither visually verified by Claude.
- **2026-10-09 pre-launch six-hat (`ad15899`, sw `ysc-v84`):** checkbox focus no longer pauses repaint; Dropped off failure reverts + 6 s toast; Maps/Reset skip dropped stops (dropped kept first; `optimiseMyCar` returns `optimised`); Edit-rider Save also saves consent; My car No address chip; Move needs 2 taps for a girl into a car with no female leader; Leaders sheet shows "on <car>". Still open (after tonight): `as=` reaches Past/xlsx full addresses (decision), lone-adult cars (decision), leader on two cars not blocked server-side, no plan-changed banner/offline My car, fixed 12 h session.
- **2026-10-10 (sw `ysc-v87`, uncommitted until the owner reviews):** Past night popup now opens with a route **map** (`GET /bus/history/:runId/map`, `bus:coordinate`; `RoutingProvider.route()` = Routes API `computeRoutes` per car through its placed, non-no-show stops in stop order, church to church/end; max 25 stops per car; image cached in a 5-entry Map keyed by run id+version+church — `editPastRider`'s `touch` bumps the version; nothing stored). **The Google key now also needs Routes API `computeRoutes`** (same "Routes API" already enabled for the matrix). Past-page sheets' Close is a floating `.bus-sheet-actions`. Re-optimise: dropped riders are fixed to their car in Generate/Fit in (`prepareFleet` treats `droppedAt` as pinned; persisted `pinned` unchanged) and Generate re-runs `reorderCar` on cars with drop-offs; `reorderCar` sequences the rest from the **last drop-off's address** (by `droppedAt`), not the church; changing a rider's address re-orders their car; Unassign all skips dropped riders; `POST /bus/riders/:id/move` returns `reordered` (false = Google down, SPA toasts). My car's small ghost button is now a full-width **Optimise route** (shown with >=2 undropped stops, "Optimising…" while waiting). Not visually verified on a phone.
- **2026-10-09 reload gap (sw `ysc-v85`):** after the Bus identity `location.reload()` the installed iOS app showed the bottom nav 62pt high until a drag. `_reloadViewportFix()` (end of `boot()`, standalone + reload only) toggles `viewport-fit=cover` to force WebKit to resend viewport geometry. Not verified on a phone — see debug.md "Mobile viewport / iOS Safari quirks".
- **Deploying:** pushing `master` builds a prod deployment but does **NOT** move `ys-connection.vercel.app` — the **owner promotes** it in the Vercel dashboard (Claude's alias/promote is blocked by the auto-mode classifier; local `vercel` CLI is logged out). Always tell the owner which commit to promote. Migrations apply in the build. After a push, read the build-log line `Database up to date — …` and tell the owner before they promote. Never apply migrations with the Supabase MCP.
- **Migrations on prod:** `0011` tables, `0012` consent/drop-off, `0013` `bus_leader_prefs.pref_grades`, `0014` bus history (applied 2026-10-09). Next is `0015`.
- **Google:** working end-to-end as of 2026-10-06 (Generate succeeds). The prod `GOOGLE_SA_PRIVATE_KEY` is stored as the bare base64 body (no BEGIN/END lines) — `normalisePrivateKey` rewraps it; don't "fix" that path away. Debug Google failures from Vercel runtime logs (scope `get_runtime_logs` to the deployment id; query `routing`).
- **Open items before/after Friday** (owner asked for these as the pre-launch review list):
  1. Dress rehearsal on prod (3–4 phones, ~15 riders with staff addresses, full flow incl. two simultaneous Generates, Move/Unpin, Fit in, My car → Maps, Dropped off, Undo, "Try +N cars").
  2. Safeguarding sign-off with the youth director: the **female-leader rule** (girls auto-placed only in a car with ≥1 female leader; leaders with no gender count as not female; hand-placed girl only warned via "No female leader" chip; Move/Undo don't enforce; Try +N cars' hypothetical cars assume a female leader), gender soft, consent warning-only, and **`as=` self-identification lets any bus:use login (except junior `leader`) view any car's addresses + phone numbers** — spec-intended, needs a conscious decision before `visibility:'all'`.
  3. `/security-review` (not yet run). Confirm API-key restrictions + a billing budget alert in Google project `ys-bus`.
  4. Owner to check on a real phone/laptop: commits `ce7eaff` (floating Save, My car stop row) and `4c4a9e1` (Past riders, laptop grid/hover) — never visually verified by Claude.
  5. Remaining known follow-ups (six-hat reviews 2026-10-06 all actioned — see History): Fix-address picker pre-checks the unpinned address; `FakeRoutingProvider` doesn't model the makespan cost (only real Google does); leftover `.git/worktrees/bus-review-wt` (OneDrive-locked, harmless — delete when convenient).
- **Working style the owner asked for:** use Sonnet subagents for implementation/review batches (brief them fully; they don't commit — Claude reviews, runs `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`, commits, pushes). Bump `public/sw.js` `CACHE` on SPA changes (now `ysc-v80`).

### Owner rules (decided 2026-10-06 — not bugs)
- Gender = strong soft preference (cost), **except** hard rule (replaced the old lone-girl rule 2026-10-06): a non-fixed **girl may only be placed in a car with ≥1 female leader** — `buildFleetProblem` sets her `allowedVehicles` to the female-eligible cars. None eligible → Unassigned, counted as `noFemaleLeader`. **Google reads an empty `allowedVehicleIndices` as "any vehicle"**, so `GoogleRoutingProvider.solve` drops stops with `allowedVehicles: []` from the request and reports them skipped — don't remove that. Hand-placed → run view `needsFemaleLeader` → "No female leader" chip only.
- Pool auto-fill skips cars that **end at an address** (driver goes home; a pool leader would be stranded).
- Address picks: any suggestion (exact address **or street**, `includedPrimaryTypes` street_address/premise/subpremise/route) is required for a new address — typed text without a pick is rejected (400 "Pick the address from the suggestions list"). A street placeId Route Optimization can't locate ("No LatLng location for placeId") is resolved once via Place Details to the street midpoint and resent as lat/lng (request-scoped, never stored); if that fails → 422 `ROUTING_BAD_ADDRESS` naming the rider/car/church. Blank label defaults to the street part ("3 Lindsay Court"); search hits carry `street` for old unlabeled rows.
- Removing a rider who is an **unlinked guest with no other run rows** deletes the guest + saved addresses. Students are never deleted from Bus.
- My car "who are you" picker = `onCarLeaders` (leaders on a running car this week, unscoped by the login's grade/quad).
- Parent consent = warning only, never blocks.
- Moving someone to **Unassigned unpins them** (Generate/Fit in place them again). Move sheet has **Unpin** (`{ unpin: true }`).
- Leaders can have **preferred grades** (Leader pool sheet); the solver unions vehicle + leaders' `prefGrades` per car (soft cost).
- **Finish sooner counts:** `globalDurationCostPerHour = COST_PER_HOUR` (1 min of makespan = 1 min of driving), so "Try +N cars" / Generate split riders when it ends the night earlier.

### Reference
- **Code:** `bus.service.ts` (all rules + RBAC via `bus:*`), pure `bus-logic.ts` / `bus-plan.ts` (`autoFillPool`, `buildFleetProblem`, `loneGirls`, `placementsFrom`), `IBusRepository` (in-memory + Supabase; encryption only in `supabase.bus.ts`), `/bus/*` routes, SPA block `/* ── BUS MODULE ── */` + `BUS MODULE CSS`. Every `/bus` call carries `?now=YYYY-MM-DDTHH:mm` (+ `&as=<leaderId>`). Module off / `visibility:'admin'` for non-admins → 404.
- **Routing:** `src/services/routing/` — `GoogleRoutingProvider` (plain `fetch`, service-account JWT via `node:crypto`; Route Optimization needs `maxDuration` alongside `quadraticSoftMaxDuration` — we send the 12 h horizon) and `FakeRoutingProvider` (straight-line, SVG map). Fake when any Google env var is missing or `PERSISTENCE=memory`; `BUS_ROUTING=google` to test a real key in memory mode. Google gets place IDs + numbers only (tested via an allow-list of request keys in `routing.google-requests.test.ts` — add new fields there).
- **Env (server only):** `GOOGLE_MAPS_API_KEY` (Places API (New), Routes API, Maps Static API), `GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY` (any paste form: PEM, `\n`-escaped, whole JSON, bare body), `GOOGLE_PROJECT_ID` (Route Optimization; SA needs Route Optimization Editor). A failed key logs its *shape* only. The Vercel MCP can't write prod env vars (403) — owner edits them in the dashboard, then redeploy + promote.
- **Generate:** one shared 30 s solve budget (`GENERATE_SOLVE_BUDGET_MS`) across the main solve and the lone-girl re-solve; lock `LOCK_MS` 55 s (Vercel `maxDuration` 60 s; SPA waits 55 s); `lock_by` = `"<name>#<token>"` per call, shown via `lockName()`. `placed` counts saved rows. Roster writes (add/update/remove rider, own car save/remove) and Move/car setup respect the lock. Undo snapshot 2 min. Pool auto-fill never adds a leader that would push out a car's fixed riders.
- **Data:** no coordinates or drive times stored — only place IDs (encrypted). Guests purged after 28 days.
- **Past riders:** run view `pastRiders` (bus:roster only, not on finished runs) — saved-address people not on tonight, newest `lastUsedAt` first, cap 50, suburb only; Tonight tab card collapsed by default (`BUS.pastOpen`); a tap opens the confirm-address sheet.
- **SPA notes:** My car identity changes re-fetch (`BUS.loadingAs` + `BUS.gen` guard stale loads); Routes car cards have a Google Maps route button (`busOpenCarRoute`, reuses `_busMapsLinks`, 9 stops per link); `.mo-box > .btn-primary.btn-full` is sticky (floating Save in long sheets, app-wide); `#toast` wraps.
- **2026-10-06 late (owner phone-test bug list):** tab order Tonight/My car/Car setup/Routes; gender toggle actually shows selection (`.btn-secondary` after `.btn-primary` in the cascade); grade chip shaded by gender (`_busGradeChip`), gender icons off Tonight; sticky Cancel+Save (`.bus-sheet-actions`); autocomplete list floats above the sticky Save; Searching…/no-match/offline states for address + roster search; API client maps fetch network errors (Safari "Load failed") to "Can't reach the server — check your internet" — the owner's "Load failed"/"error loading" reports were their own wifi, not the server; Try +N cars returns `cars[]` (per-car stops + times, `<details>` in the SPA; arrive times exclude the 60 s per-stop dwell).
- Edit-rider sheet loads saved addresses via `GET /bus/riders/:id/addresses` (current first) — not a name search (that missed riders past the 5-guest cap). Gender chip colours use the app's #ec4899/#3b82f6 tints; **the app has no dark mode — never add `prefers-color-scheme:dark` rules** (a dark-mode phone turned the chips navy).
- **Six-hat batch (2026-10-06, UI/Tonight/Car setup/Routes/Analysis reviews):** all times shown are labelled **drive time** (Google's 60 s per-stop dwell is not added — owner decision); guest→student suggestions also match by phone (`phoneMatches`: digits only, last 9 digits; student `mobile` or `parentPhone`; `byPhone` on each suggestion, phone matches first); New Person phone optional (≥8 digits if given); `setConsent` respects the lock; analysis cache is a 5-entry Map, not one slot; confirms before turning a car off/archiving it with riders and before removing a guest (may hard-delete); Car setup shows the lock banner; Tonight keeps search visible during Generate but blocks writes (`_busBlockWrite`); Generate client timeout 59 s; failed Running toggle re-syncs; Undo disabled under another's lock; Edit vehicle pre-fills tonight's ends-at override; Analysis header button active + "‹ Back to Routes"; coordinators can remove a leader's own car from Car setup (`DELETE /bus/run/own-car?as=<ownerLeaderId>`); Maps links wrapped so the sticky-Save rule can't stack them. Not bugs (checked): own cars are already excluded from both sides of Try +N cars (`prepareFleet` drops `vehicleId: null`).
- **Route analysis (2026-10-07, superseded 2026-10-15):** was `bus:coordinate` only; now every Bus login except a non-coordinating junior `leader` — see "Permission split (2026-10-15)" below. Past nights, pending guests and link/dismiss stay `bus:analysis` (director/admin).
- **Permission split (2026-10-15, operator):** every Bus login gets **Car setup** and **Assign** tabs. Car setup writes (`saveVehicle`, `updateRunVehicle`, `setPool`, `setLeaderPrefs`) are `bus:use`; removing ANOTHER leader's own car is `DELETE /bus/run/own-car?owner=<ownerLeaderId>` (with the caller's own `as=`) and needs `bus:coordinate`. Route edits on Assign (Generate/Fit in, Move/Unpin, Unassign all, Undo) stay `bus:coordinate`; non-coordinators see Assign read-only (`_busRoutesHtml` `ro`, `_busRoutesHead` hidden). Any Bus login can mark a drop-off on any car. Route analysis (`analysis`, `analysisMap`, `extraCars`) = `gateAnalysisView`: every Bus login except a junior `leader` that isn't a coordinator ("My car only": riders redacted to name + suburb, but `leaders` + `fleet` are returned so Car setup works). Past button stays director/admin (`seesPast`). The no-church hint says "Set the church address in Bus settings" only to admin (only admin has that button); others get "Ask an admin to set the church address". SW `ysc-v108`; no migration.
- **Past riders tap → confirm address sheet** (`GET /bus/addresses?studentId|guestId`, last-used first and pre-selected, or a new address) — no longer one-tap. **My car "I am" picker** lists `onCarLeaders` first then every other visible leader under "Not on a car yet" — a leader not on a car must still be able to pick themselves to add a tonight-only own car (listing only on-car leaders hid the own-car form, 2026-10-07).
- **2026-10-07 owner phone list:** tabs now **My car / Students / Car setup / Assign** (ids unchanged: `mycar`/`roster`/`cars`/`routes`; default `mycar`); the Analysis header button reads **Routes** at all widths, back link "‹ Back to Assign". Saved-address labels never hide the street (`_busAddrLabel` = label · street · suburb, de-duped). Edit-rider sheet can delete a saved address other than tonight's (`DELETE /bus/riders/:id/addresses/:addressId`, two-tap). `modal()` pins `.mo` to `visualViewport` (`_moFitViewport`, app-wide) and `.mo-box` max-height is 94% of it, so iOS keyboard no longer hides the bottom of long sheets ("Your car" address suggestions); suggestions `scrollIntoView`. Not verified on a real iPhone.
- **2026-10-07 (2) Your car search:** the own-car sheet's main path is a name search (`busOcSearch`, separate `BUS.oc*` state) → address picker / New Person → queued in `BUS.ocDraft.newRiders` (the draft lives in `BUS.ocDraft`, NOT `BUS.myCar`, which background refreshes replace); unassigned list is secondary. `POST /bus/run/own-car` takes `newRiders[]` (student/guest/newPerson + addressId/newAddress), created via shared `placeRider` (also used by `addRider`); seats/rider ids are checked before anything is created. **`search` is gated `bus:use`**; actors without `bus:roster` (the junior `leader`) only get their own connected students (via `connections`), with street/address info stripped, while `bus:roster` actors (incl. coordinators) see everyone as before. Seats input blank with `# seats` placeholder for a new car; Students list title "Students who need a lift home tonight".
- **2026-10-08 sheet spacing:** `.mo` has a top gap (safe-area + 24px) and `.mo-box` max-height 100% of it; `_moFitViewport` only resizes the overlay while the keyboard is up (>120px) and resets after — a stale size pushed the sheet off the top. While a text field is focused the sticky Save/Cancel bar goes `position:static` (`:has(...)` rule). Your car sheet has Cancel + Save.
- **2026-10-08 Edit my car / no address:** My car has **Edit my car** (fleet or own car): ↑/↓ reorder + "No lift needed" → `POST /bus/run/my-car/stops {riderIds, removeIds}` (bus:use, leader must be on that car, ids must equal the car's riders else 409; removed riders leave tonight but guests are NOT deleted, so they show in Past riders). Own car also gets "Car details" → Your car sheet. Manual order is pinned to the car but Generate/Fit in/Car-details save (`reorderCar`) can re-sequence it. Identity change → `location.reload()` (flag `yap_bus_reload` lands back on Bus). Past riders have a delete (`DELETE /bus/past-riders?studentId|guestId`, bus:roster; deletes saved addresses + unlinked guest; refused if on tonight). Deleting a rider's **current** address now allowed → rider unplaced, `addressId/snapPlaceId` null, "No address" chip; solver already skips no-place riders. `snap_address` NOT NULL: Supabase stores a one-space sentinel for empty (`encSnapAddress`) — no migration.
- **2026-10-08 (2):** My car stop list has small ↑/↓ arrows per stop that save immediately (`busMoveStop` → `/bus/run/my-car/stops`) and a **Reset to optimal order** button (`POST /bus/run/my-car/optimise` → `reorderCar`); the Edit my car sheet now only removes stops / opens Car details. My car Maps links pass `fromHere` → **no `origin`**, so Google starts from the phone and shows Start (an explicit origin opened a preview with no Start); the coordinator route preview keeps the church origin.
- **History:** 2026-10-06 commits `e1fa412` → `4c4a9e1` (key handling, unassigned/unpin, lone-girl rule, review fixes, lock ownership, leader pref grades, route preview, Past riders, layout). Six-hat, false-pos/neg, ponytail, high code review and laptop reviews were all run that day; their findings are fixed or listed under Open items.

### Run 2026-10-15: link REV 6, Consents screen, flows, notices, error log (migrations 0027 + 0028, SW `ysc-v109`) — READY, not promoted

Release branch `release/2026-10-15` (5 merges + review fixes; shipped as `deploy: ship release/2026-10-15`). Contract: `LINK_REV` 6 both sides; the app is promoted first, then the 11.1 console ship + restart (outside the service window). Operator rulings: Project 13 run folder `ux-run-2026-10-15/RULINGS.md`.

- **DO NOT CONTACT (R1).** Roster and flow rows carry `consent: ok|contact|all|unknown` (`contact` = "contact with my child" opt-out, `all` = TOTAL non-consent date; migration 0027). DNC = contact|all (`isDnc`, `src/services/dnc.ts`). A student is DNC when its matched `link_roster` row is; an INACTIVE row still counts (**sticky**: a person dropped from a roster push keeps the last known flag, never gets phones back). Every student-shaped response gets `dnc: boolean`; for any login that is not admin/director `mobile` and `parentPhone` are `null` server-side (students, search, detail, My students summary, Home follow-up, at-risk list, Bus My car stops, `/connections/export`). Admin/director keep the numbers and get the red banner. Health and My students still list DNC students (marked red). `unknown`/unmatched shows the number. The strip's roster read is cached 60 s per instance. Tests: `dnc-strip.test.ts`, `flows-dnc.spa.test.ts`.
- **Deleted `PATCH /students/:id/at-risk`** (no callers, no scope check, returned a DNC student's phones). Do not re-add; a new student-shaped route must go through `dnc.forActor`.
- **Flow steps (R4).** Admin/director only: remove from step (`removeFromFlowStep`, perm `link:flowRemove`, confirm + optional note posted to Elvanto notes; allowed on DNC rows), 4 persistent filter toggles (Junior/Senior x Guys/Girls, multi-select, all on, per device in localStorage; unknown grade/gender always shows), bulk Complete (ticks + ONE shared note, up to 50 `completeStep` items in one `/link/batch`; DNC rows cannot be ticked). DNC row: red banner, no number, no Text, Complete refused `LINK_DNC` (409). `LINK_BUSY_ROW` when a remove/complete is already open on the row. **`CONSENT_CHECK_FIRST` (409):** Complete on the New People consent step (step 0) is refused unless that person's consent row is done (or consent is `ok` with no not-done row); the UI hides Complete there and offers a Consents button.
- **Consents screen (R2; More > Form Approve & Consent > Consents, `intakeAdmin` only)** has 3 sub-menus: Last Friday (previous Friday's new people + whether the parent returned the form), All consent forms (all time, 25 a page, nothing loads until asked, search box + button, icons: consent given / contact opt-out / TOTAL non-consent / other opt-outs) and Mismatches (forms vs profile; row button "Make profile match form" = `consentFix`, FORM ALWAYS WINS). Forms and Mismatches go through the `consentLookup` outbox type (a READ for the console); the app **polls `GET /link/consents/lookup?id=` every 2-3 s** (`waiting`/`working`/`ready`/`failed`, results kept 24 h, request older than 1 h refused `too-old`). `consentFix` ships **LOCKED** on the console (`refused locked`) until the operator's first live click. Save all ready (bulk) is available for consents and app intake.
- **Console-offline banner.** Admin/director see red "Console offline since HH:MM" when the console's `lastSeenAt` (`GET /link/status`) is older than 15 min. Not shown on the intake page.
- **Error log polish.** Plain-English text + "what to do" per code (`EL_HELP` in `public/index.html`), NETWORK drops throttled to 1/min per device, the client-side duplicate 5xx report dropped, non-digit id-like path segments masked. Test: `error-log.spa.test.ts`.
- **Leader switch fix (R5).** "I am" change or login snaps the grade filter to that leader's own grades (discarding remembered `viewGrades`) after `/leaders` has loaded.
- **Notices (R6; migration 0028, `supabase.notices.ts`).** Flag `modules.notices` `off|on`, default **off** (admin turns it on in Settings). Admin/director compose + send to any subset of the 4 quad accounts (perm `notice:write`; quad logins only read their own); More > Notices (30-day history; admin/director see recipients); Home card for 24 h after send, not dismissable; sender can delete. No priority, push, schedule, edit or read receipts. `/notices` is in `vercel.json` and `sw.js` `API_RE`.
- **Notice alerts (web push; migration 0029 `notice_push_subscriptions`, id = sha256(endpoint) prefix, SW `ysc-v110`).** Only while `modules.notices` is on. More > Notices card: Turn on alerts (the ONLY place permission is asked; `Notification.requestPermission` runs synchronously in the tap) / Turn off alerts; states on / off / blocked by browser / not supported / iPhone not on Home Screen ("Add to Home Screen first") / not set up (VAPID env unset). Routes `GET /notices/push` (`{publicKey|null}`), `POST /notices/push` (subscribe), `POST /notices/push/off`; perm `notice:alerts` = admin, director, quad. Sending: after the notice insert, to active quad logins it is addressed to plus every subscribed active admin/director (`receivesNoticePush`); payload `{title:'New notice', body:<notice title, ~120 chars>, screen:'notices'}` only; 404/410 deletes the row; any other failure logs `PUSH_FAILED` (code only) and never fails the send. Click opens More > Notices (`push-nav` message, or cold start `/?nav=notices`). Env: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Tests: `notice-push.service.test.ts`, `notice-push.spa.test.ts`.
- **`src/tests/route-registration.test.ts`** fails when a router top-level segment is missing from `vercel.json` or `sw.js` `API_RE` (the 2026-07-18 `/prayers` misroute class).
- **PRE-PROMOTE CHECKLIST for 0027 + 0028, in order.** (1) Snapshot the prod DB (additive migrations, but the Supabase repos for link_roster consent and notices have never run on real Postgres). (2) Push; the Vercel build log must apply `0027` and `0028` ("2 new", then `Database up to date`). (3) `curl -s https://<new-deployment>/health` -> `schema.current` = `0028`. (4) `curl -si https://<new-deployment>/notices` -> **JSON 401**, not SPA HTML (proves routing). (5) Same for `/link/consents/lookup` and `/link/flows` (JSON 401). (6) Promote; only then ship 11.1 and restart the console. Roll back = promote the previous deployment (migrations are additive, nothing to undo). Notices stay off until the admin enables them.

### Run 2026-10-15b (migration 0030, SW `ysc-v111`)
- **Writer rule (operator 2026-10-15):** new writers ship live (VERIFIED true); there is no practice/shadow stage and no operator first-click lock. Claude still never writes to live Elvanto or the prod DB itself.
- Migration 0030 adds `link_console.progress` jsonb (console-reported progress; additive). The console posts `/sync/push/progress` and claims `progress:true`; the app shows progress bars instead of Loading text.
- App changes: nav stack with one header back arrow (history pushState/popstate), quad-login alerts prompt, intake Save answers (no Elvanto write) beside Save to Elvanto, Junior/Senior pill labels, flow select-all label and same-name chip, practice banners removed.
- consentFix limitation: opt-out checkbox changes refuse with `elvanto-shape` (no marker input on the profile; `custom_fields_empty[]` is the likely mechanism, unconfirmed).
  (Superseded: the marker is the hidden `custom_fields_empty[]=<field id>`, confirmed live 2026-10-15; opt-out changes now go through.)
- **L6 Unlinked consent forms (migration 0031, SW `ysc-v112`):** Consents > Unlinked lists returned forms with no person in Elvanto (`consentLookup` kind `unlinked`; rows carry the form name and up to 4 other names on the form, admin only via `intakeGate`). Find person (`GET /link/youth?scope=consents`, intake gate) then Link / Unlink queue outbox type `consentLink` `{subId, personId|null}` (dedupe `cn:<subId>`). The console stores the link in its own `consent-links.json` (ids only) and NEVER writes Elvanto; the form then counts for that person's DNC. 0031 only widens the `link_outbox.type` and `link_consent_lookup.kind` CHECKs. The claim reply carries `consentLink: true`; the console sends the capability key only then. With an older console the tab says the console needs an update.
- **Elvanto attach (finding, not implemented):** Elvanto's own attach is `submissions[0][person_id]` on POST `admin/forms/form_submission/?id=<sub>`.

### Fix round Fri 16 Oct 2026 (phone-test fixes, `LINK_REV` 7, SW `ysc-v113`, no migration)
Release branch `release/2026-10-16` = lanes A, B, C, D, E, F, G1, G2 (`fix16/*`) merged on 9324fe8, plus integrator commits. Backlog, rulings and lane notes: Project 13 run folder `phone-test-2026-10-16/` (`FIX-RULINGS.md`, `fix/lanes/*.md`, `fix/integrate-ys.md`). Lane tests live in `src/tests/fix16-*.test.ts`.
- **Contract C-1:** `LINK_REV` 7 (optional only): consentLookup mismatch rows may carry `linked`; the app shows "Linked on the console; fix in Elvanto." The 11.1 console ships the same rev.
- **Privacy (A):** Home pickers are scoped for grade/quad logins; `_lkIamListHtml` fails closed until `/leaders?pick=1` loads (`LINK.iamPick`). OPEN: resolveLeader / iAm scope in link.service.
- **Shell (B):** SW update reload waits for an idle screen (`_swOnUpdate`/`_swIdle`); 44 px header targets; nav second line fits 360 px; offline `/?nav=...` gets the shell (`ignoreSearch`).
- **Names:** the admin intake screen is "New youth & consent" everywhere (menu, Setup, page title, the `CONSENT_CHECK_FIRST` text). The More menu shows both "New person" (host) and "New youth & consent" (admin) on purpose.
- **Lifegroups (E):** a date that already has a report blocks Send and offers Edit (the console refuses it anyway); a new report starts on that day's default service (reverses 70641c1 "No service" default); "Students here (N)" (leaders ticked count too); week-jump button; Cancel remove / Add back on members.
  (Superseded 2026-10-17: operator ruling, every new report starts on "No service"; see "Lifegroup report default" below.)
- **Flows (F):** sent Remove/Complete shows a done line, then hides; pills "Jr/Sr Guys/Girls"; first-name greeting. F-37 note line stays inert until `listActions` returns `note`.
- **Intake (G1):** plain past-tense result lines with "Made N changes"; form-name change lines on the Save sheet (warning only); "Over 2 hours old. Tap Refresh."; refused chip shows the reason sentence, else the console detail; no per-row console last seen; 5 s pending poll that re-arms when hidden.
- **Consents (G2):** busy/offline/timeout lines name the button; Unlinked tag "(not in Elvanto)"; Last Friday pill only on the newest week.

### Nav/save fix round Fri 16 Oct 2026 (pm) (migration 0032, SW `ysc-v114`, `LINK_REV` stays 7)
Release branch `release/2026-10-16b` = `navfix/base` (C0) + lanes n6, n4, n2, n3, n5, n1 + integrator commits. Rulings, plan and lane notes: `C:\Users\ThomasPC\src\nav-fix-2026-10-16\` (`RULINGS.md`, `PLAN.md`, `lanes/*.md`, `integrate-ys.md`). Lane tests: `src/tests/navfix-*.test.ts`.
- **Late replies (D1, C0):** `_here()` before an await, then navigate / paint only if `_still(h)` (same page, intake key, nav depth); `_stillSheet(h)` before closing a sheet. Used by intake answers, Save all, notices, CA saveAudit, bus sheets. `API.post(p, b, t, quiet, keepalive)` (small JSON bodies only).
- **Intake queue `ysc.ikq.<uid>` (n2):** every intake POST is kept (`[{at, items}]`) BEFORE the keepalive fetch, removed once answered or on a 4xx; network/5xx/401 keep it. `_ikQFlush` resends kept items unchanged (same ids), oldest first, on intake load, `online`, `visibilitychange` and `_lkBoot`; over 24 h dropped with a toast. It never throws or rejects. Logout (ruling 7, `_ikQLogout`): flush for up to 5 s, then clear the key and toast how many were dropped; `LINK.ikStop` blocks any late write or send until the next login. Expired session (ruling 8): the queue is kept for that same login (24 h max) and resent on its next login; a different login signing in (`_ikQLogin` in doLogin) clears other logins' `ysc.ikq.*`.
- **Review-fix round (17 commits to 441c257, `src/tests/navfix-rv*.test.ts`):** flush re-reads the queue before each post, answer families in flight in `LINK.ikFam`, one kept item per slot (`_ikQSlot`, reuse only for the same payload via `_ikSame`), partial New person send keeps its claim, Unsent retry claim expires after 10 min; see `nav-fix-2026-10-16\fix-review.md`.
- **Request ids (D2/D4):** one id per logical save, reused on every retry. New person: `requestId` in the body + table `newperson_requests` (0032, claim/finish, fails open); a repeat answers the stored result with `repeat:true`; `ysc.nyReq.<uid>` marker shows "didn't finish on this phone". Notices `send` takes `requestId` (draft `ysc.ntDraft.<uid>`). Admin unsent retry claims `retry:<id>:<updatedAt>` (409 `UNSENT_BUSY`).
- **Supersede (S-4/S-6):** `insertAction` with `supersede` cancels the matching pending rows in the same transaction (`detail cancelled-by:<newId>`); intakeAnswer no longer sends a client `{kind:'cancel'}`; an older consentLookup of the same login + kind is cancelled. Without `supersede` the SQL is unchanged.
- **Stale pending (S-2/D6):** link reads run `sweepIfDue()` (once per 5 min per instance; same too-old predicate as the claim). Pending over 15 min reads "Console hasn't picked this up yet (since ...)".
- **`lastRefused` / `fixKey` (S-1/D7):** `GET /link/lifegroups` groups and `GET /link/flows` rows carry `lastRefused` = `{id,type,status:'refused',reason}` (key absent when none); the SPA shows the reason-only chip. `GET /link/actions` rows carry `fixKey` (admin only; consentFix personId, consentLink `cn:<subId>`) so the consent fix/link lines come back after the app was closed.
- **B18:** `GET /link/intake` marks the view only with `view=1` (the SPA adds it on page entry, not on background polls).
- Also: B09 "Students here (N)" excludes leaders; B24 add-member tap guard (400 ms after a repaint); B25/B26 back on a dirty New person / report draft asks first; B10 non-admin refusal lines say "Tell the admin."

### Consents Other (2026-10-16, branch `feat/consents-other` on `fix/menu-icon-landing`; migration 0033, SW `ysc-v116`, `LINK_REV` 8)
- Consents gets a 5th pill **Other (no date)**: students on step 0 of the New People flow with no approved, linked student form in any pushed consent week. Each row: name, then "Parent texted ~dd/mm/yyyy (console text | parent note)" (the EARLIEST confirmed console send or parent note naming the student; "parent texted" = Parent Consent step 1 Complete) or "No date found: <why>", plus a Profile link (Elvanto, https only). Empty: "Every student on step 0 has a week." **Display only**: no button writes, and the date never feeds consentSave, textProof or `CONSENT_CHECK_FIRST`.
- Contract: `consentLookup` kind `other` (`CONSENT_LOOKUP_KINDS`), push rows `ConsentOtherRow {personId,rowId,name,date|null,source|null,why,link|null}` (date and source go together; no `step due` source). Gated: the pill's page says "The console needs an update" until the console's link_rev >= 8 (an older console refuses the kind `unknown`).
- **Migration 0033** only widens `link_consent_lookup.kind` (same shape as 0031). It must be applied (the promoted build) BEFORE the rev 8 console answers an Other lookup, else the push insert fails the CHECK. Tests: `consents-other.spa.test.ts`, `link-contract.test.ts` (rev 8 + 0033), `link.rev6.test.ts`, repo suite "consent lookup".

### Access tidy-ups, session revocation, SPA headers, XSS guard (2026-10-17; branch `release/2026-10-17-access`; no migration; SW `ysc-v119`; `LINK_REV` stays 8)

From the 2026-10-16 read-only review (`C:\Users\ThomasPC\src\review-2026-10-16\S1-authz-matrix.md`, `S2-xss-taint.md`; plan `plans\PLAN-B-ys-access-session.md`). Bus `?as=` untouched (operator-accepted).
- **F1** `link.service` `resolveLeader`/`iAm` (`scopedLeader`): a grade/quad login may act only as a leader in `leaderInScope` (the `?pick=1` rule; strict, operator ruling: `grades: []` or `gender: null` leaders fail); an out-of-scope or unknown "I am" counts as no leader — a plain check-in is recorded under the login's own name, notes are refused "Pick who you are first." (operator ruling 2026-10-17). Director/admin unchanged. `identity` log items untouched.
- **F2** `GET /leaders/:id`, `PATCH /leaders/:id/grades`, `PATCH /leaders/:id/sms-template`: `assertLeaderInScope` (403). Grade/quad can no longer broaden a `grades: []` / `gender: null` leader — admin/director do that.
- **F3** `studentRecordVisible` (access-control) is the one rule for `GET /students/:id` and `GET /connections/student/:id`; other-grade same-gender students come back without phones (`phonesHidden`) on `/students?crossGrade=1`, `/batch studentsConnect`, `/students/:id`. Junior leader/director/admin unchanged.
- **F4** `GET /bus/run`: `fleet[]`/`vehicles[]` `endsAddress`/`endsPlaceId` null for the My-car-only leader except its own car. Grade/quad keep them (Car setup).
- **F5** see Security notes → Session token (re-read + `pw` fingerprint; 60 s cache; logout still stateless).
- **F6** see Security notes → SPA shell headers.
- **S2** `esc()` on the nav/More/quick-action labels (admin Terminology), `roleBadge`, Accounts username, `_qualChip`, `_ikKv` (escapes its value; its one caller no longer pre-escapes); dead `nm` removed; `spa-xss-guard.test.ts` is now a ship gate.
- **R2-G1 G1-2** `enqueueChecked`'s B8 stale loop skips newer rows of the SAME type: a check-in a few seconds behind another leader's check-in answers `duplicate` (`mine: false`, their row), not "Someone else changed this after your tap". A newer opposite row is still stale (APP-16 B).
- Minor: `POST /accounts/me/password` with no body → 400.
- Probe re-run: `review-2026-10-16\probe\matrix.md` vs `matrix.baseline.md` — remaining LEAK cells are the documented design (names via the connect exception; Bus ministry-wide; junior leader's unfiltered `GET /leaders` names; `/link/checkin?serviceTime=` roster); see the plan's expected-delta table and `review-2026-10-16\run\lane-BH.md`.

### Lifegroup report default (2026-10-17, folded into `release/2026-10-17-access`; SW `ysc-v119`; no migration; `LINK_REV` unchanged)
- **Ruling (operator 2026-10-17): every NEW lifegroup report starts with Service = "No service"** (New report, Add report, any date, and Group did not meet switched off again). Do not reintroduce a day's-service default. That was F-25, a Claude phone-test suggestion, now reversed. **Operator rulings are not flipped on test findings.** History: 70641c1 No service → a5bb1e7 day's service (F-25) → this.
- Edit report keeps the saved service (`base.serviceTimeId || 'none'`). `_lkDefaultSvcFor` and `LINK.rf.svcSet` are gone. The server's `ServiceView.isDefault` stays (contract field), but the report form does not read it.
- Wire: an untouched new report now sends `serviceTimeId: null`. The console maps that to `service: ''` (11.1 `ys-link.js:216`). No console change.

### Ship gate + CI (2026-10-17, branch `chore/ship-gate-ci`; no migration, SW `ysc-v120` (bump only; no `public/` change))
- `scripts/ship.sh` now gates BEFORE `npm test` and before DEPLOY.md is touched: `node scripts/check-spa-syntax.js`, `npm run typecheck`, and the SW rule made mechanical — if anything under `public/` other than `sw.js` differs from `origin/master`, `public/sw.js` must have a changed `const CACHE = ` line. The gates also run on `--dry-run` (use it as a preflight). The `promote:` line it writes now carries the hand-written `last promoted: <sha> (<ysc-vN>, <when>)` tail forward instead of erasing it; after promoting, update that tail by hand.
- CI: `.github/workflows/ci.yml` runs the same three gates + `npm test` on every push and on PRs to `master` (Node 20, `npm ci`, no secrets; the Supabase repo suite self-skips). Check name `ci / gate-and-test`. Not a required status check (operator ruling 2026-10-17).
- Lifegroup "Add student" mis-add (16 Oct 10:41): cause = a row sliding under the finger after a repaint. Closed by B24 (ruling 2, `release/2026-10-16b`, `ysc-v114`): `_lkYpAdd` ignores taps for 400 ms after `_lkYpDraw` repaints (`p.drawn`) and 600 ms after an add (`p.at`). No confirm sheet by ruling; no swallowed-tap toast (operator ruling 2026-10-17, T3b = no). Tests `navfix-n5.spa.test.ts` "B24". Production was `eb790f9` (`ysc-v119`) when this shipped (and `ae2c2b0`/`ysc-v118` before the run), so B24 is already live.
- P1-22 (Home grade chips 30 px at 360): closed in code by B14 `c3cb006` (`.filter-row .fc` ≥ 44 px under `@media(pointer:coarse)`); the 16 Oct harness did not emulate a coarse pointer. Real-phone check still owed.
### Door check-in result poll + door list (2026-10-17, Plan F, branch `feat/checkin-poll`; no migration; SW `ysc-v121`; `LINK_REV` stays 8)
- **Why:** 16 Oct the door phone learned a check-in was done only from the 60 s full `/link/checkin?serviceTime=` reload (avg ~30 s after the console finished; S4: 50 taps sat 1-8 min mostly on console claim latency).
- **What:** `_lkCiPoll()` (index.html, after `_lkLoadPeople`) polls the existing `GET /link/actions?ids=` for this login's own pending/claimed door rows (`_lkCiWaiting`): 5 s, 15 s once all are > 2 min old, a row dropped after 10 min, at most 200 ids a call (operator ruling: 5 s / 15 s / 10 min). Stops when none wait, off the door page, service change, hidden, or login swap; `_lkRefreshView` re-arms it on every door repaint (batch answer, list load, wake). `sent`/`unclear`/`shadowed` apply in place via `_lkApply`; `refused`/`cancelled` trigger one `_lkLoadPeople` (server decides the checked-in state). The 60 s tick is unchanged. The poll never bumps `LINK.resGen` (accepted: a full reload that started before the result can briefly put "Waiting" back until the next poll).
- **Other phones:** unchanged on purpose. `GET /link/checkin` already counts ANY login's pending/claimed row as checked in (`effectiveCheckState`), so other phones see a tap on their next 60 s reload, not after the 5-min services push.
- **Door list (R2-G1 G0, R2-G6; operator ruling 2026-10-17):** the Checked in header reads "Checked in · N" plus "Kiosk check-ins as of h:mm" (`LINK.status.mirrors.services.takenAt`; amber `c-warn` chip when over 10 min old and the selected service is today; no `takenAt` = no clause). Checked in **starts closed**: the 3 most recent rows always show, then "Show all N" / "Show fewer" (`_lkDoneToggle` repaints `#lk-list`; no button at 3 or fewer; `doneOpen: false` in `_lkFresh`). Recency is in-memory `LINK.seenAt[svc][personId]` (first list this phone sees = "earlier", by name; later check-ins stamped when first seen; a check-out forgets the stamp), `ponytail:` marked: a reload forgets it, upgrade = server first-seen stamp in `replaceMirror`. A typed name lists **every** match, checked-in ones with their status line and Check out; "Nobody here by that name." only when nothing matches; the count stays the whole service. Waking the phone (`visibilitychange`) and coming back to Check-in (`renderLinkCheckin` with a cached list) both reload the list (`_lkLoadPeople(svc, true)`, re-checking `LINK` identity and page).
- **Server:** none. `listActions` for a non-admin returns only `createdBy = actor` rows; pinned by `link.service.test.ts` "Plan F". Tests: `checkin-poll.spa.test.ts`, `link.spa.test.ts` F1.3 door (R2-G6 / R2-G1 G0 cases), `fix16-d.spa.test.ts` F-02(a) (rewritten: the tapped row stays in the matches).
- **Verified already on master (not re-done):** GAP-3 hurry filter = B03 `faa22e8`; `viewed_at` only on `view=1` = B18 `1889e1e`. Neither is in `ad0ce91`; any build since (live is v118 = 62ed842) has them.
- **Skipped (review #13, #15, #16):** claim purges (sub-ms; X19 note purge must stay per-call), `/link/lifegroups` all-time `sent` read (bounding drops "sent by" names on older history), `no-store` (no ETag path; Plan B owns headers).

### UX batch (2026-10-17, Plan I, branch release/2026-10-17-ux; migration 0034; SW ysc-vNNN; LINK_REV 8)
UI group (I1-I9b, worktree `wt-plan-i`) + Bus group (I10-I12, branch `ux17/bus`) merged. SW number is set at ship. Plan and lane notes: `C:\Users\ThomasPC\src\review-2026-10-16\plans\PLAN-I-ys-ux-batch-2026-10-17.md`, `run\lane-I-UI.md`, `run\lane-I-Bus.md`.
- **I1 chips:** chips are global on phones (coarse block: `.filter-row` gap 4px, chips ~31px wide, 44px tap height). Tests: navfix-n1 B14, spa-oct-r8 T10.
- **I2 LG sort:** LG sort is grade → girls → Mon-Sun → name, no day last. `meetsWeekday()` exported from `link-rules.ts` (full day names; "Tues" is not a day, T-49 kept). Internal sort only: no contract change, ship.sh's link-contract path warning is informational.
- **I3 leader search:** leader search is admin/director only. `#cs-lq` on Connect Setup; non-matches are hidden (`display:none`), count unchanged; focus kept across repaints. Test: `setup-leader-search.spa.test.ts`.
- **I4 Elvanto links:** `x-safari-https:` is undocumented, with fallback. Top-level `_isStandalone()` + `_extOpen(ev,url)` on the intake "In Elvanto" and Profile links (fallback `target=_blank`). Test: `ext-links.spa.test.ts`.
- **I5 Consents filter:** `_ikSubBar` is a native `<select class="fs ik-sub">`; "Older week · consent plan" option when an older week shows.
- **I6 step 0 "Consents":** `_lkStepConsents()` finds the student on Consents (current week, then at most 2 more GETs, else Other when rev >= 8). Test: `consents-find.spa.test.ts`.
- **I7 Flow tiles:** Parent text tiles are admin only, bulk cap 50. "New Students" / "Parent text" tiles show only when both flows are pushed; Parent view = first step only; "Send parent text" + can't-be-recalled line; cap 50 (`Select 50 or fewer.`) on every bulk path. Test: `flows-tiles.spa.test.ts`.
- **I8 commentary:** default deletion table shipped: rows 1-6 deleted (`_ikTextCardHtml` and its show/hide, "Text the parent" button, Save-all footer, `_ikConseq` clause, `_ikWhenMs`), row 7 "Asked separately" → "In Flow steps", rows 8-9 kept. `_ikTextOpen`/intakeText plumbing kept.
- **I9 Parent-form cells:** `_ikCompareHtml` no longer shows the display-only parent name/mobile cells; "Differs" unchanged.
- **I9b:** sent intake answers say "Noted" (not "Saved"); linked-profile holds say approve or Unlink in Elvanto, then Refresh; `_ikNext` says "Fix in Elvanto, then Refresh:" when no hold is phone-answerable.
- **I10 tidy names:** `tidyName` (bus-logic.ts) on `NewGuest` first/last name (both create paths); toast `<name> added`.
- **I11 Bus Lock (migration 0034, adds `bus_run_vehicles.locked`):** Bus Lock is per car per night, coordinator only, and does not block manual moves. Fleet cars only. `fixedCarIdsOf` (own + locked cars) used by prepareFleet, undo, unassignAll: Generate, Fit in, Try +N cars and pool auto-fill skip a locked car; Undo neither pulls from nor puts into one. PATCH with `locked` needs `bus:coordinate` (403 otherwise); car off clears the lock. Every car locked → 400 "Every car is locked...". `LATEST_MIGRATION = '0034'`.
- **I12 Car setup totals:** client-only `bus-totals` card: youth seats over running cars, car count, students tonight, `N short` chip when riders > seats.
