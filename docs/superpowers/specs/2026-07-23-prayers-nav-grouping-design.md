# Prayers grouping/filtering + admin nav swap — design spec

> **Status:** approved design (2026-07-23). Five small, mostly-independent UI tweaks bundled into
> one spec because they were requested together and none needs its own plan/branch cycle.
> Deploys straight to `master` per this repo's normal workflow (no PR gate).

## Summary

1. Prayers screen: the edit-prayer modal shows **only Archive** for an open/answered prayer, and
   **only Delete** once a prayer is archived (currently both buttons always show together).
2. Prayers screen: each of the Open / Answered / Archived sections **groups multiple prayers for
   the same student** into one card, previewing the 3 most recent with an expand toggle for the
   rest. General (no-student) prayers group **per creating account**, pinned above the student
   groups.
3. & 4. Prayers screen gains the same grade-filter-chip pattern already used on Health/Connect
   Setup: quad logins get a 3-grade + "All" toggle (their own bracket); director/admin get a
   6-grade + gender + "All" toggle (same as Health). Grade-role logins get no chips (already
   single-scoped).
5. Admin's bottom nav swaps `Trends` out for `Admin` (renamed from "Admin Settings", same cog
   icon), placed as the 5th (far-right) slot. `Admin` is removed from the Home quick-action tile
   grid. `Trends` gets no replacement tile — admin still reaches it via the existing Home
   hero-banner shortcut pill (unchanged, already rendered for every role).

## 1. Archive/Delete split (`openPrayerModal`, public/index.html)

Current (`~line 3467`):
```js
const deleteBtn = editing
  ? `<button ... onclick="_deletePrayerConfirm('${prayerId}')">Delete</button>`
  : '';
const archiveBtn = editing && existing.status !== 'archived'
  ? `<button ... onclick="_archivePrayer('${prayerId}')">Archive</button>`
  : '';
```
Change `deleteBtn`'s condition to `editing && existing.status === 'archived'`. `archiveBtn` is
unchanged. No backend change — `_deletePrayer`/`_archivePrayer` and their routes are untouched.

## 2. Grouping prayers by student/creator

Scope: `_prayerSection()` / `_prayersHtml()`. Each of Open, Answered, Archived groups its prayers
before rendering:

- **Group key:** `studentId` for a student-linked prayer; `` `general:${createdByLabel}` `` for a
  general one (`studentId == null`) — one bucket per distinct label among the general prayers
  this viewer can already see (server-side `canAccessGeneralPrayer` scoping is unchanged and
  untouched by this work — see "RBAC verification" below).
