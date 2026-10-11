# October rework: six-hat review (R1)

Reviewer: R1 "six-hat" (read-only). Branch `feat/oct-rework`, head `720a0bc`, diff `master...feat/oct-rework`.
Inputs: the spec (with its Review resolution table), plan Lane R, operator decisions 1–5, 9, 10, 14, 15, and
`CLAUDE.md`. Accepted risks (ledger 9, 10, 14) are not reported.

Checks I ran: `npx tsc --noEmit` (clean); `node scripts/check-spa-syntax.js` (clean); `npx vitest run` on
`bus.cars`, `settings.service`, `spa-oct-simple-logins`, `spa-oct-prayers-bus`, `leader.service` and
`account.service`. 144 passed. 2 failed, both on the 5 s timeout in `account.service.test.ts` "cohort account
layout (bug 8)" (the known bcrypt flake, made worse because other reviewers share the machine). Neither is a
rework test.

**Counts:** Critical 0 · Important 2 · Minor 9.

---

## Important

### I1. Black/Red: with Junior/Senior logins on and Grade 6 included, no ministry login can see grade-6 students
- **Where:** `src/services/access-control.ts:213-217` (the quad case in `canAccessGrade`: junior means 7–9 and
  senior means 10–12, and grade 6 matches neither); `quadGradesOf` `:244-247`; SPA `quadGrades()`
  `public/index.html:1747`. The "Include Grade 6" toggle `public/index.html:6583` is **not** locked while Simple
  logins is on. The settings rule `src/services/settings.service.ts:125-131` checks only the cohort model and the
  Quad role.
- **Scenario:** New installs now default to Simple logins on (`setup.service.ts` `createFirstAdmin`). A new
  location turns on "Include Grade 6", or loads a settings file that has `gradeMin: 6`. The grade logins are
  retired, and only quad logins remain. Grade-6 students are imported and counted, but every Junior/Senior login's
  Home, Health, Connect Setup, Search, Prayers and Birthdays leaves them out (`canAccessStudent` → false). Only
  admin and director can see them, and there is no warning anywhere. YS Brisbane (`gradeMin` 7) is not affected
  today.
- **Fix (cheapest first):** add `structure.gradeMin >= 7` to the Simple rule in `settings.service.ts`, with the
  400 message "Junior/Senior logins covers years 7–12 only". Grey out the Include Grade 6 toggle while
  `simpleOn`, as the cohort select already is. Add a `settings.service` test. (The other route is to widen the
  junior bracket to `gradeMin..9`, but that touches `canAccessGrade`, `quadGradesOf`, the SPA `quadGrades` and the
  CA quad logic. It is too big for this rework.)

### I2. Black: prayers "kept" while off are deleted by the New Year Full Reset, and the wizard shows the export step as "Skipped"
- **Where:** `public/index.html:5972-5975` and the step-2 card (`prayersSkippedCard`, `prayersSatisfied = true`
  when off). The export cannot be run while off: `src/services/prayer.service.ts` `exportCsv` calls
  `requirePrayersModule()` and returns 404. Full Reset still deletes prayers (spec B).
- **Scenario:** An admin turns Prayers off and taps **Turn off** without **Download CSV**, which the modal allows
  (`_setupPrayersToggle`, `public/index.html` ~6875). In January the admin runs New Year Refresh. Step 2 reads
  "Skipped — Prayers is turned off" and counts as done. Step 4 (Full Reset) then deletes every prayer, and none was
  ever exported. The Modules tooltip and the spec both say "Prayers already saved are kept", so the admin has no
  reason to expect this.
- **Fix:** When Prayers is off, change the skipped card to an amber warning: "Prayers is off. The Full Reset in
  step 4 deletes the N saved prayers. To keep them, turn Prayers on, export, then turn it off again." Or keep step
  2 un-skippable until the admin ticks "I don't need the prayers". A copy change is enough. YS Brisbane is safe,
  because operator rollout step 1 exports first.

---

## Minor

### M1. Red: turning Junior/Senior logins ON in the wrong state gives the message "Turn off Junior/Senior logins first"
- **Where:** `src/services/settings.service.ts:125-128` (one `SIMPLE_ON_MSG` for both directions). SPA
  `_youthSetupBody` locks the cohort select as soon as the draft has `logins.simple` set.
- **Scenario:** The cohort model is Simple (or the Quad role is off). The admin ticks Junior/Senior logins. The
  cohort select is now disabled and still shows Simple, and Save returns 400 "Turn off Junior/Senior logins first".
  But the admin is trying to turn it **on**. The admin has to untick it, change the cohort, then tick it again.
- **Fix:** Use a second message for the `!wasOn && isOn` path, such as "Junior/Senior logins needs the Complex
  cohort model and the Quad role on". In the SPA, either lock the cohort select only when Simple is on in the
  **saved** config, or show this same hint next to the toggle when the draft breaks the rule.

