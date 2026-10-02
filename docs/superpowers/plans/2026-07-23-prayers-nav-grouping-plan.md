# Prayers Grouping/Filtering + Admin Nav Swap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 5 small Prayers-screen + admin-nav UI changes from `docs/superpowers/specs/2026-07-23-prayers-nav-grouping-design.md`: split the Archive/Delete buttons by prayer status, group prayers by student/creator with a 3-item preview, add Health-style grade/gender filter chips to Prayers, verify the existing general-prayer RBAC scoping still holds, and swap Trends for Admin in the admin bottom nav.

**Architecture:** Everything lives in the single inline `<script>` block of `public/index.html` (no build step — this is a phone-first SPA served straight from Express/Vercel). No backend/API/migration changes anywhere in this plan.

**Tech Stack:** Vanilla JS (ES2019+, no transpile), inline in `public/index.html`. Backend is TS/Express/vitest but untouched here except for re-running existing tests.

## Global Constraints

- No backend, route, schema, or migration changes — every task touches `public/index.html` only, except Task 4 which runs (but does not modify) existing backend tests.
- No new npm dependencies, no new CSS classes — reuse existing `.fc` / `.filter-row` / `.drop` / `.drop-head` / `.drop-chev` / `.drop-body` / `.plist` classes and inline `style=` attributes, matching how the rest of `public/index.html` is written.
- No new icon — the admin nav item keeps `ic:'settings'` (already a gear/cog SVG, see `IC.settings` in `public/index.html`).
- **Verification reality check:** `public/index.html`'s inline JS is NOT covered by `npm run typecheck` (that only runs `tsc` over `src/`) or by `npm run test` (vitest only exercises `src/`). This repo's own convention for this file (see `Project 1 - HTML Ministry Insight/CLAUDE.md`) is a syntax gate via `node --check` on the extracted script. Every task below therefore uses this exact command as its automated verification step, in place of a unit test that doesn't exist for this file:

  ```bash
  awk '/^<script>$/{f=1;next} /^<\/script>$/{f=0} f' public/index.html > "$TMPDIR/index_check.js"
  node --check "$TMPDIR/index_check.js" && echo SYNTAX_OK
  ```
  Confirmed working against the current file before this plan's changes (prints `SYNTAX_OK`). Set `TMPDIR` to any scratch directory you have write access to.
- Baseline (confirmed clean before this plan): `npm run typecheck` → no output/errors. `npm run test` → `Test Files 41 passed (41)`, `Tests 406 passed (406)`. Task 4 and the final task re-check these stay green.
- Manual/deploy-time acceptance checks (listed at the end of the final task) are **not** automated — per this repo's debug.md convention, routine browser verification is skipped by default; these are for you or the user to eyeball after deploying to the Vercel preview/prod, not a blocking gate for each task.

---

### Task 1: Prayer modal — Archive/Delete button split

**Files:**
- Modify: `public/index.html` — function `openPrayerModal`

**Interfaces:**
- Consumes: nothing new (uses the existing `existing` variable already in scope inside `openPrayerModal`, which is the looked-up prayer object with a `.status` field of `'open' | 'answered' | 'archived'`).
- Produces: nothing new — this only changes which of the two existing buttons render.

- [ ] **Step 1: Find the current code**

Run: `grep -n "_deletePrayerConfirm\|_archivePrayer(" public/index.html`

You should see a line defining `deleteBtn` calling `_deletePrayerConfirm('${prayerId}')` and a line defining `archiveBtn` calling `_archivePrayer('${prayerId}')`, both inside `openPrayerModal`. Read that whole function with the `Read` tool to confirm the exact surrounding text before editing (the two `const` statements sit right next to each other, right before the `modal(...)` call).

- [ ] **Step 2: Change the `deleteBtn` gate**

Find this exact block inside `openPrayerModal`:

```js
  const deleteBtn = editing
    ? `<button class="btn btn-secondary btn-sm" id="pr-del-btn" style="color:var(--danger)" onclick="_deletePrayerConfirm('${prayerId}')">Delete</button>`
    : '';
  const archiveBtn = editing && existing.status !== 'archived'
    ? `<button class="btn btn-secondary btn-sm" onclick="_archivePrayer('${prayerId}')">Archive</button>`
    : '';
```