- **Group order:** General group(s) first, then student groups. Within each of those two bands,
  sort by most-recent activity (`max(updatedAt)` across the group's prayers) descending — reuses
  the existing `createdAt`/`updatedAt` fields, no new derived data needed.
- **Card contents:** group header = student name (+ grade, reusing existing meta styling) or
  "General — `<createdByLabel>`"; body = existing `_prayerRow()` markup for the 3 most recent
  prayers in the group. If the group has more than 3, append a "Show N more" toggle using the
  same `.drop`/`_drop(id)` collapsible pattern already used for the Archived section wrapper —
  each group needs a unique id (e.g. `` `pg-${sectionKey}-${groupKey}` ``).
- **Section header count** stays a total prayer count (not a group count) — no behaviour change
  there, just re-reads as "N total across however many groups."
- Nesting note: the Archived section is itself already a `.drop` (`draw-arch`). Its inner groups
  each get their own `.drop` id, which is fine — `_drop()` toggles by id, and ids won't collide
  across sections since each includes the section key.

### RBAC verification (no code change expected)

`canAccessGeneralPrayer()`/`generalPrayerCreatorScope()` (`access-control.ts`) already gate which
general prayers reach a given actor at all — a grade 9 account's general prayers are invisible to
a different grade/gender account, and this has dedicated coverage in
`prayer.access-control.test.ts`. Grouping is a pure display change on top of whatever the server
already returned, so it can't widen visibility. Before calling this item done: re-run
`prayer.access-control.test.ts` + `prayer.service.test.ts` to confirm that coverage is still green
and still exercises the general-prayer cross-scope-denied cases — do not re-derive the scoping
logic client-side.

## 3 & 4. Grade/gender filter chips on Prayers

Mirror `renderAtRisk()`'s existing `_arFilter` pattern exactly (`public/index.html`, ~line 3282):

- New module state `_prayerFilter = { grade: null, gender: null }`, persisted to
  `sessionStorage` the same way `_arFilter`/`saveArFilter`/`restoreArFilter` are (new
  `savePrayerFilter`/`restorePrayerFilter`, or generalize the existing pair — implementer's call,
  keep it simple).
- Chip sets computed the same way Health does:
  `arGrades = u.role==='grade' ? [] : u.role==='quad' ? quadGrades(u.quad) : _gradeList()`,
  `arGenders = ['director','admin'].includes(u.role) ? ['male','female'] : []`.
- Render the same `filter-row`/`fc` chip markup + explicit "All" pill as Health, above the
  Open/Answered/Archived sections.
- **Filtering logic:** a student group is shown iff its student's `grade`/`gender` pass the active
  filter (same `==`/`===` comparisons as `renderAtRisk`). A general group is shown iff its
  `createdByGrades`/`createdByGender` **overlap** the active filter (per the earlier decision to
  keep General consistent with everything else the chips narrow) — i.e. skip it when a grade
  filter is set and the group's `createdByGrades` is non-null and doesn't include that grade, or
  a gender filter is set and the group's `createdByGender` is non-null and differs. A group whose
  `createdByGrades`/`createdByGender` is `null` (no boundary — admin/director-created, or a
  pre-scoping-migration row) always passes, same "no boundary" semantics as the backend.

## 5. Admin nav swap

`navItems()`'s admin branch (`public/index.html`, ~line 1558):

- Reorder so the first 5 (bottom nav via `bottomNavItems()` = `.slice(0,5)`) are:
  `home, at-risk, prayers, leaders, admin` — i.e. drop `trends` out of the first 5, and move
  `leaders` ("Setup") ahead of `admin` so `admin` lands in slot 5 (far right).
- The `admin` entry's `label` changes from `'Admin Settings'` to `'Admin'` (desktop `.desk-nav`
  reads `label`; keep the cog icon, `ic:'settings'` — that key is already a gear/cog glyph, no new
  icon needed). Set `mbl` to `'Admin'` too (was `'Settings'`) so mobile bottom nav and desktop nav
  read the same word.
- `trends` moves later in the array (after `admin`, wherever reads naturally — order among the
  non-bottom-nav items only affects `.desk-nav`'s full list and is not otherwise significant).
- `admin` is **removed** from `quickActionItems()`'s effective output (i.e. no longer appears as
  a Home-screen quick-action tile) simply because it's no longer past index 4.
- No tile replaces `trends` on Home — admin already has the existing hero-banner "Trends"
  shortcut pill (`trendsPill`, ~line 2003), which renders for every role including admin.
- Director's nav branch is untouched (no `admin` item there to begin with).

## Out of scope / explicitly not doing

- No backend/API changes anywhere in this batch — everything is `public/index.html` display
  logic plus (for item 2) a verification-only pass over existing prayer RBAC tests.
- No change to `canAccessGeneralPrayer`/`generalPrayerCreatorScope` or any migration.
- No new IC icon — `settings` key is reused as-is.
- No change to Connect Setup's or Health's own filter chips (they're the reference pattern being
  copied, not being modified).

## Testing

- `npm run typecheck` + `npm run test` (existing 208+ suite, including
  `prayer.access-control.test.ts`/`prayer.service.test.ts` for the RBAC verification above) must
  stay clean — no new backend logic means no new backend tests are expected, but if the grouping
  needs any pure helper extracted into a `.ts` file (unlikely, this is all inline SPA JS like the
  rest of `public/index.html`), add unit coverage for it the same way `terms.ts`/`atrisk.service.ts`
  are tested.
- Manual/deploy-time check (per this repo's usual convention of skipping routine browser
  verification): confirm in prod after deploy that (a) an admin's bottom nav shows Admin at the
  far right with no Trends tab, admin's Home tiles no longer show Admin Settings, (b) the Prayers
  screen groups correctly for a quad and a director/admin login with the grade chips exercised,
  (c) a general prayer created by one grade account doesn't appear in another grade/gender
  account's Prayers screen.
