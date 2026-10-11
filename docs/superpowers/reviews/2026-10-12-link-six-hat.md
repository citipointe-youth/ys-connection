# Elvanto link (app side): six-hat review (RV1)

Date: 2026-10-12. Branch `feat/elvanto-link-app` at `905d62e` (diff `origin/master...HEAD`). Read-only review.
Read: the app spec (incl. §17), the frozen contract, the plan (Lane RV), the ledger (1–23), the V1 smoke results,
`CLAUDE.md`, and the code (`link.service.ts`, `sync.service.ts`, `link-rules.ts`, controllers, `express-adapter.ts`,
the SPA `LINK MODULE` block and its hooks). Ran `npx tsc --noEmit` (clean) and
`npx vitest run src/tests/link.service.test.ts src/tests/sync.service.test.ts` (65 passed).

**Counts:** Critical 0 · Important 6 · Minor 13. Sides: app 17, both 1 (M4), app + CONTRACT 1 (M2).

---

## Important

### I1. On a shared login, a leader cannot check out a youth that a colleague checked in (Red, Black)
- **Side:** app. **Files:** `src/services/link.service.ts:369-371` (`owns`), `:395` (undo needs ownership even for a
  sent check-in); `public/index.html:9516-9521` (a row whose newest action is "mine" shows **Undo** instead of
  **Check out**); `link.service.ts:451` (`mine` = same login only).
- **Scenario:** Two leaders share `grade9g` on two phones. A has "I am" = Cody, B has "I am" = Sam. A checks in a
  youth. At 9 pm B wants to check them out. B's row shows "Undo" (the server says `mine: true`: same login), not
  "Check out". B taps Undo → batch `undo` with `leaderId` = Sam → `owns()` fails → `LINK_NOT_YOURS` toast "Only the
  leader who sent this can undo it." B has no Check out button and no way to check the youth out from the app. The same
  happens on one phone after an "I am" hand-over. (Admin/director logins skip the check, so the shadow Friday on the
  admin login will not show this.)
- **Fix:** In `doUndo`, apply the owner rule only when the action is still `pending` (a cancel). For any other state,
  undo is just a check-out, and the spec already says check-out has no owner rule (§8.2). In the SPA, show **Check
  out** on every checked-in row. Show **Undo** only while the item is queued or `pending`.
- **Other side:** no.

### I2. Turning New person On also turns every link screen On for every login, even with no console (Blue, Black)
- **Side:** app. **Files:** `public/index.html:1997-2003` (`moreItems`: link entries only check `_linkOn()`);
  `link.service.ts:238-240` (no console seen yet → every type is allowed); spec §15.
- **Scenario:** The ledger says New person is promoted, and its go-live is "switch On". Ledger 1 binds the link to the
  same switch. If the operator sets `newYouthForms` = On for New person before this branch merges, or before the
  shadow Friday, then promoting the link build gives every login the Check-in, Lifegroup report and Flow steps
  screens at once. No console has been seen, so `capabilities` is null. Every enqueue is accepted, and leaders tap
  "check in" all night. The rows stay `pending` and are refused `too-old` after 3 days. Nothing reaches Elvanto, and
  the only warning is the amber banner.
- **Fix:** (a) Handoff §15: add step 0, "Before you promote, set Elvanto features to Shadow (or Off). New person cannot
  go On until the shadow Friday passes." (b) A cheap guard: hide the non-admin link More entries, and refuse
  `link:use` enqueues from non-admins with `LINK_UNAVAILABLE`, until a console has been seen
  (`status.console.lastSeenAt` not null). Admin keeps everything for matching.
- **Other side:** no.

### I3. The shadow-Friday and test docs still assume New person has a dry run. It is always live now (White, Blue)
- **Side:** app (docs). **Files:** spec §11.4 (`2026-10-12-elvanto-link-app-design.md:562-567`, the "dry run and the
  capability not `live`" rule), §13 step 3 (`:612` "a first-timer (New person in dry run)"), §15 step 5 (`:641-643`
  "adds a first-timer"), §17 I4 (`:661`). Code: `public/index.html:10054-10061` follows ledger 23 (no dry run).
