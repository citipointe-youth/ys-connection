# Bus Ministry — Release 1 (Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the no-Google core of Bus Ministry: module toggle + visibility, roster with saved addresses, walk-ins (import linking, 28-day purge), Car setup (fleet, running tonight, fixed leaders, pool availability, Ends at), manual placement (Move), My car (incl. leaders' own cars), run history, version-poll sync.

**Architecture:** One new table family (`bus_*`, migration `0011`), one repository interface `IBusRepository` (in-memory + Supabase, encryption only in the Supabase mapper), pure helpers in `bus-logic.ts`, all rules + RBAC in `bus.service.ts`, a thin controller, `/bus/*` routes. SPA: a new delimited `/* ── BUS MODULE ── */` block in `public/index.html`.

**Tech Stack:** TypeScript (strict), Express route table, Zod, postgres.js, vitest, vanilla SPA.

**Spec:** `docs/superpowers/specs/2026-10-05-bus-ministry-design.md` (read §2 Build rules, §4–§8). Mockup: `_design/bus-ministry-mockup.html` (grep `data-section="<screen>"`).

## Global Constraints

- Ponytail: simplest working code, reuse existing helpers, **no new npm dependencies**.
- Branch `bus-ministry`; never push; commit per task with the session's Co-Authored-By trailer.
- `npm run typecheck && npm run test` green after every task; after any `public/index.html` edit also `node scripts/check-spa-syntax.js`.
- jsonb writes via `this.sql.json(...)`, never `JSON.stringify(x)::jsonb`.
- No foreign key from history tables (`bus_run_riders`, `bus_run_vehicles`, `bus_guests.linked_student_id`) to `students`/`leaders` — Full Reset runs `truncate … cascade`, which would empty them.
- Module defaults OFF (`modules.busMinistry=false`), `busMinistry.visibility='admin'`. No YS-specific defaults.
- Icons: SVG line icons in `IC` only; no emoji/unicode symbols. Colour = attention (warn = needs action; grey reserved for unassigned).
- Copy: short labels; strings containing an apostrophe use double quotes in inline JS.
- Any new top-level API path → `router.ts` + `vercel.json` routes regex + `sw.js` `API_RE` (+ SW cache bump).

## Review Focus

1. **Run date across midnight** — a driver opening My car at 00:40 Saturday must still see Friday's run. Pinned in Task 3 (`currentRunDate` test).
2. **Same student added twice** (two leaders at 7pm) — must update the existing rider, not duplicate. Pinned in Task 3.
3. **Moving into a full car** — server rejects with a readable message; the sheet greys full cars. Pinned in Task 4.
4. **Full Reset / student delete** — past runs still render from snapshots; a rider whose student vanished shows no phone instead of crashing. Pinned in Task 4 (`myCar` with missing student).
5. **Non-admin while visibility='admin' or module off** — every `/bus` call 404s (`MODULE_DISABLED`), the Home tile is absent. Pinned in Task 3.

---

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/0011_bus_ministry.sql` | tables, indexes, RLS |
| `src/core/entities/bus.ts` | entity + view types |
| `src/core/ministry-config.ts` | `modules.busMinistry`, `labels.busMinistry`, `busMinistry` block |
| `src/services/access-control.ts` | `bus:*` actions |
| `src/services/bus-logic.ts` | pure helpers (dates, eligibility, capacity, names, suburb) |
| `src/repositories/interfaces/entity-repositories.ts` | `IBusRepository` |
| `src/repositories/in-memory/in-memory.bus.ts` | in-memory impl |
| `src/repositories/supabase/supabase.bus.ts` | SQL impl + encryption |
| `src/services/bus.service.ts` | all bus rules |
| `src/api/controllers/bus.controller.ts` | thin controller |
| `src/api/http/router.ts`, `vercel.json`, `public/sw.js` | wiring |
| `src/container.ts` | construct repo + service |
| `src/services/import.service.ts` | call `linkGuestsAfterImport` hook |
| `public/index.html` | BUS MODULE block, Home tile, Youth Setup toggle/label, Bus settings |
| tests | `bus-logic.test.ts`, `bus.repo.test.ts`, `supabase.bus.mapper.test.ts`, `bus.service.test.ts`, `bus.routes.test.ts`, `spa-bus.test.ts` |

---

### Task 1: Config, RBAC, entities, migration

**Files:**
- Modify: `src/core/ministry-config.ts`
- Modify: `src/services/access-control.ts`
- Create: `src/core/entities/bus.ts`
- Create: `supabase/migrations/0011_bus_ministry.sql`
- Test: `src/tests/bus-logic.test.ts` (config + RBAC part), existing `ministry-config.test.ts` must still pass

**Interfaces:**
- Produces: `MinistryConfig['busMinistry']`, `MinistryConfig['modules']['busMinistry']`, `labels.busMinistry`; actions `'bus:use' | 'bus:roster' | 'bus:coordinate' | 'bus:analysis'`; all types in `bus.ts` (below, used by every later task).

- [ ] **Step 1: Write failing tests** — `src/tests/bus-logic.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { MINISTRY_CONFIG_DEFAULTS, mergeMinistryConfig } from '../core/ministry-config';
import { can } from '../services/access-control';
import type { Actor } from '../core/entities/user';

const A = (role: string): Actor => ({ id: 'x', role: role as any, displayName: 'X', grade: null as any, quad: null as any });

describe('bus config defaults', () => {
  it('module off, admin-only, no ministry-specific values', () => {
    expect(MINISTRY_CONFIG_DEFAULTS.modules.busMinistry).toBe(false);
    expect(MINISTRY_CONFIG_DEFAULTS.labels.busMinistry).toBe('Bus Ministry');
    expect(MINISTRY_CONFIG_DEFAULTS.busMinistry).toEqual({
      visibility: 'admin', churchAddress: '', churchPlaceId: '', leaveTime: '21:00',
      targetRouteMin: 45, prefWeightMin: 10, genderWeightMin: 120,
      detourMin: 10, detourPct: 20, coordinatorLeaderIds: [],
    });
  });
  it('merges a partial busMinistry patch', () => {
    const m = mergeMinistryConfig(MINISTRY_CONFIG_DEFAULTS, { busMinistry: { visibility: 'all' } });
    expect(m.busMinistry.visibility).toBe('all');
    expect(m.busMinistry.targetRouteMin).toBe(45);
  });
});

