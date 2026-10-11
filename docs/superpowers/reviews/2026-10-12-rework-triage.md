# October rework — review triage (orchestrator rulings, 2026-10-12)

Source reviews (all in this folder): six-hat, ponytail, false-pos-neg, edge-cases, ui, reliability, speed.
Totals: 0 Critical · 17 Important (several duplicates) · 57 Minor.
Ruling key: **FIX** (this pass) · **DEFER** (listed in CLAUDE.md "Resume here") · **REJECT** (reason given).
The fix executor fills the Commit column.

## Important

| # | Finding (source) | Ruling | Notes for the fixer | Commit |
|---|---|---|---|---|
| T1 | A stale Youth Setup draft flips Simple logins or Prayers without warning (reliability I1, edge I2) | FIX | Client: send `logins.simple` / `modules.prayers` ONLY when the draft differs from the settings loaded at page open (baseline). When sent, include `expect: <baseline value>`; the server answers **409** `SETTINGS_CHANGED` when the current stored value ≠ `expect` ("Someone else changed this. Reload Youth Setup."). Omitted field = no flip. Tests: a stale colour-only save keeps the logins state; a stale flip gets 409. | bd514c4 (server), c06c4bc (SPA) |
| T2 | A half-applied flip can't be repaired (reliability I2) | FIX | Make the flip reconcile on EVERY save (idempotent). While on: retire any active grade login not yet retired, add it to the list, apply the quad renames, clear the caches. On the off path: restore first; clear each id from the list only after its restore succeeds. Clear the caches right after the settings write. Tests: a failure mid-loop, then a re-save, repairs the state. | bd514c4 |
| T3 | Grade 6 + Simple logins hides grade-6 students from every login (edge I1, six-hat I1) | FIX | Server: Simple logins requires `gradeMin >= 7`. 400 message: "Junior/Senior logins only cover Years 7 to 12. Turn off Include Grade 6 first." Also block turning Include Grade 6 on while Simple is on (mirror message). SPA: grey out each toggle while the other blocks it, with a helpTip. Fix the wrong "Turn off Junior/Senior logins first" wording when turning it ON (six-hat minor, false-pos-neg M1): every 400 must say the correct next step. | bd514c4 (server), c06c4bc (SPA) |
| T4 | New Year Full Reset deletes kept prayers while Prayers is off (six-hat I2) | FIX | Prayers off: the export step shows an amber warning, not "Skipped": "Prayers are switched off but still saved. Turn Prayers on and export them, or tick to confirm they can be deleted." It needs a deliberate tick before step 3 (Full Reset) unlocks. Test it. | c06c4bc |
| T5 | All cars can stay on "Loading…" all night (edge I3) | FIX | Fetch `/bus/run/cars` whenever the All cars tab is shown and on every poll while it is open (not only on a version change). A failed fetch shows "Couldn't load the cars. Tap to retry." Never an endless Loading. | c06c4bc |
| T6 | All cars adds a 3rd request to every Bus refresh; carsView reads riders twice (speed I3) | FIX | Fetch cars ONLY while the All cars tab is active (T5's poll). Server: read riders once in `carsView`. | 78818a4 (server), c06c4bc (SPA) |
| T7 | A grade-chip tap re-runs the page loader → extra /batch, double paint, Follow Up card blanks (speed I1) | FIX | `_vgSet` repaints from the cache only (`_vgRepaint()`), no network. Save the filter in the background (fire and forget, with a toast on failure and a revert). | c06c4bc |
| T8 | "I am…" / "Not you?" on Home doesn't re-apply the filter or redraw the bar; the hint points to a picker ~490 px below (speed I2, ui I3) | FIX | Both handlers call `_vgRepaint()`. Hint text: "Pick who you are below to use your grades" (or move the bar under the picker; fixer's choice, keep it simple). | c06c4bc |
| T9 | The Bus nav slot label isn't escaped (XSS path) and wraps at 360 px (ui I1) | FIX | `esc()` the label; `mbl:'Bus'` for the bottom bar. Add a test with a label containing `<img onerror>`. | c06c4bc |
| T10 | Grade chips are 32×30 px (ui I2) | FIX | `.vg-bar .fc{min-height:40px;min-width:40px}` (or the pointer:coarse block). | c06c4bc |
| T11 | `suburbOnly` returns "" for real Places text with no postcode; multi-word suburbs are blank (false-pos-neg I1, M2) | FIX | Postcode optional; handle "Carina QLD, Australia", "St Lucia QLD 4067", "Petrie Terrace QLD, Australia", "Unit 3, 24 Wynnum Rd, Carina QLD, Australia". Still return "" when unsure, and NEVER a number or a street word. Use the repo fixture formats as test cases, plus every old leak case. | 78818a4 |
| T12 | The "ignores as=" test can't fail; the allow-list/phone checks run as admin only (false-pos-neg I2) | FIX | Two cars in the test world; run the allow-list + phone + street checks for all five roles + an as= coordinator. | 78818a4 |
| T13 | Server-side quad labels are dead code (ponytail I1) | FIX | Remove the `byQuad[].label` additions in overview/trends/lifegroup-stats and their tests. The client `quadLabel()` is the single path. Confirm first with grep that no export or SPA code reads `.label` from those payloads. If something does, REJECT instead and say why. | 47865d4 |
| T14 | `account.service.ts:199-204` refuses `status`, which an update can't contain (ponytail I2) | FIX if dead | Check that the update schema strips `status`. If it is truly unreachable, delete the check and its test. If the reviewer's "harmless rename → 400" is real, write a test that proves it first. | ca36910 |

