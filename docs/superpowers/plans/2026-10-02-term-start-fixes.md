# Term-Start Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get YS Connection ready for the new school term: ship the already-merged Login Activity feature (upgraded with the camp app's lessons), fix the bugs the pre-term review found, and tidy the phone experience.

**Architecture:** All changes are small, local edits to the single-file SPA (`public/index.html`), `public/sw.js`, and a handful of backend files. Pure logic (login-activity ordering/formatting) is written as named top-level functions in the SPA and tested in vitest by extracting the real function bodies out of the shipped HTML (the pattern in `src/tests/export-guide.test.ts`), so tests exercise shipped code, not a copy. No new API routes, no new dependencies, no notifications, no security hardening (owner accepted the current posture).

**Tech Stack:** TypeScript/Express backend, vanilla-JS inline SPA, Postgres via Supabase (Sydney, ref `ltcblcudlzlzfcyzlhpc`), vitest, Vercel (team `citipointe-youth`, project `ys-connection`).

**Spec:** No design doc. Source of truth is the 2026-10-02 pre-term review (six read-only reviews: live phone pass, camp-fix port, admin login visibility, post-camp audit lessons, DB/ops, code) as approved by the owner in chat. Reference implementation for Login Activity: camp repo `Project 9 - Camp Platform\youth-camp-platform-masterv2` (`public/index.html` ~7365 `_loginActivityOrder`, `setLaFilter`, `.la-row` CSS at 242-251, `scripts/login-activity-harness.js`).

## Global Constraints

- Push straight to `master` is the owner's stated workflow; `master` auto-deploys to prod with **no staging**. Run `npm run typecheck && npm run test` (currently 42 files / 414 tests, all passing) before every push.
- **Custom domain does NOT auto-alias.** Every prod deploy needs `vercel alias set <new-deployment-url> ys-connection.vercel.app`, then `vercel inspect ys-connection.vercel.app` and curl health checks.
- Migration **0009 must be applied to prod BEFORE the code that reads/writes `users.login_history` is aliased** (`SupabaseUserRepository.save()` upserts that column unconditionally; without it every user save fails).
- **Never run a prod-changing action (apply migration, deploy, alias) without explicit owner approval in chat.** Steps marked `[OWNER GATE]` are those.
- Inline-script rules in `public/index.html`: no contractions or apostrophes inside single-quoted JS strings (use double quotes or template literals) — one slip is a white-screen SyntaxError; always `esc()` user data; when changing a const to a function update every call site; never put a user-supplied string in an `onclick` argument. After every SPA edit run the syntax check in Task 0 Step 3.
- Bump `CACHE` in `public/sw.js` (`ysc-v55` -> `ysc-v56`) once, in the final SPA-touching task of each batch that ships (Task 9 for batch A; Task 18 for batch B).
- No new top-level API routes in this plan. (If one is ever added: `src/api/http/router.ts`, `vercel.json` `routes[]`, `public/sw.js` `API_RE`.)
- Do **not** run `npm audit fix --force`.
- Dates shown to admins are Brisbane time (`Australia/Brisbane`, UTC+10, no DST) with the year.
- Out of scope: security headers, session revocation, rate limiter, DB grants, pagination of long lists, pinch-zoom (viewport meta stays), notifications/push, unused notification tables.

## Review Focus

- **Never-logged-in accounts and empty `loginHistory`/`undefined` field** (pre-0009 rows, new accounts): must sort first, show "Never logged in", and count as "not logged in since cutoff". Pinned in Task 2.
- **Garbage/future timestamps in `loginHistory`** (clock skew, bad data): must not render "NaN" or crash; treat unparseable as never. Pinned in Task 2.
- **Admin session expiry mid-preview** (preview token lives 1h): a 401 must restore the admin's stashed token rather than dump the admin to the login screen with the stash orphaned. Pinned in Task 6.
- **Transient server/network error on boot** (503, offline, cold DB): must NOT delete the saved token and log the user out. Only a 401 clears it. Pinned in Task 6.
- **`#import-status` missing from the DOM when an upload starts**: must not leave `_importBusy` stuck true (all further imports blocked until reload). Pinned in Task 16.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `public/index.html` | SPA: Login Activity UI + pure helpers, `_relTime` fix, 401 handling, SW registration, CSS/phone fixes, search inputs, import fixes | 1-4, 6, 8, 10-11, 13-16 |
| `public/sw.js` | Cache version bump | 9, 18 |
| `src/tests/helpers/extract-fn.ts` (create) | Shared `extractFn`/`loadIndexHtml` for tests that evaluate shipped SPA functions | 1 |
| `src/tests/spa-relative-time.test.ts` (create) | Guards the `_relTime` name collision | 1 |
| `src/tests/login-activity.test.ts` (create) | Pure helper tests | 2 |
| `src/tests/spa-auth-boot.test.ts` (create) | `boot()` / 401 behaviour | 6 |
| `src/tests/spa-prayer-export.test.ts` (create) | CSV column round-trip | 4 |
| `src/tests/account.service.test.ts` (modify) | `list()` never leaks `passwordHash` | 5 |
| `src/services/admin.service.ts` (modify) | Exclude login history from new-year snapshot | 7 |
| `src/tests/admin.service.test.ts` (modify) | Test for the above | 7 |
| `CLAUDE.md` (modify) | Document Login Activity + migration 0009 | 9 |
| `package.json`, `package-lock.json` | Non-breaking express bump | 19 |

Line numbers below are from `f1eed93`; re-find by function name (Grep) if they have drifted.

---

## BATCH A — ship Login Activity + correctness fixes

### Task 0: Preflight (no code change)

**Files:** none.

- [ ] **Step 1: Record the working-tree state and decide what goes in commits**

Run: `git status --short && git log --oneline -3`
Expected: HEAD `f1eed93`; modified `CLAUDE.md`; untracked `_design/`, `docs/superpowers/Icon/`, four Prayers spec/plan files under `docs/superpowers/`.
Do NOT `git add -A`. Each task below stages only its own named files. The pre-existing `CLAUDE.md` modification (+51 lines, not ours) is committed together with Task 9's CLAUDE.md edit only if the owner confirms it is theirs to ship; otherwise stash it first (`git stash push CLAUDE.md`) and `git stash pop` after Task 9. The owner decides (see "Open questions" in the hand-off message).

- [ ] **Step 2: Establish the green baseline**

Run: `npm run typecheck && npm run test`
Expected: PASS, 42 files / 414 tests.

- [ ] **Step 3: Create the SPA syntax-check script (reused by every SPA task)**

Create `scripts/check-spa-syntax.js`:

```js
// Extracts every inline <script> from public/index.html and runs node --check on it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let m, n = 0, bad = 0;
while ((m = re.exec(html))) {
  n++;
  const f = path.join(os.tmpdir(), `spa-check-${process.pid}-${n}.js`);
  fs.writeFileSync(f, m[1]);
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { bad++; console.error(`inline script #${n} FAILED:\n${r.stderr}`); }
  fs.unlinkSync(f);
}
if (bad) process.exit(1);
console.log(`ok: ${n} inline script(s) parse cleanly`);
```

Run: `node scripts/check-spa-syntax.js`
Expected: `ok: N inline script(s) parse cleanly`.

- [ ] **Step 4: Commit**

```bash
git add scripts/check-spa-syntax.js
git commit -m "chore: add inline-script syntax checker for public/index.html"
```

---

### Task 1: Fix the `_relTime` name collision (breaks Prayers once Login Activity ships)

**Files:**
- Create: `src/tests/helpers/extract-fn.ts`
- Create: `src/tests/spa-relative-time.test.ts`
- Modify: `public/index.html` (~1391 Prayers `_relTime` stays; ~5276 Login Activity `_relTime` -> `_laRelTime`; ~5297 its call site)

**Interfaces:**
- Produces: `extractFn(source: string, name: string): string`, `loadIndexHtml(): string` (from `src/tests/helpers/extract-fn.ts`) used by Tasks 2, 4, 6. After this task the SPA has exactly one `function _relTime(` (Prayers: `'today'|'3d'|'2w'|'1mo'`) and one `function _laRelTime(` (Login Activity: `'just now'|'5m ago'|...`).

Why: both features define a global `function _relTime`. Function declarations hoist and the later one wins, so Prayers (`_relTime(p.createdAt)` at ~3487) would start showing "5m ago"/a date instead of "3d".

- [ ] **Step 1: Write the shared helper**

Create `src/tests/helpers/extract-fn.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadIndexHtml(): string {
  return readFileSync(join(__dirname, '../../../public/index.html'), 'utf8');
}

// Brace-matching extraction of `function name(...) { ... }` from the shipped SPA.
export function extractFn(source: string, name: string): string {
  const re = new RegExp(`function ${name}\\([^)]*\\)\\s*\\{`);
  const m = re.exec(source);
  if (!m) throw new Error(`could not find function ${name} in index.html`);
  let depth = 0;
  let i = m.index + m[0].length - 1;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) break; }
  }
  return source.slice(m.index, i + 1);
}
```

- [ ] **Step 2: Write the failing test**

Create `src/tests/spa-relative-time.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractFn, loadIndexHtml } from './helpers/extract-fn';

