# October rework review: R4 edge cases

Reviewer R4 (plan Lane R, row R4). Branch `feat/oct-rework` at `720a0bc`, read against `master...feat/oct-rework`.
Read-only. `npx tsc --noEmit` is clean. `settings.service`, `spa-oct-simple-logins` and `spa-oct-prayers-bus` tests
pass (82 tests). Accepted items (ledger 9, 10, 14) are not findings.

Counts: **Critical 0 · Important 3 · Minor 11**

---

## Important

### I1. Grade 6 plus Simple logins leaves grade-6 students with no login except admin and director
- **Where:** `src/services/access-control.ts:213-219` (quad `canAccessGrade` is 7–9 / 10–12 only),
  `src/services/access-control.ts:244-248` (`quadGradesOf`), `src/core/types/enums.ts:31-37` (`computeQuad`
  returns null for grade 6), `src/services/settings.service.ts:121-126` (the Simple rule), `public/index.html:1747`
  (`quadGrades`). The "Include Grade 6" toggle (`_setupSetGrade6`, `index.html:6892`) is not greyed while Simple is on.
- **Scenario:** Youth Setup has Include Grade 6 on (`gradeMin: 6`), so Complex created `grade6g`/`grade6b`. The admin
  turns on Junior/Senior logins. The `grade6*` accounts are retired with the other grade accounts. No quad can see a
  grade-6 student (`canAccessGrade` returns false for 6), and `setViewGrades` refuses 6 for a quad. Result: Health,
  Connect Setup, Birthdays, Prayers and Search show **no grade-6 student to any leader login**. The confirm says
  nothing about it. The same happens if Grade 6 is ticked after Simple is already on. A new install (Simple on by
  default) that takes grade 6 is in this state from day one.
