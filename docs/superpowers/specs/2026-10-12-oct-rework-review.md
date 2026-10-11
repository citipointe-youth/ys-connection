# Review: October rework spec (2026-10-12)

Reviewed: `docs/superpowers/specs/2026-10-12-oct-rework-design.md`
Against: worktree `feat/oct-rework` at `f105c46` (code read, nothing run), repo `CLAUDE.md`, and the
operator decisions in `link/docs/superpowers/elvanto-link-progress.md` (1 to 5).

Counts: **Critical 2 · Important 11 · Minor 10**

Most of the claims about existing code check out. These are verified true:
- `can()` and `ROLE_PERMISSIONS`. `quad` has `bus:coordinate`; `grade` has `bus:roster` but not `bus:coordinate`.
- `bus.service.ts` `allowed()` with the `coordinatorLeaderIds` elevation. `gate()` calls it, and so does `setDropped` (line 1068).
- `buildView` redacts only for `role === 'leader'`.
- `myCar` returns `mobile` and full `snapAddress` for whatever `as=` names.
- `_busQs` sends `getMyLeaderId()`, so Bus's `as=` is the same "I am…" pick.
- `resolveToken` trusts the embedded actor, so the 12 h residual claim holds.
- The role-disable cascade runs after the settings write and only on `true→false`.
- `makePrayerService` already takes an optional `settingsRepo` (3rd argument). `ModuleDisabledError` is a 404.
- `supabase.leaders.ts` `save`/`saveMany` list explicit columns, so leaving out `view_grades` really does protect it.
- The import builds leaders with `{...existing}`, so in-memory keeps the field too.
- `/leaders`, `/bus` and `/prayers` are in all three allowlists. `CACHE` is `ysc-v89`. `LATEST_MIGRATION` is `0015`.
- The runner keys only on the 4-digit number, so the duplicate-`0016` warning is correct.
- `doLogout` clears `yap_leader_id` and the session filters.
- `exportSettingsFile`/`_parseSettingsFile` already strip `busMinistry`.
- `bottomNavItems()` is `slice(0, 5)`. `_isRootPage` already special-cases `prayers` behind More.

The findings below are where the spec is wrong, vague, or unsafe.

---

## Critical

### C1. A normal Youth Setup save wipes `logins.retiredGradeIds`, so turning Simple logins off brings nothing back (decision 2 reversibility)
**Section:** A, "Data model" item 1 ("Set by the server only") and "Turning it on and off".

`saveMinistrySetup()` (index.html ~6289) sends the **whole** `_setupDraft` as `ministryConfig`. `_ensureSetupDraft` reseeds the draft only when it is null, and it is reset only on a tab switch. It is **not** reset after a save.

This is the sequence:
1. The admin turns Simple on and saves. The server records `retiredGradeIds`.
2. The draft still holds `logins.retiredGradeIds: []` and `gradeRoleWasOn: true` from before step 1.
3. The admin changes any other field and saves again.
4. `deepMerge` replaces arrays outright, so `retiredGradeIds` becomes `[]`.
5. Turning Simple off later reactivates nobody.

The same clobber happens with two admin tabs, a settings file, or a raw `PATCH /settings`. It also works the other way: the server would act on client-supplied ids. A client could put any user ids in `retiredGradeIds` (for example a director or quad an admin deliberately deactivated), and "off" would reactivate them.

**Fix:**
- In `settings.service.ts` `update()`, delete `ministryConfigPatch.logins.retiredGradeIds` and `.gradeRoleWasOn` from the incoming patch **before** `mergeMinistryConfig`. Always carry the current stored values forward. Only the on/off transition code may write them.
- On restore, reactivate only ids whose user is still `role === 'grade'` **and** `inactive`.
- In the SPA, null `_setupDraft` after a successful save, or reseed it from `fresh`.
- Add tests:
  - a patch carrying `retiredGradeIds: []` while on leaves the stored list unchanged;
  - a patch carrying a foreign id is ignored;
  - restore skips a non-grade id.

### C2. `suburbOf()` can return a street or a full address, which breaks decision 4 ("no street address") in the new All cars endpoint
**Section:** C, "API" ("`suburb` comes from `suburbOf(snapAddress)`", "It never contains … street or full address") and "Tests to add" (key allow-list test).

`bus-logic.ts` `suburbOf` returns `parts[1]` of a comma split and **falls back to the whole input** when there is no comma. These Google results leak:
- `"Unit 3, 24 Wynnum Rd, Carina QLD 4152, Australia"` gives `"24 Wynnum Rd"`, a street.
- A single-segment or typed address returns verbatim.

In On mode, every `bus:use` login (junior leaders included) gets this for every rider, and the riders are minors. The planned test only fails on a value that **equals** the full `snapAddress`, so it would pass on both leaks.

