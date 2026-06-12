# Connection Made Simple — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the youth-allocation-platform as "Connection Made Simple" — a fully renamed, Supabase-backed, Vercel-deployed production app in a new Project 7 folder.

**Architecture:** Express/TypeScript backend wrapped as a single Vercel serverless function; data stored in Supabase Postgres (ap-southeast-2, Sydney); in-memory repos kept for local dev (`PERSISTENCE=memory`). All `allocation` terminology renamed to `connection` throughout backend and SPA. Five SPA UI fixes applied in the same pass.

**Tech Stack:** TypeScript, Express 4, Zod, Vitest, `postgres` (npm package for direct PG connection), `@vercel/node`, Supabase Postgres (ap-southeast-2)

**Spec:** `docs/superpowers/specs/2026-06-12-connection-made-simple-design.md`

---

## File Map

### Created
```
Project 7 - Connection Made Simple/connection-made-simple/
  supabase/migrations/001_initial_schema.sql
  supabase/migrations/002_seed_admin.sql
  src/repositories/supabase/client.ts
  src/repositories/supabase/supabase.users.ts
  src/repositories/supabase/supabase.students.ts
  src/repositories/supabase/supabase.leaders.ts
  src/repositories/supabase/supabase.connections.ts
  src/repositories/supabase/supabase.attendance.ts
  src/repositories/supabase/supabase.settings.ts
  src/repositories/supabase/index.ts
  src/app.ts
  api/index.ts
  vercel.json
  .vercelignore
  .env.example
  CLAUDE.md
```

### Renamed (then updated in-place)
```
src/core/entities/allocation.ts          → src/core/entities/connection.ts
src/api/controllers/allocation.controller.ts → src/api/controllers/connection.controller.ts
src/services/allocation.service.ts       → src/services/connection.service.ts
src/tests/allocation.service.test.ts     → src/tests/connection.service.test.ts
```

### Modified
```
package.json
src/config/env.ts
src/core/entities/connection.ts          (Allocation → Connection)
src/core/entities/settings.ts            (allocationLockDate → connectionLockDate)
src/core/entities/index.ts
src/repositories/interfaces/entity-repositories.ts
src/repositories/in-memory/in-memory.repositories.ts
src/repositories/index.ts
src/services/access-control.ts           (allocation:write → connection:write)
src/services/connection.service.ts       (all allocation refs)
src/services/overview.service.ts         (allocations → connections)
src/services/admin.service.ts            (allocations → connections)
src/api/http/router.ts                   (/allocations → /connections)
src/container.ts                         (repos + supabase branch)
src/index.ts                             (local dev only)
src/tests/connection.service.test.ts     (all allocation refs)
src/tests/access-control.test.ts         (allocation:write → connection:write)
public/index.html                        (terminology rename + 5 UI fixes)
```

---

## Task 1: Copy project to Project 7 and initialise git