### M2. Red: a stale `/prayers` call on another screen sends the user to Home
- **Where:** `public/index.html:1365-1374` (`_moduleDisabledRefresh` always calls `go('home')`). It is triggered
  from `API` `r()` by any `/prayers*` path, including My Connections' `API.get('/prayers')` (`renderMyStudents`)
  and `exportPrayersCSV`.
- **Scenario:** The admin turns Prayers off. A leader who signed in earlier still has `S.settings` with prayers
  on. They open My Connections. The background `/prayers` call returns MODULE_DISABLED, and the app sends them to
  Home instead of the screen they opened. A second tap works.
- **Fix:** Refresh settings and rebuild the shell as now, but call `go('home')` only when
  `S.page === 'prayers'`. Otherwise re-run `render()`.

### M3. Black (view preference only): one `viewGrades` value is shared by every login, and a quad may write any leader's filter
- **Where:** `src/services/access-control.ts:142-146` (`canSetViewGrades`: quad → any leader);
  `src/services/leader.service.ts` `setViewGrades` (it checks the grades against the **caller's** bracket, not the
  leader's); SPA `_vgGrades` `public/index.html:1444` (it clamps to the bracket, and an empty result falls back to
  the whole bracket).
- **Scenario A:** A leader with `grades: [9, 10]` uses both Junior Guys and Senior Guys. On Junior Guys they tap
  **All**, which saves `[7, 8, 9]`. On Senior Guys the clamp leaves nothing, so they see the whole bracket
  10–12, not their Year 10.
- **Scenario B:** A Junior Girls login sends `PATCH /leaders/<a Senior Guys leader>/view-grades {grades:[7]}`.
  This is allowed, and it silently resets that leader's Senior filter to "all".
- No data is exposed (the server still scopes every read), and this matches the spec ("quad … any leader").
- **Fix (optional):** For a quad caller, require the leader to be in scope with `assertLeaderInQuadScope`, or at
  least to match its gender. Long term, key the filter by `(leaderId, quad)`.

### M4. Plausible: All cars may show stop "0", or a duplicate stop number, when a placed rider has a null `stopOrder`
- **Where:** `src/services/bus.service.ts:697-698` (`.sort((a,b)=>(a.stopOrder ?? 0)-…)`, `stop: r.stopOrder ?? 0`).
  Elsewhere the code sorts nulls **last** (`?? 999`, `bus.service.ts:609`), and every other SPA stop list numbers by
  index (`i + 1`, `public/index.html` ~9853, 10086, 10146).
- **Scenario:** If any path leaves a rider on a car with `stopOrder: null` (the `?? 999` at :609 suggests it can
  happen), All cars lists that rider first as stop "0", while My car shows them last.
- **Fix:** Sort with `?? 999`, then number by index: `stop: i + 1`. The allow-list test still holds.

### M5. Red: the "No Bus coordinators" warning shows even when Bus is off
- **Where:** `public/index.html:6842`.
- **Scenario:** A location without Bus (`modules.busMinistry` false, which is the default) turns on Junior/Senior
  logins and gets a red "Only admin and director can run Bus" warning about a module it does not use.
- **Fix:** Show the warning only when `saved.modules.busMinistry` is on. Optionally also check that each
  coordinator id is still an active leader.

### M6. Black (documentation honesty): "Quad logins lose Bus coordination" is a default, not a lock
- **Where:** `bus.service.ts` `allowed()` / `selfLeaderId` (non-leader roles use `ctx.asLeaderId`, the
  spoofable `as=`).
- **Scenario:** A Senior Guys login picks a coordinator's name in "I am…" and gets Car setup, Assign and Generate
  back. This is by design (spec §4, "spoofable by design"), but the spec's Part A and the Youth Setup helpTip read
  as a hard removal.
- **Fix:** Add one line to the CLAUDE.md "Resume here" (Lane V2): "the quad restriction is advisory; `as=` is
  self-identification". No code change.

### M7. Black, pre-existing, out of scope (Plausible): the junior-leader redacted run view still includes the car's `endsAddress`
- **Where:** `src/services/bus.service.ts` `buildView`. `vehicles` is not redacted for `isRedactedLeader`, and
  `BusRunVehicleView extends BusRunVehicle`, which has `endsAddress` / `endsPlaceId` (`src/core/entities/bus.ts:38`).
- **Scenario:** A car that ends at a leader's home sends that full street address to every junior-leader login
  through `GET /bus/run`. The rework hardened the riders' suburbs on the same response but left this field. The
  new `carsView` correctly leaves it out.
- **Fix:** In the redacted branch, map `vehicles` to `{ ...v, endsAddress: null, endsPlaceId: null }`. Add the
  key to the redaction test. Log it as a follow-up if it stays out of scope.

