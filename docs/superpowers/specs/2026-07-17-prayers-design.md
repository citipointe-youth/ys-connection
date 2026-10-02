# Prayers — design spec

> **Status:** approved design (2026-07-17). Feature = per-student prayer requests + a new
> "Prayers" bottom-nav tab that lists every prayer request in the logged-in login's scope.
> Intended to be implemented with Sonnet from the plan that follows this spec.

## Summary

Each **student** can have any number of **prayer requests** recorded against them. A new
**Prayers** tab (bottom nav, between Health and My Connections) lists all prayer requests for
the students in the current login's scope, grouped by lifecycle status. Any leader in scope can
add, edit, mark answered, archive, or delete a request. Prayers can also be added from a
student's profile modal.

## Decisions (locked)

| Question | Decision |
|---|---|
| **Visibility** | **Team-shared.** A prayer is visible to any actor already scoped to its student (same grade + gender; director/admin see all). No private/confidential tier. |
| **Lifecycle** | **Open → Answered → Archived.** Answered carries an optional "praise" note. Archived tucks into a collapsible section. |
| **Permissions** | **Fully shared.** Anyone in the student's scope can add/edit/mark/delete any prayer — no per-author ownership locks. |
| **Nav placement** | New `prayers` item **immediately after `at-risk` (Health)** in every role's `navItems()`. Bottom nav grows to **5 slots** (see Frontend). `Connect Setup` is renamed **`Setup`** and `.bot-nav` font is reduced slightly so 5 fit across a phone. Nothing is bumped to quick actions. |
| **Junior `leader` role** | Granted `prayer:write` (an intentional exception to its otherwise read-only permission set — prayer is core pastoral work for junior leaders). |
| **Backup** | Prayers get a **parallel CSV export/import** on the Admin → Data tab, sitting beside the connection-allocations round-trip, and a matching step in the New Year Refresh wizard. Own file, name-matched on import, same architecture as `connection-allocations.ts`. Admin-only. |
| **Deployment** | Ship on a **feature branch** and let the user test the Vercel preview before merging. This repo auto-deploys `master` → prod, so nothing lands live until the branch is merged. (Not for now — recorded for when we build/deploy.) |

## Core design principle — scope is resolved through the student, never stored on the prayer

A `PrayerRequest` stores only `studentId`. Grade/gender are **not** copied onto the prayer row.
Every scoped read/write loads the prayer's student and runs the app's single canonical check
`canAccessStudent(actor, student.grade, student.gender, structure)` (from
`services/access-control.ts`). Consequence: a prayer can never drift out of a student's scope if
that student later changes grade/gender, and there is exactly one scoping rule to reason about.

### "Added by" is a display label, not an auth link

The app has **no server-verified Actor→leader binding** (documented for `updateSmsTemplate` /
`updateGrades` — `getMyLeaderId()` is a client-side convenience). So `createdByLabel` is a plain
string the client supplies (the self-identified leader's name, falling back to the account
display name). We store `createdByRole` alongside it for context. We do **not** invent a new
Actor↔leader FK for this feature.

## Data model

New entity `src/core/entities/prayer.ts` (export from `core/entities/index.ts`):

```ts
import type { ID, ISODateString } from '../types/common';
import type { UserRole } from '../types/enums';

export type PrayerStatus = 'open' | 'answered' | 'archived';

export interface PrayerRequest {
  id: ID;
  studentId: ID;                 // who the prayer is for; scope resolves through this
  text: string;                  // the request itself (1..1000 chars)
  status: PrayerStatus;          // default 'open'
  answerNote: string | null;     // optional "praise" note, set when marked answered
  createdByLabel: string;        // free-text author display name (see note above)
  createdByRole: UserRole;       // role of whoever created it
  createdAt: ISODateString;
  updatedAt: ISODateString;
  answeredAt: ISODateString | null;
}
```

The **list** response embeds a minimal student summary so the client never has to trust its own
cache for a name it's allowed to see:

```ts
export interface PrayerWithStudent extends PrayerRequest {
  student: { id: ID; firstName: string; lastName: string; grade: number | null; gender: string };
}
```