Replace it with:

```js
  const deleteBtn = editing && existing.status === 'archived'
    ? `<button class="btn btn-secondary btn-sm" id="pr-del-btn" style="color:var(--danger)" onclick="_deletePrayerConfirm('${prayerId}')">Delete</button>`
    : '';
  const archiveBtn = editing && existing.status !== 'archived'
    ? `<button class="btn btn-secondary btn-sm" onclick="_archivePrayer('${prayerId}')">Archive</button>`
    : '';
```

Only the `deleteBtn` condition changed (`editing` → `editing && existing.status === 'archived'`). `archiveBtn` is untouched.

- [ ] **Step 3: Syntax-check**

Run (from the repo root, `connection-made-simple/`):

```bash
awk '/^<script>$/{f=1;next} /^<\/script>$/{f=0} f' public/index.html > "$TMPDIR/index_check.js"
node --check "$TMPDIR/index_check.js" && echo SYNTAX_OK
```
Expected: `SYNTAX_OK`.

- [ ] **Step 4: Manual acceptance note (for the end-of-plan deploy check, not blocking now)**

Record for later: opening an **open** or **answered** prayer should show only "Archive" (+ Save/Cancel); opening an **archived** prayer should show only "Delete" (+ Save/Cancel).

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "prayers: only show Delete once a prayer is archived, Archive otherwise"
```

---

### Task 2: Grade/gender filter chips on the Prayers screen

**Files:**
- Modify: `public/index.html` — new module-level state + helper functions near the existing `_arFilter`/`setArFilter` block (search for `let _arFilter = { grade:null, gender:null };` to find the right neighbourhood — put the new prayer-filter code right after `setArNameFilter`, before the `// PRAYERS` section comment, OR directly above `renderPrayers()` inside the existing `// PRAYERS` section — either is fine, keep them together); function `_prayersHtml`; function `boot()`.

**Interfaces:**
- Consumes: `quadGrades(quad)` (existing, returns `[7,8,9]` or `[10,11,12]` or `[]`), `_gradeList()` (existing, returns the full configured grade range e.g. `[7,8,9,10,11,12]`), `S.user` (existing global with `.role`/`.quad`).
- Produces: `_prayerFilter` (module-level `{ grade: number|null, gender: 'male'|'female'|null }`), `savePrayerFilter()`, `restorePrayerFilter()`, `setPrayerFilter(key, val)`, `_prayerPassesFilter(p)` — all consumed by Task 3.

- [ ] **Step 1: Add filter state + helpers**

Find the existing Health filter block (search `let _arFilter = { grade:null, gender:null };`) and add this new block immediately after `restoreArFilter()`'s closing brace (i.e. right after the existing):

```js
function restoreArFilter() {
  try {
    const raw = sessionStorage.getItem('yap_ar_filter');
    if (raw) { const f = JSON.parse(raw); _arFilter.grade = f.grade||null; _arFilter.gender = f.gender||null; }
  } catch {}
}
```

Insert:

```js

// Same single-select grade/gender filter pattern as Health's _arFilter, applied
// to the Prayers screen (item 3/4, 2026-07-23).
let _prayerFilter = { grade: null, gender: null };
function savePrayerFilter() {
  try { sessionStorage.setItem('yap_prayer_filter', JSON.stringify(_prayerFilter)); } catch {}
}
function restorePrayerFilter() {
  try {
    const raw = sessionStorage.getItem('yap_prayer_filter');
    if (raw) { const f = JSON.parse(raw); _prayerFilter.grade = f.grade || null; _prayerFilter.gender = f.gender || null; }
  } catch {}
}
function setPrayerFilter(key, val) {
  _prayerFilter[key] = val;
  savePrayerFilter();
  renderPrayers();
}
// A student-linked prayer passes if its student's grade/gender match the active
// filter. A general (no-student) prayer passes if its createdByGrades/
// createdByGender OVERLAP the filter (null on either axis = "no boundary",
// always passes that axis) — mirrors canAccessGeneralPrayer's own "no boundary"
// semantics (access-control.ts) so the filter behaves consistently with what's
// already visible, it never re-derives visibility.
function _prayerPassesFilter(p) {
  const gr = _prayerFilter.grade, ge = _prayerFilter.gender;
  if (!gr && !ge) return true;
  if (p.studentId != null) {
    if (gr && p.student.grade != gr) return false;
    if (ge && p.student.gender !== ge) return false;
    return true;
  }
  if (gr && Array.isArray(p.createdByGrades) && !p.createdByGrades.includes(gr)) return false;
  if (ge && p.createdByGender && p.createdByGender !== ge) return false;
  return true;
}
```