### M8. White: "Data is kept" is slightly overstated
- **Where:** `src/services/student.service.ts:196-200`. Deleting a student still runs
  `prayerRepo.deleteByStudent` while Prayers is off.
- **Scenario:** With Prayers off, an admin deletes a student. That student's hidden prayers are deleted too.
  This matches the behaviour with Prayers on, but the spec says "Data is kept" (apart from Full Reset).
- **Fix:** Change the spec/CLAUDE.md wording to "kept, except that Full Reset and deleting a student still delete
  them". No code change.

### M9. Blue: the docs still describe master
- **Where:** `CLAUDE.md` "Migrations" ("the next migration is `0016`") and the Key API routes table (no
  `PATCH /leaders/:id/view-grades`, no `GET /bus/run/cars`). This is expected, because Lane V2 has not run yet.
- **Fix:** In V2, also record:
  - the grade-6 limit (I1);
  - the advisory quad restriction (M6);
  - the 12 h tail for retired grade tokens (`resolveToken` trusts the embedded actor, `auth.service.ts:188-191`);
  - that `logins.simple` defaults to **on** for new installs only.

---

## Six hats (summary)

**White (claims vs code).** Every spec item I traced matches the code:
- server-owned `retiredGradeIds` / `gradeRoleWasOn` are stripped from patches;
- the ids are collected before one write, then exactly those are deactivated;
- the restore needs `role === 'grade'` and `inactive`;
- quads are renamed by role and the `quad` field;
- the setup write happens before the admin is created;
- the account guard covers create, update and toggle;
- `quadLabelFor` is used in the three stats services and the layout;
- `canWithConfig` is the only `bus:coordinate` path;
- `carsView` is built field by field, and `suburbOnly` is used in both places;
- all 8 prayer methods are gated;
- the migration guard is in place, and `LATEST_MIGRATION` is `0016`;
- `_navSlots` splits the bar and the quick actions on the base index;
- the preview clears `yap_leader_id` and never saves.

The mismatches are M8 (wording) and M9 (docs not done yet).

**Red (feel).**
- *Operator:* the confirm states what the switch does, the toast counts the renamed quads, and turning it off is
  a clean undo. The friction is the misleading 400 (M1) and the Bus warning on installs with no Bus (M5).
- *Leader:* the grade bar is easy to read, and "follows me to another phone" is a real win. However:
  - "My grades" never looks selected, so after a tap it is not obvious which mode is on;
  - the bar does nothing until "I am…" is picked, though the hint says so;
  - a stale `/prayers` call sends them to Home (M2).

**Black (risks).**
- *Suburb redaction:* sound. It is strict, blank when unsure, and allow-list tested with the unit, no-comma and
  no-suburb fixtures. A suburb with a street word ("St Lucia") comes out blank, which is the safe direction.
- *Retired logins:* sound on the server. The 12 h token tail is accepted.
- *Real gaps:* grade-6 students vanish under Simple (I1), and prayers can be lost through the New Year Reset (I2).
- *Pre-existing:* `endsAddress` reaches junior-leader logins (M7).

