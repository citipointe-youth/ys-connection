# Connection Allocation Import / Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin export all student↔leader connection allocations to a CSV and re-import an edited CSV, matching students and leaders by name and reporting anything it cannot match.

**Architecture:** A pure, I/O-free module (`connection-allocations.ts`) does all parsing, sync-planning, and export-row building so the tricky logic is unit-testable without a database. `ConnectionService` gains thin `exportAllocations`/`importAllocations` methods that load repos, delegate to the pure module, and apply the resulting add/remove plan. Two new admin-only routes expose it; the SPA adds an Admin card plus a result modal. No DB/schema change — connections are unchanged and everything flows through existing repository interfaces.

**Tech Stack:** TypeScript (strict, ESM, extensionless imports), Express via a declarative route table, Vitest, a single-file vanilla-JS SPA (`public/index.html`).

**Spec:** `docs/superpowers/specs/2026-06-17-connection-allocation-import-export-design.md`

---

## File Structure

- **Create** `src/services/connection-allocations.ts` — pure types + functions: `parseAllocationRows`, `planAllocationSync`, `buildAllocationExportRows`. No repository imports.
- **Create** `src/tests/connection-allocations.test.ts` — unit tests for the pure module + service-level/RBAC tests using the in-memory repos.
- **Modify** `src/services/access-control.ts` — add `connection:import` action, admin-only.
- **Modify** `src/services/connection.service.ts` — add `exportAllocations` + `importAllocations` to the interface and implementation.
- **Modify** `src/api/controllers/connection.controller.ts` — add `exportAllocations` (CSV string) + `importAllocations` handlers.
- **Modify** `src/api/http/router.ts` — add the two routes.
- **Modify** `public/index.html` — generic allocation CSV parser, export/import handlers, result modal, Admin "Connection Allocations" card.
- **Modify** `CLAUDE.md` — routes table row + a Frontend note.

Conventions to follow (already in the codebase):
- IDs via `import { generateId } from '../utils/id';`.
- Permission checks via `assertCan(actor, '<action>')` from `./access-control`.
- Controllers return plain JSON objects; the CSV export returns `{ csv, rowCount }` (see existing `exportCsv`).
- Tests build services from `src/repositories/in-memory` (see `src/tests/connection.service.test.ts`).

---

## Task 1: Add the `connection:import` capability (admin-only)

**Files:**
- Modify: `src/services/access-control.ts:6-16` (Action union) and `:52-63` (admin permission set)
- Test: `src/tests/connection-allocations.test.ts` (new file; first test lives here)

- [ ] **Step 1: Write the failing test**

Create `src/tests/connection-allocations.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { can } from '../services/access-control';
import type { Actor } from '../core/entities/user';

function actor(role: string): Actor {
  return { id: 'a', role: role as any, displayName: 'T', grade: null as any, quad: null as any };
}

describe('connection:import capability', () => {
  it('is granted to admin only', () => {
    expect(can(actor('admin'), 'connection:import')).toBe(true);
    expect(can(actor('director'), 'connection:import')).toBe(false);
    expect(can(actor('quad'), 'connection:import')).toBe(false);
    expect(can(actor('grade'), 'connection:import')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/connection-allocations.test.ts`