- [ ] **Step 2: Wire `restorePrayerFilter()` into `boot()`**

Find (near the end of the file):

```js
  restoreConnectFilters();
  restoreArFilter();
```

Replace with:

```js
  restoreConnectFilters();
  restoreArFilter();
  restorePrayerFilter();
```

- [ ] **Step 3: Filter the list and render chips in `_prayersHtml`**

Find the current `_prayersHtml` function:

```js
function _prayersHtml(list) {
  _prayerCache = list || [];
  const open = _prayerCache.filter(p => p.status === 'open');
  const answered = _prayerCache.filter(p => p.status === 'answered');
  const archived = _prayerCache.filter(p => p.status === 'archived');
  const body = _prayerCache.length
    ? _prayerSection('Open', open) + _prayerSection('Answered', answered) +
      (archived.length ? `<div class="drop" id="draw-arch">
        <div class="drop-head" style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:7px 0;border-top:1px solid var(--paper-dark)" onclick="_drop('draw-arch')">
          <span class="drop-chev">${icS('chevd')}</span>
          <div style="flex:1;font-size:13px;font-weight:700">Archived</div>
          <span style="font-size:12px;color:var(--ink-mid)">${archived.length}</span>
        </div>
        <div class="drop-body"><div class="plist">${archived.map(_prayerRow).join('')}</div></div>
      </div>` : '')
    : `<div class="empty">${icEmpty('pray')}<div class="empty-title">No prayer requests yet</div><div class="empty-sub">Tap "Add Prayer" to add one against a student, or mark it general.</div></div>`;
  return `<div class="ph"><div class="ph-title">Prayers</div><div class="ph-sub">Shared across everyone you lead</div></div>
    ${body}
    <button class="pfab" onclick="openPrayerModal()">${icS('plus')} Add Prayer</button>`;
}
```

Replace it with:

```js
function _prayersHtml(list) {
  _prayerCache = list || [];
  const u = S.user;
  const inFilter = _prayerCache.filter(_prayerPassesFilter);
  const open = inFilter.filter(p => p.status === 'open');
  const answered = inFilter.filter(p => p.status === 'answered');
  const archived = inFilter.filter(p => p.status === 'archived');

  // Same chip set Health uses: grade role gets none (already single-scoped),
  // quad gets its own 3 grades, director/admin get every configured grade +
  // gender. See renderAtRisk() for the reference pattern.
  const prGrades = u.role === 'grade' ? [] : u.role === 'quad' ? quadGrades(u.quad) : _gradeList();
  const prGenders = ['director', 'admin'].includes(u.role) ? ['male', 'female'] : [];
  const gChips = prGrades.map(g => `<button class="fc ${_prayerFilter.grade == g ? 'on' : ''}" onclick="setPrayerFilter('grade',${g})">${g}</button>`).join('');
  const dChips = prGenders.map(g => `<button class="fc ${_prayerFilter.gender === g ? 'on' : ''}" onclick="setPrayerFilter('gender','${g}')">${g.charAt(0).toUpperCase() + g.slice(1)}</button>`).join('');
  let filterHtml = '';
  if (prGrades.length) filterHtml += `<div class="filter-row"><span style="font-size:11px;font-weight:700;color:var(--ink-mid)">Grade:</span>${gChips}<button class="fc ${!_prayerFilter.grade ? 'on' : ''}" onclick="setPrayerFilter('grade',null)">All</button></div>`;
  if (prGenders.length) filterHtml += `<div class="filter-row"><span style="font-size:11px;font-weight:700;color:var(--ink-mid)">Gender:</span>${dChips}<button class="fc ${!_prayerFilter.gender ? 'on' : ''}" onclick="setPrayerFilter('gender',null)">All</button></div>`;

  const body = _prayerCache.length
    ? filterHtml + _prayerSection('Open', open) + _prayerSection('Answered', answered) +
      (archived.length ? `<div class="drop" id="draw-arch">
        <div class="drop-head" style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:7px 0;border-top:1px solid var(--paper-dark)" onclick="_drop('draw-arch')">
          <span class="drop-chev">${icS('chevd')}</span>
          <div style="flex:1;font-size:13px;font-weight:700">Archived</div>
          <span style="font-size:12px;color:var(--ink-mid)">${archived.length}</span>
        </div>
        <div class="drop-body"><div class="plist">${archived.map(_prayerRow).join('')}</div></div>
      </div>` : '')
    : `<div class="empty">${icEmpty('pray')}<div class="empty-title">No prayer requests yet</div><div class="empty-sub">Tap "Add Prayer" to add one against a student, or mark it general.</div></div>`;
  return `<div class="ph"><div class="ph-title">Prayers</div><div class="ph-sub">Shared across everyone you lead</div></div>
    ${body}
    <button class="pfab" onclick="openPrayerModal()">${icS('plus')} Add Prayer</button>`;
}
```

