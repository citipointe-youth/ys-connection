# Elvanto link, app side: review outcomes (2026-10-12)

## What this is

These are the cross-device triage's rulings on both review sets, written as instructions for the app orchestrator.
Work through the app tasks below in order. Each task names its T-id (the merged list at the end), its source ids, the
approach, where in the code, and the check that proves it. The console side gets a twin file with the same
decisions, the same contract change set and the same T-table.

**Inputs read:**
- App findings (`APP-n`): `Project 13 - Prompt for Projects/ys-connection/2026-10-12-link-app-review-findings.md`
  (branch `feat/elvanto-link-app`, commit 905d62e).
- Console findings (`C-n`): `Project 13 - Prompt for Projects/elvanto-console/2026-10-12-link-findings-console.md`.
- The contract, `docs/superpowers/specs/2026-10-11-elvanto-link-contract.md` (v1), and the link fixtures in both repos.
- The console code on its branch, read only.

**What was and was not checked here.** This PC has only the step 0 app branch, not 905d62e. So app `file:line` refs
come from the app review and were not re-checked here. These were checked in the console code:
- a 500 on `/sync/*` backs off like a 503;
- `ymd` is the Brisbane day;
- services are pushed for today−7 to today+7;
- notes go to Elvanto with no leader name;
- a reclaimed confirmed row answers `already`;
- an empty flow list is never pushed.

The fixtures are the same bytes in git on both branches.

**Binding rules this keeps:**
- Practice never writes.
- Only `shadow === false` is live (console).
- The sent-log guard stays.
- Minors' details stay minimal: no new data leaves Elvanto, nothing new goes into logs or toasts, and the admin
  roster reply gets smaller.

## Decisions for the operator

The operator answered D1–D4 on 2026-10-12. D5 is still open; the plan uses the recommendation, marked **pending
operator**.

**D1. One switch or two for the link screens (T-26, from APP-1). Decided 2026-10-12: keep one switch.**
The link screens stay under the New person switch. To start, only the admin sees them, in shadow mode, so a rough
edge is acceptable. APP-1's fix is not done now. **Revisit before leaders get access**: either give the link its own
switch, or hide the screens from non-admins until a console has been seen.

**D2. Who writes the leader's name into Elvanto notes (T-1, new). Decided 2026-10-12: the app.**
The operator's earlier decision stands. For a report submit, a report edit and a flow tick, the app puts the
self-identified leader's name in front of the note text it sends: `Self identified leader: <name> — <note>`. When the
leader wrote no note, it sends `Self identified leader: <name>` alone. The console adds nothing; it already sends the
note as received. Until this lands, live reports and flow steps reach Elvanto with no leader name.

**D3. Which-service edge cases (T-32, from APP-53 and APP-54; this extends decision 11). Decided 2026-10-12.**
Before 03:00 Brisbane time, the default is the previous day's service (for check-outs after midnight on a Friday).
Sunday stays 10:15 only, so a Sunday evening service is picked by hand.

**D4. A scratch database for one real-Postgres run (T-25, from APP-2). Decided 2026-10-12: not now.**
The risk is accepted for the practice phase. Only the memory-mode tests have run, so the claim, sweep, result locking
and note encryption are unproven on real Postgres. A deadlock or statement timeout can reach the console as a raw 500,
and the console backs off on a 500. The task stays listed as deferred. **It is required before leaders go live.**

**D5. The first live send of each type (T-11, from C-10).**
Recommended: turn a type live outside the service window, when the app shows no waiting rows of that type. Then make
one real action of that type yourself in the app, check it in Elvanto, and only then leave it live. For an edit, use a
real correction to a recent report. For a first-timer, use the next real first-timer on a Friday and watch the row.
Never use a made-up person: New person always sends for real. **Pending operator.**

Operator action (not a decision, but the practice Friday needs it): run the read-only roster probe and fill the
console's two category lists (T-13). Until then the console pushes no roster, and the door list is empty.

## Contract change set: v1 holds (text only)

**No fixture, schema, `/sync/*` shape, reason code or status changes. `contractVersion` stays 1.** The fixtures are
already the same bytes in git on both branches. The contract has not been released, so the text is amended in place,
as on 2026-10-12. The app side edits the contract file in its repo. The console side makes the same changes in its
console spec and in `spike/verify-ys-link-contract.js`. Both sides land them in the same step.

- **X1 (§7.1, §5.2, §3.2; T-1; D2 decided 2026-10-12) Attribution: the app prefixes the name.** Delete the §7.1
  console-signature rule (the `— via YS Connection (<leader name>)` line and its replace-on-edit) and write instead:
  "For `submitReport`, `editReport` and `completeStep`, the app puts the self-identified leader's name in front of the
  note text it sends in the claim row's `note`: `Self identified leader: <leaderName> — <note>`. When the leader wrote
  no note, `note` is `Self identified leader: <leaderName>` alone. The console adds nothing and changes nothing: Submit
  and Complete send `note` as received, and Edit sends Elvanto's notes + `\n` + `note` as received, never replacing an
  older line. Check-in, check-out and first-timer carry no text (`note` null)." In §5.2, "note + signature" becomes
  "`note` as received" in all three places. In §3.2, `note` is the text to write, not only the leader's own words. The
  app stores the leader's own note and builds the prefixed text when it builds the claim row. It caps the leader's
  own note so the prefixed text fits the existing 1,900-char `note` cap, so the cap is unchanged. `note-too-long` on
  an edit counts the whole text (2,000). The fixtures stay as they are: their notes are valid example text.
