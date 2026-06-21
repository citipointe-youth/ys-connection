# Leader Workflow & Admin Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the SPA from a pastor-facing dashboard into a leader-facing weekly-workflow tool — adding a per-leader "follow-up" view, a persisted leader identity, calmer home/connect layouts, safer destructive controls, and a simpler self-routing data import.

**Architecture:** One new backend service (`followup.service.ts`) exposes per-leader "who to follow up with this week" data via a new route under the existing `/connections/...` prefix (so the service-worker `API_RE` already covers it — no cache gotcha). All other changes are inside the single-file SPA `public/index.html`: a persisted leader identity in `localStorage`, a home follow-up section, relocated/calmer summary widgets, a typed-confirmation helper for destructive actions, and a unified auto-routing import flow with a pre-upload preview.

**Tech Stack:** TypeScript (strict ESM, `moduleResolution: Bundler`, no `.js` extensions), Express, Vitest, vanilla-JS SPA (`public/index.html`), Supabase/in-memory/json repositories behind interfaces.

## Global Constraints

- **Backend layering:** `api → controllers → services → repositories (interfaces) → core`. Services depend on repository **interfaces** only. `src/container.ts` is the ONLY file that names concrete repositories. (CLAUDE.md "Architecture")
- **RBAC lives in one file** (`src/services/access-control.ts`); reuse `assertCan(actor, permission)`. Never scatter role checks. The follow-up endpoint uses the existing `leader:read` permission (same as `leaderSummary`).
- **Extensionless imports**, **strict TS** (`strict` + `noUncheckedIndexedAccess` + `noImplicitOverride`).
- **Tests:** Vitest, files under `src/tests/**/*.test.ts`. Run with `npm run test`. Typecheck with `npm run typecheck`.
- **Local dev** runs with seed data only when `PERSISTENCE=memory`: `npm run dev` → http://localhost:4300. Seed accounts use password `demo1234` (e.g. `grade9g@youth.ministry`, `admin@youth.ministry`).
- **SPA escaping:** every user-supplied string interpolated into `innerHTML` MUST be wrapped in the global `esc()` helper.
- **Service worker:** the new route is mounted under `/connections/...`, already matched by `API_RE` in `public/sw.js`. Do **not** add a new top-level API prefix without also adding it to `API_RE` and bumping `CACHE` (`cms-v4`).
- **Follow-up qualification rules (verbatim from spec):**
  - "Not seen at Friday" is derived only from students who attended **more than 50%** of services the **previous term** OR **at least once this term**.
  - "Not seen at Lifegroup" is derived only from students who attended **more than 50%** of groups the **previous term** OR **at least one group this term**.
  - The follow-up lists must **not** mark/show "declining".
- **No per-leader login** is introduced. Leader identity is a per-device `localStorage` selection only.

---

### Task 1: Follow-up pure helpers

Pure, dependency-free functions that encode the birthday-this-week and eligibility rules and assemble the three follow-up lists. These carry all the business logic and get exhaustive unit tests; the service in Task 2 is a thin repository wrapper around them.

**Files:**
- Create: `src/services/followup.service.ts` (pure helpers only in this task; the factory is added in Task 2)
- Test: `src/tests/followup.service.test.ts`

**Interfaces:**
- Consumes: `Student` from `../core/entities/student` (fields used: `id, firstName, lastName, grade, gender, dateOfBirth, mobile, parentPhone, svcAttended, grpAttended, prevSvcAttended, prevSvcTotal, prevGrpAttended, prevGrpTotal`).
- Produces:
  - `interface FollowupStudent { id: string; fullName: string; grade: number | null; gender: string; dateOfBirth: string | null; mobile: string | null; parentPhone: string | null; }`
  - `isBirthdayInWeek(dob: string | null, today: Date): boolean`
  - `isServiceEligible(s: { svcAttended: number; prevSvcAttended: number; prevSvcTotal: number }): boolean`
  - `isGroupEligible(s: { grpAttended: number; prevGrpAttended: number; prevGrpTotal: number }): boolean`
  - `buildFollowup(students, latestSvcAttendees, latestGrpAttendees, latestSvcDate, latestGrpDate, today): { birthdays: FollowupStudent[]; notSeenService: FollowupStudent[]; notSeenGroup: FollowupStudent[] }`

- [ ] **Step 1: Write the failing test**

Create `src/tests/followup.service.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  isBirthdayInWeek,
  isServiceEligible,
  isGroupEligible,
  buildFollowup,
} from '../services/followup.service';
import type { Student } from '../core/entities/student';

function student(over: Partial<Student>): Student {
  return {
    id: 'id', firstName: 'Test', lastName: 'Student', gender: 'female', grade: 9, quad: 'g79',
    mobile: null, parentPhone: null, dateOfBirth: null,
    svcAttended: 0, svcTotal: 0, grpAttended: 0, grpTotal: 0, grpMetWeeks: 0,
    prevSvcAttended: 0, prevSvcTotal: 0, prevGrpAttended: 0, prevGrpTotal: 0,
    atRiskStatus: null, dataSource: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('isBirthdayInWeek', () => {
  // Wednesday 2026-06-17 sits in the Mon 2026-06-15 .. Sun 2026-06-21 week.
  const wed = new Date(2026, 5, 17);
  it('true when the birthday month/day falls in the current Mon–Sun week', () => {
    expect(isBirthdayInWeek('2009-06-18', wed)).toBe(true); // Thursday this week
  });
  it('true on the Monday boundary', () => {
    expect(isBirthdayInWeek('2010-06-15', wed)).toBe(true);
  });
  it('true on the Sunday boundary', () => {
    expect(isBirthdayInWeek('2010-06-21', wed)).toBe(true);
  });
  it('false when outside the week', () => {
    expect(isBirthdayInWeek('2010-06-22', wed)).toBe(false);
  });
  it('false for null / malformed dates', () => {
    expect(isBirthdayInWeek(null, wed)).toBe(false);
    expect(isBirthdayInWeek('not-a-date', wed)).toBe(false);
  });
  it('ignores the birth year, matches on month/day only', () => {
    expect(isBirthdayInWeek('1999-06-19T00:00:00.000Z', wed)).toBe(true);
  });
});

describe('isServiceEligible', () => {
  it('true when attended at least once this term', () => {
    expect(isServiceEligible({ svcAttended: 1, prevSvcAttended: 0, prevSvcTotal: 0 })).toBe(true);
  });
  it('true when attended > 50% of previous term', () => {
    expect(isServiceEligible({ svcAttended: 0, prevSvcAttended: 6, prevSvcTotal: 10 })).toBe(true);
  });
  it('false at exactly 50% of previous term with none this term', () => {
    expect(isServiceEligible({ svcAttended: 0, prevSvcAttended: 5, prevSvcTotal: 10 })).toBe(false);
  });
  it('false when never attended either term', () => {
    expect(isServiceEligible({ svcAttended: 0, prevSvcAttended: 0, prevSvcTotal: 0 })).toBe(false);
  });
});

describe('isGroupEligible', () => {
  it('true when attended at least one group this term', () => {
    expect(isGroupEligible({ grpAttended: 1, prevGrpAttended: 0, prevGrpTotal: 0 })).toBe(true);
  });
  it('true when attended > 50% of groups previous term', () => {
    expect(isGroupEligible({ grpAttended: 0, prevGrpAttended: 7, prevGrpTotal: 10 })).toBe(true);
  });
  it('false at exactly 50% with none this term', () => {
    expect(isGroupEligible({ grpAttended: 0, prevGrpAttended: 5, prevGrpTotal: 10 })).toBe(false);
  });
});

describe('buildFollowup', () => {
  const wed = new Date(2026, 5, 17);
  const eligibleSeen = student({ id: 's1', firstName: 'Ann', svcAttended: 3, grpAttended: 2, dateOfBirth: '2009-06-18' });
  const eligibleMissed = student({ id: 's2', firstName: 'Bea', svcAttended: 2, grpAttended: 2 });
  const ineligible = student({ id: 's3', firstName: 'Cara', svcAttended: 0, grpAttended: 0 });

  it('birthdays list contains only students with a birthday this week', () => {
    const r = buildFollowup([eligibleSeen, eligibleMissed, ineligible], new Set(['s1']), new Set(['s1']), '2026-06-19', '2026-06-15', wed);
    expect(r.birthdays.map(s => s.id)).toEqual(['s1']);
  });
  it('notSeenService = eligible students NOT in the latest-service attendee set', () => {
    const r = buildFollowup([eligibleSeen, eligibleMissed, ineligible], new Set(['s1']), new Set(['s1']), '2026-06-19', '2026-06-15', wed);
    expect(r.notSeenService.map(s => s.id)).toEqual(['s2']);
  });
  it('notSeenGroup = group-eligible students NOT in the latest-week attendee set', () => {
    const r = buildFollowup([eligibleSeen, eligibleMissed, ineligible], new Set(['s1']), new Set(['s1']), '2026-06-19', '2026-06-15', wed);
    expect(r.notSeenGroup.map(s => s.id)).toEqual(['s2']);
  });
  it('returns empty service/group lists when there is no latest session/week', () => {
    const r = buildFollowup([eligibleMissed], new Set(), new Set(), null, null, wed);
    expect(r.notSeenService).toEqual([]);
    expect(r.notSeenGroup).toEqual([]);
  });
  it('lists are sorted by full name', () => {
    const zed = student({ id: 's9', firstName: 'Zed', svcAttended: 2 });
    const r = buildFollowup([zed, eligibleMissed], new Set(), new Set(), '2026-06-19', null, wed);
    expect(r.notSeenService.map(s => s.fullName)).toEqual(['Bea Student', 'Zed Student']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- followup`