describe('SPA relative-time helpers do not collide', () => {
  const html = loadIndexHtml();

  it('defines function _relTime exactly once (a second global of the same name silently overrides the first)', () => {
    expect(html.match(/function _relTime\(/g)?.length).toBe(1);
  });

  it('Prayers _relTime keeps its compact format', () => {
    const rel = new Function(`${extractFn(html, '_relTime')}; return _relTime;`)() as (iso: string) => string;
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
    expect(rel(ago(1000))).toBe('today');
    expect(rel(ago(3 * 86400000))).toBe('3d');
    expect(rel(ago(15 * 86400000))).toBe('2w');
    expect(rel(ago(65 * 86400000))).toBe('2mo');
    expect(rel('')).toBe('');
  });

  it('Login Activity has its own differently-named relative-time function', () => {
    expect(html).toMatch(/function _laRelTime\(/);
  });
});
```

- [ ] **Step 3: Run it, expect FAIL**

Run: `npx vitest run src/tests/spa-relative-time.test.ts`
Expected: FAIL (`_relTime` appears twice; `_laRelTime` missing).

- [ ] **Step 4: Rename the Login Activity one**

In `public/index.html`, change `function _relTime(iso) {` at ~5276 (the one whose body starts `const ms = Date.now() - Date.parse(iso);`) to `function _laRelTime(iso) {`, and in `_loginActivityBodyHtml` change `_relTime(history[0])` (~5297) to `_laRelTime(history[0])`. Leave the Prayers `_relTime` (~1391) and its call at ~3487 untouched. (Task 3 later rewrites `_loginActivityBodyHtml` entirely; this rename must still land first so the tree is never in the broken state.)

- [ ] **Step 5: Run test + syntax check, expect PASS**

Run: `npx vitest run src/tests/spa-relative-time.test.ts && node scripts/check-spa-syntax.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tests/helpers/extract-fn.ts src/tests/spa-relative-time.test.ts public/index.html
git commit -m "fix: rename Login Activity _relTime to _laRelTime (it overrode the Prayers one)"
```

---

### Task 2: Login Activity pure helpers (order, filter, group, Brisbane format)

**Files:**
- Modify: `public/index.html` (add helpers directly above `_loginActivityBodyHtml`, replacing `_laRelTime`'s neighbours as needed)
- Create: `src/tests/login-activity.test.ts`

**Interfaces:**
- Consumes: `extractFn` / `loadIndexHtml` (Task 1).
- Produces (all top-level functions in `public/index.html`, no DOM access):
  - `_laLastMs(u: {loginHistory?: string[]}): number` — ms of newest valid login, or `-Infinity` if none/unparseable.
  - `_laOrder(users: U[]): U[]` — never-logged-in first, then oldest last-login first; ties by `displayName` (locale compare). Does not mutate input.
  - `_laNotSince(users: U[], cutoffMs: number): U[]` — users whose `_laLastMs < cutoffMs` (never-logged-in always included).
  - `_laGroup(users: U[]): {key: string, label: string, users: U[]}[]` — groups in fixed order `admin, director(s)…`: see Step 3 for the exact role list; keeps each group's incoming order; omits empty groups.
  - `_laFmtBrisbane(iso: string): string` — e.g. `"2 Oct 2026, 3:05 pm"`; `''` for unparseable.
  - `_laRelTime(iso: string): string` — (already renamed in Task 1) `'just now'|'5m ago'|'3h ago'|'2d ago'`, else `_laFmtBrisbane(iso)`.

Roles: the SPA's `u.role` values are `admin`, `director`?  Before writing `_laGroup`, run `Grep` for `function _roleLabel` in `public/index.html` and use exactly its role keys; the group order is: admin, then every non-`grade`/`quad` leadership role in `_roleLabel`'s order, then `grade`, then `quad`, then anything else under "Other".

- [ ] **Step 1: Write the failing tests**

Create `src/tests/login-activity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractFn, loadIndexHtml } from './helpers/extract-fn';

const html = loadIndexHtml();
const src = ['_laLastMs', '_laOrder', '_laNotSince', '_laFmtBrisbane', '_laRelTime']
  .map((n) => extractFn(html, n)).join('\n');
const h = new Function(`${src}; return { _laLastMs, _laOrder, _laNotSince, _laFmtBrisbane, _laRelTime };`)() as {
  _laLastMs(u: any): number; _laOrder(u: any[]): any[]; _laNotSince(u: any[], c: number): any[];
  _laFmtBrisbane(i: string): string; _laRelTime(i: string): string;
};

const u = (name: string, history?: string[]) => ({ displayName: name, loginHistory: history });

describe('Login Activity ordering', () => {
  it('puts never-logged-in first (undefined, empty, and unparseable history), then oldest last-login first', () => {
    const out = h._laOrder([
      u('Recent', ['2026-10-01T00:00:00Z']),
      u('Old', ['2026-08-01T00:00:00Z', '2026-07-01T00:00:00Z']),
      u('NoField'),
      u('Empty', []),
      u('Garbage', ['not-a-date']),
    ]).map((x) => x.displayName);
    expect(out).toEqual(['Empty', 'Garbage', 'NoField', 'Old', 'Recent']);
  });

  it('does not mutate its input', () => {
    const input = [u('B', ['2026-10-01T00:00:00Z']), u('A')];
    h._laOrder(input);
    expect(input.map((x) => x.displayName)).toEqual(['B', 'A']);
  });

  it('uses the newest entry (index 0), not the oldest', () => {
    expect(h._laLastMs(u('x', ['2026-10-01T00:00:00Z', '2026-01-01T00:00:00Z']))).toBe(Date.parse('2026-10-01T00:00:00Z'));
  });
});

describe('Login Activity "not logged in since" filter', () => {
  const cutoff = Date.parse('2026-09-28T00:00:00Z');
  it('includes never-logged-in and anyone whose newest login is before the cutoff; excludes the rest', () => {
    const out = h._laNotSince([
      u('Never'),
      u('Before', ['2026-09-27T23:59:59Z']),
      u('After', ['2026-09-28T00:00:01Z']),
      u('Exactly', ['2026-09-28T00:00:00Z']),
    ], cutoff).map((x) => x.displayName);
    expect(out).toEqual(['Never', 'Before']);
  });
});

describe('Login Activity time formatting', () => {
  it('formats Brisbane time (UTC+10) with the year', () => {
    expect(h._laFmtBrisbane('2026-10-02T05:05:00Z')).toBe('2 Oct 2026, 3:05 pm');
  });
  it('rolls the date over at Brisbane midnight (14:00Z is 00:00 next day)', () => {
    expect(h._laFmtBrisbane('2026-12-31T14:30:00Z')).toBe('1 Jan 2027, 12:30 am');
  });
  it('returns empty string, not "NaN", for unparseable input', () => {
    expect(h._laFmtBrisbane('nope')).toBe('');
  });
  it('relative time: just now / minutes / hours / days, then falls back to the Brisbane date', () => {
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
    expect(h._laRelTime(ago(10_000))).toBe('just now');
    expect(h._laRelTime(ago(5 * 60_000))).toBe('5m ago');
    expect(h._laRelTime(ago(3 * 3_600_000))).toBe('3h ago');
    expect(h._laRelTime(ago(2 * 86_400_000))).toBe('2d ago');
    expect(h._laRelTime('2026-01-01T00:00:00Z')).toBe('1 Jan 2026, 10:00 am');
  });
  it('a future timestamp (clock skew) renders "just now" rather than a negative duration', () => {
    expect(h._laRelTime(new Date(Date.now() + 3_600_000).toISOString())).toBe('just now');
  });
});
```

(`_laGroup` is tested in Task 3 once the role keys are confirmed, because it depends on `_roleLabel`.)

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run src/tests/login-activity.test.ts`
Expected: FAIL — `could not find function _laLastMs`.

- [ ] **Step 3: Implement the helpers**

In `public/index.html`, replace the existing `_laRelTime` function and insert the new helpers immediately above `_loginActivityBodyHtml`:

```js
function _laLastMs(u) {
  const h = (u && u.loginHistory) || [];
  const ms = h.length ? Date.parse(h[0]) : NaN;
  return isNaN(ms) ? -Infinity : ms;
}
function _laOrder(users) {
  return [...users].sort((a, b) => {
    const d = _laLastMs(a) - _laLastMs(b);
    if (d !== 0 && !isNaN(d)) return d;
    return (a.displayName || '').localeCompare(b.displayName || '');
  });
}
function _laNotSince(users, cutoffMs) {
  return users.filter(u => _laLastMs(u) < cutoffMs);
}
function _laFmtBrisbane(iso) {
  const ms = Date.parse(iso);
  if (isNaN(ms)) return '';
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Brisbane', day: 'numeric', month: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(new Date(ms));
  const p = {};
  parts.forEach(x => { p[x.type] = x.value; });
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return p.day + ' ' + months[Number(p.month) - 1] + ' ' + p.year + ', ' + p.hour + ':' + p.minute + ' ' + String(p.dayPeriod).toLowerCase();
}
function _laRelTime(iso) {
  const ms = Date.now() - Date.parse(iso);
  if (isNaN(ms)) return '';
  if (!(ms >= 60000)) return 'just now';
  const m = Math.floor(ms / 60000);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24);
  if (d < 7) return d + 'd ago';
  return _laFmtBrisbane(iso);
}
```

- [ ] **Step 4: Run tests + syntax check, expect PASS**

Run: `npx vitest run src/tests/login-activity.test.ts && node scripts/check-spa-syntax.js`
Expected: PASS. If the `3:05 pm` assertion fails only on `am/pm` casing or a narrow-no-break-space between time and period, the `toLowerCase()` + manual join above already normalise both; do not loosen the test.

- [ ] **Step 5: Commit**

```bash
git add public/index.html src/tests/login-activity.test.ts
git commit -m "feat: pure Login Activity helpers (order, not-since filter, Brisbane time)"
```

---

### Task 3: Login Activity UI — filter, grouping, one-line expandable rows

**Files:**
- Modify: `public/index.html` (`_loginActivityBodyHtml` ~5288; admin-tab render ~5220; CSS block near `.li` styles; add `_laGroup`, state vars, `setLaCutoff`)
- Modify: `src/tests/login-activity.test.ts` (add `_laGroup` tests)

**Interfaces:**
- Consumes: `_laOrder`, `_laNotSince`, `_laLastMs`, `_laRelTime`, `_laFmtBrisbane` (Task 2); existing `esc`, `gradeBadgeLabel`, `QUAD_LABELS`, `_roleLabel`, `render`.
- Produces: `_laGroup(users)` as in Task 2's interface list; module state `let _laCutoff = ''` (a `YYYY-MM-DD` string from `<input type=date>`, `''` = filter off); `setLaCutoff(v: string)`.

Design (matches camp's pattern, adapted): at top, a card with a "Not logged in since" date input and a live count ("7 of 24 accounts haven't logged in since 28 Sep 2026"). With the filter off, the count line reads "N accounts never logged in" and the list shows everyone. Accounts are grouped by role (headings), each group keeping never-first ordering. Each row is one line: name, short role chip, relative time right-aligned. Tapping a row expands (native `<details>`) to show the full Brisbane timestamps (newest first). A user with a single login still expands (drill-down shows the one timestamp).

- [ ] **Step 1: Confirm role keys and write the `_laGroup` test**

Run Grep for `function _roleLabel` in `public/index.html` and read it. Add to `src/tests/login-activity.test.ts` (adjust the role keys in the fixture to exactly those `_roleLabel` knows; the order assertion below assumes `admin` < leadership roles < `grade` < `quad` < unknown):

```ts
describe('Login Activity grouping', () => {
  const g = new Function(`${extractFn(html, '_laGroup')}; return _laGroup;`)() as (u: any[]) => { key: string; label: string; users: any[] }[];
  it('groups by role in a fixed order, omits empty groups, and keeps incoming order within a group', () => {
    const out = g([
      { displayName: 'Q1', role: 'quad' },
      { displayName: 'G1', role: 'grade' },
      { displayName: 'A1', role: 'admin' },
      { displayName: 'G2', role: 'grade' },
      { displayName: 'Weird', role: 'something-new' },
    ]);
    expect(out.map((x) => x.key)).toEqual(['admin', 'grade', 'quad', 'other']);
    expect(out.find((x) => x.key === 'grade')!.users.map((x) => x.displayName)).toEqual(['G1', 'G2']);
  });
  it('returns [] for no users', () => { expect(g([])).toEqual([]); });
});
```

- [ ] **Step 2: Run, expect FAIL** (`could not find function _laGroup`)

Run: `npx vitest run src/tests/login-activity.test.ts`

- [ ] **Step 3: Implement `_laGroup`, state, and the new body renderer**

Add above `_loginActivityBodyHtml` (insert any leadership role keys found in Step 1 into `LA_GROUPS` between `admin` and `grade`; `_roleLabel(key)` supplies their label):

```js
const LA_GROUPS = [
  { key: 'admin', label: 'Admins' },
  { key: 'grade', label: 'Grade accounts' },
  { key: 'quad', label: 'Quad accounts' },
];
let _laCutoff = '';
function setLaCutoff(v) { _laCutoff = v || ''; render(); }
function _laGroup(users) {
  const known = LA_GROUPS.map(g => g.key);
  const out = LA_GROUPS.map(g => ({ key: g.key, label: g.label, users: users.filter(u => u.role === g.key) }));
  out.push({ key: 'other', label: 'Other', users: users.filter(u => !known.includes(u.role)) });
  return out.filter(g => g.users.length);
}
```

Replace `_loginActivityBodyHtml` with:

```js
function _loginActivityBodyHtml(users) {
  const cutoffMs = _laCutoff ? Date.parse(_laCutoff + 'T00:00:00+10:00') : NaN;
  const filterOn = !isNaN(cutoffMs);
  const ordered = _laOrder(users);
  const shown = filterOn ? _laNotSince(ordered, cutoffMs) : ordered;
  const never = users.filter(u => _laLastMs(u) === -Infinity).length;
  const summary = filterOn
    ? `${shown.length} of ${users.length} accounts have not logged in since ${esc(_laFmtBrisbane(_laCutoff + 'T00:00:00+10:00').split(',')[0])}`
    : `${never} of ${users.length} accounts have never logged in`;
  const row = u => {
    const history = u.loginHistory || [];
    const last = history.length && _laLastMs(u) !== -Infinity ? _laRelTime(history[0]) : 'Never';
    const rl = u.role === 'grade' ? gradeBadgeLabel(u) : u.role === 'quad' ? (QUAD_LABELS[u.quad] || u.quad) : _roleLabel(u.role);
    const inactive = u.status === 'inactive' ? ' · inactive' : '';
    const times = history.map(h => _laFmtBrisbane(h)).filter(Boolean);
    const detail = times.length
      ? times.map(t => `<div>${esc(t)}</div>`).join('')
      : '<div>No logins recorded</div>';
    return `<details class="la-row"><summary><span class="la-name">${esc(u.displayName)}</span><span class="la-role">${esc(rl)}${inactive}</span><span class="la-when${last === 'Never' ? ' la-never' : ''}">${esc(last)}</span></summary><div class="la-detail">${detail}</div></details>`;
  };
  const groups = _laGroup(shown);
  const list = groups.length
    ? groups.map(g => `<div class="sh" style="margin:14px 0 6px">${esc(g.label)} (${g.users.length})</div>${g.users.map(row).join('')}`).join('')
    : `<div class="help-text">${filterOn ? 'Everyone has logged in since that date.' : 'No accounts yet.'}</div>`;
  return `<div class="card" style="margin-bottom:10px">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px">${summary}</div>
      <label style="font-size:12px;color:var(--muted)" for="la-cutoff">Not logged in since</label>
      <div style="display:flex;gap:8px;align-items:center;margin-top:4px">
        <input type="date" id="la-cutoff" value="${esc(_laCutoff)}" onchange="setLaCutoff(this.value)" style="flex:1;padding:8px 10px;border:1px solid var(--paper-dark);border-radius:8px;font-size:14px">
        ${filterOn ? `<button class="btn btn-ghost btn-sm" onclick="setLaCutoff('')">Clear</button>` : ''}
      </div>
    </div>${list}`;
}
```

Add CSS next to the `.li` rules (find with Grep `\.li-title`):

```css
.la-row{border:1px solid var(--paper-dark);border-radius:10px;margin-bottom:6px;background:#fff}
.la-row summary{display:flex;align-items:baseline;gap:8px;padding:11px 12px;cursor:pointer;list-style:none;min-height:44px;box-sizing:border-box}
.la-row summary::-webkit-details-marker{display:none}
.la-name{font-weight:600;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.la-role{font-size:12px;color:var(--muted);flex:0 0 auto;max-width:38%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.la-when{font-size:12px;flex:0 0 auto;color:var(--ink-mid)}
.la-never{color:var(--danger);font-weight:600}
.la-detail{padding:2px 12px 10px;font-size:12px;color:var(--muted);line-height:1.6}
```

(`setLaCutoff('')` in an `onclick` is a fixed literal, not user data, so it is safe. The date comes from a date input, always `YYYY-MM-DD`; it is still passed through `esc()` where echoed into `value=`.)

- [ ] **Step 4: Run tests + syntax check, expect PASS**

Run: `npx vitest run src/tests/login-activity.test.ts && node scripts/check-spa-syntax.js`

- [ ] **Step 5: Manual check at phone width**

Run: `npm run start`, open `http://localhost:<port>` at ~375px wide, log in as the seeded admin, Admin -> Login Activity. Verify: rows are one line; tapping a row expands timestamps; picking a date shows the filtered count; Clear restores; no horizontal scroll. (If the local DB is empty the list shows "No accounts yet." — create two test accounts via Admin -> Accounts first.)

- [ ] **Step 6: Commit**

```bash
git add public/index.html src/tests/login-activity.test.ts
git commit -m "feat: Login Activity — not-logged-in-since filter, role groups, expandable rows, Brisbane time"
```

---

### Task 4: Prayers CSV export — include the round-trip columns

**Files:**
- Modify: `public/index.html` (Prayers export, ~4800-4808, function that builds `header`)
- Create: `src/tests/spa-prayer-export.test.ts`

**Interfaces:** The server's `/prayers/export` rows (see `src/services/prayer-allocations.ts:20-27,133-136`) carry `createdByGrades`, `createdByGender`, `createdAt`, `answeredAt` in addition to the 9 columns the client writes today. The import accepts those columns, so an export->re-import currently loses them.

- [ ] **Step 1: Read the code and the server shape**

Read `public/index.html` ~4795-4815 and `src/services/prayer-allocations.ts:15-40,125-140`. Note the exact header strings the *import* parser expects (same file, the header-matching function) — use those exact names for the four new columns.

- [ ] **Step 2: Write the failing test**

Factor the row->CSV-cells mapping into a pure function `_prayerExportCells(row)` returning `string[]` and `PRAYER_EXPORT_HEADER` as a function `_prayerExportHeader()` returning `string[]` (functions, not consts, so `extractFn` can load them). Test:

```ts
import { describe, it, expect } from 'vitest';
import { extractFn, loadIndexHtml } from './helpers/extract-fn';

const html = loadIndexHtml();
const mod = new Function(`${extractFn(html, '_prayerExportHeader')}; ${extractFn(html, '_prayerExportCells')}; return { _prayerExportHeader, _prayerExportCells };`)() as {
  _prayerExportHeader(): string[]; _prayerExportCells(r: any): string[];
};

describe('Prayers CSV export columns', () => {
  const row = { firstName: 'A', lastName: 'B', grade: 8, gender: 'F', prayer: 'p', status: 'answered', answerNote: 'n',
    addedBy: 'Lead', date: '2026-09-01', createdByGrades: [8, 9], createdByGender: 'female', createdAt: '2026-09-01T01:00:00Z', answeredAt: '2026-09-20T01:00:00Z' };

  it('header and cells have the same length', () => {
    expect(mod._prayerExportCells(row)).toHaveLength(mod._prayerExportHeader().length);
  });
  it('includes the four round-trip columns', () => {
    const h = mod._prayerExportHeader();
    for (const c of ['Created By Grades', 'Created By Gender', 'Created At', 'Answered At']) expect(h).toContain(c);
    const cells = mod._prayerExportCells(row);
    expect(cells[h.indexOf('Created By Grades')]).toBe('8;9');
    expect(cells[h.indexOf('Answered At')]).toBe('2026-09-20T01:00:00Z');
  });
  it('blank/missing optional fields become empty strings, never "undefined"', () => {
    const cells = mod._prayerExportCells({ firstName: 'A', lastName: 'B', prayer: 'p', status: 'open' });
    expect(cells.some((c) => c === 'undefined' || c === 'null')).toBe(false);
  });
});
```

If Step 1 shows the import expects different header names or a different grades delimiter than `;`, change the test and implementation to match the importer — the round-trip is the requirement.

- [ ] **Step 3: Run, expect FAIL** — `npx vitest run src/tests/spa-prayer-export.test.ts`

- [ ] **Step 4: Implement**

Add the two functions above the export function and use them in it (replace the inline `header` array and the row mapping):

```js
function _prayerExportHeader() {
  return ['First Name','Last Name','Grade','Gender','Prayer','Status','Answer Note','Added By','Date',
          'Created By Grades','Created By Gender','Created At','Answered At'];
}
function _prayerExportCells(r) {
  const s = v => (v === undefined || v === null) ? '' : String(v);
  return [s(r.firstName), s(r.lastName), s(r.grade), s(r.gender), s(r.prayer), s(r.status), s(r.answerNote),
          s(r.addedBy), s(r.date), Array.isArray(r.createdByGrades) ? r.createdByGrades.join(';') : s(r.createdByGrades),
          s(r.createdByGender), s(r.createdAt), s(r.answeredAt)];
}
```

- [ ] **Step 5: Run test + syntax check, expect PASS**; then manually export and re-import a Prayers CSV against local dev to confirm nothing is reported as skipped.

- [ ] **Step 6: Commit**

```bash
git add public/index.html src/tests/spa-prayer-export.test.ts
git commit -m "fix: Prayers CSV export includes the columns import needs for a lossless round-trip"
```

---

### Task 5: `account.list` never leaks `passwordHash` (leak guard for the new login data)

**Files:**
- Modify: `src/tests/account.service.test.ts` (append)

**Interfaces:** Consumes `makeAccountService(users, settings)` and `svc.list(actor)` (`src/services/account.service.ts:115`), `toSafe` (`:53`). Login Activity renders `loginHistory` from `/accounts/users`; this pins that the same payload never carries `passwordHash`.

- [ ] **Step 1: Write the test**

Append to `src/tests/account.service.test.ts`:

```ts
describe('Account Service — list() payload safety', () => {
  it('returns loginHistory but never passwordHash', async () => {
    const { svc, users, grade } = await buildService();
    await users.save({ ...grade, loginHistory: ['2026-10-01T00:00:00.000Z'] });
    const out = await svc.list(actorFor('u-admin', 'admin'));
    expect(out.length).toBeGreaterThan(0);
    for (const u of out) expect((u as any).passwordHash).toBeUndefined();
    expect(out.find((u) => u.id === grade.id)?.loginHistory).toEqual(['2026-10-01T00:00:00.000Z']);
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run src/tests/account.service.test.ts`. Expected: PASS immediately (this is a regression guard on existing behaviour). If it FAILS, `list()` is leaking the hash: fix `list` to map through `toSafe` and keep the test.

- [ ] **Step 3: Commit**

```bash
git add src/tests/account.service.test.ts
git commit -m "test: pin account list() payload carries loginHistory but not passwordHash"
```

---

### Task 6: `boot()` clears the token only on 401; global 401 handler (preview-safe)

**Files:**
- Modify: `public/index.html` (API IIFE `r()` ~642-684; `boot()` ~7897)
- Create: `src/tests/spa-auth-boot.test.ts`

**Interfaces:**
- Produces: `function _isAuthExpired(err): boolean` (`err && err.status === 401`) and `function _handleAuthExpired(): void` — if `_previewStash` is set, restore the admin token/user from it (same effect as `exitPreview()` minus the navigation) and toast "Preview expired — back to your admin session"; otherwise `API.setToken(null); S.user = null; render()` with toast "Session expired — please log in again". Guarded so concurrent 401s run it once.
- Consumes: `API`, `S`, `Cache`, `toast`, `render`, `_previewStash`, `exitPreview` (existing).

Behaviour to implement:
1. In `boot()`: `catch (err) { if (_isAuthExpired(err)) API.setToken(null); }` — any other failure (503, offline) keeps the token; `S.user` stays null so the login screen shows, but the next reload retries instead of having thrown the session away. (Showing a "can't reach the server — retry" message on the login screen is out of scope.)
2. In `r()` (the request function): after parsing a non-OK response with `status === 401` **and a token currently set** and the request path not being `/auth/login`, call `_handleAuthExpired()` before throwing. The login call must be excluded or a wrong password would trigger "session expired".

- [ ] **Step 1: Read first**

Read `public/index.html` 642-684 and 7897-7915; confirm the exact name of the request function and how it builds `err`. Confirm the server returns 401 (not 403) for expired/invalid tokens: Grep `UnauthorizedError` in `src/api/http/express-adapter.ts` and `src/services/auth.service.ts`.

- [ ] **Step 2: Write the failing tests**

`src/tests/spa-auth-boot.test.ts` evaluates the real `_isAuthExpired`, `_handleAuthExpired` and the `boot` body against stubs:

```ts
import { describe, it, expect } from 'vitest';
import { extractFn, loadIndexHtml } from './helpers/extract-fn';

const html = loadIndexHtml();

function harness(opts: { token: string | null; getImpl: (p: string) => Promise<any>; stash?: any }) {
  const calls: string[] = [];
  const store: Record<string, string | null> = { yap_token: opts.token };
  const src = `
    const localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { store[k] = null; } };
    const API = { setToken: t => { calls.push('setToken:' + t); store.yap_token = t; }, get: getImpl, token: store.yap_token };
    const S = { user: null, settings: null };
    let _previewStash = stash;
    const toast = m => calls.push('toast:' + m);
    const render = () => calls.push('render');
    const Cache = { clear() {} };
    const restoreConnectFilters = () => {}, restoreArFilter = () => {}, restorePrayerFilter = () => {}, applyTheme = () => {};
    let _authExpiring = false;
    ${extractFn(html, '_isAuthExpired')}
    ${extractFn(html, '_handleAuthExpired')}
    ${extractFn(html, 'boot')}
    return { boot, S, _handleAuthExpired, _isAuthExpired };`;
  const api = new Function('store', 'calls', 'getImpl', 'stash', src)(store, calls, opts.getImpl, opts.stash ?? null);
  return { ...api, calls, store };
}

describe('boot() token handling', () => {
  it('keeps the saved token when /auth/me fails with a 503 (transient)', async () => {
    const h = harness({ token: 'T', getImpl: async (p) => { if (p === '/auth/me') throw Object.assign(new Error('x'), { status: 503 }); return {}; } });
    await h.boot();
    expect(h.calls).not.toContain('setToken:null');
    expect(h.store.yap_token).toBe('T');
  });
  it('keeps the saved token on a network error (no status)', async () => {
    const h = harness({ token: 'T', getImpl: async (p) => { if (p === '/auth/me') throw new TypeError('Failed to fetch'); return {}; } });
    await h.boot();
    expect(h.store.yap_token).toBe('T');
  });
  it('clears the token on a 401', async () => {
    const h = harness({ token: 'T', getImpl: async (p) => { if (p === '/auth/me') throw Object.assign(new Error('x'), { status: 401 }); return {}; } });
    await h.boot();
    expect(h.calls).toContain('setToken:null');
  });
});

describe('_handleAuthExpired()', () => {
  it('restores the admin token (and does not log out) when a preview token expires', () => {
    const h = harness({ token: 'PREVIEW', getImpl: async () => ({}), stash: { token: 'ADMIN', user: { id: 'a', role: 'admin' } } });
    h._handleAuthExpired();
    expect(h.calls).toContain('setToken:ADMIN');
    expect(h.calls).not.toContain('setToken:null');
    expect(h.S.user).toEqual({ id: 'a', role: 'admin' });
  });
  it('logs out (clears token, user) on a plain expired session, once even if called twice', () => {
    const h = harness({ token: 'T', getImpl: async () => ({}) });
    h._handleAuthExpired(); h._handleAuthExpired();
    expect(h.calls.filter((c) => c === 'setToken:null')).toHaveLength(1);
    expect(h.S.user).toBeNull();
  });
});
```

(The harness's `boot` evaluation depends on the SPA's real `boot` referencing only identifiers the stub provides — if `boot` references others, add them to the stub list rather than changing the test's intent.)

- [ ] **Step 3: Run, expect FAIL** — `npx vitest run src/tests/spa-auth-boot.test.ts`

- [ ] **Step 4: Implement**

Add near the API IIFE (before `boot`):

```js
let _authExpiring = false;
function _isAuthExpired(err) { return !!err && err.status === 401; }
function _handleAuthExpired() {
  if (_authExpiring) return;
  _authExpiring = true;
  setTimeout(() => { _authExpiring = false; }, 2000);
  if (_previewStash) {
    API.setToken(_previewStash.token);
    S.user = _previewStash.user;
    _previewStash = null;
    try { localStorage.removeItem('yap_preview_stash'); } catch (e) {}
    Cache.clear();
    _shellReady = false;
    toast('Preview expired — back to your admin session');
    go('home');
    return;
  }
  API.setToken(null);
  S.user = null;
  S.page = 'home';
  toast('Session expired — please log in again');
  render();
}
```

(`_shellReady` and `go` exist in the SPA; the test stub must also define `let _shellReady = true; const go = () => {};` — add them to the harness source.) In `boot()` replace `catch { API.setToken(null); }` with `catch (err) { if (_isAuthExpired(err)) API.setToken(null); }`. In `r()`, where the response is not OK and the error is built, add before `throw err`: `if (err.status === 401 && _t && p !== '/auth/login') _handleAuthExpired();` (match the actual path/token variable names found in Step 1).

- [ ] **Step 5: Run tests + syntax check, expect PASS**; manually: in dev, log in, then in DevTools set `localStorage.yap_token='garbage'` and navigate — expect the login screen with the "Session expired" toast and no loop.

- [ ] **Step 6: Commit**

```bash
git add public/index.html src/tests/spa-auth-boot.test.ts
git commit -m "fix: only a 401 clears the saved session on boot; global 401 handler is preview-aware"
```

---

### Task 7: New-year snapshot must not carry login history

**Files:**
- Modify: `src/services/account.service.ts` (`applyCohortLayout` ~292-334 and the password-reset path ~213-217 — see Step 1)
- Modify: `src/services/admin.service.ts` (only if it snapshots users — Step 1)
- Modify: `src/tests/cohort-account-layout.test.ts` (or `admin.service.test.ts`, whichever owns the layout)

**Context:** Camp deliberately excludes login history from its new-year snapshot (`admin.service.ts:238-241` in the camp repo). In YS, `applyCohortLayout` keeps `loginHistory` and password reset keeps it, which is correct for a password reset (same person) but for a new-year layout the accounts are being re-pointed to a new cohort, and a stale "last login" would hide the fact that the new holder has never logged in — the exact thing the new "not logged in since" filter exists to surface.

- [ ] **Step 1: Confirm the decision with the code** — read `account.service.ts:200-220,285-340` and the cohort layout test. If `applyCohortLayout` re-keys accounts to new people, clear `loginHistory` there (set `[]`). Leave the plain password-reset path alone. If the layout only re-labels the same people's accounts, STOP and flag the question to the owner instead of changing behaviour.

- [ ] **Step 2: Failing test** in the cohort-layout test file, using that file's existing fixtures:

```ts
it('clears loginHistory on accounts the layout re-points, so "never logged in" stays truthful in the new year', async () => {
  // use the file's existing builder; seed the affected account with loginHistory: ['2026-09-01T00:00:00.000Z']
  // run applyCohortLayout as the file's other tests do
  // expect((await users.findById(id))?.loginHistory ?? []).toEqual([]);
});
```

(Write this fully against the fixtures once Step 1 shows their names — the file already has the scaffolding; copy the nearest existing test and add the history seed + assertion.)

- [ ] **Step 3: Run, expect FAIL; implement the one-line `loginHistory: []` in the re-pointed-account save; run `npm run typecheck && npx vitest run src/tests/cohort-account-layout.test.ts`, expect PASS.**

- [ ] **Step 4: Commit**

```bash
git add src/services/account.service.ts src/tests/cohort-account-layout.test.ts
git commit -m "fix: new-year layout resets loginHistory on re-pointed accounts"
```

---

### Task 8: Service-worker update check on load and foreground (+ once-only reload guard)

**Files:**
- Modify: `public/index.html` (SW registration, ~7910-7926)

**Context:** Reference: camp `public/index.html:10979-10995` (commit 2cf7e26). `sw.js` already does `skipWaiting()` + `clients.claim()`, so a waiting worker activates immediately — the page just never *checks* for one after the first load, and `controllerchange` can fire a reload loop on first install.

- [ ] **Step 1: Replace the registration block** with:

```js
if ('serviceWorker' in navigator) {
  let _swReloading = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || _swReloading) return;
    _swReloading = true;
    location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch(() => {});
  });
}
```

`hadController` stops a reload on the very first install (no previous worker); `_swReloading` stops double reloads.

- [ ] **Step 2: Syntax check** — `node scripts/check-spa-syntax.js`.

- [ ] **Step 3: Manual check** — in dev with DevTools -> Application -> Service Workers: load the app, bump `CACHE` in `sw.js`, switch tabs away and back; expect one reload and the new `ysc-vNN` cache. Fresh profile first load must NOT reload.

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "fix: check for a new service worker on foreground, reload once, never on first install"
```

---

### Task 9: Docs, cache bump, and Batch A release

**Files:**
- Modify: `CLAUDE.md`
- Modify: `public/sw.js` (`ysc-v55` -> `ysc-v56`)

- [ ] **Step 1: CLAUDE.md** — add a "Login Activity (Admin)" section covering: where it lives (Admin -> Login Activity tab), `users.login_history` jsonb (migration `0009_login_history.sql`, additive, capped 15 newest-first, written fail-open in `auth.service.ts` login), the helpers `_laOrder/_laNotSince/_laGroup/_laFmtBrisbane/_laRelTime` and that `_relTime` is the Prayers-only helper (do not reuse that name), the "not logged in since" filter being a manual date (no client-side term-start source exists), Brisbane-time formatting, new-year layout clears history (Task 7), and the migration-before-deploy ordering rule. Also add the `scripts/check-spa-syntax.js` command to the dev-commands list. Merge with the owner's pre-existing uncommitted `CLAUDE.md` edits only per Task 0 Step 1's decision.

- [ ] **Step 2: Bump `CACHE`** in `public/sw.js` to `ysc-v56`.

- [ ] **Step 3: Full verification**

Run: `npm run typecheck && npm run test && node scripts/check-spa-syntax.js`
Expected: PASS (>= 42 + 5 files; 414 + new tests).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md public/sw.js
git commit -m "docs: document Login Activity + migration 0009; bump SW cache to ysc-v56"
```

- [ ] **Step 5: [OWNER GATE] Apply migration 0009 to prod, then push + alias**

Ask the owner for an explicit yes, then in this order:
1. Verify the column is absent: Supabase `execute_sql` on `ltcblcudlzlzfcyzlhpc`: `select column_name from information_schema.columns where table_name='users' and column_name='login_history';` -> expect 0 rows.
2. Apply `supabase/migrations/0009_login_history.sql` (Supabase MCP `apply_migration` named `login_history`, or run the SQL). Re-run the query -> expect 1 row. This is additive and safe with the currently-live code (it ignores the column).
3. `git push origin master` (auto-deploys; no staging).
4. Wait for the READY production deployment, then `vercel alias set <deployment-url> ys-connection.vercel.app`.
5. Verify: `vercel inspect ys-connection.vercel.app` shows the new deployment; `curl -s https://ys-connection.vercel.app/sw.js | head -1` shows `ysc-v56`; `curl -s -o /dev/null -w "%{http_code}" https://ys-connection.vercel.app/settings` returns 200; log in as admin, confirm Login Activity renders and shows your own just-now login.

---

## BATCH B — phone polish, search, import, deps (approve separately)

### Task 10: Quick-link tiles and landscape nav at phone sizes

**Files:** Modify `public/index.html` (CSS in `<style>`; locate with Grep `quick` / `.nav`/`bottom` for the quick-link tile and nav classes).

- [ ] **Step 1: Reproduce** — serve locally, open at 360x640 and 640x360 (landscape). Confirm the 360px quick-link tiles overflow/crowd and the landscape bottom nav eats a large share of the height (review finding).
- [ ] **Step 2: Fix** — tiles: allow wrapping to 2 columns under `@media (max-width:380px)`; nav: `@media (max-height:500px){ /* shrink nav padding and hide labels, keep 40px+ hit area */ }` using the real class names found in Step 1 (write the concrete rules once the selectors are read; the intent: nav height <= 48px and tile text never clipped).
- [ ] **Step 3: Syntax check + manual re-check at both sizes.**
- [ ] **Step 4: Commit** `git add public/index.html && git commit -m "fix: 360px quick-link tiles wrap; compact nav in landscape"`.

### Task 11: Tap targets, admin tab-bar scroll cue, text floor, tooltip clamp, table wrapper

**Files:** Modify `public/index.html` (CSS + the `.dt` table render near ~3951).

- [ ] **Step 1:** Raise small interactive controls (`.btn-sm`, icon buttons in account rows, chips) to `min-height:40px; min-width:40px` via `@media (pointer:coarse)` so desktop density is unchanged.
- [ ] **Step 2:** Admin tab bar (`const tabs = [...]` ~5135): add a right-edge fade/gradient (`mask-image` or `::after`) so users see that it scrolls; no JS.
- [ ] **Step 3:** Raise any `font-size` below 11px to 11px (`Grep "font-size:(8|9|10)px"`; change each; do not touch 11+).
- [ ] **Step 4:** Tooltip clamp — find the tooltip positioning code (Grep `tooltip`/`.tip`), clamp `left` to `[8, innerWidth - width - 8]`.
- [ ] **Step 5:** Wrap the `.dt` table output in `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch">…</div>` so wide tables scroll inside their card instead of the page.
- [ ] **Step 6:** Syntax check, 375px manual pass over Students, Admin, Health; commit `fix: phone tap targets, scroll cue, 11px text floor, tooltip clamp, table overflow`.

### Task 13: Search inputs — mobile attributes, token matching, debounce

**Files:**
- Modify: `public/index.html` (`_visStudents` ~3917-3930; `studSearch` ~4008; `setArNameFilter` ~3840; inputs at ~3988 and ~3438)
- Create: `src/tests/spa-student-search.test.ts`

**Interfaces:** Produces `_matchesQuery(name: string, q: string): boolean` — trims `q`, lowercases, splits on whitespace, and returns true only if every token is a substring of the lowercased name; empty query matches everything. Consumed by `_visStudents` and the Health name filter.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { extractFn, loadIndexHtml } from './helpers/extract-fn';
const m = new Function(`${extractFn(loadIndexHtml(), '_matchesQuery')}; return _matchesQuery;`)() as (n: string, q: string) => boolean;

describe('student search matching', () => {
  it('matches full name in either order, ignoring case and extra spaces', () => {
    expect(m('Jane Smith', 'jane smith')).toBe(true);
    expect(m('Jane Smith', 'smith jane')).toBe(true);
    expect(m('Jane Smith', '  jane   ')).toBe(true);
  });
  it('requires every token to match', () => { expect(m('Jane Smith', 'jane brown')).toBe(false); });
  it('empty or whitespace-only query matches everything', () => { expect(m('Jane Smith', '')).toBe(true); expect(m('Jane Smith', '   ')).toBe(true); });
  it('does not treat regex characters specially', () => { expect(m('Jane Smith', '.*')).toBe(false); });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**

```js
function _matchesQuery(name, q) {
  const tokens = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const n = String(name || '').toLowerCase();
  return tokens.every(t => n.includes(t));
}
```

Use it in `_visStudents` in place of `includes(q)` (read the function first to match how the name string is built — match against "first last" concatenation). Add a 150ms debounce to `studSearch` and `setArNameFilter` (a module-level `let _searchTimer` per function; clear/re-set the timeout; keep the input's own value update synchronous so typing never lags; and after the debounced re-render restore focus and caret to the input by id, as these functions rebuild `innerHTML`). On both `<input>`s (`#stu-search`, `#ar-name-filter`) add `autocapitalize="off" autocorrect="off" spellcheck="false" autocomplete="off" enterkeyhint="search" aria-label="Search students by name"` (the Health one: `aria-label="Find student"`).

- [ ] **Step 4: Run test + syntax check; manual: type fast in Students search at 375px — no dropped characters, caret stays.**
- [ ] **Step 5: Commit** `fix: student search matches by token, debounced, with mobile-friendly input attributes`.

### Task 14: Clear per-user client state on logout

**Files:** Modify `public/index.html` `doLogout` (~1735-1745).

- [ ] **Step 1:** In `doLogout`, after `_previewStash = null;`, add in a try/catch: `sessionStorage.removeItem('yap_ar_filter'); sessionStorage.removeItem('yap_prayer_filter'); sessionStorage.removeItem('yap_connect_filters'); localStorage.removeItem('yap_leader_id');` — one `try { … } catch (e) {}` containing all four.
- [ ] **Step 2:** Syntax check; manual: set a Health filter, log out, log in as a different account — filter must be reset.
- [ ] **Step 3: Commit** `fix: logout clears remembered filters and leader id (shared-phone leak)`.

### Task 15: Import report row numbers

**Files:**
- Modify: `public/index.html:4794`
- Modify: `src/tests/import.service.test.ts` (only if it asserts the raw index; otherwise no backend change)

`report.skippedRows[].row` is the 0-based data-row index (pushed at `src/services/import.service.ts:343`). Users read it as a spreadsheet row, which is `index + 2` (1-based + header).

- [ ] **Step 1:** Change the template at ~4794 to `Row ${x.row + 2}: ${esc(x.reason)}`. Keep the server value 0-based (other consumers may rely on it).
- [ ] **Step 2:** Syntax check; manual: import a CSV with a known bad row 5 (spreadsheet numbering) and confirm the report says Row 5.
- [ ] **Step 3: Commit** `fix: import report row numbers match spreadsheet rows`.

### Task 16: Import `_importBusy` wedge

**Files:**
- Modify: `public/index.html` `uploadServiceImport` (~4933) and `uploadGroupImport` (~4955)
- Create: `src/tests/spa-import-busy.test.ts`

Bug: `_importBusy = true` is set, then `statusEl.innerHTML = …` runs *outside* the `try`. If `#import-status` is not in the DOM (user navigated away between pick and confirm), that line throws, `finally` never runs, and `_importBusy` stays true until reload.

- [ ] **Step 1: Failing test** — evaluate the real `uploadServiceImport` with `document.getElementById` returning `null` and assert `_importBusy` is false afterwards and a second call is not rejected:

```ts
import { describe, it, expect } from 'vitest';
import { extractFn, loadIndexHtml } from './helpers/extract-fn';

it('uploadServiceImport does not leave _importBusy stuck when #import-status is missing', async () => {
  const html = loadIndexHtml();
  const src = `
    const window = { _pendingServiceRows: [{}] };
    const document = { getElementById: () => null };
    let _importBusy = false, _lastImportReport = null;
    const toast = () => {}, icS = () => '', Cache = { clear() {} };
    const API = { post: async () => ({ studentsAdded: 0, studentsUpdated: 0, sessionsAdded: 0, report: null }) };
    ${extractFn(html, 'uploadServiceImport')}
    return { run: () => uploadServiceImport('f.csv'), busy: () => _importBusy, arm: () => { window._pendingServiceRows = [{}]; } };`;
  const h = new Function(src)() as any;
  await h.run().catch(() => {});
  expect(h.busy()).toBe(false);
  h.arm();
  await h.run().catch(() => {});
  expect(h.busy()).toBe(false);
});
```

- [ ] **Step 2: Run, expect FAIL** (busy stays true).
- [ ] **Step 3: Implement** — in both functions, set `_importBusy = true` and the initial `statusEl.innerHTML = …` **inside** the `try`, and make every `statusEl` write use a tiny null-safe helper placed above them: `function _setImportStatus(html) { const el = document.getElementById('import-status'); if (el) el.innerHTML = html; }`. Remove the up-front `const statusEl = …` lookups. (Add `_setImportStatus` to the test stub's extracted functions.) Keep the `if (_importBusy) { toast(…); return; }` guard before the `try`.
- [ ] **Step 4: Run test + syntax check, expect PASS.**
- [ ] **Step 5: Commit** `fix: import busy flag cannot wedge when the status element is missing`.

### Task 17: Non-breaking express advisory bump

**Files:** `package.json`, `package-lock.json`.

- [ ] **Step 1:** Run `npm audit` and note the express/body-parser/qs findings (express 4.22.2 -> 4.22.3 is the target).
- [ ] **Step 2:** Run `npm audit fix` (**not** `--force`). Inspect `git diff package.json package-lock.json` — only express/body-parser/qs (and their transitive deps) should move, no major-version jumps. If anything else moves, `git checkout package.json package-lock.json` and bump only those three with `npm install express@4.22.3`.
- [ ] **Step 3:** `npm run typecheck && npm run test` — expect all PASS.
- [ ] **Step 4:** Commit `chore: bump express/body-parser/qs for the advisory (non-breaking)`.

### Task 18: Batch B release

**Files:** Modify `public/sw.js` (`ysc-v56` -> `ysc-v57`).

- [ ] **Step 1:** Bump `CACHE` to `ysc-v57`.
- [ ] **Step 2:** `npm run typecheck && npm run test && node scripts/check-spa-syntax.js` — PASS.
- [ ] **Step 3:** Commit `chore: bump SW cache to ysc-v57`.
- [ ] **Step 4: [OWNER GATE]** On explicit yes: `git push origin master`; wait for READY; `vercel alias set <deployment-url> ys-connection.vercel.app`; `vercel inspect ys-connection.vercel.app`; `curl` `sw.js` (expect `ysc-v57`) and `/settings` (200). Then a phone-width smoke test of Home, Students search, Health, Admin -> Import and Login Activity.

---

## Self-Review

**Spec (review) coverage:** Login Activity upgrade (filter+count, grouping, never-first, one-line expandable rows, single-login drill-down, Brisbane+year, pure helpers + tests, leak guard, docs, SW bump) -> Tasks 2, 3, 5, 9. Prayers CSV round-trip -> 4. `_relTime` collision -> 1. 401/boot -> 6. Login-history in new-year snapshot (camp audit lesson) -> 7. SW update check -> 8. Phone fixes (360 tiles, landscape nav, tap targets, scroll cue, 11px floor, tooltip, `.dt` overflow) -> 10, 11. Search attrs/tokens/debounce -> 13. Logout leak -> 14. Import row numbers -> 15, wedge -> 16. Express bump -> 17. Migration-before-deploy + alias procedure -> 9, 18.

**Fixes made during self-review:**
- Task numbering: Task 12 does not exist (Batch A's release is Task 9); numbering skips from 11 to 13 on purpose.
- Task 7 is conditional on reading `applyCohortLayout`; it says to stop and ask rather than guess.
- Tasks 10 and 11 deliberately name *behaviours and measurements* and tell the executor to read the real selectors first; the CSS class names in the SPA were not re-read for this plan, so concrete rules can only be written after Step 1 of each. This is the one place the plan defers code to the executor; it is flagged, not hidden.

**Type/name consistency:** `_laLastMs/_laOrder/_laNotSince/_laGroup/_laFmtBrisbane/_laRelTime` identical across Tasks 1-3 and docs; `_isAuthExpired/_handleAuthExpired` identical in Task 6 test and implementation; `extractFn/loadIndexHtml` signatures defined once (Task 1). `setLaCutoff` / `_laCutoff` used consistently.

**Review Focus coverage:** never-logged-in/undefined/garbage -> Task 2 tests; preview-expiry -> Task 6 test; transient boot error keeps token -> Task 6 tests; import wedge -> Task 16 test; future-dated login -> Task 2 test.

**Known limits (not covered):** real-device touch and safe-area behaviour were not exercised by the review (same-origin iframes only); Tasks 10-11 should be re-checked on an actual phone after Batch B ships.
