# Upcoming Birthdays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Upcoming Birthdays" screen, reachable from a Home quick-action button on the grade login, listing every in-scope student whose birthday falls within the next two months.

**Architecture:** Pure client-side feature in the single-file SPA `public/index.html`. Reuses the existing role-scoped `GET /students` (already returns `dateOfBirth`); no backend change, no new endpoint. Two pure date helpers do the next-occurrence/window math; one render function groups and displays the results; one nav entry + route + icon wire it into the grade login.

**Tech Stack:** Vanilla-JS SPA (`public/index.html`), Express/TypeScript backend (untouched here). Verification: `npm run typecheck`, a `node` sanity check for the date logic, and a manual run.

## Global Constraints

- **All changes are in `public/index.html`.** No backend, no new API route, no new vitest files (the SPA's inline JS is not covered by the vitest harness, which only includes `src/tests/**`).
- **Scope = the grade login's own role scope (grade + gender).** Source data is `GET /students`, which the backend already scopes; no RBAC change. Do NOT use the leader summary (the screen is independent of the self-identified leader).
- **No emoji or Unicode symbol characters anywhere in the SPA** — icons are inline SVG via the `IC` registry; labels are plain ASCII.
- **Escape user data:** wrap student names in the global `esc()` before interpolating into `innerHTML`.
- **Window:** today through `today + 2 calendar months`, inclusive. A birthday today is included; a birthday that already passed this year rolls to next year and so falls outside the window.
- **Cache/spinner pattern:** use `_allCached('/students')` — render immediately when cached, spinner only on a cold fetch (matches the other screens).

---

### Task 1: Date helpers (`_nextBirthday`, `_fmtUpcoming`)

The next-occurrence + window math is the only non-trivial logic. Implement it as two pure functions and verify with a standalone `node` script (the SPA cannot be imported into vitest).

**Files:**
- Modify: `public/index.html` — add both functions immediately after `fmtBday` (currently `public/index.html:2155`).

**Interfaces:**
- Produces:
  - `_nextBirthday(dob: string|null, today: Date): Date | null` — the next on/after-`today` occurrence of the birthday (month+day, year ignored), at local midnight; `null` for missing/malformed input.
  - `_fmtUpcoming(date: Date): { weekday: string, day: number, month: string, monthName: string }` — display parts, e.g. `{ weekday:'Fri', day:3, month:'Jul', monthName:'July' }`.

- [ ] **Step 1: Add the two helpers**

In `public/index.html`, find `fmtBday` (at `public/index.html:2155`):

```js
function fmtBday(iso) {
```

Immediately BEFORE that line, insert:

```js
// Next on/after-`today` occurrence of a birthday (month+day; birth year ignored).
// Returns a Date at local midnight, or null for missing/invalid input. A Feb-29
// birthday in a non-leap year rolls to Mar 1 (JS Date normalisation) — acceptable.
function _nextBirthday(dob, today) {
  if (!dob) return null;
  const p = String(dob).slice(0, 10).split('-');
  if (p.length !== 3) return null;
  const month = Number(p[1]), day = Number(p[2]);
  if (!month || !day) return null;
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let when = new Date(base.getFullYear(), month - 1, day);
  if (when < base) when = new Date(base.getFullYear() + 1, month - 1, day);
  return when;
}
// Display parts for an upcoming-birthday Date. Fixed name arrays (no locale dep).
function _fmtUpcoming(date) {
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return { weekday: WD[date.getDay()], day: date.getDate(), month: MON[date.getMonth()], monthName: FULL[date.getMonth()] };
}
```

- [ ] **Step 2: Verify the date logic with a node sanity check**

Run this exact command (it re-declares the same logic and asserts the window/wrap/age behaviour):

```bash
node -e '
function _nextBirthday(dob, today){ if(!dob)return null; const p=String(dob).slice(0,10).split("-"); if(p.length!==3)return null; const month=Number(p[1]),day=Number(p[2]); if(!month||!day)return null; const base=new Date(today.getFullYear(),today.getMonth(),today.getDate()); let when=new Date(base.getFullYear(),month-1,day); if(when<base)when=new Date(base.getFullYear()+1,month-1,day); return when; }
function inWindow(dob, today){ const nb=_nextBirthday(dob,today); if(!nb)return false; const cap=new Date(today.getFullYear(),today.getMonth()+2,today.getDate()); return nb<=cap; }
const T=new Date(2026,5,22); // 2026-06-22
const A=(name,got,exp)=>console.log((got===exp?"PASS":"FAIL")+" "+name+" -> "+got+(got===exp?"":" (expected "+exp+")"));
A("Jul 3 in window", inWindow("2009-07-03",T), true);
A("today included", inWindow("2010-06-22",T), true);
A("yesterday excluded (rolls a year)", inWindow("2010-06-21",T), false);
A("Sep 1 outside 2mo", inWindow("2010-09-01",T), false);
A("null -> not in window", inWindow(null,T), false);
A("malformed -> not in window", inWindow("nope",T), false);
const wrap=new Date(2026,11,15); // 2026-12-15
A("year wrap Jan 5 in window", inWindow("2011-01-05",wrap), true);
const nb=_nextBirthday("2009-07-03",T);
A("age turns 17", nb.getFullYear()-2009, 17);
'
```

Expected: every line prints `PASS`.

- [ ] **Step 3: Typecheck (sanity — HTML is not typechecked but confirms the build is intact)**

Run: `npm run typecheck`
Expected: exits 0 (note: an unrelated, untracked `src/tests/connection-audit.service.test.ts` from separate in-progress work may cause a tsc error — that is pre-existing and NOT part of this change; if present, confirm the error is ONLY in that file).

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: add next-birthday + upcoming-date helpers"
```

---

### Task 2: Upcoming Birthdays screen, icon, nav & route

Add the render function, a calendar/cake icon, the grade-login quick-action entry, and the route. After this task the feature works end-to-end for a grade login.

**Files:**
- Modify: `public/index.html` —
  - `IC` registry: add a `cake` icon before the closing `};` (registry at `public/index.html:779-808`).
  - `navItems()` grade branch: add the quick action (block at `public/index.html:817-826`).
  - `render()` router: add the `birthdays` route (router at `public/index.html:910-921`).
  - add `renderUpcomingBirthdays()` (place it next to the date helpers added in Task 1).

**Interfaces:**
- Consumes (all already present): `_nextBirthday`, `_fmtUpcoming` (Task 1); `_allCached`, `setApp`, `shell`, `API`, `esc`, `phoneLink`, `icEmpty` (existing helpers).
- Produces: page id `birthdays` → `renderUpcomingBirthdays()`; grade quick action `{ id:'birthdays', ic:'cake', ... }`; `IC.cake`.

- [ ] **Step 1: Add the `cake` icon to the IC registry**

In `public/index.html`, the `IC` object ends at `public/index.html:808`:

```js
  bell:     '<path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>',
};
```

Replace it with (adds `cake` before the closing brace):

```js
  bell:     '<path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>',
  cake:     '<path d="M20 21v-8a2 2 0 00-2-2H6a2 2 0 00-2 2v8"/><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1"/><line x1="2" y1="21" x2="22" y2="21"/><line x1="7" y1="8" x2="7" y2="11"/><line x1="12" y1="8" x2="12" y2="11"/><line x1="17" y1="8" x2="17" y2="11"/>',
};
```

- [ ] **Step 2: Add the grade-login quick action**

In `public/index.html`, the grade branch of `navItems()` (`public/index.html:817-826`) currently ends:

```js
    // quick actions:
    { id:'trends',     ic:'chart',    label:'Trends',            mbl:'Trends' },
    { id:'students',   ic:'id',       label:'Student Search',    mbl:'Student Search' },
    { id:'notifications', ic:'bell',  label:'Notifications',     mbl:'Alerts' },
  ];