- **Scenario:** The operator follows §13/§15 on the shadow Friday and "adds a first-timer" to test. New person sends
  the real student and parent connect forms to Elvanto (gate removed 2026-10-12). Only the first-timer **check-in**
  is shadowed. A test person made up on the day becomes a real Elvanto submission and must be deleted.
- **Fix:** Rewrite §11.4 to the ledger-23 rule. In §13/§15, say: use a real first-timer, or delete the test
  submission in Elvanto afterwards. Mark §17 I4 as superseded.
- **Other side:** no.

### I4. `/link/batch` turns any non-AppError into a 503 and logs nothing, so one bad item can block a phone's queue for good and its log rows are lost (Black, Blue)
- **Side:** app. **Files:** `link.service.ts:535-538` (catch → 503, `e` is not logged), `:541` (`addLog` runs only
  after the loop), `:230-236` (replays return before the target is set).
- **Scenario:** (1) A code fault in one item's path (a TypeError on unexpected mirror data, say) → the whole call
  503s → the phone retries every 60 s forever. Items before it come back `replay`, and the pill goes red on every
  phone holding that item. The server log has no line saying why. (2) A DB blip on item 30 of 40 → items 1–29 are
  inserted, but their `saved` log rows are thrown away. On the retry they are logged as `replay`, which has no
  `target_kind/id/name` (smoke minor 3). Decision 12's "who did what to whom" then has no person for those actions.
- **Fix:** Log `e` (name + message + stack, never the body). Write the logs collected so far before rethrowing (or
  write them per item). Map only real DB/connection errors to 503. Refuse any other exception on that item alone
  (`refused:INTERNAL`). On a replay, fill the target from the stored row (payload `personId`/`groupId`/`rowId` + a
  roster/group lookup).
- **Other side:** no.

### I5. When tonight's service is missing from the mirror, the top of the pick list is last week's service, with nothing marking it (Black: wrong service) — *Plausible*
- **Side:** app (UI). **Files:** `public/index.html:9557-9564` (`_lkPickHtml`: "The last 7 days, newest first", only
  a "Default" tag), `:9465-9470` (the service line shows the date but no warning); `link.service.ts:257`, `:440`.
- **Scenario:** The console has been offline since Thursday, or its services push does not yet hold tonight's
  service (I could not confirm from the contract whether the 14-day push includes future days). On Friday,
  `defaultServiceTimeId` is null, so the sheet opens with "Fri 9 Oct · Friday Night Youth" at the top. A rushed door
  host taps it. Every check-in that night goes to last week's service. When the console comes back, it checks ~200
  youths in to the wrong week in Elvanto.
- **Fix:** In the pick sheet and the door service line, show an amber "Not today" chip for any service whose
  `ymd ≠ today`. Ask once to confirm before the first check-in tap on a not-today service. Add a line when today has
  no service: "Tonight's service isn't here yet. Use the kiosk."
- **Other side:** no (if the console can push today's services early in the day, that also helps: console's call).

### I6. A whole-row tap checks a youth in at once, and the row jumps into a collapsed list (Red, Black: wrong person)
- **Side:** app. **Files:** `public/index.html:9522` (the whole row is a check-in button), `:9499-9504` (checked-in
  rows move into a closed `<details>`).
- **Scenario:** Busy door, unfiltered list of hundreds. The host taps a row next to the one they meant, maybe while
  the 60 s refresh re-renders the list. The wrong youth is checked in. Their row leaves "Still to come" and goes into
  the collapsed "Checked in · 84". The host gets no sign of who was ticked. To undo it they must open the list and
  find the name. Meanwhile the item flushes after 300 ms, and the console sends it to Elvanto within about 1 min.
- **Fix:** After each tap, show a toast for 5 s: "Checked in <name> · Undo". Undo while still queued removes it
  locally. Or keep the row in place for a few seconds with "Waiting to send" + Undo before it moves.
