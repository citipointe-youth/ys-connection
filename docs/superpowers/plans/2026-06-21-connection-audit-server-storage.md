# Connection Audit — Server Storage & Multi-Term Viewing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Connection Audit's data from per-browser `localStorage` to the server as a self-contained, year-keyed snapshot, so an admin/director uploads the full year-to-date data and any director/admin can log in and view it — with auto-derived terms the viewer can swap between, plus a year-to-date multi-term view.

**Architecture:** Each audit is a **self-contained snapshot**: it carries its own YTD service + group attendance CSVs (so it does not depend on the live platform's current data, which only retains two terms). On upload the server runs the *same* term/aggregate engine the live importer uses, derives terms from valid-service gaps, and stores one frozen `jsonb` snapshot per calendar year (re-upload overwrites that year). The live platform is untouched. The frontend CA module's data adapter swaps from live endpoints to the selected audit snapshot and gains a year picker + term/YTD selector.

**Tech Stack:** TypeScript (strict, ESM, extensionless imports), Express (declarative route table), `postgres` driver on Supabase (Sydney), Zod validation inside services, Vitest, vanilla-JS inline SPA (`public/index.html`).

## Global Constraints

- **Roles:** No new role. Upload and view are gated to **director/admin** via the existing `import:run` capability (`access-control.ts` grants `import:run` to `director` and `admin` only). Copy verbatim: `assertCan(actor, 'import:run')`.
- **Data assumption:** Audit uploads are **always year-to-date** for one calendar year. Previous years are uploaded as separate audits.
- **Retention model:** **One audit row per calendar year**; re-uploading a year overwrites it (no snapshot history).
- **Term derivation:** Terms are **auto-derived from gaps between valid services** (`> settings.termGapDays`, default 14), Monday-bucketed — never hard-coded calendar quarters. Term labels: `Term <ordinal> <year>`, key `<year>-T<ordinal>`, ordinal counted within the uploaded year's data.
- **Modularity:** Keep the CA module contract — frontend changes stay inside the `/* ── CA MODULE … ── */` block + `/*CA-HOOK*/` lines; new backend lives in clearly-named `connection-audit` files removable as a unit.
- **Strict TS:** `strict` + `noUncheckedIndexedAccess` + `noImplicitOverride`. No `.js` extensions on imports.
- **Naming guard:** The existing `audit`/`IAuditRepository`/`admin_audit` names are the **admin change-log** — do NOT reuse them. This feature uses `connectionAudit` / `IConnectionAuditRepository` / `connection_audits` / route `/audits`.
- **Verification:** `npm run typecheck` and `npm run test` (vitest) must pass. Frontend has no test framework — verify manually in the browser per CLAUDE.md.

---

## File Structure

**Create:**
- `src/core/entities/connection-audit.ts` — `ConnectionAudit` entity + snapshot types.
- `src/services/year-terms.ts` — pure `computeAllTerms()` (N labelled terms).
- `src/services/year-aggregates.ts` — pure `computeYearAggregates()` (per-term student aggregates).
- `src/services/attendance-build.ts` — pure CSV→sessions/attendance/weeks builders, extracted from the importer (shared by importer + audit).
- `src/services/connection-audit.service.ts` — upload/list/get/delete; runs the compute, RBAC.
- `src/api/controllers/connection-audit.controller.ts` — thin controller.
- `src/tests/year-terms.test.ts`, `src/tests/year-aggregates.test.ts`, `src/tests/connection-audit.service.test.ts` — vitest.
- `supabase/migrations/009_connection_audits.sql` — the table.

**Modify:**
- `src/services/import.service.ts` — call the extracted `attendance-build.ts` (no behaviour change).
- `src/repositories/interfaces/entity-repositories.ts` — add `IConnectionAuditRepository`.
- `src/repositories/in-memory/in-memory.repositories.ts` — add `InMemoryConnectionAuditRepository`.
- `src/repositories/supabase/supabase.connection-audit.ts` (Create) + `src/repositories/supabase/index.ts` — `SupabaseConnectionAuditRepository`.
- `src/container.ts` — wire repo + service.
- `src/api/http/router.ts` — add `/audits` routes.
- `vercel.json` — add `audits` to the API route regex.
- `public/index.html` — CA module: upload slots for service/group, swap `load()` to the audit snapshot, year picker + term/YTD selector, term-scoped model.

**Phasing:** Phase 1 (Tasks 1–3) is the pure engine. Phase 2 (Tasks 4–9) is storage + API. Phase 3 (Tasks 10–13) is the frontend. Phases 1–2 produce a fully testable backend on their own; Phase 3 can be executed as a follow-on. If splitting into two plans is preferred, cut between Task 9 and Task 10.

---

## Phase 1 — Pure term & aggregate engine

### Task 1: `computeAllTerms` — N labelled terms

**Files:**
- Create: `src/services/year-terms.ts`
- Test: `src/tests/year-terms.test.ts`

**Interfaces:**
- Consumes: nothing (pure). Reuses the gap rule from `src/services/terms.ts` but returns **all** terms, not just current/previous.
- Produces:
  ```ts
  export interface LabeledTerm {
    key: string;       // '2026-T2'
    label: string;     // 'Term 2 2026'
    year: number;      // 2026
    ordinal: number;   // 1-based within its calendar year
    startDate: string; // inclusive ISO YYYY-MM-DD
    endDate: string;   // inclusive ISO YYYY-MM-DD
  }
  export function computeAllTerms(dates: string[], termGapDays: number): LabeledTerm[];
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/tests/year-terms.test.ts
import { describe, it, expect } from 'vitest';
import { computeAllTerms } from '../services/year-terms';

describe('computeAllTerms', () => {
  it('returns empty for no dates', () => {
    expect(computeAllTerms([], 14)).toEqual([]);
  });

  it('groups one continuous run as a single term', () => {
    const t = computeAllTerms(['2026-02-06', '2026-02-13', '2026-02-20'], 14);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ key: '2026-T1', label: 'Term 1 2026', year: 2026, ordinal: 1, startDate: '2026-02-06', endDate: '2026-02-20' });
  });

  it('splits on a gap greater than termGapDays and increments ordinal within the year', () => {
    // Two runs separated by ~5 weeks (a holiday break)
    const t = computeAllTerms(['2026-02-06', '2026-02-13', '2026-04-24', '2026-05-01'], 14);
    expect(t).toHaveLength(2);
    expect(t[0]!.key).toBe('2026-T1');
    expect(t[1]!.key).toBe('2026-T2');
    expect(t[1]!.startDate).toBe('2026-04-24');
  });

  it('resets ordinal per calendar year across a year boundary', () => {
    const t = computeAllTerms(['2025-10-31', '2025-11-07', '2026-02-06', '2026-02-13'], 14);
    expect(t.map((x) => x.key)).toEqual(['2025-T1', '2026-T1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/year-terms.test.ts`
Expected: FAIL — "Cannot find module '../services/year-terms'".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/services/year-terms.ts
const MS_PER_DAY = 86_400_000;

export interface LabeledTerm {
  key: string;
  label: string;
  year: number;
  ordinal: number;
  startDate: string;
  endDate: string;
}

// All terms in chronological order. A term boundary is a gap > termGapDays
// between consecutive sorted dates (same rule as terms.ts), but every run is
// returned and labelled, not just the last two. Pass Monday-bucketed dates in
// for week-aligned boundaries (callers already do this).
export function computeAllTerms(dates: string[], termGapDays: number): LabeledTerm[] {
  const uniq = [...new Set(dates.filter(Boolean))].sort();
  if (uniq.length === 0) return [];

  const startIdxs: number[] = [0];
  for (let i = 1; i < uniq.length; i++) {
    const prev = Date.parse(uniq[i - 1]! + 'T00:00:00Z');
    const cur = Date.parse(uniq[i]! + 'T00:00:00Z');
    if ((cur - prev) / MS_PER_DAY > termGapDays) startIdxs.push(i);
  }

  const perYear = new Map<number, number>();
  return startIdxs.map((s, k) => {
    const e = (k + 1 < startIdxs.length ? startIdxs[k + 1]! : uniq.length) - 1;
    const startDate = uniq[s]!;
    const endDate = uniq[e]!;
    const year = Number(startDate.slice(0, 4));
    const ordinal = (perYear.get(year) ?? 0) + 1;
    perYear.set(year, ordinal);
    return { key: `${year}-T${ordinal}`, label: `Term ${ordinal} ${year}`, year, ordinal, startDate, endDate };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tests/year-terms.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/year-terms.ts src/tests/year-terms.test.ts
git commit -m "feat: computeAllTerms — N labelled terms for year audit"
```

---

### Task 2: `computeYearAggregates` — per-term student aggregates

**Files:**
- Create: `src/services/year-aggregates.ts`
- Test: `src/tests/year-aggregates.test.ts`

**Interfaces:**
- Consumes: `computeAllTerms` (Task 1); `AggregateInput` from `src/services/aggregates.ts` (already exported — `{ termGapDays, serviceSessions: {id,date,valid}[], serviceAttendance: {studentId,sessionId,attended}[], weekStartById: Map<string,string>, lifegroupAttendance: {studentId,weekId,attended}[] }`); `mondayOf` from `src/services/terms.ts`.
- Produces:
  ```ts
  export interface YearStudentAggregate { svcAttended: number; grpAttended: number; grpTotal: number; }
  export interface YearTermResult { key: string; svcTotal: number; byStudent: Map<string, YearStudentAggregate>; }
  export interface YearAggregateResult { terms: LabeledTerm[]; perTerm: Map<string, YearTermResult>; }
  export function computeYearAggregates(input: AggregateInput): YearAggregateResult;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/tests/year-aggregates.test.ts
import { describe, it, expect } from 'vitest';
import { computeYearAggregates } from '../services/year-aggregates';
import type { AggregateInput } from '../services/aggregates';

function input(): AggregateInput {
  return {
    termGapDays: 14,
    serviceSessions: [
      { id: 's1', date: '2026-02-06', valid: true },  // T1
      { id: 's2', date: '2026-02-13', valid: true },  // T1
      { id: 's3', date: '2026-04-24', valid: true },  // T2 (after a gap)
    ],
    serviceAttendance: [
      { studentId: 'a', sessionId: 's1', attended: true },
      { studentId: 'a', sessionId: 's3', attended: true },
      { studentId: 'b', sessionId: 's1', attended: true },
    ],
    weekStartById: new Map(),
    lifegroupAttendance: [],
  };
}

describe('computeYearAggregates', () => {
  it('buckets each session and attendance into its own term', () => {
    const r = computeYearAggregates(input());
    expect(r.terms.map((t) => t.key)).toEqual(['2026-T1', '2026-T2']);
    expect(r.perTerm.get('2026-T1')!.svcTotal).toBe(2);
    expect(r.perTerm.get('2026-T2')!.svcTotal).toBe(1);
    expect(r.perTerm.get('2026-T1')!.byStudent.get('a')!.svcAttended).toBe(1);
    expect(r.perTerm.get('2026-T2')!.byStudent.get('a')!.svcAttended).toBe(1);
    expect(r.perTerm.get('2026-T1')!.byStudent.get('b')!.svcAttended).toBe(1);
  });

  it('ignores invalid sessions', () => {
    const i = input();
    i.serviceSessions[0]!.valid = false; // s1 invalid
    const r = computeYearAggregates(i);
    expect(r.perTerm.get('2026-T1')!.svcTotal).toBe(1); // only s2 remains valid in T1
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/year-aggregates.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/services/year-aggregates.ts
import { mondayOf } from './terms';
import { computeAllTerms, type LabeledTerm } from './year-terms';
import type { AggregateInput } from './aggregates';

export interface YearStudentAggregate { svcAttended: number; grpAttended: number; grpTotal: number; }
export interface YearTermResult { key: string; svcTotal: number; byStudent: Map<string, YearStudentAggregate>; }
export interface YearAggregateResult { terms: LabeledTerm[]; perTerm: Map<string, YearTermResult>; }

export function computeYearAggregates(input: AggregateInput): YearAggregateResult {
  const { termGapDays, serviceSessions, serviceAttendance, weekStartById, lifegroupAttendance } = input;

  const validWeeks = serviceSessions.filter((s) => s.valid).map((s) => mondayOf(s.date));
  const boundarySource = validWeeks.length > 0 ? validWeeks : [...weekStartById.values()];
  const terms = computeAllTerms(boundarySource, termGapDays);

  const termFor = (d: string): string | null => {
    for (const t of terms) if (d >= t.startDate && d <= t.endDate) return t.key;
    return null;
  };

  const perTerm = new Map<string, YearTermResult>();
  for (const t of terms) perTerm.set(t.key, { key: t.key, svcTotal: 0, byStudent: new Map() });

  const sessionTerm = new Map<string, string>();
  for (const s of serviceSessions) {
    if (!s.valid) continue;
    const k = termFor(mondayOf(s.date));
    if (!k) continue;
    sessionTerm.set(s.id, k);
    perTerm.get(k)!.svcTotal++;
  }

  const ensure = (k: string, id: string): YearStudentAggregate => {
    const tr = perTerm.get(k)!;
    let a = tr.byStudent.get(id);
    if (!a) { a = { svcAttended: 0, grpAttended: 0, grpTotal: 0 }; tr.byStudent.set(id, a); }
    return a;
  };

  for (const rec of serviceAttendance) {
    if (!rec.attended) continue;
    const k = sessionTerm.get(rec.sessionId);
    if (!k) continue;
    ensure(k, rec.studentId).svcAttended++;
  }

  for (const rec of lifegroupAttendance) {
    const ws = weekStartById.get(rec.weekId);
    if (!ws) continue;
    const k = termFor(ws);
    if (!k) continue;
    const a = ensure(k, rec.studentId);
    a.grpTotal++;
    if (rec.attended) a.grpAttended++;
  }

  return { terms, perTerm };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tests/year-aggregates.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/year-aggregates.ts src/tests/year-aggregates.test.ts
git commit -m "feat: computeYearAggregates — per-term student aggregates"
```

---

### Task 3: Extract CSV→model builders from the importer (DRY)

The audit must turn the uploaded YTD service CSV (parsed `rows`) and group payload into sessions/attendance/weeks **without writing to live tables**. That transformation already exists inside `import.service.ts`; extract the pure parts so both the importer and the audit share them.

**Files:**
- Create: `src/services/attendance-build.ts`
- Modify: `src/services/import.service.ts` (call the new builders; no behaviour change)
- Test: existing `npm run test` must stay green (the importer is exercised by the at-risk/import tests).

**Interfaces:**
- Produces:
  ```ts
  export interface BuiltSession { id: string; sessionDate: string; isValid: boolean; }
  export interface BuiltAttendance { studentId: string; sessionId: string; attended: boolean; }
  export interface BuiltServiceModel {
    sessions: BuiltSession[];
    attendance: BuiltAttendance[];
    students: { id: string; firstName: string; lastName: string; gender: 'male'|'female'|'other'; grade: number | null; quad: string | null }[];
  }
  export function buildServiceModel(rows: unknown[], serviceMinAttendance: number): BuiltServiceModel;

  export interface BuiltWeek { id: string; weekStart: string; }
  export interface BuiltGroupModel {
    weeks: BuiltWeek[];
    lifegroupAttendance: { studentId: string; weekId: string; attended: boolean }[];
    students: { id: string; firstName: string; lastName: string }[];
  }
  export function buildGroupModel(groups: { name: string; meetings: string[]; members: { first_name: string; last_name: string; attendance: (boolean|null)[] }[] }[]): BuiltGroupModel;
  ```

> **Note for the implementer:** This is a *refactor-by-extraction*, not new logic. Move the in-memory transformation out of `import.service.ts` verbatim, then have the importer call it. Do it in small verified steps.

- [ ] **Step 1: Create `attendance-build.ts` with `buildServiceModel`**

Move the pure in-memory transformation from `import.service.ts` `importServiceCsv` — specifically the date-column detection + `normaliseDate` (currently lines ~203–229), the per-row student/attendance build loop (lines ~253–349), and the valid-session second pass (lines ~351–364) — into `buildServiceModel(rows, serviceMinAttendance)`. It must use `generateId` from `../utils/id`, `ServiceRowSchema`/`normalizeDob`/`computeQuad` exactly as today, and return `{ sessions, attendance, students }`. Do **not** include any repo reads/writes, term split, or `applyAggregatesToStudents` — those stay in the importer.

- [ ] **Step 2: Create `buildGroupModel`**

Move the group transformation from `importGroupCsv` — the per-group week registry + youth/leader split + per-member attendance build (currently lines ~464–618, excluding leader persistence and the term split) — into `buildGroupModel(groups)`, returning `{ weeks, lifegroupAttendance, students }`. Leader extraction stays in the importer (it writes leaders to the live DB); the audit does not need leaders.

- [ ] **Step 3: Refactor `import.service.ts` to call the builders**

In `importServiceCsv`, replace the moved block with `const { sessions, attendance, students } = buildServiceModel(rows, settings.serviceMinAttendance);` then map those into the existing `sessionsToCreate` / `attendanceRecords` / student-save shapes (add `importId`, `now`, `sortOrder`, `createdAt` etc. that are persistence concerns). In `importGroupCsv`, do the same with `buildGroupModel`. Keep every existing repo write, the term split via `computeStudentAggregates`, and `applyAggregatesToStudents` unchanged.

- [ ] **Step 4: Run the full suite to verify no behaviour change**

Run: `npm run test`
Expected: PASS — same test count as before the refactor (the importer/at-risk tests still green).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/services/attendance-build.ts src/services/import.service.ts
git commit -m "refactor: extract pure CSV→model builders for reuse by audit"
```

---

## Phase 2 — Storage, service & API

### Task 4: `ConnectionAudit` entity + snapshot types

**Files:**
- Create: `src/core/entities/connection-audit.ts`

**Interfaces:**
- Consumes: `ID`, `ISODateString` from `../types/common`; `LabeledTerm` from `../../services/year-terms`.
- Produces: the `ConnectionAudit` entity and `AuditSnapshot` shape used by the service, repos and frontend.

- [ ] **Step 1: Create the entity file**

```ts
// src/core/entities/connection-audit.ts
import type { ID, ISODateString } from '../types/common';
import type { LabeledTerm } from '../../services/year-terms';

// One CRM-upload overlay row (Student Team / Connect / Decision / People Flow).
// `name` is the matched person; `date` is null for the Team roster snapshot.
export interface AuditUploadRow { name: string; date: string | null; step?: number; admin?: string; status?: string; }

export interface AuditStudentRow {
  id: string;
  firstName: string;
  lastName: string;
  gender: 'male' | 'female' | 'other';
  grade: number | null;
  quad: string | null;
}

// Per-term frozen figures for one term.
export interface AuditTermSnapshot {
  key: string;            // matches LabeledTerm.key
  svcTotal: number;       // valid services in the term
  inProgress: boolean;    // true for the latest term of a mid-term (YTD) upload
  // studentId -> attendance in this term
  byStudent: Record<string, { svcAttended: number; grpAttended: number; grpTotal: number }>;
}

export interface AuditSnapshot {
  generatedAt: ISODateString;
  dataStartDate: string | null; // earliest valid service date in the upload
  dataEndDate: string | null;   // latest valid service date in the upload
  terms: LabeledTerm[];
  students: AuditStudentRow[];
  perTerm: Record<string, AuditTermSnapshot>;
  uploads: {
    team: AuditUploadRow[];
    connect: AuditUploadRow[];
    decision: AuditUploadRow[];
    flows: AuditUploadRow[];
  };
}

export interface ConnectionAudit {
  id: ID;          // we use the year string as the id, e.g. "2026" — one row per year
  year: number;
  label: string;   // e.g. "2026 (year-to-date)"
  uploadedBy: string;
  uploadedAt: ISODateString;
  snapshot: AuditSnapshot;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors (file is types-only; if `../types/common` lacks `ID`/`ISODateString`, confirm with `settings.ts` which imports the same).

- [ ] **Step 3: Commit**

```bash
git add src/core/entities/connection-audit.ts
git commit -m "feat: ConnectionAudit entity + snapshot types"
```

---

### Task 5: Repository interface + in-memory implementation

**Files:**
- Modify: `src/repositories/interfaces/entity-repositories.ts`
- Modify: `src/repositories/in-memory/in-memory.repositories.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface IConnectionAuditRepository extends IRepository<ConnectionAudit> {
    findByYear(year: number): Promise<ConnectionAudit | null>;
  }
  export class InMemoryConnectionAuditRepository extends InMemoryBaseRepository<ConnectionAudit> implements IConnectionAuditRepository { ... }
  ```

- [ ] **Step 1: Add the interface**

In `src/repositories/interfaces/entity-repositories.ts`, add the import and interface:

```ts
import type { ConnectionAudit } from '../../core/entities/connection-audit';
```
```ts
export interface IConnectionAuditRepository extends IRepository<ConnectionAudit> {
  findByYear(year: number): Promise<ConnectionAudit | null>;
}
```

- [ ] **Step 2: Add the in-memory repository**

In `src/repositories/in-memory/in-memory.repositories.ts`, add the import to the existing `import type { ... } from '../interfaces/entity-repositories';` block:

```ts
  IConnectionAuditRepository,
```
and the entity import:
```ts
import type { ConnectionAudit } from '../../core/entities/connection-audit';
```
then append the class (mirrors `InMemorySnapshotRepository`):

```ts
// ---------------------------------------------------------------------------
// Connection Audits (year-keyed snapshots)
// ---------------------------------------------------------------------------
export class InMemoryConnectionAuditRepository
  extends InMemoryBaseRepository<ConnectionAudit>
  implements IConnectionAuditRepository
{
  constructor(persistence?: IPersistenceAdapter<ConnectionAudit>) { super(persistence); }

  async findByYear(year: number): Promise<ConnectionAudit | null> {
    for (const a of this.store.values()) if (a.year === year) return this.clone(a);
    return null;
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/repositories/interfaces/entity-repositories.ts src/repositories/in-memory/in-memory.repositories.ts
git commit -m "feat: IConnectionAuditRepository + in-memory impl"
```

---

### Task 6: Supabase repository + migration

**Files:**
- Create: `src/repositories/supabase/supabase.connection-audit.ts`
- Modify: `src/repositories/supabase/index.ts`
- Create: `supabase/migrations/009_connection_audits.sql`

**Interfaces:**
- Consumes: `SqlClient` from `./client`; `IConnectionAuditRepository`; `ConnectionAudit`/`AuditSnapshot`.
- Produces: `SupabaseConnectionAuditRepository`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/009_connection_audits.sql
-- Connection Audit snapshots: one self-contained, frozen audit per calendar
-- year. `snapshot` holds the per-term aggregates + CRM upload overlays computed
-- at upload time, so a past year stays viewable even after the live platform's
-- two-term window has rolled past it.
create table if not exists connection_audits (
  id          text primary key,          -- the year as text, e.g. '2026'
  year        int  not null unique,
  label       text not null,
  uploaded_by text not null,
  uploaded_at timestamptz not null,
  snapshot    jsonb not null
);
```

- [ ] **Step 2: Write the Supabase repository**

```ts
// src/repositories/supabase/supabase.connection-audit.ts
import type { SqlClient } from './client';
import type { IConnectionAuditRepository } from '../interfaces/entity-repositories';
import type { ConnectionAudit, AuditSnapshot } from '../../core/entities/connection-audit';

function toConnectionAudit(row: Record<string, unknown>): ConnectionAudit {
  return {
    id: row['id'] as string,
    year: row['year'] as number,
    label: row['label'] as string,
    uploadedBy: row['uploaded_by'] as string,
    uploadedAt: (row['uploaded_at'] as Date).toISOString(),
    snapshot: row['snapshot'] as AuditSnapshot,
  };
}

export class SupabaseConnectionAuditRepository implements IConnectionAuditRepository {
  constructor(private sql: SqlClient) {}

  async init(): Promise<void> {
    // No-op: Supabase table already exists (migration 009).
  }

  async findById(id: string): Promise<ConnectionAudit | null> {
    const rows = await this.sql`select * from connection_audits where id = ${id}`;
    return rows[0] ? toConnectionAudit(rows[0]) : null;
  }

  async findByYear(year: number): Promise<ConnectionAudit | null> {
    const rows = await this.sql`select * from connection_audits where year = ${year}`;
    return rows[0] ? toConnectionAudit(rows[0]) : null;
  }

  async findAll(): Promise<ConnectionAudit[]> {
    const rows = await this.sql`select * from connection_audits order by year desc`;
    return rows.map(toConnectionAudit);
  }

  async save(audit: ConnectionAudit): Promise<ConnectionAudit> {
    const rows = await this.sql`
      insert into connection_audits (id, year, label, uploaded_by, uploaded_at, snapshot)
      values (
        ${audit.id},
        ${audit.year},
        ${audit.label},
        ${audit.uploadedBy},
        ${audit.uploadedAt},
        ${this.sql.json(audit.snapshot as Parameters<typeof this.sql.json>[0])}
      )
      on conflict (id) do update set
        year        = excluded.year,
        label       = excluded.label,
        uploaded_by = excluded.uploaded_by,
        uploaded_at = excluded.uploaded_at,
        snapshot    = excluded.snapshot
      returning *
    `;
    return toConnectionAudit(rows[0]!);
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.sql`delete from connection_audits where id = ${id} returning id`;
    return rows.length > 0;
  }
}
```

- [ ] **Step 3: Export it**

In `src/repositories/supabase/index.ts` add:

```ts
export { SupabaseConnectionAuditRepository } from './supabase.connection-audit';
```

- [ ] **Step 4: Apply the migration to Supabase**

Run (interactive — suggest the user runs it via `!` in-session if a DB password prompt appears):
`supabase db push`
Expected: migration `009_connection_audits` applied; `connection_audits` table created.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/repositories/supabase/supabase.connection-audit.ts src/repositories/supabase/index.ts supabase/migrations/009_connection_audits.sql
git commit -m "feat: Supabase connection-audit repo + migration"
```

---

### Task 7: Wire the repository into the container

**Files:**
- Modify: `src/container.ts`

**Interfaces:**
- Produces: `repos.connectionAudits: IConnectionAuditRepository`, available to services.

- [ ] **Step 1: Add imports**

Add `InMemoryConnectionAuditRepository` to the `from './repositories/in-memory'` import block, `SupabaseConnectionAuditRepository` to the `from './repositories/supabase/index'` block, and `IConnectionAuditRepository` to the `from './repositories/interfaces'` type block.

- [ ] **Step 2: Add to the `Repositories` interface**

```ts
  connectionAudits: IConnectionAuditRepository;
```

- [ ] **Step 3: Instantiate + register + init**

In `buildContainer`, after the `audit` repo is created:

```ts
  const connectionAudits: IConnectionAuditRepository = useSupabase
    ? new SupabaseConnectionAuditRepository(sql)
    : new InMemoryConnectionAuditRepository(useJson ? makeJson('connection-audits.json') : undefined);
```
Add `connectionAudits,` to the `const repos: Repositories = { ... }` literal, and `connectionAudits.init(),` to the `Promise.all([...])` init list.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors (service wiring comes in Task 8 — `repos.connectionAudits` exists but is not yet consumed).

- [ ] **Step 5: Commit**

```bash
git add src/container.ts
git commit -m "feat: wire connection-audit repository into container"
```

---

### Task 8: `ConnectionAuditService` — upload/list/get/delete

**Files:**
- Create: `src/services/connection-audit.service.ts`
- Modify: `src/container.ts` (construct + register the service)
- Test: `src/tests/connection-audit.service.test.ts`

**Interfaces:**
- Consumes: `IConnectionAuditRepository`; `ISettingsRepository`; `assertCan`; `buildServiceModel`/`buildGroupModel` (Task 3); `computeYearAggregates` (Task 2); `generateId`.
- Produces:
  ```ts
  export interface AuditSummary { year: number; label: string; uploadedAt: string; termKeys: string[]; }
  export interface ConnectionAuditService {
    upload(actor: Actor, input: unknown): Promise<ConnectionAudit>;
    list(actor: Actor): Promise<AuditSummary[]>;
    get(actor: Actor, year: number): Promise<ConnectionAudit | null>;
    remove(actor: Actor, year: number): Promise<void>;
  }
  export function makeConnectionAuditService(repo: IConnectionAuditRepository, settings: ISettingsRepository): ConnectionAuditService;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/tests/connection-audit.service.test.ts
import { describe, it, expect } from 'vitest';
import { makeConnectionAuditService } from '../services/connection-audit.service';
import { InMemoryConnectionAuditRepository } from '../repositories/in-memory';
import { InMemorySettingsRepository } from '../repositories/in-memory';
import type { Actor } from '../core/entities/user';
import { ForbiddenError } from '../core/errors/app-error';

function actor(role: string): Actor {
  return { id: 'a', role: role as any, displayName: 'T', grade: null as any, quad: null as any };
}

async function svc() {
  const repo = new InMemoryConnectionAuditRepository();
  const settings = new InMemorySettingsRepository();
  await repo.init();
  await settings.init();
  return makeConnectionAuditService(repo, settings);
}

// A minimal YTD service upload: 3 Fridays, two of them in Term 1 and one after a
// gap in Term 2, plus one student attending. Group/CRM uploads empty.
function uploadPayload() {
  return {
    service: {
      rows: [
        { first_name: 'Ava', last_name: 'Okafor', gender: 'female', grade: 9,
          '2026-02-06': 'Y', '2026-02-13': 'Y', '2026-04-24': 'Y' },
      ],
    },
    group: { groups: [] },
    team: [], connect: [], decision: [], flows: [],
  };
}

describe('ConnectionAuditService', () => {
  it('rejects non-director/admin upload', async () => {
    const s = await svc();
    await expect(s.upload(actor('grade'), uploadPayload())).rejects.toThrow(ForbiddenError);
  });

  it('director upload computes terms and stores one row per year', async () => {
    const s = await svc();
    const a = await s.upload(actor('director'), uploadPayload());
    expect(a.year).toBe(2026);
    expect(a.id).toBe('2026');
    expect(a.snapshot.terms.map((t) => t.key)).toEqual(['2026-T1', '2026-T2']);
    const list = await s.list(actor('admin'));
    expect(list).toHaveLength(1);
    expect(list[0]!.year).toBe(2026);
  });

  it('re-upload overwrites the same year (latest-per-year)', async () => {
    const s = await svc();
    await s.upload(actor('director'), uploadPayload());
    await s.upload(actor('director'), uploadPayload());
    const list = await s.list(actor('admin'));
    expect(list).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/connection-audit.service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/services/connection-audit.service.ts
import { z } from 'zod';
import { assertCan } from './access-control';
import type { IConnectionAuditRepository, ISettingsRepository } from '../repositories/interfaces/entity-repositories';
import type { Actor } from '../core/entities/user';
import type { ConnectionAudit, AuditSnapshot, AuditUploadRow, AuditTermSnapshot } from '../core/entities/connection-audit';
import { BadRequestError } from '../core/errors/app-error';
import { buildServiceModel, buildGroupModel } from './attendance-build';
import { computeYearAggregates } from './year-aggregates';

const UploadRowSchema = z.object({
  name: z.string(),
  date: z.string().nullable().optional(),
  step: z.number().optional(),
  admin: z.string().optional(),
  status: z.string().optional(),
}).transform((r) => ({ name: r.name, date: r.date ?? null, step: r.step, admin: r.admin, status: r.status }));

const UploadSchema = z.object({
  service: z.object({ rows: z.array(z.unknown()) }),
  group: z.object({ groups: z.array(z.any()) }).default({ groups: [] }),
  team: z.array(UploadRowSchema).default([]),
  connect: z.array(UploadRowSchema).default([]),
  decision: z.array(UploadRowSchema).default([]),
  flows: z.array(UploadRowSchema).default([]),
});

export interface AuditSummary { year: number; label: string; uploadedAt: string; termKeys: string[]; }

export interface ConnectionAuditService {
  upload(actor: Actor, input: unknown): Promise<ConnectionAudit>;
  list(actor: Actor): Promise<AuditSummary[]>;
  get(actor: Actor, year: number): Promise<ConnectionAudit | null>;
  remove(actor: Actor, year: number): Promise<void>;
}

export function makeConnectionAuditService(
  repo: IConnectionAuditRepository,
  settingsRepo: ISettingsRepository,
): ConnectionAuditService {
  return {
    async upload(actor, input) {
      assertCan(actor, 'import:run');
      const data = UploadSchema.parse(input);
      const settings = await settingsRepo.getSettings();
      const now = new Date().toISOString();

      // Build sessions/attendance/weeks from the uploaded YTD CSVs — no live DB writes.
      const svcModel = buildServiceModel(data.service.rows, settings.serviceMinAttendance);
      const grpModel = buildGroupModel(data.group.groups as Parameters<typeof buildGroupModel>[0]);

      // Identity: students come from the service roster, augmented by group-only names.
      const studentsById = new Map(svcModel.students.map((s) => [s.id, s]));

      const weekStartById = new Map(grpModel.weeks.map((w) => [w.id, w.weekStart]));
      const agg = computeYearAggregates({
        termGapDays: settings.termGapDays,
        serviceSessions: svcModel.sessions.map((s) => ({ id: s.id, date: s.sessionDate, valid: s.isValid })),
        serviceAttendance: svcModel.attendance,
        weekStartById,
        lifegroupAttendance: grpModel.lifegroupAttendance,
      });

      if (agg.terms.length === 0) throw new BadRequestError('No valid services found in the uploaded data');

      const dataStartDate = agg.terms[0]!.startDate;
      const dataEndDate = agg.terms[agg.terms.length - 1]!.endDate;
      const year = agg.terms[agg.terms.length - 1]!.year; // the YTD year = latest term's year
      const latestKey = agg.terms[agg.terms.length - 1]!.key;

      const perTerm: Record<string, AuditTermSnapshot> = {};
      for (const [key, tr] of agg.perTerm) {
        const byStudent: AuditTermSnapshot['byStudent'] = {};
        for (const [id, a] of tr.byStudent) byStudent[id] = { svcAttended: a.svcAttended, grpAttended: a.grpAttended, grpTotal: a.grpTotal };
        perTerm[key] = { key, svcTotal: tr.svcTotal, inProgress: key === latestKey, byStudent };
      }

      const snapshot: AuditSnapshot = {
        generatedAt: now,
        dataStartDate,
        dataEndDate,
        terms: agg.terms,
        students: [...studentsById.values()].map((s) => ({
          id: s.id, firstName: s.firstName, lastName: s.lastName, gender: s.gender, grade: s.grade, quad: s.quad,
        })),
        perTerm,
        uploads: {
          team: data.team as AuditUploadRow[],
          connect: data.connect as AuditUploadRow[],
          decision: data.decision as AuditUploadRow[],
          flows: data.flows as AuditUploadRow[],
        },
      };

      const audit: ConnectionAudit = {
        id: String(year),
        year,
        label: `${year} (year-to-date)`,
        uploadedBy: actor.displayName,
        uploadedAt: now,
        snapshot,
      };
      return repo.save(audit);
    },

    async list(actor) {
      assertCan(actor, 'import:run');
      const all = await repo.findAll();
      return all
        .sort((a, b) => b.year - a.year)
        .map((a) => ({ year: a.year, label: a.label, uploadedAt: a.uploadedAt, termKeys: a.snapshot.terms.map((t) => t.key) }));
    },

    async get(actor, year) {
      assertCan(actor, 'import:run');
      return repo.findByYear(year);
    },

    async remove(actor, year) {
      assertCan(actor, 'import:run');
      await repo.delete(String(year));
    },
  };
}
```

- [ ] **Step 4: Wire the service into the container**

In `src/container.ts`: import `makeConnectionAuditService, type ConnectionAuditService`; add `connectionAudit: ConnectionAuditService;` to the `Services` interface; construct `const connectionAudit = makeConnectionAuditService(connectionAudits, settings);` after the other services; add `connectionAudit,` to the `const services: Services = { ... }` literal.

- [ ] **Step 5: Run the test + typecheck**

Run: `npx vitest run src/tests/connection-audit.service.test.ts`
Expected: PASS (3 tests).
Run: `npm run typecheck`
Expected: no errors.

> If `buildServiceModel`'s returned `students[].id` is regenerated each call, the test's per-year assertions still hold (it only checks term keys/year/count). The student-id stability across re-upload is not required because re-upload replaces the whole snapshot.

- [ ] **Step 6: Commit**

```bash
git add src/services/connection-audit.service.ts src/container.ts src/tests/connection-audit.service.test.ts
git commit -m "feat: ConnectionAuditService — upload/list/get/delete with server compute"
```

---

### Task 9: Controller + routes + vercel.json

**Files:**
- Create: `src/api/controllers/connection-audit.controller.ts`
- Modify: `src/api/http/router.ts`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: `ConnectionAuditService` from the container.
- Produces routes: `POST /audits`, `GET /audits`, `GET /audits/:year`, `DELETE /audits/:year`.

- [ ] **Step 1: Write the controller**

```ts
// src/api/controllers/connection-audit.controller.ts
import type { HttpRequest } from '../http/types';
import type { ConnectionAuditService } from '../../services/connection-audit.service';
import { UnauthorizedError, BadRequestError } from '../../core/errors/app-error';

export function makeConnectionAuditController(deps: { connectionAudit: ConnectionAuditService }) {
  return {
    async upload(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return deps.connectionAudit.upload(req.ctx, req.body);
    },
    async list(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return deps.connectionAudit.list(req.ctx);
    },
    async get(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const year = Number(req.params?.['year']);
      if (!Number.isInteger(year)) throw new BadRequestError('Invalid year');
      return deps.connectionAudit.get(req.ctx, year);
    },
    async remove(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const year = Number(req.params?.['year']);
      if (!Number.isInteger(year)) throw new BadRequestError('Invalid year');
      await deps.connectionAudit.remove(req.ctx, year);
      return { ok: true };
    },
  };
}
```

- [ ] **Step 2: Register the routes**

In `src/api/http/router.ts`: import `makeConnectionAuditController`; construct `const connectionAudit = makeConnectionAuditController({ connectionAudit: services.connectionAudit });`; add a route group:

```ts
    // ----- Connection Audits -----
    { method: 'POST',   path: '/audits',       auth: true, handler: (r) => connectionAudit.upload(r) },
    { method: 'GET',    path: '/audits',       auth: true, handler: (r) => connectionAudit.list(r) },
    { method: 'GET',    path: '/audits/:year', auth: true, handler: (r) => connectionAudit.get(r) },
    { method: 'DELETE', path: '/audits/:year', auth: true, handler: (r) => connectionAudit.remove(r) },
```

- [ ] **Step 3: Add `audits` to the Vercel route regex**

In `vercel.json`, change the API `src` regex to include `audits`:

```json
      "src": "^/(auth|students|leaders|connections|overview|trends|lifegroups|at-risk|import|settings|admin|accounts|push|health|audits)(/.*)?(\\?.*)?$",
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Smoke-test the routes locally**

Run (in one shell): `PERSISTENCE=memory npm run dev`
Then in another shell, log in to get a token and POST a minimal audit:
```bash
TOKEN=$(curl -s localhost:4300/auth/login -H 'Content-Type: application/json' -d '{"email":"director@youth.ministry","password":"demo1234"}' | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).token))')
curl -s localhost:4300/audits -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"service":{"rows":[{"first_name":"Ava","last_name":"Okafor","gender":"female","grade":9,"2026-02-06":"Y","2026-02-13":"Y","2026-04-24":"Y"}]},"group":{"groups":[]},"team":[],"connect":[],"decision":[],"flows":[]}'
curl -s localhost:4300/audits -H "Authorization: Bearer $TOKEN"
```
Expected: the POST returns an audit with `"year":2026` and `terms` `2026-T1`,`2026-T2`; the GET list returns one summary.

- [ ] **Step 6: Commit**

```bash
git add src/api/controllers/connection-audit.controller.ts src/api/http/router.ts vercel.json
git commit -m "feat: /audits routes + controller"
```

---

## Phase 3 — Frontend (CA module)

> All edits stay inside the `/* ── CA MODULE START ── */ … /* ── CA MODULE END ── */` block in `public/index.html` (≈ lines 3796–4712) and its `/*CA-HOOK*/` lines, preserving the module-removal contract. The SPA has no test framework — verify each task manually in the browser (`PERSISTENCE=memory npm run dev`, log in as `director@youth.ministry` / `demo1234`).

### Task 10: Add an audit API client + year/term state to the CA module

**Files:**
- Modify: `public/index.html` (CA module top — near `const KEY=…`, the state vars at ~3801–3806)

**Interfaces:**
- Produces (inside the CA IIFE): `let AUDIT=null` (current loaded snapshot), `let AUDIT_YEAR=null`, `let TERM='ALL'` (selected term key or `'ALL'` for YTD), and helpers `auditList()`, `auditLoad(year)`.

- [ ] **Step 1: Add state + API helpers**

After the existing CA state declarations (the `let st=null,...` line), add:

```js
let AUDIT=null;            // loaded AuditSnapshot for AUDIT_YEAR
let AUDIT_YEAR=null;       // selected year (number) or null
let AUDIT_SUMMARIES=null;  // cached list of {year,label,uploadedAt,termKeys}
let TERM='ALL';            // selected term key, or 'ALL' for year-to-date
async function auditList(){ if(AUDIT_SUMMARIES) return AUDIT_SUMMARIES; AUDIT_SUMMARIES=await API.get('/audits').catch(()=>[]); return AUDIT_SUMMARIES; }
async function auditLoad(year){ const a=await API.get('/audits/'+year).catch(()=>null); AUDIT=a&&a.snapshot?a.snapshot:null; AUDIT_YEAR=a?a.year:null; TERM='ALL'; return AUDIT; }
function auditInvalidate(){ AUDIT_SUMMARIES=null; Cache.del('/audits'); }
```

- [ ] **Step 2: Verify it parses**

Run: `node -e "const fs=require('fs');const l=fs.readFileSync('public/index.html','utf8').split(/\r?\n/);fs.writeFileSync('_chk.js',l.slice(412,4736).join('\n'));" && node --check _chk.js && rm -f _chk.js`
Expected: prints nothing and exits 0 (syntax OK).

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat(ca): audit snapshot state + API client"
```

---

### Task 11: Swap the `load()` adapter to read from the selected audit snapshot

The current `load()` (≈ lines 3817–3833) fetches live `/students`, `/trends`, `/settings`, `/lifegroups/stats`. Replace its data source with the loaded audit snapshot scoped to the selected `TERM`, so every existing CA view (funnel, people, lifegroups, deck) renders from the frozen audit instead of live data.

**Files:**
- Modify: `public/index.html` — CA `load()` and the `D` shape it produces.

**Interfaces:**
- Consumes: `AUDIT`, `TERM`, `auditLoad` (Task 10).
- Produces: the same `D = { students, trends, settings, lgStats }` contract the rest of the CA module already consumes — so downstream code is unchanged — but sourced from the audit and scoped to `TERM`.

- [ ] **Step 1: Rewrite `load()` to derive `D` from the snapshot**

Replace the body of `load()` so that, when an audit is loaded, it maps the snapshot into the existing `D.students` shape using the selected term (`TERM==='ALL'` sums every term; otherwise uses `perTerm[TERM]`). Map each `snapshot.students[i]` to the existing student fields the module reads (`sA`=svcAttended, `sT`=svcTotal, `gA`=grpAttended, `gT`=grpTotal, plus `psA/psT/pgA/pgT` for the previous-term comparison = the term before the selected one). Concretely:

```js
async function load(force){
  if(D&&!force)return D;
  if(!AUDIT){ D={students:[],trends:null,settings:{},lgStats:null,_empty:true}; return D; }
  const terms=AUDIT.terms||[];
  const idx= TERM==='ALL' ? -1 : terms.findIndex(t=>t.key===TERM);
  const sel= TERM==='ALL' ? terms : (idx>=0?[terms[idx]]:[]);
  const prev= TERM==='ALL' ? [] : (idx>0?[terms[idx-1]]:[]);
  const sumOver=(keys,id)=>{let sA=0,sT=0,gA=0,gT=0;for(const t of keys){const pt=AUDIT.perTerm[t.key];if(!pt)continue;sT+=pt.svcTotal;const a=pt.byStudent[id];if(a){sA+=a.svcAttended;gA+=a.grpAttended;gT+=a.grpTotal;}}return{sA,sT,gA,gT};};
  D={
    students:(AUDIT.students||[]).map(s=>{
      const c=sumOver(sel,s.id), p=sumOver(prev,s.id);
      return {id:s.id,fn:s.firstName,ln:s.lastName,gender:s.gender,grade:s.grade,quad:s.quad,
        sA:c.sA,sT:c.sT,gA:c.gA,gT:c.gT, psA:p.sA,psT:p.sT,pgA:p.gA,pgT:p.gT, ph:'',pp:''};
    }),
    trends:null, settings:{}, lgStats:null,
  };
  return D;
}
```

> The `trends`/`lgStats` consumers in CA already null-guard (`sessSeries()` returns `[]` when `D.trends` is null; lifegroup views fall back). Funnel/people/decision/team views read `D.students` + `st.uploads`, which now come from the audit. The session sparkline simply renders empty in audit mode — acceptable for v1; a later task can add a per-term session series to the snapshot if desired.

- [ ] **Step 2: Make `D` re-derive when TERM or AUDIT changes**

Anywhere the module sets `TERM=` or calls `auditLoad(...)`, follow it with `D=null;` so the next `load()` rebuilds. Add a helper used by the selectors:

```js
async function setTerm(k){ TERM=k; D=null; await render(S.page); }
async function setYear(y){ await auditLoad(y); D=null; await render(S.page); }
```

- [ ] **Step 3: Manual verification**

Start the dev server, log in as director, upload a YTD audit via the Data tab (built in Task 12), then confirm the funnel/people views populate from the snapshot and change when you switch terms.
Run: `node -e "..."` syntax check as in Task 10 Step 2.
Expected: syntax OK; views render from the snapshot.

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat(ca): source views from the audit snapshot, scoped to selected term"
```

---

### Task 12: Data tab — upload service + group + CRM as one audit

The Data tab (`rData()`, ≈ lines 4307–4325) currently shows 4 CRM upload slots writing to `localStorage`. Replace it with: a year selector (existing audits + "New year"), 6 upload slots (Service, Group, Student Team, Connect, Decision, People Flow), and a **Save audit** button that POSTs everything to `/audits`.

**Files:**
- Modify: `public/index.html` — `rData()`, the `upload(...)` handler (≈ 4327–4360), and `reset()`.

**Interfaces:**
- Consumes: existing `parseRows`/`parseFlows`; the main SPA's `parseCSV` (service) and group parser used by `/import/*`; `auditList`, `auditInvalidate`.
- Produces: a staged `PENDING` upload object posted to `/audits`.

- [ ] **Step 1: Stage uploads in memory instead of localStorage**

Add a staging object near the CA state:

```js
let PENDING={service:null,group:null,team:[],connect:[],decision:[],flows:[]}; // staged for the next Save
```
Change the file handler so Service/Group parse into `PENDING.service`/`PENDING.group` (reuse the SPA's existing service/group CSV parsers — the same ones feeding `/import/csv` and `/import/group-csv`), and Team/Connect/Decision/Flows parse into `PENDING.*` via `parseRows`/`parseFlows`.

- [ ] **Step 2: Save audit**

Add a handler:

```js
async function saveAudit(){
  if(!PENDING.service){ toast('Upload the service CSV first'); return; }
  try{
    const a=await API.post('/audits',{service:PENDING.service,group:PENDING.group||{groups:[]},team:PENDING.team,connect:PENDING.connect,decision:PENDING.decision,flows:PENDING.flows});
    auditInvalidate();
    await auditLoad(a.year);
    PENDING={service:null,group:null,team:[],connect:[],decision:[],flows:[]};
    toast('Audit saved for '+a.year);
    await render('ca-overview');
  }catch(e){ toast(e.message||'Save failed'); }
}
```

- [ ] **Step 3: Render the new Data tab**

Rewrite `rData()` to render: the year picker (from `await auditList()`), the 6 upload slots (showing staged filenames), and the **Save audit** button calling `CA.saveAudit()`. Keep the slot UI style (`slotU`).

- [ ] **Step 4: Manual verification**

Upload a full-year service CSV (+ optional group/CRM CSVs), click Save audit. Confirm: a row appears under `/audits`, the Overview renders, and reloading the page (or logging in as `admin@youth.ministry`) shows the same audit. This proves server persistence + cross-user visibility.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat(ca): Data tab uploads a full audit to the server"
```

---

### Task 13: Year + term switcher and YTD multi-term view

Add the viewer controls: a year dropdown and a term switcher (each detected term + a "Year to date" option) at the top of the CA shell, plus a YTD layout that lists the terms.

**Files:**
- Modify: `public/index.html` — `caShell(...)`/`tabs(...)` header area (≈ 4028–4060) and the entry point `render(p)` (≈ 4690–4700).

**Interfaces:**
- Consumes: `auditList`, `setYear`, `setTerm`, `AUDIT`, `AUDIT_YEAR`, `TERM`.

- [ ] **Step 1: Load a default audit on entry**

In CA's `render(p)`, before rendering, ensure an audit is loaded: if `AUDIT===null`, `const ys=await auditList(); if(ys.length){ await auditLoad(ys[0].year); }`. If still none, render an empty-state prompting upload (Data tab).

- [ ] **Step 2: Render the switcher**

In the shell header, add a year `<select onchange="CA.setYear(this.value)">` (options from `AUDIT_SUMMARIES`) and a term switcher built from `AUDIT.terms`: a "Year to date" chip (`CA.setTerm('ALL')`) plus one chip per term (`CA.setTerm(t.key)`), highlighting the active `TERM`. Mark a term whose `perTerm[key].inProgress` is true with an "(in progress)" suffix.

- [ ] **Step 3: YTD layout**

When `TERM==='ALL'`, show a compact per-term summary strip above the funnel (one row per term: term label, valid services, unique service attenders that term) so the YTD view exposes the term breakdown. Derive the numbers from `AUDIT.perTerm` + `AUDIT.terms`.

- [ ] **Step 4: Expose the new functions on the CA public object**

Add `setYear, setTerm, saveAudit` to the returned `{ ... }` at the bottom of the CA IIFE (≈ line 4708, alongside `fquad,gfilter,...`).

- [ ] **Step 5: Manual verification**

With at least two years uploaded: switch years (figures change), switch terms (funnel/people rescope), select "Year to date" (multi-term strip shows). Confirm a mid-term YTD upload labels its latest term "(in progress)".
Run the syntax check from Task 10 Step 2.
Expected: syntax OK; all switches work.

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "feat(ca): year + term switcher and year-to-date view"
```

---

## Final verification

- [ ] **Step 1: Full typecheck + test suite**

Run: `npm run typecheck && npm run test`
Expected: no type errors; all vitest tests pass (existing + the 3 new test files).

- [ ] **Step 2: Update CLAUDE.md**

Add a short note under the Connection Audit section documenting: audits are server-stored (`connection_audits`, one row per year, `jsonb` snapshot), uploaded via `POST /audits` (director/admin), self-contained (carry their own YTD service+group data), terms auto-derived via `computeAllTerms`, viewed with a year + term/YTD switcher.

- [ ] **Step 3: Commit + deploy**

```bash
git add CLAUDE.md
git commit -m "docs: server-stored connection audits"
git push origin master   # Vercel auto-deploys from master
```
Confirm the deploy by fetching the live `/audits` list as a director, and by loading an audit in the SPA.

---

## Self-Review

**Spec coverage:**
- "Full YTD service + group uploaded as part of the audit, self-contained" → Tasks 3, 8, 12 (builders run on uploaded CSVs; snapshot carries the computed result).
- "Works even if live data is stale" → audit never reads live endpoints (Task 11 sources from the snapshot).
- "Upload previous years' data" → year-keyed rows; Task 12 year picker + Task 13 year switcher.
- "No new role; director/admin only" → `assertCan(actor, 'import:run')` everywhere (Tasks 8, 9).
- "Auto-derive term labels from valid-service gaps" → Tasks 1, 2, 8.
- "Mid-term audit" → YTD upload with the latest term flagged `inProgress` (Task 8, surfaced in Task 13).
- "Swap between terms / YTD view" → Tasks 11 (rescope) + 13 (switcher + YTD strip).
- "Latest per year (overwrite)" → `id = String(year)` + `on conflict do update` (Tasks 6, 8); test in Task 8.
- "Modularity" → frontend stays in the CA block; backend isolated in `connection-audit*` files (no live-platform schema/import changes).

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". Task 3 and the frontend tasks reference exact source line ranges to move/edit rather than restating hundreds of lines — those are precise, actionable instructions, not placeholders. Frontend tasks use manual verification because the SPA has no test harness (per CLAUDE.md).

**Type consistency:** `LabeledTerm` (Task 1) is consumed unchanged by Tasks 2, 4, 8. `AggregateInput` reused from `aggregates.ts` (Task 2, 8). `AuditSnapshot`/`AuditTermSnapshot`/`ConnectionAudit` (Task 4) are produced by the service (Task 8) and read by the repos (Tasks 5, 6) and frontend (Tasks 10–13). `import:run` capability name verified against `access-control.ts`. Repo key `connectionAudits` and service key `connectionAudit` are used consistently in the container (Tasks 7, 8) and router (Task 9).

**Known limitation (documented for the implementer):** term ordinals derive from the calendar year of each term's start date within the uploaded data; a ministry year that straddles the Dec/Jan boundary may mislabel a December term. Acceptable for v1 given the "upload one calendar year of YTD data" assumption.