## Migration

`supabase/migrations/0005_prayer_requests.sql` — mirror the `leaders`/`connections` DDL
conventions (uuid pk `gen_random_uuid()`, `timestamptz default now()`):

```sql
create table if not exists prayer_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  text text not null,
  status text not null default 'open',        -- 'open' | 'answered' | 'archived'
  answer_note text,
  created_by_label text not null default '',
  created_by_role text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  answered_at timestamptz
);
create index if not exists prayer_requests_student_idx on prayer_requests(student_id);
create index if not exists prayer_requests_status_idx  on prayer_requests(status);
```

`on delete cascade` means deleting a student cleans up their prayers, consistent with
`connections`. RLS: follow whatever `0002_rls.sql` does for `leaders`/`connections` (the app
enforces scope in the service layer; the table policy mirrors its siblings).

## Backend — one vertical slice, mirroring the `leader` feature end-to-end

| Layer | File | Notes |
|---|---|---|
| Entity | `core/entities/prayer.ts` (+ `index.ts` export) | interface above |
| Repo interface | `repositories/interfaces/entity-repositories.ts` | `IPrayerRepository extends IRepository<PrayerRequest>` with `findByStudent(studentId): Promise<PrayerRequest[]>`, `deleteAll()` |
| In-memory repo | `repositories/in-memory/in-memory.repositories.ts` (+ export) | copy `InMemoryLeaderRepository`'s shape |
| Supabase repo | `repositories/supabase/supabase.prayers.ts` (+ `supabase/index.ts` export) | copy `supabase.leaders.ts`: `toPrayer(row)` mapper, `findAll`/`findById`/`findByStudent`/`save` (upsert)/`delete`/`deleteAll` |
| Service | `services/prayer.service.ts` | see below |
| RBAC | `services/access-control.ts` | add `'prayer:read'` + `'prayer:write'` to the `Action` union and to **all five** role sets (`leader` included); add `'prayer:import'` to **admin only** (the CSV round-trip gate, mirroring `connection:import`) |
| Controller | `api/controllers/prayer.controller.ts` | thin, copy `leader.controller.ts` |
| Routes | `api/http/router.ts` | see route table below |
| Wiring | `container.ts` | build `prayers` repo (supabase/in-memory/json branches) + `makePrayerService(prayers, students, settings)`; add to `Repositories`/`Services`; add `dedupeReads(prayers, 'prayers', ['findAll'])` in the `useSupabase` block; add `prayers.init()` to the `Promise.all` |
| CSV round-trip | pure `services/prayer-allocations.ts` | `exportPrayersCsv(prayers, students)` → rows; `parsePrayersCsv` + `importPrayersCsv(rows, students, existing)` name-matched merge. Mirror `connection-allocations.ts` exactly (name-match, column-agnostic, returns an unmatched/ambiguous report). Admin-only. |
| CSV service methods | `prayer.service.ts` | `exportCsv(actor)` and `importCsv(actor, rows)` — gate on the new `prayer:import` action (admin only) |

### `PrayerService` (`services/prayer.service.ts`)

Constructed with the prayer repo + the **student repo** (to resolve scope) + the **settings repo**
(to read `ministryConfig.structure` for the `StructureScope` passed to `canAccessStudent`, same
as other services).

```ts
interface PrayerService {
  list(actor): Promise<PrayerWithStudent[]>;          // all in-scope prayers, newest first
  listByStudent(actor, studentId): Promise<PrayerRequest[]>;
  create(actor, input): Promise<PrayerRequest>;       // { studentId, text, createdByLabel? }
  update(actor, id, input): Promise<PrayerRequest>;   // { text?, answerNote? }
  setStatus(actor, id, input): Promise<PrayerRequest>;// { status, answerNote? }
  remove(actor, id): Promise<void>;
  exportCsv(actor): Promise<PrayerCsvRow[]>;          // admin only (prayer:import)
  importCsv(actor, rows): Promise<PrayerImportReport>;// admin only (prayer:import)
}
```