- **Other side:** no.

---

## Minor

### M1. A check-in for a roster person of kind `other` is accepted, and the leader sheet can reach it (smoke minor 1)
- **Side:** app. **Files:** `link.service.ts:264-267` (checks `active` only), `:145-152` (`rosterPersonOf` matches any
  kind when no `leader` hit exists).
- **Scenario:** An app Leader whose Elvanto person is kind `other` (or a name-alike student) shows as tickable in
  "Check in leaders". Submit → `saved` → the console refuses `no-room` (or checks in the namesake student into the
  Youth Program room). The leader sees "No room for this person. Check in on the kiosk."
- **Fix:** Refuse kind `other` at enqueue with that same message. In `rosterPersonOf`, match only kind `leader`
  (student-leaders: see Green G2). **Other side:** no.

### M2. `resolved` keeps the old `unclear` detail, and `landed: true` sets no `reportId`/`personId` (smoke minor 2)
- **Side:** app (detail); CONTRACT (ids). **File:** `src/services/link-rules.ts:100-104`.
- **Scenario:** An admin sees "Elvanto may not have saved this." on a row that is now `sent`. A resolved
  `submitReport` has `reportId` null, so the overlay skips it and the group can't be edited until the next groups
  push. A resolved first-timer keeps `personId` null.
- **Fix:** Clear `detail` (and `reason`) on `resolved`. Carrying `reportId`/`personId` on `resolved` needs a
  `ResultItem` schema change → CONTRACT; until then, accept it. **Other side:** CONTRACT for the ids only.

### M3. Log rows for `replay` and `LINK_ID_REUSED` have no target (smoke minor 3)
- **Side:** app. **File:** `link.service.ts:230-236`. Low impact on its own (`outbox_id` is there), but see I4.
  **Fix:** As in I4. **Other side:** no.

### M4. Pushes apply while the switch is Off (smoke minor 4). This follows the spec, but Off does not stop minors' roster data flowing in
- **Side:** both (docs + operator). **Files:** `src/services/sync.service.ts:66-83`; spec §2.1, §15 step 8.
- **Scenario:** The operator turns the switch Off as a stop button, or for good. The console keeps pushing the roster
  (names, gender, grade of every youth) every 6 h and services every hour, and the app keeps storing them.
- **Fix:** No code change (the spec intends it). In §15 step 8, add: "To stop all data flow, also stop the console
  poller." **Other side:** console (an operator step).

### M5. The rate limiter counts replays and retries, and the door logins are shared
- **Side:** app. **File:** `link.service.ts:228` (one hit per item, before the replay check); `container.ts:259`.
- **Scenario:** Several door phones on one shared login, on poor Wi-Fi. A flush times out at 20 s after the server
  has already saved it; the retry counts 50 again. About 240 real taps plus a few lost replies passes 300 in 10 min,
  and every phone on that login is then held for up to 10 min ("Too many taps"). *Plausible*. The limit is also per
  instance, so in practice it is looser.
- **Fix:** Count only new inserts (move the check after the replay step), or key it by login + device.
  **Other side:** no.

### M6. A whole-batch 400/404 is retried for ever with no reason shown
- **Side:** app. **File:** `public/index.html:9242`.
- **Scenario:** The switch goes Off mid-night (the stop button). Every phone holding items gets 404 `MODULE_DISABLED`
  every 60 s, shows red "Not saved — tap to retry", and logout says "They could not be sent… (they'll be lost)". A
  malformed item (envelope 400) would block its queue the same way.
- **Fix:** On 404 `MODULE_DISABLED`, stop retrying and show "Elvanto features are off. Do it in Elvanto." On 400,
  drop or quarantine the bad item, not the whole queue. **Other side:** no.

