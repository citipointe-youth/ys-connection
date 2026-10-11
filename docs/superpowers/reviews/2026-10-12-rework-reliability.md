# Rework review R6: reliability

Reviewer R6. Branch `feat/oct-rework` @ `720a0bc`, compared with `master...feat/oct-rework`.
Scope: partial failures, cache invalidation, migration 0016 on prod, what happens before 0016 is applied, the SW cache bump, and two admins saving at once.
Tests run: `settings.service`, `leader.repo-view-grades`, `migrate-runner`, `schema-version`, `leader.service` (66 tests, all pass).

Counts: Critical 0 · Important 2 · Minor 6

---

## Important

### I1. A stale Youth Setup draft silently flips Junior/Senior logins back and re-activates (or retires) every grade login
- **Where:** `public/index.html` `saveMinistrySetup` (~6449: sends the whole `_setupDraft` as `ministryConfig`), `confirmSaveMinistrySetup` (diffs against `_adminData.settings`, which is the same stale snapshot), `src/services/settings.service.ts:122-144` (applies whatever `logins.simple` arrives).
- **Scenario:** Admin B opens Admin → Youth Setup at 9:00. The draft is seeded from the settings at that time, with `logins.simple: false` (`_ensureSetupDraft`, ~6422). At 9:05 Admin A turns Junior/Senior logins on, which retires 24 grade logins and renames the quads. At 9:10 B changes only the accent colour and saves. B's draft still says `logins: { simple: false }`. The confirm dialog compares B's stale snapshot with B's draft, sees no difference in `logins.simple` and shows no warning. The server sees `wasOn=true`, `isOn=false` and runs the full off-flip: it reactivates all 24 grade logins, sets `roles.enabled.grade` back, clears the list and renames the quads back. B is told "Youth Setup saved. Renamed 4 quad logins", which is the only clue. The reverse also happens: a stale `simple: true` draft saved after A turned it off retires the grade logins again.
- **Why it matters here:** a whole-config save has always been last-write-wins. Before this rework the cost was overwritten labels. Now a stale save also changes which accounts can log in.
- **Fix (pick one):**
  1. Optimistic concurrency. The client sends `baseUpdatedAt: _adminData.settings.updatedAt`. `update()` answers 409 "Youth Setup was changed by someone else. Reload it." when `current.updatedAt !== baseUpdatedAt`. This is the cheapest fix and also covers every other field.
  2. Or the client sends `logins` only when `_setupRiskyDiff(saved, draft)` contains `logins.simple`. The server treats a missing `logins.simple` as "no change", which `mergeMinistryConfig` already does.
  Add a test: the server is on, the patch carries `logins.simple:false` with an old `baseUpdatedAt`, and the result is 409 with no account touched.

### I2. A half-applied flip cannot be repaired by saving again
- **Where:** `src/services/settings.service.ts:162-202`. The settings row is written first (line 162), then the user loops run one `findById` and one `save` per id (166-175), then the cascade (185-191), then the cache invalidation (198-200), then `renameQuads` (202). Nothing is in a transaction, and the flip logic only runs when the stored value changes (`!wasOn && isOn` / `wasOn && !isOn`).
- **Scenario A (on):** there are 24 grade logins. The settings write succeeds with `simple:true` and `retiredGradeIds=[24 ids]`. On user 9 a `users.save` fails (EMAXCONNSESSION, the 15 s statement timeout, or the 20 s route guard cancelling the request on a busy pool). The admin gets an error toast and saves again. Now `wasOn === true`, so `retireIds` is empty, `rolesJustDisabled` is empty (Grade is already false) and `renameQuads` is not called. Result: 15 grade logins stay **active** while Simple logins is on. That is not just the accepted 12-hour token tail, because they can sign in again. The quads also keep their old names, and the three stats caches were not cleared. The `account.service` guard does not catch this, because it only blocks *making* a grade account active.
- **Scenario B (off):** the settings write sets `retiredGradeIds=[]` before the restore loop runs. If the loop fails partway, the ids not yet restored are gone from the only record of which accounts were retired. The admin has to work out by hand which grade logins to unlock.
- **Scenario C (rename only):** `renameQuads` runs after the response body is built from `updated`. If one quad save fails, the PATCH returns 500 although the flip is fully applied. The SPA keeps the old draft (the `catch` path skips `_setupDraft = null`). Saving again is a no-op flip, so the quads are never renamed.
- **Fix:** make the transition converge instead of being edge-triggered:
  - While `isOn`, on **every** save: collect the active grade users, deactivate them, and union their ids into `retiredGradeIds`. Under the guard none should exist, so this is a cheap no-op in the normal case and repairs scenario A on the next save.
  - Off: run the restore loop **before** clearing the list. Write `retiredGradeIds = ids that failed to restore` (or write `[]` in a second settings write only after the loop completes).
  - Call `renameQuads(isOn)` on every save that carries `ministryConfig`. It already skips names that are correct. Return the count only on a flip.
  - Move the three `invalidate*Cache()` calls to just after `repo.updateSettings`, or into a `finally`.
  - Add a test with a user repo whose `save` throws on the Nth call, then a second save that converges.