Rules for every method:
- `assertCan(actor, 'prayer:read' | 'prayer:write')` first.
- **Scope gate:** load the target student (`create`: from `input.studentId`; others: from the
  prayer's `studentId`). Throw `NotFoundError` if the student is gone. Throw `ForbiddenError`
  unless `canAccessStudent(actor, student.grade, student.gender, structure)`.
- `list`: fetch all prayers + all students once, build an `id→student` map, keep only prayers
  whose student passes `canAccessStudent`, embed the student summary, sort by `createdAt` desc.
- Zod-validate all input inside the service (`text` 1..1000, `status` enum, `answerNote` ≤1000
  nullable). `setStatus` to `answered` stamps `answeredAt = now`; moving off `answered` clears it.
- `create` defaults `status:'open'`, `createdByRole: actor.role`, timestamps now.

### Routes (`router.ts`)

Register the static `/prayers/export` and `/prayers/import` **before** `/prayers/:id`, same as
the documented `/audits/*` ordering rule (Express matches in registration order).

```
GET    /prayers                 -> prayer.list          (auth)
POST   /prayers                 -> prayer.create        (auth)
GET    /prayers/export          -> prayer.exportCsv     (auth, admin)   # before :id
POST   /prayers/import          -> prayer.importCsv     (auth, admin)   # before :id
GET    /prayers/student/:id     -> prayer.listByStudent (auth)
PATCH  /prayers/:id             -> prayer.update        (auth)
PATCH  /prayers/:id/status      -> prayer.setStatus     (auth)
DELETE /prayers/:id             -> prayer.remove        (auth)
```

## Frontend (`public/index.html`)

1. **Icon** — add a `pray` key to the `IC` path registry (praying-hands glyph). All icons are
   inline SVG; no emoji.
2. **Nav (`navItems()`)** — insert `{ id:'prayers', ic:'pray', label:'Prayers', mbl:'Prayers' }`
   immediately after the `at-risk` (Health) item in **every** role branch (grade, quad, admin,
   director, leader).
3. **5-slot bottom nav** — change `bottomNavItems()` from `slice(0,4)` to `slice(0,5)` and
   `quickActionItems()` to `slice(4)`→`slice(5)`. Rename the `leaders` nav label
   `Connect Setup` → **`Setup`** (single-line `mbl`, dropping the two-line `.ni-lbl` markup).
   Reduce `.bot-nav a` font-size a step (≈11px→10px, and shrink the `.ni-lbl` sub-line
   accordingly) so five items fit across a narrow phone without wrapping. Verify at 360px width.
   - Result per role bottom nav: **grade** = Home · Health · Prayers · My Connections · Setup;
     **quad/admin/director** = Home · Health · Prayers · Trends · Setup; **leader** = Home ·
     My Connections · Health · Prayers · Birthdays (leader keeps its own 5, no quick actions).
4. **`renderPrayers()`** — follow the established stale-while-revalidate pattern used by
   `renderAtRisk`/`renderHome`: `PRAYER_PATHS = ['/prayers']`; `allFresh` renders from cache,
   `haveStale` paints from `Cache.getStale(...)` then `_revalidatePrayers()` re-renders if
   `S.page` unchanged. Layout: **Open** and **Answered** as `.sh` sections; **Archived** as a
   collapsible `.drop` (copy the Health/Home `_drop('id')` pattern). Register `prayers` in the
   `render()` dispatch table and add `'/prayers'` to `_prefetch()`.
   - **Rows are compact and dense — a single tight list, not gapped cards** (see mockup 1). Each
     row is ~46px: one primary line `<b>Name</b> — request text` truncated with ellipsis
     (`white-space:nowrap;overflow:hidden;text-overflow:ellipsis`), a small muted second line
     `Yr · <addedBy> · <relative time>`, a status dot on the left (accent = open, green =
     answered), and a compact right-side control (a 26px `✓` tick button for open rows; a tiny
     `✓ Ans` badge for answered). Rows share one bordered container with `1px` dividers, not
     individual card shadows — the goal is fitting a whole cohort on one screen. Tapping a row
     opens the edit/detail modal (full text + Edit · Archive · Delete via `modal()`); the tick is
     the one-tap "mark answered". A `+ Add Prayer` FAB (bottom-right) opens the add modal.
5. **Add/edit modal** — `openPrayerModal(studentId?)` using the shared `modal()`: a student picker
   (reuse the existing student-search/picker component; pre-selected + locked when `studentId`
   passed) + a request `textarea`. `submitPrayer()` POSTs/PATCHes, then invalidates the client
   `Cache` (same as every other write) and re-renders.
6. **Student profile entry point** — add a `+ Prayer` button to `showStudentDetail(...)` that calls
   `openPrayerModal(student.id)`, so a prayer can be logged straight from a student's profile.
7. **Admin → Data tab: Prayers export/import** — add a second export/import pair directly beside
   the existing connection-allocations one (grep the allocations Data-tab card, `exportAllocationsCSV`
   / `processAllocationImport`). Export downloads `prayers.csv`
   (`First Name, Last Name, Grade, Gender, Prayer, Status, Answer Note, Added By, Date`) via the
   same `_downloadText` / xlsx helpers; import reads the file (`parseAllocationCSV`-style,
   all-columns-preserved), POSTs rows to `/prayers/import`, and shows the unmatched/ambiguous
   report the service returns. Admin-only, so it only appears where the allocations round-trip
   already does.
8. **New Year Refresh wizard** — add a Prayers export step alongside the existing "Export
   Allocations" step (a Full Reset cascade-deletes prayers along with students, so they must be
   exported before the reset and re-imported after, exactly like allocations). One extra
   `_wizStepCard` in `renderNewYearWizard()`; keep the strict in-order gating.
