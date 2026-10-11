# October rework review: R3, false positives and negatives

Reviewer: R3. Branch `feat/oct-rework` @ `720a0bc`, compared with `master`. This was a read-only review.

Scope:
- Tests that pass while the behaviour is wrong.
- Checks that block valid cases.

Every finding comes from reading the code. Findings I could not prove are marked **Plausible**.

Tests run:
- `npx vitest run` on `bus-logic`, `bus.cars`, `account.service`, `settings.service`, `spa-oct-simple-logins`, `spa-oct-prayers-bus`, `prayer.service` and `leader.repo-view-grades`.
- Result: 184 of 185 pass.
- The one failure is the known flaky timeout in `account.service.test.ts`, "applying Complex deactivates the pre-existing grade7g…" (5 s). CLAUDE.md lists it under Deferred minors. It is not caused by this rework.

Counts: Critical 0 · Important 2 · Minor 7

---

## Important

### I1. `suburbOnly` returns `""` for the address format the app actually stores, so All cars never shows a suburb and the junior-leader view loses the suburb it had before
**Where:**
- `src/services/bus-logic.ts:67` (`SUBURB_PART` needs `\s+\d{4}$`)
- Used at `src/services/bus.service.ts:386` (junior-leader redaction) and `:699` (`carsView`)