---

## Minor

### M1. Login (or any full-row user save) can undo a retire
- **Where:** `src/services/auth.service.ts:157-180`, `users.save` is a full-row upsert that includes `status` (`supabase.users.ts` ~74-85). Same for `account.service.update`.
- **Scenario:** a grade login signs in at the moment the flip runs. `login` reads the user (`active`), spends about 100-300 ms in bcrypt, and then writes `{...user, loginHistory}`. If the retire save lands in that gap, the login's save writes `status:'active'` back. The account stays usable after the 12 h tail while Simple logins is on. Nothing re-sweeps it (see I2). *Plausible*: the window is small, and the rollout says to flip on a weekday.
- **Fix:** add `users.setStatus(ids, from, to)` (`update users set status=$to where id = any($ids) and status=$from`) for the retire/restore/cascade loops. Also, or instead, use the convergent sweep from I2, which repairs it on the next save.

### M2. Two near-simultaneous opposite flips leave accounts out of step with the list
- **Where:** `settings.service.ts:132-175`.
- **Scenario:** A turns Simple off. While A's restore loop is still reactivating accounts, B (with a fresh page) turns it back on. B's `findByRole('grade')` sees only the accounts restored so far, so `retiredGradeIds` lists only those. A's loop then reactivates the rest. Those accounts end up active, with Simple logins on, and missing from the list. *Plausible*, because it needs two admins working within about a second. I1's `baseUpdatedAt` check does not stop it if B loaded after A's settings write. I2's convergent sweep repairs it.

### M3. Failed or out-of-order view-grades saves
- **Where:** `public/index.html` `_vgSet` / `_vgSave` (~1456-1475).
  - **Failure:** on an error the code only shows a toast. `_vgLocal[id]` stays, so the screen keeps showing the unsaved filter as if it were saved until the page reloads. Then it snaps back on this phone, and other phones never got it. There is no retry. Suggest: on failure, `delete _vgLocal[id]` and `render()` (the filter reverts visibly, and the toast says why), or keep it and retry once.
  - **Ordering:** a tap at t=0 schedules save 1. A tap at t=0.5 s replaces the timer, but if save 1 is already in flight (a slow pool), save 2 can be sent while save 1 is still open. The server applies them in arrival order, so `view_grades` can end as the *older* pick, while the client cache shows the newer one. *Plausible.* Suggest: chain saves (`_vgPending = _vgPending.then(...)`), or skip sending while one is in flight and re-send `_vgLocal[id]` when it finishes.
  - **Cache race:** a `GET /leaders` that started before the PATCH and returns after it puts the old `viewGrades` back into `Cache`, once `_vgLocal[id]` has been deleted. The filter reverts until the next fetch. *Plausible*, low impact.

### M4. Logout leaves the grade-filter timer and taps behind
- **Where:** `doLogout` (`public/index.html` ~2241) calls `nyReset()` and clears `yap_leader_id`, but not `_vgReset()`. Only preview enter/exit call it (~7354, ~7369).
- **Scenario:** a quad user taps a grade chip and logs out within 600 ms. The timer fires with no token, the PATCH gets a 401, and a raw error toast appears on the login screen. The change is lost. `_vgLocal` also survives, so if the next login on that device picks the same leader, they see the previous user's unsaved pick. **Fix:** call `_vgReset()` in `doLogout` and in `_handleAuthExpired`, or flush with `_vgSave` before the logout POST.