9. **Service worker (`public/sw.js`)** — add `prayers` to `API_RE` and **bump the cache name to
   `cms-v33`**. This is the repo's documented gotcha: a missing `API_RE` entry falls through to the
   cache-first asset path and serves the SPA HTML as JSON (bit the repo with `lifegroups` and
   `audits`). Non-negotiable.

## Tests (`src/tests/prayer.service.test.ts`)

Mirror `leader.service.test.ts` with in-memory repos:
- A grade login sees only prayers for its own grade **and** gender; a same-gender other-grade or
  same-grade other-gender prayer is excluded from `list` and 403s on read/write by id.
- quad login scoped to its bracket + gender; director/admin see all.
- `create` rejects a student outside scope (`ForbiddenError`), missing student (`NotFoundError`).
- `setStatus` open→answered stamps `answeredAt`; answered→open clears it; archived round-trips.
- `update` edits text/answerNote; `remove` deletes; Zod rejects empty/over-long text.
- Junior `leader` role: can read and write (create/edit/status/delete) within its own connected
  scope — confirms the deliberate `prayer:write` grant.
- **CSV round-trip** (`prayer-allocations.test.ts`, mirroring the allocations test): export
  produces one row per prayer with the student's name/grade/gender; import name-matches by
  student, reports unmatched/ambiguous names, and round-trips (export → import → same data).

Primary verification gate (per debug.md): `npm run typecheck` + `npm run test` clean. Browser
verification optional/confirmatory only.

## Deployment (when we build it — not now)

- Do the work on a **feature branch** (e.g. `feat/prayers`), not `master`. This repo auto-deploys
  `master` → production, so a branch keeps it out of prod until it's ready.
- Push the branch and hand the user its **Vercel preview URL** to test end-to-end before rollout.
- Only **merge to `master`** (which is the prod deploy) once the user has signed off on the preview.
- Ship the migration (`0005_prayer_requests.sql`) with the branch; it's additive (new table only),
  so it's safe to apply ahead of the merge.

## Out of scope (YAGNI)

No confidential/private tier, no per-author edit locks, no notifications/reminders, no prayer
categories/tags, no home-screen prayer widget, no answered-prayer analytics. (Admin CSV
export/import **is** in scope — see Backup.) Each could be a later increment; none is needed for v1.
