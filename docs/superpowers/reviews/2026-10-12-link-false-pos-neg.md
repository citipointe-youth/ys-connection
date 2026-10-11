# Link app-side review RV3: false positives and negatives

Reviewer RV3, 2026-10-12. Branch `feat/elvanto-link-app` (`905d62e`), diff `origin/master...HEAD`. Read-only.
Ran: `npx vitest run src/tests/link-rules.test.ts src/tests/link.repository.supabase.test.ts` (62 pass, and the
Supabase DB block is **skipped**).

Totals: **Critical 0 · Important 4 · Minor 10.** Side: app 12, both 2, console 0, CONTRACT 0.

---

## Important

### I1. The leader quick check-in can link a leader to a student and check the student in to Elvanto
- **Side:** app. **Other side:** no change needed.
- **Where:** `src/services/link.service.ts:145-152` (`rosterPersonOf`), used at `:457-461`. The server accepts the
  resulting `personId` because enqueue only checks `r.active` (`:264-267`).
- **Scenario:** an app Leader "Josh Lee" (gender null, which is common for leaders) is **not** in the roster push (for
  example, his Elvanto profile is outside the configured categories). Year 9 student "Josh Lee" is in the roster as
  `kind: 'student'`. Then `hits` holds one row: the student. There are no `leader` hits, so the student row is kept,
  and `personId` becomes the student. In "Check in leaders", Tick all → Submit sends a real Elvanto check-in for the
  **student**. The sheet then shows Josh (the leader) as checked in.
  The gender guard does not help, because `!g || !r.gender` passes whenever either side has no gender.
- **Fix:** match only `kind === 'leader'` rows (contract §6: the console reads two lists, student and leader). With
  no leader row, the result is "Not linked". Add a test where a same-name student exists but no leader row does.

### I2. Auto-match links leaders and inactive people; an inactive "auto" row keeps its student forever, hidden from the admin
- **Side:** app. **Other side:** none. Contract §6 says "rows with match none". Narrowing that to active students is an
  app-side tightening, so the fixtures do not change.
- **Where:** `src/services/link-rules.ts:141-172` (no filter on `kind` or `active`). The purge keeps `auto` rows:
  `supabase.link.ts:135-136` and `in-memory/link.repository.ts:92`. The index counts inactive rows:
  `0017_elvanto_link.sql:47`. `rosterForMatching` lists only active rows: `link.service.ts:577`. `setMatch` returns 409
  if **any** roster row, inactive included, holds the student: `link.service.ts:594`.
- **Scenario A (false link):** the roster has leader "Sam Taylor" (male, `kind: 'leader'`), and the app has a student
  "Sam Taylor" (male) whose Elvanto profile is not in the student list. The leader row auto-matches the student. The
  leader's check-ins then carry that `studentId`, and `shadowCheck` counts them as the student's attendance.
- **Scenario B (stuck false negative):** Elvanto merges a duplicate profile. Old person P1 (`auto` → student S) drops
  out of the push and goes inactive. New person P2 (same name) is active. P2 can't take S, because `taken` holds S
  through P1, so P2 stays `none`. The admin opens Roster matching: P1 is not listed. Matching P2 to S by hand gives
  409 "This student is already matched to someone else". P1 is never purged, because only `none`/`ignored` rows are
  purged. So S is never linked again, and nothing in the UI can fix it.
- **Fix:** in `autoMatch`, consider only `active && kind === 'student'` rows. Leave inactive rows out of
  `rosterKeyCount` too. When a row goes inactive with `match = 'auto'`, release it (`studentId = null`,
  `match = 'none'`). Also let `setMatch` / the admin list show an inactive row that holds the student, so it can be
  released. Add tests for both scenarios.