## Minor — FIX (cheap)

- Long rider names on All cars: ellipsis (ui). → c06c4bc
- The confirm shows Bus coordinator warnings while Bus is off: hide them (ui). → c06c4bc (also ui M2 wording: no "turns off 0 grade logins")
- A stale `/prayers` call bounces users to Home from any screen: only redirect when the user is ON the prayers page (six-hat). → c06c4bc (other pages re-run `render()`)
- All cars shows "stop 0" when `stopOrder` is null: show no number, sort nulls last (six-hat). → 78818a4 (server: nulls last, the rest numbered 1..n like Assign), c06c4bc (SPA: no number)
- `doLogout` doesn't call `_vgReset` (reliability). → c06c4bc (also both `_handleAuthExpired` branches; the preview branch also clears the "I am" pick, edge M4)
- A login's full-row save can undo a retire: guard in the account save path (reliability). Test it. → ca36910 (login re-reads the user after bcrypt and refuses if no longer active; the saves use the fresh row)
- "save never wipes view_grades" is tested on the in-memory repo only: add a SQL-text test that the Supabase upsert column list excludes `view_grades` (false-pos-neg M4). → cb39db8 (mutation-checked: adding `view_grades = excluded.view_grades` fails it)
- SPA tests that check copies of `QUAD_LABELS` / `_simpleLoginsOn`: make them extract the real functions (false-pos-neg M3). → c06c4bc (plus a client = server `quadLabelFor` check)
- Prayers service reads settings twice per call; carsView-related double reads (ponytail/speed): one read. → cb39db8 (prayers), 78818a4 (carsView and buildView share one riders read)
- Stale "until Z1 wires it" comments; `STREET_WORDS` exported only for a test (inline it or keep it unexported); a schema default passed by hand (ponytail): tidy. → bd514c4 (setup default), 78818a4 (`STREET_WORDS` private), cb39db8 (comments, unused `LoginsConfig`)
- Unused fields in `/bus/run/cars` (ponytail): drop them. → 78818a4

Also fixed (unlisted, under ~10 lines each):
- setViewGrades: `findById` + `getSettings` in parallel, no re-read after the write (speed M3). → cb39db8
- Turning Simple on with Grade on no longer runs the generic role cascade on top of the retire list (ponytail M7, was in DEFER pending T2). T2 rewrote the path, so the retire list is now the only path for grade logins while on. → bd514c4
- After a save the draft is reseeded from the saved config instead of `null` (edge M7). → c06c4bc
- The Prayers-off dialog offers Download CSV only when Prayers is saved on, and says to press Save (edge M8, false-pos-neg M6, ui M8). → c06c4bc
- Quad role greyed while the draft has Simple on (edge M6, second half); Junior/Senior toggle greyed with the right reason when the cohort model or Quad role blocks it (false-pos-neg M1, six-hat M1). → c06c4bc
- A one-line help text under the presets while Simple is on (ui M3); helpTip wording (ui M4). → c06c4bc
- Grade bar: `role="group"`, `aria-pressed`, disabled chips not shown as selected (ui M7, part). → c06c4bc
- All cars with 0 cars still shows the "not on a car yet" count (edge M11, first half). → c06c4bc
- A failed grade-filter save reverts the local pick, repaints and toasts (reliability M3 failure, edge M5). → c06c4bc
- Settings PATCH accepts an `expect` object (T1); server 400 messages split by direction (six-hat M1). → bd514c4
- `/bus/run/cars` response is now `{ cars, unassigned }` and `stop` may be null. → 78818a4

