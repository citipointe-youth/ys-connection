# Design: Connection Made Simple — Deploy & Rebrand

**Date:** 2026-06-12
**Status:** Approved

## Overview

Deploy the `youth-allocation-platform` (TypeScript/Express + SPA) as a production app named **Connection Made Simple**. This involves:

1. Renaming all `allocate/allocation` terminology to `connect/connection` across the entire codebase (backend TS + API routes + SPA frontend)
2. Adding a Supabase repository layer (Sydney, ap-southeast-2) while keeping in-memory repos for local dev
3. Wrapping the Express app for Vercel serverless deployment
4. Moving the app to a new `Project 7 - Connection Made Simple` folder
5. Setting up a new GitHub repo, Supabase project, and Vercel project
6. Bootstrapping the initial admin user for production
7. Five targeted SPA UI fixes (at-risk ordering/layout, CA ladder text, search focus, home columns)

## Section 1: Naming & Infrastructure

| Artifact | Name |
|----------|------|
| GitHub repo | `987tom1/connection-made-simple` (new public repo) |
| Supabase project | `connection-made-simple` (region: ap-southeast-2 — Sydney) |
| Vercel project | `connection-made-simple` |
| Vercel URL | `connection-made-simple.vercel.app` |
| `package.json` name | `connection-made-simple` |

The current remote (`youth-allocation-app.git`) is replaced. The new repo starts fresh from the renamed/migrated codebase.

## Section 2: Terminology Rename

### File renames (4 files)

| Old | New |
|-----|-----|
| `src/core/entities/allocation.ts` | `src/core/entities/connection.ts` |
| `src/api/controllers/allocation.controller.ts` | `src/api/controllers/connection.controller.ts` |
| `src/services/allocation.service.ts` | `src/services/connection.service.ts` |
| `src/tests/allocation.service.test.ts` | `src/tests/connection.service.test.ts` |

### In-place identifier renames (backend)

| Old | New |
|-----|-----|
| `Allocation` (interface) | `Connection` |
| `IAllocationRepository` | `IConnectionRepository` |
| `AllocationService` / `makeAllocationService` | `ConnectionService` / `makeConnectionService` |
| `makeAllocationController` | `makeConnectionController` |
| `services.allocation` | `services.connection` |
| `repos.allocations` | `repos.connections` |
| `InMemoryAllocationRepository` | `InMemoryConnectionRepository` |
| `allocationLockDate` (settings field) | `connectionLockDate` |
| API routes `/allocations*` | `/connections*` |

### SPA (`public/index.html`)

All `allocat*` / `Allocat*` occurrences in function names, variable names, CSS classes, UI labels, and `fetch` paths are renamed to `connect*` / `Connect*`. Examples:
- `POST /allocations` → `POST /connections`
- "Allocate" button → "Connect"
- "Allocated" → "Connected"
- "De-allocate" → "Disconnect"

**CA module rename safety:** The Connection Audit module already uses "connection/connect" terminology throughout (e.g. `CA`, `ca-overview`, integration ladder labels). The rename pass must target `allocat*` occurrences only — existing `connect*` identifiers inside the `/* ── CA MODULE … ── */` block must not be touched.

## Section 3: Supabase Schema

One migration file: `supabase/migrations/001_initial_schema.sql`

13 tables mapped from existing entities:

```sql
create table users (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  email text unique not null,
  role text not null,
  grade int,
  quad text,
  status text not null default 'active',
  password_hash text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table students (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  gender text not null,
  grade int,
  quad text,
  mobile text,
  parent_phone text,
  date_of_birth date,
  svc_attended int not null default 0,
  svc_total int not null default 0,
  grp_attended int not null default 0,
  grp_total int not null default 0,
  grp_met_weeks int not null default 0,
  prev_svc_attended int not null default 0,
  prev_svc_total int not null default 0,
  prev_grp_attended int not null default 0,
  prev_grp_total int not null default 0,
  at_risk_status text,
  data_source text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table leaders (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  gender text,
  grades int[] not null default '{}',
  active boolean not null default true,
  created_by_grade int,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table connections (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  leader_id uuid not null references leaders(id) on delete cascade,
  assigned_by_role text not null,
  created_at timestamptz default now(),
  unique(student_id, leader_id)
);

create table service_sessions (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references import_records(id) on delete cascade,
  session_date date not null,
  session_name text not null,
  is_regular boolean not null default true,
  is_valid boolean not null default true,
  total_attendance int not null default 0,
  sort_order int not null default 0,
  created_at timestamptz default now()
);

create table service_attendance (
  student_id uuid not null references students(id) on delete cascade,
  session_id uuid not null references service_sessions(id) on delete cascade,
  attended boolean not null,
  primary key (student_id, session_id)
);

create table lifegroups (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  short_name text not null,
  grade int,
  gender text,
  created_at timestamptz default now()
);

create table lifegroup_weeks (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references import_records(id) on delete cascade,
  week_num int not null,
  week_key text not null,
  week_start date not null,
  week_end date
);

create table lifegroup_attendance (
  student_id uuid not null references students(id) on delete cascade,
  week_id uuid not null references lifegroup_weeks(id) on delete cascade,
  lifegroup_id uuid not null references lifegroups(id) on delete cascade,
  group_met boolean not null,
  attended boolean not null,
  primary key (student_id, week_id)
);

create table import_records (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  filename text not null,
  file_hash text not null,
  row_count int not null default 0,
  sessions_added int not null default 0,
  students_added int not null default 0,
  students_updated int not null default 0,
  status text not null default 'ok',
  error_message text,
  imported_at timestamptz default now(),
  imported_by text not null
);

create table app_settings (
  id uuid primary key default gen_random_uuid(),
  ministry_name text not null default 'Youth Ministry',
  term_gap_days int not null default 14,
  reg_rate_numerator int not null default 1,
  reg_rate_denominator int not null default 2,
  risk_rate_numerator int not null default 1,
  risk_rate_denominator int not null default 3,
  valid_threshold_pct int not null default 10,
  service_name text not null default 'Service',
  lifegroup_name text not null default 'Lifegroup',
  connection_lock_date date,
  updated_at timestamptz default now()
);

create table app_defaults (
  id uuid primary key default gen_random_uuid(),
  snapshot jsonb not null,
  created_at timestamptz default now()
);

create table admin_audit (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  performed_by text not null,
  performed_at timestamptz default now(),
  detail text not null
);
```

