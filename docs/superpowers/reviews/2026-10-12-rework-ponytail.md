# October rework review: R2 "ponytail" (YAGNI, simplest thing that works)

Branch `feat/oct-rework` at `720a0bc`, diff `master...feat/oct-rework`. This was a read-only review. Lens: dead code,
needless abstraction, client/server mirrors that could be one, config nobody asked for, and over-built tests.

None of these findings is a correctness bug, so nothing is Critical. "Important" means the cut saves real code or
removes a second source of truth. "Minor" means a small tidy-up.

**Counts:** Critical 0 · Important 2 · Minor 8

---

## Important

### I1. The server-side Junior/Senior quad labels have no reader: one of the two label paths is dead
- **Files:**
  - `src/services/overview.service.ts:132`
  - `src/services/trends.service.ts:233`
  - `src/services/lifegroup-stats.service.ts:310`
  - their new test cases in `overview.service.test.ts` (+30), `trends.service.test.ts` (+15) and
    `lifegroup-stats.service.test.ts` (+18)
- **What I found:** the branch makes the server's `byQuad[].label` follow `logins.simple`. In the same change the
  SPA stopped reading that field at every place it was read on master:
  - Home quad tiles: master `q.label` at ~2571 is now `quadLabel(q.quad)` at `public/index.html:2701`.
  - Home lifegroup drop: master ~2606 is now 2737.
  - Trends lifegroup drop: master ~4893 is now 5037.
  - `trends.byQuad[].label` was never rendered, even on master. `_hQuadAvg` and line 2335 read only
    `averageAttendance` and `sessions`.

  A grep of `public/index.html` finds no remaining `q.label` read of a server `byQuad` entry. Line 4953 is the
  client-built `quadStats`.
- **Scenario:** an admin turns Simple logins on. Every quad title comes from the client's `quadLabel()`. The server
  work (3 services, a settings read for each label, and 63 test lines) changes no pixel. Later, someone edits
  `SIMPLE_QUAD_LABELS` in `enums.ts` and expects the UI to change. It does not, because the UI uses the client copy.
- **Smaller version:** keep one path. The client needs `quadLabel()` anyway (chips, account forms, Connection Audit,
  role tips), so:
  - revert the three service lines to `QUAD_LABELS[quad]`;
  - drop their label test cases.

  The server still needs `quadLabelFor` only for `renameQuads` and `buildTargetAccounts`. The other choice is to
  render `esc(q.label)` again and keep the server path. Either way, not both. (Spec review I3 asked for both. This
  finding is the case for dropping one.)

### I2. `account.service.update()` refuses a `status` field that the update never writes (dead branch + dead test)
- **Files:**
  - `src/services/account.service.ts:199-204`
  - test `src/tests/account.service.test.ts:376-378` ("update that sets status active on a grade account is 400")
- **What I found:** `wantsActive` reads `input.status`. But the parsed patch is
  `CreateUserSchema.omit({password}).partial()`, which has no `status`, and the `updated` object (209-220) never
  sets `status`. So `update()` cannot activate anything. The only real way to activate an account is
  `toggleStatus()`, which already has its own guard (line 256). The SPA's update call (`index.html:7224`) never
  sends `status`.
- **Scenario:** `PATCH /accounts/users/:id {displayName:'X', status:'active'}` on an inactive grade account while
  Simple logins is on:
  - **today:** 400 "Turn off Junior/Senior logins first";
  - **without the branch:** a harmless rename, and the account stays inactive.

  The check guards a write that does not exist, and a test pins it.
- **Smaller version:** delete `wantsActive` and keep only the role-change clause:
  ```ts
  if (nextRole === 'grade' && existing.role !== 'grade' && existing.status === 'active' && (await simpleOn())) throw …
  ```
  Delete test 376-378.

---

## Minor

### M1. `GET /bus/run/cars` returns three fields nobody reads
- **Files:** `src/services/bus.service.ts:23` and `693`.
- **What I found:** the response carries `serviceDate`, `version` and `readOnly: true` (a constant).
  `_busAllCarsHtml` (`index.html:9002`) and `busRefresh` read only `cars` and `unassigned`. `readOnly` cannot be
  anything but `true`, so it tells the client nothing.
- **Smaller version:** return `{ cars, unassigned }`. Trim `ALLOWED_KEYS` in `bus.cars.test.ts:17` and drop
  `expect(v.readOnly)` at line 90.

### M2. `STREET_WORDS` is exported only so a test can test that it is exported
- **Files:**
  - `src/services/bus-logic.ts:66`
  - `src/tests/bus-logic.test.ts:87-90` ("STREET_WORDS is exported")
  - `src/tests/bus.cars.test.ts:3,54`
- **Smaller version:**
  - Make it a module-private `const`.
  - Delete the "is exported" test.
  - In `bus.cars.test.ts`, assert `suburbOnly(...)` results against a fixture value, or use a local regex.

  The `suburbOnly` table tests already cover the street-word rule.

### M3. The duplicate-migration guard is checked three times
- **Files:**
  - `src/migrate/runner.ts:49` and `54`
  - tests `migrate-runner.test.ts:100` and `109`
  - `schema-version.test.ts:15`
- **What I found:** the only caller, `scripts/migrate.ts:23`, does `runMigrations(db, listMigrationFiles(dir))`, so
  `assertUniqueVersions` runs twice on every build.
- **Smaller version:** call it once, in `runMigrations`, which tests can feed directly. Drop the
  `listMigrationFiles` call and its test. Keep the `schema-version.test.ts` file-system check: it is the cheapest
  guard because it fails in CI before any build.