Note: `_prayerSection` itself is untouched in this task — it still takes `(title, items)` and renders a flat list; Task 3 changes its signature and internals to group. This step only changes what feeds into it (the pre-filtered arrays) and adds the chip row above it.

- [ ] **Step 4: Syntax-check**

```bash
awk '/^<script>$/{f=1;next} /^<\/script>$/{f=0} f' public/index.html > "$TMPDIR/index_check.js"
node --check "$TMPDIR/index_check.js" && echo SYNTAX_OK
```
Expected: `SYNTAX_OK`.

- [ ] **Step 5: Manual acceptance note**

Record for later: a quad login sees 3 grade chips + "All" on Prayers (its own bracket); a director/admin login sees 6 grade chips + Male/Female chips + "All" each; a grade login sees no chips at all; selecting a chip narrows the Open/Answered/Archived lists to matching students (general prayers stay/hide per Task 3's overlap rule, verified there).

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "prayers: add Health-style grade/gender filter chips"
```

---

### Task 3: Group prayers by student / creator, 3-item preview + expand

**Files:**
- Modify: `public/index.html` — function `_prayerSection` (signature + body change), new functions `_groupPrayers` and `_prayerGroupHtml` and `_prayerGroupsHtml`, and the Archived block inside `_prayersHtml` (from Task 2).

**Interfaces:**
- Consumes: `_prayerFilter`/`_prayerPassesFilter` (Task 2 — already applied before this task's code runs, so every array this task groups is pre-filtered), `_prayerRow(p)` (existing, unchanged, renders one prayer row), `_drop(id)` (existing, toggles `.open` on an element by id), `esc()`/`icS()` (existing escaping/icon helpers).
- Produces: `_groupPrayers(items)` → `Array<{ key, isGeneral, label, grade, prayers, activity }>`; `_prayerGroupHtml(sectionKey, group)` → HTML string for one group card; `_prayerGroupsHtml(sectionKey, items)` → HTML string for all groups in a section. Nothing outside this task calls these except `_prayerSection` and the Archived block, both edited in this same task.

- [ ] **Step 1: Add the grouping helper**

Add this new function right above the existing `_prayerSection` function (search `function _prayerSection(title, items) {` to find it):

```js
// Groups a (pre-filtered) prayer list for one status section. Student-linked
// prayers group by studentId; general (no-student) prayers group by
// createdByLabel — one bucket per creating account, since PrayerRequest has no
// real creator id (see prayer.ts's comment on createdByLabel). General groups
// always sort ahead of student groups; within each band, most-recent-activity
// first (item 2, 2026-07-23 spec).
function _groupPrayers(items) {
  const map = new Map();
  for (const p of items) {
    const isGeneral = p.studentId == null;
    const key = isGeneral ? ('general:' + (p.createdByLabel || 'Unknown')) : ('student:' + p.studentId);
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        isGeneral,
        label: isGeneral ? (p.createdByLabel || 'Unknown') : `${p.student.firstName} ${p.student.lastName || ''}`.trim(),
        grade: isGeneral ? null : p.student.grade,
        prayers: [],
      };
      map.set(key, g);
    }
    g.prayers.push(p);
  }
  const groups = [...map.values()];
  for (const g of groups) {
    g.prayers.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    g.activity = g.prayers.reduce((max, p) => (p.updatedAt > max ? p.updatedAt : max), g.prayers[0].updatedAt);
  }
  groups.sort((a, b) => {
    if (a.isGeneral !== b.isGeneral) return a.isGeneral ? -1 : 1;
    return b.activity.localeCompare(a.activity);
  });
  return groups;
}
// One group's card: header (name/creator + count) + up to 3 most-recent rows +
// a "Show N more" expand (same .drop/_drop() pattern as the outer Archived
// section) when the group has more than 3.
function _prayerGroupHtml(sectionKey, group) {
  const gid = 'pg-' + sectionKey + '-' + group.key.replace(/[^a-zA-Z0-9]/g, '_');
  const shown = group.prayers.slice(0, 3);
  const rest = group.prayers.slice(3);
  const gradeBit = (!group.isGeneral && group.grade != null) ? ` <span style="color:var(--ink-faint);font-weight:400">Yr${group.grade}</span>` : '';
  const headerLabel = group.isGeneral ? `General &mdash; ${esc(group.label)}` : esc(group.label);
  let html = `<div style="margin-bottom:10px">
    <div style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700;padding:6px 0 2px;border-top:1px solid var(--paper-dark)">
      <span style="flex:1">${headerLabel}${gradeBit}</span>
      <span style="font-size:11px;font-weight:400;color:var(--ink-faint)">${group.prayers.length}</span>
    </div>
    <div class="plist">${shown.map(_prayerRow).join('')}</div>`;
  if (rest.length) {
    html += `<div class="drop" id="${gid}">
      <div class="drop-head" style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:5px 0" onclick="_drop('${gid}')">
        <span class="drop-chev">${icS('chevd')}</span>
        <div style="flex:1;font-size:12px;color:var(--ink-mid)">Show ${rest.length} more</div>
      </div>
      <div class="drop-body"><div class="plist">${rest.map(_prayerRow).join('')}</div></div>
    </div>`;
  }
  html += `</div>`;
  return html;
}
function _prayerGroupsHtml(sectionKey, items) {
  return _groupPrayers(items).map(g => _prayerGroupHtml(sectionKey, g)).join('');
}
```

- [ ] **Step 2: Change `_prayerSection` to render groups**

Find:

```js
function _prayerSection(title, items) {
  if (!items.length) return '';
  return `<div class="sh">${esc(title)} <span style="color:var(--ink-faint)">${items.length}</span></div>
    <div class="plist">${items.map(_prayerRow).join('')}</div>`;
}
```

Replace with:

```js
function _prayerSection(sectionKey, title, items) {
  if (!items.length) return '';
  return `<div class="sh">${esc(title)} <span style="color:var(--ink-faint)">${items.length}</span></div>
    ${_prayerGroupsHtml(sectionKey, items)}`;
}
```

- [ ] **Step 3: Update `_prayerSection`'s two call sites and the Archived block, all inside `_prayersHtml`**

Find (inside `_prayersHtml`, written by Task 2):

```js
    ? filterHtml + _prayerSection('Open', open) + _prayerSection('Answered', answered) +
      (archived.length ? `<div class="drop" id="draw-arch">
        <div class="drop-head" style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:7px 0;border-top:1px solid var(--paper-dark)" onclick="_drop('draw-arch')">
          <span class="drop-chev">${icS('chevd')}</span>
          <div style="flex:1;font-size:13px;font-weight:700">Archived</div>
          <span style="font-size:12px;color:var(--ink-mid)">${archived.length}</span>
        </div>
        <div class="drop-body"><div class="plist">${archived.map(_prayerRow).join('')}</div></div>
      </div>` : '')