**Fix:**
- Add a dedicated `suburbOnly(address)` that picks the component matching `/^(.+?)\s+[A-Z]{2,3}\s+\d{4}$/` (the "Suburb STATE 1234" part).
- Return `''` when there is no match. Never fall back to the input.
- Use it in `carsView`. Consider using it in the existing junior-leader redaction too, since it has the same leak.
- Extend the test:
  - fail on any string value that contains `streetOf(snapAddress)` or matches `/\d+\s+\S+\s+(St|Rd|Ave|Ct|Dr|…)/i`;
  - include unit, no-comma and blank-sentinel fixtures.

---

## Important

### I1. The spec builds rider names into All cars against decision 4's "car, stop order, suburb **only**"
**Section:** C, "API" (`name`, `grade` in `stops`), "Rider names (recommendation)", Open question 1.

Decision 4 is binding and says "only". The spec's default adds each minor's full name and grade, and lists that as an open question to build "unless the operator says otherwise". That inverts the burden.

**Fix:** Build `stops: { stop, suburb, dropped }` as the default. Add `name`/`grade` only after the operator explicitly says yes (record it in the ledger). Also confirm with the operator that `leaderNames` counts as "car".

### I2. The Prayers-off nav rules contradict the existing More code and the spec's own scope line
**Section:** B, "SPA, when off" and "The nav slot"; header "Not in scope: the More menu…".

The current code has three dependencies the spec breaks:
- `navItems()` creates the More slot by **replacing the `prayers` item** from `_navItemsBase()`. The spec also removes `prayers` from `_navItemsBase()`, so with Prayers off and Bus + New person on (2 entries) there is no item left to replace. More silently disappears.
- `quickActionItems()` is `navItems().slice(5)`. Dropping the slot shifts the first quick action into the bar **and** removes it from the quick-action grid. A `slot:true` marker on `bottomNavItems` alone does not fix that.
- The spec says "the More code stays as it is", yet it changes `moreItems`, `navItems`, `bottomNavItems`, `quickActionItems` and `_isRootPage`. That is the other instance's code.

**Fix:**
- Keep a placeholder slot item in `_navItemsBase()` (id `'prayers'` or `'slot'`) in every role's list.
- Resolve it in `navItems()` to one of: Prayers, the single module, More, or null.
- Make `bottomNavItems()` and `quickActionItems()` split on the **base index** (5), not on the filtered array.
- Filter the leader Home grid (line 2631) separately.
- Get sign-off from the More-menu owner, or hand them this change, before planning. Today the scope line and the design disagree.

### I3. Server-produced quad labels are missed, so it is not "one name everywhere"
**Section:** A, "Labels".

`overview.service.ts:132`, `trends.service.ts:233` and `lifegroup-stats.service.ts:310` emit `label: QUAD_LABELS[quad]`. The SPA renders `q.label` directly (index.html 2566, 2601, 4804, 4888: the Home "Youth By Quad" tiles, the quad dropdowns, Trends). The spec's line list also misses `quadChip` at 1429 and the `QLBL` uses at 7675–7856.

**Fix:** Pick one:
- the SPA ignores `q.label` and calls `quadLabel(q.quad)`; or
- the three services call `quadLabelFor(quad, cfg.logins.simple)`. Their caches are already invalidated on every settings save.

Replace the line list with "grep `QUAD_LABELS|QLBL|QUAD_LABELS_LOCAL|Girls Yr|Boys Yr|q\.label`". Add a test that no rendered quad label equals the old text while Simple is on.

### I4. Retiring grade accounts depends on a cascade that does not always fire, and the ids are written in a second, non-atomic save
**Section:** A, "Off to on", steps 1–3.

There are two problems:
- The cascade fires only when `before.roles.enabled.grade !== false`. If Grade was already off, active grade accounts can still exist (an admin can unlock one, and account creation is not gated by `roles.enabled`). Those accounts are then **not** retired, which breaks decision 2.
- The cascade runs **after** `repo.updateSettings`, so storing "the ids this step turned off" needs a second settings write. A timeout between the two leaves accounts off with no record of which ones.

**Fix:**
- Before the write, collect `ids = users.findByRole('grade').filter(active)`.
- Store `retiredGradeIds = ids` in the **same** `updateSettings` call.
- Then deactivate exactly those ids, independent of the generic cascade.
- Test the "Grade already off but an active grade account exists" case.

### I5. New installs get `logins.simple = true` but keep `roles.enabled.grade = true`
**Section:** A, "Data model" item 2.

The "grade is forced off while on" rule only runs inside `settings.service.update()`. `createFirstAdmin` writing only `logins.simple=true` leaves the stored config inconsistent until the first Youth Setup save: the Grade section shows in Accounts, and the Grade role appears in the account form.