**Files:** New folder at `C:\Users\thoma\Claude Programs\Project 7 - Connection Made Simple\connection-made-simple\`

- [ ] **Step 1: Create Project 7 folder and copy source**

```powershell
$src = "C:\Users\thoma\Claude Programs\Project 4 - Youth Apps\youth-allocation-platform"
$dst = "C:\Users\thoma\Claude Programs\Project 7 - Connection Made Simple\connection-made-simple"
New-Item -ItemType Directory -Force (Split-Path $dst)
Copy-Item -Recurse $src $dst
```

- [ ] **Step 2: Remove the old git history and remote, initialise a clean repo**

```powershell
Set-Location $dst
Remove-Item -Recurse -Force .git
git init
git remote add origin https://github.com/987tom1/connection-made-simple.git
```

- [ ] **Step 3: Stage everything and make an initial commit**

```powershell
git add -A
git commit -m "chore: initial copy from youth-allocation-platform"
```

All remaining tasks run from `$dst` as the working directory.

---

## Task 2: Update package.json and env.ts

**Files:**
- Modify: `package.json`
- Modify: `src/config/env.ts`

- [ ] **Step 1: Update package.json**

Replace the entire `package.json` with:

```json
{
  "name": "connection-made-simple",
  "version": "1.0.0",
  "description": "Youth ministry connection platform — phone-first SPA backed by Express + Supabase",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "express": "^4.19.2",
    "postgres": "^3.4.4",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.0",
    "@vercel/node": "^3.2.5",
    "tsx": "^4.19.0",
    "typescript": "^5.6.2",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Install new dependencies**

```powershell
npm install
```

Expected: `postgres` and `@vercel/node` appear in `node_modules`.

- [ ] **Step 3: Replace src/config/env.ts**

```ts
function getEnv(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (val === undefined) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export const env = {
  PORT: parseInt(getEnv('PORT', '4300'), 10),
  NODE_ENV: getEnv('NODE_ENV', 'development'),
  PERSISTENCE: getEnv('PERSISTENCE', 'memory') as 'memory' | 'json' | 'supabase',
  DATA_DIR: getEnv('DATA_DIR', './data'),
  CORS_ORIGINS: getEnv('CORS_ORIGINS', '*').split(','),
  DATABASE_URL: process.env['DATABASE_URL'],
};
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/config/env.ts
git commit -m "chore: rename package, add postgres dep, extend env for supabase"
```

---

## Task 3: Rename terminology — entities and interfaces

**Files:**
- Rename+modify: `src/core/entities/allocation.ts` → `connection.ts`
- Modify: `src/core/entities/settings.ts`
- Modify: `src/core/entities/index.ts`
- Modify: `src/repositories/interfaces/entity-repositories.ts`

- [ ] **Step 1: Rename and rewrite the allocation entity**

Delete `src/core/entities/allocation.ts`. Create `src/core/entities/connection.ts`:

```ts
import type { ID, ISODateString } from '../types/common';

export interface Connection {
  id: ID;
  studentId: string;
  leaderId: string;
  assignedByRole: string;
  createdAt: ISODateString;
}
```

- [ ] **Step 2: Update settings entity — rename allocationLockDate**

In `src/core/entities/settings.ts`, replace:
```ts
  allocationLockDate: string | null;
```
with:
```ts
  connectionLockDate: string | null;
```

- [ ] **Step 3: Update entities index**

Replace `src/core/entities/index.ts`:

```ts
export * from './user';
export * from './student';
export * from './leader';
export * from './connection';
export * from './attendance';
export * from './settings';
```

- [ ] **Step 4: Update entity-repositories interface**

In `src/repositories/interfaces/entity-repositories.ts`, make these changes:

1. Replace import line:
```ts
import type { Allocation } from '../../core/entities/allocation';
```
with:
```ts
import type { Connection } from '../../core/entities/connection';
```

2. Replace the `IAllocationRepository` interface:
```ts
export interface IConnectionRepository extends IRepository<Connection> {
  findByStudent(studentId: string): Promise<Connection[]>;
  findByLeader(leaderId: string): Promise<Connection[]>;
  findByStudentAndLeader(studentId: string, leaderId: string): Promise<Connection | null>;
  deleteByStudentAndLeader(studentId: string, leaderId: string): Promise<boolean>;
}
```

- [ ] **Step 5: Commit**

```bash
git add src/core/entities/ src/repositories/interfaces/
git commit -m "refactor: rename Allocation entity → Connection, allocationLockDate → connectionLockDate"
```

---

## Task 4: Rename terminology — in-memory repositories

**Files:**
- Modify: `src/repositories/in-memory/in-memory.repositories.ts`

- [ ] **Step 1: Update in-memory.repositories.ts**

Apply these changes to `src/repositories/in-memory/in-memory.repositories.ts`:

1. Replace import:
```ts
import type { Allocation } from '../../core/entities/allocation';
```
with:
```ts
import type { Connection } from '../../core/entities/connection';
```

2. Replace interface import:
```ts
  IAllocationRepository,
```
with:
```ts
  IConnectionRepository,
```

3. Replace the `// Allocations` section entirely:
```ts
// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------
export class InMemoryConnectionRepository
  extends InMemoryBaseRepository<Connection>
  implements IConnectionRepository
{
  constructor(persistence?: IPersistenceAdapter<Connection>) { super(persistence); }

  async findByStudent(studentId: string): Promise<Connection[]> {
    return Array.from(this.store.values())
      .filter((a) => a.studentId === studentId)
      .map((a) => this.clone(a));
  }

  async findByLeader(leaderId: string): Promise<Connection[]> {
    return Array.from(this.store.values())
      .filter((a) => a.leaderId === leaderId)
      .map((a) => this.clone(a));
  }

  async findByStudentAndLeader(studentId: string, leaderId: string): Promise<Connection | null> {
    for (const a of this.store.values()) {
      if (a.studentId === studentId && a.leaderId === leaderId) return this.clone(a);
    }
    return null;
  }

  async deleteByStudentAndLeader(studentId: string, leaderId: string): Promise<boolean> {
    for (const [id, a] of this.store.entries()) {
      if (a.studentId === studentId && a.leaderId === leaderId) {
        this.store.delete(id);
        await this.writeToPersistence();
        return true;
      }
    }
    return false;
  }
}
```

4. In `InMemorySettingsRepository.defaultSettings()`, replace:
```ts
      allocationLockDate: null,
```
with:
```ts
      connectionLockDate: null,
```

- [ ] **Step 2: Commit**

```bash
git add src/repositories/in-memory/in-memory.repositories.ts
git commit -m "refactor: rename InMemoryAllocationRepository → InMemoryConnectionRepository"
```

---

## Task 5: Rename terminology — access-control and connection service

**Files:**
- Modify: `src/services/access-control.ts`
- Rename+modify: `src/services/allocation.service.ts` → `src/services/connection.service.ts`

- [ ] **Step 1: Update access-control.ts**

In `src/services/access-control.ts`:

1. In the `Action` type, replace:
```ts
  | 'allocation:write'        // assign/unassign students to leaders
```
with:
```ts
  | 'connection:write'        // connect/disconnect students to leaders
```

2. In every `ROLE_PERMISSIONS` entry, replace `'allocation:write'` with `'connection:write'` (4 occurrences — grade, quad, director, admin).

- [ ] **Step 2: Create connection.service.ts (rename + update)**

Delete `src/services/allocation.service.ts`. Create `src/services/connection.service.ts` with all allocation references replaced:

```ts
import { z } from 'zod';
import { generateId } from '../utils/id';
import { assertCan, canAccessGrade, canAccessGender } from './access-control';
import type {
  IConnectionRepository,
  IStudentRepository,
  ILeaderRepository,
  ISettingsRepository,
} from '../repositories/interfaces/entity-repositories';
import type { Connection } from '../core/entities/connection';
import type { Actor } from '../core/entities/user';
import { NotFoundError, BadRequestError, ConflictError, ForbiddenError } from '../core/errors/app-error';

export interface ConnectionWithNames {
  id: string;
  studentId: string;
  studentName: string;
  leaderId: string;
  leaderName: string;
  assignedByRole: string;
  createdAt: string;
}

export interface ExportRow {
  leaderName: string;
  leaderGender: string | null;
  leaderGrades: string;
  studentName: string;
  studentGrade: number | null;
  studentGender: string;
  svcAttended: number;
  svcTotal: number;
  svcPct: string;
  atRiskStatus: string | null;
}

export interface ConnectionService {
  listByStudent(actor: Actor, studentId: string): Promise<ConnectionWithNames[]>;
  listByLeader(actor: Actor, leaderId: string): Promise<ConnectionWithNames[]>;
  listAll(actor: Actor): Promise<ConnectionWithNames[]>;
  assign(actor: Actor, input: unknown): Promise<Connection>;
  unassign(actor: Actor, studentId: string, leaderId: string): Promise<void>;
  leaderSummary(actor: Actor, leaderId: string): Promise<{ students: ReturnType<typeof summariseStudent>[]; leader: { id: string; fullName: string } }>;
  exportCsv(actor: Actor): Promise<ExportRow[]>;
}

function summariseStudent(s: {
  id: string; firstName: string; lastName: string; grade: number | null; gender: string;
  mobile: string | null; parentPhone: string | null; svcAttended: number; svcTotal: number;
  grpAttended: number; grpTotal: number;
}) {
  return {
    id: s.id,
    fullName: `${s.firstName} ${s.lastName}`,
    grade: s.grade,
    gender: s.gender,
    mobile: s.mobile,
    parentPhone: s.parentPhone,
    svcAttended: s.svcAttended,
    svcTotal: s.svcTotal,
    grpAttended: s.grpAttended,
    grpTotal: s.grpTotal,
  };
}

const AssignSchema = z.object({
  studentId: z.string().min(1),
  leaderId: z.string().min(1),
});

async function checkLock(settingsRepo: ISettingsRepository, actor: Actor): Promise<void> {
  if (actor.role === 'admin') return;
  const settings = await settingsRepo.getSettings();
  if (!settings.connectionLockDate) return;
  const lockDate = new Date(settings.connectionLockDate);
  if (new Date() >= lockDate) {
    throw new ForbiddenError(
      `Connections are locked as of ${lockDate.toLocaleDateString()}. Contact your admin to make changes.`,
    );
  }
}

export function makeConnectionService(
  connRepo: IConnectionRepository,
  studentRepo: IStudentRepository,
  leaderRepo: ILeaderRepository,
  settingsRepo: ISettingsRepository,
): ConnectionService {
  async function enrich(conns: Connection[]): Promise<ConnectionWithNames[]> {
    const results: ConnectionWithNames[] = [];
    for (const a of conns) {
      const student = await studentRepo.findById(a.studentId);
      const leader = await leaderRepo.findById(a.leaderId);
      results.push({
        ...a,
        studentName: student ? `${student.firstName} ${student.lastName}` : 'Unknown',
        leaderName: leader?.fullName ?? 'Unknown',
      });
    }
    return results;
  }

  return {
    async listByStudent(actor, studentId) {
      assertCan(actor, 'student:read');
      return enrich(await connRepo.findByStudent(studentId));
    },

    async listByLeader(actor, leaderId) {
      assertCan(actor, 'leader:read');
      return enrich(await connRepo.findByLeader(leaderId));
    },

    async listAll(actor) {
      assertCan(actor, 'student:read');
      const all = await connRepo.findAll();
      const filtered: Connection[] = [];
      for (const a of all) {
        const student = await studentRepo.findById(a.studentId);
        if (!student) continue;
        if (actor.role === 'grade' && student.grade !== actor.grade) continue;
        if (actor.role === 'quad') {
          if (!canAccessGrade(actor, student.grade) || !canAccessGender(actor, student.gender)) continue;
        }
        filtered.push(a);
      }
      return enrich(filtered);
    },

    async assign(actor, input) {
      assertCan(actor, 'connection:write');
      await checkLock(settingsRepo, actor);

      const { studentId, leaderId } = AssignSchema.parse(input);
      const student = await studentRepo.findById(studentId);
      if (!student) throw new NotFoundError('Student not found');
      const leader = await leaderRepo.findById(leaderId);
      if (!leader) throw new NotFoundError('Leader not found');

      if (actor.role === 'grade') {
        const ownGrade = student.grade === actor.grade;
        if (!ownGrade) {
          if (!leader.gender || student.gender !== leader.gender) {
            throw new BadRequestError('Cross-grade connection requires student and leader to share gender');
          }
        }
      }

      const existing = await connRepo.findByStudentAndLeader(studentId, leaderId);
      if (existing) throw new ConflictError('Connection already exists');

      return connRepo.save({
        id: generateId(),
        studentId,
        leaderId,
        assignedByRole: actor.role,
        createdAt: new Date().toISOString(),
      });
    },

    async unassign(actor, studentId, leaderId) {
      assertCan(actor, 'connection:write');
      await checkLock(settingsRepo, actor);
      const deleted = await connRepo.deleteByStudentAndLeader(studentId, leaderId);
      if (!deleted) throw new NotFoundError('Connection not found');
    },

    async leaderSummary(actor, leaderId) {
      assertCan(actor, 'leader:read');
      const leader = await leaderRepo.findById(leaderId);
      if (!leader) throw new NotFoundError('Leader not found');
      const conns = await connRepo.findByLeader(leaderId);
      const students = [];
      for (const a of conns) {
        const s = await studentRepo.findById(a.studentId);
        if (s) students.push(summariseStudent(s));
      }
      return { leader: { id: leader.id, fullName: leader.fullName }, students };
    },

    async exportCsv(actor) {
      assertCan(actor, 'student:read');
      const all = await connRepo.findAll();
      const rows: ExportRow[] = [];
      for (const a of all) {
        const student = await studentRepo.findById(a.studentId);
        const leader = await leaderRepo.findById(a.leaderId);
        if (!student || !leader) continue;
        if (actor.role === 'grade' && student.grade !== actor.grade) continue;
        if (actor.role === 'quad') {
          if (!canAccessGrade(actor, student.grade) || !canAccessGender(actor, student.gender)) continue;
        }
        const pct = student.svcTotal > 0
          ? Math.round((student.svcAttended / student.svcTotal) * 100) + '%'
          : '—';
        rows.push({
          leaderName: leader.fullName,
          leaderGender: leader.gender,
          leaderGrades: leader.grades.length ? leader.grades.join('; ') : 'All',
          studentName: `${student.firstName} ${student.lastName}`,
          studentGrade: student.grade,
          studentGender: student.gender,
          svcAttended: student.svcAttended,
          svcTotal: student.svcTotal,
          svcPct: pct,
          atRiskStatus: student.atRiskStatus,
        });
      }
      return rows.sort((a, b) => a.leaderName.localeCompare(b.leaderName) || a.studentName.localeCompare(b.studentName));
    },
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/services/
git commit -m "refactor: rename AllocationService → ConnectionService, allocation:write → connection:write"
```

---

## Task 6: Rename terminology — controller, router, container, and tests

**Files:**
- Rename+modify: `src/api/controllers/allocation.controller.ts` → `connection.controller.ts`
- Modify: `src/api/http/router.ts`
- Modify: `src/services/overview.service.ts`
- Modify: `src/services/admin.service.ts`
- Modify: `src/container.ts`
- Rename+modify: `src/tests/allocation.service.test.ts` → `connection.service.test.ts`
- Modify: `src/tests/access-control.test.ts`

- [ ] **Step 1: Rename controller**

Delete `src/api/controllers/allocation.controller.ts`. In the new `src/api/controllers/connection.controller.ts`, replace every occurrence of `allocation` / `Allocation` with `connection` / `Connection` (import path, function name, service key):

- `makeAllocationController` → `makeConnectionController`
- `import ... allocation.service` → `import ... connection.service`
- `AllocationService` → `ConnectionService`
- `{ allocation }` parameter → `{ connection }`
- `allocation.listAll` → `connection.listAll`, etc.

- [ ] **Step 2: Update router.ts**

In `src/api/http/router.ts`:

1. Replace:
```ts
import { makeAllocationController } from '../controllers/allocation.controller';
```
with:
```ts
import { makeConnectionController } from '../controllers/connection.controller';
```

2. Replace:
```ts
  const allocation = makeAllocationController({ allocation: services.allocation });
```
with:
```ts
  const connection = makeConnectionController({ connection: services.connection });
```

3. Replace the `// ----- Allocations -----` block:
```ts
    // ----- Connections -----
    { method: 'GET',    path: '/connections',                          auth: true, handler: (r) => connection.listAll(r) },
    { method: 'POST',   path: '/connections',                          auth: true, handler: (r) => connection.assign(r) },
    { method: 'GET',    path: '/connections/export',                   auth: true, handler: (r) => connection.exportCsv(r) },
    { method: 'GET',    path: '/connections/student/:studentId',       auth: true, handler: (r) => connection.listByStudent(r) },
    { method: 'GET',    path: '/connections/leader/:leaderId',         auth: true, handler: (r) => connection.listByLeader(r) },
    { method: 'GET',    path: '/connections/leader/:leaderId/summary', auth: true, handler: (r) => connection.leaderSummary(r) },
    { method: 'DELETE', path: '/connections/:studentId/:leaderId',     auth: true, handler: (r) => connection.unassign(r) },
```

- [ ] **Step 3: Update overview.service.ts**

Open `src/services/overview.service.ts`. Find all references to `IAllocationRepository`, `allocRepo`, `allocations`, `Allocation` and replace with `IConnectionRepository`, `connRepo`, `connections`, `Connection`. The import path changes from `../core/entities/allocation` to `../core/entities/connection` and from `../repositories/interfaces/entity-repositories` (interface name only).

- [ ] **Step 4: Update admin.service.ts**

Open `src/services/admin.service.ts`. Apply the same pattern: `IAllocationRepository` → `IConnectionRepository`, `allocRepo`/`allocations` parameter → `connRepo`/`connections`, import from `../core/entities/connection`.

- [ ] **Step 5: Update container.ts**

In `src/container.ts`:

1. Replace all allocation imports:
```ts
  InMemoryConnectionRepository,
```
(remove `InMemoryAllocationRepository`, add `InMemoryConnectionRepository`)

2. Replace interface import:
```ts
  IConnectionRepository,
```

3. Replace service imports:
```ts
import { makeConnectionService, type ConnectionService } from './services/connection.service';
```

4. In the `Repositories` interface:
```ts
  connections: IConnectionRepository;
```

5. In the `Services` interface:
```ts
  connection: ConnectionService;
```

6. In `buildContainer()`:
```ts
  const connections: IConnectionRepository = new InMemoryConnectionRepository(useJson ? makeJson('connections.json') : undefined);
```

7. In the repos object: `connections` (was `allocations`)

8. In `Promise.all([...init...])`: `connections.init()`

9. Service wiring:
```ts
  const connection = makeConnectionService(connections, students, leaders, settings);
```

10. In overview and admin service calls: pass `connections` instead of `allocations`.

11. In services object: `connection` (was `allocation`).

- [ ] **Step 6: Rename and update connection.service.test.ts**

Delete `src/tests/allocation.service.test.ts`. In the new `src/tests/connection.service.test.ts`, replace all `allocation` / `Allocation` occurrences with `connection` / `Connection`. Key replacements:
- Import path: `../services/connection.service`
- `makeAllocationService` → `makeConnectionService`
- `AllocationService` → `ConnectionService`
- `InMemoryAllocationRepository` → `InMemoryConnectionRepository`
- `repos.allocations` → `repos.connections`
- `'allocation:write'` → `'connection:write'` (in any permission checks within the test)
- `allocationLockDate` → `connectionLockDate`

- [ ] **Step 7: Update access-control.test.ts**

In `src/tests/access-control.test.ts` line 39, replace:
```ts
    expect(can(actor('quad', { quad: 'g79' }), 'allocation:write')).toBe(true);
```
with:
```ts
    expect(can(actor('quad', { quad: 'g79' }), 'connection:write')).toBe(true);
```

- [ ] **Step 8: Run typecheck and tests**

```bash
npm run typecheck
```
Expected: 0 errors.

```bash
npm run test
```
Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/
git commit -m "refactor: complete allocation → connection rename across backend"
```

---

## Task 7: SPA terminology rename

**Files:**
- Modify: `public/index.html`

The Connection Audit (CA) module inside the `/* ── CA MODULE … ── */` block already uses "connect/connection" extensively. The rename must only touch `allocat*` occurrences — **do not change any identifier inside the CA module block**.

- [ ] **Step 1: Rename all allocat* occurrences outside the CA module**

Open `public/index.html` in an editor that supports find-and-replace with case sensitivity. Work through these replacements IN ORDER (most specific first to avoid double-replacement):

| Find (exact case) | Replace with |
|---|---|
| `De-allocate` | `Disconnect` |
| `de-allocate` | `disconnect` |
| `De-Allocate` | `Disconnect` |
| `Unallocated` | `Unconnected` |
| `unallocated` | `unconnected` |
| `Deallocate` | `Disconnect` |
| `deallocate` | `disconnect` |
| `Reallocate` | `Reconnect` |
| `reallocate` | `reconnect` |
| `Allocated` | `Connected` |
| `allocated` | `connected` |
| `Allocating` | `Connecting` |
| `allocating` | `connecting` |
| `Allocation` | `Connection` |
| `allocation` | `connection` |
| `Allocate` | `Connect` |
| `allocate` | `connect` |

After each replacement pass, verify the CA module block (`/* ── CA MODULE … ── */` to its closing comment) has not been modified. The CA block uses `ca-overview`, `caConnection`, etc. — none of these contain `allocat*` so they are safe.

- [ ] **Step 2: Update API fetch paths**

Confirm `fetch('/connections` appears where `fetch('/allocations` was. Search for `/connections` and verify all former `/allocations` paths are updated.

- [ ] **Step 3: Syntax-check the embedded JS**

```powershell
# Extract the <script> block and check syntax
$content = Get-Content public/index.html -Raw
$start = $content.IndexOf('<script>') + 8
$end = $content.LastIndexOf('</script>')
$script = $content.Substring($start, $end - $start)
Set-Content -Path temp-check.js -Value $script -Encoding utf8
node --check temp-check.js
Remove-Item temp-check.js
```

Expected: no syntax errors printed.

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "refactor: rename allocate/allocation → connect/connection in SPA"
```

---

## Task 8: SPA UI fixes — at-risk page (reorder + collapse + multi-column)

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Reorder at-risk categories and add collapse**

Find the `renderAtRisk` function in `public/index.html`. Within it, locate the three category sections rendered for `declining`, `atRisk`/`at-risk`, and `stopped`. Reorder them so **declining renders first, then at-risk, then stopped**.

For each category section, wrap the card list in a collapsible container. Change the category header from a plain heading to a clickable toggle. The pattern for each section:

```html
<!-- Before (example for one category): -->
<div class="atrisk-section">
  <h3 class="section-title">At Risk (${atRiskStudents.length})</h3>
  <div class="atrisk-cards">${atRiskStudents.map(renderCard).join('')}</div>
</div>

<!-- After: -->
<div class="atrisk-section">
  <button class="atrisk-toggle" onclick="toggleAtRisk(this)" aria-expanded="false">
    <span>At Risk</span>
    <span class="atrisk-count">${atRiskStudents.length}</span>
    <span class="atrisk-chevron">▶</span>
  </button>
  <div class="atrisk-body" hidden>
    <div class="atrisk-cards">${atRiskStudents.map(renderCard).join('')}</div>
  </div>
</div>
```

Apply the same pattern to `declining` and `stopped` sections, adjusting labels.

Add the toggle function near the other utility functions:

```js
function toggleAtRisk(btn) {
  const body = btn.nextElementSibling;
  const expanded = btn.getAttribute('aria-expanded') === 'true';
  btn.setAttribute('aria-expanded', String(!expanded));
  btn.querySelector('.atrisk-chevron').textContent = expanded ? '▶' : '▼';
  body.hidden = expanded;
}
```

Add CSS for the toggle button (find the existing `<style>` block and add near the at-risk styles):

```css
.atrisk-toggle {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 10px 12px;
  background: var(--surface, #fff); border: 1px solid var(--border, #e5e7eb);
  border-radius: 8px; cursor: pointer; font-size: 15px; font-weight: 600;
  text-align: left;
}
.atrisk-toggle .atrisk-count {
  margin-left: auto; background: var(--muted-bg, #f3f4f6);
  padding: 2px 8px; border-radius: 12px; font-size: 13px;
}
.atrisk-toggle .atrisk-chevron { font-size: 11px; color: var(--text-muted, #6b7280); }
```

- [ ] **Step 2: Add multi-column CSS for at-risk card grid**

Find `.atrisk-cards` (or the equivalent class on the cards container) in the CSS block. Add or replace its style with:

```css
.atrisk-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 10px;
  padding: 10px 0;
}
```

This gives 1 column on phones, 2 columns at ~640px, 3 columns at ~960px automatically.

- [ ] **Step 3: Syntax-check**

```powershell
$content = Get-Content public/index.html -Raw
$start = $content.IndexOf('<script>') + 8
$end = $content.LastIndexOf('</script>')
$script = $content.Substring($start, $end - $start)
Set-Content -Path temp-check.js -Value $script -Encoding utf8
node --check temp-check.js
Remove-Item temp-check.js
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: at-risk page — reorder categories, collapse by default, multi-column grid"
```

---

## Task 9: SPA UI fixes — CA ladder text, search focus, home columns

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: CA integration ladder — rung 4 label**

Inside the CA module block (between `/* ── CA MODULE … ── */` markers), find the integration ladder definition. The fourth rung label currently reads something like `'In a lifegroup'` or `'In a Lifegroup'`. Change it to:

```
'Attended a lifegroup this term'
```

Search for: `In a lifegroup` (case-insensitive) within the CA block. Replace only the display label string, not any code logic.

- [ ] **Step 2: Student search — fix focus loss after first keystroke**

Find the student search input in `public/index.html`. It will be near a function like `renderStudents` or a search input with an `oninput` handler. The bug is that rendering the results replaces a parent DOM node that contains the input, destroying focus.

Fix: move the search input above the re-rendered results container, or save/restore focus explicitly. The simplest fix is to save the cursor position and refocus after render:

Find the render-on-input handler (e.g., `oninput="searchStudents(this.value)"`). In the `searchStudents` (or equivalent) function, add at the end of the re-render call:

```js
// Restore focus after DOM update
const inp = document.getElementById('student-search-input'); // use actual id
if (inp && document.activeElement !== inp) inp.focus();
```

If the input has no `id`, add `id="student-search-input"` to it first.

Alternatively, if the input is inside a container that gets completely replaced on each render, move the input HTML to be a sibling above the results container rather than inside it, so re-rendering the results doesn't destroy the input.

- [ ] **Step 3: Home page — attendance-by-grade columns too wide**

Find the home page grade breakdown table. It renders inside a dropped-down section on the home screen for quad/director logins. Look for the `<table>` element inside the attendance-by-grade accordion (`toggleHomeQuad` or similar).

Add `<colgroup>` with explicit widths, and constrain the table:

```html
<!-- Wrap the table in a constrained container if not already: -->
<div style="overflow-x:auto">
  <table style="width:100%;max-width:480px;table-layout:fixed">
    <colgroup>
      <col style="width:90px">   <!-- Grade -->
      <col style="width:60px">   <!-- Attended -->
      <col style="width:60px">   <!-- Total -->
      <col style="width:64px">   <!-- Rate % -->
    </colgroup>
    <!-- existing thead/tbody -->
  </table>
</div>
```

Find the existing table rendering code in the grade breakdown section and apply these constraints.

- [ ] **Step 4: Syntax-check**

```powershell
$content = Get-Content public/index.html -Raw
$start = $content.IndexOf('<script>') + 8
$end = $content.LastIndexOf('</script>')
$script = $content.Substring($start, $end - $start)
Set-Content -Path temp-check.js -Value $script -Encoding utf8
node --check temp-check.js
Remove-Item temp-check.js
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "fix: CA ladder rung 4 label, search focus retention, home grade column widths"
```

---

## Task 10: Supabase migration files

**Files:**
- Create: `supabase/migrations/001_initial_schema.sql`
- Create: `supabase/migrations/002_seed_admin.sql`

- [ ] **Step 1: Create migrations folder**

```powershell
New-Item -ItemType Directory -Force supabase/migrations
```

- [ ] **Step 2: Create 001_initial_schema.sql**

Note: `import_records` is defined before `service_sessions` and `lifegroup_weeks` because those tables reference it via FK.

```sql
-- 001_initial_schema.sql
-- Connection Made Simple — initial schema

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

- [ ] **Step 3: Create 002_seed_admin.sql**

```sql
-- 002_seed_admin.sql
-- Seeds the initial admin account.
-- IMPORTANT: Replace PLACEHOLDER_HASH below before running.
-- Generate a real hash by running in the project root:
--   npx tsx temp-hash.ts
-- where temp-hash.ts contains:
--   import { hashPassword } from './src/utils/crypto';
--   console.log(await hashPassword('your-chosen-password'));
-- Then paste the output (format: <hex>:<hex>) as the password_hash value.

insert into users (display_name, email, role, status, password_hash, created_at, updated_at)
values (
  'Admin',
  'admin@youth.ministry',
  'admin',
  'active',
  'PLACEHOLDER_HASH',
  now(),
  now()
);
```

- [ ] **Step 4: Commit**

```bash
git add supabase/
git commit -m "feat: supabase migrations — initial schema + admin seed template"
```

---

## Task 11: Supabase client + users + students repos

**Files:**
- Create: `src/repositories/supabase/client.ts`
- Create: `src/repositories/supabase/supabase.users.ts`
- Create: `src/repositories/supabase/supabase.students.ts`

- [ ] **Step 1: Create client.ts**

```ts
import postgres from 'postgres';
import { env } from '../../config/env';

export type SqlClient = ReturnType<typeof postgres>;

let _client: SqlClient | undefined;

export function getSqlClient(): SqlClient {
  if (!_client) {
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required when PERSISTENCE=supabase');
    _client = postgres(env.DATABASE_URL, { max: 1, prepare: false });
  }
  return _client;
}
```

Lazy initialisation: the client is only created when `getSqlClient()` is first called (i.e. when `PERSISTENCE=supabase`). This prevents crashes when running in `memory` mode without a `DATABASE_URL`.

`prepare: false` is required for Supabase's PgBouncer transaction pooler (port 6543).

- [ ] **Step 2: Create supabase.users.ts**

```ts
import type { IUserRepository } from '../interfaces/entity-repositories';
import type { User } from '../../core/entities/user';
import type { UserRole } from '../../core/types/enums';
import type { postgres } from 'postgres';

import type { SqlClient } from './client';

function toUser(row: Record<string, unknown>): User {
  return {
    id: row['id'] as string,
    displayName: row['display_name'] as string,
    email: row['email'] as string,
    role: row['role'] as UserRole,
    grade: row['grade'] as number | null,
    quad: row['quad'] as string | null,
    status: row['status'] as 'active' | 'inactive',
    passwordHash: (row['password_hash'] as string | null) ?? undefined,
    createdAt: (row['created_at'] as Date).toISOString(),
    updatedAt: (row['updated_at'] as Date).toISOString(),
  };
}

export class SupabaseUserRepository implements IUserRepository {
  constructor(private sql: SqlClient) {}

  async init(): Promise<void> {}

  async findById(id: string): Promise<User | null> {
    const rows = await this.sql`select * from users where id = ${id}`;
    return rows[0] ? toUser(rows[0]) : null;
  }

  async findAll(): Promise<User[]> {
    const rows = await this.sql`select * from users order by created_at`;
    return rows.map(toUser);
  }

  async save(user: User): Promise<User> {
    const rows = await this.sql`
      insert into users
        (id, display_name, email, role, grade, quad, status, password_hash, created_at, updated_at)
      values
        (${user.id}, ${user.displayName}, ${user.email}, ${user.role},
         ${user.grade ?? null}, ${user.quad ?? null}, ${user.status},
         ${user.passwordHash ?? null}, ${user.createdAt}, ${user.updatedAt})
      on conflict (id) do update set
        display_name  = excluded.display_name,
        email         = excluded.email,
        role          = excluded.role,
        grade         = excluded.grade,
        quad          = excluded.quad,
        status        = excluded.status,
        password_hash = excluded.password_hash,
        updated_at    = excluded.updated_at
      returning *
    `;
    return toUser(rows[0]);
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.sql`delete from users where id = ${id} returning id`;
    return rows.length > 0;
  }

  async findByEmail(email: string): Promise<User | null> {
    const rows = await this.sql`select * from users where lower(email) = lower(${email})`;
    return rows[0] ? toUser(rows[0]) : null;
  }

  async findByRole(role: UserRole): Promise<User[]> {
    const rows = await this.sql`select * from users where role = ${role}`;
    return rows.map(toUser);
  }
}
```

- [ ] **Step 3: Create supabase.students.ts**

```ts
import type { IStudentRepository } from '../interfaces/entity-repositories';
import type { Student } from '../../core/entities/student';
import type { Gender, Quad, AtRiskStatus } from '../../core/types/enums';

import type { SqlClient } from './client';

function toStudent(row: Record<string, unknown>): Student {
  return {
    id: row['id'] as string,
    firstName: row['first_name'] as string,
    lastName: row['last_name'] as string,
    gender: row['gender'] as Gender,
    grade: row['grade'] as number | null,
    quad: row['quad'] as Quad | null,
    mobile: row['mobile'] as string | null,
    parentPhone: row['parent_phone'] as string | null,
    dateOfBirth: row['date_of_birth'] ? String(row['date_of_birth']) : null,
    svcAttended: row['svc_attended'] as number,
    svcTotal: row['svc_total'] as number,
    grpAttended: row['grp_attended'] as number,
    grpTotal: row['grp_total'] as number,
    grpMetWeeks: row['grp_met_weeks'] as number,
    prevSvcAttended: row['prev_svc_attended'] as number,
    prevSvcTotal: row['prev_svc_total'] as number,
    prevGrpAttended: row['prev_grp_attended'] as number,
    prevGrpTotal: row['prev_grp_total'] as number,
    atRiskStatus: row['at_risk_status'] as AtRiskStatus | null,
    dataSource: row['data_source'] as string | null,
    createdAt: (row['created_at'] as Date).toISOString(),
    updatedAt: (row['updated_at'] as Date).toISOString(),
  };
}

export class SupabaseStudentRepository implements IStudentRepository {
  constructor(private sql: SqlClient) {}

  async init(): Promise<void> {}

  async findById(id: string): Promise<Student | null> {
    const rows = await this.sql`select * from students where id = ${id}`;
    return rows[0] ? toStudent(rows[0]) : null;
  }

  async findAll(): Promise<Student[]> {
    const rows = await this.sql`select * from students order by last_name, first_name`;
    return rows.map(toStudent);
  }

  async save(s: Student): Promise<Student> {
    const rows = await this.sql`
      insert into students (
        id, first_name, last_name, gender, grade, quad, mobile, parent_phone, date_of_birth,
        svc_attended, svc_total, grp_attended, grp_total, grp_met_weeks,
        prev_svc_attended, prev_svc_total, prev_grp_attended, prev_grp_total,
        at_risk_status, data_source, created_at, updated_at
      ) values (
        ${s.id}, ${s.firstName}, ${s.lastName}, ${s.gender}, ${s.grade ?? null},
        ${s.quad ?? null}, ${s.mobile ?? null}, ${s.parentPhone ?? null},
        ${s.dateOfBirth ?? null},
        ${s.svcAttended}, ${s.svcTotal}, ${s.grpAttended}, ${s.grpTotal}, ${s.grpMetWeeks},
        ${s.prevSvcAttended}, ${s.prevSvcTotal}, ${s.prevGrpAttended}, ${s.prevGrpTotal},
        ${s.atRiskStatus ?? null}, ${s.dataSource ?? null}, ${s.createdAt}, ${s.updatedAt}
      )
      on conflict (id) do update set
        first_name = excluded.first_name, last_name = excluded.last_name,
        gender = excluded.gender, grade = excluded.grade, quad = excluded.quad,
        mobile = excluded.mobile, parent_phone = excluded.parent_phone,
        date_of_birth = excluded.date_of_birth,
        svc_attended = excluded.svc_attended, svc_total = excluded.svc_total,
        grp_attended = excluded.grp_attended, grp_total = excluded.grp_total,
        grp_met_weeks = excluded.grp_met_weeks,
        prev_svc_attended = excluded.prev_svc_attended, prev_svc_total = excluded.prev_svc_total,
        prev_grp_attended = excluded.prev_grp_attended, prev_grp_total = excluded.prev_grp_total,
        at_risk_status = excluded.at_risk_status, data_source = excluded.data_source,
        updated_at = excluded.updated_at
      returning *
    `;
    return toStudent(rows[0]);
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.sql`delete from students where id = ${id} returning id`;
    return rows.length > 0;
  }

  async findByGrade(grade: number): Promise<Student[]> {
    const rows = await this.sql`select * from students where grade = ${grade}`;
    return rows.map(toStudent);
  }

  async findByGender(gender: string): Promise<Student[]> {
    const rows = await this.sql`select * from students where lower(gender) = lower(${gender})`;
    return rows.map(toStudent);
  }

  async search(query: string): Promise<Student[]> {
    const terms = query.trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    const pattern = terms.map(t => `%${t}%`).join('');
    const rows = await this.sql`
      select * from students
      where lower(first_name || ' ' || last_name) like lower(${`%${query.trim()}%`})
      order by last_name, first_name
      limit 50
    `;
    return rows.map(toStudent);
  }
}
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: 0 errors (the new files are not imported yet, so they compile in isolation).

- [ ] **Step 5: Commit**

```bash
git add src/repositories/supabase/
git commit -m "feat: supabase client + user + student repositories"
```

---

## Task 12: Supabase leaders and connections repos

**Files:**
- Create: `src/repositories/supabase/supabase.leaders.ts`
- Create: `src/repositories/supabase/supabase.connections.ts`

- [ ] **Step 1: Create supabase.leaders.ts**

```ts
import type { ILeaderRepository } from '../interfaces/entity-repositories';
import type { Leader } from '../../core/entities/leader';
import type { Gender, Grade } from '../../core/types/enums';

import type { SqlClient } from './client';

function toLeader(row: Record<string, unknown>): Leader {
  return {
    id: row['id'] as string,
    fullName: row['full_name'] as string,
    gender: row['gender'] as Gender | null,
    grades: (row['grades'] as number[]) as Grade[],
    active: row['active'] as boolean,
    createdByGrade: row['created_by_grade'] as number | null,
    createdAt: (row['created_at'] as Date).toISOString(),
    updatedAt: (row['updated_at'] as Date).toISOString(),
  };
}

export class SupabaseLeaderRepository implements ILeaderRepository {
  constructor(private sql: SqlClient) {}

  async init(): Promise<void> {}

  async findById(id: string): Promise<Leader | null> {
    const rows = await this.sql`select * from leaders where id = ${id}`;
    return rows[0] ? toLeader(rows[0]) : null;
  }

  async findAll(): Promise<Leader[]> {
    const rows = await this.sql`select * from leaders order by full_name`;
    return rows.map(toLeader);
  }

  async save(l: Leader): Promise<Leader> {
    const rows = await this.sql`
      insert into leaders (id, full_name, gender, grades, active, created_by_grade, created_at, updated_at)
      values (${l.id}, ${l.fullName}, ${l.gender ?? null}, ${l.grades}, ${l.active},
              ${l.createdByGrade ?? null}, ${l.createdAt}, ${l.updatedAt})
      on conflict (id) do update set
        full_name        = excluded.full_name,
        gender           = excluded.gender,
        grades           = excluded.grades,
        active           = excluded.active,
        created_by_grade = excluded.created_by_grade,
        updated_at       = excluded.updated_at
      returning *
    `;
    return toLeader(rows[0]);
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.sql`delete from leaders where id = ${id} returning id`;
    return rows.length > 0;
  }

  async findByGrade(grade: number): Promise<Leader[]> {
    const rows = await this.sql`
      select * from leaders
      where active = true and (array_length(grades, 1) is null or ${grade} = any(grades))
    `;
    return rows.map(toLeader);
  }

  async findActive(): Promise<Leader[]> {
    const rows = await this.sql`select * from leaders where active = true order by full_name`;
    return rows.map(toLeader);
  }
}
```

- [ ] **Step 2: Create supabase.connections.ts**

```ts
import type { IConnectionRepository } from '../interfaces/entity-repositories';
import type { Connection } from '../../core/entities/connection';

import type { SqlClient } from './client';

function toConnection(row: Record<string, unknown>): Connection {
  return {
    id: row['id'] as string,
    studentId: row['student_id'] as string,
    leaderId: row['leader_id'] as string,
    assignedByRole: row['assigned_by_role'] as string,
    createdAt: (row['created_at'] as Date).toISOString(),
  };
}

export class SupabaseConnectionRepository implements IConnectionRepository {
  constructor(private sql: SqlClient) {}

  async init(): Promise<void> {}

  async findById(id: string): Promise<Connection | null> {
    const rows = await this.sql`select * from connections where id = ${id}`;
    return rows[0] ? toConnection(rows[0]) : null;
  }

  async findAll(): Promise<Connection[]> {
    const rows = await this.sql`select * from connections order by created_at`;
    return rows.map(toConnection);
  }

  async save(c: Connection): Promise<Connection> {
    const rows = await this.sql`
      insert into connections (id, student_id, leader_id, assigned_by_role, created_at)
      values (${c.id}, ${c.studentId}, ${c.leaderId}, ${c.assignedByRole}, ${c.createdAt})
      on conflict (id) do update set
        assigned_by_role = excluded.assigned_by_role
      returning *
    `;
    return toConnection(rows[0]);
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.sql`delete from connections where id = ${id} returning id`;
    return rows.length > 0;
  }

  async findByStudent(studentId: string): Promise<Connection[]> {
    const rows = await this.sql`select * from connections where student_id = ${studentId}`;
    return rows.map(toConnection);
  }

  async findByLeader(leaderId: string): Promise<Connection[]> {
    const rows = await this.sql`select * from connections where leader_id = ${leaderId}`;
    return rows.map(toConnection);
  }

  async findByStudentAndLeader(studentId: string, leaderId: string): Promise<Connection | null> {
    const rows = await this.sql`
      select * from connections where student_id = ${studentId} and leader_id = ${leaderId}
    `;
    return rows[0] ? toConnection(rows[0]) : null;
  }

  async deleteByStudentAndLeader(studentId: string, leaderId: string): Promise<boolean> {
    const rows = await this.sql`
      delete from connections where student_id = ${studentId} and leader_id = ${leaderId}
      returning id
    `;
    return rows.length > 0;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/repositories/supabase/
git commit -m "feat: supabase leader + connection repositories"
```

---

## Task 13: Supabase attendance repositories

**Files:**
- Create: `src/repositories/supabase/supabase.attendance.ts`

This file implements 6 interfaces: `IServiceSessionRepository`, `IServiceAttendanceRepository`, `ILifegroupRepository`, `ILifegroupWeekRepository`, `ILifegroupAttendanceRepository`, `IImportRepository`.

- [ ] **Step 1: Create supabase.attendance.ts**

```ts
import type {
  IServiceSessionRepository,
  IServiceAttendanceRepository,
  ILifegroupRepository,
  ILifegroupWeekRepository,
  ILifegroupAttendanceRepository,
  IImportRepository,
} from '../interfaces/entity-repositories';
import type {
  ServiceSession,
  ServiceAttendance,
  Lifegroup,
  LifegroupWeek,
  LifegroupAttendance,
  ImportRecord,
} from '../../core/entities/attendance';

import type { SqlClient } from './client';

// ── Service Sessions ──────────────────────────────────────────────────────────

function toSession(r: Record<string, unknown>): ServiceSession {
  return {
    id: r['id'] as string,
    importId: r['import_id'] as string,
    sessionDate: String(r['session_date']),
    sessionName: r['session_name'] as string,
    isRegular: r['is_regular'] as boolean,
    isValid: r['is_valid'] as boolean,
    totalAttendance: r['total_attendance'] as number,
    sortOrder: r['sort_order'] as number,
    createdAt: (r['created_at'] as Date).toISOString(),
  };
}

export class SupabaseServiceSessionRepository implements IServiceSessionRepository {
  constructor(private sql: SqlClient) {}
  async init(): Promise<void> {}

  async findById(id: string): Promise<ServiceSession | null> {
    const rows = await this.sql`select * from service_sessions where id = ${id}`;
    return rows[0] ? toSession(rows[0]) : null;
  }

  async findAll(): Promise<ServiceSession[]> {
    const rows = await this.sql`select * from service_sessions order by sort_order`;
    return rows.map(toSession);
  }

  async save(s: ServiceSession): Promise<ServiceSession> {
    const rows = await this.sql`
      insert into service_sessions
        (id, import_id, session_date, session_name, is_regular, is_valid, total_attendance, sort_order, created_at)
      values
        (${s.id}, ${s.importId}, ${s.sessionDate}, ${s.sessionName}, ${s.isRegular},
         ${s.isValid}, ${s.totalAttendance}, ${s.sortOrder}, ${s.createdAt})
      on conflict (id) do update set
        session_name = excluded.session_name, is_regular = excluded.is_regular,
        is_valid = excluded.is_valid, total_attendance = excluded.total_attendance,
        sort_order = excluded.sort_order
      returning *
    `;
    return toSession(rows[0]);
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.sql`delete from service_sessions where id = ${id} returning id`;
    return rows.length > 0;
  }

  async findByImport(importId: string): Promise<ServiceSession[]> {
    const rows = await this.sql`select * from service_sessions where import_id = ${importId}`;
    return rows.map(toSession);
  }

  async findValid(): Promise<ServiceSession[]> {
    const rows = await this.sql`
      select * from service_sessions where is_valid = true and is_regular = true
      order by sort_order
    `;
    return rows.map(toSession);
  }
}

// ── Service Attendance ────────────────────────────────────────────────────────

function toServiceAtt(r: Record<string, unknown>): ServiceAttendance {
  return {
    studentId: r['student_id'] as string,
    sessionId: r['session_id'] as string,
    attended: r['attended'] as boolean,
  };
}

export class SupabaseServiceAttendanceRepository implements IServiceAttendanceRepository {
  constructor(private sql: SqlClient) {}
  async init(): Promise<void> {}

  async findAll(): Promise<ServiceAttendance[]> {
    const rows = await this.sql`select * from service_attendance`;
    return rows.map(toServiceAtt);
  }

  async findByStudent(studentId: string): Promise<ServiceAttendance[]> {
    const rows = await this.sql`select * from service_attendance where student_id = ${studentId}`;
    return rows.map(toServiceAtt);
  }

  async findBySession(sessionId: string): Promise<ServiceAttendance[]> {
    const rows = await this.sql`select * from service_attendance where session_id = ${sessionId}`;
    return rows.map(toServiceAtt);
  }

  async save(record: ServiceAttendance): Promise<ServiceAttendance> {
    const rows = await this.sql`
      insert into service_attendance (student_id, session_id, attended)
      values (${record.studentId}, ${record.sessionId}, ${record.attended})
      on conflict (student_id, session_id) do update set attended = excluded.attended
      returning *
    `;
    return toServiceAtt(rows[0]);
  }

  async saveMany(records: ServiceAttendance[]): Promise<void> {
    if (records.length === 0) return;
    await this.sql`
      insert into service_attendance ${this.sql(records.map(r => ({
        student_id: r.studentId,
        session_id: r.sessionId,
        attended: r.attended,
      })))}
      on conflict (student_id, session_id) do update set attended = excluded.attended
    `;
  }

  async deleteByImport(importId: string): Promise<void> {
    await this.sql`
      delete from service_attendance
      where session_id in (select id from service_sessions where import_id = ${importId})
    `;
  }
}

// ── Lifegroups ────────────────────────────────────────────────────────────────

function toLifegroup(r: Record<string, unknown>): Lifegroup {
  return {
    id: r['id'] as string,
    fullName: r['full_name'] as string,
    shortName: r['short_name'] as string,
    grade: r['grade'] as number | null,
    gender: r['gender'] as string | null,
    createdAt: (r['created_at'] as Date).toISOString(),
  };
}

export class SupabaseLifegroupRepository implements ILifegroupRepository {
  constructor(private sql: SqlClient) {}
  async init(): Promise<void> {}

  async findById(id: string): Promise<Lifegroup | null> {
    const rows = await this.sql`select * from lifegroups where id = ${id}`;
    return rows[0] ? toLifegroup(rows[0]) : null;
  }

  async findAll(): Promise<Lifegroup[]> {
    const rows = await this.sql`select * from lifegroups order by full_name`;
    return rows.map(toLifegroup);
  }

  async save(l: Lifegroup): Promise<Lifegroup> {
    const rows = await this.sql`
      insert into lifegroups (id, full_name, short_name, grade, gender, created_at)
      values (${l.id}, ${l.fullName}, ${l.shortName}, ${l.grade ?? null}, ${l.gender ?? null}, ${l.createdAt})
      on conflict (id) do update set
        full_name = excluded.full_name, short_name = excluded.short_name,
        grade = excluded.grade, gender = excluded.gender
      returning *
    `;
    return toLifegroup(rows[0]);
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.sql`delete from lifegroups where id = ${id} returning id`;
    return rows.length > 0;
  }
}

// ── Lifegroup Weeks ───────────────────────────────────────────────────────────

function toLifegroupWeek(r: Record<string, unknown>): LifegroupWeek {
  return {
    id: r['id'] as string,
    importId: r['import_id'] as string,
    weekNum: r['week_num'] as number,
    weekKey: r['week_key'] as string,
    weekStart: String(r['week_start']),
    weekEnd: r['week_end'] ? String(r['week_end']) : null,
  };
}

export class SupabaseLifegroupWeekRepository implements ILifegroupWeekRepository {
  constructor(private sql: SqlClient) {}
  async init(): Promise<void> {}

  async findById(id: string): Promise<LifegroupWeek | null> {
    const rows = await this.sql`select * from lifegroup_weeks where id = ${id}`;
    return rows[0] ? toLifegroupWeek(rows[0]) : null;
  }

  async findAll(): Promise<LifegroupWeek[]> {
    const rows = await this.sql`select * from lifegroup_weeks order by week_num`;
    return rows.map(toLifegroupWeek);
  }

  async save(w: LifegroupWeek): Promise<LifegroupWeek> {
    const rows = await this.sql`
      insert into lifegroup_weeks (id, import_id, week_num, week_key, week_start, week_end)
      values (${w.id}, ${w.importId}, ${w.weekNum}, ${w.weekKey}, ${w.weekStart}, ${w.weekEnd ?? null})
      on conflict (id) do update set
        week_num = excluded.week_num, week_key = excluded.week_key,
        week_start = excluded.week_start, week_end = excluded.week_end
      returning *
    `;
    return toLifegroupWeek(rows[0]);
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.sql`delete from lifegroup_weeks where id = ${id} returning id`;
    return rows.length > 0;
  }

  async findByImport(importId: string): Promise<LifegroupWeek[]> {
    const rows = await this.sql`select * from lifegroup_weeks where import_id = ${importId}`;
    return rows.map(toLifegroupWeek);
  }
}

// ── Lifegroup Attendance ──────────────────────────────────────────────────────

function toLgAtt(r: Record<string, unknown>): LifegroupAttendance {
  return {
    studentId: r['student_id'] as string,
    weekId: r['week_id'] as string,
    lifegroupId: r['lifegroup_id'] as string,
    groupMet: r['group_met'] as boolean,
    attended: r['attended'] as boolean,
  };
}

export class SupabaseLifegroupAttendanceRepository implements ILifegroupAttendanceRepository {
  constructor(private sql: SqlClient) {}
  async init(): Promise<void> {}

  async findAll(): Promise<LifegroupAttendance[]> {
    const rows = await this.sql`select * from lifegroup_attendance`;
    return rows.map(toLgAtt);
  }

  async findByStudent(studentId: string): Promise<LifegroupAttendance[]> {
    const rows = await this.sql`select * from lifegroup_attendance where student_id = ${studentId}`;
    return rows.map(toLgAtt);
  }

  async findByWeek(weekId: string): Promise<LifegroupAttendance[]> {
    const rows = await this.sql`select * from lifegroup_attendance where week_id = ${weekId}`;
    return rows.map(toLgAtt);
  }

  async saveMany(records: LifegroupAttendance[]): Promise<void> {
    if (records.length === 0) return;
    await this.sql`
      insert into lifegroup_attendance ${this.sql(records.map(r => ({
        student_id: r.studentId,
        week_id: r.weekId,
        lifegroup_id: r.lifegroupId,
        group_met: r.groupMet,
        attended: r.attended,
      })))}
      on conflict (student_id, week_id) do update set
        lifegroup_id = excluded.lifegroup_id,
        group_met = excluded.group_met,
        attended = excluded.attended
    `;
  }

  async deleteByImport(importId: string): Promise<void> {
    await this.sql`
      delete from lifegroup_attendance
      where week_id in (select id from lifegroup_weeks where import_id = ${importId})
    `;
  }
}

// ── Import Records ────────────────────────────────────────────────────────────

function toImport(r: Record<string, unknown>): ImportRecord {
  return {
    id: r['id'] as string,
    type: r['type'] as 'service' | 'lifegroup',
    filename: r['filename'] as string,
    fileHash: r['file_hash'] as string,
    rowCount: r['row_count'] as number,
    sessionsAdded: r['sessions_added'] as number,
    studentsAdded: r['students_added'] as number,
    studentsUpdated: r['students_updated'] as number,
    status: r['status'] as 'ok' | 'error',
    errorMessage: r['error_message'] as string | null,
    importedAt: (r['imported_at'] as Date).toISOString(),
    importedBy: r['imported_by'] as string,
  };
}

export class SupabaseImportRepository implements IImportRepository {
  constructor(private sql: SqlClient) {}
  async init(): Promise<void> {}

  async findById(id: string): Promise<ImportRecord | null> {
    const rows = await this.sql`select * from import_records where id = ${id}`;
    return rows[0] ? toImport(rows[0]) : null;
  }

  async findAll(): Promise<ImportRecord[]> {
    const rows = await this.sql`select * from import_records order by imported_at desc`;
    return rows.map(toImport);
  }

  async save(rec: ImportRecord): Promise<ImportRecord> {
    const rows = await this.sql`
      insert into import_records
        (id, type, filename, file_hash, row_count, sessions_added, students_added,
         students_updated, status, error_message, imported_at, imported_by)
      values
        (${rec.id}, ${rec.type}, ${rec.filename}, ${rec.fileHash}, ${rec.rowCount},
         ${rec.sessionsAdded}, ${rec.studentsAdded}, ${rec.studentsUpdated},
         ${rec.status}, ${rec.errorMessage ?? null}, ${rec.importedAt}, ${rec.importedBy})
      on conflict (id) do update set
        status = excluded.status, error_message = excluded.error_message
      returning *
    `;
    return toImport(rows[0]);
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.sql`delete from import_records where id = ${id} returning id`;
    return rows.length > 0;
  }

  async findByType(type: 'service' | 'lifegroup'): Promise<ImportRecord[]> {
    const rows = await this.sql`
      select * from import_records where type = ${type} order by imported_at desc
    `;
    return rows.map(toImport);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/repositories/supabase/supabase.attendance.ts
git commit -m "feat: supabase attendance repositories (sessions, attendance, lifegroups, imports)"
```

---

## Task 14: Supabase settings repos + index + wire container

**Files:**
- Create: `src/repositories/supabase/supabase.settings.ts`
- Create: `src/repositories/supabase/index.ts`
- Modify: `src/container.ts`

- [ ] **Step 1: Create supabase.settings.ts**

```ts
import type {
  ISettingsRepository,
  ISnapshotRepository,
  IAuditRepository,
} from '../interfaces/entity-repositories';
import type { AppSettings, AppDefaults, AdminAuditEntry } from '../../core/entities/settings';

import type { SqlClient } from './client';

const SETTINGS_ID = 'global';

function toSettings(r: Record<string, unknown>): AppSettings {
  return {
    id: r['id'] as string,
    ministryName: r['ministry_name'] as string,
    termGapDays: r['term_gap_days'] as number,
    regRateNumerator: r['reg_rate_numerator'] as number,
    regRateDenominator: r['reg_rate_denominator'] as number,
    riskRateNumerator: r['risk_rate_numerator'] as number,
    riskRateDenominator: r['risk_rate_denominator'] as number,
    validThresholdPct: r['valid_threshold_pct'] as number,
    serviceName: r['service_name'] as string,
    lifegroupName: r['lifegroup_name'] as string,
    connectionLockDate: r['connection_lock_date'] ? String(r['connection_lock_date']) : null,
    updatedAt: (r['updated_at'] as Date).toISOString(),
  };
}

export class SupabaseSettingsRepository implements ISettingsRepository {
  constructor(private sql: SqlClient) {}
  async init(): Promise<void> {}

  async findById(id: string): Promise<AppSettings | null> {
    const rows = await this.sql`select * from app_settings where id = ${id}`;
    return rows[0] ? toSettings(rows[0]) : null;
  }

  async findAll(): Promise<AppSettings[]> {
    const rows = await this.sql`select * from app_settings`;
    return rows.map(toSettings);
  }

  async save(s: AppSettings): Promise<AppSettings> {
    const rows = await this.sql`
      insert into app_settings (
        id, ministry_name, term_gap_days, reg_rate_numerator, reg_rate_denominator,
        risk_rate_numerator, risk_rate_denominator, valid_threshold_pct,
        service_name, lifegroup_name, connection_lock_date, updated_at
      ) values (
        ${s.id}, ${s.ministryName}, ${s.termGapDays}, ${s.regRateNumerator}, ${s.regRateDenominator},
        ${s.riskRateNumerator}, ${s.riskRateDenominator}, ${s.validThresholdPct},
        ${s.serviceName}, ${s.lifegroupName}, ${s.connectionLockDate ?? null}, ${s.updatedAt}
      )
      on conflict (id) do update set
        ministry_name = excluded.ministry_name, term_gap_days = excluded.term_gap_days,
        reg_rate_numerator = excluded.reg_rate_numerator, reg_rate_denominator = excluded.reg_rate_denominator,
        risk_rate_numerator = excluded.risk_rate_numerator, risk_rate_denominator = excluded.risk_rate_denominator,
        valid_threshold_pct = excluded.valid_threshold_pct, service_name = excluded.service_name,
        lifegroup_name = excluded.lifegroup_name, connection_lock_date = excluded.connection_lock_date,
        updated_at = excluded.updated_at
      returning *
    `;
    return toSettings(rows[0]);
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.sql`delete from app_settings where id = ${id} returning id`;
    return rows.length > 0;
  }

  async getSettings(): Promise<AppSettings> {
    let s = await this.findById(SETTINGS_ID);
    if (!s) {
      s = await this.save({
        id: SETTINGS_ID,
        ministryName: 'Youth Ministry',
        termGapDays: 14,
        regRateNumerator: 3,
        regRateDenominator: 4,
        riskRateNumerator: 1,
        riskRateDenominator: 2,
        validThresholdPct: 50,
        serviceName: 'Sunday Service',
        lifegroupName: 'Lifegroup',
        connectionLockDate: null,
        updatedAt: new Date().toISOString(),
      });
    }
    return s;
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.getSettings();
    return this.save({ ...current, ...patch, id: SETTINGS_ID, updatedAt: new Date().toISOString() });
  }
}

// ── Snapshots ─────────────────────────────────────────────────────────────────

function toSnapshot(r: Record<string, unknown>): AppDefaults {
  return {
    id: r['id'] as string,
    snapshot: r['snapshot'] as { users: unknown[]; leaders: unknown[] },
    createdAt: (r['created_at'] as Date).toISOString(),
  };
}

export class SupabaseSnapshotRepository implements ISnapshotRepository {
  constructor(private sql: SqlClient) {}
  async init(): Promise<void> {}

  async findById(id: string): Promise<AppDefaults | null> {
    const rows = await this.sql`select * from app_defaults where id = ${id}`;
    return rows[0] ? toSnapshot(rows[0]) : null;
  }

  async findAll(): Promise<AppDefaults[]> {
    const rows = await this.sql`select * from app_defaults order by created_at desc`;
    return rows.map(toSnapshot);
  }

  async save(d: AppDefaults): Promise<AppDefaults> {
    const rows = await this.sql`
      insert into app_defaults (id, snapshot, created_at)
      values (${d.id}, ${this.sql.json(d.snapshot)}, ${d.createdAt})
      on conflict (id) do update set snapshot = excluded.snapshot
      returning *
    `;
    return toSnapshot(rows[0]);
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.sql`delete from app_defaults where id = ${id} returning id`;
    return rows.length > 0;
  }
}

// ── Audit Log ─────────────────────────────────────────────────────────────────

function toAudit(r: Record<string, unknown>): AdminAuditEntry {
  return {
    id: r['id'] as string,
    action: r['action'] as AdminAuditEntry['action'],
    performedBy: r['performed_by'] as string,
    performedAt: (r['performed_at'] as Date).toISOString(),
    detail: r['detail'] as string,
  };
}

export class SupabaseAuditRepository implements IAuditRepository {
  constructor(private sql: SqlClient) {}
  async init(): Promise<void> {}

  async findById(id: string): Promise<AdminAuditEntry | null> {
    const rows = await this.sql`select * from admin_audit where id = ${id}`;
    return rows[0] ? toAudit(rows[0]) : null;
  }

  async findAll(): Promise<AdminAuditEntry[]> {
    const rows = await this.sql`select * from admin_audit order by performed_at desc`;
    return rows.map(toAudit);
  }

  async save(e: AdminAuditEntry): Promise<AdminAuditEntry> {
    const rows = await this.sql`
      insert into admin_audit (id, action, performed_by, performed_at, detail)
      values (${e.id}, ${e.action}, ${e.performedBy}, ${e.performedAt}, ${e.detail})
      on conflict (id) do update set detail = excluded.detail
      returning *
    `;
    return toAudit(rows[0]);
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.sql`delete from admin_audit where id = ${id} returning id`;
    return rows.length > 0;
  }

  async findRecent(limit: number): Promise<AdminAuditEntry[]> {
    const rows = await this.sql`
      select * from admin_audit order by performed_at desc limit ${limit}
    `;
    return rows.map(toAudit);
  }
}
```

- [ ] **Step 2: Create supabase/index.ts**

```ts
export { SupabaseUserRepository } from './supabase.users';
export { SupabaseStudentRepository } from './supabase.students';
export { SupabaseLeaderRepository } from './supabase.leaders';
export { SupabaseConnectionRepository } from './supabase.connections';
export {
  SupabaseServiceSessionRepository,
  SupabaseServiceAttendanceRepository,
  SupabaseLifegroupRepository,
  SupabaseLifegroupWeekRepository,
  SupabaseLifegroupAttendanceRepository,
  SupabaseImportRepository,
} from './supabase.attendance';
export {
  SupabaseSettingsRepository,
  SupabaseSnapshotRepository,
  SupabaseAuditRepository,
} from './supabase.settings';
export { getSqlClient, type SqlClient } from './client';
```

- [ ] **Step 3: Wire Supabase into container.ts**

At the top of `src/container.ts`, add after the existing in-memory imports:

```ts
import {
  SupabaseUserRepository,
  SupabaseStudentRepository,
  SupabaseLeaderRepository,
  SupabaseConnectionRepository,
  SupabaseServiceSessionRepository,
  SupabaseServiceAttendanceRepository,
  SupabaseLifegroupRepository,
  SupabaseLifegroupWeekRepository,
  SupabaseLifegroupAttendanceRepository,
  SupabaseImportRepository,
  SupabaseSettingsRepository,
  SupabaseSnapshotRepository,
  SupabaseAuditRepository,
  getSqlClient,
} from './repositories/supabase';
```

In `buildContainer()`, replace the repo construction block:

```ts
  const useSupabase = env.PERSISTENCE === 'supabase';
  const useJson     = env.PERSISTENCE === 'json';
  const supabaseSql = useSupabase ? getSqlClient() : null!;

  const users: IUserRepository = useSupabase
    ? new SupabaseUserRepository(supabaseSql)
    : new InMemoryUserRepository(useJson ? makeJson('users.json') : undefined);

  const students: IStudentRepository = useSupabase
    ? new SupabaseStudentRepository(supabaseSql)
    : new InMemoryStudentRepository(useJson ? makeJson('students.json') : undefined);

  const leaders: ILeaderRepository = useSupabase
    ? new SupabaseLeaderRepository(supabaseSql)
    : new InMemoryLeaderRepository(useJson ? makeJson('leaders.json') : undefined);

  const connections: IConnectionRepository = useSupabase
    ? new SupabaseConnectionRepository(supabaseSql)
    : new InMemoryConnectionRepository(useJson ? makeJson('connections.json') : undefined);

  const serviceSessions: IServiceSessionRepository = useSupabase
    ? new SupabaseServiceSessionRepository(supabaseSql)
    : new InMemoryServiceSessionRepository(useJson ? makeJson('service-sessions.json') : undefined);

  const serviceAttendance: IServiceAttendanceRepository = useSupabase
    ? new SupabaseServiceAttendanceRepository(supabaseSql)
    : new InMemoryServiceAttendanceRepository(useJson ? makeJson('service-attendance.json') : undefined);

  const lifegroups: ILifegroupRepository = useSupabase
    ? new SupabaseLifegroupRepository(supabaseSql)
    : new InMemoryLifegroupRepository(useJson ? makeJson('lifegroups.json') : undefined);

  const lifegroupWeeks: ILifegroupWeekRepository = useSupabase
    ? new SupabaseLifegroupWeekRepository(supabaseSql)
    : new InMemoryLifegroupWeekRepository(useJson ? makeJson('lifegroup-weeks.json') : undefined);

  const lifegroupAttendance: ILifegroupAttendanceRepository = useSupabase
    ? new SupabaseLifegroupAttendanceRepository(supabaseSql)
    : new InMemoryLifegroupAttendanceRepository(useJson ? makeJson('lifegroup-attendance.json') : undefined);

  const imports: IImportRepository = useSupabase
    ? new SupabaseImportRepository(supabaseSql)
    : new InMemoryImportRepository(useJson ? makeJson('imports.json') : undefined);

  const settings: ISettingsRepository = useSupabase
    ? new SupabaseSettingsRepository(supabaseSql)
    : new InMemorySettingsRepository(useJson ? makeJson('settings.json') : undefined);

  const snapshots: ISnapshotRepository = useSupabase
    ? new SupabaseSnapshotRepository(supabaseSql)
    : new InMemorySnapshotRepository(useJson ? makeJson('snapshots.json') : undefined);

  const audit: IAuditRepository = useSupabase
    ? new SupabaseAuditRepository(supabaseSql)
    : new InMemoryAuditRepository(useJson ? makeJson('audit.json') : undefined);
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/repositories/supabase/ src/container.ts
git commit -m "feat: supabase settings/audit repos + wire all repos into container"
```

---

## Task 15: App factory split + Vercel files

**Files:**
- Create: `src/app.ts`
- Modify: `src/index.ts`
- Create: `api/index.ts`
- Create: `vercel.json`
- Create: `.vercelignore`
- Create: `.env.example`

- [ ] **Step 1: Create src/app.ts**

```ts
import { buildContainer } from './container';
import { buildRoutes } from './api/http/router';
import { createApp } from './api/http/express-adapter';
import { seedDemoData } from './seed';
import { env } from './config/env';
import { createLogger } from './utils/logger';

const logger = createLogger('app');

export async function createAppInstance() {
  const container = await buildContainer();

  if (env.PERSISTENCE === 'memory') {
    await seedDemoData(container.repos);
  }

  const routes = buildRoutes(container.services);
  const app = createApp(routes, container.services.auth);
  logger.info(`App ready (persistence: ${env.PERSISTENCE})`);
  return app;
}
```

- [ ] **Step 2: Replace src/index.ts**

```ts
import { createAppInstance } from './app';
import { env } from './config/env';
import { createLogger } from './utils/logger';

const logger = createLogger('server');

const app = await createAppInstance();
app.listen(env.PORT, () => {
  logger.info(`Connection Made Simple running on http://localhost:${env.PORT}`);
});
```

- [ ] **Step 3: Create api/index.ts**

```ts
import { createAppInstance } from '../src/app';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const appPromise = createAppInstance();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const app = await appPromise;
  app(req as any, res as any);
}
```

- [ ] **Step 4: Create vercel.json**

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/api/index" }]
}
```