- **X2 (§7.3; T-12; console decision 3) Cadence table.** Services push: every 5 min in the window, hourly outside.
  Groups push: hourly, outside the window only. Flows push: every 15 min, only while the console's flow list is not
  empty. Roster push: at window start and every 6 h outside, only once both console category lists are set (until
  then there is no roster push and the door list is empty). A failed push waits for its normal interval, like a good
  one. Claims are timed from the start of the last tick.
- **X3 (§7.3; T-12) Window fallback.** If the services read fails, the console stays in the window and reads again in
  5 min. "No YS service today" is kept for one hour, then read again. This replaces "Friday 17:00–23:00".
- **X4 (§5.3 row 5; T-6) Blocked key.** `sent-log-blocked` → `retry`, `console-busy`, 300 s (was `unclear`). The row
  runs again, reading first, once the open key is settled.
- **X5 (§3.3, §5.3; T-4, T-6) Resolved and ids.** `resolved` with `landed: true` → `sent`, with `reason` and `detail`
  set to null. With `landed: false` → `refused`, `not-landed`, and `detail` set to null. `already` and `resolved` carry
  no ids. A `submitReport` settled by `resolved` or by a reclaim (X6) may have no `reportId`. It gets one from the next
  `groups` push (the §3.3 "required" becomes "when known"). A first-timer answered `already` (the kiosk got there
  first) keeps `personId` null.
- **X6 (§3.2 sweep, §8.3; T-5, T-4, T-24) Lost leases.** The sweep's `lease-lost` step skips rows whose `lease_owner`
  is the console making the claim. That console reclaims them instead (same console only, as now). On a reclaimed
  row the console reads its sent-log first. `confirmed` (or resolved as landed) → `sent`, with that line's key as
  `sentLogKey`, and for a first-timer the `personId` taken from that key. `pending` or `not-confirmed` → `unclear`. No
  line → run normally. Before it runs any row that has no sent-log
  line, the console refuses `too-old` if `createdAt` is past the 3-day cut-off. The rows of one claim run in the order
  given. The one exception: first-timer rows may run after the others. If a claim reply comes after the console's
  timeout, its rows stay leased until the lease ends, and the next claim reclaims them (accepted).
- **X7 (§5.5 first-timer, §5.3; T-2) First-timer.** `awaiting-approval` retries every 300 s in the window and every
  900 s outside it. Once a first-timer row is 24 h old and still not approved, or its name never matched, the console
  answers `refused`, `too-old`. The console reads the intake week that holds the service date. Two intake rows that
  resolve to the same person count as one match, not `ambiguous-first-timer`. A student side with a hold or an
  unfinished step (for example an archived profile) is not approved yet.
- **X8 (§6, §5.1, §5.5; T-3) One name fold.** For every name match: Unicode NFKD with the accents removed, curly
  quotes made straight, lower case, no spaces round a hyphen, runs of spaces made one space, and trimmed. It is used by
  the console's first-timer match, the app's first-timer dedupe key (`first:<st>:<fold(first)> <fold(last)>`), the
  app's roster auto-match key and its leader-name mapping. A short name still does not match a full name. X7's 24 h
  refusal covers that case.
- **X9 (§5.3 leader text, §5.4; T-15) Leader lines by type (codes unchanged).** `shadowed` for check-in and
  first-timer: "Practice mode: not sent to Elvanto. Check in the usual way." For check-out: "Practice mode: not sent
  to Elvanto. Check out the usual way." For report, edit and flow step: "Practice mode: not sent to Elvanto. Do it in
  Elvanto as usual." `refused`, `no-room` on a check-out: "They aren't in a room in Elvanto. Check them out in
  Elvanto." `already` on a flow step: "Done once already ✓. If it's back on the list, do it in Elvanto." `detail` is
  for the admin only. The console takes it from its own table keyed by reason (no PII, 300 chars at most), never from
  a route's message.
- **X10 (§3.4; T-8, T-16) Pushes.** `rows: []` is a valid full replace and means "none now". The console sends it once
  when the flow list goes from some rows to none. People checked in to "No room" are not in `services.checkedIn`.
- **X11 (§8.4; T-21) Clocks.** `takenAt` is the console's server-corrected time (the console clock plus the offset
  from `serverTime`), taken when the read starts. The app lets a person's own outbox row decide their state while
  `resultAt + 120 s > takenAt`.
- **X12 (§7.2; T-20) Practice and the sent-log.** Practice does not ask the sent-log. So it can answer `shadowed` for
  a key that live would answer `already` or `retry`. This is accepted.
- **X13 (§7.2, runbook; T-11, T-19; D5) Go live and the practice Friday.** Turn a type live outside the window, when no
  rows of that type wait. The operator makes the first live action and checks it in Elvanto. A `shadowed` check-in
  does not count as "in" when the app checks for a duplicate check-in. On the practice Friday, check-ins are compared
  with the import. For reports, edits and flow steps, the admin compares the would-send keys by hand. New person
  always sends for real, so never test it with a made-up person.