Expected: FAIL — `Cannot find module '../services/followup.service'` (file does not exist yet).

- [ ] **Step 3: Write the pure helpers**

Create `src/services/followup.service.ts`:

```ts
import type { Student } from '../core/entities/student';

export interface FollowupStudent {
  id: string;
  fullName: string;
  grade: number | null;
  gender: string;
  dateOfBirth: string | null;
  mobile: string | null;
  parentPhone: string | null;
}

// True if the student's birthday (month + day, year ignored) lands in the
// Mon–Sun week containing `today`. Iterating the 7 days of the week makes this
// correct across month/year boundaries.
export function isBirthdayInWeek(dob: string | null, today: Date): boolean {
  if (!dob) return false;
  const parts = String(dob).slice(0, 10).split('-');
  if (parts.length !== 3) return false;
  const bMonth = Number(parts[1]);
  const bDay = Number(parts[2]);
  if (!bMonth || !bDay) return false;
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const mondayOffset = (base.getDay() + 6) % 7; // 0 = Monday
  const monday = new Date(base);
  monday.setDate(base.getDate() - mondayOffset);
  for (let i = 0; i < 7; i++) {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    if (day.getMonth() + 1 === bMonth && day.getDate() === bDay) return true;
  }
  return false;
}

// Eligible for the "Not seen at Friday" list: a normally-attending student —
// attended at least once this term, OR more than 50% of services last term.
export function isServiceEligible(s: { svcAttended: number; prevSvcAttended: number; prevSvcTotal: number }): boolean {
  if (s.svcAttended >= 1) return true;
  return s.prevSvcTotal > 0 && s.prevSvcAttended / s.prevSvcTotal > 0.5;
}

// Eligible for the "Not seen at Lifegroup" list: attended at least one group
// this term, OR more than 50% of groups last term.
export function isGroupEligible(s: { grpAttended: number; prevGrpAttended: number; prevGrpTotal: number }): boolean {
  if (s.grpAttended >= 1) return true;
  return s.prevGrpTotal > 0 && s.prevGrpAttended / s.prevGrpTotal > 0.5;
}

function toFollowup(s: Student): FollowupStudent {
  return {
    id: s.id,
    fullName: `${s.firstName} ${s.lastName}`,
    grade: s.grade,
    gender: s.gender,
    dateOfBirth: s.dateOfBirth,
    mobile: s.mobile,
    parentPhone: s.parentPhone,
  };
}

const byName = (a: FollowupStudent, b: FollowupStudent) => a.fullName.localeCompare(b.fullName);

// Assemble the three follow-up lists from the leader's students plus the
// attendee sets for the most recent service session and lifegroup week.
export function buildFollowup(
  students: Student[],
  latestSvcAttendees: Set<string>,
  latestGrpAttendees: Set<string>,
  latestSvcDate: string | null,
  latestGrpDate: string | null,
  today: Date,
): { birthdays: FollowupStudent[]; notSeenService: FollowupStudent[]; notSeenGroup: FollowupStudent[] } {
  const birthdays = students.filter((s) => isBirthdayInWeek(s.dateOfBirth, today)).map(toFollowup).sort(byName);
  const notSeenService = latestSvcDate
    ? students.filter((s) => isServiceEligible(s) && !latestSvcAttendees.has(s.id)).map(toFollowup).sort(byName)
    : [];
  const notSeenGroup = latestGrpDate
    ? students.filter((s) => isGroupEligible(s) && !latestGrpAttendees.has(s.id)).map(toFollowup).sort(byName)
    : [];
  return { birthdays, notSeenService, notSeenGroup };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- followup`