### Notes where the fix differs from the ruling text
- T1: `expect` is a top-level PATCH field `{ simple?, prayers? }`, not nested in `ministryConfig`. A patch WITHOUT `expect` is still accepted (old cached SPAs and raw callers), so the guard covers the new SPA only until the old SW cache is gone.
- T2: on the off path the restore loop runs BEFORE the settings write (not "write, then clear each id"): a failure leaves the stored config (Simple on, full list) untouched, and saving off again finishes the job. The list is cleared in the same single write once every restore succeeded. Quad renames run on every save while on (as ruled) and on the off flip only, so a hand-typed quad name is not overwritten on ordinary saves while off. `renamedQuads` is returned on a flip or when a repair renamed something.
- T3: four messages so each 400 names the step: turning on blocked by cohort/Quad ("…needs the Complex cohort model and the Quad role. Turn those on first."), turning on with Grade 6 (ruling text), Grade 6 turned on while on ("…only cover Years 7 to 12. Turn off Junior/Senior logins first."), and the old "Turn off Junior/Senior logins first" when a save breaks a valid stored state.
- T5/T6: the poll on the All cars tab fetches only `/bus/run/cars` (no version check), so the tab costs one request per 10 s instead of three per version change.
- T8: the hint is page-aware: "Pick who you are below to use your grades" on Home, "…on Home to use your grades" elsewhere.
- T14: the reviewer's "harmless rename → 400" was real (a test proved it first); the dead `wantsActive` branch is gone and that test now asserts the rename succeeds with the account still inactive.

## Minor — DEFER (CLAUDE.md "Resume here")

- One saved grade filter is shared across both brackets (six-hat). This is by design per leader (ledger 2); revisit only if leaders work across brackets.
- `lock_timeout` for migration 0016 (reliability). It is a single `add column if not exists` on a small table.
- The duplicate-migration check runs three times (ponytail). Harmless; it's a guard.
- The race on app open that adds a `GET /leaders` (speed). Measure first.
- ~~A second code path that switches off grade logins on top of the role cascade (ponytail).~~ Done in bd514c4 with T2.
- DEFER: viewGrades writes are not chained (an out-of-order save can leave the older pick) and a `GET /leaders` landing after a save can restore the old value until the next fetch (reliability M3 ordering + cache race).
- DEFER: two near-simultaneous opposite flips (reliability M2): the T2 convergent sweep now repairs it on the next save; no lock added.
- DEFER: before 0016 is applied the view-grades PATCH is a raw 500 (reliability M6); a note for preview testing only.
- DEFER: a quad may set any leader's filter, and one filter per leader across brackets (six-hat M3, edge M3) — by design (ledger 2).
- DEFER: CLAUDE.md docs for V2 (six-hat M6 advisory quad restriction, M8 "kept except Full Reset and student delete", M9 routes/migration/grade-6 limit/12 h tail; edge M10 Prayers-on needs a reload).
- DEFER: junior-leader `GET /bus/run` still carries each car's `endsAddress` (six-hat M7, pre-existing); `_busMapsLinks` reads it, so it needs its own change and test.
- DEFER: Turning Simple off always restores Grade from `gradeRoleWasOn`, ignoring an unticked Grade box (edge M6, first half).
- DEFER: `enterPreview` / `exitPreview` don't reset the BUS session fields (edge M11, second half; cosmetic, nothing leaks).
- DEFER: All cars rows use `.li` (tappable look) and a hard-coded `Y9` chip (ui M6); Youth Setup toggle rows are 22 px (ui M9, pre-existing); "My grades" never shows an on state (ui M7, rest).
- DEFER: the SPA source-regex tests that only check a string is present (false-pos-neg M7, ponytail M8) — same debt as the earlier M-1.
- DEFER: the flip loops are still serial `save` calls (speed M7); fine at ~16 accounts.
- DEFER: Prayers turned off makes every phone rebuild the shell and prefetch once (speed M4, the redirect half is fixed).

## Minor — any not listed above
The fixer reads each review file. A minor not listed here: fix it if it takes under ~10 lines and touches no new
file. Otherwise add it to DEFER with one line.