### I3. The Supabase repo's behaviour is untested, and its SQL-text checks pass under real mutations
- **Side:** app.
- **Where:** `src/tests/link.repository.supabase.test.ts`. The DB block (`:55-79`) runs only with
  `LINK_TEST_DATABASE_URL`. No document records that it ever ran: the V1 smoke used memory. So prod's claim, sweep,
  guarded `applyResults`, open-duplicate mapping and newest-first ordering are covered only by substring checks.
  Mutations that still pass:
  - `:17` `'created_at < now() - '`: change the **sweep** (`supabase.link.ts:129`) to `updated_at < now() - …` or
    `created_at > now() - …`. The test still passes, because the note purge at `:140` also contains the substring.
  - `:17` `'at < now() - '`: **delete** the `link_log` purge (`:141`). It still passes, because the substring matches
    inside `created_at < now() - ` and `updated_at < now() - `.
  - `:17` `'last_seen_at = now()'`: change the insert `values (…, now(), …)` to a JS date. It still passes (the
    `do update` clause still matches).
  - `:39` `expect(body).not.toContain("throw new Error('applyResults")` **cannot fail**. The real guard is a template
    literal (`` throw new Error(`applyResults… ``, `:23`). Adding an inline `` throw new Error(`applyResults…`) ``
    still passes.
  - `:41-44`: change `maybeEncrypt(n.note, noteAad(n.id))` to `maybeEncrypt(n.note, 'x')`. It still passes. In prod,
    every note would then fail to decrypt at claim and be refused `note-unreadable`.
  - `listActions` `order by created_at desc, id desc`: drop `desc`. No text check covers it, but `effectiveCheckState`
    and the step-5 dedupe depend on newest-first order.
- **Fix:** before the merge, run the shared suite once against a scratch Supabase branch (plan line 636) and record
  the result in the ledger. Tighten the text checks to look inside each method's slice (sweep, purge, insert), the
  way the `applyResults` test already slices. Change `:39` to check the backtick form, or delete it.

### I4. The rate limit can stall the door on a busy Friday (Plausible)
- **Side:** app.
- **Where:** `link.service.ts:228` (one hit per item, **before** the replay check), `:28-29` (300 per 10 min),
  `container.ts:259` (keyed by `actor.id`), `rate-limiter.ts:15-26` (a fixed window from the first hit).
- **Scenario:** the Junior/Senior quad logins are shared (ledger 2), and the door screen accepts any login. One shared
  login on three phones at 7:00–7:10 pm: about 200 youth, 40 leaders from "Check in leaders" (one batch, 40 hits),
  undos and first-timers. Replays also count. A batch that times out at the client's 20 s is re-sent whole, so a
  50-item batch costs 100 hits. Every phone on that login then gets "Too many taps. Wait a minute." until the window
  that opened at the **first** tap ends, which can take up to 10 minutes. Items stay queued (`index.html:9262`), so
  nothing is lost, but the door list shows "waiting" during the rush.
  A 40-leader batch on its own is fine: 40 is under the 50 cap and 300 is the limit.
- **Fix:** count only new inserts. Move the limiter after the replay check, and skip `duplicate` results. Key it by
  `actor.id + device.id`, or raise the cap for `checkIn`/`checkOut`. Keep a test where 300 replays are **not**
  limited.

---

## Minor

### M1. Dedupe merges in-out-in into in-out: the final check-in is lost while rows are pending or unclear
- **Side:** app. **Where:** `link.service.ts:313-321` (step 5), then `:325-334` (the open-unique index returns
  `duplicate`).
- **Scenario:** the console is offline (banner "Actions are queued"). Phone A checks in X, giving a pending checkIn.
  Phone B taps Check out (allowed, since X is in), giving a pending checkOut. Someone checks X in again. Step 5 sees
  `live = checkOut` and `st.in = false`, so it inserts. The index hits the first pending checkIn, so the server
  replies `duplicate` with that row. The phone shows **In** (`_lkApply`). The console then runs checkIn, then
  checkOut, so Elvanto has X **out**.
  The same mechanism applies when the old checkIn is `unclear`: X can never be checked in again for that service
  until an admin resolves the row.
- **Fix:** for a new checkIn whose newest live row is a **pending** checkOut, `cancelPending` that checkOut and return
  the existing checkIn as `duplicate`. Do the same for out-in-out. If the opposite row is claimed or unclear, refuse
  with a clear message ("Still sending, try again in a minute") rather than a silent `duplicate`.

### M2. A practice (shadowed) check-in blocks a real one after the console turns the type live mid-service
- **Side:** app. **Where:** `link-rules.ts:183-185` (shadowed decides `in`) and `link.service.ts:319`.
- **Scenario:** the console switches `checkIn` from shadow to live at 7:15 pm. Re-tapping someone checked in at
  6:45 pm returns `duplicate` with the shadowed row, so the real check-in is never sent.
- **Fix:** don't let a `shadowed` row count as `in` for the step-5 duplicate check (keep it for display). This may be
  intended, so it needs an operator call.

### M3. `resolved` keeps the old reason and detail (V1 smoke minor 2), and the loose tests can't see it
- **Side:** app. **Where:** `link-rules.ts:102-104`. A row swept to `unclear`/`lease-lost`, or one carrying an unclear
  `detail`, becomes `sent` with `reason: 'lease-lost'` and `detail: "Elvanto may not have saved this."`. The admin
  list (`detail` for link:admin, `link.service.ts:506`) shows a misleading line on a sent row. The leader text ignores
  the reason for `sent`, unless the reason is `already`.
- **Tests that can't fail:** `link-rules.test.ts:138, 146, 150, 154, 158, 167` all use `expect.objectContaining`.
  Removing `reason: null, detail: null` from the `sent` branch (`:115`) still passes. A claimed row coming back from
  `retry` (`reason: 'awaiting-approval'`) would then show "sent" with a stale reason. Adding nothing to the `resolved`
  branch also passes.
- **Fix:** `resolved` → `reason: null` (landed) or `'not-landed'`, and `detail: null`. Use exact `toEqual` on `next`
  in these tests.

### M4. The server accepts a check-in for a roster `other` person (V1 smoke minor 1)
- **Side:** app. **Where:** `link.service.ts:264-267` (checks `active` only). The door list shows only student and
  leader (`:454`).
- **Scenario:** a stale cached list or a crafted call checks in a parent (`kind: 'other'`) and sends a real Elvanto
  check-in.
- **Fix:** for `checkIn`, require `kind` to be student or leader. Allow `checkOut` for any kind, so an existing
  check-in can still be undone.

### M5. Replays: the log row has no target, and a changed note or leaderId counts as a replay (V1 smoke minor 3)
- **Side:** app. **Where:** `link.service.ts:230-235`. A replay returns before step 4 fills `tgt`, so `link_log` has
  `target_kind/id/name = null`, and `LINK_ID_REUSED` has the same gap. `stable(prev.payload) === stable(it.payload)`
  ignores `note` and `leaderId`, so the same id with a new note is reported `replay` and the new note is silently
  dropped.
- **Fix:** fill `tgt` from `prev` (personId → roster name, groupId, rowId). Include `note` and `leaderId` in the replay
  equality (compare hasNote plus the leaderId). That turns a changed note into `LINK_ID_REUSED`.

### M6. The check state compares the console's clock with the server's clock (Plausible)
- **Side:** both. **Where:** `link-rules.ts:184`: `resultAt` (server, `sync.service.ts` `now()`) > `takenAt`
  (console). Contract §8.4 says the console clock decides only the `takenAt` order.
- **Scenario:** the office PC is 2 minutes fast, or stamps `takenAt` at the end of a slow read. A check-in sent at
  19:01 server time is hidden by a 19:00 snapshot stamped 19:02. The row shows **out** for up to 60 s, so a leader
  taps again and the console answers `already`.
- **Fix:** app: let the row decide while `resultAt + 120 s > takenAt`. Console: stamp `takenAt` at the start of the
  read. This needs no contract change.

### M7. The auto-match key misses real matches: whitespace and grade
- **Side:** app. **Where:** `link-rules.ts:135` lower-cases only. `RosterRow.lastName` is `Text(60)`, which is not
  trimmed (`link-contract.ts:278`).
- **Scenario A:** "Smith " (trailing space) or "Mary  Ann" never matches. Note that `rosterPersonOf` uses `fold`, so
  the two matchers disagree.
- **Scenario B:** two app students named "Josh Smith" (Year 8 and Year 11) are both `ambiguous` even though the
  roster grade tells them apart.
- **Fix:** fold the whitespace in `nameKey`. Use the roster grade as a tie-break only when exactly one candidate's
  grade is equal. Keep the import's key for the import itself.

### M8. `lastMeetingDate` reads "Monthly" as Monday and "Sunset" as Sunday
- **Side:** app. **Where:** `link-rules.ts:57` (`\b(sun|mon|…)[a-z]*\b`).
- **Scenario:** a group whose `meets` is "Monthly" gets the last Monday as its default report date.
- **Fix:** match full day names or the exact 3-letter forms: `\b(sun(day)?|mon(day)?|tue(s(day)?)?|…)\b`.

### M9. The app trusts the service `ymd` from the console (Plausible)
- **Side:** both. **Where:** `link-rules.ts:40, 47` and `link.service.ts:260` (`serviceDate = svc.ymd`).
- **Scenario:** if the console ever derives `ymd` in UTC, a Sunday 8:00 am service (Saturday 22:00Z) is filed under
  Saturday. It then drops out of Sunday's default, and its `service_date` and too-old window are a day off. The 10:15
  and Friday services are safe either way.
- **Fix:** the app ignores or flags a row whose `ymd !== brisbaneToday(startsAt)`. The console confirms it uses the
  Brisbane date. No fixture change.

### M10. The SPA test prelude copies a constant
- **Side:** app. **Where:** `link.spa.test.ts` prelude `const LK_DOOR_TYPES = ['checkIn', 'checkOut']` (a copy of
  `index.html:9080`). Today it matches. If the real constant changes, the tests keep the old value.
- **Fix:** add `LK_DOOR_TYPES` to the extracted names, or read it with a regex. Everything else in that harness runs
  the real functions.

---

## V1 smoke minors, ranked
1. Check-in for a roster `other` person: **Minor** (M4). Real Elvanto write, but only from a stale or crafted request.
2. `resolved` keeps the old `unclear` detail: **Minor** (M3). Admin-only confusion, and the tests can't catch it.
3. Replay log rows have no target: **Minor** (M5). Hurts the "who did this" audit. Also, a changed note is silently
   dropped.
4. Pushes apply while the switch is Off: **not a bug**. Spec §2.1 says `/sync/*` ignores the switch, so the mirror
   stays fresh. Only leasing stops (`sync.service.ts` `max = 0`).

## Verified OK
- `brisbaneToday` flips at 14:00Z. `addDays` and `weekdayOf` use UTC dates, so there is no DST drift. The log range
  uses Brisbane midnight (`brisbaneStart`).
- `pickList` keeps today−7 … today, drops future services, and puts the later start first on the same day.
  `defaultService` follows spec §2.3: Friday's only service, Sunday's only 10:15, none for two or more. The SPA copy
  (`_lkDefaultSvcFor`) has the same logic and is tested as the real function.
- Too-old is 72 h from `created_at` in both repos (contract §3.2). The sweep still runs when the switch is Off and on
  `max: 0`.
- Two phones checking in the same person give one row (step 5, plus the open-unique index as backstop). Replays come
  back `replay`.
- When a leader and a student share a name and both are in the roster, `rosterPersonOf` prefers the leader row, and
  `autoMatch` makes both `ambiguous` instead of guessing.
- `autoMatch` never offers a student another row already holds, so `setMatches` can't hit the unique index after a
  push.
- `RATE_LIMITED` items stay queued on the phone and are retried every 15 s. A batch of 40 leaders fits the 50-item cap.
- The SPA extract-and-run tests run the real `index.html` functions (except M10). `sync.service` tests compare the
  frozen fixtures with exact `toEqual`.