- [ ] **Step 5: Create .vercelignore**

```
data/
src/tests/
*.test.ts
```

- [ ] **Step 6: Create .env.example**

```
# Local dev — in-memory (no DB needed)
PORT=4300
PERSISTENCE=memory
NODE_ENV=development

# Local dev with Supabase (direct connection, port 5432)
# PERSISTENCE=supabase
# DATABASE_URL=postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres

# Vercel production (transaction pooler, port 6543)
# PERSISTENCE=supabase
# DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres
```

- [ ] **Step 7: Run typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add src/app.ts src/index.ts api/ vercel.json .vercelignore .env.example
git commit -m "feat: app factory split + Vercel serverless entry point"
```

---

## Task 16: CLAUDE.md + final verification

**Files:**
- Create: `CLAUDE.md`

- [ ] **Step 1: Create CLAUDE.md**

```markdown
# CLAUDE.md — Connection Made Simple

> **Scope:** the live **Connection Made Simple** app — TS/Express backend (`src/`) + `public/index.html` SPA. Deployed to Vercel at https://connection-made-simple.vercel.app with Supabase Postgres (Sydney, ap-southeast-2) as the database.

## What this is

A youth ministry platform for YS Brisbane — phone-first SPA backed by a TypeScript/Express API. Leaders are connected to students; the platform tracks attendance, at-risk status, and ministry trends.