There is also an ordering risk. If the settings write fails after the admin row is created, `needsAdmin()` caches false and the install can never be retried into Simple.

**Fix:**
- `createFirstAdmin` writes `{ logins: { simple: true, gradeRoleWasOn: true }, roles: { enabled: { grade: false } } }` via `mergeMinistryConfig`.
- Do the settings write **before** `users.createFirstAdmin`. A harmless config on a failed setup is fine.
- The setup test asserts both keys.

### I6. Preset buttons, the settings-file load and other draft resets can turn Simple logins off without the confirm
**Section:** A, "Youth Setup UI".

`pickMinistryPreset()` rebuilds the draft from `MINISTRY_CONFIG_DEFAULTS_CLIENT`. Once `logins` is mirrored there (spec item 1), clicking **"large-graded-au"** while Simple is on sets `logins.simple=false`. The next save then reactivates grade logins and renames the quads back, with no confirm.

`loadSettingsFile()` likewise carries `logins.simple` from another location's file. The spec greys out only the Simple preset.

**Fix:**
- `pickMinistryPreset` preserves `_setupDraft.logins` (and `modules.prayers`, for the same reason).
- `confirmSaveMinistrySetup` diffs `logins.simple` and `modules.prayers` between the saved and the draft config, and shows the Simple or Prayers confirm whenever either changes, whatever caused it.
- Rename the UI wording to avoid "Simple preset" vs "Simple logins" confusion (for example "Junior/Senior logins").

### I7. Admin account preview is not covered, and preview writes real leaders' saved filters
**Section:** A, "The grade filter"; Tests; the RBAC table.

When an admin previews a quad login, the filter appears. Each chip tap `PATCH`es `/leaders/:id/view-grades` for whichever leader is picked, which is a real, persistent change made while "just looking". `yap_leader_id` picked during preview also survives `exitPreview()` into the admin's own session.

In Shadow mode, preview-as-quad gets a 404 on All cars. That is fine, but say so.

**Fix:** Pick one:
- `_vgBar` saves are skipped (kept in memory only) while `_previewStash` is set; or
- the spec states that preview writes are intended.

Also clear `yap_leader_id` on enter and exit of preview, and add an SPA test.

### I8. Rollout gap: once Simple is on, nobody on a quad login can Generate unless coordinators are set up first
**Section:** Rollout step 6; C "Who sees it".

YS Brisbane runs Friday Bus from quad logins today. If `busMinistry.coordinatorLeaderIds` is empty or incomplete when Simple goes on, Car setup, Assign, Generate and Move are gone for every Junior/Senior login. The only coordinators left are the admin and director logins.

**Fix:**
- Add a pre-flight step: the operator fills the Bus coordinator list (and checks each coordinator can pick themselves in "I am…") **before** flipping Simple.
- Show a warning in the Simple confirm dialog when `coordinatorLeaderIds` is empty.
- Add the check to the rollout list.

### I9. Existing non-coordinator paths still expose street and phone, against the plain reading of decision 4
**Section:** C, "What non-coordinators can already see"; Open question 3.

Decision 4 says non-coordinators get "car, stop order, suburb only. No street address, no phone." Under Simple logins, the shared Junior/Senior logins become non-coordinators. They still keep, via `bus:roster`, full addresses and consent notes in `GET /bus/run`, and any car's addresses and mobiles via `GET /bus/my-car?as=<anyone>`. The spec defers this to a later sign-off. That is defensible, but it conflicts with a binding decision as written.

**Fix:** Before Simple logins or All cars goes On, get an explicit operator ruling recorded in the ledger:
- "decision 4 applies to the new screen only"; or
- add the two narrowing changes (redact `GET /bus/run` riders for non-coordinators, and lock `my-car` to a car the `as=` leader is on with phones only for that car) as Part C2.

Also add both endpoints to the allow-list test once that is decided.

### I10. Add a guard against duplicate migration numbers instead of relying on a banner
**Section:** "MIGRATION NUMBER" banner; Rollout 8.

The spec correctly explains that the runner skips a second `0016` forever. But the only safeguard is prose plus a manual rename on the link branch.

**Fix:**
- Add to `schema-version.test.ts` (or `listMigrationFiles`) an assertion that versions are unique. Throw `MigrationAbort` on duplicates in `runMigrations`, so the link branch's rebase fails CI and the build instead of silently skipping.
- Put the "rename to `0017`" instruction in the link ledger as well, not only in this spec.

### I11. The quad rename is keyed on usernames that may not exist in prod
**Section:** A, "Off to on" step 4 / "On to off" step 4.

Usernames are editable (CLAUDE.md). If YS Brisbane's quads are not literally `g79`/`b79`/`g1012`/`b1012`, the rename is a silent no-op.

The "back" labels also differ from the rest of the app. `cohort-account-layout.ts` uses ASCII `Girls Yr 7-9`, while `QUAD_LABELS` uses an en dash.