```

Replace with:

```js
    ? filterHtml + _prayerSection('open', 'Open', open) + _prayerSection('answered', 'Answered', answered) +
      (archived.length ? `<div class="drop" id="draw-arch">
        <div class="drop-head" style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:7px 0;border-top:1px solid var(--paper-dark)" onclick="_drop('draw-arch')">
          <span class="drop-chev">${icS('chevd')}</span>
          <div style="flex:1;font-size:13px;font-weight:700">Archived</div>
          <span style="font-size:12px;color:var(--ink-mid)">${archived.length}</span>
        </div>
        <div class="drop-body">${_prayerGroupsHtml('archived', archived)}</div>
      </div>` : '')
```

Three changes: `_prayerSection('Open', open)` → `_prayerSection('open', 'Open', open)`, `_prayerSection('Answered', answered)` → `_prayerSection('answered', 'Answered', answered)`, and the archived `.drop-body`'s inner `<div class="plist">${archived.map(_prayerRow).join('')}</div>` → `${_prayerGroupsHtml('archived', archived)}` (the outer Archived `.drop`/count/header stays exactly as-is — only its inner content becomes grouped).

- [ ] **Step 4: Syntax-check**

```bash
awk '/^<script>$/{f=1;next} /^<\/script>$/{f=0} f' public/index.html > "$TMPDIR/index_check.js"
node --check "$TMPDIR/index_check.js" && echo SYNTAX_OK
```
Expected: `SYNTAX_OK`.

- [ ] **Step 5: Manual acceptance note**

Record for later: a student with 4+ prayers in one section shows 3 rows + "Show 1 more" (or however many remain); clicking it reveals the rest via the same expand animation/chevron as the Archived section. A General prayer's card header reads "General — `<label>`". Multiple general-prayer creators visible to the same viewer produce multiple General cards, all above every student card, ordered most-recent-first among themselves.

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "prayers: group Open/Answered/Archived by student (or creator for General)"
```