## Commands

```bash
npm install
npm run dev          # in-memory local server on http://localhost:4300
npm run typecheck    # tsc --noEmit (strict)
npm run test         # vitest
```

For local dev against Supabase, copy `.env.example` to `.env` and set `PERSISTENCE=supabase` + `DATABASE_URL`.

## Architecture

```
api (Express) → controllers → services → repositories (interfaces) → core
```

- **`src/core/`** — pure types, entities, enums, Zod schemas, errors.
- **`src/repositories/`** — interfaces + in-memory impls + Supabase impls. Switch via `PERSISTENCE` env var.
- **`src/services/`** — all business logic + RBAC (`access-control.ts`).
- **`src/api/`** — thin controllers → router → Express adapter.
- **`src/container.ts`** — composition root. The ONLY file that names concrete repositories.
- **`src/app.ts`** — async app factory (used by both local dev and Vercel).
- **`api/index.ts`** — Vercel serverless entry point.

## Persistence

| `PERSISTENCE` | Where | Use case |
|---|---|---|
| `memory` (default) | In-process, seeded with demo data | Local dev |
| `json` | `DATA_DIR/*.json` files | Optional file persistence |
| `supabase` | Supabase Postgres (Sydney) | Production on Vercel |

## Deployment

Deploy via Vercel CLI from this folder:
```bash
vercel deploy --prod --yes
```
Set env vars in Vercel: `PERSISTENCE=supabase`, `DATABASE_URL` (transaction pooler URL, port 6543).