## Section 4: Supabase Repository Layer

### New folder: `src/repositories/supabase/`

Uses the `postgres` npm package (direct Postgres connection string from Supabase).
- Transaction pooler URL (port 6543) for Vercel serverless
- Direct URL (port 5432) for local Supabase testing

**Files:**
```
src/repositories/supabase/
  client.ts                — creates shared sql client from DATABASE_URL
  supabase.users.ts        — implements IUserRepository
  supabase.students.ts     — implements IStudentRepository
  supabase.leaders.ts      — implements ILeaderRepository
  supabase.connections.ts  — implements IConnectionRepository
  supabase.attendance.ts   — implements IServiceSessionRepository, IServiceAttendanceRepository,
                             ILifegroupRepository, ILifegroupWeekRepository,
                             ILifegroupAttendanceRepository, IImportRepository
  supabase.settings.ts     — implements ISettingsRepository, ISnapshotRepository, IAuditRepository
  index.ts                 — exports all implementations
```

**Mapping convention:** snake_case Postgres columns ↔ camelCase TypeScript entity fields, via a `toEntity()` helper per table.

### `container.ts` change

Adds a `supabase` branch alongside `memory` and `json`:

```ts
const useSupabase = env.PERSISTENCE === 'supabase';
const useJson     = env.PERSISTENCE === 'json';

const connections: IConnectionRepository = useSupabase
  ? new SupabaseConnectionRepository(sql)
  : new InMemoryConnectionRepository(useJson ? makeJson('connections.json') : undefined);
// same pattern for all 13 repos
```

The `sql` client is created once at container build time and passed to all Supabase repos.

## Section 5: Vercel Deployment

### App factory split

`src/index.ts` is split:
- `src/app.ts` — async factory `createAppInstance()`: builds container, seeds (memory only), wires routes, returns Express app. No `listen()`.
- `src/index.ts` — local dev entry: imports `createAppInstance()`, calls `app.listen(PORT)`.

### New file: `api/index.ts`

```ts
import { createAppInstance } from '../src/app';

const appPromise = createAppInstance();

export default async function handler(req, res) {
  const app = await appPromise;
  app(req, res);
}
```

`appPromise` is module-level — created once per cold start, not per request.

### New file: `vercel.json`

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/api/index" }]
}
```

All traffic routes through Express, which serves `public/` as static via `express.static`.

### New file: `.vercelignore`

```
data/
node_modules/
src/tests/
*.test.ts
```

### New dev dependency

`@vercel/node` — Vercel build runtime for TypeScript serverless functions.

## Section 6: Environment Variables

**Local dev (`.env`) — in-memory, no Supabase needed:**
```
PORT=4300
PERSISTENCE=memory
NODE_ENV=development
```

**Local dev with Supabase:**
```
PORT=4300
PERSISTENCE=supabase
DATABASE_URL=postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres
NODE_ENV=development
```

**Vercel (set via `vercel env add`):**
```
PERSISTENCE=supabase
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres
NODE_ENV=production
```

**`src/config/env.ts` additions:**
```ts
PERSISTENCE: z.enum(['memory', 'json', 'supabase']).default('memory'),
DATABASE_URL: z.string().optional(),
```

## Section 7: Project Structure

### New folder layout

```
C:\Users\thoma\Claude Programs\Project 7 - Connection Made Simple\
  connection-made-simple\
    src/
    public/
    api/                         ← new (Vercel entry)
    supabase/
      migrations/
        001_initial_schema.sql
    vercel.json                  ← new
    .vercelignore                ← new
    .env.example
    CLAUDE.md                    ← new (Project 7 scoped)
    package.json
    tsconfig.json
    vitest.config.ts
