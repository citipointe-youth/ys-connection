# Camp-parity port (fmtPhone, wipe guard, loading bar, generalized SWR) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port four already-shipped camp-app (`Project 9 - Camp Platform\youth-camp-platform-masterv2`) improvements into Connection Made Simple (CMS, `Project 7`) without changing camp's repo: AU-mobile phone-number normalization, a server-side wipe guard on the two destructive admin routes, a global top loading bar, and generalized stale-while-revalidate (SWR) page navigation.

**Architecture:** CMS is a TS/Express backend (`src/`) + a single-file SPA (`public/index.html`). Items 1/3/4 are SPA-only edits inside the one `<script>` block; item 2 touches `src/services/admin.service.ts`, `src/api/controllers/admin.controller.ts`, and SPA call sites. No schema/migration changes anywhere. `public/sw.js` cache name bumps once at the end since `index.html` changes ship.

**Tech Stack:** TypeScript/Express/vitest (backend), vanilla JS SPA (no build step, no bundler — verify with `node --check` on the extracted `<script>` body).

## Global Constraints

- No new API routes — do not touch `sw.js`'s `API_RE`.
- Bump `public/sw.js` `CACHE` from `cms-v8` to `cms-v9` (current baseline is `cms-v8`, not the `cms-v6` the requester assumed — bump by one from whatever is actually in the file).
- Do not start a dev server or drive a browser. Verify with `node --check` (on the extracted script), `npm run typecheck`, `npm run test`. Flag the loading-bar visual for the user to eyeball on-device.
- CMS's own accent tokens only for new CSS (`--accent:#1a1af2`, `--accent-dark:#1111c9`) — never camp's violet/navy palette.
- `reset` keeps accounts (differs from camp deliberately) — do not change what CMS's admin routes delete, only add the confirmation gate.
- Update `CHANGELOG.txt` and the relevant `CLAUDE.md` sections as part of the change (both project CLAUDE.md files stay put; only CMS's needs edits).
- Deploy = `git push` to `master` (auto-deploys). Do not push unless the user asks; this plan only covers local commit.

---

### Task 1: fmtPhone AU-mobile normalization

**Files:**
- Modify: `public/index.html:670-676` (`fmtPhone`)

**Interfaces:**
- `fmtPhone(p)` signature and callers (`callPhone`, `phoneLink`) are unchanged — this task only changes `fmtPhone`'s internal digit-normalization, not its call sites or return shape (always a display string).

- [ ] **Step 1: Port the normalization into `fmtPhone`**

Current code (`public/index.html:669-676`):
```js
// Format a phone number with a space after the 4th and 7th digit (e.g. 0412 345 678).
function fmtPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length <= 4) return d;
  if (d.length <= 7) return d.slice(0, 4) + ' ' + d.slice(4);
  return d.slice(0, 4) + ' ' + d.slice(4, 7) + ' ' + d.slice(7);
}
```

Replace with:
```js
// Format a phone number with a space after the 4th and 7th digit (e.g. 0412 345 678).
// Normalizes AU mobiles that lost their leading 0 to spreadsheet numeric coercion in
// Elvanto/UCare CSV imports: an 11-digit "61…" becomes "0"+rest, a bare 9-digit "4…"
// gets "0" prefixed. Ported from the camp app's fmtPhone (public/index.html ~1275).
function fmtPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 11 && d.startsWith('61')) d = '0' + d.slice(2);
  else if (d.length === 9 && d.startsWith('4')) d = '0' + d;
  if (d.length <= 4) return d;
  if (d.length <= 7) return d.slice(0, 4) + ' ' + d.slice(4);
  return d.slice(0, 4) + ' ' + d.slice(4, 7) + ' ' + d.slice(7);
}
```

This only inserts the two normalization branches before CMS's existing length-based grouping — short numbers, landlines, and CMS's own 4/7-split grouping are all untouched. `callPhone`/`phoneLink` both call `fmtPhone` internally (confirmed only call sites in the file), so every display path (Data tab rows, student/leader detail, birthdays list, My Students) is covered automatically. No editable `<input>` phone fields exist in this file that call `fmtPhone` — verified via grep, the only three `fmtPhone(`-adjacent usages are the function itself, `callPhone`, and `phoneLink`.

- [ ] **Step 2: Verify with `node --check`**

Extract the script and check syntax (adjust line range if earlier edits shifted it — reconfirm the `<script>`/`</script>` bounds with `grep -n "<script>\|</script>" public/index.html` first; as of this plan they are line 444 and 5240):

```bash
sed -n '445,5239p' public/index.html > /tmp/cms-spa-check.js
node --check /tmp/cms-spa-check.js
```
Expected: no output (syntax OK).

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "fix: normalize AU mobile numbers that lost their leading 0 in CSV import"
```

---

### Task 2: Server-side wipe guard on `/admin/reset` and `/admin/clear-service-group`

**Files:**
- Modify: `src/services/admin.service.ts`
- Modify: `src/api/controllers/admin.controller.ts`

**Interfaces:**
- Produces: `WipeOpts { force?: boolean; confirmWipe?: string }`, `AdminService.reset(actor: Actor, opts?: WipeOpts): Promise<void>`, `AdminService.clearServiceGroupData(actor: Actor, opts?: WipeOpts): Promise<void>` — Task 3 (tests) and Task 4 (SPA) both depend on these exact signatures and on the literal string `'I understand this cannot be undone'`.
- Consumes: `BadRequestError` from `../core/errors/app-error` (already exists, `src/core/errors/app-error.ts:30-34`), `assertCan` from `./access-control` (already imported).

- [ ] **Step 1: Add `WipeOpts` + the guard to `admin.service.ts`**

Current imports/interface (`src/services/admin.service.ts:1-33`):
```ts
import { assertCan } from './access-control';
import type {
  IUserRepository,
  IStudentRepository,
  ILeaderRepository,
  IConnectionRepository,
  IServiceSessionRepository,
  IServiceAttendanceRepository,
  ILifegroupRepository,
  ILifegroupWeekRepository,
  ILifegroupAttendanceRepository,
  IImportRepository,
  ISnapshotRepository,
  IAuditRepository,
} from '../repositories/interfaces/entity-repositories';
import type { Actor } from '../core/entities/user';
import type { AdminAuditEntry } from '../core/entities/settings';
import { generateId } from '../utils/id';

export interface AdminAuditRow {
  id: string;
  action: string;
  performedBy: string;
  performedAt: string;
  detail: string;
}

export interface AdminService {
  reset(actor: Actor): Promise<void>;
  saveDefaults(actor: Actor): Promise<void>;
  clearServiceGroupData(actor: Actor): Promise<void>;
  getAuditLog(actor: Actor, limit?: number): Promise<AdminAuditRow[]>;
}
```

Replace with:
```ts
import { assertCan } from './access-control';
import { BadRequestError } from '../core/errors/app-error';
import type {
  IUserRepository,
  IStudentRepository,
  ILeaderRepository,
  IConnectionRepository,
  IServiceSessionRepository,
  IServiceAttendanceRepository,
  ILifegroupRepository,
  ILifegroupWeekRepository,
  ILifegroupAttendanceRepository,
  IImportRepository,
  ISnapshotRepository,
  IAuditRepository,
} from '../repositories/interfaces/entity-repositories';
import type { Actor } from '../core/entities/user';
import type { AdminAuditEntry } from '../core/entities/settings';
import { generateId } from '../utils/id';

export interface AdminAuditRow {
  id: string;
  action: string;
  performedBy: string;
  performedAt: string;
  detail: string;
}

export interface WipeOpts {
  force?: boolean;
  confirmWipe?: string;
}

// Mirrors the camp app's admin.service.ts wipe guard (src/services/admin.service.ts,
// Project 9): a destructive route must be called with force:true AND this exact
// confirmation string, checked BEFORE any data is touched. Unlike the camp's guard,
// CMS has no lastExportedAt escape hatch — force+confirmWipe is always required.
const CONFIRM_WIPE_STRING = 'I understand this cannot be undone';

function assertForceConfirmed(opts?: WipeOpts): void {
  if (!opts?.force || opts.confirmWipe !== CONFIRM_WIPE_STRING) {
    throw new BadRequestError(`force requires confirmWipe: "${CONFIRM_WIPE_STRING}"`);
  }
}

export interface AdminService {
  reset(actor: Actor, opts?: WipeOpts): Promise<void>;
  saveDefaults(actor: Actor): Promise<void>;
  clearServiceGroupData(actor: Actor, opts?: WipeOpts): Promise<void>;
  getAuditLog(actor: Actor, limit?: number): Promise<AdminAuditRow[]>;
}
```

- [ ] **Step 2: Gate `reset` and `clearServiceGroupData` before they touch data**

Current (`src/services/admin.service.ts`, inside `makeAdminService`):
```ts
  return {
    async reset(actor) {
      assertCan(actor, 'admin:manage');
      await wipeData({ includeLeaders: true });
      await writeAudit(audit, actor, 'reset', 'Full data reset — students, leaders, connections, services and lifegroup data cleared');
    },
```
Replace with:
```ts
  return {
    async reset(actor, opts) {
      assertCan(actor, 'admin:manage');
      assertForceConfirmed(opts);
      await wipeData({ includeLeaders: true });
      await writeAudit(audit, actor, 'reset', 'Full data reset — students, leaders, connections, services and lifegroup data cleared');
    },
```

Current:
```ts
    async clearServiceGroupData(actor) {
      assertCan(actor, 'admin:manage');
      // Clear ALL service + lifegroup data but KEEP students (grade, age, phone),
```
Replace with:
```ts
    async clearServiceGroupData(actor, opts) {
      assertCan(actor, 'admin:manage');
      assertForceConfirmed(opts);
      // Clear ALL service + lifegroup data but KEEP students (grade, age, phone),
```

(Leave `wipeData`, `saveDefaults`, and `getAuditLog` untouched — the guard applies only to the two destructive routes named in the task.)

- [ ] **Step 3: Wire `force`/`confirmWipe` through the controller**

Current (`src/api/controllers/admin.controller.ts`):
```ts
export function makeAdminController(deps: { admin: AdminService }) {
  return {
    async reset(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      await deps.admin.reset(req.ctx);
      return { ok: true };
    },

    async saveDefaults(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      await deps.admin.saveDefaults(req.ctx);
      return { ok: true };
    },

    async clearServiceGroupData(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      await deps.admin.clearServiceGroupData(req.ctx);
      return { ok: true };
    },
```
Replace with:
```ts
export function makeAdminController(deps: { admin: AdminService }) {
  return {
    async reset(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const body = req.body as { force?: boolean; confirmWipe?: string } | undefined;
      await deps.admin.reset(req.ctx, { force: body?.force, confirmWipe: body?.confirmWipe });
      return { ok: true };
    },

    async saveDefaults(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      await deps.admin.saveDefaults(req.ctx);
      return { ok: true };
    },

    async clearServiceGroupData(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const body = req.body as { force?: boolean; confirmWipe?: string } | undefined;
      await deps.admin.clearServiceGroupData(req.ctx, { force: body?.force, confirmWipe: body?.confirmWipe });
      return { ok: true };
    },
```

No router changes needed — `POST /admin/reset` and `POST /admin/clear-service-group` (`src/api/http/router.ts:97,99`) already forward the full request.

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```
Expected: no errors. (This will fail until Task 4 below also compiles, since nothing else references the new signature yet — that's fine, `opts` is optional so existing callers without it still typecheck. Run this now to confirm `admin.service.ts`/`admin.controller.ts` compile in isolation.)

- [ ] **Step 5: Commit**

```bash
git add src/services/admin.service.ts src/api/controllers/admin.controller.ts
git commit -m "feat: require force+confirmWipe on destructive admin routes before touching data"
```

---

### Task 3: Service tests for the wipe guard

**Files:**
- Create: `src/tests/admin.service.test.ts`

**Interfaces:**
- Consumes: `makeAdminService` (`src/services/admin.service.ts`), `AdminService`, in-memory repos from `src/repositories/in-memory` (`InMemoryUserRepository`, `InMemoryStudentRepository`, `InMemoryLeaderRepository`, `InMemoryConnectionRepository`, `InMemoryServiceSessionRepository`, `InMemoryServiceAttendanceRepository`, `InMemoryLifegroupRepository`, `InMemoryLifegroupWeekRepository`, `InMemoryLifegroupAttendanceRepository`, `InMemoryImportRepository`, `InMemorySnapshotRepository`, `InMemoryAuditRepository`), `BadRequestError`/`ForbiddenError` from `../core/errors/app-error`, `Actor` from `../core/entities/user`.

- [ ] **Step 1: Write the test file**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { makeAdminService } from '../services/admin.service';
import {
  InMemoryUserRepository,
  InMemoryStudentRepository,
  InMemoryLeaderRepository,
  InMemoryConnectionRepository,
  InMemoryServiceSessionRepository,
  InMemoryServiceAttendanceRepository,
  InMemoryLifegroupRepository,
  InMemoryLifegroupWeekRepository,
  InMemoryLifegroupAttendanceRepository,
  InMemoryImportRepository,
  InMemorySnapshotRepository,
  InMemoryAuditRepository,
} from '../repositories/in-memory';
import type { Actor } from '../core/entities/user';
import { BadRequestError, ForbiddenError } from '../core/errors/app-error';

function actor(role: string): Actor {
  return { id: 'a-test', role: role as any, displayName: 'Test', grade: null as any, quad: null as any };
}

const ADMIN = actor('admin');
const DIRECTOR = actor('director');
const CONFIRM = 'I understand this cannot be undone';

async function buildService() {
  const users = new InMemoryUserRepository();
  const students = new InMemoryStudentRepository();
  const leaders = new InMemoryLeaderRepository();
  const connections = new InMemoryConnectionRepository();
  const serviceSessions = new InMemoryServiceSessionRepository();
  const serviceAttendance = new InMemoryServiceAttendanceRepository();
  const lifegroups = new InMemoryLifegroupRepository();
  const lifegroupWeeks = new InMemoryLifegroupWeekRepository();
  const lifegroupAttendance = new InMemoryLifegroupAttendanceRepository();
  const imports = new InMemoryImportRepository();
  const snapshots = new InMemorySnapshotRepository();
  const audit = new InMemoryAuditRepository();
  await Promise.all([
    users.init(), students.init(), leaders.init(), connections.init(),
    serviceSessions.init(), serviceAttendance.init(), lifegroups.init(),
    lifegroupWeeks.init(), lifegroupAttendance.init(), imports.init(),
    snapshots.init(), audit.init(),
  ]);

  await students.save({
    id: 's1', firstName: 'Alice', lastName: 'Smith', gender: 'female', grade: 9,
    quad: 'g79', mobile: null, parentPhone: null, dateOfBirth: null,
    svcAttended: 0, svcTotal: 0, grpAttended: 0, grpTotal: 0, grpMetWeeks: 0,
    prevSvcAttended: 0, prevSvcTotal: 0, prevGrpAttended: 0, prevGrpTotal: 0,
    atRiskStatus: 'new', dataSource: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });

  const svc = makeAdminService(
    users, students, leaders, connections, serviceSessions, serviceAttendance,
    lifegroups, lifegroupWeeks, lifegroupAttendance, imports, snapshots, audit,
  );
  return { svc, students };
}

describe('Admin Service — wipe guard', () => {
  it('reset without force/confirmWipe throws BadRequestError and touches no data', async () => {
    const { svc, students } = await buildService();
    await expect(svc.reset(ADMIN)).rejects.toBeInstanceOf(BadRequestError);
    expect((await students.findAll()).length).toBe(1);
  });

  it('reset with force:true but wrong confirmWipe throws BadRequestError', async () => {
    const { svc, students } = await buildService();
    await expect(svc.reset(ADMIN, { force: true, confirmWipe: 'nope' })).rejects.toBeInstanceOf(BadRequestError);
    expect((await students.findAll()).length).toBe(1);
  });

  it('reset with force:true + correct confirmWipe wipes data', async () => {
    const { svc, students } = await buildService();
    await svc.reset(ADMIN, { force: true, confirmWipe: CONFIRM });
    expect((await students.findAll()).length).toBe(0);
  });

  it('clearServiceGroupData without force/confirmWipe throws BadRequestError and touches no data', async () => {
    const { svc, students } = await buildService();
    await expect(svc.clearServiceGroupData(ADMIN)).rejects.toBeInstanceOf(BadRequestError);
    const [s] = await students.findAll();
    expect(s?.atRiskStatus).toBe('new');
  });

  it('clearServiceGroupData with force:true + correct confirmWipe resets student aggregates', async () => {
    const { svc, students } = await buildService();
    await svc.clearServiceGroupData(ADMIN, { force: true, confirmWipe: CONFIRM });
    const [s] = await students.findAll();
    expect(s).toBeTruthy();
    expect(s?.svcAttended).toBe(0);
  });

  it('non-admin actor is still rejected regardless of force/confirmWipe', async () => {
    const { svc } = await buildService();
    await expect(svc.reset(DIRECTOR, { force: true, confirmWipe: CONFIRM })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npm run test
```
Expected: all new tests pass; total count rises above the prior 130 (check the vitest summary line).

- [ ] **Step 3: Commit**

```bash
git add src/tests/admin.service.test.ts
git commit -m "test: cover the admin wipe guard rejected and accepted paths"
```

---

### Task 4: SPA — wire the wipe-guard body into confirmType/adminAction

**Files:**
- Modify: `public/index.html` (`adminAction`, two `confirmType(...)` call sites)

**Interfaces:**
- Consumes: `CONFIRM_WIPE_STRING` value from Task 2 — must be the exact literal `'I understand this cannot be undone'`.
- `adminAction(path, msg, body)` — `body` is a new optional third parameter, default `{}` (backward compatible with the existing `save-defaults` call site, which passes none).

- [ ] **Step 1: Add the client-side confirm-string constant and extend `adminAction`**

Current (`public/index.html:3927-3933`):
```js
async function adminAction(path, msg) {
  try {
    await API.post(path, {}); Cache.clear(); toast(msg);
    if ((path === '/admin/reset' || path === '/admin/clear-service-group') && window.CA) CA.reset(); /*CA-HOOK*/
    go('home');
  } catch (e) { toast(e.message); }
}
```
Replace with:
```js
// Mirrors the server's admin.service.ts CONFIRM_WIPE_STRING — required by the
// wipe guard on POST /admin/reset and /admin/clear-service-group.
const CONFIRM_WIPE_STRING = 'I understand this cannot be undone';

async function adminAction(path, msg, body) {
  try {
    await API.post(path, body || {}); Cache.clear(); toast(msg);
    if ((path === '/admin/reset' || path === '/admin/clear-service-group') && window.CA) CA.reset(); /*CA-HOOK*/
    go('home');
  } catch (e) { toast(e.message); }
}
```

- [ ] **Step 2: Pass the wipe-guard body from the two destructive buttons**

Current (`public/index.html:3842`):
```html
<button class="btn btn-secondary btn-full" onclick="confirmType({title:'Clear Service & Group Data?',word:'CLEAR',danger:false,body:'This deletes all service and lifegroup attendance. Students (grade, age, phone), their connections and leaders are kept.',onConfirm:()=>adminAction('/admin/clear-service-group','✓ Service/group data cleared')})">Clear Service/Group Data</button>
```
Replace with:
```html
<button class="btn btn-secondary btn-full" onclick="confirmType({title:'Clear Service & Group Data?',word:'CLEAR',danger:false,body:'This deletes all service and lifegroup attendance. Students (grade, age, phone), their connections and leaders are kept.',onConfirm:()=>adminAction('/admin/clear-service-group','✓ Service/group data cleared',{force:true,confirmWipe:CONFIRM_WIPE_STRING})})">Clear Service/Group Data</button>
```

Current (`public/index.html:3846`):
```html
<button class="btn btn-danger btn-full" onclick="confirmType({title:'Full Reset?',word:'RESET',danger:true,body:'This permanently deletes all students, leaders, connections and attendance. Accounts are kept. This cannot be undone.',onConfirm:()=>adminAction('/admin/reset','✓ Full reset complete')})">Full Reset</button>
```
Replace with:
```html
<button class="btn btn-danger btn-full" onclick="confirmType({title:'Full Reset?',word:'RESET',danger:true,body:'This permanently deletes all students, leaders, connections and attendance. Accounts are kept. This cannot be undone.',onConfirm:()=>adminAction('/admin/reset','✓ Full reset complete',{force:true,confirmWipe:CONFIRM_WIPE_STRING})})">Full Reset</button>
```

The `save-defaults` button (`public/index.html:3835`) is unaffected — it's not a wipe route and keeps calling `adminAction('/admin/save-defaults','✓ Defaults saved')` with no third argument, which now defaults to `{}` exactly as before.

CMS's typed-word `confirmType` modal (type CLEAR / RESET) stays as the on-screen UX; the server-side string is a separate, fixed constant sent automatically once the user passes that modal — this is an additional server-side backstop, not a UX change.

- [ ] **Step 3: Verify with `node --check`**

```bash
grep -n "<script>\|</script>" public/index.html   # reconfirm bounds
sed -n '<start+1>,<end-1>p' public/index.html > /tmp/cms-spa-check.js
node --check /tmp/cms-spa-check.js
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: send force+confirmWipe from the SPA's destructive admin actions"
```

---

### Task 5: Global top loading bar (`#nprog`)

**Files:**
- Modify: `public/index.html` (CSS, static HTML, `_npStart`/`_npDone`, the `API` IIFE's `r()`)

**Interfaces:**
- Produces: `_npStart()`, `_npDone()` — reference-counted, called only from `r()` inside the `API` IIFE.
- Consumes: nothing new — `API.get`'s existing `Cache.get(p)` short-circuit (line ~471) already means cached GETs never call `r()`, so they automatically never touch `_npStart`/`_npDone`.

- [ ] **Step 1: Add the `#nprog` CSS rule**

Current (`public/index.html:47-48`):
```css
  --safe-t:env(safe-area-inset-top,0px);
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
```
Replace with:
```css
  --safe-t:env(safe-area-inset-top,0px);
}
/* Top loading bar (#nprog): a thin accent bar that animates whenever a real network
   request is in flight (driven from API's r() via _npStart/_npDone, ported from the
   camp app's #nprog). Cached GETs never reach r(), so instant navigations don't flash
   the bar. Tune colour/height in this one rule. */
#nprog{position:fixed;top:0;left:0;height:3px;width:0;z-index:1000;background:linear-gradient(90deg,var(--accent),var(--accent-dark));border-radius:0 2px 2px 0;opacity:0;transition:width .18s ease,opacity .3s ease;pointer-events:none;box-shadow:0 0 8px rgba(26,26,242,.55)}
#nprog.on{opacity:1}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
```

- [ ] **Step 2: Add the static `#nprog` element outside `#app`**

Current (`public/index.html:440`):
```html
<div id="app"></div>
```
Replace with:
```html
<div id="nprog"></div>
<div id="app"></div>
```

`#nprog` must live OUTSIDE `#app` (not inside it) because `_initShell()` and `renderLogin()` both do `document.getElementById('app').innerHTML = ...`, which would wipe out any element placed inside `#app`. Placing it as a sibling, position-fixed, makes it survive login/logout/shell rebuilds — unlike the camp app, which can embed `#nprog` inside a header that's never regenerated by JS.

- [ ] **Step 3: Add the `_npStart`/`_npDone` driver functions**

Current (`public/index.html:444-448`):
```js
<script>
// ============================================================
// API ADAPTER
// ============================================================
const API = (() => {
```
Replace with:
```js
<script>
// Top loading bar (#nprog) driver — reference-counted so overlapping fetches (e.g. a
// parallel Promise.all) hold the bar until the LAST one finishes. Creeps toward 90%
// while in flight, then snaps to 100% and fades. Only real network requests call this
// (from API's r()); a Cache hit in API.get returns before ever calling r(), so cached
// navigations never flash the bar. Ported from the camp app's #nprog driver.
let _npCount = 0, _npTimer = null, _npVal = 0, _npFadeTimer = null, _npResetTimer = null;
function _npStart() {
  _npCount++;
  if (_npCount > 1) return;
  const el = document.getElementById('nprog'); if (!el) return;
  clearTimeout(_npFadeTimer); clearTimeout(_npResetTimer);
  _npVal = 8; el.classList.add('on'); el.style.width = _npVal + '%';
  clearInterval(_npTimer);
  _npTimer = setInterval(() => { _npVal += Math.max(0.4, (90 - _npVal) * 0.09); if (_npVal >= 90) _npVal = 90; el.style.width = _npVal + '%'; }, 170);
}
function _npDone() {
  if (_npCount > 0) _npCount--;
  if (_npCount > 0) return;
  const el = document.getElementById('nprog'); if (!el) return;
  clearInterval(_npTimer); _npTimer = null;
  el.style.width = '100%';
  _npFadeTimer = setTimeout(() => {
    if (_npCount === 0) el.classList.remove('on');
    _npResetTimer = setTimeout(() => { if (_npCount === 0) el.style.width = '0'; }, 320);
  }, 180);
}

// ============================================================
// API ADAPTER
// ============================================================
const API = (() => {
```

- [ ] **Step 4: Wire `_npStart`/`_npDone` into the fetch layer**

Current (`public/index.html`, inside the `API` IIFE):
```js
  async function r(method, path, body, timeoutMs) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error('Request timed out')), timeoutMs || 25000);
    try {
      const res = await fetch(path, { method, headers: hdr(), signal: ac.signal, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || e.error || res.statusText || 'Request failed'); }
      return res.json();
    } finally {
      clearTimeout(timer);
    }
  }
```
Replace with:
```js
  async function r(method, path, body, timeoutMs) {
    _npStart();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error('Request timed out')), timeoutMs || 25000);
    try {
      const res = await fetch(path, { method, headers: hdr(), signal: ac.signal, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || e.error || res.statusText || 'Request failed'); }
      return res.json();
    } finally {
      clearTimeout(timer);
      _npDone();
    }
  }
```

This single choke point covers every write (`API.post`/`.patch`/`.del` always call `r()` directly) and every cache-missed read (`API.get` only calls `r()` — via its internal promise — when `Cache.get(p)` is `null`; a cache hit returns immediately without calling `r()` at all, so it never starts the bar).

- [ ] **Step 5: Verify with `node --check`**

```bash
grep -n "<script>\|</script>" public/index.html
sed -n '<start+1>,<end-1>p' public/index.html > /tmp/cms-spa-check.js
node --check /tmp/cms-spa-check.js
```
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "feat: add a global top loading bar driven from real network requests"
```

Flag for the user: this is a visual change (thin bar under the top edge, CMS accent colour) — eyeball it on-device after deploy; not verifiable headlessly.

---

### Task 6: Generalize stale-while-revalidate to the remaining page navigations

**Files:**
- Modify: `public/index.html` — `renderConnect`/`loadConnectData` (leaders page), `renderUpcomingBirthdays`, `renderMyStudents`, `renderStudents`, `renderAtRisk`, `renderImport`, `renderAdmin`.

**Interfaces:**
- Consumes: `Cache.get`/`Cache.getStale` (existing, `public/index.html:491-497`), the established `renderTrends` template (`public/index.html:3036-3074`) — same `<PAGE>_PATHS` array + `allFresh`/`haveStale` branching + `_revalidate<Page>()` background-refresh helper + `S.page`-capture bail, reused verbatim per page.
- Produces: `CONNECT_PATHS`, `BIRTHDAYS_PATHS`, `MYSTUDENTS_PATHS`, `STUDENTS_PATHS`, `ATRISK_PATHS`, `IMPORT_PATHS`, `ADMIN_PATHS` constants and matching `_revalidateConnect`/`_revalidateBirthdays`/`_revalidateMyStudents`/`_revalidateStudents`/`_revalidateAtRisk`/`_revalidateImport`/`_revalidateAdmin` functions.

**Scope note (do not touch):** `renderLeaders`, `renderQuadView`, and `renderMyQuad` are dead/unreachable — `render()`'s dispatcher (`public/index.html:946-966`) never calls them (the `'leaders'`/`'quad-view'`/`'my-quad'` pages all route to `renderConnect()` or `go('leaders')`). `renderNotifications` is also unreachable while push is hidden and already has its own stale-render guard. Converting unreachable code would be pure churn — leave all four untouched. `renderHome` and `renderTrends` already have SWR — leave them as the reference template. `renderAdminView`'s separate `/admin/audit` tab fetch (inside `renderAdmin`'s callee) is a distinct nested in-page load with its own inline spinner-in-place pattern — leave it untouched, out of scope.

- [ ] **Step 1: `renderConnect` (page `'leaders'`)**

Current (`public/index.html:1846-1861`):
```js
async function renderConnect() {
  if (!_allCached('/students', '/leaders', '/connections')) setApp(shell('<div class="loading"><div class="spin"></div></div>'));
  await loadConnectData();
  renderConnectView();
}

async function loadConnectData() {
  const [students, leaders, connectsRaw] = await Promise.all([
    API.get('/students').catch(() => []),
    API.get('/leaders').catch(() => []),
    API.get('/connections').catch(() => []),
  ]);
  const allocs = {};
  for (const a of connectsRaw) { if (!allocs[a.studentId]) allocs[a.studentId]=[]; allocs[a.studentId].push(a.leaderId); }
  _aS.students = students; _aS.leaders = leaders; _aS.allocs = allocs;
}
```
Replace with:
```js
const CONNECT_PATHS = ['/students', '/leaders', '/connections'];
let _connectRevalidating = false;
function _revalidateConnect() {
  if (_connectRevalidating) return;
  _connectRevalidating = true;
  Promise.all(CONNECT_PATHS.map(p => API.get(p).catch(() => null)))
    .then(() => { if (S.page === 'leaders') return renderConnect(); })
    .catch(() => {})
    .finally(() => { _connectRevalidating = false; });
}
async function renderConnect() {
  const _pg = S.page;
  const allFresh = CONNECT_PATHS.every(p => Cache.get(p) !== null);
  const haveStale = CONNECT_PATHS.every(p => Cache.getStale(p) !== null);
  if (allFresh || haveStale) {
    await loadConnectData(p => Promise.resolve(Cache.getStale(p)));
    if (!allFresh) _revalidateConnect();
  } else {
    setApp(shell('<div class="loading"><div class="spin"></div></div>'));
    await loadConnectData(p => API.get(p));
    if (S.page !== _pg) return;
  }
  renderConnectView();
}

async function loadConnectData(G) {
  const [students, leaders, connectsRaw] = await Promise.all([
    G('/students').catch(() => []),
    G('/leaders').catch(() => []),
    G('/connections').catch(() => []),
  ]);
  const allocs = {};
  for (const a of connectsRaw) { if (!allocs[a.studentId]) allocs[a.studentId]=[]; allocs[a.studentId].push(a.leaderId); }
  _aS.students = students; _aS.leaders = leaders; _aS.allocs = allocs;
}
```
(`loadConnectData` has exactly one caller in the whole file — `renderConnect` — confirmed by grep, so adding the required `G` parameter is safe.)

- [ ] **Step 2: `renderUpcomingBirthdays` (page `'birthdays'`)**

Current (`public/index.html:2223-2230`):
```js
async function renderUpcomingBirthdays() {
  if (!_allCached('/students', '/leaders', '/connections')) setApp(shell('<div class="loading"><div class="spin"></div></div>'));
  let students = [], leaders = [], conns = [];
  try { [students, leaders, conns] = await Promise.all([
    API.get('/students').catch(() => []),
    API.get('/leaders').catch(() => []),
    API.get('/connections').catch(() => []),
  ]); } catch {}
```
Replace with:
```js
const BIRTHDAYS_PATHS = ['/students', '/leaders', '/connections'];
let _birthdaysRevalidating = false;
function _revalidateBirthdays() {
  if (_birthdaysRevalidating) return;
  _birthdaysRevalidating = true;
  Promise.all(BIRTHDAYS_PATHS.map(p => API.get(p).catch(() => null)))
    .then(() => { if (S.page === 'birthdays') return renderUpcomingBirthdays(); })
    .catch(() => {})
    .finally(() => { _birthdaysRevalidating = false; });
}
async function renderUpcomingBirthdays() {
  const _pg = S.page;
  const allFresh = BIRTHDAYS_PATHS.every(p => Cache.get(p) !== null);
  const haveStale = BIRTHDAYS_PATHS.every(p => Cache.getStale(p) !== null);
  let students = [], leaders = [], conns = [];
  if (allFresh || haveStale) {
    students = Cache.getStale('/students') || [];
    leaders = Cache.getStale('/leaders') || [];
    conns = Cache.getStale('/connections') || [];
    if (!allFresh) _revalidateBirthdays();
  } else {
    setApp(shell('<div class="loading"><div class="spin"></div></div>'));
    try { [students, leaders, conns] = await Promise.all([
      API.get('/students').catch(() => []),
      API.get('/leaders').catch(() => []),
      API.get('/connections').catch(() => []),
    ]); } catch {}
    if (S.page !== _pg) return;
  }
```
(The rest of the function — from `const leaderName = {};` onward, including its early `if (!upcoming.length) { setApp(...); return; }` branch — is unchanged; it already only reads the `students`/`leaders`/`conns` locals.)

- [ ] **Step 3: `renderMyStudents` (page `'my-students'`)**

Current (`public/index.html:2288-2293`):
```js
async function renderMyStudents() {
  if (!_allCached('/leaders', '/students')) setApp(shell('<div class="loading"><div class="spin"></div></div>'));
  const [leaders, allStudents] = await Promise.all([
    API.get('/leaders').catch(() => []),
    API.get('/students').catch(() => []),
  ]);
```
Replace with:
```js
const MYSTUDENTS_PATHS = ['/leaders', '/students'];
let _myStudentsRevalidating = false;
function _revalidateMyStudents() {
  if (_myStudentsRevalidating) return;
  _myStudentsRevalidating = true;
  Promise.all(MYSTUDENTS_PATHS.map(p => API.get(p).catch(() => null)))
    .then(() => { if (S.page === 'my-students') return renderMyStudents(); })
    .catch(() => {})
    .finally(() => { _myStudentsRevalidating = false; });
}
async function renderMyStudents() {
  const _pg = S.page;
  const allFresh = MYSTUDENTS_PATHS.every(p => Cache.get(p) !== null);
  const haveStale = MYSTUDENTS_PATHS.every(p => Cache.getStale(p) !== null);
  let leaders, allStudents;
  if (allFresh || haveStale) {
    leaders = Cache.getStale('/leaders') || [];
    allStudents = Cache.getStale('/students') || [];
    if (!allFresh) _revalidateMyStudents();
  } else {
    setApp(shell('<div class="loading"><div class="spin"></div></div>'));
    [leaders, allStudents] = await Promise.all([
      API.get('/leaders').catch(() => []),
      API.get('/students').catch(() => []),
    ]);
    if (S.page !== _pg) return;
  }
```
(The rest of the function is unchanged, including the conditional nested `await API.get(\`/connections/leader/${_msLeader}/summary\`)` for the selected leader — that path is dynamic per-leader and stays a plain sequential fetch outside the SWR array, same as today; it already benefits from `API.get`'s own 30s cache internally. The dropdown's `onchange="...renderMyStudents()"` self-recursion still works: the second call sees fresh `/leaders`+`/students` cache and takes the `allFresh` branch immediately.)

- [ ] **Step 4: `renderStudents` (page `'students'`)**

Current (`public/index.html:2716-2728`):
```js
async function renderStudents() {
  if (!_allCached('/students')) setApp(shell('<div class="loading"><div class="spin"></div></div>'));
  // Leaders are fetched alongside students so they can be hidden from the search
  // (a person who both leads and appears in the service export shows up as a
  // student row otherwise).
  const [students, leaders] = await Promise.all([
    API.get('/students').catch(() => []),
    API.get('/leaders').catch(() => []),
  ]);
  _sS.students = students || [];
  _sS.leaderNames = new Set((leaders || []).map(l => (l.fullName || '').trim().toLowerCase()).filter(Boolean));
  renderStudentView();
}
```
Replace with:
```js
const STUDENTS_PATHS = ['/students', '/leaders'];
let _studentsRevalidating = false;
function _revalidateStudents() {
  if (_studentsRevalidating) return;
  _studentsRevalidating = true;
  Promise.all(STUDENTS_PATHS.map(p => API.get(p).catch(() => null)))
    .then(() => { if (S.page === 'students') return renderStudents(); })
    .catch(() => {})
    .finally(() => { _studentsRevalidating = false; });
}
async function renderStudents() {
  const _pg = S.page;
  // Leaders are fetched alongside students so they can be hidden from the search
  // (a person who both leads and appears in the service export shows up as a
  // student row otherwise). Both paths now gate the spinner (previously only
  // /students did, even though /leaders was fetched too).
  const allFresh = STUDENTS_PATHS.every(p => Cache.get(p) !== null);
  const haveStale = STUDENTS_PATHS.every(p => Cache.getStale(p) !== null);
  let students, leaders;
  if (allFresh || haveStale) {
    students = Cache.getStale('/students') || [];
    leaders = Cache.getStale('/leaders') || [];
    if (!allFresh) _revalidateStudents();
  } else {
    setApp(shell('<div class="loading"><div class="spin"></div></div>'));
    [students, leaders] = await Promise.all([
      API.get('/students').catch(() => []),
      API.get('/leaders').catch(() => []),
    ]);
    if (S.page !== _pg) return;
  }
  _sS.students = students || [];
  _sS.leaderNames = new Set((leaders || []).map(l => (l.fullName || '').trim().toLowerCase()).filter(Boolean));
  renderStudentView();
}
```

- [ ] **Step 5: `renderAtRisk` (page `'at-risk'`)**

Current (`public/index.html:2585-2589`):
```js
async function renderAtRisk() {
  setApp(shell('<div class="loading"><div class="spin"></div></div>'));
  let allStu = [];
  try { allStu = await API.get('/students'); } catch {}
  const u = S.user;
```
Replace with:
```js
const ATRISK_PATHS = ['/students'];
let _atRiskRevalidating = false;
function _revalidateAtRisk() {
  if (_atRiskRevalidating) return;
  _atRiskRevalidating = true;
  Promise.all(ATRISK_PATHS.map(p => API.get(p).catch(() => null)))
    .then(() => { if (S.page === 'at-risk') return renderAtRisk(); })
    .catch(() => {})
    .finally(() => { _atRiskRevalidating = false; });
}
async function renderAtRisk() {
  const _pg = S.page;
  const allFresh = ATRISK_PATHS.every(p => Cache.get(p) !== null);
  const haveStale = ATRISK_PATHS.every(p => Cache.getStale(p) !== null);
  let allStu = [];
  if (allFresh || haveStale) {
    allStu = Cache.getStale('/students') || [];
    if (!allFresh) _revalidateAtRisk();
  } else {
    setApp(shell('<div class="loading"><div class="spin"></div></div>'));
    try { allStu = await API.get('/students'); } catch {}
    if (S.page !== _pg) return;
  }
  const u = S.user;
```
(This is the biggest behavioural win of this task — `renderAtRisk` currently spinners on *every* visit, even within the 30s cache window, because it never used `_allCached` at all.)

- [ ] **Step 6: `renderImport` (page `'import'`)**

Current (`public/index.html:3305-3308`):
```js
async function renderImport() {
  if (!_allCached('/import/history')) setApp(shell('<div class="loading"><div class="spin"></div></div>'));
  let history = [];
  try { history = await API.get('/import/history'); } catch {}
```
Replace with:
```js
const IMPORT_PATHS = ['/import/history'];
let _importRevalidating = false;
function _revalidateImport() {
  if (_importRevalidating) return;
  _importRevalidating = true;
  Promise.all(IMPORT_PATHS.map(p => API.get(p).catch(() => null)))
    .then(() => { if (S.page === 'import') return renderImport(); })
    .catch(() => {})
    .finally(() => { _importRevalidating = false; });
}
async function renderImport() {
  const _pg = S.page;
  const allFresh = IMPORT_PATHS.every(p => Cache.get(p) !== null);
  const haveStale = IMPORT_PATHS.every(p => Cache.getStale(p) !== null);
  let history = [];
  if (allFresh || haveStale) {
    history = Cache.getStale('/import/history') || [];
    if (!allFresh) _revalidateImport();
  } else {
    setApp(shell('<div class="loading"><div class="spin"></div></div>'));
    try { history = await API.get('/import/history'); } catch {}
    if (S.page !== _pg) return;
  }
```

- [ ] **Step 7: `renderAdmin` (page `'admin'`)**

Current (`public/index.html:3745-3753`):
```js
async function renderAdmin() {
  if (S.user?.role !== 'admin') { go('home'); return; }
  if (!_allCached('/settings', '/accounts/users')) setApp(shell('<div class="loading"><div class="spin"></div></div>'));
  const [settings, users] = await Promise.all([
    API.get('/settings').catch(() => ({})),
    API.get('/accounts/users').catch(() => []),
  ]);
  renderAdminView(settings, users);
}
```
Replace with:
```js
const ADMIN_PATHS = ['/settings', '/accounts/users'];
let _adminRevalidating = false;
function _revalidateAdmin() {
  if (_adminRevalidating) return;
  _adminRevalidating = true;
  Promise.all(ADMIN_PATHS.map(p => API.get(p).catch(() => null)))
    .then(() => { if (S.page === 'admin') return renderAdmin(); })
    .catch(() => {})
    .finally(() => { _adminRevalidating = false; });
}
async function renderAdmin() {
  if (S.user?.role !== 'admin') { go('home'); return; }
  const _pg = S.page;
  const allFresh = ADMIN_PATHS.every(p => Cache.get(p) !== null);
  const haveStale = ADMIN_PATHS.every(p => Cache.getStale(p) !== null);
  let settings, users;
  if (allFresh || haveStale) {
    settings = Cache.getStale('/settings') || {};
    users = Cache.getStale('/accounts/users') || [];
    if (!allFresh) _revalidateAdmin();
  } else {
    setApp(shell('<div class="loading"><div class="spin"></div></div>'));
    [settings, users] = await Promise.all([
      API.get('/settings').catch(() => ({})),
      API.get('/accounts/users').catch(() => []),
    ]);
    if (S.page !== _pg) return;
  }
  renderAdminView(settings, users);
}
```
(The role-guard stays the very first line, before any cache/SWR logic — an admin-only page must redirect non-admins before touching `ADMIN_PATHS`. `switchAdminTab()`, `renderAdminView`'s own `/admin/audit` tab fetch, and the three post-write handlers that call `renderAdminView` directly with already-fetched data are unrelated in-page flows — untouched.)

- [ ] **Step 8: Verify with `node --check`**

```bash
grep -n "<script>\|</script>" public/index.html
sed -n '<start+1>,<end-1>p' public/index.html > /tmp/cms-spa-check.js
node --check /tmp/cms-spa-check.js
```
Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add public/index.html
git commit -m "feat: generalize stale-while-revalidate navigation to all remaining pages"
```

---

### Task 7: SW cache bump, docs, final verification

**Files:**
- Modify: `public/sw.js`
- Modify: `CHANGELOG.txt`
- Modify: `CLAUDE.md`

**Interfaces:** none (docs + a version string).

- [ ] **Step 1: Bump the service worker cache name**

Current (`public/sw.js:1`):
```js
const CACHE = 'cms-v8';
```
Replace with:
```js
const CACHE = 'cms-v9';
```
(Confirm the current value first with `grep -n "const CACHE" public/sw.js` in case it has moved past `cms-v8` since this plan was written — bump by one from whatever is actually there.)

- [ ] **Step 2: Append a CHANGELOG.txt entry**

Insert a new phase block immediately before the `SUMMARY OF CUMULATIVE CHANGES` section (matching the existing phase-block format), dated 2026-07-02:

```
-------------------------------------------------------------------------------
PHASE: CAMP-APP PARITY — PHONE FIX, WIPE GUARD, LOADING BAR, SWR  (2026-07-02)
-------------------------------------------------------------------------------
- fmtPhone now normalizes AU mobiles that lost their leading 0 to spreadsheet
  numeric coercion in Elvanto/UCare CSV imports (11-digit "61…" and bare
  9-digit "4…" forms), matching the camp app's fmtPhone. Applies everywhere a
  number is displayed (phoneLink/callPhone); editable phone inputs untouched
- POST /admin/reset and /admin/clear-service-group now require a body of
  {force:true, confirmWipe:"I understand this cannot be undone"} — rejected
  with BadRequestError before any data is touched otherwise. Mirrors the camp
  app's wipe guard pattern (admin.service.ts); CMS keeps its own delete
  semantics (reset still keeps accounts). SPA's confirmType/adminAction flow
  sends the new fields automatically once the typed-word modal is confirmed
- New global top loading bar (#nprog): a thin accent-coloured bar under the
  top edge, reference-counted from the API layer's r() so only real network
  requests drive it — cache hits never flash it
- Stale-while-revalidate navigation (previously only Home + Trends) is now
  generalized to Leaders/Connect, Birthdays, My Students, Students, At Risk,
  Import, and Admin: a revisit paints the last-known data instantly and
  refreshes in the background instead of spinnering on every cache expiry
- Bumped service worker cache cms-v8 to cms-v9 (index.html changed)
```

- [ ] **Step 3: Update CLAUDE.md**

In the **SPA architecture** section, extend the existing "Client-side cache" bullet (`CLAUDE.md:242`) and the sentence that currently reads "Cache-skip spinner — render functions check `_allCached(...paths)` before showing the loading spinner; cached navigations render immediately" (`CLAUDE.md:244`) to reflect the generalized SWR. Current:
```
**Client-side cache** — `Cache` object (30-second TTL) wraps all `API.get()` calls. Cache is invalidated on every write (connections, leaders, settings, import, admin, users). After login `_prefetch()` fires background fetches for all 7 common endpoints so navigations after the first are instant.

**Cache-skip spinner** — render functions check `_allCached(...paths)` before showing the loading spinner; cached navigations render immediately.
```
Replace with:
```
**Client-side cache** — `Cache` object (30-second TTL) wraps all `API.get()` calls. Cache is invalidated on every write (connections, leaders, settings, import, admin, users). After login `_prefetch()` fires background fetches for all 7 common endpoints so navigations after the first are instant.

**Stale-while-revalidate navigation** — every page render function (`renderHome`, `renderTrends`, `renderConnect`, `renderUpcomingBirthdays`, `renderMyStudents`, `renderStudents`, `renderAtRisk`, `renderImport`, `renderAdmin`, plus the CA module's own pages) follows the same `<PAGE>_PATHS` + `allFresh`/`haveStale` pattern: all-fresh renders straight from cache; any-stale paints instantly from `Cache.getStale(...)` and revalidates in the background via a `_revalidate<Page>()` helper that re-renders only if `S.page` hasn't changed; nothing cached at all shows the spinner. `renderLeaders`/`renderQuadView`/`renderMyQuad`/`renderNotifications` are dead/unreachable code (not in the `render()` dispatch table) and were deliberately left on the old pattern.

**Global loading bar (`#nprog`)** — a thin accent-coloured bar under the top edge, reference-counted via `_npStart`/`_npDone` called from the `API` IIFE's `r()`. Since `API.get` only calls `r()` on a cache miss, cached reads never trigger it — only real network requests do.
```

Also update the **Service worker** section's cache-name line (`CLAUDE.md:290`):
```
- Cache name: `cms-v8` (bump on breaking changes to force eviction)
```
to:
```
- Cache name: `cms-v9` (bump on breaking changes to force eviction)
```

- [ ] **Step 4: Full verification pass**

```bash
grep -n "<script>\|</script>" public/index.html
sed -n '<start+1>,<end-1>p' public/index.html > /tmp/cms-spa-check.js
node --check /tmp/cms-spa-check.js
npm run typecheck
npm run test
```
Expected: `node --check` silent; `typecheck` clean; `test` passes with count ≥136 (130 prior + 6 new admin wipe-guard tests from Task 3).

- [ ] **Step 5: Commit**

```bash
git add public/sw.js CHANGELOG.txt CLAUDE.md
git commit -m "chore: bump SW cache to cms-v9 and document the camp-parity port"
```

---

## Post-plan note

Do not `git push` unless the user explicitly asks — pushing to `master` auto-deploys to production (https://connection-made-simple.vercel.app). The loading bar (Task 5) and the more-instant page navigations (Task 6) are visual/behavioural changes the user should eyeball on-device after deploy, per the project's "no dev server / no browser" verification convention.