## Seed accounts (memory mode, password: `demo1234`)

| Email | Role |
|-------|------|
| `admin@youth.ministry` | admin |
| `director@youth.ministry` | director |
| `g79@youth.ministry` | quad (Girls Yr 7–9) |
| `b79@youth.ministry` | quad (Boys Yr 7–9) |
| `grade7f@youth.ministry` | grade (Grade 7 Girls) |

## Role hierarchy

`grade` → `quad` → `director` → `admin`

See `src/services/access-control.ts` for the full permission map.
```

- [ ] **Step 2: Run full test suite**

```bash
npm run test
```

Expected: all tests pass with 0 failures.

- [ ] **Step 3: Run typecheck one final time**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md for Connection Made Simple"
```

---

## Task 17: [Manual] Create GitHub repo and push

These steps are performed manually in a terminal.

- [ ] **Step 1: Create the GitHub repo**

Go to https://github.com/new and create a public repo named `connection-made-simple` under `987tom1`. Do NOT initialise with a README (the repo should be empty).

- [ ] **Step 2: Push the local repo**

```bash
git push -u origin master
```

Expected: all commits pushed, branch `master` tracked.

---

## Task 18: [Manual] Create Supabase project and run migrations

- [ ] **Step 1: Create Supabase project**

Go to https://supabase.com/dashboard → New project:
- Name: `connection-made-simple`
- Region: **Southeast Asia (Singapore)** — Supabase's closest region to Sydney; or select the AWS ap-southeast-2 option if available
- Set a strong database password (save it securely)