**Why:**
- The saved Bus address string is the Places **autocomplete** text. The SPA writes `input.value = h.text` (`public/index.html` `busAcPick`, ~9171). `_busReadAddress` then sends that text as `newAddress.address` (~9208). `resolveAddress` (`bus.service.ts:420-427`) saves it unchanged.
- That text comes from `suggestions.placePrediction.text` (`google-routing-provider.ts:145`, `parseAutocomplete`).
- The repo's own fixture for that response is `'24 Wynnum Rd, Carina QLD, Australia'` (`src/tests/routing.google-requests.test.ts:104`). It has **no postcode**.
- `SUBURB_PART` only matches `"Suburb STATE 1234"`. So:
  - `suburbOnly('24 Wynnum Rd, Carina QLD, Australia')` → `""`
  - The old `suburbOf` gave `"Carina QLD"` for the same input (its postcode strip doesn't match, so `parts[1]` is returned unchanged).

**Failure scenario:**
- Inputs: a real rider saved through the address picker (`"8 Smith St, Mount Gravatt East QLD, Australia"`).
- All cars returns `suburb: ""` for every stop. Decision 9 lists suburb as one of the five fields, so it is lost everywhere.
- The junior `leader` redacted `GET /bus/run` now shows a blank address where it showed "Mount Gravatt East QLD" yesterday.
- This fails safe: no street leaks. But it is a regression for junior leaders, and the new tab is missing a field.

**Why the tests miss it:**
- `bus-logic.test.ts` and `bus.cars.test.ts` only use addresses with a postcode (`"… Carina QLD 4152, Australia"`). Those come from the spec table, not from data the app produces.
- The live Google text format is inferred from the repo fixture, not checked against prod (the addresses are encrypted). Confidence: high, but **Plausible** for live data.

**Fix:**
- Make the postcode optional: `^([A-Za-z][A-Za-z' .-]*?)\s+(?:STATES)(?:\s+\d{4})?$`. Keep the digit and street-word guards.
- Add the autocomplete-shaped inputs to the tests:
  - `'24 Wynnum Rd, Carina QLD, Australia'` → `Carina`
  - `'3/24 Wynnum Rd, Carina QLD, Australia'` → `Carina`
  - `'Wynnum Rd, Carina QLD, Australia'` (a street pick) → `Carina`
- In `bus.cars.test.ts`, use at least one no-postcode address in `ADDR`.

### I2. Two All-cars leak tests are too narrow to catch the likely mutations
**Where:** `src/tests/bus.cars.test.ts`, "ignores as=" (~86) and "key allow-list + no street, full address or phone anywhere" (~101).

**Test 1, "ignores as=":**
- `world()` creates exactly one car ("Big Bus", leaders L1 and L2).
- The test compares `carsView(quad, as='L1')` with `carsView(quad)`.
- Likely mutation: `carsView` uses `as=` to narrow to "my car" (`running.filter(v => v.leaderIds.includes(as))`). Both calls still return the same single car, so `toEqual` passes. **This test cannot fail for that mutation.**

**Test 2, the key allow-list:**
- It runs only as `admin`.
- Mutation: a role-dependent field, such as adding `phone` or a street when `role !== 'admin'` (or only for coordinators). The test still passes.
- The spec requires the same view for every allowed login.

**Fix:**
- Add a second running car with a different leader (e.g. L3) and at least one rider. Assert that `as='L1'` still lists both cars.
- Run the allow-list and phone walk over all five roles (`ROLES`) in mode `on`.

---

## Minor

### M1. The Junior/Senior logins toggle can be turned on when the rule can't be met. The 400 then says the opposite of what to do
**Where:**
- `public/index.html` `simpleToggleRow` (~6546). The toggle is always enabled.
- `src/services/settings.service.ts:126-131` returns `SIMPLE_ON_MSG`.

**Failure scenario:**
- A ministry on the Simple preset (`cohortModel:'none'`, `quad:false`) ticks Junior/Senior logins, confirms and saves.
- It gets 400: "Turn off Junior/Senior logins first".
- The login is not on yet. The admin needs to switch to Complex and turn on Quad instead.

**Fix:** either of these.
- Disable the toggle (with a tooltip) while the draft has `cohortModel !== 'grades-quads'` or `roles.enabled.quad === false`.
- Or use a second message when `!wasOn && isOn`: "Junior/Senior logins needs the Complex cohort model and the Quad role".

### M2. `suburbOnly` rejects real Brisbane suburbs that contain a street word
**Where:** `src/services/bus-logic.ts:66` (`STREET_WORDS`).

**Failure scenario:**
- `'… , St Lucia QLD 4067, Australia'` → `""` (`st`).
- `'… , Petrie Terrace QLD 4000, Australia'` → `""` (`terrace`).
- Elsewhere in Australia: Lane Cove (`lane`), St Kilda, St Ives, St Marys.

This fails safe (the field is blank), but St Lucia riders never get a suburb.

**Fix:** allow a leading `St ` or `Saint ` token, and accept `Terrace` when it is the last word before the state in a non-first comma part. Alternatively, keep a small allow-list (`/^(st|saint)\s/i`, `Petrie Terrace`). Add these cases to the test.

### M3. The SPA tests use copies of the constants and helpers they should be testing
**Where:** `src/tests/spa-oct-simple-logins.test.ts`.
- `QL` (~4) re-declares `QUAD_LABELS` and `SIMPLE_QUAD_LABELS`.
- The S1.3 prelude re-declares `_simpleLoginsOn` and `quadGrades`.

**Mutation that still passes:** change the real `SIMPLE_QUAD_LABELS` at `public/index.html:1381` (e.g. `b1012:'Senior Boys'`). Every `quadLabel` and `buildTargetAccountsClient` test still passes, because they evaluate against the copy.

Today the copies match the real code (checked at 1380-1387 and 1747). The tests just can't notice when the two drift apart.

**Fix:**
- Pull the two `const` lines from `loadIndexHtml()` (regex on `^const (SIMPLE_)?QUAD_LABELS = .*$`).
- Load the real `_simpleLoginsOn` and `quadGrades` with `loadFns`, the way the other helpers are loaded.
- Add one assertion that the client `SIMPLE_QUAD_LABELS` equals the server's `quadLabelFor(q, true)`.

### M4. "save/saveMany never wipe viewGrades" is tested only on the in-memory copy
**Where:**
- `src/tests/leader.repo-view-grades.test.ts:30`
- `leader.service.test.ts` ("import-style saveMany leave viewGrades unchanged")
- Implementation: `in-memory.repositories.ts` `withStoredViewGrades`

**Gap:**
- These tests exercise a stand-in that copies the guarantee from the Supabase upsert.
- The real guarantee is that `supabase.leaders.ts` `save`/`saveMany` don't list `view_grades` (they don't today, lines 57-104).
- Mutation: add `view_grades = excluded.view_grades` to the Supabase upsert. No test fails, and every CSV import or leader edit on prod wipes the filters.

**Fix:** add a source-level guard, the same style as the existing SPA string tests:
- `save`/`saveMany` in `supabase.leaders.ts` do not contain `view_grades`.
- `setViewGrades` does.

### M5. The account guard's `status: 'active'` branch protects nothing, and its test asserts a 400 for a request that does nothing
**Where:**
- `src/services/account.service.ts:199-205` (`wantsActive`)
- Test `account.service.test.ts` "on: update that sets status active on a grade account is 400"

**Why:**
- The comment says `status` is not in the update schema, so `PATCH /accounts/users/:id {status:'active'}` can never activate anyone.
- Remove `wantsActive` and the request succeeds with the account still inactive. The test only "fails" in the sense that the 400 goes away; no activation was ever possible.
- Harmless today, because the SPA's edit form (`index.html:7224`) never sends `status`.
- But the test gives false confidence. The real activation paths are `toggleStatus` (tested) and role change (tested).

**Fix:**
- Drop `wantsActive`, or replace the test with one that asserts the account is still `inactive` after the PATCH.
- **Verified OK:** the other two guards (create, toggleStatus) and the quad→grade role change are real and covered.