Expected: PASS (all `describe` blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/services/followup.service.ts src/tests/followup.service.test.ts
git commit -m "feat: add follow-up pure helpers (birthday-week + eligibility rules)"
```

---

### Task 2: Follow-up service factory

Wrap the Task 1 helpers in a service that resolves the most-recent valid service session and most-recent lifegroup week from the repositories, builds the attendee sets, and returns the per-leader follow-up payload.

**Files:**
- Modify: `src/services/followup.service.ts` (append the factory + types)
- Test: `src/tests/followup.service.test.ts` (append a service-level test)

**Interfaces:**
- Consumes (repository interfaces from `../repositories/interfaces`): `IConnectionRepository`, `IStudentRepository`, `ILeaderRepository`, `IServiceSessionRepository` (`findValid()`), `IServiceAttendanceRepository` (`findBySession()`), `ILifegroupWeekRepository` (`findAll()`), `ILifegroupAttendanceRepository` (`findByWeek()`). `assertCan` from `./access-control`. `NotFoundError` from `../core/errors/app-error`. `Actor` from `../core/entities/user`.
- Produces:
  - `interface LeaderFollowup { leader: { id: string; fullName: string }; latestSvcDate: string | null; latestGrpDate: string | null; birthdays: FollowupStudent[]; notSeenService: FollowupStudent[]; notSeenGroup: FollowupStudent[]; }`
  - `interface FollowupService { leaderFollowup(actor: Actor, leaderId: string): Promise<LeaderFollowup>; }`
  - `makeFollowupService(connRepo, studentRepo, leaderRepo, sessionRepo, svcAttRepo, weekRepo, grpAttRepo): FollowupService`

- [ ] **Step 1: Write the failing test**

Append to `src/tests/followup.service.test.ts`:

```ts
import { describe as describe2, it as it2, expect as expect2 } from 'vitest';
import { makeFollowupService } from '../services/followup.service';
import {
  InMemoryConnectionRepository,
  InMemoryStudentRepository,
  InMemoryLeaderRepository,
  InMemoryServiceSessionRepository,
  InMemoryServiceAttendanceRepository,
  InMemoryLifegroupWeekRepository,
  InMemoryLifegroupAttendanceRepository,
} from '../repositories/in-memory';
import type { Actor } from '../core/entities/user';

const ADMIN: Actor = { id: 'a', role: 'admin' as any, displayName: 'A', grade: null as any, quad: null as any };

describe2('makeFollowupService.leaderFollowup', () => {
  it2('returns not-seen lists for connected, eligible students who missed the latest session/week', async () => {
    const connRepo = new InMemoryConnectionRepository();
    const studentRepo = new InMemoryStudentRepository();
    const leaderRepo = new InMemoryLeaderRepository();
    const sessionRepo = new InMemoryServiceSessionRepository();
    const svcAttRepo = new InMemoryServiceAttendanceRepository();
    const weekRepo = new InMemoryLifegroupWeekRepository();
    const grpAttRepo = new InMemoryLifegroupAttendanceRepository();
    for (const r of [connRepo, studentRepo, leaderRepo, sessionRepo, svcAttRepo, weekRepo, grpAttRepo]) await r.init();

    const leader = await leaderRepo.save({ id: 'L1', fullName: 'Em Leader', gender: 'female', grades: [9], active: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } as any);
    const base = { gender: 'female', grade: 9, quad: 'g79', mobile: null, parentPhone: null, dateOfBirth: null, svcTotal: 4, grpTotal: 4, grpMetWeeks: 4, prevSvcAttended: 0, prevSvcTotal: 0, prevGrpAttended: 0, prevGrpTotal: 0, atRiskStatus: null, dataSource: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    const seen = await studentRepo.save({ id: 'S1', firstName: 'Ann', lastName: 'A', svcAttended: 3, grpAttended: 3, ...base } as any);
    const missed = await studentRepo.save({ id: 'S2', firstName: 'Bea', lastName: 'B', svcAttended: 2, grpAttended: 2, ...base } as any);
    await connRepo.save({ id: 'C1', studentId: seen.id, leaderId: leader.id, createdAt: '2026-01-01T00:00:00.000Z' } as any);
    await connRepo.save({ id: 'C2', studentId: missed.id, leaderId: leader.id, createdAt: '2026-01-01T00:00:00.000Z' } as any);

    const older = await sessionRepo.save({ id: 'SS0', importId: 'i', sessionDate: '2026-06-05', sessionName: 'old', isRegular: true, isValid: true, totalAttendance: 200, sortOrder: 0, createdAt: '2026-01-01T00:00:00.000Z' } as any);
    const latest = await sessionRepo.save({ id: 'SS1', importId: 'i', sessionDate: '2026-06-12', sessionName: 'latest', isRegular: true, isValid: true, totalAttendance: 200, sortOrder: 1, createdAt: '2026-01-01T00:00:00.000Z' } as any);
    void older;
    await svcAttRepo.saveMany([{ studentId: seen.id, sessionId: latest.id, attended: true }]); // missed has no record for latest

    const week = await weekRepo.save({ id: 'W1', importId: 'i', weekNum: 1, weekKey: '2026-06-08', weekStart: '2026-06-08', weekEnd: '2026-06-14' } as any);
    await grpAttRepo.saveMany([{ studentId: seen.id, weekId: week.id, lifegroupId: 'g', groupMet: true, attended: true }]);

    const svc = makeFollowupService(connRepo, studentRepo, leaderRepo, sessionRepo, svcAttRepo, weekRepo, grpAttRepo);
    const out = await svc.leaderFollowup(ADMIN, leader.id);

    expect2(out.leader.fullName).toBe('Em Leader');
    expect2(out.latestSvcDate).toBe('2026-06-12');
    expect2(out.latestGrpDate).toBe('2026-06-08');
    expect2(out.notSeenService.map((s) => s.id)).toEqual(['S2']);
    expect2(out.notSeenGroup.map((s) => s.id)).toEqual(['S2']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- followup`
Expected: FAIL — `makeFollowupService is not a function` / not exported.

- [ ] **Step 3: Append the factory to `src/services/followup.service.ts`**

Add these imports at the top of `src/services/followup.service.ts` (below the existing `Student` import):

```ts
import type {
  IConnectionRepository,
  IStudentRepository,
  ILeaderRepository,
  IServiceSessionRepository,
  IServiceAttendanceRepository,
  ILifegroupWeekRepository,
  ILifegroupAttendanceRepository,
} from '../repositories/interfaces';
import type { Actor } from '../core/entities/user';
import { assertCan } from './access-control';
import { NotFoundError } from '../core/errors/app-error';
```

Append at the end of the file:

```ts
export interface LeaderFollowup {
  leader: { id: string; fullName: string };
  latestSvcDate: string | null;
  latestGrpDate: string | null;
  birthdays: FollowupStudent[];
  notSeenService: FollowupStudent[];
  notSeenGroup: FollowupStudent[];
}

export interface FollowupService {
  leaderFollowup(actor: Actor, leaderId: string): Promise<LeaderFollowup>;
}

export function makeFollowupService(
  connRepo: IConnectionRepository,
  studentRepo: IStudentRepository,
  leaderRepo: ILeaderRepository,
  sessionRepo: IServiceSessionRepository,
  svcAttRepo: IServiceAttendanceRepository,
  weekRepo: ILifegroupWeekRepository,
  grpAttRepo: ILifegroupAttendanceRepository,
): FollowupService {
  return {
    async leaderFollowup(actor, leaderId) {
      assertCan(actor, 'leader:read');
      const [leader, conns, allStudents] = await Promise.all([
        leaderRepo.findById(leaderId),
        connRepo.findByLeader(leaderId),
        studentRepo.findAll(),
      ]);
      if (!leader) throw new NotFoundError('Leader not found');
      const connectedIds = new Set(conns.map((c) => c.studentId));
      const myStudents = allStudents.filter((s) => connectedIds.has(s.id));

      // Most recent VALID service session (ignores holiday/low-attendance Fridays).
      const validSessions = await sessionRepo.findValid();
      const latestSession = validSessions.reduce<(typeof validSessions)[number] | null>(
        (max, s) => (!max || s.sessionDate > max.sessionDate ? s : max),
        null,
      );
      let latestSvcAttendees = new Set<string>();
      if (latestSession) {
        const recs = await svcAttRepo.findBySession(latestSession.id);
        latestSvcAttendees = new Set(recs.filter((r) => r.attended).map((r) => r.studentId));
      }

      // Most recent lifegroup week (by weekStart).
      const weeks = await weekRepo.findAll();
      const latestWeek = weeks.reduce<(typeof weeks)[number] | null>(
        (max, w) => (!max || w.weekStart > max.weekStart ? w : max),
        null,
      );
      let latestGrpAttendees = new Set<string>();
      if (latestWeek) {
        const recs = await grpAttRepo.findByWeek(latestWeek.id);
        latestGrpAttendees = new Set(recs.filter((r) => r.attended).map((r) => r.studentId));
      }

      const lists = buildFollowup(
        myStudents,
        latestSvcAttendees,
        latestGrpAttendees,
        latestSession ? latestSession.sessionDate : null,
        latestWeek ? latestWeek.weekStart : null,
        new Date(),
      );
      return {
        leader: { id: leader.id, fullName: leader.fullName },
        latestSvcDate: latestSession ? latestSession.sessionDate : null,
        latestGrpDate: latestWeek ? latestWeek.weekStart : null,
        ...lists,
      };
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- followup`
Expected: PASS (Task 1 + Task 2 tests all green).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/services/followup.service.ts src/tests/followup.service.test.ts
git commit -m "feat: add follow-up service resolving latest session/week attendance"
```

---

### Task 3: Follow-up controller, route & container wiring

Expose `leaderFollowup` over HTTP at `GET /connections/leader/:leaderId/followup` (kept under the `/connections` prefix so `API_RE` already matches it — no service-worker change).

**Files:**
- Create: `src/api/controllers/followup.controller.ts`
- Modify: `src/container.ts` (instantiate service; add to `Services`)
- Modify: `src/api/http/router.ts` (import + instantiate controller; register route)

**Interfaces:**
- Consumes: `FollowupService` from Task 2; `Services.followup` from `container.ts`.
- Produces: route `GET /connections/leader/:leaderId/followup` returning `LeaderFollowup` JSON.

- [ ] **Step 1: Create the controller**

Create `src/api/controllers/followup.controller.ts`:

```ts
import type { HttpRequest } from '../http/types';
import type { FollowupService } from '../../services/followup.service';
import { UnauthorizedError } from '../../core/errors/app-error';

export function makeFollowupController(deps: { followup: FollowupService }) {
  return {
    async leaderFollowup(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return deps.followup.leaderFollowup(req.ctx, req.params['leaderId']!);
    },
  };
}
```

- [ ] **Step 2: Wire the service into the container**

In `src/container.ts`, add the import after the connection-service import (near line 62):

```ts
import { makeFollowupService, type FollowupService } from './services/followup.service';
```

Add to the `Services` interface (after the `connection: ConnectionService;` line, ~line 95):

```ts
  followup: FollowupService;
```

Instantiate it after the `connection` service is built (after line 190, `const connection = makeConnectionService(...)`):

```ts
  const followup = makeFollowupService(
    connections, students, leaders,
    serviceSessions, serviceAttendance,
    lifegroupWeeks, lifegroupAttendance,
  );
```

Add `followup` to the `services` object literal (in the `const services: Services = { ... }` block, ~line 213):

```ts
    auth, student, leader, connection, followup, overview, atRisk, trends, lifegroupStats,
```

(Replace the existing `auth, student, leader, connection, overview, ...` line with the line above, inserting `followup,` after `connection,`.)

- [ ] **Step 3: Register the controller and route**

In `src/api/http/router.ts`, add the controller import after the connection-controller import (~line 6):

```ts
import { makeFollowupController } from '../controllers/followup.controller';
```

Instantiate it after `const connection = makeConnectionController(...)` (~line 21):

```ts
  const followup = makeFollowupController({ followup: services.followup });
```

Register the route immediately after the existing `/connections/leader/:leaderId/summary` route (`router.ts:73`):

```ts
    { method: 'GET',    path: '/connections/leader/:leaderId/followup', auth: true, handler: (r) => followup.leaderFollowup(r) },
```

- [ ] **Step 4: Typecheck and smoke-test the endpoint**

Run: `npm run typecheck`
Expected: no errors.

Then start the app and hit the endpoint:

```bash
PERSISTENCE=memory npm run dev
```

In a second terminal (token from a login; replace LEADER_ID with one from `GET /leaders`):

```bash
TOKEN=$(curl -s -X POST localhost:4300/auth/login -H 'content-type: application/json' -d '{"email":"admin@youth.ministry","password":"demo1234"}' | sed -E 's/.*"token":"([^"]+)".*/\1/')
LEADER_ID=$(curl -s localhost:4300/leaders -H "authorization: Bearer $TOKEN" | sed -E 's/.*"id":"([^"]+)".*/\1/')
curl -s "localhost:4300/connections/leader/$LEADER_ID/followup" -H "authorization: Bearer $TOKEN"
```

Expected: a JSON object with keys `leader`, `latestSvcDate`, `latestGrpDate`, `birthdays`, `notSeenService`, `notSeenGroup`.

- [ ] **Step 5: Commit**

```bash
git add src/api/controllers/followup.controller.ts src/container.ts src/api/http/router.ts
git commit -m "feat: expose GET /connections/leader/:id/followup"
```

---

### Task 4: Persisted leader identity (Recommendation 2)

Add a per-device "I am [leader]" identity stored in `localStorage`, with helpers to get/set it, and make "My Students" default to it instead of starting blank.

**Files:**
- Modify: `public/index.html` (add identity helpers near the other helpers ~line 586; update `renderMyStudents` ~line 1971 to seed `_msLeader` from the stored identity and persist on change)

**Interfaces:**
- Produces (global JS functions, used by Task 5): `getMyLeaderId(): string | null`, `setMyLeaderId(id: string | null): void`.

- [ ] **Step 1: Add the identity helpers**

In `public/index.html`, immediately after the `roleBadgeInner` function (ends at line 585, before the `// ── UNDO SYSTEM ──` comment), insert:

```js
// ── LEADER IDENTITY (per-device "I am …" — Recommendation 2) ──
// Not authentication: a convenience so a leader sharing a grade/quad login can
// default their views (My Students, Home follow-up) to their own students.
function getMyLeaderId() { try { return localStorage.getItem('yap_leader_id') || null; } catch { return null; } }
function setMyLeaderId(id) { try { if (id) localStorage.setItem('yap_leader_id', id); else localStorage.removeItem('yap_leader_id'); } catch {} }
```

- [ ] **Step 2: Seed My Students from the stored identity**

In `renderMyStudents` (`public/index.html:1971`), the current code declares `_msLeader` as a module-level `let` (line 1957) that starts `null`. After the leaders are fetched and before the visibility filtering, seed it from the stored identity when unset. Find this block (~line 2004):

```js
  if (_msLeader && !visLeaders.some(l => l.id === _msLeader)) _msLeader = null;
```

Replace it with:

```js
  // Default to the per-device leader identity (Recommendation 2) when nothing is
  // selected yet, so a returning leader lands straight on their own students.
  if (!_msLeader) { const mine = getMyLeaderId(); if (mine && leaders.some(l => l.id === mine)) _msLeader = mine; }
  if (_msLeader && !visLeaders.some(l => l.id === _msLeader)) _msLeader = null;
```

- [ ] **Step 3: Persist the selection when the dropdown changes**

In `renderMyStudents` the leader `<select>` (~line 2007) currently has:

```js
  body += `<div class="fg"><label class="fl">I am…</label><select class="fs" onchange="_msLeader=this.value;renderMyStudents()"><option value="">— Choose a leader —</option>${opts}</select></div>`;
```

Replace the `onchange` handler so the choice is remembered per device:

```js
  body += `<div class="fg"><label class="fl">I am…</label><select class="fs" onchange="_msLeader=this.value;setMyLeaderId(this.value||null);renderMyStudents()"><option value="">— Choose a leader —</option>${opts}</select></div>`;
```

- [ ] **Step 4: Typecheck and manually verify**

Run: `npm run typecheck`
Expected: no errors (HTML is not typechecked, but this confirms the build is unbroken).

Run: `PERSISTENCE=memory npm run dev`, log in as `grade9g@youth.ministry` / `demo1234`, open **My Students**, pick a leader. Reload the page and reopen **My Students** — the same leader should be pre-selected. Confirm via DevTools that `localStorage` has `yap_leader_id`.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: persist per-device leader identity, default My Students to it"
```

---

### Task 5: Home follow-up section (Recommendation 3)

Beneath the Quick Actions on Home, render the weekly follow-up: a self-identify picker if no leader is chosen, otherwise three small lists (Birthdays this week, Not seen at Friday, Not seen at Lifegroup) for the identified leader's students. Tap-to-call uses the existing `phoneLink`. Must NOT show a "declining" marker.

**Files:**
- Modify: `public/index.html` (`_renderHomeInner` ~line 1126–1134 to append the follow-up section after Quick Actions; add `renderHomeFollowup()` + `_followupListHtml()` + `chooseHomeLeader()` helpers)

**Interfaces:**
- Consumes: `getMyLeaderId`/`setMyLeaderId` (Task 4); `GET /connections/leader/:id/followup` (Task 3); existing `API`, `Cache`, `esc`, `phoneLink`, `icS`, `fmtBday` (`public/index.html:1965`), `setApp`, `S`.

- [ ] **Step 1: Append the follow-up container after Quick Actions**

In `_renderHomeInner` (`public/index.html`), the Quick Actions block ends at line 1134 with `body += '</div>';` (immediately before `if (u.role === 'grade') {`). Right after that line, insert:

```js
    // ── Weekly follow-up (Recommendation 3) — filled in asynchronously below ──
    body += '<div id="home-followup"></div>';
```

Then, at the very end of `_renderHomeInner`, the function ends with `setApp(shell(body));` (line 1243). Immediately **before** that line, add a fire-and-forget call that fills the container after paint:

```js
  // Kick off the follow-up fetch after the main paint; it fills #home-followup.
  renderHomeFollowup();
```

- [ ] **Step 2: Add the follow-up render helpers**

Immediately after `_renderHomeInner` closes (after line 1244, before the `// ============ PUSH NOTIFICATIONS` banner at line 1246), insert:

```js
// Render the weekly follow-up into #home-followup. If no leader identity is set,
// show a self-identify picker first (Recommendation 2 + 3).
async function renderHomeFollowup() {
  const host = document.getElementById('home-followup');
  if (!host) return;
  const mine = getMyLeaderId();

  // No identity yet → offer a picker built from the leaders in scope.
  if (!mine) {
    let leaders = [];
    try { leaders = await API.get('/leaders'); } catch {}
    if (!leaders.length) { host.innerHTML = ''; return; }
    const opts = leaders.map(l => `<option value="${l.id}">${esc(l.fullName)}</option>`).join('');
    host.innerHTML = `<div class="sh">This week's follow-up</div>
      <div class="card" style="padding:14px">
        <div style="font-size:13px;color:var(--ink-mid);margin-bottom:8px">Tell us who you are to see your students to follow up with this week.</div>
        <select class="fs" id="home-leader-pick"><option value="">— Choose your name —</option>${opts}</select>
        <button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="chooseHomeLeader()">Show my follow-up</button>
      </div>`;
    return;
  }

  let data;
  try { data = await API.get(`/connections/leader/${mine}/followup`); }
  catch { host.innerHTML = ''; return; }
  if (!data) { host.innerHTML = ''; return; }

  const changeBtn = `<button class="btn btn-ghost btn-sm" style="font-size:11px" onclick="setMyLeaderId(null);renderHomeFollowup()">Not you?</button>`;
  let h = `<div class="sh" style="display:flex;align-items:center;justify-content:space-between"><span>This week's follow-up · ${esc(data.leader.fullName)}</span>${changeBtn}</div>`;
  h += _followupListHtml('🎂 Birthdays this week', data.birthdays, 'No birthdays this week');
  h += _followupListHtml('Not seen at Friday', data.notSeenService, data.latestSvcDate ? 'Everyone was seen 🎉' : 'No service data yet');
  h += _followupListHtml('Not seen at Lifegroup', data.notSeenGroup, data.latestGrpDate ? 'Everyone was seen 🎉' : 'No lifegroup data yet');
  host.innerHTML = h;
}

// One follow-up list as a compact card. Shows name + grade/gender + tap-to-call;
// deliberately NO at-risk/declining marker (per spec).
function _followupListHtml(title, items, emptyMsg) {
  let h = `<div class="card" style="padding:12px;margin-bottom:10px">
    <div style="font-size:12px;font-weight:800;color:var(--ink-mid);text-transform:uppercase;letter-spacing:.03em;margin-bottom:6px">${title} (${items.length})</div>`;
  if (!items.length) { h += `<div style="font-size:13px;color:var(--ink-faint)">${emptyMsg}</div></div>`; return h; }
  for (const s of items) {
    const bd = fmtBday(s.dateOfBirth);
    const phone = s.mobile || s.parentPhone;
    h += `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--paper-dark)">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:14px">${esc(s.fullName)}</div>
        <div style="font-size:12px;color:var(--ink-mid)">Yr ${s.grade||'—'} · ${s.gender}${bd ? ' · ' + bd : ''}</div>
      </div>
      ${phone ? `<div style="font-size:13px;white-space:nowrap" onclick="event.stopPropagation()">${phoneLink(phone)}</div>` : ''}
    </div>`;
  }
  h += '</div>';
  return h;
}

// Commit the Home self-identify picker selection and re-render.
function chooseHomeLeader() {
  const v = document.getElementById('home-leader-pick')?.value;
  if (!v) return;
  setMyLeaderId(v);
  renderHomeFollowup();
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Manually verify on the running app**

Run: `PERSISTENCE=memory npm run dev`. Log in as `grade9g@youth.ministry` / `demo1234`. On **Home**, below Quick Actions you should see "This week's follow-up". If `localStorage` has no `yap_leader_id`, the self-identify picker appears; choosing a leader shows three lists. Verify:
- Birthdays list shows only students with a birthday in the current Mon–Sun week.
- "Not seen at Friday" / "Not seen at Lifegroup" show eligible students (use Student Search to cross-check attendance), with NO declining/at-risk chip.
- "Not you?" clears the identity and returns to the picker.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: weekly follow-up section on Home (birthdays, not-seen lists)"
```

---

### Task 6: Move Connection Summary from Home to Leaders & Connect (Recommendation 4a)

Remove the grade-only "Connection Summary" strip from Home and render a Total / Connected / Pending strip on the Leaders & Connect page, directly below the Add Leader / Export buttons.

**Files:**
- Modify: `public/index.html` (delete the grade Connection Summary block in `_renderHomeInner` ~lines 1136–1143; add the strip in `renderConnectView` ~after line 1675)

**Interfaces:**
- Consumes: `connectedCount`, `totalStudents` already computed in `renderConnectView` (`public/index.html:1638–1639`).

- [ ] **Step 1: Remove the Connection Summary from Home**

In `_renderHomeInner` (`public/index.html`), delete this entire block (lines 1136–1143):

```js
    if (u.role === 'grade') {
      // Compact connection strip (Total / Connected / Pending)
      body += '<div class="sh">Connection Summary</div>';
      body += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:16px">';
      body += `<div class="stat"><div class="stat-v">${stats.ministryTotal}</div><div class="stat-l">Total</div></div>`;
      body += `<div class="stat"><div class="stat-v" style="color:var(--success)">${stats.connectedTotal}</div><div class="stat-l">Connected</div></div>`;
      body += `<div class="stat"><div class="stat-v" style="color:var(--warn)">${stats.unconnectedTotal}</div><div class="stat-l">Pending</div></div>`;
      body += '</div>';
    } else {
```

Replace it with just the `else`-branch opener so the director/admin breakdown below is preserved:

```js
    {
```

(The block that followed `} else {` — the director/admin quad/grade breakdowns — stays unchanged; we have simply removed the grade-only summary and turned the `if/else` into an unconditional block. The grade role will now fall through to this block, which already contains only `['admin','director']`- and `'quad'`-guarded sections, so a grade login renders nothing extra here. This is intended — their summary now lives on the Connect page.)

- [ ] **Step 2: Add the summary strip to the Connect page**

In `renderConnectView` (`public/index.html`), the header template literal ends at line 1675 with the closing of the `.ph` block. The variables `connectedCount` and `totalStudents` are computed at lines 1638–1639. Locate this section (~line 1675–1682):

```js
    ${lockBanner}${gradeHint}
    ${gChips ? `<div class="filter-row" role="group" aria-label="Filter by grade">
```

Insert the summary strip between `${lockBanner}${gradeHint}` and the grade filter row:

```js
    ${lockBanner}${gradeHint}
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:12px">
      <div class="stat"><div class="stat-v">${totalStudents}</div><div class="stat-l">Total</div></div>
      <div class="stat"><div class="stat-v" style="color:var(--success)">${connectedCount}</div><div class="stat-l">Connected</div></div>
      <div class="stat"><div class="stat-v" style="color:var(--warn)">${Math.max(0, totalStudents - connectedCount)}</div><div class="stat-l">Pending</div></div>
    </div>
    ${gChips ? `<div class="filter-row" role="group" aria-label="Filter by grade">
```

- [ ] **Step 3: Typecheck and manually verify**

Run: `npm run typecheck`
Expected: no errors.

Run the app; as `grade9g@youth.ministry`: **Home** no longer shows "Connection Summary"; **Leaders & Connect** shows the Total / Connected / Pending strip directly below the Add Leader / Export buttons. The Pending number equals Total − Connected.

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "refactor: move connection summary from Home to Leaders & Connect"
```

---

### Task 7: Collapse "Prev term" in the Home hero (Recommendation 4b)

Hide the previous-term attendance table in the Home hero behind a small toggle button so the default view shows only this term.

**Files:**
- Modify: `public/index.html` (`_renderHomeInner` hero prev-term block ~lines 1093–1110; add a `_toggleHomePrev()` helper)

**Interfaces:**
- Produces: `_toggleHomePrev()` global JS function.

- [ ] **Step 1: Wrap the prev-term table in a collapsible**

In `_renderHomeInner`, the previous-term block builds two tables inside `if (pSvcTot > 0 || pGrpTot > 0) { ... }` (lines 1093–1110). Find the opening of the first prev-term table (line 1101):

```js
    body += `<table style="width:100%;border-collapse:collapse;table-layout:fixed;margin-top:5px"><colgroup><col style="width:44%"><col style="width:28%"><col style="width:28%"></colgroup>`;
```

Insert a toggle button and an opening wrapper `<div>` immediately **before** that line:

```js
    body += `<button onclick="_toggleHomePrev()" style="margin-top:6px;background:rgba(255,255,255,.1);border:none;color:#fff;opacity:.7;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;border-radius:6px;padding:3px 8px;cursor:pointer;display:flex;align-items:center;gap:5px"><span id="home-prev-chev" style="display:inline-block;transition:transform .15s">›</span> Prev term</button>`;
    body += `<div id="home-prev-body" style="display:none">`;
```

Then find the closing of that block (line 1109, the last `body += ...table...` is line 1108; line 1109 closes the wrapping table). After line 1109:

```js
    body += `</tbody></table>`;
```

add the closing wrapper `</div>`:

```js
    body += `</tbody></table>`;
    body += `</div>`;
```

- [ ] **Step 2: Add the toggle helper**

Immediately after the `_renderHomeInner` function closes (after the helpers added in Task 5, or directly after line 1244 if Task 5 not yet applied), add:

```js
// Toggle the Home hero's previous-term table (Recommendation 4b). In-DOM only.
function _toggleHomePrev() {
  const b = document.getElementById('home-prev-body');
  const c = document.getElementById('home-prev-chev');
  if (!b) return;
  const open = b.style.display === 'none';
  b.style.display = open ? 'block' : 'none';
  if (c) c.style.transform = open ? 'rotate(90deg)' : '';
}
```

- [ ] **Step 3: Typecheck and manually verify**

Run: `npm run typecheck`
Expected: no errors.

Run the app; on **Home**, the hero shows only the "This term" table by default with a small "› Prev term" button. Tapping it expands the previous-term table and rotates the chevron; tapping again collapses it.

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: collapse Home hero prev-term behind a toggle"
```

---

### Task 8: Typed-confirmation helper for bulk-destructive actions (Recommendation 5, part 1)

Add a reusable `confirmType()` modal that requires the user to type a word to arm the action, and use it for the two `/admin/*` data wipes and the "Clear All" import-history action — replacing the bare browser `confirm()` calls.

**Files:**
- Modify: `public/index.html` (add `confirmType()` near `modal()` ~line 497; rewire Full Reset & Clear Service/Group buttons ~lines 3519/3523; rewire `clearAllImportHistory` ~line 3024)

**Interfaces:**
- Consumes: existing `modal()`, `closeModal()`, `adminAction(path,msg)` (`public/index.html:3613`), `API`, `Cache`, `renderImport`.
- Produces: `confirmType({ title, body, word, danger, onConfirm })` global JS function.

- [ ] **Step 1: Add the helper**

In `public/index.html`, immediately after `closeModal()` (line 497), insert:

```js
// Irreversible bulk actions: require typing a word to arm the confirm button
// (Recommendation 5). Reuses modal(); onConfirm is a zero-arg function.
function confirmType(opts) {
  const { title, body, word, danger, onConfirm } = opts;
  window._confirmTypeFn = onConfirm;
  modal(`<div class="mo-title">${title}</div>
    <p style="color:var(--ink-mid);margin-bottom:14px">${body}</p>
    <p style="font-size:13px;margin-bottom:6px">Type <strong>${word}</strong> to confirm:</p>
    <input class="fi" id="ct-input" autocomplete="off" autocapitalize="characters"
      oninput="document.getElementById('ct-go').disabled = this.value.trim().toUpperCase() !== '${word}'">
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn ${danger ? 'btn-danger' : 'btn-secondary'}" id="ct-go" style="flex:1" disabled
        onclick="closeModal(); const f=window._confirmTypeFn; window._confirmTypeFn=null; if(f)f();">Confirm</button>
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    </div>`);
  setTimeout(() => document.getElementById('ct-input')?.focus(), 60);
}
```

- [ ] **Step 2: Rewire the Full Reset and Clear Service/Group buttons**

In `renderAdminView` (`public/index.html`), find the Clear Service/Group button (line 3519):

```js
            <button class="btn btn-secondary btn-full" onclick="if(confirm('Clear all service & lifegroup data? Students (grade, age, phone), their connections and leaders are kept. Continue?'))adminAction('/admin/clear-service-group','✓ Service/group data cleared')">Clear Service/Group Data</button>
```

Replace it with:

```js
            <button class="btn btn-secondary btn-full" onclick="confirmType({title:'Clear Service & Group Data?',word:'CLEAR',danger:false,body:'This deletes all service and lifegroup attendance. Students (grade, age, phone), their connections and leaders are kept.',onConfirm:()=>adminAction('/admin/clear-service-group','✓ Service/group data cleared')})">Clear Service/Group Data</button>
```

Find the Full Reset button (line 3523):

```js
            <button class="btn btn-danger btn-full" onclick="if(confirm('RESET ALL DATA? This deletes students, leaders, connections and all attendance. This cannot be undone.'))adminAction('/admin/reset','✓ Full reset complete')">Full Reset</button>
```

Replace it with:

```js
            <button class="btn btn-danger btn-full" onclick="confirmType({title:'Full Reset?',word:'RESET',danger:true,body:'This permanently deletes all students, leaders, connections and attendance. Accounts are kept. This cannot be undone.',onConfirm:()=>adminAction('/admin/reset','✓ Full reset complete')})">Full Reset</button>
```

- [ ] **Step 3: Rewire Clear-All import history**

Replace the whole `clearAllImportHistory` function (`public/index.html:3024`):

```js
async function clearAllImportHistory() {
  if (!confirm('Delete all import history records? This cannot be undone.')) return;
  try {
    await API.del('/import/history');
    Cache.clear();
    await renderImport();
  } catch (e) {
    alert('Failed to clear history: ' + (e.message || e));
  }
}
```

with:

```js
function clearAllImportHistory() {
  confirmType({
    title: 'Clear Import History?', word: 'CLEAR', danger: false,
    body: 'Deletes all import history records. This cannot be undone.',
    onConfirm: async () => {
      try { await API.del('/import/history'); Cache.clear(); await renderImport(); }
      catch (e) { alert('Failed to clear history: ' + (e.message || e)); }
    },
  });
}
```

- [ ] **Step 4: Typecheck and manually verify**

Run: `npm run typecheck`
Expected: no errors.

Run the app as `admin@youth.ministry` / `demo1234` → **Admin → Data**. Each of the three actions now opens a typed-confirmation modal; the confirm button is disabled until the exact word (`RESET` / `CLEAR`) is typed (case-insensitive). Cancel closes without acting. (Confirm "Clear Service/Group Data" works end-to-end on the in-memory seed.)

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: typed confirmation for bulk-destructive admin actions"
```

---

### Task 9: Relocate leader delete + blast-radius + undo (Recommendation 5, part 2)

Move leader deletion off the everyday Connect card into the Edit Leader sheet; make the delete confirm name how many students will be disconnected and offer Undo.

**Files:**
- Modify: `public/index.html` (remove the trash button from the connect card ~line 1713–1714; add a "Remove leader" button to the Edit Leader modal ~line 1602–1605; rewrite `confirmDelLeader` ~line 1622 and add `doDelLeader`)

**Interfaces:**
- Consumes: `_aS.allocs` (student→leaderIds map, `public/index.html:1617`), `showUndoToast` (`public/index.html:589`), `API`, `Cache`, `renderConnect`, `closeModal`, `esc`.

- [ ] **Step 1: Remove the trash button from the Connect card**

In `renderConnectView` (`public/index.html`), find the leader-card action buttons (lines 1713–1714):

```js
          ${canEdit?`<button class="btn btn-ghost btn-sm" style="padding:2px 5px" title="Edit leader" onclick="showEditLeader('${l.id}')">${icS('edit')}</button>
          <button class="btn btn-ghost btn-sm" style="padding:2px 5px;color:var(--danger)" title="Delete leader" onclick="confirmDelLeader('${l.id}','${nm}')">${icS('trash')}</button>`:''}
```

Replace with just the Edit button:

```js
          ${canEdit?`<button class="btn btn-ghost btn-sm" style="padding:2px 5px" title="Edit leader" onclick="showEditLeader('${l.id}')">${icS('edit')}</button>`:''}
```

- [ ] **Step 2: Add "Remove leader" to the Edit Leader modal**

In `showEditLeader` (`public/index.html`), the button row is at lines 1602–1605:

```js
    <div style="display:flex;gap:8px">
      <button class="btn btn-primary" style="flex:1" onclick="submitEditLeader('${id}')">Save</button>
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    </div>`);
```

Replace with a layout that adds a destructive "Remove leader" action below the Save/Cancel row:

```js
    <div style="display:flex;gap:8px">
      <button class="btn btn-primary" style="flex:1" onclick="submitEditLeader('${id}')">Save</button>
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    </div>
    <button class="btn btn-ghost btn-sm" style="width:100%;margin-top:10px;color:var(--danger)" onclick="closeModal();confirmDelLeader('${id}','${esc(l.fullName).replace(/'/g,"\\'")}')">${icS('trash')} Remove leader</button>`);
```

- [ ] **Step 3: Rewrite `confirmDelLeader` with blast radius + undo**

Replace the whole `confirmDelLeader` function (`public/index.html:1622`):

```js
function confirmDelLeader(id, name) {
  modal(`<div class="mo-title">Delete Leader?</div>
    <p style="color:var(--ink-mid);margin-bottom:20px">Delete <strong>${name}</strong> and all their connections?</p>
    <div style="display:flex;gap:8px">
      <button class="btn btn-danger" style="flex:1" onclick="API.del('/leaders/${id}').then(()=>{Cache.del('/leaders','/connections','/overview','/at-risk');closeModal();toast('Deleted');renderConnect()}).catch(e=>toast(e.message))">Delete</button>
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    </div>`);
}
```

with a version that counts affected students and offers Undo via re-create + re-connect:

```js
function confirmDelLeader(id, name) {
  // How many students are currently connected to this leader (blast radius)?
  const affected = Object.values(_aS.allocs || {}).filter(ids => (ids || []).includes(id));
  const n = affected.length;
  modal(`<div class="mo-title">Remove leader?</div>
    <p style="color:var(--ink-mid);margin-bottom:20px"><strong>${esc(name)}</strong> will be removed${n ? ` and <strong>${n} student${n!==1?'s':''}</strong> disconnected` : ''}.</p>
    <div style="display:flex;gap:8px">
      <button class="btn btn-danger" style="flex:1" onclick="doDelLeader('${id}','${name.replace(/'/g,"\\'")}')">Remove</button>
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    </div>`);
}

// Delete a leader, then offer Undo: re-create the leader and re-connect the same
// students. Captures the leader record + its connected studentIds before deleting.
async function doDelLeader(id, name) {
  let leader, studentIds = [];
  try { leader = await API.get(`/leaders/${id}`); } catch {}
  studentIds = Object.entries(_aS.allocs || {}).filter(([, ids]) => (ids || []).includes(id)).map(([sid]) => sid);
  try {
    await API.del(`/leaders/${id}`);
    Cache.del('/leaders', '/connections', '/overview', '/at-risk');
    closeModal();
    renderConnect();
    showUndoToast(`Removed ${name}`, async () => {
      try {
        const recreated = await API.post('/leaders', { fullName: leader.fullName, gender: leader.gender || '', grades: leader.grades || [] });
        for (const sid of studentIds) { try { await API.post('/connections', { studentId: sid, leaderId: recreated.id }); } catch {} }
        Cache.del('/leaders', '/connections', '/overview', '/at-risk');
        renderConnect();
      } catch (e) { toast('Undo failed: ' + e.message); }
    });
  } catch (e) { toast(e.message); }
}
```

- [ ] **Step 4: Typecheck and manually verify**

Run: `npm run typecheck`
Expected: no errors.

Run the app as `grade9g@youth.ministry` / `demo1234` → **Leaders & Connect**. The leader card now shows only the Edit (✎) action — no trash icon. Open Edit on a leader with connected students: the "Remove leader" button at the bottom opens a confirm naming the student count ("… and 3 students disconnected"). Confirm → the leader disappears and an Undo toast appears; tapping Undo restores the leader and re-connects the students.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: relocate leader delete to edit sheet with blast-radius + undo"
```

---

### Task 10: Unified self-routing import with preview (Recommendations 1 & 6)

Replace the two separate import drop-zones with one that auto-detects service vs group CSV/XLSX, shows a pre-upload preview (counts + anything unusual) requiring confirmation before sending, and surfaces the "re-import to refresh last-term figures" tip after a service import.

**Files:**
- Modify: `public/index.html` (`renderImport` ~lines 2948–2985 to a single drop zone; add `handleUnifiedImport`, `previewAndConfirmImport`; adjust `processImport`/`processGroupImport` to accept already-parsed rows + show the re-import note)

**Interfaces:**
- Consumes: existing `parseCSV`, `parseGroupCSV` (`public/index.html:3216`), `readXlsx` (`:3038`), `rowsToCsv` (`:3107`), `API`, `Cache`, `icS`, `Cache.get('/students')` (cached roster), `modal`, `closeModal`.

- [ ] **Step 1: Replace the two drop-zones with one**

In `renderImport` (`public/index.html`), replace the two `<div class="card">…</div>` blocks for "Service Attendance CSV" and "Group Attendance CSV" (lines 2950–2985) with a single unified card:

```js
    <div class="card">
      <div class="card-title" style="margin-bottom:6px">Import Attendance</div>
      <p style="font-size:13px;color:var(--ink-mid);margin-bottom:12px">
        Drop a <strong>Service</strong> or <strong>Group</strong> attendance export from Elvanto/UCare — we'll detect which it is.<br>
        Columns and dates are detected automatically. CSV or .xlsx, up to 10MB.
      </p>
      <div id="drop-zone" style="border:2px dashed var(--paper-dark);border-radius:var(--radius-sm);padding:32px;text-align:center;cursor:pointer;transition:border-color .2s"
        onclick="document.getElementById('csv-file').click()"
        ondragover="event.preventDefault();this.style.borderColor='var(--accent)'"
        ondragleave="this.style.borderColor=''"
        ondrop="event.preventDefault();this.style.borderColor='';handleUnifiedDrop(event)">
        <div style="margin-bottom:8px">${icLg('upload')}</div>
        <div style="font-weight:600">Drop CSV / Excel here or tap to browse</div>
        <div style="font-size:12px;color:var(--ink-faint);margin-top:4px">Service or Group — auto-detected</div>
      </div>
      <input type="file" id="csv-file" accept=".csv,.xlsx" style="display:none" onchange="handleUnifiedFile(this)">
      <div id="import-status" style="margin-top:12px"></div>
    </div>`;
```

(There is now a single `#import-status`; the old `#import-status-grp` is gone.)

- [ ] **Step 2: Add the unified detect + preview handlers**

Replace the old `handleImportDrop`/`handleImportFile` (`public/index.html:3187–3188`):

```js
function handleImportDrop(e) { const f = e.dataTransfer.files[0]; if (f) processImport(f); }
function handleImportFile(input) { const f = input.files[0]; if (f) processImport(f); }
```

with unified versions plus the detection/preview pipeline:

```js
function handleUnifiedDrop(e) { const f = e.dataTransfer.files[0]; if (f) detectAndPreview(f); }
function handleUnifiedFile(input) { const f = input.files[0]; if (f) detectAndPreview(f); }

// Read the file, decide Service vs Group, then show a preview before uploading.
async function detectAndPreview(file) {
  const statusEl = document.getElementById('import-status');
  const isExcel = /\.xlsx?$/i.test(file.name);
  statusEl.innerHTML = `<div class="alert al-info"><div class="spin" style="margin-right:8px"></div>Reading ${isExcel ? 'Excel' : 'CSV'}…</div>`;
  let text;
  try {
    if (isExcel) text = rowsToCsv(await readXlsx(await file.arrayBuffer()));
    else text = await file.text();
  } catch (err) { statusEl.innerHTML = `<div class="alert al-err">${(err && err.message) || 'Could not read this file'}</div>`; return; }

  // Group exports have DD/MM/YYYY date-column headers + group-name header rows;
  // parseGroupCSV returns null when that structure is absent → treat as Service.
  const group = parseGroupCSV(text);
  if (group) { previewGroupImport(file.name, group); return; }

  const rows = parseCSV(text);
  if (!rows.length) { statusEl.innerHTML = '<div class="alert al-err">Couldn\'t recognise this as a Service or Group attendance export. Check the file.</div>'; return; }
  previewServiceImport(file.name, rows);
}

// Service preview: new vs existing students, plus any unrecognised grades.
function previewServiceImport(filename, rows) {
  const existing = new Set((Cache.get('/students') || []).map(s => `${(s.firstName||'').trim().toLowerCase()} ${(s.lastName||'').trim().toLowerCase()}`));
  let nu = 0; const grades = new Set(); let unknownGrade = 0;
  for (const r of rows) {
    const key = `${(r.first_name||'').trim().toLowerCase()} ${(r.last_name||'').trim().toLowerCase()}`;
    if (key.trim() && !existing.has(key)) nu++;
    const g = parseInt(r.grade, 10);
    if (r.grade != null && r.grade !== '') { if (g >= 7 && g <= 12) grades.add(g); else unknownGrade++; }
  }
  const warn = unknownGrade ? `<div style="color:var(--warn);font-size:12px;margin-top:6px">${unknownGrade} row(s) have a grade outside Yr 7–12.</div>` : '';
  modal(`<div class="mo-title">Service import — confirm</div>
    <div style="font-size:13px;color:var(--ink-mid);line-height:1.7">
      <div><strong>${rows.length}</strong> attendance rows</div>
      <div><strong>${nu}</strong> new student${nu!==1?'s':''} · ${rows.length - nu} already known</div>
      <div>Grades seen: ${[...grades].sort((a,b)=>a-b).join(', ') || '—'}</div>
    </div>${warn}
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn btn-primary" style="flex:1" onclick="closeModal();uploadServiceImport(${JSON.stringify(filename).replace(/"/g,'&quot;')})">Import</button>
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    </div>`);
  window._pendingServiceRows = rows;
}

// Group preview: groups + members.
function previewGroupImport(filename, parsed) {
  const totalMembers = parsed.groups.reduce((n, g) => n + g.members.length, 0);
  modal(`<div class="mo-title">Group import — confirm</div>
    <div style="font-size:13px;color:var(--ink-mid);line-height:1.7">
      <div><strong>${parsed.groups.length}</strong> group${parsed.groups.length!==1?'s':''}</div>
      <div><strong>${totalMembers}</strong> member row${totalMembers!==1?'s':''}</div>
    </div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn btn-primary" style="flex:1" onclick="closeModal();uploadGroupImport(${JSON.stringify(filename).replace(/"/g,'&quot;')})">Import</button>
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    </div>`);
  window._pendingGroups = parsed;
}

async function uploadServiceImport(filename) {
  const statusEl = document.getElementById('import-status');
  const rows = window._pendingServiceRows; window._pendingServiceRows = null;
  if (!rows) return;
  statusEl.innerHTML = `<div class="alert al-info">Uploading ${rows.length} rows…</div>`;
  try {
    const result = await API.post('/import/csv', { rows, filename }, 90000);
    Cache.clear();
    statusEl.innerHTML = `<div class="alert al-ok" style="display:flex;align-items:flex-start;gap:6px;flex-direction:column">
      <div style="display:flex;align-items:center;gap:6px">${icS('check')} Import complete: ${result.studentsAdded} added, ${result.studentsUpdated} updated, ${result.sessionsAdded} sessions</div>
      <div style="font-size:12px;color:var(--ink-mid)">Tip: last-term comparisons refresh on the next service import — re-upload if last term's numbers look off.</div>
    </div>`;
  } catch (err) { statusEl.innerHTML = `<div class="alert al-err">Import failed: ${err.message}</div>`; }
}

async function uploadGroupImport(filename) {
  const statusEl = document.getElementById('import-status');
  const parsed = window._pendingGroups; window._pendingGroups = null;
  if (!parsed) return;
  const totalMembers = parsed.groups.reduce((n, g) => n + g.members.length, 0);
  statusEl.innerHTML = `<div class="alert al-info">Uploading ${parsed.groups.length} groups, ${totalMembers} members…</div>`;
  try {
    const result = await API.post('/import/group-csv', { groups: parsed.groups, filename }, 90000);
    Cache.clear();
    statusEl.innerHTML = `<div class="alert al-ok" style="display:flex;align-items:center;gap:6px">${icS('check')} Import complete: ${result.groupsAdded} groups created, ${result.studentsAdded} students added, ${result.studentsUpdated} updated, ${result.weeksAdded} weeks</div>`;
  } catch (err) { statusEl.innerHTML = `<div class="alert al-err">Import failed: ${err.message}</div>`; }
}
```

- [ ] **Step 3: Remove the now-unused old handlers**

Delete the now-orphaned `processImport` (`public/index.html:3192`), `handleGroupImportDrop`, `handleGroupImportFile`, and `processGroupImport` (`:3259`) functions — their behaviour is replaced by the unified pipeline. (Search the file for each name and confirm no remaining callers before deleting. `parseCSV`, `parseGroupCSV`, `readXlsx`, `rowsToCsv` are still used and must stay.)

- [ ] **Step 4: Typecheck and manually verify**

Run: `npm run typecheck`
Expected: no errors.

Run the app as `admin@youth.ministry` / `demo1234` → **Import**. There is now one drop zone. Dropping a Service export opens a "Service import — confirm" preview (rows / new students / grades); dropping a Group export opens a "Group import — confirm" preview (groups / members). Cancel aborts without uploading. Confirm uploads as before; the service success message includes the re-import tip. A non-attendance CSV shows the "couldn't recognise" error.

> If you don't have real exports handy: a minimal Group CSV is a header row `Name,08/06/2026` then a group-name row `Yr 9 Girls,` then a member row `"Smith, Ann",Y`. A minimal Service CSV is `First Name,Last Name,School Grade,2026-06-12` then `Ann,Smith,9,Y`.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: unified auto-routing import with pre-upload preview + re-import tip"
```

---

### Task 11: Birth date on My Students & Student Search (extra change)

Show each student's birth date on the Student Search results (both mobile card and desktop table). Verify My Students already shows it.

**Files:**
- Modify: `public/index.html` (`_studentResultsHtml` ~lines 2455–2486)

**Interfaces:**
- Consumes: `fmtBday` (`public/index.html:1965`); `/students` rows already include `dateOfBirth` (see `Student` entity).

- [ ] **Step 1: Add birth date to the mobile card**

In `_studentResultsHtml` (`public/index.html`), the mobile card sub-line is at line 2463:

```js
        <div class="li-sub">Gr ${s.grade||'—'} · ${s.gender} ${quadChip(s.quad)}</div>
```

Replace with one that appends the formatted birthday when present:

```js
        <div class="li-sub">Gr ${s.grade||'—'} · ${s.gender}${fmtBday(s.dateOfBirth) ? ' · ' + fmtBday(s.dateOfBirth) : ''} ${quadChip(s.quad)}</div>
```

- [ ] **Step 2: Add a Birthday column to the desktop table**

In the same function, the desktop table header is at line 2471:

```js
  h += `<div class="desk"><table class="dt"><thead><tr><th>Name</th><th>Gr</th><th>Gender</th><th>Quad</th><th>Service (this / last)</th><th>Lifegroup (this / last)</th><th>Status</th><th></th></tr></thead><tbody>`;
```

Replace with a header that adds a "DOB" column after Gender:

```js
  h += `<div class="desk"><table class="dt"><thead><tr><th>Name</th><th>Gr</th><th>Gender</th><th>DOB</th><th>Quad</th><th>Service (this / last)</th><th>Lifegroup (this / last)</th><th>Status</th><th></th></tr></thead><tbody>`;
```

Then the table row body at lines 2478–2480:

```js
      <td><strong>${esc(s.firstName)} ${esc(s.lastName)}</strong></td>
      <td>${s.grade||'—'}</td><td>${s.gender}</td>
      <td>${quadChip(s.quad)}</td>
```

Replace with a version that inserts the DOB cell:

```js
      <td><strong>${esc(s.firstName)} ${esc(s.lastName)}</strong></td>
      <td>${s.grade||'—'}</td><td>${s.gender}</td>
      <td>${fmtBday(s.dateOfBirth) || '—'}</td>
      <td>${quadChip(s.quad)}</td>
```

- [ ] **Step 3: Verify My Students still shows the birth date**

No code change needed — confirm `renderMyStudents` (`public/index.html:2034`) already renders `${bd ? ' · ' + bd : ''}` in the sub-line, where `bd = fmtBday(bdayOf[s.id])`. If the birthday is missing there during manual testing, it means the student is absent from `/students`; that is expected for never-imported students and out of scope.

- [ ] **Step 4: Typecheck and manually verify**

Run: `npm run typecheck`
Expected: no errors.

Run the app; open **Student Search** — each result card shows the birth date (DD-MM-YYYY) after the gender when known; the desktop table has a DOB column. Open **My Students**, pick a leader — birth dates still appear in the roster.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: show birth date on Student Search (card + table)"
```

---

## Final verification

- [ ] Run the full backend test suite: `npm run test` — expected: all green (existing 130 + the new follow-up tests).
- [ ] Run `npm run typecheck` — expected: no errors.
- [ ] Manual smoke as `grade9g@youth.ministry`: Home shows follow-up beneath Quick Actions; prev-term collapses; My Students/Connect/Student Search behave as described.
- [ ] Manual smoke as `admin@youth.ministry`: unified Import with preview; typed-confirmation on the three destructive actions; leader delete only inside the Edit sheet with undo.

## Self-review notes (coverage map)

- **Rec 1 (import preview)** → Task 10 (Step 2 `previewServiceImport`/`previewGroupImport`).
- **Rec 6 (auto-route + re-import note)** → Task 10 (Step 2 `detectAndPreview`; re-import tip in `uploadServiceImport`).
- **Rec 2 (leader identity)** → Task 4; consumed by Task 5.
- **Rec 5 (destructive controls)** → Task 8 (typed confirm) + Task 9 (relocate leader delete, blast radius, undo).
- **Rec 4a (move connection summary)** → Task 6. **Rec 4b (prev-term dropdown)** → Task 7.
- **Rec 3 (follow-up lists)** → Tasks 1–3 (backend) + Task 5 (UI); rules (>50% prev term / ≥1 this term, no "declining", three lists, self-identify) encoded in Task 1 helpers and Task 5 rendering.
- **Extra (birth date)** → Task 11 (Student Search) + verification of My Students.