- [ ] **Step 2: Generate the admin password hash**

In the project root, create a temporary file `temp-hash.ts`:

```ts
import { hashPassword } from './src/utils/crypto';
console.log(await hashPassword('your-admin-password-here'));
```

Run it:
```bash
npx tsx temp-hash.ts
```

Copy the output (format: `<32hexchars>:<64hexchars>`). Delete `temp-hash.ts`.

- [ ] **Step 3: Edit 002_seed_admin.sql**

In `supabase/migrations/002_seed_admin.sql`, replace `PLACEHOLDER_HASH` with the hash from Step 2.

- [ ] **Step 4: Run migrations**

In the Supabase dashboard, open **SQL Editor** and run each migration file in order:
1. Paste contents of `supabase/migrations/001_initial_schema.sql` → Run
2. Paste contents of `supabase/migrations/002_seed_admin.sql` → Run

Verify: the Tables section shows all 13 tables, and the `users` table has one row.

- [ ] **Step 5: Get the connection strings**

In the Supabase dashboard → Project Settings → Database:
- **Transaction pooler** URL (port 6543) — for Vercel
- **Direct** URL (port 5432) — for local testing if needed

- [ ] **Step 6: Commit the filled seed file**

```bash
git add supabase/migrations/002_seed_admin.sql
git commit -m "chore: fill admin seed hash (redacted — see Supabase dashboard)"
git push
```