### M6. With Prayers already saved off, the Prayers toggle still offers "Download CSV". The 404 then moves the admin out of Youth Setup
**Where:**
- `public/index.html` `_setupPrayersToggle` (~6875)
- `exportPrayersCSV` (~5352)
- The API wrapper's `MODULE_DISABLED` hook (~871)

**Failure scenario:**
1. Prayers is saved off.
2. The admin ticks it on in the draft, then unticks it.
3. The confirm offers "Download CSV". `GET /prayers/export` returns 404 `MODULE_DISABLED`.
4. `_moduleDisabledRefresh()` runs `go('home')`. The admin lands on Home with an "Export failed" toast, and the confirm (Plausible: still open) is over Home.
5. The draft survives in memory (`_setupDraft` is not cleared). Nothing is lost, but the user is confused.

**Fix:**
- Show the Download button only when the **saved** `modules.prayers` is not `false`.
- Or skip the `MODULE_DISABLED` hook for `/prayers/export`.

### M7. Several SPA "screen wiring" tests only check that a string is present
**Where:**
- `spa-oct-simple-logins.test.ts`, "each screen renders _vgBar and applies its helper"
- `spa-oct-prayers-bus.test.ts`: "render sends the prayers page home", "the API wrapper calls the handler…", "the Modules card has the toggle…", "New Year Refresh counts Prayers…"

**Mutation that still passes:** in `renderAtRisk`, move the `_vgStudents(` call after the tiles are counted, or apply it to a throwaway variable. The substring check still passes.

This is the same class as the known M-1 from the 2026-10-12 Opus review, so it is listed only as a reminder.

**Fix:** for at least Health and Connect Setup, run the real function with `loadFns` and a stub `S`/`Cache`, and assert on the rendered counts.

---

## Verified OK (checked and sound)
- **Simple logins, quad Bus coordination:**
  - `canWithConfig` is the only change.
  - `allowed()` is the only path to `bus:coordinate`. Every coordinator method goes through `gate()`→`allowed()`, and `setDropped` calls `allowed()` directly. There are no stray `can(…,'bus:coordinate')` calls (grep `bus.service.ts`).
  - The `coordinatorLeaderIds` elevation via `as=` still works.
  - The bus tests would fail if `allowed()` went back to `can()`.
- **`canWithConfig` matrix test:** it is not a tautology. Its only non-`can()` expectation is the exception itself, and every other role × action × simple combination is pinned.
- **`canSetViewGrades`:** it matches the spec table. A leader with no `leaderId` is refused, and grade is refused. The route test returns a JSON 401 and grade gets 403 over HTTP.
- **`setViewGrades` range check:**
  - Client "All" (`quadGrades(u.quad)`) is always inside the server's `gradeRange ∩ quadGradesOf`. This holds with Include Grade 6 too, because both sides exclude 6 from a quad bracket. So "All" never gets a false 400.
  - `[]` → 400 matches "empty pick not saved".
- **Prayers off:**
  - All 8 service methods call `requirePrayersModule()` first.
  - Each `it.each` case would otherwise resolve, or throw a *different* class (`NotFoundError`/`ForbiddenError` are not `ModuleDisabledError`). So every case discriminates.
  - The SPA guards every `/prayers` call: `_prefetch`, My Connections, `render()`, More, and the leader Home grid.
  - The student delete cascade uses the repo directly, so it is not blocked by the 404.
- **Settings server-owned fields:** the strip is tested with clear, plant and flip patches. Removing it fails the test.
- **Off restore rules:** these are tested (deleted, role changed, unlocked by hand, already inactive). Restore uses `users.save` directly, so the account guard can't block the off path.
- **On path:** the "retire exactly these ids" behaviour is hidden by the generic Grade-off cascade in test 1, but test 2 (Grade already off) covers it on its own.
- **Junior-leader redaction test (`bus.cars.test.ts`):**
  - It would fail if `suburbOf` were put back. `'24 Wynnum Rd Carina QLD 4152'` would come back whole and fail the digit check.
  - Its `streetOf` checks are not vacuous: no `streetOf` result is `''`, otherwise `not.toContain('')` would always fail.
- **The `carsView` key allow-list walk** does catch a spread of a repo object: any `id`, `placeId`, `addressId` or `phone` key fails.
- **Migration duplicate guard:** both `listMigrationFiles` and `runMigrations` throw before any DB call. This is tested with a Proxy that records calls.
- **`_navSlots`:** every real `_navItemsBase()` role list contains `prayers` (checked at index.html 1931-1999). So the slot placeholder exists for all five roles, even though the test uses its own base lists.