- **X14 (§4, §4.1, §3.2; T-10, T-17, T-26, T-42) App-side text.** `/link/batch` replaces the single
  `POST /link/actions` and `DELETE /link/actions/:id` routes (removed). The link screens stay under the New person
  switch (`newYouthForms`, D1 decided 2026-10-12), not a separate `modules.elvantoLink`; revisit before leaders get
  access. A heartbeat with `inWindow: true` and `max: 0` means paused for the weekly sync. The app then shows "Paused
  for the weekly sync. Check-ins go through after it." Outside the window, a pending row adds "Goes to Elvanto within
  15 minutes."
- **X15 (§3, §3.1; T-18, T-25) Base address and errors.** The app is served at its host root. The console calls
  `<origin>/sync/<path>`, whatever path the saved address holds. The console already treats a 500 like a 503 and backs
  off. The app will answer deadlock, serialisation and statement-timeout errors with 503. That is deferred with T-25
  (D4), so until then they can arrive as a raw 500, which the console also backs off on.
- **X16 (§5.2; console departures already built) Room and flows.** The room comes from the person's Demographics
  ticks (console spec §0), not from roster `kind`. No room → `refused`, `no-room`. A `completeStep` for a flow that is
  not in the console's flow list → `refused`, `locked`. Console defaults: `max: 3`, `leaseSeconds: 300`.
- **X17 (§8.6, runbook; T-19) Stopping.** Turning the New person switch (which the link screens share) Off stops the
  screens only. Mirrors still
  arrive. To stop all data flow, also Turn off the link on the console.

Line endings: the app repo adds a `.gitattributes` line, `src/tests/fixtures/elvanto-link/*.json text eol=lf` (the
console repo already forces LF). On this PC the app checkout has `push-flows.json` in CRLF. The fixture bytes in git do
not change.

## Order (both sides)

**Before the first practice Friday** (every type in practice; only the admin sees the link screens; nothing is written
to Elvanto):
- Operator: the roster probe and the category lists (T-13).
- Both: the contract change set (X1–X17) lands on both sides in one step.
- App: T-1 the leader-name prefix (first), T-15 practice lines, T-19 docs, T-41 matching on a phone and disabled
  buttons, T-35 admin matching, T-40 blocked queue, T-31 batch errors and log rows, T-50 line endings.
- Console: T-13 roster, T-2 first-timer reads (or report `firstTimerCheckIn: off` until it lands), T-3 fold, T-9 bad
  result item, T-12 push failures and cadence, T-1 verify case (no code), T-15 `detail` table.

**Before the first live send** (of the type concerned):
- App: T-1 must be in before any live report, edit or flow tick. Then T-5 sweep, T-6 resolved fields, T-7 unclear
  rows named for the admin, T-24 ordering, T-11 shadowed rows not "in", T-30 undo and ownership, T-38 undo in flight,
  T-39 tap time, T-32 wrong service, T-33 wrong person, T-34 leader mapping, T-36 rate limiter, T-37 queue
  ownership, T-44 flush and guards, T-45 stale refresh, T-3 fold and T-2 first-timer status (before first-timers go
  live), T-8 empty push (before flows go live).
- Console: T-4 reclaim answers, T-5 cut-off check, T-6 blocked key, T-7 tell the admin, T-11 go-live runbook,
  T-14 one key source, T-8 empty flow list (before flows go live), T-27 confirm that link-written reports stay
  editable.

**Before leaders get access** (deferred by the operator, 2026-10-12): T-25 the real-Postgres run and 503 mapping
(D4), and T-26 the link switch revisit (D1).

**Can wait:** T-10, T-16, T-17, T-18, T-20, T-21, T-22, T-23, T-27 (app overlay), T-42, T-43, T-46, T-47, T-48, T-49.
T-28 and T-29 are not being done.

## App tasks, in order

Run the app's checks after each task: `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`. Bump
the `sw.js` cache once per batch that changes `public/index.html`. Refs are at 905d62e.

### A. Before the first practice Friday