---

### Task 4: Verify general-prayer RBAC scoping is unaffected

**Files:**
- Read only (no modifications expected): `src/services/access-control.ts` (`canAccessGeneralPrayer`, `generalPrayerCreatorScope`), `src/services/prayer.service.ts` (`list()`), `src/tests/prayer.access-control.test.ts`, `src/tests/prayer.service.test.ts`.

**Interfaces:** none — this task produces a verification result, not code.

- [ ] **Step 1: Re-run the two RBAC-relevant test files**

```bash
npm run test -- src/tests/prayer.access-control.test.ts src/tests/prayer.service.test.ts
```
Expected (this was the confirmed baseline before Tasks 1–3, and nothing in this plan touches backend files, so it must be identical after):
```
 Test Files  2 passed (2)
      Tests  32 passed (32)
```

- [ ] **Step 2: Confirm the specific cross-scope-denied case is covered**

Run: `grep -n "different grade\|different gender\|non-overlapping bracket" src/tests/prayer.access-control.test.ts`

You should see assertions like `canAccessGeneralPrayer(G9M, [9], 'female')` → `false` ("same grade, different gender") and `canAccessGeneralPrayer(G8M, [9], 'female')` → `false` ("different grade") — i.e. a grade-9-female-created general prayer is confirmed denied to a grade-9-male and to a grade-8-male viewer. This is the exact scenario the user asked to double-check ("a general prayer created by a grade 9 account couldn't be seen by a different grade/gender account"). If these assertions are present and passing, no code change is needed — the frontend grouping/filter in Tasks 2–3 only ever operates on whatever `/prayers` already returned, so it cannot widen what a viewer sees.

- [ ] **Step 3: If (and only if) a real gap is found**

If Step 2's grep comes back empty or the described case isn't actually asserted, stop and report back before writing any fix — this plan assumes the existing coverage holds (confirmed while writing this plan) and does not include a backend code change. Do not silently patch `access-control.ts` as part of this task.

- [ ] **Step 4: No commit needed for this task**

This task is verification-only; nothing to `git add`. If Step 1 or Step 2 surface a genuine gap, that becomes new scope to raise with the user, not something to fix inline here.

---

### Task 5: Admin nav — swap Trends for Admin (far right), rename to "Admin"

**Files:**
- Modify: `public/index.html` — function `navItems()` (the `admin` role branch only), and the Home quick-action tile filter (search `quickActionItems().filter(x => !(u.role === 'grade' && x.id === 'trends'))`).

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — this only reorders/relabels existing nav item objects and extends an existing filter predicate. `bottomNavItems()` (`= navItems().slice(0,5)`) and `quickActionItems()` (`= navItems().slice(5)`) are unchanged functions — they automatically reflect the new order.