### M7. The phone queue in localStorage holds first-timer names and lifegroup/flow notes
- **Side:** app. **Files:** `public/index.html:9069-9072` (the comment says minors' names never go to localStorage),
  `:9181`, `:10108` (first-timer `firstName/lastName/grade/gender`), `:9911`, `:10013` (note text).
- **Scenario:** On a shared phone, a queued first-timer or a pastoral flow-step note stays in
  `localStorage['ysc.lkq.<id>']` while unsent, and across a session expiry (`_lkSoftReset` keeps the queue).
  Usually that is seconds; with no signal it can be hours.
- **Fix:** Fix the comment. Clear the queue on session expiry if it is older than N hours, or keep notes in memory
  only (they are less time-critical, decision 18). **Other side:** no.

### M8. The door host never sees how a first-timer check-in ended
- **Side:** app. **Files:** `public/index.html:10096-10111`; `:9278-9283` (results with no `personId` are shown only
  as a refusal toast).
- **Scenario:** New person says "Check-in for Fri … is waiting to send." The row then waits for Elvanto approval
  ("awaiting-approval"), or is refused, or is sent. No screen shows any of that to the host. Only the admin's Status
  card does.
- **Fix:** Add a small "New people tonight" list on the door screen built from this phone's first-timer ids
  (`GET /link/actions?ids=`). **Other side:** no.

### M9. The logout guard counts every queued item as a "check-in"
- **Side:** app. **File:** `public/index.html:9320`. A queued report says "1 check-in hasn't been sent yet."
  **Fix:** Say "action(s)", as `_lkSwitchGuard` already does. **Other side:** no.

### M10. "Still to come 580": the door count is the whole active roster
- **Side:** app (Red). **File:** `public/index.html:9499-9500`. Every active Elvanto youth counts as still to come,
  so the big number is noise on a Friday. **Fix:** Show "In N" only, or count people who came in the last term.
  **Other side:** no (unless the roster push should be narrower: console's call).

### M11. The door grade filter is fixed at 7–12
- **Side:** app. **File:** `public/index.html:9467`. With Youth Setup "Include Grade 6" on, Grade 6 youth appear only
  under All. **Fix:** Build the list from `_gradeList()`. **Other side:** no.

### M12. An admin account preview reuses the admin's `LINK` lists
- **Side:** app. **File:** `public/index.html:7505-7516` (`enterPreview`/`exitPreview` don't call `_lkSoftReset`).
  The previewed grade login sees the admin's unscoped lifegroups/flows/"I am" lists until the 60 s refresh. Actions
  taken in a preview are logged as the previewed login. This is consistent with "no preview audit", but it should be
  written down. **Fix:** Call `_lkSoftReset()` in both. **Other side:** no.

### M13. Doc drift
- **Side:** app (docs). Spec §2.5 (`:102`) names `src/tests/migration-numbers.test.ts`; the check is in
  `src/tests/migrate-runner.test.ts:99`. `CLAUDE.md` has no "Elvanto link (app side)" section, and its Key API routes
  table has no `/link`/`/sync` rows (owed in wave 4). Rotating `LINK_SYNC_TOKEN` (both sides, then redeploy) is not
  written down. **Fix:** Update them before V3. **Other side:** no.

---

## Hat notes

**White (claims vs code):** These match: the switch gating (404 everywhere when Off, admin only in Shadow), the
token gate (§10.1), the raw note + `by.leaderName` (decision 17), the "I am" required for the three note types, the
1,800 cap, same-action dedupe, the batch shape, the route checklist (router, `vercel.json`, `sw.js` `API_RE`, `CACHE`
bumped to `ysc-v92`) and migration `0017`. These do not: §11.4/§13/§15 on dry runs (I3), and the test file name
(M13). Smoke observation 5 (no default at 07:40) is **not** a bug: 2026-10-12 is a Monday, and the default applies
only on Friday and Sunday.

**Red (Friday feel):**
- *Door host:* instant ticks and the pill feel right. But a mis-tap is silent (I6), "Still to come 580" is noise
  (M10), and a shared login can't check someone out (I1).
- *Leader:* the report and flow forms are clear, and the "Elvanto will show: Self identified leader" line sets
  expectations.
- *Operator:* a red pill with no reason (M6, I4), and no server log for a batch 503 (I4).

**Black (risk):**
- *Minors' PII on the door list:* name, grade and Leader mark only, held in memory and cleared on logout and on
  no-user render. Showing it to any login is ledger decision 7 (accepted). The exceptions are M7 (localStorage) and
  M4 (the mirror keeps refreshing while Off).
- *Sync token:* handled well.
- *Shared logins:* "I am" is self-asserted. The log can only show the device + login + chosen name. That is accepted
  (decisions 6, 12).
- *Wrong person / wrong service:* I5, I6, M1.
- *Elvanto writes on the admin account:* check-ins carry no leader name in Elvanto (decision 6), so `link_log`
  (400 days) is the only trail. This makes I4's lost log rows matter.
- *First-timer on "unconfirmed":* safe. Because `SUCCESS` is still null, **every** New person send is
  `unconfirmed`, so this path is the normal one. The console matches the approved intake form by name and date, so
  it cannot check in someone whose form never landed. That row waits ("awaiting-approval") and expires `too-old`
  after 3 days. A re-send is deduped on `first:<st>:<name>` while the first row is open. The remaining gap is
  visibility (M8).

**Yellow (keep):**
- The phone queue with client UUIDs, replay-safe on retry.
- The open-row unique index plus same-action dedupe.
- The `effectiveCheckState` rule (shadowed and fresh `sent` rows beat the mirror).
- Actions keyed by the Elvanto `personId`. A wrong app match can never send a write to the wrong Elvanto person
  (`studentId` only feeds the shadow check).
- Bound `leaderId` for junior logins.
- `/sync` ignoring the switch, with Off = no leasing.
- Timing-safe raw token compare, read per request.
- Notes encrypted in the repo; no note or address in any log row.
- The memoised per-call context (one read per mirror per batch).
- The "Practice mode" banner on the shadow Friday.

**Green (simpler):**
- G1: Undo = cancel while pending only; Check out always shown (fixes I1 and drops ownership from the check-in path).
- G2: The leader sheet could list roster rows of kind `leader` (the door list already has them) rather than mapping
  app `Leader` records by name. That removes "Not linked" and M1's name-alike risk.
- G3: Count rate hits on inserts only (M5).
- G4: Per-item refusal instead of a whole-batch 503 for non-DB faults (I4).

**Blue (rollout):**
- The order "Shadow → shadow Friday → console types live one at a time → On" is sound.
- Add I2's step 0: the switch must not be On at promote, and New person can't go On early.
- Fix I3 before the shadow Friday.
- Off is a good stop button for leasing, but phones keep retrying (M6) and pushes keep landing (M4).
- `CLAUDE.md` needs its link section (M13).

## Verified OK
- `checkSyncToken` (`express-adapter.ts`): exact `Bearer `, sha256 + `timingSafeEqual` on the raw strings, 503
  `LINK_OFF` under 32 chars, header never logged. Smoke 9 confirms there are no token hits in the log.
- Off → `/link/*` 404 `MODULE_DISABLED` for admin too (`link.service.ts:166-174`); claim leases nothing
  (`sync.service.ts:38`).
- The door read has only `personId,name,grade,leader,…` (`link.service.ts:454-456`); `LINK.people` is never
  persisted; `_lkClear`/`_lkSoftReset` on logout and on no-user render (`index.html:2140`, `:2343-2344`).
- The note types need a real leader (`link.service.ts:200-205`); a junior `leader` login always uses its bound
  `leaderId` (`:201`, `:368`).
- `listActions`: non-admins see only their own login's rows; `detail` is admin-only (`:500-507`).
- Retention purge (90 d roster / 30 d notes / 400 d log) and the 3-day sweep are in the claim transaction
  (`supabase.link.ts:129-141`).
- Smoke minor 4 (pushes while Off) follows the spec (§2.1); see M4 for the doc note.
- `npx tsc --noEmit` is clean; `link.service` + `sync.service` tests: 65 passed.