```

Replace that block with (inserts `birthdays` as a quick action before notifications):

```js
    // quick actions:
    { id:'trends',     ic:'chart',    label:'Trends',            mbl:'Trends' },
    { id:'students',   ic:'id',       label:'Student Search',    mbl:'Student Search' },
    { id:'birthdays',  ic:'cake',     label:'Upcoming Birthdays',mbl:'Birthdays' },
    { id:'notifications', ic:'bell',  label:'Notifications',     mbl:'Alerts' },
  ];
```

(Only the grade branch changes — quad/admin/director branches are left as-is, so the screen is grade-login only. Because it sits at index ≥ 4 it renders as a Home quick-action tile + desktop nav link, never in the 4-item bottom nav.)

- [ ] **Step 3: Route the new page**

In `public/index.html`, the `render()` router (`public/index.html:910-921`) contains:

```js
  else if (p==='import') await renderImport();
```

Immediately AFTER that line, add:

```js
  else if (p==='birthdays') await renderUpcomingBirthdays();
```

- [ ] **Step 4: Add `renderUpcomingBirthdays()`**

In `public/index.html`, immediately AFTER the `_fmtUpcoming` function added in Task 1 (and before `fmtBday`), insert:

```js
async function renderUpcomingBirthdays() {
  if (!_allCached('/students')) setApp(shell('<div class="loading"><div class="spin"></div></div>'));
  let students = [];
  try { students = await API.get('/students'); } catch {}

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cap = new Date(today.getFullYear(), today.getMonth() + 2, today.getDate());

  // Everyone in scope with a birthday between today and +2 months, soonest first.
  const upcoming = [];
  for (const s of (students || [])) {
    const when = _nextBirthday(s.dateOfBirth, today);
    if (when && when <= cap) upcoming.push({ s, when });
  }
  upcoming.sort((a, b) => a.when - b.when);

  let body = `<div class="ph"><div class="ph-title">Upcoming Birthdays</div><div class="ph-sub">Next 2 months</div></div>`;

  if (!upcoming.length) {
    body += `<div class="empty">${icEmpty('cake')}<div class="empty-title">No birthdays in the next 2 months</div></div>`;
    setApp(shell(body));
    return;
  }

  // Group rows under a month header (window spans at most two/three month names).
  let curKey = '';
  for (const { s, when } of upcoming) {
    const f = _fmtUpcoming(when);
    const key = when.getFullYear() + '-' + when.getMonth();
    if (key !== curKey) { curKey = key; body += `<div class="sh">${f.monthName}</div>`; }
    const birthYear = Number(String(s.dateOfBirth).slice(0, 4));
    const turns = birthYear > 1900 ? when.getFullYear() - birthYear : null;
    const phone = s.mobile || s.parentPhone;
    body += `<div class="li">
      <div class="li-body">
        <div class="li-title">${esc(s.firstName)} ${esc(s.lastName)}</div>
        <div class="li-sub">Yr ${s.grade || '—'} · ${s.gender}${turns != null ? ' · turns ' + turns : ''}</div>
        ${phone ? `<div style="font-size:12px;margin-top:4px;color:var(--ink-mid)" onclick="event.stopPropagation()">${s.mobile ? `<span style="font-weight:600">Mobile:</span> ${phoneLink(s.mobile)}` : ''}${s.mobile && s.parentPhone ? ' · ' : ''}${s.parentPhone ? `<span style="font-weight:600">Parent:</span> ${phoneLink(s.parentPhone)}` : ''}</div>` : ''}
      </div>
      <div class="li-right" style="text-align:right">
        <div style="font-weight:800;font-size:14px">${f.day} ${f.month}</div>
        <div style="font-size:11px;color:var(--ink-faint)">${f.weekday}</div>
      </div>
    </div>`;
  }
  setApp(shell(body));
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exits 0 (modulo the unrelated pre-existing `connection-audit.service.test.ts` tsc error noted in Task 1, Step 3).

- [ ] **Step 6: Manual verification**

```bash
PERSISTENCE=memory PORT=4325 npm run start
```

In the browser at `http://localhost:4325`:
1. Log in as `grade9g@youth.ministry` / `demo1234`.
2. On **Home**, confirm an **Upcoming Birthdays** tile appears in the Quick Actions grid (and in the desktop side nav), and is NOT in the bottom nav.
3. Tap it → the **Upcoming Birthdays** screen renders. With the seed data (no birthdays loaded) it shows the empty state "No birthdays in the next 2 months." (A populated list requires imported DOB data; the date/window math is already proven by Task 1's node check.)
4. Confirm no console errors.

Stop the server when done.

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat: Upcoming Birthdays screen on grade login (Home quick action)"
```

---

## Self-Review

**Spec coverage:**
- New screen "Upcoming Birthdays" → Task 2 (`renderUpcomingBirthdays`). ✓
- Grade-login Home quick-action button → Task 2 Step 2 (grade `navItems` only). ✓
- Next 2 months from today → Task 1 (`_nextBirthday` + cap = today+2mo), node-verified. ✓
- All members of the grade, independent of self-identified leader → reads `GET /students` (role-scoped, not leader summary). ✓
- Login's own gender scope, no RBAC change → `/students` already enforces it. ✓
- No emoji / SVG icon → `IC.cake` added (stroke SVG); labels ASCII. ✓
- Sorted, month-grouped, name + date + "turns N" + tap-to-call, empty state → Task 2 Step 4. ✓

**Placeholder scan:** none — every step has concrete code/commands.

**Type/name consistency:** `_nextBirthday`/`_fmtUpcoming` signatures and the `{weekday,day,month,monthName}` shape match between Task 1 and their use in Task 2. Icon key `cake`, page id `birthdays`, and nav `id:'birthdays'` are consistent across Steps 1-4.