describe('bus RBAC', () => {
  it('matches the spec matrix', () => {
    expect(['leader', 'grade', 'quad', 'director', 'admin'].map((r) => can(A(r), 'bus:use'))).toEqual([true, true, true, true, true]);
    expect(['leader', 'grade', 'quad', 'director', 'admin'].map((r) => can(A(r), 'bus:roster'))).toEqual([false, true, true, true, true]);
    expect(['leader', 'grade', 'quad', 'director', 'admin'].map((r) => can(A(r), 'bus:coordinate'))).toEqual([false, false, true, true, true]);
    expect(['leader', 'grade', 'quad', 'director', 'admin'].map((r) => can(A(r), 'bus:analysis'))).toEqual([false, false, false, true, true]);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/tests/bus-logic.test.ts` — Expected: FAIL (`busMinistry` undefined / action unknown).

- [ ] **Step 3: Config** — in `MinistryConfigSchema`: add `busMinistry: z.string().max(40).default('Bus Ministry'),` inside `labels`; add `busMinistry: z.boolean().default(false),` inside `modules`; add a top-level block after `roles`:

```ts
  // Bus Ministry module settings (spec 2026-10-05). Edited from the Bus
  // settings sheet (admin) via PATCH /settings. No ministry-specific defaults.
  busMinistry: z
    .object({
      visibility: z.enum(['admin', 'all']).default('admin'),
      churchAddress: z.string().max(200).default(''),
      churchPlaceId: z.string().max(300).default(''),
      leaveTime: z.string().regex(/^\d{2}:\d{2}$/).default('21:00'),
      targetRouteMin: z.number().int().min(10).max(240).default(45),
      prefWeightMin: z.number().int().min(0).max(120).default(10),
      genderWeightMin: z.number().int().min(0).max(600).default(120),
      detourMin: z.number().int().min(1).max(120).default(10),
      detourPct: z.number().int().min(1).max(100).default(20),
      coordinatorLeaderIds: z.array(z.string()).default([]),
    })
    .default({}),
```

Also add `busMinistry: false` to `PRESET_CONFIGS.simple.modules` so the preset object stays complete.

- [ ] **Step 4: RBAC** — add to the `Action` union:

```ts
  | 'bus:use'                 // open Bus Ministry, My car
  | 'bus:roster'              // add/edit/remove riders, New Person
  | 'bus:coordinate'          // Car setup, Move (Generate/Undo in R2)
  | 'bus:analysis'            // Route analysis, Past nights
```

and grant: `leader` → `bus:use`; `grade` → `bus:use, bus:roster`; `quad` → `bus:use, bus:roster, bus:coordinate`; `director` and `admin` → all four.

- [ ] **Step 5: Entities** — create `src/core/entities/bus.ts`:

```ts
import type { ID, ISODateString } from '../types/common';

export type BusGender = 'male' | 'female' | null;
export type EndsAt = 'church' | 'last_drop' | 'address';

export interface BusVehicle {
  id: ID; name: string; plate: string | null; seats: number; prefGrades: number[];
  endsAt: EndsAt; endsAddress: string | null; endsPlaceId: string | null;
  sort: number; archived: boolean; createdAt: ISODateString; updatedAt: ISODateString;
}
export interface BusOwnCar {
  name: string; seats: number; plate: string | null;
  endsAt: EndsAt; endsAddress: string | null; endsPlaceId: string | null;
}
/** id === leaderId. riderKeys are 's:<studentId>' | 'g:<guestId>'. */
export interface BusLeaderPrefs {
  id: ID; inPool: boolean; fixedVehicleId: ID | null; ownCar: BusOwnCar | null; lastOwnRiderKeys: string[];
}
export interface BusGuest {
  id: ID; firstName: string; lastName: string; grade: number | null; gender: BusGender;
  phone: string | null; linkedStudentId: ID | null; dismissed: boolean;
  createdAt: ISODateString; lastRiddenAt: ISODateString | null;
}
export interface BusAddress {
  id: ID; studentId: ID | null; guestId: ID | null; label: string; address: string; placeId: string | null;
  lastUsedAt: ISODateString; createdAt: ISODateString;
}
export interface BusUndoEntry { riderId: ID; runVehicleId: ID | null; stopOrder: number | null; pinned: boolean }
export interface BusRun {
  id: ID; serviceDate: string; version: number; availablePoolLeaderIds: ID[];
  lockBy: string | null; lockUntil: ISODateString | null;
  lastChangeBy: string | null; lastChangeAt: ISODateString | null;
  undoSnapshot: BusUndoEntry[] | null; undoUntil: ISODateString | null; createdAt: ISODateString;
}
export interface BusRunVehicle {
  id: ID; runId: ID; vehicleId: ID | null; ownerLeaderId: ID | null;
  name: string; seats: number; plate: string | null; running: boolean; leaderIds: ID[];
  endsAt: EndsAt; endsAddress: string | null; endsPlaceId: string | null; colourIndex: number;
}
export interface BusRunRider {
  id: ID; runId: ID; studentId: ID | null; guestId: ID | null; addressId: ID | null;
  runVehicleId: ID | null; stopOrder: number | null; pinned: boolean;
  addedBy: string; addedAt: ISODateString;
  snapName: string; snapGrade: number | null; snapGender: BusGender; snapAddress: string; snapPlaceId: string | null;
}

// ---- view types returned by BusService ----
export interface BusEligibility { female: boolean; male: boolean; unknown: boolean }
export interface BusRunVehicleView extends BusRunVehicle {
  capacity: number; eligibility: BusEligibility; leaderNames: string[];
}
export interface BusRiderView {
  id: ID; studentId: ID | null; guestId: ID | null; addressId: ID | null;
  runVehicleId: ID | null; stopOrder: number | null; pinned: boolean;
  name: string; grade: number | null; gender: BusGender; address: string; placeId: string | null;
}
export interface BusLeaderView { id: ID; name: string; gender: BusGender; inPool: boolean; fixedVehicleId: ID | null }
export interface BusRunView {
  run: { id: ID; serviceDate: string; version: number; readOnly: boolean;
         lastChangeBy: string | null; lastChangeAt: string | null;
         lockBy: string | null; lockUntil: string | null; undoUntil: string | null };
  vehicles: BusRunVehicleView[];
  riders: BusRiderView[];
  leaders: BusLeaderView[];
  availablePoolLeaderIds: ID[];
  fleet: BusVehicle[];
  canCoordinate: boolean;
  pendingNewPeople: number | null;   // null unless director/admin
}
export interface BusSearchHit {
  kind: 'student' | 'guest'; id: ID; name: string; grade: number | null; gender: BusGender;
  addresses: { id: ID; label: string; address: string }[];
}
export interface MyCarView {
  vehicle: BusRunVehicleView | null;
  stops: (BusRiderView & { mobile: string | null })[];
  churchAddress: string;
  ownCarDraft: { car: BusOwnCar | null; riderIds: ID[] } | null;
}
export interface PendingGuestView {
  id: ID; name: string; grade: number | null; phone: string | null; createdAt: string;
  suggestions: { studentId: ID; name: string; grade: number | null }[];
}
```

- [ ] **Step 6: Migration** — create `supabase/migrations/0011_bus_ministry.sql`:

```sql
-- Bus Ministry (spec 2026-10-05). History tables deliberately have NO foreign key
-- to students/leaders: Full Reset runs `truncate students/leaders cascade`, which
-- empties every referencing table. Only saved addresses and leader prefs cascade.
create table if not exists bus_vehicles (
  id uuid primary key,
  name text not null,
  plate text,
  seats int not null check (seats between 1 and 60),
  pref_grades jsonb not null default '[]',
  ends_at text not null default 'church',
  ends_address text,          -- encrypted
  ends_place_id text,         -- encrypted
  sort int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists bus_leader_prefs (
  leader_id uuid primary key references leaders(id) on delete cascade,
  in_pool boolean not null default false,
  fixed_vehicle_id uuid references bus_vehicles(id) on delete set null,
  own_car jsonb,              -- ends_address/ends_place_id inside are encrypted
  last_own_rider_keys jsonb not null default '[]'
);
create table if not exists bus_guests (
  id uuid primary key,
  first_name text not null,
  last_name text not null,
  grade int,
  gender text,
  phone text,                 -- encrypted
  linked_student_id uuid,     -- no FK (survives Full Reset)
  dismissed boolean not null default false,
  created_at timestamptz not null default now(),
  last_ridden_at timestamptz
);
create table if not exists bus_addresses (
  id uuid primary key,
  student_id uuid references students(id) on delete cascade,
  guest_id uuid references bus_guests(id) on delete cascade,
  label text not null default '',
  address text not null,      -- encrypted
  place_id text,              -- encrypted
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (student_id is not null or guest_id is not null)
);
create index if not exists bus_addresses_student_idx on bus_addresses(student_id);
create index if not exists bus_addresses_guest_idx on bus_addresses(guest_id);
create table if not exists bus_runs (
  id uuid primary key,
  service_date date not null unique,
  version int not null default 0,
  available_pool_leader_ids jsonb not null default '[]',
  lock_by text,
  lock_until timestamptz,
  last_change_by text,
  last_change_at timestamptz,
  undo_snapshot jsonb,
  undo_until timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists bus_run_vehicles (
  id uuid primary key,
  run_id uuid not null references bus_runs(id) on delete cascade,
  vehicle_id uuid references bus_vehicles(id) on delete set null,
  owner_leader_id uuid,       -- no FK (survives Full Reset)
  name text not null,
  seats int not null,
  plate text,
  running boolean not null default true,
  leader_ids jsonb not null default '[]',
  ends_at text not null default 'church',
  ends_address text,          -- encrypted
  ends_place_id text,         -- encrypted
  colour_index int not null default 0
);
create index if not exists bus_run_vehicles_run_idx on bus_run_vehicles(run_id);
create table if not exists bus_run_riders (
  id uuid primary key,
  run_id uuid not null references bus_runs(id) on delete cascade,
  student_id uuid,            -- no FK (history survives Full Reset)
  guest_id uuid,              -- no FK
  address_id uuid,            -- no FK
  run_vehicle_id uuid references bus_run_vehicles(id) on delete set null,
  stop_order int,
  pinned boolean not null default false,
  added_by text not null default '',
  added_at timestamptz not null default now(),
  snap_name text not null,    -- encrypted
  snap_grade int,
  snap_gender text,
  snap_address text not null, -- encrypted
  snap_place_id text          -- encrypted
);
create index if not exists bus_run_riders_run_idx on bus_run_riders(run_id);
create unique index if not exists bus_run_riders_student_uq on bus_run_riders(run_id, student_id) where student_id is not null;
create unique index if not exists bus_run_riders_guest_uq on bus_run_riders(run_id, guest_id) where guest_id is not null;

alter table bus_vehicles      enable row level security;
alter table bus_leader_prefs  enable row level security;
alter table bus_guests        enable row level security;
alter table bus_addresses     enable row level security;
alter table bus_runs          enable row level security;
alter table bus_run_vehicles  enable row level security;
alter table bus_run_riders    enable row level security;
```

- [ ] **Step 7: Run** `npm run typecheck && npx vitest run` — Expected: PASS (all prior tests + new).

- [ ] **Step 8: Commit** — `git add -A src/core supabase/migrations/0011_bus_ministry.sql src/services/access-control.ts src/tests/bus-logic.test.ts && git commit -m "feat(bus): config, RBAC, entities, migration 0011"`

---

### Task 2: Pure helpers + repository (in-memory + Supabase) + container

**Files:**
- Create: `src/services/bus-logic.ts`
- Modify: `src/repositories/interfaces/entity-repositories.ts` (append `IBusRepository`)
- Create: `src/repositories/in-memory/in-memory.bus.ts`; export from `src/repositories/in-memory/index.ts`
- Create: `src/repositories/supabase/supabase.bus.ts`; export from `src/repositories/supabase/index.ts`
- Modify: `src/container.ts` (add `bus` repo to `Repositories`, init it)
- Test: `src/tests/bus-logic.test.ts` (append), `src/tests/bus.repo.test.ts`, `src/tests/supabase.bus.mapper.test.ts`

**Interfaces:**
- Consumes: types from `bus.ts`.
- Produces (exact):

```ts
// bus-logic.ts
export function currentRunDate(localNow: string, serviceDayOfWeek: number): string; // 'YYYY-MM-DD'
export function eligibilityOf(leaderGenders: (BusGender | undefined)[]): BusEligibility;
export function capacityOf(seats: number, leaderCount: number): number;           // max(0, seats-leaders)
export function normName(s: string): string;                                       // lowercase, trim, collapse spaces, strip diacritics
export function nameMatches(query: string, first: string, last: string): boolean; // every token is a prefix of first or last
export function riderKey(r: { studentId: string | null; guestId: string | null }): string; // 's:..' | 'g:..'
export function suburbOf(address: string): string;
export const PURGE_DAYS = 28;

// IBusRepository
export interface IBusRepository {
  init(): Promise<void>;
  listVehicles(): Promise<BusVehicle[]>;
  getVehicle(id: string): Promise<BusVehicle | null>;
  saveVehicle(v: BusVehicle): Promise<BusVehicle>;
  listLeaderPrefs(): Promise<BusLeaderPrefs[]>;
  getLeaderPrefs(leaderId: string): Promise<BusLeaderPrefs | null>;
  saveLeaderPrefs(p: BusLeaderPrefs): Promise<BusLeaderPrefs>;
  listGuests(): Promise<BusGuest[]>;
  getGuest(id: string): Promise<BusGuest | null>;
  saveGuest(g: BusGuest): Promise<BusGuest>;
  deleteGuest(id: string): Promise<void>;           // also deletes the guest's addresses
  listAddresses(owner: { studentId?: string; guestId?: string }): Promise<BusAddress[]>; // newest lastUsedAt first
  getAddress(id: string): Promise<BusAddress | null>;
  saveAddress(a: BusAddress): Promise<BusAddress>;
  reassignGuestAddresses(guestId: string, studentId: string): Promise<void>;
  getRunByDate(serviceDate: string): Promise<BusRun | null>;
  getRun(id: string): Promise<BusRun | null>;
  listRuns(): Promise<BusRun[]>;                    // newest serviceDate first
  insertRunIfAbsent(r: BusRun): Promise<{ run: BusRun; created: boolean }>;
  saveRun(r: BusRun): Promise<BusRun>;
  bumpRun(runId: string, by: string, atIso: string): Promise<BusRun>; // version+1, lastChange*
  listRunVehicles(runId: string): Promise<BusRunVehicle[]>;
  saveRunVehicle(v: BusRunVehicle): Promise<BusRunVehicle>;
  deleteRunVehicle(id: string): Promise<void>;
  listRunRiders(runId: string): Promise<BusRunRider[]>;
  getRunRider(id: string): Promise<BusRunRider | null>;
  saveRunRider(r: BusRunRider): Promise<BusRunRider>;
  deleteRunRider(id: string): Promise<void>;
}
```

- [ ] **Step 1: Failing tests** — append to `src/tests/bus-logic.test.ts`:

```ts
import { currentRunDate, eligibilityOf, capacityOf, nameMatches, suburbOf, riderKey } from '../services/bus-logic';

describe('currentRunDate (Friday = 5)', () => {
  it('Wednesday → coming Friday', () => expect(currentRunDate('2026-10-07T15:00', 5)).toBe('2026-10-09'));
  it('Friday evening → today', () => expect(currentRunDate('2026-10-09T19:05', 5)).toBe('2026-10-09'));
  it('Saturday 00:40 → still last night (drivers out late)', () => expect(currentRunDate('2026-10-10T00:40', 5)).toBe('2026-10-09'));
  it('Saturday 06:00 → next Friday', () => expect(currentRunDate('2026-10-10T06:00', 5)).toBe('2026-10-16'));
  it('works for a Sunday ministry', () => expect(currentRunDate('2026-10-07T10:00', 0)).toBe('2026-10-11'));
});
describe('eligibility + capacity', () => {
  it('from leader genders', () => {
    expect(eligibilityOf(['male'])).toEqual({ male: true, female: false, unknown: false });
    expect(eligibilityOf(['male', 'female'])).toEqual({ male: true, female: true, unknown: false });
    expect(eligibilityOf([null])).toEqual({ male: false, female: false, unknown: true });
    expect(eligibilityOf([])).toEqual({ male: false, female: false, unknown: true });
  });
  it('capacity never negative', () => { expect(capacityOf(12, 2)).toBe(10); expect(capacityOf(1, 3)).toBe(0); });
});
describe('names + suburb', () => {
  it('token prefix match, any order, accent-insensitive', () => {
    expect(nameMatches('kim ril', 'Riley', 'Kim')).toBe(true);
    expect(nameMatches('zoe', 'Zoë', 'Ng')).toBe(true);
    expect(nameMatches('ril x', 'Riley', 'Kim')).toBe(false);
  });
  it('suburb from a Google-style address', () => {
    expect(suburbOf('24 Wynnum Rd, Carina QLD 4152, Australia')).toBe('Carina');
    expect(suburbOf('12 Smith St')).toBe('12 Smith St');
  });
  it('rider key', () => expect(riderKey({ studentId: null, guestId: 'g1' })).toBe('g:g1'));
});
```

Create `src/tests/bus.repo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { InMemoryBusRepository } from '../repositories/in-memory';
import type { BusRun } from '../core/entities/bus';

const run = (id: string, date: string): BusRun => ({ id, serviceDate: date, version: 0, availablePoolLeaderIds: [],
  lockBy: null, lockUntil: null, lastChangeBy: null, lastChangeAt: null, undoSnapshot: null, undoUntil: null,
  createdAt: '2026-10-01T00:00:00.000Z' });

describe('InMemoryBusRepository', () => {
  it('insertRunIfAbsent is idempotent per date', async () => {
    const r = new InMemoryBusRepository(); await r.init();
    expect((await r.insertRunIfAbsent(run('a', '2026-10-09'))).created).toBe(true);
    const second = await r.insertRunIfAbsent(run('b', '2026-10-09'));
    expect(second.created).toBe(false);
    expect(second.run.id).toBe('a');
  });
  it('bumpRun increments version and records who', async () => {
    const r = new InMemoryBusRepository(); await r.init();
    await r.insertRunIfAbsent(run('a', '2026-10-09'));
    const b = await r.bumpRun('a', 'Sarah', '2026-10-09T09:04:00.000Z');
    expect([b.version, b.lastChangeBy]).toEqual([1, 'Sarah']);
  });
  it('deleteGuest removes their addresses; reassign moves them to a student', async () => {
    const r = new InMemoryBusRepository(); await r.init();
    const base = { label: 'Home', address: '1 A St, Carina', placeId: null, lastUsedAt: '2026-10-01T00:00:00.000Z', createdAt: '2026-10-01T00:00:00.000Z' };
    await r.saveAddress({ id: 'x1', studentId: null, guestId: 'g1', ...base });
    await r.saveAddress({ id: 'x2', studentId: null, guestId: 'g2', ...base });
    await r.reassignGuestAddresses('g1', 's1');
    expect((await r.listAddresses({ studentId: 's1' })).map((a) => a.id)).toEqual(['x1']);
    await r.deleteGuest('g2');
    expect(await r.listAddresses({ guestId: 'g2' })).toEqual([]);
  });
});
```

Create `src/tests/supabase.bus.mapper.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { busCrypt } from '../repositories/supabase/supabase.bus';

beforeAll(() => {
  process.env['FIELD_ENCRYPTION_KEY'] = Buffer.alloc(32, 2).toString('base64');
  process.env['FIELD_ENCRYPTION_KEY_ID'] = 'k1';
});

describe('bus field encryption', () => {
  it('round-trips and is bound to its row', () => {
    const ct = busCrypt.enc('24 Wynnum Rd, Carina', 'bus_addresses:address:a1');
    expect(ct).toMatch(/^v1\./);
    expect(busCrypt.dec(ct, 'bus_addresses:address:a1')).toBe('24 Wynnum Rd, Carina');
    expect(() => busCrypt.dec(ct, 'bus_addresses:address:OTHER')).toThrow();
  });
  it('tolerates plaintext and null', () => {
    expect(busCrypt.dec('plain', 'x')).toBe('plain');
    expect(busCrypt.dec(null, 'x')).toBeNull();
    expect(busCrypt.enc(null, 'x')).toBeNull();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/tests/bus-logic.test.ts src/tests/bus.repo.test.ts src/tests/supabase.bus.mapper.test.ts` — Expected: FAIL (modules missing).

- [ ] **Step 3: `src/services/bus-logic.ts`**

```ts
import type { BusEligibility, BusGender } from '../core/entities/bus';

export const PURGE_DAYS = 28;
const LATE_NIGHT_CUTOFF_HOUR = 6; // before 06:00 the previous evening's run is still "tonight"

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** localNow = the phone's local 'YYYY-MM-DDTHH:mm'. Returns the run date (service day) it belongs to. */
export function currentRunDate(localNow: string, serviceDayOfWeek: number): string {
  let day = localNow.slice(0, 10);
  const hour = Number(localNow.slice(11, 13) || '12');
  if (hour < LATE_NIGHT_CUTOFF_HOUR) day = addDays(day, -1);
  const dow = new Date(day + 'T00:00:00Z').getUTCDay();
  return addDays(day, (serviceDayOfWeek - dow + 7) % 7);
}

/** Who a car can take, from its leaders' genders. unknown = no leader with a known gender. */
export function eligibilityOf(leaderGenders: (BusGender | undefined)[]): BusEligibility {
  const female = leaderGenders.includes('female');
  const male = leaderGenders.includes('male');
  return { female, male, unknown: !female && !male };
}

export function capacityOf(seats: number, leaderCount: number): number {
  return Math.max(0, seats - leaderCount);
}

export function normName(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

export function nameMatches(query: string, first: string, last: string): boolean {
  const f = normName(first), l = normName(last);
  return normName(query).split(' ').filter(Boolean).every((t) => f.startsWith(t) || l.startsWith(t));
}

export function riderKey(r: { studentId: string | null; guestId: string | null }): string {
  return r.studentId ? `s:${r.studentId}` : `g:${r.guestId}`;
}

/** "24 Wynnum Rd, Carina QLD 4152, Australia" → "Carina". Falls back to the input. */
export function suburbOf(address: string): string {
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return address.trim();
  return parts[1]!.replace(/\s+[A-Z]{2,3}\s+\d{4}$/, '').trim();
}
```

- [ ] **Step 4: Interface** — append `IBusRepository` (exact block from Interfaces above) to `entity-repositories.ts` with `import type { BusVehicle, BusLeaderPrefs, BusGuest, BusAddress, BusRun, BusRunVehicle, BusRunRider } from '../../core/entities/bus';`.

- [ ] **Step 5: `src/repositories/in-memory/in-memory.bus.ts`**

```ts
import type { IBusRepository } from '../interfaces/entity-repositories';
import type { BusVehicle, BusLeaderPrefs, BusGuest, BusAddress, BusRun, BusRunVehicle, BusRunRider } from '../../core/entities/bus';

const c = <T>(v: T): T => structuredClone(v);

export class InMemoryBusRepository implements IBusRepository {
  private vehicles = new Map<string, BusVehicle>();
  private prefs = new Map<string, BusLeaderPrefs>();
  private guests = new Map<string, BusGuest>();
  private addresses = new Map<string, BusAddress>();
  private runs = new Map<string, BusRun>();
  private runVehicles = new Map<string, BusRunVehicle>();
  private riders = new Map<string, BusRunRider>();

  async init(): Promise<void> {}

  async listVehicles() { return [...this.vehicles.values()].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)).map(c); }
  async getVehicle(id: string) { const v = this.vehicles.get(id); return v ? c(v) : null; }
  async saveVehicle(v: BusVehicle) { this.vehicles.set(v.id, c(v)); return c(v); }

  async listLeaderPrefs() { return [...this.prefs.values()].map(c); }
  async getLeaderPrefs(id: string) { const p = this.prefs.get(id); return p ? c(p) : null; }
  async saveLeaderPrefs(p: BusLeaderPrefs) { this.prefs.set(p.id, c(p)); return c(p); }

  async listGuests() { return [...this.guests.values()].map(c); }
  async getGuest(id: string) { const g = this.guests.get(id); return g ? c(g) : null; }
  async saveGuest(g: BusGuest) { this.guests.set(g.id, c(g)); return c(g); }
  async deleteGuest(id: string) {
    this.guests.delete(id);
    for (const [k, a] of this.addresses) if (a.guestId === id) this.addresses.delete(k);
  }

  async listAddresses(o: { studentId?: string; guestId?: string }) {
    return [...this.addresses.values()]
      .filter((a) => (o.studentId ? a.studentId === o.studentId : a.guestId === o.guestId))
      .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt)).map(c);
  }
  async getAddress(id: string) { const a = this.addresses.get(id); return a ? c(a) : null; }
  async saveAddress(a: BusAddress) { this.addresses.set(a.id, c(a)); return c(a); }
  async reassignGuestAddresses(guestId: string, studentId: string) {
    for (const a of this.addresses.values()) if (a.guestId === guestId) { a.guestId = null; a.studentId = studentId; }
  }

  async getRunByDate(d: string) { const r = [...this.runs.values()].find((x) => x.serviceDate === d); return r ? c(r) : null; }
  async getRun(id: string) { const r = this.runs.get(id); return r ? c(r) : null; }
  async listRuns() { return [...this.runs.values()].sort((a, b) => b.serviceDate.localeCompare(a.serviceDate)).map(c); }
  async insertRunIfAbsent(r: BusRun) {
    const existing = await this.getRunByDate(r.serviceDate);
    if (existing) return { run: existing, created: false };
    this.runs.set(r.id, c(r));
    return { run: c(r), created: true };
  }
  async saveRun(r: BusRun) { this.runs.set(r.id, c(r)); return c(r); }
  async bumpRun(id: string, by: string, at: string) {
    const r = this.runs.get(id);
    if (!r) throw new Error('run not found');
    r.version += 1; r.lastChangeBy = by; r.lastChangeAt = at;
    return c(r);
  }

  async listRunVehicles(runId: string) { return [...this.runVehicles.values()].filter((v) => v.runId === runId).sort((a, b) => a.colourIndex - b.colourIndex).map(c); }
  async saveRunVehicle(v: BusRunVehicle) { this.runVehicles.set(v.id, c(v)); return c(v); }
  async deleteRunVehicle(id: string) {
    this.runVehicles.delete(id);
    for (const r of this.riders.values()) if (r.runVehicleId === id) { r.runVehicleId = null; r.stopOrder = null; }
  }

  async listRunRiders(runId: string) { return [...this.riders.values()].filter((r) => r.runId === runId).sort((a, b) => a.addedAt.localeCompare(b.addedAt)).map(c); }
  async getRunRider(id: string) { const r = this.riders.get(id); return r ? c(r) : null; }
  async saveRunRider(r: BusRunRider) { this.riders.set(r.id, c(r)); return c(r); }
  async deleteRunRider(id: string) { this.riders.delete(id); }
}
```

Add `export { InMemoryBusRepository } from './in-memory.bus';` to `src/repositories/in-memory/index.ts`.

- [ ] **Step 6: `src/repositories/supabase/supabase.bus.ts`** — follow `supabase.prayers.ts` style. Encryption is ONLY here.

```ts
import type { SqlClient } from './client';
import { toIso } from './client';
import { isEncrypted, decryptField, maybeEncrypt } from '../../utils/field-crypto';
import type { IBusRepository } from '../interfaces/entity-repositories';
import type { BusVehicle, BusLeaderPrefs, BusGuest, BusAddress, BusRun, BusRunVehicle, BusRunRider,
  BusOwnCar, EndsAt, BusGender } from '../../core/entities/bus';

export const busCrypt = {
  enc: (v: string | null | undefined, aad: string): string | null => maybeEncrypt(v, aad),
  dec: (v: unknown, aad: string): string | null => (v == null ? null : isEncrypted(v) ? decryptField(v, aad) : String(v)),
};
const iso = (v: unknown) => (v == null ? null : toIso(v));

function toVehicle(r: Record<string, any>): BusVehicle {
  return { id: r.id, name: r.name, plate: r.plate ?? null, seats: r.seats, prefGrades: r.pref_grades ?? [],
    endsAt: r.ends_at as EndsAt,
    endsAddress: busCrypt.dec(r.ends_address, `bus_vehicles:ends_address:${r.id}`),
    endsPlaceId: busCrypt.dec(r.ends_place_id, `bus_vehicles:ends_place_id:${r.id}`),
    sort: r.sort, archived: r.archived, createdAt: toIso(r.created_at), updatedAt: toIso(r.updated_at) };
}
function ownCarOut(o: BusOwnCar | null, leaderId: string): unknown {
  if (!o) return null;
  return { ...o, endsAddress: busCrypt.enc(o.endsAddress, `bus_leader_prefs:own_car_address:${leaderId}`),
    endsPlaceId: busCrypt.enc(o.endsPlaceId, `bus_leader_prefs:own_car_place:${leaderId}`) };
}
function ownCarIn(o: any, leaderId: string): BusOwnCar | null {
  if (!o) return null;
  return { ...o, endsAddress: busCrypt.dec(o.endsAddress, `bus_leader_prefs:own_car_address:${leaderId}`),
    endsPlaceId: busCrypt.dec(o.endsPlaceId, `bus_leader_prefs:own_car_place:${leaderId}`) };
}
function toPrefs(r: Record<string, any>): BusLeaderPrefs {
  return { id: r.leader_id, inPool: r.in_pool, fixedVehicleId: r.fixed_vehicle_id ?? null,
    ownCar: ownCarIn(r.own_car, r.leader_id), lastOwnRiderKeys: r.last_own_rider_keys ?? [] };
}
function toGuest(r: Record<string, any>): BusGuest {
  return { id: r.id, firstName: r.first_name, lastName: r.last_name, grade: r.grade ?? null, gender: (r.gender ?? null) as BusGender,
    phone: busCrypt.dec(r.phone, `bus_guests:phone:${r.id}`), linkedStudentId: r.linked_student_id ?? null,
    dismissed: r.dismissed, createdAt: toIso(r.created_at), lastRiddenAt: iso(r.last_ridden_at) };
}
function toAddress(r: Record<string, any>): BusAddress {
  return { id: r.id, studentId: r.student_id ?? null, guestId: r.guest_id ?? null, label: r.label,
    address: busCrypt.dec(r.address, `bus_addresses:address:${r.id}`)!,
    placeId: busCrypt.dec(r.place_id, `bus_addresses:place_id:${r.id}`),
    lastUsedAt: toIso(r.last_used_at), createdAt: toIso(r.created_at) };
}
function toRun(r: Record<string, any>): BusRun {
  return { id: r.id, serviceDate: typeof r.service_date === 'string' ? r.service_date.slice(0, 10) : toIso(r.service_date).slice(0, 10),
    version: r.version, availablePoolLeaderIds: r.available_pool_leader_ids ?? [],
    lockBy: r.lock_by ?? null, lockUntil: iso(r.lock_until), lastChangeBy: r.last_change_by ?? null,
    lastChangeAt: iso(r.last_change_at), undoSnapshot: r.undo_snapshot ?? null, undoUntil: iso(r.undo_until),
    createdAt: toIso(r.created_at) };
}
function toRunVehicle(r: Record<string, any>): BusRunVehicle {
  return { id: r.id, runId: r.run_id, vehicleId: r.vehicle_id ?? null, ownerLeaderId: r.owner_leader_id ?? null,
    name: r.name, seats: r.seats, plate: r.plate ?? null, running: r.running, leaderIds: r.leader_ids ?? [],
    endsAt: r.ends_at as EndsAt,
    endsAddress: busCrypt.dec(r.ends_address, `bus_run_vehicles:ends_address:${r.id}`),
    endsPlaceId: busCrypt.dec(r.ends_place_id, `bus_run_vehicles:ends_place_id:${r.id}`),
    colourIndex: r.colour_index };
}
function toRider(r: Record<string, any>): BusRunRider {
  return { id: r.id, runId: r.run_id, studentId: r.student_id ?? null, guestId: r.guest_id ?? null,
    addressId: r.address_id ?? null, runVehicleId: r.run_vehicle_id ?? null, stopOrder: r.stop_order ?? null,
    pinned: r.pinned, addedBy: r.added_by, addedAt: toIso(r.added_at),
    snapName: busCrypt.dec(r.snap_name, `bus_run_riders:snap_name:${r.id}`)!,
    snapGrade: r.snap_grade ?? null, snapGender: (r.snap_gender ?? null) as BusGender,
    snapAddress: busCrypt.dec(r.snap_address, `bus_run_riders:snap_address:${r.id}`)!,
    snapPlaceId: busCrypt.dec(r.snap_place_id, `bus_run_riders:snap_place_id:${r.id}`) };
}

export class SupabaseBusRepository implements IBusRepository {
  constructor(private sql: SqlClient) {}
  private j(v: unknown) { return this.sql.json(v as Parameters<typeof this.sql.json>[0]); }

  async init(): Promise<void> {}

  async listVehicles() { return (await this.sql`select * from bus_vehicles order by sort, name`).map(toVehicle); }
  async getVehicle(id: string) { const r = await this.sql`select * from bus_vehicles where id = ${id}`; return r[0] ? toVehicle(r[0]) : null; }
  async saveVehicle(v: BusVehicle) {
    const r = await this.sql`
      insert into bus_vehicles (id, name, plate, seats, pref_grades, ends_at, ends_address, ends_place_id, sort, archived, created_at, updated_at)
      values (${v.id}, ${v.name}, ${v.plate}, ${v.seats}, ${this.j(v.prefGrades)}, ${v.endsAt},
        ${busCrypt.enc(v.endsAddress, `bus_vehicles:ends_address:${v.id}`)}, ${busCrypt.enc(v.endsPlaceId, `bus_vehicles:ends_place_id:${v.id}`)},
        ${v.sort}, ${v.archived}, ${v.createdAt}, ${v.updatedAt})
      on conflict (id) do update set name = excluded.name, plate = excluded.plate, seats = excluded.seats,
        pref_grades = excluded.pref_grades, ends_at = excluded.ends_at, ends_address = excluded.ends_address,
        ends_place_id = excluded.ends_place_id, sort = excluded.sort, archived = excluded.archived, updated_at = excluded.updated_at
      returning *`;
    return toVehicle(r[0]!);
  }

  async listLeaderPrefs() { return (await this.sql`select * from bus_leader_prefs`).map(toPrefs); }
  async getLeaderPrefs(id: string) { const r = await this.sql`select * from bus_leader_prefs where leader_id = ${id}`; return r[0] ? toPrefs(r[0]) : null; }
  async saveLeaderPrefs(p: BusLeaderPrefs) {
    const r = await this.sql`
      insert into bus_leader_prefs (leader_id, in_pool, fixed_vehicle_id, own_car, last_own_rider_keys)
      values (${p.id}, ${p.inPool}, ${p.fixedVehicleId}, ${p.ownCar ? this.j(ownCarOut(p.ownCar, p.id)) : null}, ${this.j(p.lastOwnRiderKeys)})
      on conflict (leader_id) do update set in_pool = excluded.in_pool, fixed_vehicle_id = excluded.fixed_vehicle_id,
        own_car = excluded.own_car, last_own_rider_keys = excluded.last_own_rider_keys
      returning *`;
    return toPrefs(r[0]!);
  }

  async listGuests() { return (await this.sql`select * from bus_guests order by created_at desc`).map(toGuest); }
  async getGuest(id: string) { const r = await this.sql`select * from bus_guests where id = ${id}`; return r[0] ? toGuest(r[0]) : null; }
  async saveGuest(g: BusGuest) {
    const r = await this.sql`
      insert into bus_guests (id, first_name, last_name, grade, gender, phone, linked_student_id, dismissed, created_at, last_ridden_at)
      values (${g.id}, ${g.firstName}, ${g.lastName}, ${g.grade}, ${g.gender}, ${busCrypt.enc(g.phone, `bus_guests:phone:${g.id}`)},
        ${g.linkedStudentId}, ${g.dismissed}, ${g.createdAt}, ${g.lastRiddenAt})
      on conflict (id) do update set first_name = excluded.first_name, last_name = excluded.last_name, grade = excluded.grade,
        gender = excluded.gender, phone = excluded.phone, linked_student_id = excluded.linked_student_id,
        dismissed = excluded.dismissed, last_ridden_at = excluded.last_ridden_at
      returning *`;
    return toGuest(r[0]!);
  }
  async deleteGuest(id: string) { await this.sql`delete from bus_guests where id = ${id}`; } // addresses cascade

  async listAddresses(o: { studentId?: string; guestId?: string }) {
    const r = o.studentId
      ? await this.sql`select * from bus_addresses where student_id = ${o.studentId} order by last_used_at desc`
      : await this.sql`select * from bus_addresses where guest_id = ${o.guestId ?? null} order by last_used_at desc`;
    return r.map(toAddress);
  }
  async getAddress(id: string) { const r = await this.sql`select * from bus_addresses where id = ${id}`; return r[0] ? toAddress(r[0]) : null; }
  async saveAddress(a: BusAddress) {
    const r = await this.sql`
      insert into bus_addresses (id, student_id, guest_id, label, address, place_id, last_used_at, created_at)
      values (${a.id}, ${a.studentId}, ${a.guestId}, ${a.label}, ${busCrypt.enc(a.address, `bus_addresses:address:${a.id}`)},
        ${busCrypt.enc(a.placeId, `bus_addresses:place_id:${a.id}`)}, ${a.lastUsedAt}, ${a.createdAt})
      on conflict (id) do update set student_id = excluded.student_id, guest_id = excluded.guest_id, label = excluded.label,
        address = excluded.address, place_id = excluded.place_id, last_used_at = excluded.last_used_at
      returning *`;
    return toAddress(r[0]!);
  }
  async reassignGuestAddresses(guestId: string, studentId: string) {
    await this.sql`update bus_addresses set student_id = ${studentId}, guest_id = null where guest_id = ${guestId}`;
  }

  async getRunByDate(d: string) { const r = await this.sql`select * from bus_runs where service_date = ${d}`; return r[0] ? toRun(r[0]) : null; }
  async getRun(id: string) { const r = await this.sql`select * from bus_runs where id = ${id}`; return r[0] ? toRun(r[0]) : null; }
  async listRuns() { return (await this.sql`select * from bus_runs order by service_date desc`).map(toRun); }
  async insertRunIfAbsent(run: BusRun) {
    const ins = await this.sql`
      insert into bus_runs (id, service_date, version, available_pool_leader_ids, created_at)
      values (${run.id}, ${run.serviceDate}, 0, ${this.j(run.availablePoolLeaderIds)}, ${run.createdAt})
      on conflict (service_date) do nothing returning *`;
    if (ins[0]) return { run: toRun(ins[0]), created: true };
    return { run: (await this.getRunByDate(run.serviceDate))!, created: false };
  }
  async saveRun(x: BusRun) {
    const r = await this.sql`
      update bus_runs set version = ${x.version}, available_pool_leader_ids = ${this.j(x.availablePoolLeaderIds)},
        lock_by = ${x.lockBy}, lock_until = ${x.lockUntil}, last_change_by = ${x.lastChangeBy}, last_change_at = ${x.lastChangeAt},
        undo_snapshot = ${x.undoSnapshot ? this.j(x.undoSnapshot) : null}, undo_until = ${x.undoUntil}
      where id = ${x.id} returning *`;
    return toRun(r[0]!);
  }
  async bumpRun(id: string, by: string, at: string) {
    const r = await this.sql`update bus_runs set version = version + 1, last_change_by = ${by}, last_change_at = ${at} where id = ${id} returning *`;
    return toRun(r[0]!);
  }

  async listRunVehicles(runId: string) { return (await this.sql`select * from bus_run_vehicles where run_id = ${runId} order by colour_index`).map(toRunVehicle); }
  async saveRunVehicle(v: BusRunVehicle) {
    const r = await this.sql`
      insert into bus_run_vehicles (id, run_id, vehicle_id, owner_leader_id, name, seats, plate, running, leader_ids, ends_at, ends_address, ends_place_id, colour_index)
      values (${v.id}, ${v.runId}, ${v.vehicleId}, ${v.ownerLeaderId}, ${v.name}, ${v.seats}, ${v.plate}, ${v.running}, ${this.j(v.leaderIds)},
        ${v.endsAt}, ${busCrypt.enc(v.endsAddress, `bus_run_vehicles:ends_address:${v.id}`)},
        ${busCrypt.enc(v.endsPlaceId, `bus_run_vehicles:ends_place_id:${v.id}`)}, ${v.colourIndex})
      on conflict (id) do update set name = excluded.name, seats = excluded.seats, plate = excluded.plate, running = excluded.running,
        leader_ids = excluded.leader_ids, ends_at = excluded.ends_at, ends_address = excluded.ends_address,
        ends_place_id = excluded.ends_place_id, colour_index = excluded.colour_index
      returning *`;
    return toRunVehicle(r[0]!);
  }
  async deleteRunVehicle(id: string) { await this.sql`delete from bus_run_vehicles where id = ${id}`; } // riders' run_vehicle_id → null (FK set null)

  async listRunRiders(runId: string) { return (await this.sql`select * from bus_run_riders where run_id = ${runId} order by added_at`).map(toRider); }
  async getRunRider(id: string) { const r = await this.sql`select * from bus_run_riders where id = ${id}`; return r[0] ? toRider(r[0]) : null; }
  async saveRunRider(x: BusRunRider) {
    const r = await this.sql`
      insert into bus_run_riders (id, run_id, student_id, guest_id, address_id, run_vehicle_id, stop_order, pinned, added_by, added_at,
        snap_name, snap_grade, snap_gender, snap_address, snap_place_id)
      values (${x.id}, ${x.runId}, ${x.studentId}, ${x.guestId}, ${x.addressId}, ${x.runVehicleId}, ${x.stopOrder}, ${x.pinned},
        ${x.addedBy}, ${x.addedAt}, ${busCrypt.enc(x.snapName, `bus_run_riders:snap_name:${x.id}`)}, ${x.snapGrade}, ${x.snapGender},
        ${busCrypt.enc(x.snapAddress, `bus_run_riders:snap_address:${x.id}`)}, ${busCrypt.enc(x.snapPlaceId, `bus_run_riders:snap_place_id:${x.id}`)})
      on conflict (id) do update set student_id = excluded.student_id, guest_id = excluded.guest_id, address_id = excluded.address_id,
        run_vehicle_id = excluded.run_vehicle_id, stop_order = excluded.stop_order, pinned = excluded.pinned,
        snap_name = excluded.snap_name, snap_grade = excluded.snap_grade, snap_gender = excluded.snap_gender,
        snap_address = excluded.snap_address, snap_place_id = excluded.snap_place_id
      returning *`;
    return toRider(r[0]!);
  }
  async deleteRunRider(id: string) { await this.sql`delete from bus_run_riders where id = ${id}`; }
}
```

Note: the in-memory `deleteRunVehicle` nulls `stopOrder` too; the SQL FK only nulls `run_vehicle_id`. The service always re-sets `stopOrder` itself after deleting a run vehicle (Task 4), so this difference is harmless — keep both as written.

Add `export { SupabaseBusRepository } from './supabase.bus';` to `src/repositories/supabase/index.ts`.

- [ ] **Step 7: Container** — in `src/container.ts`: import both repos and `IBusRepository`; add `bus: IBusRepository;` to `Repositories`; construct

```ts
  const bus: IBusRepository = useSupabase ? new SupabaseBusRepository(sql) : new InMemoryBusRepository();
```

add `bus` to the `repos` object and `bus.init()` to the init `Promise.all`. (No json persistence — memory mode is dev-only.)

- [ ] **Step 8: Run** `npm run typecheck && npx vitest run` — Expected: PASS.

- [ ] **Step 9: Commit** — `git commit -am "feat(bus): pure helpers + bus repository (memory + supabase, encrypted)"` (also `git add` the new files first).

---

### Task 3: BusService — gate, permissions, run lifecycle, roster, walk-ins, purge

**Files:**
- Create: `src/services/bus.service.ts`
- Modify: `src/container.ts` (construct `bus` service; add to `Services`)
- Test: `src/tests/bus.service.test.ts`

**Interfaces:**
- Consumes: `IBusRepository`, `IStudentRepository`, `ILeaderRepository`, `ISettingsRepository`, bus-logic helpers, `can/assertCan`.
- Produces (Task 4 extends the same object; Task 5's controller calls these):

```ts
export interface BusCtx { actor: Actor; asLeaderId: string | null; localNow: string } // localNow 'YYYY-MM-DDTHH:mm'
export interface BusService {
  getRun(ctx: BusCtx): Promise<BusRunView>;
  getVersion(ctx: BusCtx): Promise<{ runId: string; version: number }>;
  search(ctx: BusCtx, q: string): Promise<BusSearchHit[]>;
  addRider(ctx: BusCtx, input: unknown): Promise<BusRiderView>;
  updateRider(ctx: BusCtx, riderId: string, input: unknown): Promise<BusRiderView>;
  removeRider(ctx: BusCtx, riderId: string): Promise<void>;
  createGuest(ctx: BusCtx, input: unknown): Promise<BusSearchHit>;
  // Task 4 adds: saveVehicle, updateRunVehicle, setPool, setLeaderPrefs, saveOwnCar, removeOwnCar,
  // moveRider, myCar, pendingGuests, linkGuest, dismissGuest, linkGuestsAfterImport, listRuns, getPastRun
}
export function makeBusService(bus: IBusRepository, students: IStudentRepository,
  leaders: ILeaderRepository, settings: ISettingsRepository): BusService;
```

Input schemas (Zod, inside the service):

```ts
const NewAddress = z.object({ label: z.string().max(40).default(''), address: z.string().min(3).max(200), placeId: z.string().max(300).nullable().default(null) });
const AddRider = z.object({
  studentId: z.string().min(1).optional(), guestId: z.string().min(1).optional(),
  addressId: z.string().min(1).optional(), newAddress: NewAddress.optional(),
}).refine((v) => !!v.studentId !== !!v.guestId, 'Choose a student or a new person')
  .refine((v) => !!v.addressId !== !!v.newAddress, 'Choose an address');
const UpdateRider = z.object({ addressId: z.string().min(1).optional(), newAddress: NewAddress.optional() })
  .refine((v) => !!v.addressId !== !!v.newAddress, 'Choose an address');
const NewGuest = z.object({
  firstName: z.string().trim().min(1).max(60), lastName: z.string().trim().min(1).max(60),
  grade: z.number().int().nullable(), gender: z.enum(['male', 'female']), phone: z.string().trim().min(6).max(20),
});
```

- [ ] **Step 1: Failing tests** — `src/tests/bus.service.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { makeBusService, type BusCtx } from '../services/bus.service';
import { InMemoryBusRepository, InMemoryStudentRepository, InMemoryLeaderRepository, InMemorySettingsRepository } from '../repositories/in-memory';
import { MINISTRY_CONFIG_DEFAULTS, mergeMinistryConfig } from '../core/ministry-config';
import type { Actor } from '../core/entities/user';
import type { Student } from '../core/entities/student';
import type { Leader } from '../core/entities/leader';

export const actor = (role: string, extra: Partial<Actor> = {}): Actor =>
  ({ id: 'u-' + role, role: role as any, displayName: role.toUpperCase(), grade: null as any, quad: null as any, leaderId: null, ...extra });
export const student = (id: string, first: string, last: string, grade: number, gender: 'male' | 'female', mobile: string | null = null): Student => ({
  id, firstName: first, lastName: last, gender, grade, quad: null, mobile, parentPhone: null, dateOfBirth: null,
  svcAttended: 0, svcTotal: 0, grpAttended: 0, grpTotal: 0, grpMetWeeks: 0,
  prevSvcAttended: 0, prevSvcTotal: 0, prevGrpAttended: 0, prevGrpTotal: 0,
  atRiskStatus: null, dataSource: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});
export const leader = (id: string, name: string, gender: 'male' | 'female' | null): Leader => ({
  id, fullName: name, gender, grades: [], active: true, createdByGrade: null, smsTemplate: null,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});
export const FRI_7PM = '2026-10-09T19:00';

export async function setup(opts: { moduleOn?: boolean; visibility?: 'admin' | 'all' } = {}) {
  const bus = new InMemoryBusRepository(); const students = new InMemoryStudentRepository();
  const leaders = new InMemoryLeaderRepository(); const settings = new InMemorySettingsRepository();
  await Promise.all([bus.init(), students.init(), leaders.init(), settings.init()]);
  const cfg = mergeMinistryConfig(MINISTRY_CONFIG_DEFAULTS, {
    modules: { busMinistry: opts.moduleOn ?? true }, busMinistry: { visibility: opts.visibility ?? 'all' },
  });
  await settings.updateSettings({ ministryConfig: cfg });
  await students.save(student('s1', 'Jess', 'Tran', 9, 'female', '0412345678'));
  await students.save(student('s2', 'Sam', 'Ode', 8, 'male'));
  await students.save(student('s3', 'Riley', 'Kim', 10, 'male'));
  await leaders.save(leader('L1', 'Tom', 'male'));
  await leaders.save(leader('L2', 'Sarah', 'female'));
  const svc = makeBusService(bus, students, leaders, settings);
  const ctx = (role: string, asLeaderId: string | null = null, localNow = FRI_7PM): BusCtx => ({ actor: actor(role), asLeaderId, localNow });
  return { svc, bus, students, leaders, settings, ctx };
}

describe('gate', () => {
  it('module off → MODULE_DISABLED for everyone', async () => {
    const { svc, ctx } = await setup({ moduleOn: false });
    await expect(svc.getRun(ctx('admin'))).rejects.toMatchObject({ code: 'MODULE_DISABLED' });
  });
  it("visibility 'admin' hides it from non-admins only", async () => {
    const { svc, ctx } = await setup({ visibility: 'admin' });
    await expect(svc.getRun(ctx('director'))).rejects.toMatchObject({ code: 'MODULE_DISABLED' });
    await expect(svc.getRun(ctx('admin'))).resolves.toBeTruthy();
  });
});

describe('run lifecycle', () => {
  it('Saturday 00:40 still opens Friday', async () => {
    const { svc, ctx } = await setup();
    const v = await svc.getRun(ctx('admin', null, '2026-10-10T00:40'));
    expect(v.run.serviceDate).toBe('2026-10-09');
    expect(v.run.readOnly).toBe(false);
  });
  it('a new run copies last run vehicles (running + leaders), not tonight-only Ends at', async () => {
    const { svc, bus, ctx } = await setup();
    const now = '2026-10-01T00:00:00.000Z';
    await bus.saveVehicle({ id: 'v1', name: 'Big Bus', plate: null, seats: 12, prefGrades: [], endsAt: 'church', endsAddress: null, endsPlaceId: null, sort: 0, archived: false, createdAt: now, updatedAt: now });
    const first = await svc.getRun(ctx('admin', null, '2026-10-02T19:00'));
    const rv = first.vehicles[0]!;
    await bus.saveRunVehicle({ ...rv, leaderIds: ['L1'], endsAt: 'last_drop' });
    const next = await svc.getRun(ctx('admin', null, FRI_7PM));
    expect(next.vehicles[0]!.leaderIds).toEqual(['L1']);
    expect(next.vehicles[0]!.endsAt).toBe('church');
  });
});

describe('roster', () => {
  it('grade login can add; leader login cannot', async () => {
    const { svc, ctx } = await setup();
    const r = await svc.addRider(ctx('grade'), { studentId: 's1', newAddress: { label: 'Home', address: '24 Wynnum Rd, Carina QLD 4152, Australia' } });
    expect(r.name).toBe('Jess Tran');
    await expect(svc.addRider(ctx('leader'), { studentId: 's2', newAddress: { address: '1 A St, Bulimba' } })).rejects.toMatchObject({ statusCode: 403 });
  });
  it('adding the same student twice updates instead of duplicating', async () => {
    const { svc, ctx } = await setup();
    await svc.addRider(ctx('grade'), { studentId: 's1', newAddress: { label: 'Home', address: '1 A St, Carina' } });
    await svc.addRider(ctx('quad'), { studentId: 's1', newAddress: { label: "Dad's", address: '9 B St, Cannon Hill' } });
    const v = await svc.getRun(ctx('admin'));
    expect(v.riders).toHaveLength(1);
    expect(v.riders[0]!.address).toBe('9 B St, Cannon Hill');
  });
  it('search returns minimal fields and saved address labels, newest first', async () => {
    const { svc, ctx } = await setup();
    await svc.addRider(ctx('grade'), { studentId: 's1', newAddress: { label: 'Home', address: '1 A St, Carina' } });
    const hits = await svc.search(ctx('grade'), 'tran');
    expect(hits[0]).toMatchObject({ kind: 'student', id: 's1', name: 'Jess Tran', grade: 9, gender: 'female' });
    expect(hits[0]!.addresses[0]!.label).toBe('Home');
    expect(Object.keys(hits[0]!)).not.toContain('mobile');
  });
  it('every write bumps the version and records who', async () => {
    const { svc, ctx } = await setup();
    const before = (await svc.getVersion(ctx('admin'))).version;
    await svc.addRider(ctx('grade', 'L2'), { studentId: 's2', newAddress: { address: '1 A St, Bulimba' } });
    const v = await svc.getRun(ctx('admin'));
    expect(v.run.version).toBe(before + 1);
    expect(v.run.lastChangeBy).toBe('Sarah');
  });
  it('riders from a finished night cannot be changed', async () => {
    const { svc, ctx } = await setup();
    const r = await svc.addRider(ctx('grade'), { studentId: 's1', newAddress: { address: '1 A St, Carina' } });
    await expect(svc.removeRider(ctx('grade', null, '2026-10-12T10:00'), r.id)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('walk-ins', () => {
  it('create guest → searchable → add as rider; purge after 28 days unused', async () => {
    const { svc, bus, ctx } = await setup();
    const g = await svc.createGuest(ctx('grade'), { firstName: 'Harper', lastName: 'Ng', grade: 8, gender: 'female', phone: '0400 111 222' });
    expect((await svc.search(ctx('grade'), 'harp'))[0]!.kind).toBe('guest');
    const stored = (await bus.getGuest(g.id))!;
    await bus.saveGuest({ ...stored, createdAt: '2026-08-01T00:00:00.000Z', lastRiddenAt: null });
    await svc.getRun(ctx('admin')); // triggers lazy purge
    expect(await bus.getGuest(g.id)).toBeNull();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/tests/bus.service.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/services/bus.service.ts` (part A)**

```ts
import { z } from 'zod';
import { generateId } from '../utils/id';
import { can, assertCan, type Action } from './access-control';
import { BadRequestError, ForbiddenError, ModuleDisabledError, NotFoundError } from '../core/errors/app-error';
import { currentRunDate, eligibilityOf, capacityOf, nameMatches, normName, riderKey, PURGE_DAYS } from './bus-logic';
import type { IBusRepository, IStudentRepository, ILeaderRepository, ISettingsRepository } from '../repositories/interfaces/entity-repositories';
import type { Actor } from '../core/entities/user';
import type { MinistryConfig } from '../core/ministry-config';
import type { BusRun, BusRunRider, BusRunVehicle, BusRunView, BusRiderView, BusSearchHit, BusGender,
  BusLeaderView, BusAddress, BusGuest, BusVehicle, BusRunVehicleView, MyCarView, PendingGuestView, BusOwnCar, EndsAt } from '../core/entities/bus';

export interface BusCtx { actor: Actor; asLeaderId: string | null; localNow: string }

// (BusService interface exactly as in the Interfaces block, plus Task 4 methods)

const nowIso = () => new Date().toISOString();
const genderOf = (g: string | null | undefined): BusGender => (g === 'male' || g === 'female' ? g : null);

export function makeBusService(bus: IBusRepository, students: IStudentRepository,
  leaders: ILeaderRepository, settingsRepo: ISettingsRepository): BusService {

  async function cfg(): Promise<MinistryConfig> { return (await settingsRepo.getSettings()).ministryConfig; }

  /** Module/visibility gate + coordinator elevation. Returns the effective permission check. */
  async function gate(ctx: BusCtx, action: Action): Promise<MinistryConfig> {
    const c = await cfg();
    if (!c.modules.busMinistry) throw new ModuleDisabledError('Bus Ministry');
    if (c.busMinistry.visibility === 'admin' && ctx.actor.role !== 'admin') throw new ModuleDisabledError('Bus Ministry');
    if (!allowed(ctx, c, action)) throw new ForbiddenError(`Role '${ctx.actor.role}' cannot perform '${action}'`);
    return c;
  }
  function selfLeaderId(ctx: BusCtx): string | null {
    // A junior-leader login is locked to its own record; everyone else self-identifies (spoofable by design — spec §4).
    return ctx.actor.role === 'leader' ? ctx.actor.leaderId ?? null : ctx.asLeaderId;
  }
  function allowed(ctx: BusCtx, c: MinistryConfig, action: Action): boolean {
    if (can(ctx.actor, action)) return true;
    const me = selfLeaderId(ctx);
    const coordinator = !!me && c.busMinistry.coordinatorLeaderIds.includes(me);
    return coordinator && (action === 'bus:use' || action === 'bus:roster' || action === 'bus:coordinate');
  }

  async function whoLabel(ctx: BusCtx): Promise<string> {
    const me = selfLeaderId(ctx);
    if (me) { const l = await leaders.findById(me); if (l) return l.fullName; }
    return ctx.actor.displayName;
  }

  async function purgeGuests(): Promise<void> {
    const cutoff = Date.now() - PURGE_DAYS * 86_400_000;
    for (const g of await bus.listGuests()) {
      if (g.linkedStudentId) continue;
      const last = Date.parse(g.lastRiddenAt ?? g.createdAt);
      if (last < cutoff) await bus.deleteGuest(g.id);
    }
  }

  /** Get (or create) the run for ctx.localNow. New runs copy the previous run's fleet setup. */
  async function ensureRun(ctx: BusCtx, c: MinistryConfig): Promise<BusRun> {
    const date = currentRunDate(ctx.localNow, c.structure.serviceDayOfWeek);
    const existing = await bus.getRunByDate(date);
    if (existing) return existing;
    const prev = (await bus.listRuns()).find((r) => r.serviceDate < date) ?? null;
    const { run, created } = await bus.insertRunIfAbsent({
      id: generateId(), serviceDate: date, version: 0, availablePoolLeaderIds: prev?.availablePoolLeaderIds ?? [],
      lockBy: null, lockUntil: null, lastChangeBy: null, lastChangeAt: null, undoSnapshot: null, undoUntil: null, createdAt: nowIso(),
    });
    if (!created) return run;
    const prevVehicles = prev ? await bus.listRunVehicles(prev.id) : [];
    const prefs = await bus.listLeaderPrefs();
    const fleet = (await bus.listVehicles()).filter((v) => !v.archived);
    for (const [i, v] of fleet.entries()) {
      const before = prevVehicles.find((p) => p.vehicleId === v.id);
      await bus.saveRunVehicle({
        id: generateId(), runId: run.id, vehicleId: v.id, ownerLeaderId: null, name: v.name, seats: v.seats, plate: v.plate,
        running: before ? before.running : true,
        leaderIds: before ? before.leaderIds : prefs.filter((p) => p.fixedVehicleId === v.id).map((p) => p.id),
        endsAt: v.endsAt, endsAddress: v.endsAddress, endsPlaceId: v.endsPlaceId, colourIndex: i,
      });
    }
    return run;
  }

  function isPast(run: BusRun, ctx: BusCtx, c: MinistryConfig): boolean {
    return run.serviceDate < currentRunDate(ctx.localNow, c.structure.serviceDayOfWeek);
  }
  // Writes always target the current night (ensureRun never returns a past run);
  // a rider/car id from a finished night therefore fails its runId check → 404.
  const writableRun = ensureRun;
  async function touch(ctx: BusCtx, run: BusRun): Promise<void> {
    await bus.bumpRun(run.id, await whoLabel(ctx), nowIso());
  }

  function riderView(r: BusRunRider): BusRiderView {
    return { id: r.id, studentId: r.studentId, guestId: r.guestId, addressId: r.addressId, runVehicleId: r.runVehicleId,
      stopOrder: r.stopOrder, pinned: r.pinned, name: r.snapName, grade: r.snapGrade, gender: r.snapGender,
      address: r.snapAddress, placeId: r.snapPlaceId };
  }

  async function vehicleViews(runId: string): Promise<BusRunVehicleView[]> {
    const all = await leaders.findAll();
    const byId = new Map(all.map((l) => [l.id, l]));
    return (await bus.listRunVehicles(runId)).map((v) => ({
      ...v,
      capacity: capacityOf(v.seats, v.leaderIds.length),
      eligibility: eligibilityOf(v.leaderIds.map((id) => genderOf(byId.get(id)?.gender ?? null))),
      leaderNames: v.leaderIds.map((id) => byId.get(id)?.fullName ?? 'Leader'),
    }));
  }

  async function buildView(ctx: BusCtx, c: MinistryConfig, run: BusRun): Promise<BusRunView> {
    const [vehicles, riders, active, prefs, fleet] = await Promise.all([
      vehicleViews(run.id), bus.listRunRiders(run.id), leaders.findActive(), bus.listLeaderPrefs(), bus.listVehicles(),
    ]);
    const prefBy = new Map(prefs.map((p) => [p.id, p]));
    const leaderViews: BusLeaderView[] = active.map((l) => ({ id: l.id, name: l.fullName, gender: genderOf(l.gender),
      inPool: prefBy.get(l.id)?.inPool ?? false, fixedVehicleId: prefBy.get(l.id)?.fixedVehicleId ?? null }));
    const seesPending = can(ctx.actor, 'bus:analysis');
    return {
      run: { id: run.id, serviceDate: run.serviceDate, version: run.version, readOnly: isPast(run, ctx, c),
        lastChangeBy: run.lastChangeBy, lastChangeAt: run.lastChangeAt, lockBy: run.lockBy, lockUntil: run.lockUntil, undoUntil: run.undoUntil },
      vehicles, riders: riders.map(riderView), leaders: leaderViews, availablePoolLeaderIds: run.availablePoolLeaderIds,
      fleet: fleet.filter((v) => !v.archived), canCoordinate: allowed(ctx, c, 'bus:coordinate'),
      pendingNewPeople: seesPending ? (await pendingGuestList()).length : null,
    };
  }

  async function resolveAddress(owner: { studentId?: string; guestId?: string },
    input: { addressId?: string; newAddress?: { label: string; address: string; placeId: string | null } }): Promise<BusAddress> {
    if (input.addressId) {
      const a = await bus.getAddress(input.addressId);
      const mine = a && (owner.studentId ? a.studentId === owner.studentId : a.guestId === owner.guestId);
      if (!a || !mine) throw new NotFoundError('Address not found');
      return bus.saveAddress({ ...a, lastUsedAt: nowIso() });
    }
    const n = input.newAddress!;
    return bus.saveAddress({ id: generateId(), studentId: owner.studentId ?? null, guestId: owner.guestId ?? null,
      label: n.label, address: n.address, placeId: n.placeId, lastUsedAt: nowIso(), createdAt: nowIso() });
  }

  async function pendingGuestList(): Promise<PendingGuestView[]> {
    const all = await students.findAll();
    return (await bus.listGuests()).filter((g) => !g.linkedStudentId && !g.dismissed).map((g) => ({
      id: g.id, name: `${g.firstName} ${g.lastName}`, grade: g.grade, phone: g.phone, createdAt: g.createdAt,
      suggestions: all.filter((s) => normName(s.lastName) === normName(g.lastName)
          && (normName(s.firstName).startsWith(normName(g.firstName)) || normName(g.firstName).startsWith(normName(s.firstName))))
        .map((s) => ({ studentId: s.id, name: `${s.firstName} ${s.lastName}`, grade: s.grade })),
    }));
  }

  const svc: BusService = {
    async getRun(ctx) {
      const c = await gate(ctx, 'bus:use');
      await purgeGuests();
      return buildView(ctx, c, await ensureRun(ctx, c));
    },
    async getVersion(ctx) {
      const c = await gate(ctx, 'bus:use');
      const run = await ensureRun(ctx, c);
      return { runId: run.id, version: run.version };
    },
    async search(ctx, q) {
      await gate(ctx, 'bus:roster');
      if (q.trim().length < 2) return [];
      const hits: BusSearchHit[] = [];
      for (const s of (await students.findAll()).filter((s) => nameMatches(q, s.firstName, s.lastName)).slice(0, 15)) {
        const addrs = await bus.listAddresses({ studentId: s.id });
        hits.push({ kind: 'student', id: s.id, name: `${s.firstName} ${s.lastName}`, grade: s.grade, gender: genderOf(s.gender),
          addresses: addrs.map((a) => ({ id: a.id, label: a.label, address: a.address })) });
      }
      for (const g of (await bus.listGuests()).filter((g) => !g.linkedStudentId && nameMatches(q, g.firstName, g.lastName)).slice(0, 5)) {
        const addrs = await bus.listAddresses({ guestId: g.id });
        hits.push({ kind: 'guest', id: g.id, name: `${g.firstName} ${g.lastName}`, grade: g.grade, gender: g.gender,
          addresses: addrs.map((a) => ({ id: a.id, label: a.label, address: a.address })) });
      }
      return hits;
    },
    async addRider(ctx, input) {
      const c = await gate(ctx, 'bus:roster');
      const v = AddRider.parse(input);
      const run = await writableRun(ctx, c);
      let name: string, grade: number | null, gender: BusGender;
      if (v.studentId) {
        const s = await students.findById(v.studentId);
        if (!s) throw new NotFoundError('Student not found');
        name = `${s.firstName} ${s.lastName}`; grade = s.grade; gender = genderOf(s.gender);
      } else {
        const g = await bus.getGuest(v.guestId!);
        if (!g) throw new NotFoundError('Person not found');
        name = `${g.firstName} ${g.lastName}`; grade = g.grade; gender = g.gender;
        await bus.saveGuest({ ...g, lastRiddenAt: nowIso() });
      }
      const addr = await resolveAddress(v.studentId ? { studentId: v.studentId } : { guestId: v.guestId! }, v);
      const existing = (await bus.listRunRiders(run.id)).find((r) => (v.studentId ? r.studentId === v.studentId : r.guestId === v.guestId));
      const rider = await bus.saveRunRider({
        ...(existing ?? { id: generateId(), runId: run.id, runVehicleId: null, stopOrder: null, pinned: false,
          addedBy: await whoLabel(ctx), addedAt: nowIso() }),
        studentId: v.studentId ?? null, guestId: v.guestId ?? null, addressId: addr.id,
        snapName: name, snapGrade: grade, snapGender: gender, snapAddress: addr.address, snapPlaceId: addr.placeId,
      });
      await touch(ctx, run);
      return riderView(rider);
    },
    async updateRider(ctx, riderId, input) {
      const c = await gate(ctx, 'bus:roster');
      const v = UpdateRider.parse(input);
      const run = await writableRun(ctx, c);
      const r = await bus.getRunRider(riderId);
      if (!r || r.runId !== run.id) throw new NotFoundError('Rider not found');
      const addr = await resolveAddress(r.studentId ? { studentId: r.studentId } : { guestId: r.guestId! }, v);
      const saved = await bus.saveRunRider({ ...r, addressId: addr.id, snapAddress: addr.address, snapPlaceId: addr.placeId });
      await touch(ctx, run);
      return riderView(saved);
    },
    async removeRider(ctx, riderId) {
      const c = await gate(ctx, 'bus:roster');
      const run = await writableRun(ctx, c);
      const r = await bus.getRunRider(riderId);
      if (!r || r.runId !== run.id) throw new NotFoundError('Rider not found');
      await bus.deleteRunRider(riderId);
      await touch(ctx, run);
    },
    async createGuest(ctx, input) {
      await gate(ctx, 'bus:roster');
      const v = NewGuest.parse(input);
      const g = await bus.saveGuest({ id: generateId(), firstName: v.firstName, lastName: v.lastName, grade: v.grade,
        gender: v.gender, phone: v.phone, linkedStudentId: null, dismissed: false, createdAt: nowIso(), lastRiddenAt: null });
      return { kind: 'guest', id: g.id, name: `${g.firstName} ${g.lastName}`, grade: g.grade, gender: g.gender, addresses: [] };
    },
    // Task 4 methods go here.
  } as BusService;
  return svc;
}
```

(Place the three Zod schemas from the Interfaces block above `makeBusService`.)

- [ ] **Step 4: Container** — `const busSvc = makeBusService(bus, students, leaders, settings);` add `bus: BusService` to `Services` and `bus: busSvc` to the services object.

- [ ] **Step 5: Run** `npm run typecheck && npx vitest run src/tests/bus.service.test.ts` — Expected: PASS. Then full `npx vitest run`.

- [ ] **Step 6: Commit** — `git add src/services/bus.service.ts src/tests/bus.service.test.ts src/container.ts && git commit -m "feat(bus): service — gate, run lifecycle, roster, walk-ins, purge"`

---

### Task 4: BusService — vehicles, pool, own cars, Move, My car, guest linking, history

**Files:**
- Modify: `src/services/bus.service.ts`, `src/services/import.service.ts`, `src/container.ts`
- Test: `src/tests/bus.service.test.ts` (append; reuse its exported `setup`)

**Interfaces (append to `BusService`):**

```ts
  saveVehicle(ctx: BusCtx, input: unknown): Promise<BusVehicle>;            // create (no id) or update; archive via {archived:true}
  updateRunVehicle(ctx: BusCtx, runVehicleId: string, input: unknown): Promise<BusRunVehicleView>; // running, leaderIds, endsAt/endsAddress/endsPlaceId (tonight)
  setPool(ctx: BusCtx, input: unknown): Promise<void>;                     // { availableLeaderIds: string[] }
  setLeaderPrefs(ctx: BusCtx, leaderId: string, input: unknown): Promise<void>; // { inPool?, fixedVehicleId? }
  saveOwnCar(ctx: BusCtx, input: unknown): Promise<BusRunVehicleView>;     // { car: BusOwnCar, riderIds: string[] } for selfLeaderId
  removeOwnCar(ctx: BusCtx): Promise<void>;
  moveRider(ctx: BusCtx, riderId: string, input: unknown): Promise<BusRiderView>; // { runVehicleId: string|null }
  myCar(ctx: BusCtx): Promise<MyCarView>;
  pendingGuests(ctx: BusCtx): Promise<PendingGuestView[]>;
  linkGuest(ctx: BusCtx, guestId: string, input: unknown): Promise<void>;  // { studentId }
  dismissGuest(ctx: BusCtx, guestId: string): Promise<void>;
  linkGuestsAfterImport(): Promise<{ linked: number }>;                    // no actor; no-op when module off
  listRuns(ctx: BusCtx): Promise<{ id: string; serviceDate: string; riders: number; cars: number }[]>;
  getPastRun(ctx: BusCtx, runId: string): Promise<BusRunView>;
```

Schemas:

```ts
const EndsFields = { endsAt: z.enum(['church', 'last_drop', 'address']), endsAddress: z.string().max(200).nullable().default(null), endsPlaceId: z.string().max(300).nullable().default(null) };
const SaveVehicle = z.object({ id: z.string().optional(), name: z.string().trim().min(1).max(40), plate: z.string().max(12).nullable().default(null),
  seats: z.number().int().min(1).max(60), prefGrades: z.array(z.number().int()).default([]), ...EndsFields,
  sort: z.number().int().default(0), archived: z.boolean().default(false) });
const UpdateRunVehicle = z.object({ running: z.boolean().optional(), leaderIds: z.array(z.string()).optional(),
  endsAt: EndsFields.endsAt.optional(), endsAddress: z.string().max(200).nullable().optional(), endsPlaceId: z.string().max(300).nullable().optional() });
const SetPool = z.object({ availableLeaderIds: z.array(z.string()) });
const LeaderPrefsIn = z.object({ inPool: z.boolean().optional(), fixedVehicleId: z.string().nullable().optional() });
const OwnCarIn = z.object({ car: z.object({ name: z.string().trim().min(1).max(40), seats: z.number().int().min(2).max(15),
  plate: z.string().max(12).nullable().default(null), ...EndsFields }), riderIds: z.array(z.string()) });
const MoveIn = z.object({ runVehicleId: z.string().nullable() });
const LinkIn = z.object({ studentId: z.string().min(1) });
```

- [ ] **Step 1: Failing tests** — append to `src/tests/bus.service.test.ts`:

```ts
async function withFleet() {
  const t = await setup();
  const big = await t.svc.saveVehicle(t.ctx('admin'), { name: 'Big Bus', seats: 3, endsAt: 'church' });
  const v = await t.svc.getRun(t.ctx('admin'));
  const rvId = v.vehicles.find((x) => x.vehicleId === big.id)!.id;
  await t.svc.updateRunVehicle(t.ctx('admin'), rvId, { leaderIds: ['L1'] });
  const a = await t.svc.addRider(t.ctx('grade'), { studentId: 's1', newAddress: { address: '1 A St, Carina' } });
  const b = await t.svc.addRider(t.ctx('grade'), { studentId: 's2', newAddress: { address: '2 B St, Bulimba' } });
  const c = await t.svc.addRider(t.ctx('grade'), { studentId: 's3', newAddress: { address: '3 C St, Wynnum' } });
  return { ...t, rvId, a, b, c };
}

describe('vehicles + move', () => {
  it('a vehicle created after tonight\'s run exists is added to tonight', async () => {
    const t = await withFleet();
    const v = await t.svc.getRun(t.ctx('admin'));
    expect(v.vehicles[0]).toMatchObject({ name: 'Big Bus', capacity: 2, leaderNames: ['Tom'], eligibility: { male: true, female: false, unknown: false } });
  });
  it('move pins and appends; full car rejected with a readable message', async () => {
    const t = await withFleet();
    const m1 = await t.svc.moveRider(t.ctx('quad'), t.a.id, { runVehicleId: t.rvId });
    expect([m1.pinned, m1.stopOrder]).toEqual([true, 1]);
    const m2 = await t.svc.moveRider(t.ctx('quad'), t.b.id, { runVehicleId: t.rvId });
    expect(m2.stopOrder).toBe(2);
    await expect(t.svc.moveRider(t.ctx('quad'), t.c.id, { runVehicleId: t.rvId })).rejects.toThrow('Big Bus is full');
  });
  it('grade login cannot move; a self-identified coordinator can', async () => {
    const t = await withFleet();
    await expect(t.svc.moveRider(t.ctx('grade'), t.a.id, { runVehicleId: t.rvId })).rejects.toMatchObject({ statusCode: 403 });
    const s = await t.settings.getSettings();
    await t.settings.updateSettings({ ministryConfig: { ...s.ministryConfig, busMinistry: { ...s.ministryConfig.busMinistry, coordinatorLeaderIds: ['L2'] } } });
    await expect(t.svc.moveRider(t.ctx('grade', 'L2'), t.a.id, { runVehicleId: t.rvId })).resolves.toBeTruthy();
  });
});

describe('my car', () => {
  it('shows only my car with student mobiles; a vanished student shows no phone', async () => {
    const t = await withFleet();
    await t.svc.moveRider(t.ctx('admin'), t.a.id, { runVehicleId: t.rvId });
    await t.svc.moveRider(t.ctx('admin'), t.b.id, { runVehicleId: t.rvId });
    await t.students.delete('s2');
    const mine = await t.svc.myCar(t.ctx('grade', 'L1'));
    expect(mine.stops.map((s) => [s.name, s.mobile])).toEqual([['Jess Tran', '0412345678'], ['Sam Ode', null]]);
    const notMine = await t.svc.myCar(t.ctx('grade', 'L2'));
    expect(notMine.vehicle).toBeNull();
  });
  it('own car takes riders off the bus and pre-fills next week', async () => {
    const t = await withFleet();
    const own = await t.svc.saveOwnCar(t.ctx('grade', 'L2'), { car: { name: "Sarah's car", seats: 5, endsAt: 'address', endsAddress: '5 Home St, Manly' }, riderIds: [t.c.id] });
    expect(own.ownerLeaderId).toBe('L2');
    const v = await t.svc.getRun(t.ctx('admin'));
    expect(v.riders.find((r) => r.id === t.c.id)!.runVehicleId).toBe(own.id);
    const nextWeek = await t.svc.myCar(t.ctx('grade', 'L2', '2026-10-16T18:00'));
    expect(nextWeek.ownCarDraft!.car!.name).toBe("Sarah's car");
  });
});

describe('guest linking', () => {
  it('exactly one name match links and moves addresses; ambiguous ones become suggestions', async () => {
    const t = await setup();
    const g = await t.svc.createGuest(t.ctx('grade'), { firstName: 'Riley', lastName: 'Kim', grade: 10, gender: 'male', phone: '0400000000' });
    await t.svc.addRider(t.ctx('grade'), { guestId: g.id, newAddress: { label: 'Home', address: '3 C St, Wynnum' } });
    const g2 = await t.svc.createGuest(t.ctx('grade'), { firstName: 'Jessi', lastName: 'Tran', grade: 9, gender: 'female', phone: '0400000001' });
    await t.students.save(student('s4', 'Jessica', 'Tran', 9, 'female'));
    expect((await t.svc.linkGuestsAfterImport()).linked).toBe(1);   // Riley Kim ↔ s3
    expect((await t.bus.listAddresses({ studentId: 's3' }))[0]!.label).toBe('Home');
    const pending = await t.svc.pendingGuests(t.ctx('director'));
    expect(pending.map((p) => p.id)).toEqual([g2.id]);
    expect(pending[0]!.suggestions.map((s) => s.studentId).sort()).toEqual(['s1', 's4']);
  });
});

describe('history', () => {
  it('lists past runs for director only and keeps snapshots', async () => {
    const t = await withFleet();
    expect(await t.svc.listRuns(t.ctx('director', null, '2026-10-12T10:00'))).toHaveLength(1);
    await expect(t.svc.listRuns(t.ctx('quad'))).rejects.toMatchObject({ statusCode: 403 });
    const past = await t.svc.getPastRun(t.ctx('admin', null, '2026-10-12T10:00'), (await t.svc.getVersion(t.ctx('admin'))).runId);
    expect(past.run.readOnly).toBe(true);
    expect(past.riders).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run** — Expected: FAIL (methods missing).

- [ ] **Step 3: Implement** — add to `svc` in `bus.service.ts`:

```ts
    async saveVehicle(ctx, input) {
      const c = await gate(ctx, 'bus:coordinate');
      const v = SaveVehicle.parse(input);
      const prior = v.id ? await bus.getVehicle(v.id) : null;
      if (v.id && !prior) throw new NotFoundError('Vehicle not found');
      const saved = await bus.saveVehicle({ id: v.id ?? generateId(), name: v.name, plate: v.plate, seats: v.seats,
        prefGrades: v.prefGrades, endsAt: v.endsAt, endsAddress: v.endsAddress, endsPlaceId: v.endsPlaceId,
        sort: v.sort, archived: v.archived, createdAt: prior?.createdAt ?? nowIso(), updatedAt: nowIso() });
      // Keep tonight's run in step with the fleet (not past runs).
      const run = await ensureRun(ctx, c);
      if (!isPast(run, ctx, c)) {
        const rvs = await bus.listRunVehicles(run.id);
        const rv = rvs.find((x) => x.vehicleId === saved.id);
        if (rv && saved.archived) await bus.deleteRunVehicle(rv.id);
        else if (rv) await bus.saveRunVehicle({ ...rv, name: saved.name, seats: saved.seats, plate: saved.plate });
        else if (!saved.archived) await bus.saveRunVehicle({ id: generateId(), runId: run.id, vehicleId: saved.id, ownerLeaderId: null,
          name: saved.name, seats: saved.seats, plate: saved.plate, running: true, leaderIds: [], endsAt: saved.endsAt,
          endsAddress: saved.endsAddress, endsPlaceId: saved.endsPlaceId, colourIndex: rvs.length });
        await touch(ctx, run);
      }
      return saved;
    },
    async updateRunVehicle(ctx, id, input) {
      const c = await gate(ctx, 'bus:coordinate');
      const v = UpdateRunVehicle.parse(input);
      const run = await writableRun(ctx, c);
      const rv = (await bus.listRunVehicles(run.id)).find((x) => x.id === id);
      if (!rv) throw new NotFoundError('Car not found');
      await bus.saveRunVehicle({ ...rv, ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) } as BusRunVehicle);
      if (v.running === false) {
        for (const r of (await bus.listRunRiders(run.id)).filter((r) => r.runVehicleId === id))
          await bus.saveRunRider({ ...r, runVehicleId: null, stopOrder: null, pinned: false });
      }
      await touch(ctx, run);
      return (await vehicleViews(run.id)).find((x) => x.id === id)!;
    },
    async setPool(ctx, input) {
      const c = await gate(ctx, 'bus:coordinate');
      const v = SetPool.parse(input);
      const run = await writableRun(ctx, c);
      await bus.saveRun({ ...run, availablePoolLeaderIds: v.availableLeaderIds });
      await touch(ctx, run);
    },
    async setLeaderPrefs(ctx, leaderId, input) {
      const c = await gate(ctx, 'bus:coordinate');
      const v = LeaderPrefsIn.parse(input);
      if (!(await leaders.findById(leaderId))) throw new NotFoundError('Leader not found');
      const p = (await bus.getLeaderPrefs(leaderId)) ?? { id: leaderId, inPool: false, fixedVehicleId: null, ownCar: null, lastOwnRiderKeys: [] };
      await bus.saveLeaderPrefs({ ...p, ...(v.inPool !== undefined ? { inPool: v.inPool } : {}),
        ...(v.fixedVehicleId !== undefined ? { fixedVehicleId: v.fixedVehicleId } : {}) });
      await touch(ctx, await ensureRun(ctx, c));
    },
    async saveOwnCar(ctx, input) {
      const c = await gate(ctx, 'bus:use');
      const me = selfLeaderId(ctx);
      if (!me) throw new BadRequestError('Choose who you are first');
      const v = OwnCarIn.parse(input);
      const run = await writableRun(ctx, c);
      const rvs = await bus.listRunVehicles(run.id);
      const prior = rvs.find((x) => x.ownerLeaderId === me);
      const leader = await leaders.findById(me);
      const rv = await bus.saveRunVehicle({ id: prior?.id ?? generateId(), runId: run.id, vehicleId: null, ownerLeaderId: me,
        name: v.car.name, seats: v.car.seats, plate: v.car.plate, running: true, leaderIds: [me],
        endsAt: v.car.endsAt, endsAddress: v.car.endsAddress, endsPlaceId: v.car.endsPlaceId,
        colourIndex: prior?.colourIndex ?? rvs.length });
      if (v.riderIds.length > capacityOf(rv.seats, 1)) throw new BadRequestError(`${rv.name} only has ${capacityOf(rv.seats, 1)} seats`);
      const riders = await bus.listRunRiders(run.id);
      for (const r of riders.filter((r) => r.runVehicleId === rv.id && !v.riderIds.includes(r.id)))
        await bus.saveRunRider({ ...r, runVehicleId: null, stopOrder: null, pinned: false });
      for (const [i, id] of v.riderIds.entries()) {
        const r = riders.find((x) => x.id === id);
        if (!r) throw new NotFoundError('Rider not found');
        await bus.saveRunRider({ ...r, runVehicleId: rv.id, stopOrder: i + 1, pinned: true });
      }
      const prefs = (await bus.getLeaderPrefs(me)) ?? { id: me, inPool: false, fixedVehicleId: null, ownCar: null, lastOwnRiderKeys: [] };
      if (leader) await bus.saveLeaderPrefs({ ...prefs, ownCar: v.car as BusOwnCar,
        lastOwnRiderKeys: riders.filter((r) => v.riderIds.includes(r.id)).map(riderKey) });
      await touch(ctx, run);
      return (await vehicleViews(run.id)).find((x) => x.id === rv.id)!;
    },
    async removeOwnCar(ctx) {
      const c = await gate(ctx, 'bus:use');
      const me = selfLeaderId(ctx);
      const run = await writableRun(ctx, c);
      const rv = (await bus.listRunVehicles(run.id)).find((x) => x.ownerLeaderId === me);
      if (!rv) return;
      for (const r of (await bus.listRunRiders(run.id)).filter((r) => r.runVehicleId === rv.id))
        await bus.saveRunRider({ ...r, runVehicleId: null, stopOrder: null, pinned: false });
      await bus.deleteRunVehicle(rv.id);
      await touch(ctx, run);
    },
    async moveRider(ctx, riderId, input) {
      const c = await gate(ctx, 'bus:coordinate');
      const v = MoveIn.parse(input);
      const run = await writableRun(ctx, c);
      const r = await bus.getRunRider(riderId);
      if (!r || r.runId !== run.id) throw new NotFoundError('Rider not found');
      if (v.runVehicleId === null) {
        const saved = await bus.saveRunRider({ ...r, runVehicleId: null, stopOrder: null, pinned: true });
        await touch(ctx, run);
        return riderView(saved);
      }
      const rv = (await bus.listRunVehicles(run.id)).find((x) => x.id === v.runVehicleId && x.running);
      if (!rv) throw new NotFoundError('Car not found');
      const inCar = (await bus.listRunRiders(run.id)).filter((x) => x.runVehicleId === rv.id && x.id !== r.id);
      if (inCar.length >= capacityOf(rv.seats, rv.leaderIds.length)) throw new BadRequestError(`${rv.name} is full`);
      const maxStop = Math.max(0, ...inCar.map((x) => x.stopOrder ?? 0));
      const saved = await bus.saveRunRider({ ...r, runVehicleId: rv.id, stopOrder: maxStop + 1, pinned: true });
      await touch(ctx, run);
      return riderView(saved);
    },
    async myCar(ctx) {
      const c = await gate(ctx, 'bus:use');
      const me = selfLeaderId(ctx);
      const run = await ensureRun(ctx, c);
      const views = await vehicleViews(run.id);
      const vehicle = me ? views.find((v) => v.running && (v.ownerLeaderId === me || v.leaderIds.includes(me))) ?? null : null;
      const stops: MyCarView['stops'] = [];
      if (vehicle) {
        const mine = (await bus.listRunRiders(run.id)).filter((r) => r.runVehicleId === vehicle.id)
          .sort((a, b) => (a.stopOrder ?? 999) - (b.stopOrder ?? 999));
        for (const r of mine) {
          const mobile = r.studentId ? (await students.findById(r.studentId))?.mobile ?? null
            : r.guestId ? (await bus.getGuest(r.guestId))?.phone ?? null : null;
          stops.push({ ...riderView(r), mobile });
        }
      }
      let ownCarDraft: MyCarView['ownCarDraft'] = null;
      if (me && !vehicle) {
        const p = await bus.getLeaderPrefs(me);
        const tonight = await bus.listRunRiders(run.id);
        ownCarDraft = { car: p?.ownCar ?? null,
          riderIds: tonight.filter((r) => p?.lastOwnRiderKeys.includes(riderKey(r))).map((r) => r.id) };
      }
      return { vehicle, stops, churchAddress: c.busMinistry.churchAddress, ownCarDraft };
    },
    async pendingGuests(ctx) {
      await gate(ctx, 'bus:analysis');
      return pendingGuestList();
    },
    async linkGuest(ctx, guestId, input) {
      await gate(ctx, 'bus:analysis');
      const { studentId } = LinkIn.parse(input);
      await linkOne(guestId, studentId);
    },
    async dismissGuest(ctx, guestId) {
      await gate(ctx, 'bus:analysis');
      const g = await bus.getGuest(guestId);
      if (!g) throw new NotFoundError('Person not found');
      await bus.saveGuest({ ...g, dismissed: true });
    },
    async linkGuestsAfterImport() {
      const c = await cfg();
      if (!c.modules.busMinistry) return { linked: 0 };
      const all = await students.findAll();
      let linked = 0;
      for (const g of (await bus.listGuests()).filter((g) => !g.linkedStudentId)) {
        const matches = all.filter((s) => normName(s.firstName) === normName(g.firstName) && normName(s.lastName) === normName(g.lastName));
        if (matches.length === 1) { await linkOne(g.id, matches[0]!.id); linked++; }
      }
      return { linked };
    },
    async listRuns(ctx) {
      await gate(ctx, 'bus:analysis');
      const out = [];
      for (const r of await bus.listRuns()) {
        const [riders, cars] = await Promise.all([bus.listRunRiders(r.id), bus.listRunVehicles(r.id)]);
        out.push({ id: r.id, serviceDate: r.serviceDate, riders: riders.length, cars: cars.filter((v) => v.running).length });
      }
      return out;
    },
    async getPastRun(ctx, runId) {
      const c = await gate(ctx, 'bus:analysis');
      const run = await bus.getRun(runId);
      if (!run) throw new NotFoundError('Night not found');
      return buildView(ctx, c, run);
    },
```

and a helper inside `makeBusService`:

```ts
  async function linkOne(guestId: string, studentId: string): Promise<void> {
    const g = await bus.getGuest(guestId);
    if (!g) throw new NotFoundError('Person not found');
    if (!(await students.findById(studentId))) throw new NotFoundError('Student not found');
    await bus.reassignGuestAddresses(guestId, studentId);
    await bus.saveGuest({ ...g, linkedStudentId: studentId });
    // Tonight's (and any future) rider rows move to the student so phones/addresses resolve.
    for (const run of await bus.listRuns()) {
      for (const r of (await bus.listRunRiders(run.id)).filter((r) => r.guestId === guestId))
        await bus.saveRunRider({ ...r, studentId, guestId: null });
    }
  }
```

Also make `search` skip guests with `linkedStudentId` (already filtered) — no change.

- [ ] **Step 4: Import hook** — in `makeImportService`, add an optional last parameter `onImported?: () => Promise<unknown>`; at the end of both `importServiceCsv` and `importGroupCsv` (just before each `return { importId, … }`) add:

```ts
      if (onImported) await onImported().catch(() => undefined); // bus walk-in linking; never fails an import
```

In `container.ts`, build `busSvc` **before** `importService` and pass `() => busSvc.linkGuestsAfterImport()` as the new last argument.

- [ ] **Step 5: Run** `npm run typecheck && npx vitest run` — Expected: PASS (all suites, incl. existing import tests — the new param is optional).

- [ ] **Step 6: Commit** — `git commit -am "feat(bus): vehicles, pool, own cars, move, my car, guest linking, history"`

---

### Task 5: Controller, routes, edge routing, SW

**Files:**
- Create: `src/api/controllers/bus.controller.ts`
- Modify: `src/api/http/router.ts`, `vercel.json`, `public/sw.js`
- Test: `src/tests/bus.routes.test.ts`

**Interfaces:**
- Consumes: `BusService`, `BusCtx`.
- Produces: the HTTP contract the SPA uses. Every request carries `?now=YYYY-MM-DDTHH:mm` (phone local time) and optional `&as=<leaderId>` (self-identity). For POST/PATCH the same two values may come in the body as `now` / `as`; query wins.

- [ ] **Step 1: Failing test** — `src/tests/bus.routes.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildContainer } from '../container';
import { buildRoutes } from '../api/http/router';

describe('bus routes', () => {
  it('registers /bus routes, all authenticated', async () => {
    const { services } = await buildContainer();
    const bus = buildRoutes(services).filter((r) => r.path.startsWith('/bus'));
    expect(bus.length).toBeGreaterThanOrEqual(18);
    expect(bus.every((r) => r.auth)).toBe(true);
  });
  it('is reachable through vercel.json and bypasses the SW cache', () => {
    const root = join(__dirname, '..', '..');
    expect(readFileSync(join(root, 'vercel.json'), 'utf8')).toMatch(/[|(]bus[|)]/);
    expect(readFileSync(join(root, 'public', 'sw.js'), 'utf8')).toMatch(/API_RE = .*[|(]bus[|)]/);
  });
});
```

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Controller** — `src/api/controllers/bus.controller.ts`

```ts
import type { HttpRequest } from '../http/types';
import type { BusService, BusCtx } from '../../services/bus.service';
import { UnauthorizedError, BadRequestError } from '../../core/errors/app-error';

const NOW_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function ctxOf(req: HttpRequest): BusCtx {
  if (!req.ctx) throw new UnauthorizedError();
  const body = (req.body ?? {}) as Record<string, unknown>;
  const now = String(req.query['now'] ?? body['now'] ?? '');
  if (!NOW_RE.test(now)) throw new BadRequestError('Missing local time');
  const as = (req.query['as'] ?? body['as'] ?? null) as string | null;
  return { actor: req.ctx, asLeaderId: as || null, localNow: now.slice(0, 16) };
}

export function makeBusController(deps: { bus: BusService }) {
  const b = deps.bus;
  const p = (req: HttpRequest, k: string) => req.params[k]!;
  return {
    run: (r: HttpRequest) => b.getRun(ctxOf(r)),
    version: (r: HttpRequest) => b.getVersion(ctxOf(r)),
    search: (r: HttpRequest) => b.search(ctxOf(r), String(r.query['q'] ?? '')),
    addRider: (r: HttpRequest) => b.addRider(ctxOf(r), r.body),
    updateRider: (r: HttpRequest) => b.updateRider(ctxOf(r), p(r, 'id'), r.body),
    removeRider: async (r: HttpRequest) => { await b.removeRider(ctxOf(r), p(r, 'id')); return { ok: true }; },
    moveRider: (r: HttpRequest) => b.moveRider(ctxOf(r), p(r, 'id'), r.body),
    createGuest: (r: HttpRequest) => b.createGuest(ctxOf(r), r.body),
    pendingGuests: (r: HttpRequest) => b.pendingGuests(ctxOf(r)),
    linkGuest: async (r: HttpRequest) => { await b.linkGuest(ctxOf(r), p(r, 'id'), r.body); return { ok: true }; },
    dismissGuest: async (r: HttpRequest) => { await b.dismissGuest(ctxOf(r), p(r, 'id')); return { ok: true }; },
    saveVehicle: (r: HttpRequest) => b.saveVehicle(ctxOf(r), r.body),
    updateVehicle: (r: HttpRequest) => b.saveVehicle(ctxOf(r), { ...(r.body as object), id: p(r, 'id') }),
    updateRunVehicle: (r: HttpRequest) => b.updateRunVehicle(ctxOf(r), p(r, 'id'), r.body),
    setPool: async (r: HttpRequest) => { await b.setPool(ctxOf(r), r.body); return { ok: true }; },
    setLeaderPrefs: async (r: HttpRequest) => { await b.setLeaderPrefs(ctxOf(r), p(r, 'leaderId'), r.body); return { ok: true }; },
    saveOwnCar: (r: HttpRequest) => b.saveOwnCar(ctxOf(r), r.body),
    removeOwnCar: async (r: HttpRequest) => { await b.removeOwnCar(ctxOf(r)); return { ok: true }; },
    myCar: (r: HttpRequest) => b.myCar(ctxOf(r)),
    runs: (r: HttpRequest) => b.listRuns(ctxOf(r)),
    pastRun: (r: HttpRequest) => b.getPastRun(ctxOf(r), p(r, 'id')),
  };
}
```

- [ ] **Step 4: Routes** — in `router.ts` construct `const busCtl = makeBusController({ bus: services.bus });` and add (static paths before param paths):

```ts
    // ----- Bus Ministry -----
    { method: 'GET',    path: '/bus/run',                  auth: true, handler: (r) => busCtl.run(r) },
    { method: 'GET',    path: '/bus/run/version',          auth: true, handler: (r) => busCtl.version(r) },
    { method: 'PATCH',  path: '/bus/run/pool',             auth: true, handler: (r) => busCtl.setPool(r) },
    { method: 'POST',   path: '/bus/run/own-car',          auth: true, handler: (r) => busCtl.saveOwnCar(r) },
    { method: 'DELETE', path: '/bus/run/own-car',          auth: true, handler: (r) => busCtl.removeOwnCar(r) },
    { method: 'PATCH',  path: '/bus/run/vehicles/:id',     auth: true, handler: (r) => busCtl.updateRunVehicle(r) },
    { method: 'GET',    path: '/bus/search',               auth: true, handler: (r) => busCtl.search(r) },
    { method: 'GET',    path: '/bus/my-car',               auth: true, handler: (r) => busCtl.myCar(r) },
    { method: 'POST',   path: '/bus/riders',               auth: true, handler: (r) => busCtl.addRider(r) },
    { method: 'PATCH',  path: '/bus/riders/:id',           auth: true, handler: (r) => busCtl.updateRider(r) },
    { method: 'DELETE', path: '/bus/riders/:id',           auth: true, handler: (r) => busCtl.removeRider(r) },
    { method: 'POST',   path: '/bus/riders/:id/move',      auth: true, handler: (r) => busCtl.moveRider(r) },
    { method: 'POST',   path: '/bus/guests',               auth: true, handler: (r) => busCtl.createGuest(r) },
    { method: 'GET',    path: '/bus/guests/pending',       auth: true, handler: (r) => busCtl.pendingGuests(r) },
    { method: 'POST',   path: '/bus/guests/:id/link',      auth: true, handler: (r) => busCtl.linkGuest(r) },
    { method: 'POST',   path: '/bus/guests/:id/dismiss',   auth: true, handler: (r) => busCtl.dismissGuest(r) },
    { method: 'POST',   path: '/bus/vehicles',             auth: true, handler: (r) => busCtl.saveVehicle(r) },
    { method: 'PATCH',  path: '/bus/vehicles/:id',         auth: true, handler: (r) => busCtl.updateVehicle(r) },
    { method: 'PATCH',  path: '/bus/leader-prefs/:leaderId', auth: true, handler: (r) => busCtl.setLeaderPrefs(r) },
    { method: 'GET',    path: '/bus/runs',                 auth: true, handler: (r) => busCtl.runs(r) },
    { method: 'GET',    path: '/bus/runs/:id',             auth: true, handler: (r) => busCtl.pastRun(r) },
```

- [ ] **Step 5: Edge + SW** — `vercel.json` regex: insert `|bus` after `prayers` (`…|batch|prayers|bus)`). `public/sw.js`: `API_RE` add `bus|` after `prayers|`; bump `CACHE` (e.g. `ysc-v56` → `ysc-v57`; use the current value + 1).

- [ ] **Step 6: Run** `npm run typecheck && npx vitest run` — Expected: PASS.

- [ ] **Step 7: Commit** — `git commit -am "feat(bus): /bus API routes + vercel/SW routing"`

---

### Task 6: SPA — shell, Home tile, Roster, New Person, Youth Setup toggle, Bus settings

**Files:**
- Modify: `public/index.html` (new delimited block `/* ── BUS MODULE ── */ … /* ── END BUS MODULE ── */` placed after the Prayers code; small hooks elsewhere marked `/*BUS-HOOK*/`)
- Test: `src/tests/spa-bus.test.ts`

Read first: mockup sections `home-tile`, `roster`, `roster-empty`, `add-sheet`, `newrider-sheet` (grep `data-section=` in `_design/bus-ministry-mockup.html` and copy CSS rules prefixed `bus-`/`.car-pill`/`.radio-row` into the main `<style>`, renamed with a `bus-` prefix if they clash).

**Interfaces:**
- Consumes: HTTP contract from Task 5.
- Produces (used by Task 7): `BUS` state object, `_busQs()`, `_busGet(path)`, `_busSend(method, path, body)`, `busRefresh()`, `renderBus()`, `_busTab`, `_busSuburb(addr)`, `_busCarColour(i)`, `_busPoll` lifecycle, `_busOn()`.

- [ ] **Step 1: Failing test** — `src/tests/spa-bus.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml } from './helpers/extract-fn';

describe('SPA bus helpers', () => {
  it('_busLocalNow formats phone local time', () => {
    const { _busLocalNow } = loadFns(['_busLocalNow']);
    expect(_busLocalNow(new Date(2026, 9, 9, 19, 5))).toBe('2026-10-09T19:05');
  });
  it('_busSuburb mirrors the server helper', () => {
    const { _busSuburb } = loadFns(['_busSuburb']);
    expect(_busSuburb('24 Wynnum Rd, Carina QLD 4152, Australia')).toBe('Carina');
  });
  it('module hooks exist and no emoji were introduced', () => {
    const html = loadIndexHtml();
    expect(html).toContain('/* ── BUS MODULE ── */');
    const block = html.slice(html.indexOf('/* ── BUS MODULE ── */'), html.indexOf('/* ── END BUS MODULE ── */'));
    expect(/\p{Extended_Pictographic}/u.test(block)).toBe(false);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/tests/spa-bus.test.ts` — Expected: FAIL.

- [ ] **Step 3: Core helpers** (inside the BUS MODULE block)

```js
/* ── BUS MODULE ── */
const BUS = { view: null, version: -1, tab: 'roster', search: '', hits: [], pollTimer: null };
const BUS_CAR_COLOURS = ['#2563eb', '#db2777', '#059669', '#7c3aed', '#ea580c', '#0891b2', '#ca8a04', '#be123c'];
function _busCarColour(i) { return BUS_CAR_COLOURS[(i || 0) % BUS_CAR_COLOURS.length]; }
function _busOn() {
  const mc = (S.settings && S.settings.ministryConfig) || {};
  const on = !!(mc.modules && mc.modules.busMinistry);
  const vis = (mc.busMinistry && mc.busMinistry.visibility) || 'admin';
  return on && (vis === 'all' || (S.user && S.user.role === 'admin'));
}
function _busLocalNow(d) {
  d = d || new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function _busQs(extra) {
  const as = getMyLeaderId();
  return `now=${encodeURIComponent(_busLocalNow())}${as ? '&as=' + encodeURIComponent(as) : ''}${extra ? '&' + extra : ''}`;
}
function _busSuburb(address) {
  const parts = String(address || '').split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return String(address || '').trim();
  return parts[1].replace(/\s+[A-Z]{2,3}\s+\d{4}$/, '').trim();
}
async function _busGet(path, extra) { return API.fresh(path + '?' + _busQs(extra)); }
async function _busSend(method, path, body) {
  const url = path + '?' + _busQs();
  const res = method === 'POST' ? await API.post(url, body || {}) : method === 'PATCH' ? await API.patch(url, body || {}) : await API.del(url);
  await busRefresh();
  return res;
}
async function busRefresh() {
  try { BUS.view = await _busGet('/bus/run'); BUS.version = BUS.view.run.version; }
  catch (e) { toast(e.message || 'Bus Ministry unavailable'); }
  if (S.page === 'bus') renderBus();
}
function _busStartPoll() {
  _busStopPoll();
  BUS.pollTimer = setInterval(async () => {
    if (S.page !== 'bus' || document.hidden || document.getElementById('mo-overlay')) return;
    try { const v = await _busGet('/bus/run/version'); if (v.version !== BUS.version) busRefresh(); } catch {}
  }, 10000);
}
function _busStopPoll() { if (BUS.pollTimer) clearInterval(BUS.pollTimer); BUS.pollTimer = null; }
```

Add to the `API` object (near `del:`): `fresh: (p) => r('GET', p),` — an uncached GET (bus data must never come from the 30 s cache).

- [ ] **Step 4: Icons** — add to `const IC = {`: `bus`, `phone`, `pin`, `map`, `route`, `pinned`, `kebab` — copy the exact path strings from the mockup's `IC` object (`grep -n "bus:\|phone:\|pin:\|map:\|route:\|pinned:\|kebab:" _design/bus-ministry-mockup.html`).

- [ ] **Step 5: Routing + nav hooks**
  - `render()` dispatch: add `bus: renderBus` (follow the existing table/switch style) and `/*BUS-HOOK*/ if (S.page !== 'bus') _busStopPoll();` at the top of `render()`.
  - If a non-allowed user lands on `bus` (`!_busOn()`), `go('home')`.
  - Home: in `renderHome()` (and `renderLeaderHome`) right after the hero card markup insert `/*BUS-HOOK*/ ${_busHomeTile()}`.
  - Logout: clear `BUS.view = null; _busStopPoll();` next to the other filter resets.

```js
function _busHomeTile() {
  if (!_busOn()) return '';
  const v = BUS.view;
  const count = v ? `${v.riders.length} riders · ${v.vehicles.filter((x) => x.running).length} cars` : '';
  if (!v) busRefresh(); // warm in background; re-render of Home not needed
  return `<div class="bus-tile" onclick="go('bus')" role="button" tabindex="0">
    <div class="bt-ic">${icN('bus')}</div><div class="bt-label">${esc(L('busMinistry'))}</div>
    <div class="bt-count">${esc(count)}</div></div>`;
}
```

(Ensure `L()` falls back to `'Bus Ministry'`: add `busMinistry: 'Bus Ministry'` to the client labels defaults object `MINISTRY_CONFIG_DEFAULTS_CLIENT.labels`, and `busMinistry: false` to its `modules`, plus a `busMinistry` block mirroring Task 1's defaults.)

- [ ] **Step 6: Screen shell + Roster**

```js
async function renderBus() {
  if (!_busOn()) { go('home'); return; }
  if (!BUS.view) { setApp(''); await busRefresh(); return; }
  _busStartPoll();
  const v = BUS.view, u = S.user;
  const canRoster = u.role !== 'leader' || v.canCoordinate;
  const tabs = [
    canRoster && { id: 'roster', label: 'Tonight' },
    v.canCoordinate && { id: 'cars', label: 'Car setup' },
    v.canCoordinate && { id: 'routes', label: 'Routes' },
    { id: 'mycar', label: 'My car' },
  ].filter(Boolean);
  if (!tabs.some((t) => t.id === BUS.tab)) BUS.tab = tabs[0].id;
  const d = new Date(v.run.serviceDate + 'T00:00:00');
  const date = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const isAdmin = u.role === 'admin', seesPast = u.role === 'admin' || u.role === 'director';
  const last = v.run.lastChangeBy ? `Last change: ${esc(v.run.lastChangeBy)} · ${new Date(v.run.lastChangeAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '';
  const body = { roster: _busRosterHtml, cars: _busCarsHtml, routes: _busRoutesHtml, mycar: _busMyCarHtml }[BUS.tab]();
  setApp(`<div class="pg">
    <div class="bus-head"><div><div class="pt">${esc(L('busMinistry'))}</div><div class="bus-sub">${esc(date)}${v.run.readOnly ? ' · finished' : ''}</div></div>
      <div class="bus-head-act">${seesPast ? `<button class="btn btn-secondary btn-sm" onclick="busPast()">Past</button>` : ''}
        ${isAdmin ? `<button class="btn-icon" aria-label="Bus settings" onclick="busSettings()">${icN('settings')}</button>` : ''}</div></div>
    <div class="tbbar">${tabs.map((t) => `<button class="tbbtn ${BUS.tab === t.id ? 'on' : ''}" onclick="BUS.tab='${t.id}';renderBus()">${t.label}</button>`).join('')}</div>
    ${last ? `<div class="bus-last">${last}</div>` : ''}
    ${body}</div>`);
}

function _busRosterHtml() {
  const v = BUS.view;
  const placed = (r) => v.vehicles.find((x) => x.id === r.runVehicleId);
  const rows = v.riders.slice().sort((a, b) => a.name.localeCompare(b.name)).map((r) => {
    const car = placed(r);
    return `<div class="li">
      <div class="li-body" onclick="busEditRider('${r.id}')"><div class="li-title">${esc(r.name)} ${r.grade ? `<span class="chip c-neutral">Y${r.grade}</span>` : ''} ${r.gender === 'female' ? icS('genderF') : r.gender === 'male' ? icS('genderM') : ''}</div>
        <div class="li-sub">${esc(_busSuburb(r.address))}</div></div>
      ${car ? `<span class="car-pill" style="--c:${_busCarColour(car.colourIndex)}">${esc(car.name)}</span>` : ''}
      ${v.run.readOnly ? '' : `<button class="btn-icon bus-danger" aria-label="Remove ${esc(r.name)}" onclick="busConfirmRemove('${r.id}')">${icS('trash')}</button>`}
    </div>`;
  }).join('');
  const seats = v.vehicles.filter((x) => x.running).reduce((n, x) => n + x.capacity, 0);
  return `${v.run.readOnly ? '' : `<div class="sbar"><span class="si">${icS('search')}</span>
      <input id="bus-q" placeholder="Search any student" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"
        value="${esc(BUS.search)}" oninput="busSearch(this.value)"></div><div id="bus-hits">${_busHitsHtml()}</div>`}
    <div class="card-title bus-sec">Tonight (${v.riders.length})</div>
    ${rows || `<div class="empty">${icEmpty('bus')}<div>No one yet. Search above to add someone.</div></div>`}
    <div class="bus-foot">${v.riders.length} riders · ${seats} youth seats</div>`;
}

let _busSearchT = null;
function busSearch(q) {
  BUS.search = q;
  clearTimeout(_busSearchT);
  _busSearchT = setTimeout(async () => {
    BUS.hits = q.trim().length < 2 ? [] : await _busGet('/bus/search', 'q=' + encodeURIComponent(q)).catch(() => []);
    const el = document.getElementById('bus-hits'); if (el) el.innerHTML = _busHitsHtml();
  }, 250);
}
function _busHitsHtml() {
  if (BUS.search.trim().length < 2) return '';
  const rows = BUS.hits.map((h, i) => `<div class="li" onclick="busPick(${i})"><div class="li-body"><div class="li-title">${esc(h.name)} ${h.grade ? `<span class="chip c-neutral">Y${h.grade}</span>` : ''}</div></div>${icS('chevr')}</div>`).join('');
  return `<div class="card bus-hits">${rows}
    <div class="li" onclick="busNewPerson()"><div class="li-body"><div class="li-title">${icS('plus')} New Person: "${esc(BUS.search.trim())}"</div></div></div></div>`;
}
```

- [ ] **Step 7: Add / edit sheets + New Person**

```js
function _busAddressPicker(addresses) {
  const saved = addresses.map((a, i) => `<label class="radio-row"><input type="radio" name="bus-addr" value="${a.id}" ${i === 0 ? 'checked' : ''}>
      <span>${esc(a.label || 'Saved')} · ${esc(_busSuburb(a.address))}</span></label>`).join('');
  return `${saved}<label class="radio-row"><input type="radio" name="bus-addr" value="new" ${addresses.length ? '' : 'checked'}><span>New address</span></label>
    <div class="fg"><input class="fi" id="bus-addr-text" placeholder="Street address, suburb" autocomplete="off">
      <input class="fi" id="bus-addr-label" placeholder="Label, e.g. Mum's" style="margin-top:8px"></div>`;
}
function _busReadAddress() {
  const pick = (document.querySelector('input[name="bus-addr"]:checked') || {}).value;
  if (pick && pick !== 'new') return { addressId: pick };
  const address = document.getElementById('bus-addr-text').value.trim();
  if (address.length < 3) { toast('Enter an address'); return null; }
  return { newAddress: { label: document.getElementById('bus-addr-label').value.trim(), address, placeId: null } };
}
function busPick(i) {
  const h = BUS.hits[i];
  modal(`<div class="mo-title">${esc(h.name)}${h.grade ? ` · Y${h.grade}` : ''}</div>${_busAddressPicker(h.addresses)}
    <button class="btn btn-primary btn-full" onclick="busAdd(${i})">Add</button>`);
}
async function busAdd(i) {
  const h = BUS.hits[i], a = _busReadAddress(); if (!a) return;
  try {
    await _busSend('POST', '/bus/riders', { ...(h.kind === 'student' ? { studentId: h.id } : { guestId: h.id }), ...a });
    closeModal(); BUS.search = ''; BUS.hits = []; toast(`${h.name} added`); renderBus();
  } catch (e) { toast(e.message); }
}
function busNewPerson() {
  const parts = BUS.search.trim().split(/\s+/);
  const grades = (typeof _gradeList === 'function' ? _gradeList() : [7, 8, 9, 10, 11, 12]);
  modal(`<div class="mo-title">New Person</div>
    <div class="fg"><input class="fi" id="np-first" placeholder="First name" value="${esc(parts[0] || '')}"></div>
    <div class="fg"><input class="fi" id="np-last" placeholder="Last name" value="${esc(parts.slice(1).join(' '))}"></div>
    <div class="fg"><select class="fs" id="np-grade"><option value="">Grade</option>${grades.map((g) => `<option value="${g}">${esc(_gradeWord())} ${g}</option>`).join('')}</select></div>
    <div class="fg bus-gender" id="np-gender">
      <button type="button" class="btn btn-secondary" onclick="busPickGender(this,'female')">${icS('genderF')} Girl</button>
      <button type="button" class="btn btn-secondary" onclick="busPickGender(this,'male')">${icS('genderM')} Boy</button></div>
    <div class="fg"><input class="fi" id="np-phone" type="tel" placeholder="Mobile"></div>
    ${_busAddressPicker([])}
    <button class="btn btn-primary btn-full" onclick="busSaveNewPerson()">Add</button>`);
}
let _busNpGender = null;
function busPickGender(btn, g) {
  _busNpGender = g;
  btn.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('btn-primary', b === btn));
}
async function busSaveNewPerson() {
  const firstName = document.getElementById('np-first').value.trim(), lastName = document.getElementById('np-last').value.trim();
  const gradeV = document.getElementById('np-grade').value, phone = document.getElementById('np-phone').value.trim();
  if (!firstName || !lastName || !_busNpGender || phone.length < 6) { toast('Name, gender and mobile are needed'); return; }
  const a = _busReadAddress(); if (!a) return;
  try {
    const g = await API.post('/bus/guests?' + _busQs(), { firstName, lastName, grade: gradeV ? Number(gradeV) : null, gender: _busNpGender, phone });
    await _busSend('POST', '/bus/riders', { guestId: g.id, ...a });
    _busNpGender = null; closeModal(); BUS.search = ''; BUS.hits = []; toast(`${firstName} added`); renderBus();
  } catch (e) { toast(e.message); }
}
async function busEditRider(id) {
  const r = BUS.view.riders.find((x) => x.id === id); if (!r || BUS.view.run.readOnly) return;
  const hits = await _busGet('/bus/search', 'q=' + encodeURIComponent(r.name)).catch(() => []);
  const me = hits.find((h) => h.id === (r.studentId || r.guestId));
  modal(`<div class="mo-title">${esc(r.name)}</div>${_busAddressPicker(me ? me.addresses : [])}
    <button class="btn btn-primary btn-full" onclick="busSaveRider('${id}')">Save</button>`);
}
async function busSaveRider(id) {
  const a = _busReadAddress(); if (!a) return;
  try { await _busSend('PATCH', '/bus/riders/' + id, a); closeModal(); } catch (e) { toast(e.message); }
}
function busConfirmRemove(id) {
  const r = BUS.view.riders.find((x) => x.id === id);
  modal(`<div class="mo-title">Remove ${esc(r.name)} from tonight?</div>
    <div class="mo-actions"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-danger" onclick="busRemove('${id}')">Remove</button></div>`);
}
async function busRemove(id) { try { await _busSend('DELETE', '/bus/riders/' + id); closeModal(); } catch (e) { toast(e.message); } }
```

(If `_gradeList`/`_gradeWord` have different names, grep `function _gradeList\|function _gradeWord` and use the real ones — both are documented in CLAUDE.md.)

- [ ] **Step 8: Youth Setup + Bus settings**
  - Youth Setup → Modules card: next to the Connection Audit checkbox add (same markup pattern) a `Bus Ministry` checkbox bound to `_setupSet('modules.busMinistry', this.checked)` with `helpTip("Plan drop-home car runs after your service. Off by default.")`.
  - Terminology card: add a `labels.busMinistry` text field the same way the other labels are rendered.
  - Bus settings sheet (admin; `busSettings()`), saving via the existing `PATCH /settings` with `{ ministryConfig: { busMinistry: {...} } }` then `S.settings = ...` refresh exactly as the Setup wizard does:

```js
function busSettings() {
  const b = (S.settings.ministryConfig.busMinistry) || {};
  const leaders = BUS.view.leaders;
  modal(`<div class="mo-title">Bus settings</div>
    <label class="fl">Who can see it</label>
    <select class="fs" id="bs-vis"><option value="admin" ${b.visibility !== 'all' ? 'selected' : ''}>Admin only (testing)</option><option value="all" ${b.visibility === 'all' ? 'selected' : ''}>Everyone</option></select>
    <label class="fl">Church address</label><input class="fi" id="bs-church" value="${esc(b.churchAddress || '')}" placeholder="Street address, suburb">
    <label class="fl">Bus coordinators ${helpTip("Leaders who can set up cars and move riders from any login, once they've picked who they are.")}</label>
    <div class="bus-checks">${leaders.map((l) => `<label class="cbx-row"><input type="checkbox" value="${l.id}" ${(b.coordinatorLeaderIds || []).includes(l.id) ? 'checked' : ''}> ${esc(l.name)}</label>`).join('')}</div>
    <button class="btn btn-primary btn-full" onclick="busSaveSettings()">Save</button>`);
}
async function busSaveSettings() {
  const coordinatorLeaderIds = [...document.querySelectorAll('.bus-checks input:checked')].map((i) => i.value);
  const patch = { ministryConfig: { busMinistry: { visibility: document.getElementById('bs-vis').value,
    churchAddress: document.getElementById('bs-church').value.trim(), coordinatorLeaderIds } } };
  try { S.settings = await API.patch('/settings', patch); Cache.clear(); closeModal(); toast('Saved'); busRefresh(); }
  catch (e) { toast(e.message); }
}
```

(Verify `PATCH /settings` returns the updated settings object — grep `async update` in `settings.service.ts`; if it returns something else, re-fetch with `API.fresh('/settings')`.)

- [ ] **Step 9: CSS** — add to the main `<style>`: `.bus-tile`, `.bt-ic`, `.bt-label`, `.bt-count`, `.bus-head`, `.bus-head-act`, `.bus-sub`, `.bus-last`, `.bus-sec`, `.bus-foot`, `.bus-hits`, `.car-pill` (`background:color-mix(in srgb,var(--c) 14%,transparent);color:var(--c);` + `.chip` sizing), `.bus-danger{color:var(--danger)}`, `.radio-row`, `.cbx-row`, `.bus-gender{display:flex;gap:8px}` — copy values from the mockup's `<style>`. Tap targets: `.btn-icon{min-width:44px;min-height:44px}` only inside `.pg` bus screens if the global rule differs. Landscape: under the existing `@media (max-height:500px)` rule add `.bus-tile{padding-block:4px}`.

- [ ] **Step 10: Verify** — `node scripts/check-spa-syntax.js && npm run typecheck && npx vitest run`. Then `npm run dev`, log in as `admin` (`demo1234`), enable the module in Youth Setup, open Bus Ministry, add Jess with a new address, add a New Person, remove someone. Check at 375px wide, landscape phone and ≥768px.

- [ ] **Step 11: Commit** — `git commit -am "feat(bus): SPA shell, Home tile, roster, New Person, settings"`

---

### Task 7: SPA — Car setup, Routes (manual), My car (+ own car), New people card, Past nights

**Files:**
- Modify: `public/index.html` (BUS MODULE block + the Home hook for the New people card)
- Test: `src/tests/spa-bus.test.ts` (append)

Read first: mockup sections `cars`, `vehicle-sheet`, `routes`, `routes-unplaced` (or whatever the "Generate routes" first-run frame is named — grep the section map), `move-sheet`, `mycar`, `mycar-own`, `admin-newpeople`.

**Interfaces:**
- Consumes: Task 6 helpers (`BUS`, `_busSend`, `_busGet`, `_busCarColour`, `_busSuburb`, `busRefresh`).
- Produces: `_busCarsHtml`, `_busRoutesHtml`, `_busMyCarHtml`, `_busMapsLinks(stops, church, endAddress)`, `busPast`, `_busNewPeopleCard()`.

- [ ] **Step 1: Failing tests** — append:

```js
describe('maps links', () => {
  it('one link up to 9 stops; split above; ends follow the car', () => {
    const { _busMapsLinks } = loadFns(['_busMapsLinks']);
    const stops = Array.from({ length: 11 }, (_, i) => ({ address: `${i + 1} A St, Carina`, placeId: null }));
    const links = _busMapsLinks(stops, '1 Church Rd, Carindale', { endsAt: 'church' });
    expect(links.map((l) => l.label)).toEqual(['Stops 1–9', 'Stops 10–11']);
    expect(links[0].url).toContain('origin=1%20Church%20Rd');
    expect(links[1].url).toContain('destination=1%20Church%20Rd');
    const one = _busMapsLinks(stops.slice(0, 3), '1 Church Rd', { endsAt: 'last_drop' });
    expect(one).toHaveLength(1);
    expect(one[0].label).toBe('Start in Google Maps');
    expect(one[0].url).toContain('destination=3%20A%20St');
  });
});
```

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Maps link builder**

```js
function _busMapsLinks(stops, church, car) {
  const enc = encodeURIComponent;
  const end = car.endsAt === 'address' && car.endsAddress ? car.endsAddress : car.endsAt === 'church' ? church : null;
  const chunks = [];
  for (let i = 0; i < stops.length; i += 9) chunks.push(stops.slice(i, i + 9));
  return chunks.map((chunk, ci) => {
    const isLast = ci === chunks.length - 1;
    const origin = ci === 0 ? church : chunks[ci - 1][chunks[ci - 1].length - 1].address;
    const dest = isLast ? (end || chunk[chunk.length - 1].address) : chunk[chunk.length - 1].address;
    const wps = (isLast && !end) ? chunk.slice(0, -1) : isLast ? chunk : chunk.slice(0, -1);
    let url = `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${enc(origin)}&destination=${enc(dest)}`;
    if (wps.length) url += `&waypoints=${enc(wps.map((s) => s.address).join('|'))}`;
    const ids = wps.map((s) => s.placeId || '');
    if (ids.every(Boolean) && ids.length) url += `&waypoint_place_ids=${enc(ids.join('|'))}`;
    const from = ci * 9 + 1, to = ci * 9 + chunk.length;
    return { label: chunks.length === 1 ? 'Start in Google Maps' : `Stops ${from}–${to}`, url };
  });
}
```

- [ ] **Step 4: Car setup** (`_busCarsHtml`) — per mockup `cars`: one card per run vehicle with `vehicleId` (fleet): running checkbox (`busRunVeh(id,{running:this.checked})`), name, plate, `${seats} seats · ${leaderIds.length} leaders · ${capacity} for youth`, eligibility line (`icS('genderF')`/`icS('genderM')`; amber `c-warn` chip with `icS('alert')` "Leader gender unknown" when `eligibility.unknown`), amber "Needs 1 more leader" chip when running and `leaderIds.length < 2`, leader chips, Ends at text (`Church` / `Last drop` / suburb of address; "tonight only" accent chip when it differs from the fleet vehicle's), edit button → `busEditVehicle(vehicleId)`. Below: **Leader pool — available tonight**: a `cbx-row` per leader with `inPool` true (gender icon + name) bound to `busSetPool()`; a small "Edit pool" link opening a sheet listing all leaders with in-pool toggles (`PATCH /bus/leader-prefs/:id {inPool}`). Then **Own cars tonight** (read-only rows for run vehicles with `ownerLeaderId`). Then `+ Add vehicle` → `busEditVehicle(null)`.

```js
async function busRunVeh(id, patch) { try { await _busSend('PATCH', '/bus/run/vehicles/' + id, patch); } catch (e) { toast(e.message); } }
async function busSetPool() {
  const ids = [...document.querySelectorAll('.bus-pool input:checked')].map((i) => i.value);
  try { await _busSend('PATCH', '/bus/run/pool', { availableLeaderIds: ids }); } catch (e) { toast(e.message); }
}
function _busEndsAtField(prefix, endsAt, endsAddress, tonightOnly) {
  return `<label class="fl">Ends at</label>
    <select class="fs" id="${prefix}-ends" onchange="document.getElementById('${prefix}-ends-addr').hidden=this.value!=='address'">
      <option value="church" ${endsAt === 'church' ? 'selected' : ''}>Church</option>
      <option value="last_drop" ${endsAt === 'last_drop' ? 'selected' : ''}>Last drop</option>
      <option value="address" ${endsAt === 'address' ? 'selected' : ''}>Address</option></select>
    <input class="fi" id="${prefix}-ends-addr" placeholder="Street address, suburb" value="${esc(endsAddress || '')}" ${endsAt === 'address' ? '' : 'hidden'}>
    ${tonightOnly === undefined ? '' : `<label class="cbx-row"><input type="checkbox" id="${prefix}-tonight"> Tonight only</label>`}`;
}
function busEditVehicle(vehicleId) {
  const v = BUS.view, f = vehicleId ? v.fleet.find((x) => x.id === vehicleId) : { name: '', plate: '', seats: 8, prefGrades: [], endsAt: 'church', endsAddress: '' };
  const rv = vehicleId ? v.vehicles.find((x) => x.vehicleId === vehicleId) : null;
  const grades = (typeof _gradeList === 'function' ? _gradeList() : [7, 8, 9, 10, 11, 12]);
  modal(`<div class="mo-title">${vehicleId ? 'Edit vehicle' : 'Add vehicle'}</div>
    <div class="fg"><input class="fi" id="ve-name" placeholder="Name" value="${esc(f.name)}"></div>
    <div class="fg" style="display:flex;gap:8px"><input class="fi" id="ve-plate" placeholder="Plate" value="${esc(f.plate || '')}">
      <input class="fi" id="ve-seats" type="number" min="1" max="60" value="${f.seats}" aria-label="Seats"></div>
    <label class="fl">Preferred grades</label>
    <div class="bus-checks" id="ve-grades">${grades.map((g) => `<label class="cbx-row"><input type="checkbox" value="${g}" ${f.prefGrades.includes(g) ? 'checked' : ''}> Y${g}</label>`).join('')}</div>
    <label class="fl">Fixed leaders</label>
    <div class="bus-checks" id="ve-leaders">${v.leaders.map((l) => `<label class="cbx-row"><input type="checkbox" value="${l.id}" ${l.fixedVehicleId && l.fixedVehicleId === vehicleId ? 'checked' : ''}> ${l.gender === 'female' ? icS('genderF') : l.gender === 'male' ? icS('genderM') : ''} ${esc(l.name)}</label>`).join('')}</div>
    ${_busEndsAtField('ve', f.endsAt, f.endsAddress, rv ? false : undefined)}
    <button class="btn btn-primary btn-full" onclick="busSaveVehicle(${vehicleId ? `'${vehicleId}'` : 'null'})">Save</button>
    ${vehicleId ? `<button class="btn btn-ghost btn-full bus-danger" onclick="busArchiveVehicle('${vehicleId}')">Archive vehicle</button>` : ''}`);
}
async function busSaveVehicle(vehicleId) {
  const val = (id) => document.getElementById(id).value;
  const endsAt = val('ve-ends'), endsAddress = endsAt === 'address' ? val('ve-ends-addr').trim() : null;
  const tonight = document.getElementById('ve-tonight'), tonightOnly = !!(tonight && tonight.checked);
  const fixed = [...document.querySelectorAll('#ve-leaders input')];
  const prefGrades = [...document.querySelectorAll('#ve-grades input:checked')].map((i) => Number(i.value));
  try {
    const f = vehicleId ? BUS.view.fleet.find((x) => x.id === vehicleId) : null;
    const base = { name: val('ve-name').trim(), plate: val('ve-plate').trim() || null, seats: Number(val('ve-seats')), prefGrades };
    const saved = await API[vehicleId ? 'patch' : 'post']((vehicleId ? '/bus/vehicles/' + vehicleId : '/bus/vehicles') + '?' + _busQs(),
      tonightOnly && f ? { ...base, endsAt: f.endsAt, endsAddress: f.endsAddress } : { ...base, endsAt, endsAddress });
    for (const cb of fixed) {
      const l = BUS.view.leaders.find((x) => x.id === cb.value);
      const want = cb.checked ? saved.id : (l.fixedVehicleId === saved.id ? null : l.fixedVehicleId);
      if (want !== l.fixedVehicleId) await API.patch('/bus/leader-prefs/' + l.id + '?' + _busQs(), { fixedVehicleId: want });
    }
    await busRefresh();
    const rv = BUS.view.vehicles.find((x) => x.vehicleId === saved.id);
    if (rv) {
      const leaderIds = [...new Set([...rv.leaderIds, ...fixed.filter((c) => c.checked).map((c) => c.value)])];
      await _busSend('PATCH', '/bus/run/vehicles/' + rv.id, tonightOnly ? { endsAt, endsAddress, leaderIds } : { leaderIds });
    }
    closeModal(); toast('Saved');
  } catch (e) { toast(e.message); }
}
async function busArchiveVehicle(id) {
  const f = BUS.view.fleet.find((x) => x.id === id);
  try { await API.patch('/bus/vehicles/' + id + '?' + _busQs(), { ...f, archived: true }); closeModal(); busRefresh(); } catch (e) { toast(e.message); }
}
```

Tonight's leaders on a car (beyond fixed ones) are edited from the car card's leader chips: tapping the leader row opens a checklist sheet of all leaders → `busRunVeh(id, { leaderIds })`. Write `busEditCarLeaders(runVehicleId)` in the same style as `busEditVehicle` (checkbox list of `v.leaders`, pre-checked from `rv.leaderIds`, Save → `busRunVeh`).

- [ ] **Step 5: Routes (manual)** (`_busRoutesHtml`) — per mockup `routes`: no Generate button in Release 1 (Release 2 adds it at the top). **Unassigned (N)** `.drop` card open by default, header amber (`c-warn` chip with count) while N>0, "All placed" with `icS('check')` at 0; rows: name, Y chip, suburb, `Move` (`btn-secondary btn-sm`). Then one `.drop` card per running vehicle: header `<span class="car-dot" style="background:${_busCarColour(rv.colourIndex)}">` + `${name} · ${n}/${capacity}` + leader chips; body = riders sorted by `stopOrder`: stop number, name, suburb, `icS('pinned')` when pinned, tap → `busMoveSheet(riderId)`. At ≥768px the car cards sit in a grid: `.bus-routes{display:grid;gap:12px} @media(min-width:768px){.bus-routes{grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}}`.

```js
function busMoveSheet(riderId) {
  const v = BUS.view, r = v.riders.find((x) => x.id === riderId);
  const rows = v.vehicles.filter((x) => x.running).map((x) => {
    const n = v.riders.filter((y) => y.runVehicleId === x.id && y.id !== riderId).length, left = x.capacity - n;
    const genderOk = !r.gender || x.eligibility[r.gender];
    const why = left <= 0 ? 'full' : !genderOk ? (r.gender === 'female' ? 'Boys only' : 'Girls only') : `${left} left`;
    return `<button class="li bus-move" ${left <= 0 ? 'disabled' : ''} onclick="busMove('${riderId}','${x.id}')">
      <span class="car-dot" style="background:${_busCarColour(x.colourIndex)}"></span><span class="li-body">${esc(x.name)}</span>
      <span class="chip ${!genderOk && left > 0 ? 'c-warn' : 'c-neutral'}">${why}</span></button>`;
  }).join('');
  modal(`<div class="mo-title">Move ${esc(r.name)} to…</div>${rows}
    <button class="li bus-move" onclick="busMove('${riderId}',null)"><span class="li-body">Unassigned</span></button>`);
}
async function busMove(riderId, runVehicleId) {
  try { await _busSend('POST', '/bus/riders/' + riderId + '/move', { runVehicleId }); closeModal(); } catch (e) { toast(e.message); }
}
```

(Choosing a gender-mismatched car is allowed — strong preference, not a rule; the chip warns.)

- [ ] **Step 6: My car** (`_busMyCarHtml`, async data via `/bus/my-car`) — cache the response in `BUS.myCar`, fetched in `busRefresh()` alongside `/bus/run` (`Promise.all`). Layout per mockup `mycar`:
  - Leader identity row: `I am: <name> · Not you?` reusing the existing leader-picker pattern (`getMyLeaderId()`/`setMyLeaderId()`; grep how My Students renders its picker and reuse that function if one exists). If no identity: show the picker only.
  - If `vehicle`: card `name · plate`, `with <other leader names>`, the links from `_busMapsLinks(stops, churchAddress, vehicle)` as primary buttons (`<a class="btn btn-primary btn-full" href="…" target="_blank" rel="noopener">${icS('map')} label</a>`), then stops: number, name, suburb; tapping a row toggles a detail line with the full street address; right side `phoneLink(stop.mobile, firstName)` (existing helper → Call/Message sheet) when mobile present. If `churchAddress` is empty show an amber note "Set the church address in Bus settings" (admin) instead of the Maps buttons.
  - If no vehicle and `ownCarDraft`: card "Driving your own car?" → `busOwnCarSheet()`; if the leader already has an own car tonight it IS `vehicle` (ownerLeaderId === me) → also show "Remove my car" (`DELETE /bus/run/own-car`, confirm).

```js
function busOwnCarSheet() {
  const d = BUS.myCar.ownCarDraft || { car: null, riderIds: [] }, car = d.car || { name: '', seats: 5, plate: '', endsAt: 'address', endsAddress: '' };
  const unplaced = BUS.view.riders.filter((r) => !r.runVehicleId || d.riderIds.includes(r.id));
  modal(`<div class="mo-title">Your car</div>
    <div class="fg"><input class="fi" id="oc-name" placeholder="e.g. Josh's car" value="${esc(car.name)}"></div>
    <div class="fg" style="display:flex;gap:8px"><input class="fi" id="oc-seats" type="number" min="2" max="15" value="${car.seats}" aria-label="Seats">
      <input class="fi" id="oc-plate" placeholder="Plate" value="${esc(car.plate || '')}"></div>
    ${_busEndsAtField('oc', car.endsAt, car.endsAddress)}
    <label class="fl">Who you're taking</label>
    <div class="bus-checks" id="oc-riders">${unplaced.map((r) => `<label class="cbx-row"><input type="checkbox" value="${r.id}" ${d.riderIds.includes(r.id) ? 'checked' : ''}> ${esc(r.name)} · ${esc(_busSuburb(r.address))}</label>`).join('') || '<div class="card-sub">No one waiting for a car.</div>'}</div>
    <div class="card-sub">These riders come off the bus routes.</div>
    <button class="btn btn-primary btn-full" onclick="busSaveOwnCar()">Save</button>`);
}
async function busSaveOwnCar() {
  const val = (id) => document.getElementById(id).value;
  const endsAt = val('oc-ends');
  const body = { car: { name: val('oc-name').trim(), seats: Number(val('oc-seats')), plate: val('oc-plate').trim() || null,
    endsAt, endsAddress: endsAt === 'address' ? val('oc-ends-addr').trim() : null, endsPlaceId: null },
    riderIds: [...document.querySelectorAll('#oc-riders input:checked')].map((i) => i.value) };
  try { await _busSend('POST', '/bus/run/own-car', body); closeModal(); toast('Saved'); } catch (e) { toast(e.message); }
}
```

- [ ] **Step 7: New people card + Past nights**
  - `_busNewPeopleCard()` — admin/director only, when `BUS.view && BUS.view.pendingNewPeople > 0`: fetch `/bus/guests/pending` lazily (cache in `BUS.pending`), render per mockup `admin-newpeople`: title "New people from Bus Ministry" + amber count chip; rows: name, Y grade, `phoneLink(phone)`, "added <d Mon>"; suggestion line `Is this <name> (Y<grade>)? [Yes] [No]` → Yes = `POST /bus/guests/:id/link {studentId}`, No = hide that suggestion client-side; no suggestions → "Clears when imported or after 28 days" + `Dismiss` (`POST /bus/guests/:id/dismiss`). Insert via `/*BUS-HOOK*/ ${_busNewPeopleCard()}` directly under `_busHomeTile()` on Home.
  - `busPast()` — modal listing `/bus/runs` (`date · N riders · N cars`); tapping one loads `/bus/runs/:id` and renders a read-only Routes-style list (car cards with leader names and stops) in the same modal.

- [ ] **Step 8: Verify** — `node scripts/check-spa-syntax.js && npm run typecheck && npx vitest run`. Manual (`npm run dev`, admin): add a vehicle with 2 fixed leaders, untick another, add 4 riders, move them into cars (try a full car), open My car after picking a leader identity (Maps buttons, phone action sheet), add an own car as a different leader, check the New people card after adding a walk-in, open Past (change the phone clock or temporarily pass a later `now` in the console: `_busLocalNow = () => '2026-12-31T10:00'`). Check 375px portrait, landscape, ≥768px (routes grid).

- [ ] **Step 9: Commit** — `git commit -am "feat(bus): Car setup, manual routes, My car + own cars, new people, past nights"`

---

### Task 8: Parent consent + drop-off record (spec §10a)

**Files:**
- Create: `supabase/migrations/0012_bus_consent.sql`
- Modify: `src/core/entities/bus.ts`, `src/repositories/interfaces/entity-repositories.ts`, `src/repositories/in-memory/in-memory.bus.ts`, `src/repositories/supabase/supabase.bus.ts`, `src/services/bus.service.ts`, `src/api/controllers/bus.controller.ts`, `src/api/http/router.ts`, `public/index.html`
- Test: `src/tests/bus.service.test.ts` (append), `src/tests/supabase.bus.mapper.test.ts` (append)

**Interfaces:**
- Produces:

```ts
// bus.ts
export interface BusConsent { id: ID; studentId: ID | null; guestId: ID | null; given: boolean; note: string; recordedBy: string; recordedAt: ISODateString }
// BusRunRider gains:   droppedAt: ISODateString | null; droppedBy: string | null;
// BusRiderView gains:  consent: { given: boolean; note: string; recordedBy: string; recordedAt: string } | null;
//                      droppedAt: string | null; droppedBy: string | null;
// IBusRepository gains:
  listConsents(): Promise<BusConsent[]>;
  getConsent(owner: { studentId?: string; guestId?: string }): Promise<BusConsent | null>;
  saveConsent(c: BusConsent): Promise<BusConsent>;
  reassignGuestConsent(guestId: string, studentId: string): Promise<void>; // only if the student has none; else drop the guest's
// BusService gains:
  setConsent(ctx: BusCtx, riderId: string, input: unknown): Promise<BusRiderView>; // { given: boolean, note: string }
  setDropped(ctx: BusCtx, riderId: string, input: unknown): Promise<BusRiderView>; // { dropped: boolean, at?: ISO string }
```

- [ ] **Step 1: Failing tests** — append to `src/tests/bus.service.test.ts`:

```ts
describe('parent consent', () => {
  it('starts as not yet, persists to next week, and follows a linked walk-in', async () => {
    const t = await setup();
    const r = await t.svc.addRider(t.ctx('grade'), { studentId: 's1', newAddress: { address: '1 A St, Carina' } });
    expect((await t.svc.getRun(t.ctx('admin'))).riders[0]!.consent).toBeNull();
    await expect(t.svc.setConsent(t.ctx('grade'), r.id, { given: true, note: '' })).rejects.toThrow();
    const v = await t.svc.setConsent(t.ctx('grade', 'L2'), r.id, { given: true, note: 'Mum (Lisa) 7:10pm by text' });
    expect(v.consent).toMatchObject({ given: true, note: 'Mum (Lisa) 7:10pm by text', recordedBy: 'Sarah' });
    await t.svc.addRider(t.ctx('grade', null, '2026-10-16T19:00'), { studentId: 's1', newAddress: { address: '1 A St, Carina' } });
    const next = await t.svc.getRun(t.ctx('admin', null, '2026-10-16T19:00'));
    expect(next.riders[0]!.consent!.given).toBe(true);
    await expect(t.svc.setConsent(t.ctx('leader'), r.id, { given: false, note: '' })).rejects.toMatchObject({ statusCode: 403 });
  });
  it('a walk-in\'s consent moves to the student on link', async () => {
    const t = await setup();
    const g = await t.svc.createGuest(t.ctx('grade'), { firstName: 'Riley', lastName: 'Kim', grade: 10, gender: 'male', phone: '0400000000' });
    const r = await t.svc.addRider(t.ctx('grade'), { guestId: g.id, newAddress: { address: '3 C St, Wynnum' } });
    await t.svc.setConsent(t.ctx('grade'), r.id, { given: true, note: 'Dad, call 7pm' });
    await t.svc.linkGuestsAfterImport();
    expect((await t.bus.getConsent({ studentId: 's3' }))!.note).toBe('Dad, call 7pm');
  });
});

describe('drop-off record', () => {
  it('car leaders tick with a time, can edit and clear it; others cannot', async () => {
    const t = await withFleet();
    await t.svc.moveRider(t.ctx('admin'), t.a.id, { runVehicleId: t.rvId });
    const d = await t.svc.setDropped(t.ctx('grade', 'L1'), t.a.id, { dropped: true });
    expect(d.droppedAt).not.toBeNull();
    expect(d.droppedBy).toBe('Tom');
    const e = await t.svc.setDropped(t.ctx('grade', 'L1'), t.a.id, { dropped: true, at: '2026-10-09T11:42:00.000Z' });
    expect(e.droppedAt).toBe('2026-10-09T11:42:00.000Z');
    await expect(t.svc.setDropped(t.ctx('grade', 'L2'), t.a.id, { dropped: true })).rejects.toMatchObject({ statusCode: 403 });
    expect((await t.svc.setDropped(t.ctx('quad'), t.a.id, { dropped: false })).droppedAt).toBeNull();
  });
});
```

Append to `src/tests/supabase.bus.mapper.test.ts`:

```ts
it('consent notes use their own AAD', () => {
  const ct = busCrypt.enc('Mum, text 7pm', 'bus_consents:note:c1');
  expect(busCrypt.dec(ct, 'bus_consents:note:c1')).toBe('Mum, text 7pm');
});
```

- [ ] **Step 2: Run** `npx vitest run src/tests/bus.service.test.ts` — Expected: FAIL.

- [ ] **Step 3: Migration** — `supabase/migrations/0012_bus_consent.sql`:

```sql
-- Parent consent is per person and lasts until revoked (spec §10a). Cascades with the
-- student/guest (a Full Reset therefore clears it, as it does saved addresses).
create table if not exists bus_consents (
  id uuid primary key,
  student_id uuid unique references students(id) on delete cascade,
  guest_id uuid unique references bus_guests(id) on delete cascade,
  given boolean not null default false,
  note text,                  -- encrypted
  recorded_by text not null default '',
  recorded_at timestamptz not null default now(),
  check (student_id is not null or guest_id is not null)
);
alter table bus_consents enable row level security;
alter table bus_run_riders add column if not exists dropped_at timestamptz;
alter table bus_run_riders add column if not exists dropped_by text;
```

- [ ] **Step 4: Entities + repos** — add the types above. `BusRunRider` gains `droppedAt`/`droppedBy` (set `null` everywhere a rider is created: `addRider` in the service). In-memory: add `private consents = new Map<string, BusConsent>()` and

```ts
  async listConsents() { return [...this.consents.values()].map(c); }
  async getConsent(o: { studentId?: string; guestId?: string }) {
    const x = [...this.consents.values()].find((k) => (o.studentId ? k.studentId === o.studentId : k.guestId === o.guestId));
    return x ? c(x) : null;
  }
  async saveConsent(k: BusConsent) { this.consents.set(k.id, c(k)); return c(k); }
  async reassignGuestConsent(guestId: string, studentId: string) {
    const g = [...this.consents.values()].find((k) => k.guestId === guestId);
    if (!g) return;
    if ([...this.consents.values()].some((k) => k.studentId === studentId)) { this.consents.delete(g.id); return; }
    g.guestId = null; g.studentId = studentId;
  }
```

(and `deleteGuest` also deletes that guest's consent). Supabase: `toRider` adds `droppedAt: iso(r.dropped_at), droppedBy: r.dropped_by ?? null`; `saveRunRider` inserts/updates `dropped_at`, `dropped_by`; plus

```ts
function toConsent(r: Record<string, any>): BusConsent {
  return { id: r.id, studentId: r.student_id ?? null, guestId: r.guest_id ?? null, given: r.given,
    note: busCrypt.dec(r.note, `bus_consents:note:${r.id}`) ?? '', recordedBy: r.recorded_by, recordedAt: toIso(r.recorded_at) };
}
  async listConsents() { return (await this.sql`select * from bus_consents`).map(toConsent); }
  async getConsent(o: { studentId?: string; guestId?: string }) {
    const r = o.studentId ? await this.sql`select * from bus_consents where student_id = ${o.studentId}`
      : await this.sql`select * from bus_consents where guest_id = ${o.guestId ?? null}`;
    return r[0] ? toConsent(r[0]) : null;
  }
  async saveConsent(k: BusConsent) {
    const r = await this.sql`
      insert into bus_consents (id, student_id, guest_id, given, note, recorded_by, recorded_at)
      values (${k.id}, ${k.studentId}, ${k.guestId}, ${k.given}, ${busCrypt.enc(k.note, `bus_consents:note:${k.id}`)}, ${k.recordedBy}, ${k.recordedAt})
      on conflict (id) do update set given = excluded.given, note = excluded.note, recorded_by = excluded.recorded_by, recorded_at = excluded.recorded_at
      returning *`;
    return toConsent(r[0]!);
  }
  async reassignGuestConsent(guestId: string, studentId: string) {
    const has = await this.sql`select 1 from bus_consents where student_id = ${studentId}`;
    if (has.length) await this.sql`delete from bus_consents where guest_id = ${guestId}`;
    else await this.sql`update bus_consents set student_id = ${studentId}, guest_id = null where guest_id = ${guestId}`;
  }
```

- [ ] **Step 5: Service** — `riderView(r, consent?)` adds `consent: consent ? { given, note, recordedBy, recordedAt } : null, droppedAt: r.droppedAt, droppedBy: r.droppedBy`. In `buildView` and `myCar`, load `bus.listConsents()` once and look up by `studentId`/`guestId`. `linkOne` also calls `bus.reassignGuestConsent(guestId, studentId)`. New methods:

```ts
const ConsentIn = z.object({ given: z.boolean(), note: z.string().trim().max(300) })
  .refine((v) => !v.given || v.note.length > 0, 'Add a short note: when, who, call or text');
const DroppedIn = z.object({ dropped: z.boolean(), at: z.string().datetime().optional() });

    async setConsent(ctx, riderId, input) {
      const c = await gate(ctx, 'bus:roster');
      const v = ConsentIn.parse(input);
      const run = await writableRun(ctx, c);
      const r = await bus.getRunRider(riderId);
      if (!r || r.runId !== run.id) throw new NotFoundError('Rider not found');
      const owner = r.studentId ? { studentId: r.studentId } : { guestId: r.guestId! };
      const prior = await bus.getConsent(owner);
      const saved = await bus.saveConsent({ id: prior?.id ?? generateId(), studentId: r.studentId, guestId: r.studentId ? null : r.guestId,
        given: v.given, note: v.note, recordedBy: await whoLabel(ctx), recordedAt: nowIso() });
      await touch(ctx, run);
      return riderView(r, saved);
    },
    async setDropped(ctx, riderId, input) {
      const c = await gate(ctx, 'bus:use');
      const v = DroppedIn.parse(input);
      const run = await writableRun(ctx, c);
      const r = await bus.getRunRider(riderId);
      if (!r || r.runId !== run.id) throw new NotFoundError('Rider not found');
      const rv = (await bus.listRunVehicles(run.id)).find((x) => x.id === r.runVehicleId);
      const me = selfLeaderId(ctx);
      const inMyCar = !!rv && !!me && (rv.ownerLeaderId === me || rv.leaderIds.includes(me));
      if (!inMyCar && !allowed(ctx, c, 'bus:coordinate')) throw new ForbiddenError('Only this car\'s leaders can mark drop-offs');
      const saved = await bus.saveRunRider({ ...r, droppedAt: v.dropped ? (v.at ?? nowIso()) : null,
        droppedBy: v.dropped ? await whoLabel(ctx) : null });
      await touch(ctx, run);
      return riderView(saved, await bus.getConsent(r.studentId ? { studentId: r.studentId } : { guestId: r.guestId! }));
    },
```

- [ ] **Step 6: Routes** — controller: `setConsent: (r) => b.setConsent(ctxOf(r), p(r, 'id'), r.body)`, `setDropped: (r) => b.setDropped(ctxOf(r), p(r, 'id'), r.body)`; router: `POST /bus/riders/:id/consent`, `POST /bus/riders/:id/dropped`.

- [ ] **Step 7: SPA**
  - Chip helper: `function _busConsentChip(r) { return r.consent && r.consent.given ? '' : `<span class="chip c-warn">${icS('alert')} Consent: not yet</span>`; }` — render it on Tonight rows, Routes rows and My car stops (inside the `li-sub` line, so rows stay one tap target).
  - `busEditRider(id)` sheet: above the address picker, a consent box:

```js
function _busConsentBox(r) {
  const c = r.consent || { given: false, note: '' };
  return `<div class="card bus-consent">
    <label class="cbx-row"><input type="checkbox" id="bc-given" ${c.given ? 'checked' : ''}> Parent consent given</label>
    <textarea class="fi" id="bc-note" rows="2" maxlength="300" placeholder="When, who, call or text — e.g. Mum (Lisa), 7:10pm, text">${esc(c.note)}</textarea>
    ${r.consent ? `<div class="card-sub">${esc(r.consent.recordedBy)} · ${esc(new Date(r.consent.recordedAt).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))}</div>` : ''}
    <button class="btn btn-secondary btn-sm" onclick="busSaveConsent('${r.id}')">Save consent</button></div>`;
}
async function busSaveConsent(id) {
  const given = document.getElementById('bc-given').checked, note = document.getElementById('bc-note').value.trim();
  if (given && !note) { toast('Add when, who, and call or text'); return; }
  try { await _busSend('POST', '/bus/riders/' + id + '/consent', { given, note }); toast('Consent saved'); closeModal(); } catch (e) { toast(e.message); }
}
```

  - My car stop row: right of the name a `Dropped off` checkbox (`cbx-row`, 44px target). Ticked → `POST …/dropped {dropped:true}`; when ticked show the time as a small button (`7:42pm`) that opens a sheet with `<input type="time">` prefilled → save sends `{dropped:true, at}` (combine `BUS.view.run.serviceDate`… careful: after midnight the drop is the next calendar day — build `at` from today's local date if the chosen time is earlier than 06:00, else the run date). Unticking sends `{dropped:false}`.

```js
function _busDropAtIso(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(BUS.view.run.serviceDate + 'T00:00:00');
  if (h < 6) d.setDate(d.getDate() + 1);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}
```

  Add a test for `_busDropAtIso` in `spa-bus.test.ts` (`loadFns(['_busDropAtIso'], "const BUS = { view: { run: { serviceDate: '2026-10-09' } } };")` → `'00:30'` gives a date on 2026-10-10 local; `'21:15'` gives 2026-10-09 local — assert via `new Date(iso).getDate()`).
  - Past nights view: show `dropped 9:42pm` beside each stop when present.

- [ ] **Step 8: Verify** — `node scripts/check-spa-syntax.js && npm run typecheck && npx vitest run`; manual: add a rider → amber chip → open → tick consent without note (blocked) → with note (chip gone) → next week (change `_busLocalNow` in console) still given; My car tick drop-off, edit time, untick.

- [ ] **Step 9: Commit** — `git add -A supabase/migrations/0012_bus_consent.sql src public/index.html && git commit -m "feat(bus): parent consent + drop-off record"`

---

## Self-review notes (done while writing)

- Spec coverage for Release 1: module toggle/visibility (T1, T3, T6), roster + saved addresses (T3, T6), walk-ins + linking + 28-day purge + dismiss (T3, T4, T7), Car setup incl. fixed leaders, pool availability, Ends at + tonight-only (T4, T7), Move with pins + capacity (T4, T7), My car + own cars + pre-fill (T4, T7), history + Past (T4, T7), version poll + last change (T3, T6), RBAC incl. coordinators (T1, T3), encryption (T2), Full Reset survival (T1 migration comment + no FKs), routing allowlists (T5). Generate/Undo/lock/Places/analysis → Release 2/3 plans.
- Spec deltas made explicit here: `snap_gender`/`snap_place_id` columns added (needed by R2 penalties/Maps); the New people card renders on **Home** for admin/director (directors have no Admin screen); time-zone handling uses the phone's local time (`?now=`) so no ministry-specific time zone is configured.