### M4. Prayers reads settings twice per request
- **Files:** `src/services/prayer.service.ts:52-61` and `110-113`, `147-149` (and every write method).
- **What I found:** `requirePrayersModule()` calls `settingsRepo.getSettings()`, and then `structureScope()` calls it
  again. They run one after the other, so `dedupeReads` (which merges only reads in flight at the same time) does
  not merge them.
- **Smaller version:** have one `cfg()` that reads once, throws `ModuleDisabledError` when `modules.prayers ===
  false`, and returns `structure`. Each method then does `const structure = await cfg();`. This gives the same
  behaviour with one query and one helper fewer. (Plausible cost only. I did not measure it.)

### M5. Stale "until Z1 wires it" comments, and optional deps that are now always wired
- **Files:** `src/services/leader.service.ts:52` and `src/api/controllers/leader.controller.ts:45`.
- **What I found:** Z1 has landed. `container.ts:220` passes `settings`.
- **Smaller version:** delete both comments. Keeping `settings?` optional is fine, because four test call sites
  rely on the default. But the comment should say "optional for tests", not "until Z1".

### M6. `setup.service` passes a default value
- **File:** `src/services/setup.service.ts:122`.
- **What I found:** `gradeRoleWasOn: true` is already the schema default (`ministry-config.ts`).
- **Smaller version:** `{ logins: { simple: true }, roles: { enabled: { grade: false } } }`.

### M7. The Simple-on retirement runs alongside the generic role cascade, re-reading each user
- **File:** `src/services/settings.service.ts:166-169` (plus the cascade at `185`).
- **What I found:**
  - On the off-to-on flip, the code already loaded the active grade users at line ~880 of the diff (`retireIds`).
  - After the write it calls `findById` again for each id and saves.
  - Then the generic cascade (`rolesJustDisabled`) does `findByRole('grade')` and deactivates the same accounts a
    second time when Grade was on.

  The spec allows this ("running it twice is harmless"), but it is two code paths for one effect.
- **Smaller version:** when the flip is on, leave `grade` out of `rolesJustDisabled`, so the explicit list is the
  only path. You could also keep the loaded user objects instead of re-reading by id. Low value, so this is
  optional.

### M8. SPA tests that grep source text instead of running it
- **Files:**
  - `src/tests/spa-oct-prayers-bus.test.ts:19-21, 45-48, 67-76`
  - `src/tests/spa-oct-simple-logins.test.ts:29-32, 212-215, 226-229, 263-281`
- **What I found:** these assert that a regex matches the HTML (`/p === 'prayers' && !_prayersOn\(\)/`,
  `toContain('prayersOn')`, "each screen's body contains `_vg…`"). They break on harmless rewording, and they pass
  if the code is present but unreachable. This is the same debt as M-1 in the earlier review, so it is not new, but
  this branch adds about 10 more. The same files already run the real logic for the important rules
  (`_navSlots`, `_vgGrades`, debounce, preview, `_setupRiskyDiff`, `_busAllCarsHtml`).
- **Smaller version:**
  - Delete the pure source-regex cases that duplicate a behaviour test. These are the render-redirect regex, the
    API-wrapper regex, the "New Year contains prayersOn" check and the "screen body contains `_vg`" sweep.
  - Keep `extractFn`-and-run tests.

  `quad-labels.test.ts:16-22` (an en-dash count on a constant) is also optional.

---

## Considered and kept (not findings)
- **In-memory `withStoredViewGrades` / `save` override** (`in-memory.repositories.ts:136-144`). It looks like extra
  machinery, but it keeps the memory and json repos the same as the Supabase upsert, which omits `view_grades`.
  Without it, an import in memory mode would wipe the filter and no test would notice the Supabase behaviour. Keep
  it.
- **`_moduleDisabledRefresh` + `_mdBusy`** (`index.html:1364`). A bare `location.reload()` would be shorter.
  However, the guard stops N parallel `/prayers` 404s from firing N refreshes, and the reload would drop in-page
  state. The spec (M6) chose this. Keep it.
- **`retiredGradeIds` / `gradeRoleWasOn`.** These cannot be derived. Without the list, "off" would also reactivate
  grade accounts an admin had switched off by hand (operator decision). Keep them.
- **`canWithConfig`.** One line, one call site. It is the smallest way to keep `ROLE_PERMISSIONS` static. Keep it.
- **`buildTargetAccountsClient` gaining `simple`.** This extends an existing, documented client mirror. Making it a
  single shared copy would mean bundling server code into the SPA, which is out of scope.
- **`_setupRiskyDiff`.** A pure helper with a real behaviour test. It earns its place.

## Verified OK
- `canSeeCars` and `carsView` use the same `modeAllows` check. `carsView` builds its response field by field (no
  spread of repo objects), and `as=` is unused.
- `_navSlots()` keeps the base index for the bottom-bar split, so a missing slot does not pull a quick action up.
  Checked against `bottomNavItems`/`quickActionItems`.
- `setViewGrades` writes only through `repo.setViewGrades`. The Supabase `save`/`saveMany` never list `view_grades`.
- The settings service strips `retiredGradeIds`/`gradeRoleWasOn` from client patches before the merge. The SPA strips
  them in `exportSettingsFile`/`_parseSettingsFile`.
- `LoginsConfig` (`ministry-config.ts:162`) is exported but unused anywhere in `src`. It is a trivial type alias, so
  I did not list it as a finding. Delete it if you are in the file.
- Tests run:
  - `npx vitest run src/tests/bus-logic.test.ts src/tests/quad-labels.test.ts`: pass.
  - `src/tests/account.service.test.ts`: 3–5 cohort-layout/guard cases **timed out at 5 s**, and the set of failures
    changed between runs. This looks like bcrypt under machine load (other reviewers share the machine, and
    CLAUDE.md already lists this flake), not a logic failure. Plausible, not proven.