- **Fix:** add `merged.structure.gradeMin >= 7` to the Simple rule in `settings.service.ts` (400 "Turn off
  Junior/Senior logins first"), and grey the Include Grade 6 toggle while the draft has Simple on. The other option is
  to fold grade 6 into the Junior bracket for quads. That is a scoping change, so it needs a decision first.

### I2. A stale Youth Setup draft in a second tab or device silently flips Simple logins or Prayers
- **Where:** `src/services/settings.service.ts:120-139` (`wasOn`/`isOn` taken from whatever the client sends);
  `public/index.html:6832-6850` (`confirmSaveMinistrySetup` compares with `_adminData.settings`, which is just as
  stale as the draft).
- **Scenario:** The admin turns Simple logins on from the laptop. A phone still has Youth Setup open with a draft
  from before (`logins.simple: false`). On the phone they change the accent colour and save. The risky-diff check
  compares stale against stale, so no warning shows. The server sees `wasOn = true, isOn = false` and runs the
  **off** flip: every retired grade login comes back to life, the quads get their old names and the Grade role is
  restored. Nothing tells the admin. `modules.prayers` behaves the same way. C1 protected only the two server-owned
  fields, not `simple` itself.
- **Fix:** give the PATCH a base version, for example `baseUpdatedAt` set from the settings the draft was seeded from.
  The server answers 409 "Youth Setup changed elsewhere, reopen it" when the stored `updatedAt` differs. A smaller
  fix: send `expect: { simple, prayers }` from the saved config, and have the server refuse a flip when the stored
  value does not equal `expect`.

### I3. The All cars tab can stay on "Loading…" for the whole night
- **Where:** `public/index.html:8661-8672` (`busRefresh`), `:8995` (the tab click runs `renderBus();busRefresh()`),
  `:9002-9005` (`_busAllCarsHtml` shows "Loading…" while `BUS.cars` is null). The poll (`_busStartPoll`) calls
  `busRefresh()` only when `run.version` changes.
- **Scenario A:** The user opens Bus and taps **All cars** while the first `/bus/run` + `/bus/my-car` load is still
  running. `busRefresh()` sees `BUS.loading` with the same `as` and returns that promise. The promise was started with
  `wantCars = false`, so `/bus/run/cars` is never fetched. After that, nothing refetches until the run version
  changes. On a quiet night the tab stays on "Loading…".
- **Scenario B:** `/bus/run/cars` fails once (Wi-Fi, 5xx). `.catch(() => null)` keeps `BUS.cars` null. The page shows
  "Loading…" with no error and no retry.
- **Fix:** in `_busAllCarsHtml`, when `BUS.cars` is null, start a dedicated fetch (`BUS.carsLoading` guard) instead of
  relying on `busRefresh`. Store a `BUS.carsErr` and show a Retry card. Also fetch the cars on each poll tick while
  `BUS.tab === 'allcars'`, not only on a version change.

---

## Minor

### M1. All cars shows raw `stopOrder`, not the position in the car
- `src/services/bus.service.ts:697-698`. A rider whose address was deleted is unplaced without renumbering the rest
  (`:735`), and a placed rider can have `stopOrder` null (→ `0`). So All cars can read "1, 3, 4" or "0" when Assign
  (`index.html:9852`, `riders.map((r, i) => …)`) shows 1, 2, 3. **Fix:** after the sort, `stop: i + 1`.

### M2. `suburbOnly` blanks real suburbs that contain a street word
- `src/services/bus-logic.ts:66-77`. `"12 Hawken Dr, St Lucia QLD 4067, Australia"` → `""` (`st` matches
  `STREET_WORDS`). "Lane Cove" behaves the same. St Lucia is a Brisbane suburb. The function is now also used in the
  junior-leader redaction (`bus.service.ts:386`), which showed the suburb before. This fails safe ("blank when
  unsure"). **Fix:** allow a leading `St ` followed by a capitalised word (Saint) before the street-word test, and add
  a test.

### M3. One `viewGrades` per leader: a Junior save wipes the Senior preference (and the reverse)
- `src/services/leader.service.ts:641-654`, `public/index.html:1447-1455`. A leader with `grades: [9, 10]` defaults to
  [9] on Junior Guys and [10] on Senior Guys. Junior Guys taps to [8, 9], which saves `viewGrades: [8, 9]`. On Senior
  Guys, `[8, 9] ∩ [10, 11, 12]` is empty, so it falls back to the whole bracket, not [10]. **Fix:** on a quad save,
  keep the existing out-of-bracket grades:
  `grades = existing.viewGrades?.filter(g => !bracket.includes(g)) ∪ new`.

### M4. Grade-filter state and the "I am" pick are not cleared on logout or when a preview token expires
- `doLogout` (`index.html:2241+`) does not call `_vgReset()`. A tap less than 600 ms before logout fires `_vgSave`
  with no token, which gives an error toast on the login screen. The unsaved `_vgLocal[id]` entry then survives into
  the next login on that device and overrides the server value.
- `_handleAuthExpired`'s preview branch (`index.html:10515+`) restores the admin without the
  `setMyLeaderId(null); _vgReset()` that `exitPreview` does. So the preview's "I am" pick leaks into the admin
  session. That breaks the spec I7 rule.
- **Fix:** call both in `doLogout` and in the preview branch of `_handleAuthExpired`.

### M5. A failed grade-filter save keeps showing as if it saved
- `index.html:1464-1474`. On `catch`, `_vgLocal[id]` is left in place. The chips show the unsaved pick for the rest of
  the session and nothing retries. **Fix:** on failure, `delete _vgLocal[id]; render();` (revert), or retry once.

### M6. Turning Simple off ignores the Grade checkbox, and the Quad checkbox is not greyed
- `settings.service.ts:133-134` always sets `roles.enabled.grade = gradeRoleWasOn` on the off flip. The draft
  re-enables the Grade checkbox as soon as Simple is unticked (`index.html:6597`), so an admin who leaves Grade
  unticked still gets it turned on. The Quad checkbox stays editable while Simple is on. Unticking it gets the generic
  400 only at save time. **Fix:** grey Grade until the off flip is saved (or honour an explicit patch value), and grey
  Quad while the draft has Simple on.

### M7. After a save, the draft is null while the page refetches
- `index.html:6459-6474`. Between `_setupDraft = null` and the re-render, the old page is still interactive.
  "Download settings file" then exports `ministryConfig: {}` (`exportSettingsFile`, `_setupDraft || {}`). A toggle tap
  runs `_setupSet`, which seeds `_setupDraft = {}`, so `_ensureSetupDraft` never reseeds. The page then renders the
  defaults, and `_setupRiskyDiff` reports "turns Junior/Senior logins off" for a patch that does not touch it.
  **Fix:** `_setupDraft = JSON.parse(JSON.stringify(fresh.ministryConfig))` in place of `null`.

### M8. "Download CSV" in the Prayers-off dialog can kick the admin out of Youth Setup
- `index.html:6876-6884` + `:868-870`. If Prayers is already saved off, the admin ticks it on in the draft and then
  unticks it. The dialog offers Download CSV, and `/prayers/export` answers 404 `MODULE_DISABLED`.
  `_moduleDisabledRefresh()` then runs `go('home')`. The draft is lost (switching back into the tab nulls it).
  **Fix:** offer Download only when the saved config has Prayers on, or skip `go('home')` when `S.page === 'admin'`.

### M9. The New Year wizard says Prayers is "Skipped", but Full Reset still deletes the prayers
- `index.html:5968+` (`prayersSkippedCard`). With Prayers off, step 2 says "Skipped — Prayers is turned off" and
  counts as done. Step 4 Full Reset then deletes every stored prayer, and the export is 404 while off. Data loss
  follows from the spec, but the wording hides it. **Fix:** "Prayers is off. Turn it on and export first, or the saved
  prayers are deleted in step 4."

### M10. Turning Prayers back on does not reach logins that are already signed in
- `_prayersOn()` reads `S.settings`, which is loaded at boot or login. The off direction has the `MODULE_DISABLED`
  refresh. The on direction has nothing, so the slot stays hidden until reload. A known limit; it could be noted in
  the rollout step.

### M11. Small All-cars and preview gaps (Plausible / cosmetic)
- With 0 cars running, `_busAllCarsHtml` returns "No cars are running tonight." and drops the `unassigned` count
  (`index.html:9005`).
- `enterPreview`/`exitPreview` reset neither `BUS.view` nor `BUS.cars` (`index.html:7349-7373`). After a preview,
  the first Bus paint can still be the admin's view, with `canSeeCars`/`canCoordinate` true, until `busRefresh`
  replaces it. BUS.view was already like this before the rework. All cars content is the same for every viewer, so
  nothing leaks, but a quad preview in Shadow mode can briefly show the tab. **Fix:** clear the BUS session fields in
  both, as `doLogout` does.

---

## Verified OK
- **On → off → on:** the first on records the active grade ids in the same write and retires exactly those. Off
  restores only listed ids that are still `role === 'grade'` and still `inactive`, restores `gradeRoleWasOn` and clears
  the list. The second on collects the re-activated ids again. The generic role cascade runs on the same ids, which is
  harmless. Re-ticking Grade while on is forced back to false. (`settings.service.ts:120-176`)
- **Server-owned fields:** stripped from every patch before the merge, also from an old cached SPA whose draft echoes
  the full stored config. Settings-file export and parse strip both. An old file without `logins` keeps the current
  value, because `loadSettingsFile` does a per-section shallow merge. `logins.simple` is carried.
- **Account guard:** create, update (explicit `status: 'active'` or a role change to grade on an active account) and
  `toggleStatus` refuse a grade account while on. Preview refuses inactive accounts. The layout with Simple on targets
  the 4 quads only, on the server and in the client mirror.
- **Admin preview while on:** `enterPreview`/`exitPreview` clear `yap_leader_id` and `_vgReset()`. `_vgSet` never
  schedules a save while `_previewStash` is set, and that also holds after a mid-preview refresh (the stash is
  restored from localStorage). A quad preview has no Bus coordination, because `as=` is empty after the clear.
- **Leader with no grades, or grades outside the bracket:** `_vgGrades` falls back to the whole bracket. A leader not
  in `/leaders` (inactive, deleted, other gender) also falls back. The server refuses out-of-bracket grades for a quad
  and an empty array (`min(1)`). Connect Setup keeps `grades: []` leaders visible.
- **Prayers off with 0, 1 or 2+ other modules:** `_navSlots` gives no slot (4 tabs in the bar, quick actions
  unchanged because the split is on the base index), a plain Bus or New person tab, or More. `_isRootPage` and
  `_updateNavActive` work off the resolved ids. `render()` bounces `prayers` to Home. Prefetch, My Connections, the
  profile "+ Prayer" button, the leader Home grid, the Admin Prayers card and the wizard are all gated. All 8 service
  methods throw `ModuleDisabledError`. With no settings repo, Prayers counts as on.
- **Empty bus run:** `carsView` with no running vehicles returns `cars: []`. A running car with no riders renders
  "No riders yet."
- **Address with no suburb:** the no-comma, street-only and one-space sentinel inputs all return `""`, and
  `esc('')` renders cleanly. `carsView` builds every field by hand: no ids, street, phone or consent.
- **Old phones on the old SW cache:** the HTML is network-first and `ysc-v90` is bumped. The new routes sit under
  the existing `leaders`/`bus` prefixes, so `API_RE`/`vercel.json` need no change. An old SPA's Youth Setup save
  cannot clobber the server-owned fields. An old SPA with Prayers off gets a 404 toast until it reloads (transient).
- **json and memory persistence:** the in-memory/json leader repo carries a stored `viewGrades` through `save` and
  `saveMany` (mirroring the Supabase upsert, which never lists `view_grades`). `setViewGrades` writes only that field.
  The memory seed has no `viewGrades`, so it defaults to `grades`. Supabase `select *` plus a `toLeader` that treats a
  missing column as null are safe before 0016 runs.
- **New installs versus existing installs:** `createFirstAdmin` checks `needsAdmin()` before writing settings, so a
  late or second POST cannot flip an existing install. The settings are written before the admin, as specified.
  Existing installs parse `logins.simple = false` and `prayers = true` from `'{}'`. The migration is additive, and the
  duplicate-version guard runs in both `listMigrationFiles` and `runMigrations`.