**Yellow (keep, don't break).**
- Server-owned config fields, stripped from every client patch and from the settings file.
- `setViewGrades` is the only writer of `view_grades`, `save` / `saveMany` never list the column, and `toLeader`
  works before 0016 is applied (undefined → null). So promoting before or after the migration is safe.
- `carsView` is built field by field, with the key allow-list and no-street/no-phone test.
- The duplicate-migration guard runs in both `listMigrationFiles` and `runMigrations`.
- Each prayer method checks the module first, and the client follows it with a settings refresh.
- `pickMinistryPreset` keeps `logins` / `prayers`, and the confirm checks the diff whatever caused the change.
- Preview taps are never saved.

**Green (simpler alternatives).**
- *Retired logins:* instead of `retiredGradeIds`, `gradeRoleWasOn`, the restore loop and the account guard,
  refuse `grade` actors while `logins.simple` is on, in `auth.login` and once per request in the adapter (the
  settings read is already de-duplicated). This removes all server-owned state, closes the 12 h tail, and makes
  turning it off a no-op. The trade-off is one settings read per request for grade tokens. It is worth considering
  if the current flip logic ever needs another fix.
- *`canSetViewGrades`:* its `leader` branch is unused, because `_vgActive()` is quad-only. Drop it, or keep it
  as cheap future-proofing.
- *All cars stop numbers:* number by index (M4) to match every other stop list.

**Blue (rollout, flags, docs).**
- The order is sound:
  1. export prayers;
  2. push, and the additive 0016 runs at build;
  3. read back `Database up to date`;
  4. promote;
  5. curl both routes for a JSON 401;
  6. nothing changes for YS Brisbane;
  7. Prayers off;
  8. Simple on, on a weekday, after filling the coordinators.
- The flags behave as stated. `logins.simple` defaults to off for existing configs and on only through
  `createFirstAdmin`. `modules.prayers` defaults to on. All cars follows `newYouthForms` through `modeAllows`, and
  `canUseNewYouth` is unchanged.
- Add one step before the Simple flip: confirm `structure.gradeMin` is 7 (I1).
- Old cached SPA clients (before `ysc-v90` activates) keep showing a Prayers tab, which 404s until the SW reloads
  them. This lasts one load and is acceptable.
- V2 still needs the CLAUDE.md updates (M9).

---

## Verified OK
- `settings.service.ts` `update()`:
  - it strips `logins.retiredGradeIds` / `gradeRoleWasOn` from the patch before the merge;
  - the rule gives 400 for cohort `none` or Quad off, and forces `roles.enabled.grade = false` while on;
  - on: it collects active grade ids (even when the Grade role is already off) and records them in the **same**
    write as `simple`, `retiredGradeIds` and `gradeRoleWasOn`;
  - after the write it deactivates exactly those ids;
  - off: it restores `gradeRoleWasOn`, reactivates only listed, still-`grade`, still-`inactive` users, and clears
    the list;
  - quads are renamed by role and the `quad` field, and the count is returned only on a flip.
- `setup.service.ts`: `needsAdmin()` is checked before the settings write, so an existing install is never
  touched. The write happens before `createFirstAdmin`.
- `account.service.ts`: a grade create gives 400. Toggling a grade account active gives 400. An update that
  activates a grade account, or converts an active account to grade, gives 400.
- `auth.service.ts`: `login` refuses inactive users. `resolveToken` trusts the embedded actor (the 12 h tail,
  stated in the spec).
- `bus.service.ts`:
  - `allowed()` → `canWithConfig` (Simple on → quad denied `bus:coordinate`), and the coordinator elevation is
    unchanged;
  - `carsView` sits behind `gate('bus:use')` and `modeAllows`, and ignores `as=`;
  - its output has only the allow-listed keys and uses `suburbOnly`;
  - the junior-leader redaction now uses `suburbOnly`;
  - `canSeeCars` uses the same `modeAllows`.
- `bus-logic.ts` `suburbOnly`: it takes only a comma part of the form "Suburb STATE 1234", rejects digits and street
  words, and returns blank otherwise. `src/tests/bus.cars.test.ts` walks every key and string.
- `leader.service.ts` `setViewGrades`: it validates `canSetViewGrades` → zod (min 1, nullable) → existence → range
  (and the bracket for a quad), then de-duplicates and sorts the grades.
  - Supabase `setViewGrades` updates only `view_grades`. `save` / `saveMany` never list it. `toLeader` tolerates
    the column being absent.
  - The in-memory repo keeps the stored `viewGrades` on `save` / `saveMany`.
- `prayer.service.ts`: `requirePrayersModule()` runs first in all 8 methods. With no `settingsRepo`, Prayers counts
  as on.
- `migrate/runner.ts`: `assertUniqueVersions` runs in both `listMigrationFiles` and `runMigrations`.
  `0016_leader_view_grades.sql` is additive (`add column if not exists`), and `LATEST_MIGRATION = '0016'`.
- Routes: `PATCH /leaders/:id/view-grades` and `GET /bus/run/cars` sit under the existing `leaders` / `bus`
  prefixes, which are already in the `vercel.json` regex and the `sw.js` `API_RE`. `CACHE` is bumped once
  (`ysc-v89` → `ysc-v90`).
- SPA:
  - `_navSlots`: 2+ modules give More, 1 module gives a plain tab, 0 gives no slot. The bar and the quick actions
    split on the base index.
  - `_isRootPage` follows the bottom bar.
  - `_prayersOn()` gates the prefetch, My Connections, the student-detail button, the leader quick actions,
    `render()`, Admin Data and the New Year wizard.
  - The MODULE_DISABLED refresh is guarded against re-entry. `/prayers` is not a `/batch` section, so the
    error reaches `r()`.
  - `quadLabel()` is used at every former `QUAD_LABELS` / `QLBL` / `QUAD_LABELS_LOCAL` site, with `esc()` on
    the `innerHTML` paths.
  - `_vgGrades` handles no pick, the default, a saved filter, the bracket clamp and an empty result. Preview never
    saves. `enterPreview` / `exitPreview` clear `yap_leader_id` and `_vgLocal`.
  - `_setupDraft` is reset after a save. The settings file strips the server-owned fields. A preset keeps
    `logins` / `prayers`. The confirm checks the diff of both switches.
  - All cars: the tab shows only when `v.canSeeCars`. It has its own `BUS.cars`, which is fetched only on that tab
    and cleared on logout. It has no buttons, and every value is `esc()`'d.
- `npx tsc --noEmit` and `node scripts/check-spa-syntax.js` are clean.