---

## Task 19: [Manual] Create Vercel project, set env vars, deploy

- [ ] **Step 1: Link project to Vercel**

```bash
vercel link
```

When prompted: create a new project → name it `connection-made-simple` → scope `thomas-l-s-projects`.

- [ ] **Step 2: Set environment variables**

```bash
vercel env add PERSISTENCE production
# Enter value: supabase

vercel env add DATABASE_URL production
# Enter value: <transaction pooler URL from Task 18 Step 5>

vercel env add NODE_ENV production
# Enter value: production
```

- [ ] **Step 3: Deploy to production**

```bash
vercel deploy --prod --yes
```

Expected: build succeeds, deploy URL printed (e.g. `https://connection-made-simple.vercel.app`).

---

## Task 20: Verify live deployment

- [ ] **Step 1: Check the SPA loads**

Open `https://connection-made-simple.vercel.app` in a browser. The login screen should appear.

- [ ] **Step 2: Log in as admin**

Email: `admin@youth.ministry`  
Password: the password you used in Task 18 Step 2.

Expected: login succeeds, home screen loads.

- [ ] **Step 3: Create a test leader and student, then connect them**

1. Navigate to Leaders → Add a leader (e.g. "Test Leader", Female, Grade 9)
2. Navigate to Students → Add a student (e.g. "Test Student", Female, Grade 9)
3. Navigate to the student detail → Connect to the test leader
4. Navigate to Leaders → select the test leader → verify the student appears in their list