- [ ] **Step 1: Reorder + relabel the admin branch of `navItems()`**

Find (search `if (u.role === 'admin') return [` — it's preceded by a comment `// Admin: Home | Health | Trends | Connect Setup + quick actions`):

```js
  // Admin: Home | Health | Trends | Connect Setup + quick actions
  if (u.role === 'admin') return [
    { id:'home',       ic:'home',     label:'Home',              mbl:'Home' },
    { id:'at-risk',    ic:'heart',    label:'Health',            mbl:'Health' },
    { id:'prayers',    ic:'pray',     label:'Prayers',           mbl:'Prayers' },
    { id:'trends',     ic:'chart',    label:'Trends',            mbl:'Trends' },
    { id:'leaders',    ic:'arrr',     label:'Setup',              mbl:'Setup' },
    { id:'students',   ic:'id',       label:'Student Search',    mbl:'Student Search' },
    { id:'my-students',ic:'users',    label:'My Connections',    mbl:'<span class="ni-lbl"><span>My</span><span style="opacity:.75;font-size:7.5px">Connections</span></span>' },
    { id:'import',     ic:'upload',   label:'Import',            mbl:'Import' },
    { id:'admin',      ic:'settings', label:'Admin Settings',     mbl:'Settings' },
    ...(caOn ? [caItem] : []), /*CA-HOOK*/
    { id:'birthdays',  ic:'cake',     label:'Upcoming Birthdays',mbl:'Birthdays' },
  ];
```

Replace with:

```js
  // Admin: Home | Health | Prayers | Setup | Admin (2026-07-23: Admin replaced
  // Trends as the 5th/far-right bottom-nav slot; Trends dropped to a sub-page,
  // reachable via the Home hero "Trends" pill like it already is for grade —
  // see quickActionItems' filter below).
  if (u.role === 'admin') return [
    { id:'home',       ic:'home',     label:'Home',              mbl:'Home' },
    { id:'at-risk',    ic:'heart',    label:'Health',            mbl:'Health' },
    { id:'prayers',    ic:'pray',     label:'Prayers',           mbl:'Prayers' },
    { id:'leaders',    ic:'arrr',     label:'Setup',              mbl:'Setup' },
    { id:'admin',      ic:'settings', label:'Admin',             mbl:'Admin' },
    { id:'trends',     ic:'chart',    label:'Trends',            mbl:'Trends' },
    { id:'students',   ic:'id',       label:'Student Search',    mbl:'Student Search' },
    { id:'my-students',ic:'users',    label:'My Connections',    mbl:'<span class="ni-lbl"><span>My</span><span style="opacity:.75;font-size:7.5px">Connections</span></span>' },
    { id:'import',     ic:'upload',   label:'Import',            mbl:'Import' },
    ...(caOn ? [caItem] : []), /*CA-HOOK*/
    { id:'birthdays',  ic:'cake',     label:'Upcoming Birthdays',mbl:'Birthdays' },
  ];
```

Note what changed: `leaders` moved up before `admin`; `admin`'s `label`/`mbl` changed from `'Admin Settings'`/`'Settings'` to `'Admin'`/`'Admin'`; `trends` moved out of the first 5 into the tail (right after `admin`). `bottomNavItems()` (first 5) is now `[home, at-risk, prayers, leaders, admin]` — Admin is the 5th/far-right slot. `quickActionItems()` (everything after) now starts with `trends` — handled in the next step so it doesn't show as a Home tile.

- [ ] **Step 2: Extend the existing Home-tile filter to also hide Trends for admin**

Find (inside the Home render function — search for the exact string below; it's the line right after the comment `// Grade: Trends now lives in the hero banner...`):

```js
    const qa = quickActionItems().filter(x => !(u.role === 'grade' && x.id === 'trends'));
```

Replace with:

```js
    const qa = quickActionItems().filter(x => !((u.role === 'grade' || u.role === 'admin') && x.id === 'trends'));
```

This is the exact same mechanism already used to keep Trends off the grade role's Home tiles (it still has its own hero-banner shortcut pill) — now admin gets the same treatment. Nothing else on Home needs to change: the hero `trendsPill` (search `const trendsPill =`) already renders unconditionally for every role, admin included.

- [ ] **Step 3: Syntax-check**

```bash
awk '/^<script>$/{f=1;next} /^<\/script>$/{f=0} f' public/index.html > "$TMPDIR/index_check.js"
node --check "$TMPDIR/index_check.js" && echo SYNTAX_OK
```
Expected: `SYNTAX_OK`.

- [ ] **Step 4: Full backend regression + final manual acceptance checklist**

Run:
```bash
npm run typecheck
npm run test
```
Expected: typecheck exits with no output/errors; test prints `Test Files  41 passed (41)` and `Tests  406 passed (406)` (identical to the plan's baseline — nothing in Tasks 1, 2, 3, or 5 touches any `src/` file, so these numbers should not move; Task 4 only re-ran a subset already counted in this total).

Manual/deploy-time acceptance checklist (run once against the Vercel preview or after merging, per this repo's "don't browser-verify by default, but do it for something this visible" convention — ask the user before spinning up the Chrome extension, per debug.md):
- [ ] Admin's bottom nav (mobile width) shows, left to right: Home, Health, Prayers, Setup, Admin (cog icon) — no Trends tab.
- [ ] Admin's Home screen quick-action tiles no longer include "Admin Settings"/"Admin", and also no longer include a Trends tile.
- [ ] Admin can still reach Trends via the "Trends" pill in the Home hero banner.
- [ ] Director's nav is unchanged (still has Trends in its bottom nav, no Admin item).
- [ ] On Prayers: an open/answered prayer's edit modal shows only Archive; an archived one shows only Delete.
- [ ] On Prayers: a student with 4+ prayers in a section shows a 3-row preview + "Show N more".
- [ ] On Prayers: quad login sees a 3-grade + All filter; director/admin sees 6-grade + gender + All; grade login sees no filter row.
- [ ] On Prayers: a general prayer created by a grade 9 girls account does not appear for a grade 9 boys or grade 8 girls login, with or without a filter selected.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "admin nav: swap Trends for Admin as the far-right bottom-nav slot"
```

---

## Self-Review

**Spec coverage:**
1. Archive/Delete split → Task 1. ✅
2. Grouping by student/creator, 3-preview + expand, General pinned to top → Task 3 (state feeding it built in Task 2). ✅
3 & 4. Grade (quad)/grade+gender (director/admin) filter chips on Prayers → Task 2. ✅
   - General-groups-hidden-unless-overlapping-filter decision → `_prayerPassesFilter` in Task 2. ✅
5. Admin nav swap (Admin far right, cog icon, "Admin" label; Trends off bottom nav and off Home tiles, reachable via hero pill) → Task 5. ✅
RBAC verification for general prayers → Task 4. ✅
Out-of-scope items (no backend/migration/icon changes) → respected across all 5 tasks. ✅

**Placeholder scan:** no TBD/TODO; every step shows the literal before/after code or an exact command with its expected output; no "similar to Task N" shorthand — Tasks 2 and 3 both show the full function bodies they produce, not a diff description.

**Type consistency:** `_prayerFilter` (Task 2) is read by `_prayerPassesFilter` (Task 2) and by the chip `onclick`s in `_prayersHtml` (Task 2) — same shape throughout (`{grade, gender}`). `_prayerSection`'s signature changes from `(title, items)` (as it ships at the end of Task 2) to `(sectionKey, title, items)` (Task 3) — both of Task 3's call-site edits (`'Open'`→`'open','Open'`, `'Answered'`→`'answered','Answered'`) match the new 3-arg signature. `_groupPrayers`/`_prayerGroupHtml`/`_prayerGroupsHtml` names are used consistently between where they're defined (Task 3 Step 1) and where they're called (Task 3 Steps 2–3). `navItems()`'s admin-branch `id`s (`home`, `at-risk`, `prayers`, `leaders`, `admin`, `trends`, `students`, `my-students`, `import`, `birthdays`) are unchanged strings throughout Task 5 — only order/labels move, matching every other place in the file that dispatches on these same `id` strings (e.g. `render()`'s `p==='trends'` branch, untouched).