```

### Folder moves

- `Project 4 - Youth Apps/youth-allocation-platform/` → archived to `Project 4 - Youth Apps/~archive/youth-allocation-platform/`
- Top-level `CLAUDE.md` updated: new Project 7 row added; Project 4 row notes that `youth-allocation-platform/` is archived and the live app is in Project 7
- `Project 4 - Youth Apps/CLAUDE.md` updated to note the archive and point to Project 7

## Section 8: Admin Bootstrap

The seed data (demo accounts, sample students/leaders) only runs when `PERSISTENCE=memory`. On a fresh Supabase deployment the database is empty — there are no user accounts, so login is impossible.

### Solution: seed SQL script

A second migration file `supabase/migrations/002_seed_admin.sql` inserts one admin account with a known password hash:

```sql
-- Seeds the initial admin account (password: change-me-on-first-login)
-- Replace the password_hash before running in production.
insert into users (display_name, email, role, status, password_hash)
values (
  'Admin',
  'admin@youth.ministry',
  'admin',
  'active',
  '$2b$12$PLACEHOLDER_REPLACE_BEFORE_USE'
);
```

**Workflow:**
1. Generate a bcrypt hash locally: `node -e "import('./src/utils/crypto.ts').then(m => m.hashPassword('your-password').then(console.log))"`
2. Replace `PLACEHOLDER_REPLACE_BEFORE_USE` in the script with the real hash
3. Run `002_seed_admin.sql` against the Supabase project after `001_initial_schema.sql`
4. Log in as admin, add remaining accounts via the Accounts UI

The seed script is committed to the repo with the placeholder hash — it must be edited before running. A comment in the file makes this explicit.

## Section 9: SPA UI Fixes

Five targeted changes to `public/index.html`, applied in the same pass as the terminology rename.

### 9a — At-risk: category order + collapse-by-default

Current order: at-risk → declining → stopped. New order: **declining → at-risk → stopped**.

Each category section starts collapsed. A chevron toggle expands/collapses it. The count badge is always visible in the header row so users can see at a glance how many are in each group without expanding.

### 9b — At-risk: multi-column tiles on wider screens

Currently each person is a full-width row. On screens ≥ 640px wide the person cards reflow into a 2-column grid; on screens ≥ 1024px wide, 3 columns. Implementation: CSS grid on the cards container, `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`.

### 9c — CA integration ladder: "attended a lifegroup this term"

The fourth rung of the integration ladder currently reads "In a lifegroup". Change label to **"Attended a lifegroup this term"**. This is a single string change inside the CA module's ladder definition. The ladder calculation logic (`grpAttended > 0` or equivalent threshold) is not changed — only the display label.

### 9d — Student search: focus lost after first keystroke

When the user types the first character in the search input, the input loses focus (likely because the results re-render replaces the DOM node the input is inside, or an event handler calls `blur()`). Fix: ensure the search input retains focus after each render cycle. Likely fix is moving the input outside the re-rendered container, or calling `input.focus()` at the end of the render function that handles search results.

### 9e — Home page: attendance-by-grade columns too wide on quad/director login

When the attendance-by-grade accordion is expanded on home, the grade breakdown table columns stretch too wide. Fix: constrain the table with `max-width` and/or set explicit `width` on each column via `<colgroup>` so the grade, attended, total, and rate columns have sensible fixed widths rather than expanding to fill the container.

## Implementation Order

1. Copy `youth-allocation-platform/` to `Project 7 - Connection Made Simple/connection-made-simple/`
2. Apply terminology rename across all backend TS files and file names (strict `allocat*` → `connect*` only; leave CA module `connect*` untouched)
3. Apply terminology rename across `public/index.html` (same rule — `allocat*` occurrences only)
4. Apply SPA UI fixes (Sections 9a–9e) in the same editing pass as step 3
5. Add Supabase schema (`supabase/migrations/001_initial_schema.sql` with FK-corrected `service_sessions` and `lifegroup_weeks`)
6. Add `supabase/migrations/002_seed_admin.sql` with placeholder hash and clear instructions
7. Add `postgres` dependency; implement Supabase repository layer (`src/repositories/supabase/`)
8. Update `container.ts` for Supabase branch
9. Split `src/index.ts` → `src/app.ts` + `src/index.ts`; add `api/index.ts` and `vercel.json`
10. Update `src/config/env.ts` for new `PERSISTENCE=supabase` and `DATABASE_URL`
11. Run `npm run typecheck` and `npm run test` — all passing
12. Create GitHub repo `connection-made-simple`, push
13. Create Supabase project (Sydney), generate real bcrypt hash, run both migrations
14. Create Vercel project, link repo, set env vars (`PERSISTENCE`, `DATABASE_URL`), deploy
15. Verify live: log in as admin, create a test student + leader, make a connection
16. Archive `youth-allocation-platform/` in Project 4; update top-level and Project 4 CLAUDE.md files