- [ ] **Step 4: Verify persistence across page reloads**

Reload the page and log back in. The test leader and student should still exist (data is in Supabase, not in-memory).

- [ ] **Step 5: Delete the test data**

Remove the test leader and student via the admin UI to leave the database clean for real use.

---

## Task 21: Archive original and update CLAUDE.md files

- [ ] **Step 1: Archive youth-allocation-platform in Project 4**

```powershell
$src = "C:\Users\thoma\Claude Programs\Project 4 - Youth Apps\youth-allocation-platform"
$dst = "C:\Users\thoma\Claude Programs\Project 4 - Youth Apps\~archive\youth-allocation-platform"
Move-Item $src $dst
```

- [ ] **Step 2: Update Project 4 CLAUDE.md**

In `C:\Users\thoma\Claude Programs\Project 4 - Youth Apps\CLAUDE.md`, update the `youth-allocation-platform/` row in the item table:

```markdown
| `~archive/youth-allocation-platform/` | **Archived 2026-06-12.** The live app is now **Project 7 — Connection Made Simple** (`C:\Users\thoma\Claude Programs\Project 7 - Connection Made Simple\`). |
```

- [ ] **Step 3: Update top-level CLAUDE.md**

In `C:\Users\thoma\Claude Programs\CLAUDE.md`, add a new row to the project table:

```markdown
| `Project 7 - Connection Made Simple` | **Live deployed app**: Connection Made Simple — TS/Express + Supabase (Sydney) + Vercel. Renamed and deployed version of the youth allocation platform. See `Project 7 - Connection Made Simple/connection-made-simple/CLAUDE.md`. |
```

Update the Project 4 row to note the youth-allocation-platform is archived.