**A1. T-1: the leader's name in front of the note (D2 decided 2026-10-12; X1). Top task.**
When the app builds a claim row for `submitReport`, `editReport` or `completeStep`, set `note` to
`Self identified leader: <leaderName> — <note>`, or `Self identified leader: <leaderName>` when the leader wrote no
note. `leaderName` is the snapshotted "I am" leader, which ledger 11 requires for these three types. Store the
leader's own note unchanged (encrypted, and `hasNote` still means the leader wrote something), and build the prefixed
text in the `/sync/claim` row mapping. Cap the leader's own note at enqueue, so the prefixed text fits the ClaimRow
`note` cap of 1,900 (about 1,800 for the leader's part). Check-in, check-out and first-timer keep `note: null`. The
console sends `note` as received and adds nothing. This replaces app ledger 17 ("the console composes").
Check: claim tests for all three types, with and without a note. Check-in still gets `note: null`. A 1,900-char
leader note is refused at enqueue with a clear message, or capped at enqueue, never cut off at claim.

**A2. The contract change set and T-50 (line endings).**
Apply X1–X17 to the contract file, word for word, in one commit with contract text only. Add `.gitattributes` with
`src/tests/fixtures/elvanto-link/*.json text eol=lf`, then renormalise. Do not touch fixture content,
`LINK_CONTRACT_VERSION` or the manifest.
Check: `link-contract.test.ts` passes unchanged. `git ls-files --eol src/tests/fixtures/elvanto-link` shows `lf`
in the work tree.

**A3. T-15: lines by type (APP-4; app half of C-18 and C-19; X9).**
`_lkStatusText` and the practice banner pick the line by action type, not by status alone. Add the check-out
`no-room` line and the flow-step `already` line from X9. Codes are unchanged. Where: `index.html:9132` and `:9167`.
Check: an SPA test for each type's `shadowed` line, check-out `no-room`, and flow-step `already`.

**A4. T-19: practice Friday and stop docs (APP-6, APP-26; app half of C-23; X13, X17).**
In the app spec:
- Rewrite §11.4 to ledger 23 (New person always sends).
- In §13 and §15, say to use a real first-timer, or to delete the test submission in Elvanto afterwards.
- Mark §17 I4 superseded.
- Add to §15: "The link screens share the New person switch. To stop all data flow, also Turn off the link on the
  console."
- Add one line on the admin Status card saying the same.

Keep pushes applying while the switch is Off. Why: a stale or empty roster on the next switch-on breaks the door
list, and the data is the same minimal set either way. Optional, and cheap: show the would-send key next to each
`shadowed` row in the admin Today card (it is already stored).
Check: no "dry run" wording for New person remains in §11, §13 or §15.

**A5. T-41: matching on a phone, and disabled buttons (APP-18, APP-19).**
- The candidate row gets its own class: `span{flex:1 1 auto;min-width:0}`, with the button `flex:none`
  (`index.html:780`, `:10190-10191`). Do not change `.lk-kv` itself.
- Add `.btn:disabled{opacity:.45;cursor:not-allowed;transform:none}` (`:161`).

The shadow comparison needs matching, so this lands before the practice Friday.
Check: at 360 px the Match button sits inside the card (measure it as the UI review did). A disabled Send shows
opacity .45.

**A6. T-35: admin matching (APP-11, APP-40).**
- `autoMatch` considers only rows with `active && kind === 'student'` (`link-rules.ts:141-172`).
- Inactive rows leave `rosterKeyCount`.
- A row that goes inactive with `match = 'auto'` is released.
- The admin list and `setMatch` show and release an inactive holder.
- `/link/admin/roster` (`link.service.ts:573-583`) returns only student rows that still need a match. It computes
  candidates only for `none` and `ambiguous`, and drops the unused fields. That means fewer minors' details on the
  wire.

Check: tests for APP-11 scenarios A and B. The roster reply has no `auto` rows and no unused fields.

**A7. T-40: a whole-batch 4xx no longer blocks the queue (APP-17).**
- Check only the envelope as a whole. Parse each item in the loop, and give a bad one `refused:VALIDATION_ERROR`.
- On 404 `MODULE_DISABLED` the phone stops retrying and keeps its queue. It shows "Check-in is switched off. Use the
  kiosk. N taps were not sent.", refreshes the settings and leaves the link page.
- Add `v: 1` to queue items.

Where: `link.service.ts:512-513`, `index.html:9240-9253`, `:9302-9308`, `:9349-9351`.
Check: a test with one corrupt item in 40, where 39 are saved. An SPA test where 404 stops the retry and shows the
message.

**A8. T-31: batch errors and log rows (APP-7, APP-30, APP-71, APP-72).**
- Log the caught error: name, message and stack, never the body.
- Write the log rows collected so far before rethrowing.
- Only DB and connection errors become 503. Any other exception refuses that item alone (`refused:INTERNAL`).
- Replays fill the log target from the stored row.
- Replay equality includes `hasNote` and `leaderId`.
- An identity log row uses the item id with `on conflict (id) do nothing`.
- Outbox insert uses `on conflict (id) do nothing returning *`, then re-reads.

Where: `link.service.ts:193`, `:229-237`, `:526-541`, `supabase.link.ts:74-82`.
Check: tests for a TypeError in one item, a DB blip on item 30 of 40, and two concurrent flushes of the same id.

### B. Before the first live send (of the type concerned)

**B1. T-5: the sweep skips the claiming console's own rows (C-5, C-11, C-14, C-24; X6).**
In both repos, the `lease-lost` sweep UPDATE adds `lease_owner <> $consoleId`. That console reclaims its rows
instead, and its sent-log decides. Root cause: today the only console's first claim after a long outage marks its
own rows as lost before it can reclaim them.
Check: console A's row has a lease that expired 2 h ago. A's claim returns it with `reclaimed: true`. Console B's
claim marks it `unclear`, `lease-lost`.

**B2. T-6 and T-4: `resolved` fields (APP-24; X5).**
- `landed: true` sets `reason` and `detail` to null.
- `landed: false` sets `detail` to null and keeps `not-landed`.
- Tighten the `objectContaining` tests to exact `toEqual` (`link-rules.ts:100-104`, `link-rules.test.ts`).
- No ids on `resolved` (X5).

Check: exact-match tests for `sent`, `resolved` true and `resolved` false.

**B3. T-7: unclear rows are named for the admin (app half of C-9).**
The admin Today card lists each `unclear` row with the person and the action. The app knows both; the console must
not log names. If the card already does this, add only the test.
Check: an `unclear` check-in shows the name and "Check in" in the admin card.

**B4. T-24: ordering (APP-3, APP-45; X6).**
- At enqueue, a `checkOut` whose newest check-in for that person and service is still `pending` cancels that
  check-in and answers `cancelled`.
- The mirror case: a new `checkIn` over a `pending` check-out cancels the check-out and returns the open check-in
  as `duplicate`.
- If the opposite row is `claimed` or `unclear`, refuse "Still sending, try again in a minute".
- In `claim`, do not lease a `checkOut` while an older `checkIn` for the same person and service is `pending` or
  `claimed` (a `not exists` clause, in both repos).

Where: `link.service.ts:313-334`, `:388-403`, `supabase.link.ts:141-152`, `in-memory/link.repository.ts:100-104`.
The console runs rows in claim order (X6).
Check: tests for APP-3 scenarios A, B and C, and for APP-45 in-out-in.

**B5. T-11: a shadowed row is not "in" for the duplicate check (APP-46; X13).**
It still counts for display. Where: `link-rules.ts:183-185`, `link.service.ts:319`.
Check: a check-in shadowed at 6:45 pm, the type goes live, then a re-tap is saved (not `duplicate`).

**B6. T-30: undo and ownership (APP-5, APP-50).**
- In `doUndo`, the owner rule applies only while the action is `pending` (a cancel). Otherwise undo is a plain
  check-out, which has no owner rule.
- The SPA shows Check out on every checked-in row, and Undo only while the item is queued or `pending`.
- `mine` comes from the server, and is false on `duplicate`.

Where: `link.service.ts:369-371`, `:395`, `:451`, `index.html:9516-9548`, `:9226`.
Check: two "I am" leaders on one login. The second can check out the first's sent check-in.

**B7. T-38: undo during a flush (APP-15, APP-51).**
- Keep `LINK.inflight` ids. A tap on an in-flight item queues an `undo` (check-in) or a `cancel` (report or step)
  instead of splicing it.
- An undo answered `replay` or `duplicate` is handled like `saved`.

Where: `index.html:9236-9241`, `:9259-9285`, `:9531-9541`, `:9918-9921`, `:10020-10023`.
Check: an SPA test that flushes, taps again, resolves `saved`, and expects an undo item queued.

**B8. T-39: tap time (APP-16).**
- Stamp `_at` on each queued item. Send `queuedAt` per item and `sentAt` on the envelope.
- The server works out `tapAt = queuedAt + (serverNow − sentAt)`, clamped. It refuses `too-old` past
  `LINK_CUTOFF_DAYS`.
- For check-in and check-out it refuses with an app-only reason, `stale` ("Someone else changed this after your
  tap. Reload."), when the newest live row was created after `tapAt`.
- An item with no `_at` counts as now.

`/link/batch` only; `/sync` is untouched.
Check: tests for APP-16 scenarios A and B.

**B9. T-32: wrong service (APP-8, APP-14, APP-53, APP-54). D3 decided 2026-10-12.**
- An amber "Not today" chip on any service whose `ymd` is not today, in the pick sheet and on the door service line.
- One confirm before the first check-in to a service that is not today's.
- When there is no service today: "Tonight's service isn't here yet. Use the kiosk."
- Store the Brisbane day of the pick. When the day changes (on render, on becoming visible, and in `_nyLinkLoad`),
  drop the services, default, pick and people, keep the queue, and reload.
- The D3 03:00 rule: before 03:00 the default is the previous day's service.

The console pushes today−7 to today+7, so tonight's service is in the mirror once the console has pushed that week.
Where: `index.html:9449-9470`, `:9557-9564`, `:10069-10088`, `link-rules.ts:16-51`.
Check: SPA tests with a fake clock: a pick made on day 1 and opened on day 8; 00:30 on a Saturday.

**B10. T-33: the wrong person on a quick second tap (APP-9).**
Each check-in tap shows a 5 s toast, "Checked in <name> · Undo". The toast's Undo uses the existing queued-undo path.
This was picked over a held row or a tap debounce because it also shows who was ticked.
Check: an SPA test where the tap shows the toast with the name, and Undo while queued removes the item locally.

**B11. T-34: leader mapping and person kind (APP-10, APP-31, APP-55, APP-56). Do APP-10 first.**
- `rosterPersonOf` matches only `kind === 'leader'` rows, using the X8 fold. No leader row means "Not linked".
- It returns null when more than one active app leader folds to the same name.
- Only after that: refuse `checkIn` for kind `other`. Allow `checkOut` for any kind.
- Add one line when there are unlinked leaders, and show "Loading…" until the leader list is loaded.

Where: `link.service.ts:145-152`, `:264-267`, `:457-461`, `index.html:9584-9613`.
Check: a test with a same-name student and no leader row gives "Not linked". A check-in for an `other` person is
refused. A check-out for that person is allowed.

**B12. T-36: rate limiter (APP-12).**
Move the limiter after the replay check, and skip `duplicate`. Count only new inserts, and raise the limit to 600 per
10 min per login. Keep the limiter: it bounds how many outbox rows a runaway phone can turn into live Elvanto writes.
Where: `link.service.ts:28-29`, `:228`.
Check: 300 replays are not limited, and 601 new inserts are.

**B13. T-37: the phone queue belongs to one login (APP-13, APP-33, APP-73).**
- Call `_lkSoftReset()` after the token swap in `enterPreview`, `exitPreview` and the preview branch of
  `_handleAuthExpired`. Await or ignore an in-flight flush when the user id changed.
- Use `LINK.mem` only when localStorage throws (`LINK.memOnly`), keyed by user id.
- In `_lkQSet`'s catch, remove the key.
- Stamp stored-at. On login, drop other logins' queue keys older than 3 days (they would be `too-old` anyway).
- Fix the comment that says minors' names never go to localStorage.

Where: `index.html:9069-9072`, `:9173-9184`, `:7505-7530`, `:11922-11942`.
Check: SPA tests for preview with a queued item (it does not flush under the previewed token) and for a quota error.

**B14. T-44: flush and guards (APP-22, APP-34).**
- After a good batch with items left (and none rate-limited), re-flush in 300 ms.
- Both guards loop the flush until the queue is empty, a flush fails, or 10 s pass.
- The guards say "N actions" and "they may not be sent".
- An identity-only queue gets one bounded silent flush before it is cleared.

Where: `index.html:9232-9325`, `:9660-9670`.
Check: an SPA test where 160 queued items drain in under 2 s on a good network.

**B15. T-45: a stale refresh (APP-23).**
Stamp each load with `++LINK.loadGen`, and drop a load that started before the latest `_lkResults`. Where:
`index.html:9363`, `:9439-9447`.
Check: an SPA test where an older refresh reply that lands after a confirmed tap does not revert it.

**B16. T-3: one name fold (app half of C-2; APP-47; X8).**
- Use the X8 fold in `nameKey` (`link-rules.ts:135`), in the first-timer dedupe key, and in `rosterPersonOf`.
- Trim `lastName` (`link-contract.ts:278`).
- Use grade to break an `ambiguous` tie only when exactly one candidate's grade matches.

Do this before first-timers go live.
Check: tests for a curly apostrophe, an accent, spaces round a hyphen and double spaces, plus the two-Josh-Smith
grade case.

**B17. T-2: first-timer status for the door host (APP-32).**
- Show the first-timer row's status on the New person result page.
- Add a small "New people tonight" list (`GET /link/actions?ids=`).
- The admin page lists first-timers that have waited over 1 h.

The console's 24 h `too-old` (X7) gives every row an end.
Check: an SPA test where a first-timer row in `awaiting-approval` shows "Waiting for the new-person form to be
approved.", and in `refused too-old` shows the too-old line.

**B18. T-8: an empty flows push (C-6; X10).**
Make sure `rows: []` on `push/flows` replaces the mirror with nothing, and that the flows screen shows none.
Check: a test that pushes two rows, then `[]`, and the list is empty.

### Deferred: required before leaders get access (decided 2026-10-12)

**L1. T-25: one real-Postgres run (APP-2). D4: not now.**
The risk is accepted for the practice phase, while only the admin uses the link. Only the memory-mode tests have
run, and a deadlock or statement timeout can reach the console as a raw 500 (the console backs off). The work to do
before leaders go live:
- Run the shared repository suite once against a scratch database (never production), and record the run in the
  ledger.
- Tighten the text checks to each method's own slice, and fix or delete the check at
  `link.repository.supabase.test.ts:39`.
- Add `40P01`, `40001` and `57014` to `TRANSIENT_DB_CODES` (`error.middleware.ts:13-16`), so they answer 503.
- In `supabase.link.ts:114-180`, make the sweep UPDATEs lock in id order with `skip locked`.

Check: the suite is green on Postgres, and each mutation listed in APP-2 now fails a test.

**L2. T-26: the link switch (APP-1). D1: not doing now.**
The link screens stay under the New person switch. To start, only the admin sees them, in shadow mode. Revisit
before leaders get access: either give the link its own switch (`modules.elvantoLink`), or hide the link More
entries from non-admins and refuse their `link:use` enqueues with `LINK_UNAVAILABLE` until `console.lastSeenAt` is
set (APP-1 option A). Note the coupling now: turning New person On for leaders also gives them the link screens.

### C. Can wait

- **T-10 (C-8; X14):** when the last heartbeat has `inWindow: true` and `max: 0`, show "Paused for the weekly sync.
  Check-ins go through after it." This needs the claim's `max` kept with the heartbeat, if it is not kept already.
- **T-17 (C-21, APP-52; X14):** outside the window, add "Goes to Elvanto within 15 minutes" to pending rows. Show
  "last seen" with the day when it is not today (`_lkAt()`).
- **T-42 (APP-20; X14):** delete the single routes, `single()`, `device()`, `StatusResponse`, the device-header
  parsing and their tests. Make `enqueue`, `cancel` and `undo` private.
- **T-43 (speed):**
  - APP-21: one `/link/actions?serviceDate=` call.
  - APP-42: one services list.
  - APP-44: drop `_lkPollOpen`; the 60 s refresh carries statuses.
  - APP-74: render "Checked in" rows only when open, and debounce search 80 ms.
  - APP-75: a quiet flag for background calls.
  - APP-79: a name map once per call.
  - APP-76, APP-77, APP-78 and APP-80: when that code is next touched.
- **T-46 (UI minors):** as the findings say. For APP-35, show "In N" only.
- **T-47 (cleanups):** as the findings say.
- **T-48 (APP-37):** CLAUDE.md link section, route rows, and the token rotation steps. Do this before go-live.
- **T-49 (APP-48):** match full day names or exact 3-letter forms.
- **T-21 (APP-27; X11):** the row decides while `resultAt + 120 s > takenAt`.
- **T-27 (APP-29):** the overlay uses the newest sent `submitReport` or `editReport`, by report date then
  `resultAt`. It is `editable` as long as the console confirms (its T-27 test) that link-written reports stay
  editable.

## Not doing (and why)

- **T-28 (APP-28):** the console takes `ymd` from Elvanto's Brisbane day (checked in its code), so no guard is needed.
- **T-29 (APP-25, APP-81):** check-out is no longer locked on the console (the writer exists, and it reports
  `shadow`). The rare `locked` path, refused a minute later with "This isn't connected yet", is honest. §4.1 stays
  as it is.
- **APP-26, `applied: false` while Off:** not done. A switch-on would then start with a stale or empty roster. Docs
  instead (A4).
- **APP-12, dropping the limiter:** not done. It is the only bound on a runaway phone (B12).
- **C-3, ids on `already`/`resolved` (schema change):** not done. On a reclaim the console answers `sent` with the
  line's key and a first-timer's person. A missing `reportId` comes with the next groups push (X5, X6). Make sure a
  `sent` with no `reportId` is accepted (the Zod field is already optional).
- **C-7 option (a), per-item `ignored` for a bad result item:** not done. The console splits the batch instead, with
  no contract change.
- **C-8, a new heartbeat field:** not done. `max: 0` with `inWindow: true` already says it (T-10).
- **C-20, `roomId: null` in `checkedIn` (schema change):** not done. Check-out of a "No room" person is refused
  anyway, and a re-check-in answers `already`.
- **A new reason code for an unapproved first-timer:** not done. `too-old` at 24 h says the right thing (X7).

## The merged T-table (both sides)

Severity uses one scale. App "Important" maps to Medium unless raised here, and app "Minor" maps to Low. High means
wrong or unattributed data reaches Elvanto in normal use, or a large, needless Elvanto load. Side: console, app, both,
or text (contract text only). Totals: **50 entries: 3 High, 32 Medium, 15 Low.**

| T | Title | Sev | Side | Sources | Decision |
|---|---|---|---|---|---|
| T-1 | Nobody writes the leader's name into Elvanto notes | High | app | console decision 5; app ledger 6/17; console `src/ys-link.js:139,147,156` | App prefixes the name, or sends it alone (X1). Console unchanged plus a verify case. D2 decided 2026-10-12 |
| T-2 | A waiting first-timer re-reads Elvanto every 5 min for 3 days, and the door never learns the end | High | both | C-1, APP-32 | Console: week cache, first-timers last, slower retry, 24 h `too-old` (X7). App: show the first-timer's status |
| T-3 | Name matches fold only case and spaces | Medium | both | C-2, C-17, C-33, APP-47 | One shared fold (X8). Same person twice is one match. Holds keep waiting. App: grade tie-break |
| T-4 | `already` and `resolved` carry no ids; reclaim answers `already` | Medium | both | C-3, APP-24 (ids part) | Console answers `sent` on reclaim with the line's key and a first-timer's person (X6). `reportId` comes with the next groups push. Gap accepted for `resolved` and kiosk (X5) |
| T-5 | The sweep marks the only console's own rows as lost | Medium | both | C-5, C-11, C-14, C-24 | App: the sweep skips the claiming console's rows. Console: 3-day check before running (X6) |
| T-6 | Unclear rows that nothing clears; `resolved` keeps stale words | Medium | both | C-4, APP-24 (detail part) | Blocked key → `retry` (X4). `resolved` clears reason and detail (X5) |
| T-7 | An unclear row tells the leader the admin is checking, but nobody tells the admin | Medium | both | C-9 | Console: toast and Setup count (no PII). App: admin view names person and action |
| T-8 | Emptying the console's flow list never clears the app's list | Medium | both | C-6 | Console pushes `rows: []` once. App applies it (X10) |
| T-9 | One rejected result item stops the link until a restart | Medium | console | C-7 | On a 400, post items one by one and drop the refused one |
| T-10 | The weekly sync pauses the link and the leader is not told | Medium | app | C-8 | `inWindow` + `max: 0` means paused (X14). No new field |
| T-11 | Go live: the next tap from any leader is the first live send; a shadowed row blocks the real check-in | Medium | both | C-10, APP-46 | Runbook (X13, D5). App: a shadowed row is not "in" for the duplicate check |
| T-12 | A failed push blocks the other pushes; claims slip; a failed read moves the window | Medium | console | C-12, C-13, C-28 | `finally` on `lastPush`, ticks timed from the start, no groups push in the window, fail open (X2, X3) |
| T-13 | The roster push is built on a guessed reply; no roster means an empty door list | Medium | console | C-15 | Drop the guessed builder. After the operator's probe, add reader, route and push together. Before the practice Friday |
| T-14 | The sent-log key has two sources | Medium | console | C-16 | `keyFor` calls the writers' key functions |
| T-15 | Lines that say the wrong thing for the type | Medium | both | APP-4, C-18, C-19, C-25 | App picks the line by type (X9). Console `detail` from its own table |
| T-16 | The services mirror leaves out "No room" check-ins | Low | text | C-20 | Write it down (X10). No schema change |
| T-17 | Outside the window the leader waits with no hint; "last seen" reads as today | Low | app | C-21, APP-52 | 15-minute hint (X14). Day + time when not today |
| T-18 | A saved address with a path sends `/sync` calls to the wrong place | Low | console | C-22 | Root-relative `/sync/` (X15). The app confirms it is served at the root |
| T-19 | Practice Friday docs: New person dry run, reports unproven, stop button | Medium | both | C-23, APP-6, APP-26 | Rewrite the docs (X13, X17). Keep pushes while Off |
| T-20 | Practice says `shadowed` for writes live would refuse | Low | text | C-26 | Accept and write it down (X12) |
| T-21 | `takenAt` uses the PC clock; the mirror can hide a fresh row | Low | both | C-27, APP-27 | Server-corrected `takenAt`; the row decides for 120 s (X11) |
| T-22 | Ids reach the wire upper case or twice | Low | console | C-29 | Lower-case and de-duplicate at the push |
| T-23 | Console small fixes: due parser, `later` status, deleted report | Low | console | C-30, C-31, C-32 | As the findings say |
| T-24 | A check-out or undo can reach Elvanto before its check-in; in-out-in dedupe | Medium | app | APP-3, APP-45 | Cancel the pending check-in at enqueue; no check-out leased behind an open check-in; run in claim order (X6) |
| T-25 | The repository code has never run on Postgres; deadlocks become 500 | Medium | app | APP-2 | Deferred (D4 decided 2026-10-12): risk accepted for practice; required before leaders go live |
| T-26 | One switch turns the link on with New person | Medium | app | APP-1 | Not doing now (D1 decided 2026-10-12): stays tied to New person; revisit before leaders get access |
| T-27 | Report overlay picks the wrong last report; link-written reports may not stay editable | Low | both | APP-29 | App: newest sent submit or edit. Console: confirm with a test |
| T-28 | `ymd` could be a UTC day | Low | — | APP-28 | Not doing: the console uses the Brisbane day (checked) |
| T-29 | A locked check-out is accepted, then refused a minute later | Low | — | APP-25, APP-81 | Not doing: check-out is no longer locked on the console |
| T-30 | Undo is refused to a second leader; `mine` is set on `duplicate` | Medium | app | APP-5, APP-50 | Owner rule only while pending; Check out on every checked-in row |
| T-31 | `/link/batch` errors become a silent 503; log rows lost or without target | Medium | app | APP-7, APP-30, APP-71, APP-72 | Log the error; per-item `INTERNAL`; fill replay targets; idempotent inserts |
| T-32 | Check-ins go to last week's service | Medium | app | APP-8, APP-14, APP-53, APP-54 | "Not today" chip and confirm; reset on day change; 03:00 rule (D3 decided 2026-10-12) |
| T-33 | A quick second tap checks in the next person | Medium | app | APP-9 | 5 s toast "Checked in <name> · Undo" |
| T-34 | A leader is mapped to a same-name student or a non-youth and checked in | High | app | APP-10, APP-31, APP-55, APP-56 | Leader rows only; none on a name clash; refuse check-in for kind `other` |
| T-35 | Auto-match links leaders and inactive people; admin roster sends too much | Medium | app | APP-11, APP-40 | Active students only; release inactive `auto` rows; send only rows to match |
| T-36 | The rate limiter counts replays, so the door stalls | Medium | app | APP-12 | Count new inserts only; 600 per 10 min per login |
| T-37 | The phone queue mixes logins (preview, expiry, storage full) | Medium | app | APP-13, APP-33, APP-73 | Reset on token swap; `memOnly`; drop other logins' items after 3 days |
| T-38 | Undo during a flush is lost | Medium | app | APP-15, APP-51 | Track in-flight ids; queue an undo or cancel |
| T-39 | Queued items carry no tap time, so the cut-off is bypassed | Medium | app | APP-16 | `queuedAt`/`sentAt`; `too-old` and an app-only `stale` refusal |
| T-40 | A whole-batch 4xx blocks the phone queue for good | Medium | app | APP-17 | Per-item validation; clear message on `MODULE_DISABLED` |
| T-41 | Match button off the card on a phone; disabled buttons look enabled | Medium | app | APP-18, APP-19 | Row class; `.btn:disabled` |
| T-42 | Single write routes with no caller | Medium | app | APP-20 | Delete them (X14) |
| T-43 | Speed: request count, list rebuilds, polls, scans | Medium | app | APP-21, APP-42, APP-44, APP-74, APP-75, APP-76, APP-77, APP-78, APP-79, APP-80 | APP-21, 42, 44, 74, 75, 79 now; the rest when touched |
| T-44 | A backlog drains slowly; logout guard wording | Medium | app | APP-22, APP-34 | Quick re-flush after a good batch; bounded flush loop; honest words |
| T-45 | The 60 s refresh overwrites a fresh tap | Medium | app | APP-23 | Drop loads older than the latest result |
| T-46 | UI minors | Low | app | APP-35, APP-36, APP-57–APP-70 | As the findings say; "In N" only |
| T-47 | Dead code and duplicates | Low | app | APP-38, APP-39, APP-41, APP-43, APP-49, APP-82, APP-83, APP-84 | As the findings say |
| T-48 | App docs drift (CLAUDE.md, token rotation) | Low | app | APP-37 | Update before go-live |
| T-49 | "Monthly" read as Monday | Low | app | APP-48 | Full day names only |
| T-50 | No `.gitattributes` for the app's fixtures (CRLF checkout) | Low | app | triage (new) | Add `eol=lf` for the fixture folder |