Expected: FAIL — TypeScript error that `'connection:import'` is not assignable to `Action` (the action doesn't exist yet).

- [ ] **Step 3: Add the action and grant it to admin**

In `src/services/access-control.ts`, add to the `Action` union (after `'import:run'`):

```ts
  | 'import:run'              // upload CSV data
  | 'connection:import'       // admin-only: bulk import/export of connection allocations
  | 'admin:manage';           // settings, accounts, year-rollover
```

Then add `'connection:import'` to the **admin** set only (after `'import:run'` in the admin `Set`):

```ts
    'import:run',
    'connection:import',
    'admin:manage',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tests/connection-allocations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/access-control.ts src/tests/connection-allocations.test.ts
git commit -m "feat(rbac): add admin-only connection:import capability"
```

---

## Task 2: Pure module — types + `parseAllocationRows`

**Files:**
- Create: `src/services/connection-allocations.ts`
- Test: `src/tests/connection-allocations.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/tests/connection-allocations.test.ts`:

```ts
import { parseAllocationRows } from '../services/connection-allocations';

describe('parseAllocationRows', () => {
  it('reads First Name / Last Name / Leader columns and ignores grade+gender', () => {
    const rows = [
      { 'first name': 'John', 'last name': 'Smith', grade: '9', gender: 'male', leader: 'Jane Doe' },
      { 'first name': 'John', 'last name': 'Smith', grade: '9', gender: 'male', leader: 'Bob Lee' },
    ];
    const out = parseAllocationRows(rows);
    expect(out).toEqual([
      { rowNum: 1, firstName: 'John', lastName: 'Smith', leaderName: 'Jane Doe' },
      { rowNum: 2, firstName: 'John', lastName: 'Smith', leaderName: 'Bob Lee' },
    ]);
  });

  it('works with no grade/gender columns present', () => {
    const out = parseAllocationRows([{ 'first name': 'Amy', 'last name': 'Ng', leader: 'Sue Park' }]);
    expect(out).toEqual([{ rowNum: 1, firstName: 'Amy', lastName: 'Ng', leaderName: 'Sue Park' }]);
  });

  it('falls back to a single Student/Name column split on first space', () => {
    const out = parseAllocationRows([{ student: 'Mary Jane Watson', leader: 'Sue Park' }]);
    expect(out).toEqual([{ rowNum: 1, firstName: 'Mary', lastName: 'Jane Watson', leaderName: 'Sue Park' }]);
  });

  it('keeps blank-leader rows but drops rows with no name', () => {
    const out = parseAllocationRows([
      { 'first name': 'Tim', 'last name': 'Allen', leader: '' },
      { 'first name': '', 'last name': '', leader: '' },
    ]);
    expect(out).toEqual([{ rowNum: 1, firstName: 'Tim', lastName: 'Allen', leaderName: '' }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tests/connection-allocations.test.ts`
Expected: FAIL — cannot find module `connection-allocations` / `parseAllocationRows` is not a function.

- [ ] **Step 3: Create the module with types + `parseAllocationRows`**

Create `src/services/connection-allocations.ts`:

```ts
// Pure helpers for the admin connection-allocation import/export. No repository
// or I/O imports here — everything is a pure function so it can be unit-tested
// without a database. Consumed by connection.service.ts.

export interface AllocationExportRow {
  firstName: string;
  lastName: string;
  grade: number | null;
  gender: string;
  leader: string; // '' for an unconnected student's placeholder row
}

export interface ParsedAllocationRow {
  rowNum: number; // 1-based index against the data rows (header excluded)
  firstName: string;
  lastName: string;
  leaderName: string; // '' = blank-leader row
}

export interface AllocationPlanPair {
  studentId: string;
  leaderId: string;
}

export interface AllocationImportReport {
  studentsInFile: number;
  connectionsAdded: number;
  connectionsRemoved: number;
  connectionsUnchanged: number;
  unmatchedStudents: { row: number; name: string }[];
  unmatchedLeaders: { row: number; name: string; student: string }[];
  ambiguousStudents: { row: number; name: string }[];
  ambiguousLeaders: { row: number; name: string }[];
  studentsWithSkippedRemovals: string[];
}

export interface AllocationPlan {
  toAdd: AllocationPlanPair[];
  toRemove: AllocationPlanPair[];
  report: AllocationImportReport;
}

// Read the first present value among case-insensitive candidate header keys.
function pickField(row: Record<string, unknown>, candidates: string[]): string {
  for (const key of Object.keys(row)) {
    if (candidates.includes(key.toLowerCase().trim())) {
      const v = row[key];
      return v == null ? '' : String(v).trim();
    }
  }
  return '';
}

// Turn the SPA's row objects (keyed by lowercased CSV headers) into typed rows.
// Agnostic to whether grade/gender columns are present; requires a name source
// and tolerates a blank leader.
export function parseAllocationRows(rows: Record<string, unknown>[]): ParsedAllocationRow[] {
  const out: ParsedAllocationRow[] = [];
  rows.forEach((row, i) => {
    let firstName = pickField(row, ['first name', 'first_name', 'firstname']);
    let lastName = pickField(row, ['last name', 'last_name', 'lastname']);
    if (!firstName && !lastName) {
      const single = pickField(row, ['student', 'name', 'student name', 'full name']);
      if (single) {
        const sp = single.split(/\s+/);
        firstName = sp[0] ?? '';
        lastName = sp.slice(1).join(' ');
      }
    }
    const leaderName = pickField(row, ['leader', 'leaders']);
    if (!firstName && !lastName) return; // truly empty line — skip
    out.push({ rowNum: i + 1, firstName, lastName, leaderName });
  });
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tests/connection-allocations.test.ts`
Expected: PASS (all `parseAllocationRows` tests + the Task 1 capability test).

- [ ] **Step 5: Commit**

```bash
git add src/services/connection-allocations.ts src/tests/connection-allocations.test.ts
git commit -m "feat(allocations): pure parseAllocationRows + shared types"
```

---

## Task 3: Pure module — `planAllocationSync`

**Files:**
- Modify: `src/services/connection-allocations.ts`
- Test: `src/tests/connection-allocations.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/tests/connection-allocations.test.ts`:

```ts
import { planAllocationSync } from '../services/connection-allocations';

const STUDENTS = [
  { id: 's1', firstName: 'John', lastName: 'Smith' },
  { id: 's2', firstName: 'Mary', lastName: 'Jones' },
  { id: 's3', firstName: 'John', lastName: 'Smith' }, // duplicate name -> ambiguous
];
const LEADERS = [
  { id: 'l1', fullName: 'Jane Doe' },
  { id: 'l2', fullName: 'Bob Lee' },
  { id: 'l3', fullName: 'Bob Lee' }, // duplicate name -> ambiguous
];

function row(rowNum: number, firstName: string, lastName: string, leaderName: string) {
  return { rowNum, firstName, lastName, leaderName };
}

describe('planAllocationSync', () => {
  it('adds a missing pair and removes a pair not listed (per-student sync)', () => {
    const parsed = [row(1, 'Mary', 'Jones', 'Jane Doe')];
    const existing = [{ studentId: 's2', leaderId: 'l2' }]; // Mary -> Bob Lee
    const plan = planAllocationSync(parsed, STUDENTS, LEADERS, existing);
    expect(plan.toAdd).toEqual([{ studentId: 's2', leaderId: 'l1' }]);
    expect(plan.toRemove).toEqual([{ studentId: 's2', leaderId: 'l2' }]);
    expect(plan.report.connectionsAdded).toBe(1);
    expect(plan.report.connectionsRemoved).toBe(1);
    expect(plan.report.studentsInFile).toBe(1);
  });

  it('round-trip is a no-op when the file matches the DB', () => {
    const parsed = [row(1, 'Mary', 'Jones', 'Jane Doe')];
    const existing = [{ studentId: 's2', leaderId: 'l1' }];
    const plan = planAllocationSync(parsed, STUDENTS, LEADERS, existing);
    expect(plan.toAdd).toHaveLength(0);
    expect(plan.toRemove).toHaveLength(0);
    expect(plan.report.connectionsUnchanged).toBe(1);
  });

  it('leaves students absent from the file untouched', () => {
    const parsed = [row(1, 'Mary', 'Jones', 'Jane Doe')];
    const existing = [{ studentId: 's2', leaderId: 'l1' }, { studentId: 's2', leaderId: 'l2' }];
    // Note: Mary IS in the file, so her l2 would normally be removed.
    // Assert a DIFFERENT student (not in file) is never touched by using only Mary in file:
    const plan = planAllocationSync([], STUDENTS, LEADERS, existing);
    expect(plan.toRemove).toHaveLength(0);
    expect(plan.report.studentsInFile).toBe(0);
  });

  it('typo-safety: an unmatched leader skips that student’s removals but keeps adds', () => {
    const parsed = [row(1, 'Mary', 'Jones', 'Jane Doe'), row(2, 'Mary', 'Jones', 'Jane Doh')];
    const existing = [{ studentId: 's2', leaderId: 'l2' }]; // Mary -> Bob Lee (would be removed if no typo)
    const plan = planAllocationSync(parsed, STUDENTS, LEADERS, existing);
    expect(plan.toAdd).toEqual([{ studentId: 's2', leaderId: 'l1' }]); // Jane Doe still added
    expect(plan.toRemove).toHaveLength(0); // removals skipped
    expect(plan.report.unmatchedLeaders).toEqual([{ row: 2, name: 'Jane Doh', student: 'Mary Jones' }]);
    expect(plan.report.studentsWithSkippedRemovals).toEqual(['Mary Jones']);
  });

  it('reports unmatched students with row numbers', () => {
    const parsed = [row(1, 'Nobody', 'Here', 'Jane Doe')];
    const plan = planAllocationSync(parsed, STUDENTS, LEADERS, []);
    expect(plan.report.unmatchedStudents).toEqual([{ row: 1, name: 'Nobody Here' }]);
    expect(plan.report.studentsInFile).toBe(0);
  });

  it('reports ambiguous student and leader names', () => {
    const parsedStudent = [row(1, 'John', 'Smith', 'Jane Doe')];
    const ps = planAllocationSync(parsedStudent, STUDENTS, LEADERS, []);
    expect(ps.report.ambiguousStudents).toEqual([{ row: 1, name: 'John Smith' }]);

    const parsedLeader = [row(1, 'Mary', 'Jones', 'Bob Lee')];
    const pl = planAllocationSync(parsedLeader, STUDENTS, LEADERS, []);
    expect(pl.report.ambiguousLeaders).toEqual([{ row: 1, name: 'Bob Lee' }]);
    expect(pl.report.studentsWithSkippedRemovals).toEqual(['Mary Jones']);
  });

  it('blank-leader-only row clears a connected student', () => {
    const parsed = [row(1, 'Mary', 'Jones', '')];
    const existing = [{ studentId: 's2', leaderId: 'l1' }];
    const plan = planAllocationSync(parsed, STUDENTS, LEADERS, existing);
    expect(plan.toRemove).toEqual([{ studentId: 's2', leaderId: 'l1' }]);
    expect(plan.report.connectionsRemoved).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tests/connection-allocations.test.ts`
Expected: FAIL — `planAllocationSync` is not a function.

- [ ] **Step 3: Implement `planAllocationSync`**

Append to `src/services/connection-allocations.ts`:

```ts
type StudentLite = { id: string; firstName: string; lastName: string };
type LeaderLite = { id: string; fullName: string };
type ConnLite = { studentId: string; leaderId: string };

const nameKey = (a: string, b: string) => `${a} ${b}`.toLowerCase().trim();

export function planAllocationSync(
  parsed: ParsedAllocationRow[],
  students: StudentLite[],
  leaders: LeaderLite[],
  existing: ConnLite[],
): AllocationPlan {
  const report: AllocationImportReport = {
    studentsInFile: 0,
    connectionsAdded: 0,
    connectionsRemoved: 0,
    connectionsUnchanged: 0,
    unmatchedStudents: [],
    unmatchedLeaders: [],
    ambiguousStudents: [],
    ambiguousLeaders: [],
    studentsWithSkippedRemovals: [],
  };

  // Name -> records (length > 1 means ambiguous).
  const studentsByName = new Map<string, StudentLite[]>();
  for (const s of students) {
    const k = nameKey(s.firstName, s.lastName);
    (studentsByName.get(k) ?? studentsByName.set(k, []).get(k)!).push(s);
  }
  const leadersByName = new Map<string, LeaderLite[]>();
  for (const l of leaders) {
    const k = l.fullName.toLowerCase().trim();
    (leadersByName.get(k) ?? leadersByName.set(k, []).get(k)!).push(l);
  }

  // Per in-file student: desired leader ids + whether any of its rows had an
  // unmatched/ambiguous leader (which suppresses removals for that student).
  interface Entry { student: StudentLite; desired: Set<string>; blocked: boolean; display: string }
  const entries = new Map<string, Entry>();

  for (const r of parsed) {
    const display = `${r.firstName} ${r.lastName}`.trim();
    const sMatches = studentsByName.get(nameKey(r.firstName, r.lastName)) ?? [];
    if (sMatches.length === 0) { report.unmatchedStudents.push({ row: r.rowNum, name: display }); continue; }
    if (sMatches.length > 1) { report.ambiguousStudents.push({ row: r.rowNum, name: display }); continue; }
    const student = sMatches[0]!;

    let entry = entries.get(student.id);
    if (!entry) { entry = { student, desired: new Set(), blocked: false, display }; entries.set(student.id, entry); }

    if (!r.leaderName) continue; // blank-leader row: student is in-file with no leader to add

    const lMatches = leadersByName.get(r.leaderName.toLowerCase().trim()) ?? [];
    if (lMatches.length === 0) { report.unmatchedLeaders.push({ row: r.rowNum, name: r.leaderName, student: display }); entry.blocked = true; continue; }
    if (lMatches.length > 1) { report.ambiguousLeaders.push({ row: r.rowNum, name: r.leaderName }); entry.blocked = true; continue; }
    entry.desired.add(lMatches[0]!.id);
  }

  report.studentsInFile = entries.size;

  // Existing connections grouped by student.
  const existingByStudent = new Map<string, Set<string>>();
  for (const c of existing) {
    (existingByStudent.get(c.studentId) ?? existingByStudent.set(c.studentId, new Set()).get(c.studentId)!).add(c.leaderId);
  }

  const toAdd: AllocationPlanPair[] = [];
  const toRemove: AllocationPlanPair[] = [];

  for (const entry of entries.values()) {
    const existingSet = existingByStudent.get(entry.student.id) ?? new Set<string>();
    // Adds (matched desired pairs not already present).
    for (const leaderId of entry.desired) {
      if (existingSet.has(leaderId)) { report.connectionsUnchanged++; }
      else { toAdd.push({ studentId: entry.student.id, leaderId }); report.connectionsAdded++; }
    }
    // Removals — only when no unmatched/ambiguous leader appeared for this student.
    if (entry.blocked) {
      report.studentsWithSkippedRemovals.push(entry.display);
    } else {
      for (const leaderId of existingSet) {
        if (!entry.desired.has(leaderId)) { toRemove.push({ studentId: entry.student.id, leaderId }); report.connectionsRemoved++; }
      }
    }
  }

  return { toAdd, toRemove, report };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tests/connection-allocations.test.ts`
Expected: PASS (all planner tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/connection-allocations.ts src/tests/connection-allocations.test.ts
git commit -m "feat(allocations): per-student sync planner with typo-safety + reporting"
```

---

## Task 4: Pure module — `buildAllocationExportRows` (grouping + resilient sort)

**Files:**
- Modify: `src/services/connection-allocations.ts`
- Test: `src/tests/connection-allocations.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/tests/connection-allocations.test.ts`:

```ts
import { buildAllocationExportRows } from '../services/connection-allocations';

describe('buildAllocationExportRows', () => {
  const students = [
    { id: 's1', firstName: 'Zoe', lastName: 'Ash', grade: 9, gender: 'female' },
    { id: 's2', firstName: 'Amy', lastName: 'Bell', grade: 9, gender: 'female' },
    { id: 's3', firstName: 'Tom', lastName: 'Cole', grade: 7, gender: 'male' },
    { id: 's4', firstName: 'No', lastName: 'Grade', grade: null, gender: 'other' },
  ];
  const leaders = [{ id: 'l1', fullName: 'Bob Lee' }, { id: 'l2', fullName: 'Jane Doe' }];

  it('emits one row per pair, a blank-leader row for unconnected students, sorted gender>grade>name>leader', () => {
    const conns = [
      { studentId: 's1', leaderId: 'l2' }, // Zoe Ash -> Jane Doe
      { studentId: 's1', leaderId: 'l1' }, // Zoe Ash -> Bob Lee
      { studentId: 's3', leaderId: 'l1' }, // Tom Cole -> Bob Lee
      // s2 Amy Bell unconnected; s4 No Grade unconnected
    ];
    const rows = buildAllocationExportRows(students, leaders, conns);
    expect(rows).toEqual([
      // female first; grade 9 ascending; by last name Ash before Bell; Zoe's leaders sorted Bob<Jane
      { firstName: 'Zoe', lastName: 'Ash', grade: 9, gender: 'female', leader: 'Bob Lee' },
      { firstName: 'Zoe', lastName: 'Ash', grade: 9, gender: 'female', leader: 'Jane Doe' },
      { firstName: 'Amy', lastName: 'Bell', grade: 9, gender: 'female', leader: '' },
      // male next; grade 7
      { firstName: 'Tom', lastName: 'Cole', grade: 7, gender: 'male', leader: 'Bob Lee' },
      // other gender + null grade sorts last
      { firstName: 'No', lastName: 'Grade', grade: null, gender: 'other', leader: '' },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tests/connection-allocations.test.ts`
Expected: FAIL — `buildAllocationExportRows` is not a function.

- [ ] **Step 3: Implement `buildAllocationExportRows`**

Append to `src/services/connection-allocations.ts`:

```ts
type StudentExportLite = { id: string; firstName: string; lastName: string; grade: number | null; gender: string };

function genderRank(g: string): number {
  const s = (g || '').toLowerCase();
  if (s === 'female') return 0;
  if (s === 'male') return 1;
  return 2; // other/unknown sorts last
}
const gradeRank = (g: number | null) => (g == null ? Number.MAX_SAFE_INTEGER : g);

export function buildAllocationExportRows(
  students: StudentExportLite[],
  leaders: LeaderLite[],
  connections: ConnLite[],
): AllocationExportRow[] {
  const leaderById = new Map(leaders.map((l) => [l.id, l.fullName]));
  const leaderNamesByStudent = new Map<string, string[]>();
  for (const c of connections) {
    const name = leaderById.get(c.leaderId);
    if (!name) continue; // orphaned connection — skip
    (leaderNamesByStudent.get(c.studentId) ?? leaderNamesByStudent.set(c.studentId, []).get(c.studentId)!).push(name);
  }

  const rows: AllocationExportRow[] = [];
  for (const s of students) {
    const base = { firstName: s.firstName, lastName: s.lastName, grade: s.grade, gender: s.gender };
    const names = leaderNamesByStudent.get(s.id) ?? [];
    if (names.length === 0) {
      rows.push({ ...base, leader: '' });
    } else {
      for (const leader of names) rows.push({ ...base, leader });
    }
  }

  rows.sort((a, b) =>
    genderRank(a.gender) - genderRank(b.gender) ||
    gradeRank(a.grade) - gradeRank(b.grade) ||
    a.lastName.toLowerCase().localeCompare(b.lastName.toLowerCase()) ||
    a.firstName.toLowerCase().localeCompare(b.firstName.toLowerCase()) ||
    a.leader.toLowerCase().localeCompare(b.leader.toLowerCase()), // '' sorts first within a student
  );
  return rows;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tests/connection-allocations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/connection-allocations.ts src/tests/connection-allocations.test.ts
git commit -m "feat(allocations): export-row builder with resilient gender>grade>name>leader sort"
```

---

## Task 5: ConnectionService — `exportAllocations` + `importAllocations`

**Files:**
- Modify: `src/services/connection.service.ts` (interface near `:37-45`; implementation inside `makeConnectionService`)
- Test: `src/tests/connection-allocations.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/tests/connection-allocations.test.ts`:

```ts
import { makeConnectionService } from '../services/connection.service';
import { makeStudentService } from '../services/student.service';
import { makeLeaderService } from '../services/leader.service';
import {
  InMemoryStudentRepository,
  InMemoryLeaderRepository,
  InMemoryConnectionRepository,
  InMemorySettingsRepository,
} from '../repositories/in-memory';
import { ForbiddenError } from '../core/errors/app-error';

const ADMIN: Actor = { id: 'admin', role: 'admin' as any, displayName: 'Admin', grade: null as any, quad: null as any };
const DIRECTOR: Actor = { id: 'dir', role: 'director' as any, displayName: 'Dir', grade: null as any, quad: null as any };

async function buildAllocSvc() {
  const studentRepo = new InMemoryStudentRepository();
  const leaderRepo = new InMemoryLeaderRepository();
  const connRepo = new InMemoryConnectionRepository();
  const settingsRepo = new InMemorySettingsRepository();
  await studentRepo.init(); await leaderRepo.init(); await connRepo.init(); await settingsRepo.init();
  const studentSvc = makeStudentService(studentRepo);
  const leaderSvc = makeLeaderService(leaderRepo);
  const connSvc = makeConnectionService(connRepo, studentRepo, leaderRepo, settingsRepo);
  const alice = await studentSvc.create(ADMIN, { firstName: 'Alice', lastName: 'Smith', gender: 'female', grade: 9 });
  const emma = await leaderSvc.create(ADMIN, { fullName: 'Emma Leader', gender: 'female', grades: [9] });
  return { connSvc, alice, emma };
}

describe('ConnectionService allocations', () => {
  it('exportAllocations emits a blank-leader row for an unconnected student', async () => {
    const { connSvc, alice } = await buildAllocSvc();
    const rows = await connSvc.exportAllocations(ADMIN);
    expect(rows).toEqual([{ firstName: 'Alice', lastName: 'Smith', grade: 9, gender: 'female', leader: '' }]);
    void alice;
  });

  it('importAllocations adds a matched connection and round-trips to a no-op', async () => {
    const { connSvc } = await buildAllocSvc();
    const r1 = await connSvc.importAllocations(ADMIN, [
      { 'first name': 'Alice', 'last name': 'Smith', leader: 'Emma Leader' },
    ]);
    expect(r1.connectionsAdded).toBe(1);
    const rows = await connSvc.exportAllocations(ADMIN);
    expect(rows).toEqual([{ firstName: 'Alice', lastName: 'Smith', grade: 9, gender: 'female', leader: 'Emma Leader' }]);
    // Re-import the same data -> no changes.
    const r2 = await connSvc.importAllocations(ADMIN, [
      { 'first name': 'Alice', 'last name': 'Smith', leader: 'Emma Leader' },
    ]);
    expect(r2.connectionsAdded).toBe(0);
    expect(r2.connectionsRemoved).toBe(0);
    expect(r2.connectionsUnchanged).toBe(1);
  });

  it('rejects non-admin callers', async () => {
    const { connSvc } = await buildAllocSvc();
    await expect(connSvc.exportAllocations(DIRECTOR)).rejects.toThrow(ForbiddenError);
    await expect(connSvc.importAllocations(DIRECTOR, [])).rejects.toThrow(ForbiddenError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tests/connection-allocations.test.ts`
Expected: FAIL — `connSvc.exportAllocations` / `importAllocations` are not functions.

- [ ] **Step 3: Implement the two service methods**

In `src/services/connection.service.ts`:

3a. Add imports at the top (after the existing imports):

```ts
import {
  parseAllocationRows,
  planAllocationSync,
  buildAllocationExportRows,
  type AllocationExportRow,
  type AllocationImportReport,
} from './connection-allocations';
```

3b. Extend the `ConnectionService` interface (after `exportCsv(actor: Actor): Promise<ExportRow[]>;`):

```ts
  exportAllocations(actor: Actor): Promise<AllocationExportRow[]>;
  importAllocations(actor: Actor, rows: unknown): Promise<AllocationImportReport>;
```

3c. Add the implementations inside the returned object (after `exportCsv`):

```ts
    async exportAllocations(actor) {
      assertCan(actor, 'connection:import');
      const [students, leaders, connections] = await Promise.all([
        studentRepo.findAll(),
        leaderRepo.findAll(),
        connRepo.findAll(),
      ]);
      return buildAllocationExportRows(students, leaders, connections);
    },

    async importAllocations(actor, rows) {
      assertCan(actor, 'connection:import');
      const inputRows = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
      const parsed = parseAllocationRows(inputRows);
      const [students, leaders, connections] = await Promise.all([
        studentRepo.findAll(),
        leaderRepo.findAll(),
        connRepo.findAll(),
      ]);
      const plan = planAllocationSync(parsed, students, leaders, connections);
      const now = new Date().toISOString();
      for (const pair of plan.toAdd) {
        await connRepo.save({
          id: generateId(),
          studentId: pair.studentId,
          leaderId: pair.leaderId,
          assignedByRole: actor.role,
          createdAt: now,
        });
      }
      for (const pair of plan.toRemove) {
        await connRepo.deleteByStudentAndLeader(pair.studentId, pair.leaderId);
      }
      return plan.report;
    },
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/tests/connection-allocations.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/services/connection.service.ts src/tests/connection-allocations.test.ts
git commit -m "feat(allocations): exportAllocations + importAllocations service methods"
```

---

## Task 6: Controller + routes

**Files:**
- Modify: `src/api/controllers/connection.controller.ts` (after `exportCsv`, before the closing `};`)
- Modify: `src/api/http/router.ts:66` (add routes right after `/connections/export`)

- [ ] **Step 1: Add the controller handlers**

In `src/api/controllers/connection.controller.ts`, add inside the returned object (after the `exportCsv` handler):

```ts
    async exportAllocations(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const rows = await deps.connection.exportAllocations(req.ctx);
      const header = 'First Name,Last Name,Grade,Gender,Leader';
      const lines = rows.map((r) =>
        [r.firstName, r.lastName, r.grade ?? '', r.gender, r.leader]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(','),
      );
      return { csv: [header, ...lines].join('\n'), rowCount: rows.length };
    },

    async importAllocations(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const rows = (req.body as { rows?: unknown })?.rows;
      return deps.connection.importAllocations(req.ctx, rows);
    },
```

- [ ] **Step 2: Add the routes**

In `src/api/http/router.ts`, add immediately after the `/connections/export` line (`:66`):

```ts
    { method: 'GET',  path: '/connections/allocations/export', auth: true, handler: (r) => connection.exportAllocations(r) },
    { method: 'POST', path: '/connections/allocations/import', auth: true, handler: (r) => connection.importAllocations(r) },
```

- [ ] **Step 3: Verify the whole suite + typecheck**

Run: `npm run typecheck`
Expected: no errors.
Run: `npm run test`
Expected: all tests pass (the existing suite plus the new `connection-allocations.test.ts`).

- [ ] **Step 4: Commit**

```bash
git add src/api/controllers/connection.controller.ts src/api/http/router.ts
git commit -m "feat(allocations): admin-only export/import connection allocation routes"
```

---

## Task 7: SPA — parser, export, import, result modal, Admin card

**Files:**
- Modify: `public/index.html` (add functions near the other import/export helpers ~`:2897`; add the Admin card in `renderAdminView` `_adminTab === 'data'` block ~`:3176`)

No automated test harness exists for the SPA (per `CLAUDE.md`, the SPA is verified manually). Steps 4–5 are a manual run.

- [ ] **Step 1: Add a generic allocation CSV parser + export/import handlers**

In `public/index.html`, after `function rowsToCsv(...)` (~`:2897`), add:

```js
// Generic CSV -> array of objects keyed by lowercased header. Unlike parseCSV
// (which is tailored to the attendance import and drops unknown columns), this
// preserves every column — needed so the "Leader" column survives for the
// allocation import. Server does the agnostic header detection.
function parseAllocationCSV(csv) {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = splitCSVLine(lines[0]).map(h => h.replace(/^"|"$/g, '').toLowerCase().trim());
  return lines.slice(1).map(line => {
    const vals = splitCSVLine(line).map(v => v.replace(/^"|"$/g, ''));
    const obj = {};
    headers.forEach((h, i) => { if (h) obj[h] = (vals[i] || '').trim(); });
    return obj;
  }).filter(o => Object.values(o).some(v => v));
}

async function exportAllocationsCSV() {
  try {
    const { csv, rowCount } = await API.get('/connections/allocations/export');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'allocations.csv'; a.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${rowCount} rows`);
  } catch (e) { toast('Export failed: ' + e.message); }
}

function handleAllocationImportFile(input) { const f = input.files[0]; if (f) processAllocationImport(f); }

function processAllocationImport(file) {
  const statusEl = document.getElementById('alloc-import-status');
  const isExcel = /\.xlsx?$/i.test(file.name);
  statusEl.innerHTML = `<div class="alert al-info"><div class="spin" style="margin-right:8px"></div>Parsing ${isExcel ? 'Excel' : 'CSV'}…</div>`;
  const reader = new FileReader();
  reader.onload = async (e) => {
    let rows;
    try {
      rows = isExcel ? parseAllocationCSV(rowsToCsv(await readXlsx(e.target.result))) : parseAllocationCSV(e.target.result);
    } catch (err) { statusEl.innerHTML = `<div class="alert al-err">${(err && err.message) || 'Could not read this file'}</div>`; return; }
    if (!rows.length) { statusEl.innerHTML = '<div class="alert al-err">No rows found</div>'; return; }
    statusEl.innerHTML = `<div class="alert al-info">Found ${rows.length} rows. Importing…</div>`;
    try {
      const report = await API.post('/connections/allocations/import', { rows }, 90000);
      Cache.clear();
      statusEl.innerHTML = `<div class="alert al-ok" style="display:flex;align-items:center;gap:6px">${icS('check')} Imported: ${report.connectionsAdded} added, ${report.connectionsRemoved} removed, ${report.connectionsUnchanged} unchanged</div>`;
      showAllocationReport(report);
    } catch (err) { statusEl.innerHTML = `<div class="alert al-err">Import failed: ${err.message}</div>`; }
  };
  if (isExcel) reader.readAsArrayBuffer(file); else reader.readAsText(file);
}

// Result modal — counts plus collapsible lists of anything not fully applied.
function showAllocationReport(r) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const sec = (id, title, items, render) => {
    if (!items.length) return '';
    return `<div class="card drop" id="${id}" style="margin-bottom:8px;padding:11px">
      <div class="drop-head" style="display:flex;align-items:center;gap:8px;cursor:pointer" onclick="_drop('${id}')">
        <span class="drop-chev" style="font-size:12px;color:var(--ink-faint);font-weight:800">›</span>
        <div style="flex:1;font-size:13px;font-weight:700">${title} (${items.length})</div>
      </div>
      <div class="drop-body"><div style="font-size:12px;color:var(--ink-mid);padding-top:6px">${items.map(render).join('')}</div></div>
    </div>`;
  };
  let h = `<div class="mo-title" style="font-size:16px;font-weight:800;margin-bottom:8px">Allocation import result</div>`;
  h += `<div style="font-size:13px;color:var(--ink-mid);margin-bottom:12px">${r.studentsInFile} students in file · <b>${r.connectionsAdded}</b> added · <b>${r.connectionsRemoved}</b> removed · ${r.connectionsUnchanged} unchanged</div>`;
  h += sec('ar-us', 'Unmatched students', r.unmatchedStudents, x => `<div>Row ${x.row}: ${esc(x.name)}</div>`);
  h += sec('ar-ul', 'Unmatched leaders', r.unmatchedLeaders, x => `<div>Row ${x.row}: ${esc(x.name)} <span style="color:var(--ink-faint)">(student: ${esc(x.student)})</span></div>`);
  h += sec('ar-as', 'Ambiguous students', r.ambiguousStudents, x => `<div>Row ${x.row}: ${esc(x.name)}</div>`);
  h += sec('ar-al', 'Ambiguous leaders', r.ambiguousLeaders, x => `<div>Row ${x.row}: ${esc(x.name)}</div>`);
  h += sec('ar-sr', 'Students with removals skipped (had an unmatched leader)', r.studentsWithSkippedRemovals.map(name => ({ name })), x => `<div>${esc(x.name)}</div>`);
  const clean = !r.unmatchedStudents.length && !r.unmatchedLeaders.length && !r.ambiguousStudents.length && !r.ambiguousLeaders.length && !r.studentsWithSkippedRemovals.length;
  if (clean) h += `<div class="alert al-ok" style="display:flex;align-items:center;gap:6px">${icS('check')} Every row matched cleanly.</div>`;
  h += `<button class="btn btn-primary btn-full" style="margin-top:12px" onclick="closeModal()">Done</button>`;
  modal(h);
}
```

- [ ] **Step 2: Add the Admin "Connection Allocations" card**

In `renderAdminView`, at the **start** of the `if (_adminTab === 'data') {` block (immediately after the `{`, before the existing `body += ...` save-defaults card at `:3178`), insert:

```js
    body += `<div class="card">
      <div class="sh" style="margin-top:0">Connection Allocations</div>
      <div class="help-text" style="margin-bottom:10px">Export every student–leader allocation as a CSV (one leader per row, grouped by student), edit it, then re-import. Import matches students and leaders by name and reports anything it can't match. Students missing from the file are left untouched.</div>
      <button class="btn btn-secondary btn-full" style="margin-bottom:8px" onclick="exportAllocationsCSV()">Export Allocations</button>
      <label class="btn btn-secondary btn-full" style="cursor:pointer">Import Allocations
        <input type="file" accept=".csv,.xlsx" style="display:none" onchange="handleAllocationImportFile(this)">
      </label>
      <div id="alloc-import-status" style="margin-top:8px"></div>
    </div>`;
```

- [ ] **Step 3: Typecheck (backend unaffected, sanity only)**

Run: `npm run typecheck`
Expected: no errors (the SPA is plain JS; this confirms nothing in `src/` broke).

- [ ] **Step 4: Manual verification — run the app**

Run: `npm run dev` (starts on http://localhost:4300 with `PERSISTENCE=memory` seed data — confirm the dev script sets memory mode; if not, prefix `PERSISTENCE=memory`).
Then in the browser:
1. Log in as `admin@youth.ministry` / `demo1234`.
2. Admin → **Data** tab → **Export Allocations**. Confirm `allocations.csv` downloads with header `First Name,Last Name,Grade,Gender,Leader`, rows grouped by student and sorted female→male, grade ascending; unconnected students appear with a blank Leader cell.
3. Edit the CSV: add a valid leader name to a blank-leader student, change one leader to a deliberate misspelling, delete a leader row from a student who has two.
4. **Import Allocations** → pick the edited file. Confirm the status line shows added/removed/unchanged and the modal lists the misspelled leader under "Unmatched leaders" and that student under "removals skipped".
5. Re-export and confirm the applied changes persisted; re-importing the unedited export reports 0 added / 0 removed.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat(allocations): admin SPA card, CSV parser, import result modal"
```

---

## Task 8: Documentation

**Files:**
- Modify: `CLAUDE.md` (Connections routes row `:58`; Frontend section)

- [ ] **Step 1: Update the routes table**

In `CLAUDE.md`, in the Connections row of the "Key API routes" table, append the two new endpoints:

```
| Connections | … `DELETE /connections/:studentId/:leaderId`, `GET /connections/allocations/export`, `POST /connections/allocations/import` (admin-only allocation CSV round-trip) |
```

- [ ] **Step 2: Add a Frontend note**

In `CLAUDE.md`, add a short bullet under the SPA/Frontend section:

```
- **Connection allocations** (admin only): Admin → Data tab exports/imports a student↔leader
  allocation CSV (`First Name,Last Name,Grade,Gender,Leader`, one pair per row, grouped by
  student). Import is name-matched and column-agnostic to grade/gender, syncs per student
  (students absent from the file are untouched), skips a student's removals if any of their
  leader names is unmatched, and returns a report of unmatched/ambiguous names. Logic lives in
  the pure `src/services/connection-allocations.ts`; `parseAllocationCSV` in the SPA preserves
  all columns (unlike attendance `parseCSV`).
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: connection allocation import/export routes + frontend notes"
```

---

## Self-Review

**Spec coverage:**
- Admin export with grade+gender columns → Task 4 (`buildAllocationExportRows`) + Task 6 (CSV header). ✓
- Column-agnostic, name-matched import → Task 2 (`parseAllocationRows`) + Task 3 (matching). ✓
- One pair per row, grouped by student, blank-leader rows for unconnected → Task 4. ✓
- Resilient sort gender→grade→name→leader with nulls last → Task 4. ✓
- Per-student sync, students absent untouched → Task 3. ✓
- Typo-safety (skip removals when a leader is unmatched) → Task 3. ✓
- Resilient unmatched/ambiguous reporting with row numbers → Task 3 + Task 7 modal. ✓
- Admin-only RBAC → Task 1 + Task 5 (`assertCan`) + Task 5 tests. ✓
- SPA Admin card + result modal + cache invalidation → Task 7. ✓
- Docs → Task 8. ✓

**Placeholder scan:** No TBD/TODO; every code step contains complete code. ✓

**Type consistency:** `AllocationExportRow`, `ParsedAllocationRow`, `AllocationImportReport`, `AllocationPlan`, `AllocationPlanPair` defined in Task 2/3/4 and used unchanged in Task 5/6/7. Method names `exportAllocations` / `importAllocations` / `parseAllocationRows` / `planAllocationSync` / `buildAllocationExportRows` / `parseAllocationCSV` / `exportAllocationsCSV` / `processAllocationImport` / `handleAllocationImportFile` / `showAllocationReport` are consistent across tasks. ✓

**Note for implementers:** The `(map.get(k) ?? map.set(k, []).get(k)!)` idiom used in Task 3/4 relies on `noUncheckedIndexedAccess`-safe access; it is intentional and type-checks under this repo's strict settings. If preferred, replace with an explicit `if (!map.has(k)) map.set(k, [])` block — behavior is identical.