### M5. Migration 0016 can block `leaders` reads for up to 15 s on a busy pool
- **Where:** `supabase/migrations/0016_leader_view_grades.sql`.
- `alter table … add column` (nullable, no default) changes metadata only, but it needs an ACCESS EXCLUSIVE lock. If a long `select` on `leaders` is running during the build, the ALTER waits for it (up to the 15 s role `statement_timeout`), and every new `leaders` read queues behind the ALTER. Home stalls on the live (old) deployment for that time. *Plausible*, because builds rarely coincide with a busy service night. **Fix:** prefix with `set local lock_timeout = '3s';`. The runner applies each file in one transaction, so the change stays local. A timeout then fails the build cleanly, and a redeploy retries.

### M6. Before 0016 is applied, only the new PATCH breaks (as a raw 500)
- On a deployment whose DB lacks the column (a preview pointed at the prod DB, where `shouldRun` skips the migration, or a local `PERSISTENCE=supabase` run), `setViewGrades` throws `column "view_grades" does not exist`. The user sees a generic 500 toast on every chip tap (see M3). All reads and the upserts are safe (see Verified OK). This is acceptable. It is noted here so nobody mistakes it for a prod bug when testing a preview against prod data.

---

## Verified OK
- **0016 is additive:** `add column if not exists view_grades int[]`, nullable, no default, no backfill, and no change to an existing file. Old code on a migrated DB is unaffected: its `select *` → `toLeader` ignores the extra column, and its upserts don't name it.
- **New code before 0016:** `toLeader` maps `row.view_grades === undefined` to `null` (`supabase.leaders.ts:18-20`). `save` (`returning *`) and `saveMany` never list `view_grades`, so they work without the column and never wipe it after. Only `setViewGrades` needs it (M6). No other query names the column (grep).
- **The upsert never wipes the filter:** `save`/`saveMany` exclude `view_grades` in Supabase. The in-memory `withStoredViewGrades` mirrors that. `leader.update`/`updateGrades` pass `...existing`, so the field is never cleared by an edit or the CSV import.
- **`LATEST_MIGRATION = '0016'`**: it matches the highest file, a test enforces that, and `/setup/status` uses `>=`, so the old deployment reading `0016` during the build→promote gap still shows OK.
- **Duplicate guard:** `assertUniqueVersions` runs in both `listMigrationFiles` and `runMigrations` before the lock. It throws `MigrationAbort`, which `scripts/migrate.ts` prints and turns into exit 1, failing the build before anything is applied. The link branch renumbering to `0017` is covered.
- **Runner order is safe:** sort by filename, apply each file plus its version record in one transaction under the advisory lock, and a failure stops the run. The baseline (`<= 0014`) is unaffected. The migration runs in `vercel-build`, so the DB is migrated before the new code can be promoted.
- **Server stats caches:** quad labels in `overview`/`trends`/`lifegroup-stats` now depend on `logins.simple`, and every settings save clears all three (`settings.service.ts:198-200`; skipped only on the failure path in I2). View grades are client-only and touch no server cache. Leaders have no server `ResponseCache`.
- **Client Cache:** `saveMinistrySetup` replaces `S.settings` from the response, deletes `/settings`, sets `_setupDraft = null` (so server-owned `logins` fields can't be carried by a later save), and re-fetches users. Quad labels are computed at render from `S.settings`, so the 30 s Cache holds no stale label. Other devices pick up the change on reopen, as the spec accepts.
- **Server-owned fields:** `retiredGradeIds`/`gradeRoleWasOn` are stripped from every patch before the merge, and stripped again from settings-file export/import on the client.
- **Restore is safe against drift:** it only restores ids that still exist, are still `role==='grade'` and are still `inactive`, and `account.service` blocks creating or activating grade accounts while Simple logins is on.
- **Setup first-admin path:** guarded by `needsAdmin()`. The settings are written before the admin, so a failed create leaves only config behind. No seeded grade accounts exist (`0003` is empty), so there is nothing to retire.
- **Prayers off:** a 404-shaped `ModuleDisabledError`; the SPA refetches settings once (`_mdBusy` guard) and goes home. The data is kept.
- **SW:** `ysc-v89` → `ysc-v90`. The new routes (`/leaders/:id/view-grades`, `/bus/run/cars`) are under prefixes already in `API_RE` and in the `vercel.json` regex, so no allowlist change is needed.
- **`_vgBar` lazy fetch:** it only refetches `/leaders` when nothing is cached, and on failure it does not re-render, so it cannot loop.