**Fix:**
- Select by `role === 'quad'` and the `quad` field (all accounts per quad).
- Make the rename helper return a count, and show "Renamed N quad logins" in the save toast.
- Pick one canonical "back" string.

---

## Minor

### M1. Decision 2's "one-time migration" is replaced by a default rule
**Section:** A, "One-time YS Brisbane setup"; Open question 2.

The outcome (Cody sees Year 10) matches. The spec's argument against a stale copy is sound. But the decision text says "pre-set", and the effect is that a quad's "broaden grades" edit silently changes a leader's default view.

**Fix:** Record the operator's acceptance of the rule in the ledger before build. Otherwise ship the one-line backfill.

### M2. "All" is undefined
**Section:** A, "UI".

`Grades: [7] [8] [9] · All` does not say whether "All" saves `null` (meaning "back to my grades") or the full bracket. If it saves `null`, the next login shows the leader's own grades, not All.

**Fix:**
- "All" saves the full bracket.
- Add a separate "My grades" (null) action.
- State that an empty selection is not saveable.

### M3. `PATCH /leaders/:id/view-grades` is open to every `leader:read` role
**Section:** A, "Saving".

A junior `leader` login can overwrite any leader's filter. The stakes are low, but it is wider than needed.

**Fix:** Allow `quad` (any leader) and `leader` (own `leaderId` only). Put this rule in `access-control.ts` per the RBAC-in-one-file rule. Test the 403.

### M4. Several narrowing rules are too vague for a planner
**Section:** A, "Screens it narrows".

Three rules need pinning down:
- How general (no-student) prayers are narrowed: by `createdByGrades` overlap, or shown always.
- Whether a leader with `grades: []` overlaps everything on Connect Setup.
- Which Home tiles count as "per-grade tiles".

**Fix:** Add one rule line per screen, including the `[]`/null cases.

### M5. `viewGrades` construction sites are not listed
**Section:** "Files touched".

A required `viewGrades: Grade[] | null` breaks every Leader object literal:
- `import.service.ts:623`
- `connection.service.ts` auto-create
- `leader.service` create
- `seed.ts`
- the tests

**Fix:** Make the field optional (`viewGrades?: … | null`) or list these sites.

### M6. Users who are already signed in do not see Prayers turned off
**Section:** B, "SPA, when off".

Other logins only fetch `S.settings` at boot. Their Prayers tab stays, and `renderPrayers` swallows the 404 into an empty list.

**Fix:** On a `MODULE_DISABLED` reply from `/prayers`, re-fetch `/settings`, rebuild the shell if `_navSig` changed, and `go('home')`.

### M7. Live quad sessions keep the old labels until reload
**Section:** A, "Labels".

The header badge is built once in `_initShell`.

**Fix:** State this in rollout step 6 ("tell users to reopen the app"), or refresh settings on `visibilitychange`.

### M8. Server does not block grade accounts while Simple is on
**Section:** A, "Turning it on and off" / "Live sessions".

`account.service` does not stop an admin creating or unlocking a grade account while Simple is on. The UI only hides it. Such an account would log in.

**Fix:** In `account.service`, reject `create`/`toggleStatus`-to-active for `role:'grade'` while `logins.simple` (400 "Turn off Simple logins first"). Optionally have `auth.login` refuse grade logins while it is on.

### M9. All cars refresh wiring is not specified
**Section:** C, "SPA".

`_busStartPoll` calls `busRefresh()`, which re-fetches `/bus/run` and `/bus/my-car` only.

**Fix:** Say that `busRefresh` also re-fetches `/bus/run/cars` when `BUS.tab === 'allcars'`. Keep the cars payload in its own `BUS.cars`, never in `BUS.view`, and clear it in `doLogout`.

### M10. The spec has no lane plan
**Section:** "Files touched".

Most work lands in one 9,000-line `public/index.html` and one `settings.service.ts`.

**Fix:** Add a lane table:
1. core config, migration, leader repos, the `view-grades` API;
2. settings cascade, setup, cohort layout, account guards;
3. prayers server;
4. bus `carsView` and `modeAllows`;
5. SPA Part A;
6. SPA Parts B and C, including nav (after I2 is agreed).

Give each lane its owned test files. Note that lanes 5 and 6 must merge serially, and that the `sw.js` bump happens once, last.

Smaller corrections:
- The router note "must come before `/bus/run/vehicles/:id`" is moot. That route is PATCH and has a different segment count. Drop the note.
- Add tests that are missing from "Tests to add":
  - `GET /bus/run` `canSeeCars` per mode;
  - `carsView` returns identical output with and without `as=`;
  - `setDropped` on another car is 403 for quad + Simple on;
  - the C1/C2/I4/I5/I6 cases above.
