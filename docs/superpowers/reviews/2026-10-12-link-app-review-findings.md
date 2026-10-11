# Elvanto link, app side: consolidated review findings (for cross-device triage)

| | |
|---|---|
| **Repo** | `citipointe-youth/ys-connection` (YS Connection) |
| **Branch** | `feat/elvanto-link-app` |
| **Commit reviewed** | `905d62e0f68121bc31def2ddf97aaa4560e74eac` (all seven reviews read the diff `origin/master...905d62e`) |
| **Contract version** | `LINK_CONTRACT_VERSION = 1` (`src/core/link-contract.ts:7`; every fixture and `manifest.json` carry `contractVersion: 1`) |
| **Date** | 2026-10-12 |
| **Reviews run** (all read-only, Opus, in parallel) | RV1 six-hat · RV2 ponytail (YAGNI) · RV3 false positives/negatives · RV4 edge cases · RV5 web/phone UI · RV6 reliability · RV7 speed/feel. Also input: the V1 end-to-end smoke (`2026-10-12-link-v1-smoke.md`, memory repo, no prod). Source files: `docs/superpowers/reviews/2026-10-12-link-{six-hat,ponytail,false-pos-neg,edge-cases,ui,reliability,speed}.md`. |
| **Counts after de-duplication** | **84 findings. Critical 0 · Important 23 · Minor 61.** |
| **By side** | **CONTRACT 2** (APP-25, APP-24 ids part) · **both 8** · **console-only 0** · **app 74** |

Source tags used below: `six-hat`, `ponytail`, `fpn` (false-pos-neg), `edge`, `ui`, `rel` (reliability), `speed`,
`smoke`. A tag such as `edge I2` points at the finding ID inside that review file. All `file:line` refs are at
`905d62e`. `index.html` means `public/index.html`. "Plausible" means the reviewer could not prove it from the code alone.

Nothing has been fixed. The app side waits for the triager's rulings (ledger decision 21).

---

## Decision for the operator

### APP-1. Turning New person On also turns every link screen On for every login, even with no console — Important · side app

- **Sources:** six-hat I2 (Blue, Black hats).
- **Where:** `index.html:1997-2003` (`moreItems`: the link entries check only `_linkOn()`); `src/services/link.service.ts:238-240`
  (no console seen yet → every action type is allowed); app spec §15 (handoff steps).
- **Scenario:** Ledger decision 1 puts every link screen under the **existing** `newYouthForms` switch (Off / Shadow / On),
  the same switch as New person. New person is already promoted, and its go-live step is "switch On". If the operator
  sets that switch to On for New person before this branch merges, or before the shadow Friday, then promoting the link
  build gives every login the Check-in, Lifegroup report and Flow steps screens at once. No console has been seen, so
  `capabilities` is null and every enqueue is accepted. Leaders tap "check in" all night; the rows sit `pending` and are
  refused `too-old` after 3 days. Nothing reaches Elvanto, and the only warning is the amber banner.
- **Option A, the reviewer's fix (keeps decision 1, one switch):**
  (a) Handoff §15 gets a step 0: "Before you promote, set Elvanto features to Shadow (or Off). New person cannot go On
  until the shadow Friday passes." (b) A cheap code guard: hide the non-admin link More entries, and refuse `link:use`
  enqueues from non-admins with `LINK_UNAVAILABLE`, until a console has been seen (`status.console.lastSeenAt` not null).
  Admin keeps everything for matching.
- **Option B, the alternative (revises decision 1):** give the link screens their own switch, separate from New person,
  so New person can be On while the link stays Off or Shadow. This removes the coupling at the cost of a second switch,
  which decision 1 chose not to have ("No per-action switches").
- **Other side must change:** no, under either option.

---

## Context (for a reader who has not seen this repo)

**What the app side is.** YS Connection is a youth-ministry web app (Vercel + Supabase Postgres, a vanilla-JS SPA in
`public/index.html`). Elvanto is the church database. The app never calls Elvanto and holds no Elvanto credential. A
separate **console** (Project 11.1, a Windows PC running Playwright) is the only thing that talks to Elvanto. This
branch adds the app half of the link between them: leaders act in the app, the console carries those actions into
Elvanto, and pushes small read-only mirrors of Elvanto back down.

**Endpoints.**
- `/sync/*` — the console only, one bearer **sync token** (`LINK_SYNC_TOKEN`). `POST /sync/claim` (lease + heartbeat,
  every ~60 s), `POST /sync/result`, `POST /sync/push/:kind` for `roster`, `services`, `groups`, `flows`. These shapes
  are **frozen** (contract + fixtures + `src/core/link-contract.ts`); any shape change is tagged **CONTRACT**.
  Version mismatch → 409 `LINK_CONTRACT_MISMATCH`.
- `/link/*` — leaders, normal session. `GET /link/status`, `GET /link/checkin` (service pick list + door list),
  `POST /link/batch` (the phone queue's only write route), `POST /link/actions` + `DELETE /link/actions/:id` (single
  routes from the spec; the SPA does not call them, see APP-20), `GET /link/actions`, `GET /link/lifegroups`,
  `GET /link/flows`, and admin `GET/POST /link/admin/roster…`, `GET /link/admin/shadow-check`, `GET /link/admin/log`.

**The outbox state machine** (`link_outbox`, one row per leader action, migration `0017`; shared rule
`applyOutcome` in `src/services/link-rules.ts`):

```
 enqueue ─▶ pending ──claim──▶ claimed ──┬──▶ sent      (confirmed, or `already`)
            ▲   │ cancel                 ├──▶ refused   (nothing sent; reason code)
            │   ▼                        ├──▶ unclear ──resolved──▶ sent | refused(not-landed)
            │ cancelled                  ├──▶ shadowed  (practice mode; nothing sent)
            └─────── retry (console-busy, awaiting-approval) ◀──┘
 sweep (inside every claim): pending older than 3 days → refused(too-old); claimed with lease lost > 1 h → unclear(lease-lost)
```
The console reports per-type **capabilities** (`off` / `locked` / `shadow` / `live`). Check-out is `locked` until its
Elvanto writer exists.

**The phone queue and `/link/batch`** (ledger 18). A tap ticks the row at once and never waits for the network. Each
action gets a client UUID and goes into a per-login localStorage queue (`ysc.lkq.<user id>`). A background flush
(300 ms debounce, on `online`, on `visibilitychange`, on each tap) posts up to **50 items** per `POST /link/batch`,
with back-off 5/15/45/60 s, then a red "Not saved — tap to retry" pill. Item kinds: `action`, `cancel`, `undo`,
`identity` ("I am" switches). The server dedupes by client id (`replay`) and by (person, service, type) plus a partial
unique index (`duplicate` + `existingId`), and answers per item (`saved` / `replay` / `duplicate` / `refused:<CODE>`).
Every item writes a `link_log` row (ledger 12: who did what, from which device, as which "I am"). Rate limit: 300 items
per login per 10 min, in memory per instance.

**Attribution split** (ledger 6, 17). Everything reaches Elvanto on the operator's admin account. The app sends the
**raw** note plus `by.leaderName` (the self-identified "I am" leader, required for reports and flow steps, ledger 11).
The **console** composes the Elvanto text "Self identified leader: <name> — <note>". Check-ins carry no leader name in
Elvanto, so `link_log` is the only trail for them.

**Ledger decisions the triager must respect** (binding operator decisions):
- **One shared switch** (decision 1): every link screen sits under the existing `newYouthForms` Off / Shadow / On
  switch, shared with New person. Shadow = admin only. Off → `/link/*` 404 `MODULE_DISABLED`; `/sync/*` ignores the
  switch, but claim leases nothing while Off. (See APP-1.)
- **3-day too-old** (decision 8, contract §12 Q1): a pending row older than `LINK_CUTOFF_DAYS = 3` is refused `too-old`.
- **Which-service rule** (contract §5.5, app spec §2.3): the app chooses the service, never the console. Friday → that
  day's only service; Sunday → that day's only 10:15 service; otherwise no default and the leader picks. Pick list =
  mirror services from today−7 to today, newest first. "Today" = `brisbaneToday()` (UTC+10, no DST).
- **Check-out is on** in v1 (decision 8/10), even though the console reports it `locked` for now.
- Also: decision 11 ("I am" required for notes), 12 (action log), 13 (leaders on the door list), 18 (instant, queued),
  20 (leader quick check-in sheet), 22 (New person host = "I am"), 23 (New person sends are always live; no dry run).
  The repo is public: no real names, ids or tokens in code or docs.

**Note on the V1 smoke.** All 10 checks passed (memory repo; browser at desktop width only). It logged four minor
observations, raised again by several reviews: (1) a check-in for a roster person of kind `other` is accepted → APP-31;
(2) `resolved landed:true` keeps the old `unclear` detail → APP-24; (3) replay / `LINK_ID_REUSED` log rows have no
target → APP-30; (4) pushes apply while the switch is Off → APP-26. Its fifth observation (no default service at
07:40 on 2026-10-12) is **not a bug**: that date is a Monday, and the default applies only on Friday and Sunday
(six-hat White hat).

---

## Part 1 — CONTRACT and cross-side findings (Important)

### APP-2. The Supabase repo has never run against Postgres; its text-only tests pass under real mutations; a deadlock or statement timeout is a raw 500 — Important · side both
- **Sources:** fpn I3, rel I4.
- **Where:** `src/tests/link.repository.supabase.test.ts` (the DB block `:55-79` / `:18-49` is skipped unless
  `LINK_TEST_DATABASE_URL` is set; no ledger or smoke entry records a run); `src/repositories/supabase/supabase.link.ts:114-180`
  (claim: console upsert, two sweep UPDATEs that do not skip locked rows, purges, then `for update skip locked`),
  `:187-209` (`applyResults` locks rows one by one in item order); `src/api/middleware/error.middleware.ts:13-16`
  (transient codes = class 08 + socket errors only).
- **Scenario:** (a) Prod's claim, sweep, guarded `applyResults`, open-duplicate mapping and newest-first ordering are
  covered only by substring checks. Mutations that still pass: change the sweep to `updated_at < now() - …` (test `:17`
  still matches the note purge); delete the `link_log` purge; replace `now()` in the insert with a JS date; `:39`
  `not.toContain("throw new Error('applyResults")` can never fail (the real code uses a backtick); change
  `maybeEncrypt(n.note, noteAad(n.id))` to a wrong AAD (prod would then refuse every note `note-unreadable`); drop
  `desc` from `listActions` ordering (breaks `effectiveCheckState` and the dedupe step). (b) *Plausible:* console X posts
  `/sync/result` for rows R1, R2 whose leases expired (the PC slept) and locks R1; console Y's claim runs the lease-lost
  sweep, locks R2 and waits on R1; X waits on R2 → Postgres 40P01 → the console gets 500 `INTERNAL`, not a retryable
  503. A `57014` statement timeout on the unindexed sweep/purge does the same.
- **Fix:** Run the shared repo suite once against a scratch Supabase database before prod (plan Task V2; the operator
  supplies the URL) and record it in the ledger. Tighten the text checks to look inside each method's slice; fix or
  delete `:39`. Add `40P01`, `40001`, `57014` to `TRANSIENT_DB_CODES` (or map them to 503 in `sync.service`). Make the
  two sweep UPDATEs lock in a fixed order with `skip locked` (`where id in (select id … order by id for update skip locked)`).
- **Other side must change:** console must treat a 500 on `/sync/*` as retryable, **only if it does not already**.
  No contract change.

### APP-3. A check-out or an Undo can reach Elvanto before its check-in, leaving the youth checked in — Important · side both
- **Sources:** edge I2. (Related but distinct: APP-15 is the phone-side undo race; APP-45 is the server dedupe of
  in-out-in.)
- **Where:** `src/services/link.service.ts:313-321` (check-out allowed while the check-in is `pending`/`claimed`),
  `:388-403` (Undo of a `claimed` check-in queues a new `checkOut`); `link-rules.ts:121-122` (`retry` → `pending` +
  `retryAt`); `supabase.link.ts:141-152` and `in-memory/link.repository.ts:100-104` (claim picks every due row in
  `created_at` order, with no per-person ordering; `skip locked` skips a locked check-in).
- **Scenario:** (A) Phone A checks Josh in at 18:40; the row is claimed; the console answers `retry` (60 s). Phone B
  (another login) taps Check out at 18:40:30 and the server saves it (Josh's effective state is "in"). At 18:41 only the
  check-out is due, so it is leased and sent; the check-in is sent at 18:41:30. Elvanto has Josh **in**, the app shows
  him **out** until the next services push. (B) Undo tapped while the check-in is `claimed`, then the console answers
  `retry`: same inversion. (C) Two consoles: console 2's `skip locked` skips console 1's locked check-in and leases the
  later check-out.
- **Fix (app):** (1) At enqueue, when a `checkOut` arrives and the newest check-in for (person, service) is still
  `pending`, `cancelPending` it and return `cancelled` instead of inserting. (2) In `claim`, don't lease a `checkOut`
  while an older `checkIn` for the same `personId` + `serviceTimeId` is `pending` or `claimed` (a `not exists (…)`
  clause; same in the memory repo).
- **Other side must change:** the console must handle the rows of one claim **in the order given**. The app fix alone
  needs no console change.

### APP-4. The practice line tells leaders to "Check in the usual way" on the lifegroup report and flow step screens — Important · side both
- **Sources:** ui I3.
- **Where:** `index.html:9167` (banner for any shadow type), `:9132` (`_lkStatusText` `shadowed`, used for report and
  step rows). The text is quoted word for word from contract §5.3 (`elvanto-link-contract.md:355`).
- **Scenario:** On the shadow Friday a leader filling in a report is told "Practice mode: not sent to Elvanto. Check in
  the usual way." They may skip doing the report in Elvanto, so practice reports never reach Elvanto at all.
- **Fix:** take the line from the screen's types: check-in types keep the contract text; report and step types read
  "Practice mode: not sent to Elvanto. Do it in Elvanto as usual."
- **Other side must change:** yes, a **contract wording note** only (§5.3 status table). Not a fixture or schema change;
  the console team should agree it.

---

## Part 2 — App-only findings (Important)

APP-1 (the operator decision above) is also app-only Important.

### APP-5. On a shared login, a leader can't check out a youth a colleague checked in; Undo is offered, then refused — Important · side app
- **Sources:** six-hat I1 (Red, Black), edge M1. (Also six-hat Green G1.)
- **Where:** `link.service.ts:369-371` (`owns`: same login **and** same "I am", null = null), `:395` (undo needs ownership
  even for a sent check-in), `:451` (`mine` = same login only); `index.html:9516-9521` (a row whose newest action is
  "mine" shows **Undo** instead of **Check out**), `:9546-9548` (`_lkUndo` sends the *current* "I am").
- **Scenario:** Two leaders share `grade9g` on two phones, "I am" = Cody and Sam. Cody checks a youth in. At 9 pm Sam's
  row shows Undo (not Check out); Undo sends `leaderId` = Sam → `owns()` fails → toast "Only the leader who sent this can
  undo it." Sam has no way to check the youth out. Same on one phone after an "I am" hand-over, or when a check-in made
  before "I am" was picked (null) is undone after picking one. Admin/director skip the check, so the shadow Friday on the
  admin login won't show it.
- **Fix:** In `doUndo`, apply the owner rule only while the action is `pending` (a cancel); otherwise undo is just a
  check-out, which has no owner rule (spec §8.2). In the SPA show **Check out** on every checked-in row and **Undo** only
  while the item is queued or `pending`. (Alternative from edge M1: send the action's original `leaderId`, or include
  the "I am" match in `mine`.)
- **Other side must change:** no.

### APP-6. The shadow-Friday and test docs still assume New person has a dry run; it is always live now — Important · side app (docs)
- **Sources:** six-hat I3 (White, Blue).
- **Where:** app spec `2026-10-12-elvanto-link-app-design.md` §11.4 (`:562-567`), §13 step 3 (`:612` "a first-timer (New
  person in dry run)"), §15 step 5 (`:641-643` "adds a first-timer"), §17 I4 (`:661`). Code (`index.html:10054-10061`)
  already follows ledger 23.
- **Scenario:** The operator follows §13/§15 on the shadow Friday and adds a made-up first-timer to test. New person
  sends real student and parent connect forms to Elvanto (the gate was removed 2026-10-12); only the first-timer
  **check-in** is shadowed. The test person becomes a real Elvanto submission that must be deleted.
- **Fix:** Rewrite §11.4 to the ledger-23 rule. In §13/§15 say: use a real first-timer, or delete the test submission in
  Elvanto afterwards. Mark §17 I4 superseded.
- **Other side must change:** no.

### APP-7. `/link/batch` turns any non-AppError into a 503 and logs nothing; one bad item can block a phone's queue for good, and saved log rows are lost — Important · side app
- **Sources:** six-hat I4, rel m1 (first half). (Six-hat Green G4.) The "replay rows have no target" half is APP-30.
- **Where:** `link.service.ts:535-538` (catch → 503; `e` is not logged), `:541` (`addLog` runs only after the loop),
  `:230-236` (replays return before the target is set).
- **Scenario:** (1) A code fault in one item (say a TypeError on unexpected mirror data) → the whole call 503s → the
  phone retries every 60 s forever; earlier items come back `replay`; the pill goes red on every phone holding that item;
  no server log line says why. (2) A DB blip on item 30 of 40 → items 1–29 are inserted but their `saved` log rows are
  thrown away; on retry they are logged as `replay` with no target, so ledger 12's "who did what to whom" has no person.
- **Fix:** Log `e` (name, message, stack; never the body). Write the logs collected so far before rethrowing (or per
  item). Map only real DB/connection errors to 503; refuse any other exception on that item alone (`refused:INTERNAL`).
- **Other side must change:** no.

### APP-8. When tonight's service is missing from the mirror, the top of the pick list is last week's service, unmarked — Important · side app · Plausible
- **Sources:** six-hat I5 (Black: wrong service). Related: APP-14 (stale pick on a phone left open).
- **Where:** `index.html:9557-9564` (`_lkPickHtml`: "The last 7 days, newest first", only a "Default" tag), `:9465-9470`
  (the service line shows the date, no warning); `link.service.ts:257`, `:440`.
- **Scenario:** The console has been offline since Thursday, or its services push does not yet hold tonight's service
  (unconfirmed whether the 14-day push includes future days). On Friday `defaultServiceTimeId` is null, the sheet opens
  with "Fri 9 Oct · Friday Night Youth" on top, and a rushed door host taps it. Every check-in that night goes to last
  week's service; when the console returns it checks ~200 youths in to the wrong week.
- **Fix:** An amber "Not today" chip on any service whose `ymd ≠ today`, in the pick sheet and the door service line.
  Confirm once before the first check-in on a not-today service. When today has no service: "Tonight's service isn't
  here yet. Use the kiosk."
- **Other side must change:** no. (If the console can push today's services early in the day, that also helps:
  console's call.)

### APP-9. A whole-row tap checks a youth in at once and the row jumps into a collapsed list, so a quick second tap checks in the next person — Important · side app · Plausible (double-tap behaviour not tested on devices)
- **Sources:** six-hat I6 (Red, Black: wrong person), speed I2.
- **Where:** `index.html:9522` / `:9507-9523` (`_lkRowHtml`: the whole row is the tap target), `:9526-9535` (`_lkCheck`),
  `:9498-9504` (checked-in rows move into a closed `<details>` "Checked in · N").
- **Scenario:** Busy door, unfiltered list. The host taps "Alex"; `_lkRefreshView` rebuilds the list at once, Alex moves
  into the collapsed "Checked in", and the next row slides into the same place. A double tap, or a tap next to the
  intended row (perhaps during the 60 s refresh), checks in a different minor with no sign of who. To undo, the host must
  open "Checked in" and find the name; if the 300 ms flush has gone, that is a real `checkOut` to Elvanto. The spec
  copies the camp app's list, so this is a design trade-off rather than a coding error.
- **Fix (pick one):** a 5 s toast "Checked in <name> · Undo" (Undo while queued removes it locally); or keep the tapped
  row in place for ~3 s with "Waiting to send · Undo" before it moves; or ignore a row tap within ~400 ms of a list
  rebuild; or a "Just checked in: Alex · Undo" strip at the top.
- **Other side must change:** no.

### APP-10. Leader quick check-in can link an app leader to a same-name student (or `other`) roster row and check that person in — Important · side app
- **Sources:** fpn I1, six-hat M1 (the `rosterPersonOf` half) and Green G2, speed M9 / edge M15 (fix interaction).
- **Where:** `link.service.ts:145-152` (`rosterPersonOf`: prefers `leader` rows but keeps any kind when there is no
  leader hit), used at `:457-461`; enqueue checks only `r.active` (`:264-267`). The gender guard `!g || !r.gender` passes
  when either side has no gender (common for leaders).
- **Scenario:** App Leader "Josh Lee" is not in the roster push (his Elvanto profile is outside the configured
  categories). Year 9 student "Josh Lee" is. The only hit is the student, so `personId` = the student. In "Check in
  leaders", Tick all → Submit sends a real Elvanto check-in for the **student**, and the sheet shows the leader as in.
- **Fix:** Match only `kind === 'leader'` rows (contract §6: the console reads two lists). With no leader row the result
  is "Not linked". Test: a same-name student exists but no leader row. (Green G2 alternative: list the roster's
  `leader` rows directly in the sheet instead of mapping app Leaders by name.) Do this before or with APP-31, because a
  plain `kind` refusal at enqueue would otherwise break leaders mapped to `other` rows.
- **Other side must change:** no.

### APP-11. Auto-match links leaders and inactive people; an inactive `auto` row holds its student forever, invisible to the admin — Important · side app
- **Sources:** fpn I2.
- **Where:** `link-rules.ts:141-172` (`autoMatch`: no filter on `kind` or `active`); the purge keeps `auto` rows
  (`supabase.link.ts:135-136`, `in-memory/link.repository.ts:92`); the index counts inactive rows
  (`0017_elvanto_link.sql:47`); `rosterForMatching` lists only active rows (`link.service.ts:577`); `setMatch` returns 409
  if any row, inactive included, holds the student (`:594`).
- **Scenario:** (A) Roster leader "Sam Taylor" auto-matches app student "Sam Taylor" (whose Elvanto profile isn't in the
  student list); the leader's check-ins then count as the student's attendance in the shadow check. (B) Elvanto merges a
  duplicate: old P1 (`auto` → student S) goes inactive; new P2 can't take S; the admin can't see P1; a manual match of P2
  → 409; P1 is never purged. S can never be linked again from the UI.
- **Fix:** In `autoMatch` consider only `active && kind === 'student'`; leave inactive rows out of `rosterKeyCount`; when a
  row goes inactive with `match = 'auto'`, release it (`studentId = null`, `match = 'none'`); let the admin list /
  `setMatch` show and release an inactive holder. Tests for both scenarios. (Contract §6 says "rows with match none";
  narrowing to active students is an app-side tightening, fixtures unchanged.)
- **Other side must change:** no.

### APP-12. The rate limiter counts replays and retries, per shared login, so the door can stall mid-rush — Important · side app · Plausible
- **Sources:** fpn I4, six-hat M5 (Green G3), ponytail M11, edge M13, rel m5.
- **Where:** `link.service.ts:228` (`limiter.isBlocked`, one hit per item, **before** the replay check at `:230-236`),
  `:28-29` (300 per 10 min); `container.ts:258-259` (keyed by `actor.id`, in memory per serverless instance);
  `rate-limiter.ts:15-26` (fixed window from the first hit).
- **Scenario:** Quad/grade logins are shared (ledger 2). Three door phones on one login, 7:00–7:10 pm: ~150–200 arrivals
  plus a 40-leader quick check-in. Each 50-item batch whose reply is lost on weak Wi-Fi is re-sent whole and counted
  again. A few lost replies pass 300, and **every** phone on that login gets "Too many taps. Wait a minute." for up to
  10 min. Nothing is lost (`RATE_LIMITED` items stay queued, `index.html:9262`), but the door list shows "waiting" in the
  rush and Elvanto gets check-ins late. Several warm instances make the real limit higher and non-deterministic.
- **Fix:** Count only new inserts: move the limiter after the replay check and skip `duplicate`. Optionally key by
  `actor.id + device.id` with a per-login ceiling, or raise to ~600 / 10 min. Ponytail's alternative: drop the limiter
  (the 50-item cap + session auth already bound a request) — owner call. Test: 300 replays are not limited.
- **Other side must change:** no.

### APP-13. An admin preview mixes the admin's link queue and cached lists with the previewed account's, both ways — Important · side app
- **Sources:** edge I1, six-hat M12. (Preview part of rel m6; the `memOnly` part overlaps APP-73.)
- **Where:** `index.html:9173-9184` (`_lkKey`, `_lkQGet`, `_lkQSet`: `_lkQGet` falls back to the single in-memory
  `LINK.mem` when the current login's key is empty), `:7505-7530` (`enterPreview`, `exitPreview`), `:11922-11935`
  (`_handleAuthExpired`, preview branch). None calls `_lkSoftReset()`.
- **Scenario:** An admin has 3 check-ins queued (no signal) and previews `g79`. The empty `ysc.lkq.<g79>` key makes
  `_lkQGet()` return the admin's 3 items from `LINK.mem`; the pending timer flushes them with the **quad's** token; they
  are saved and logged as `g79`. After Exit Preview they go again as `replay`, still attributed to the quad. The reverse
  happens on a 1 h preview token expiry. Cached `LINK.groups` (every group) shows in the quad preview until the 60 s
  refresh. This defeats ledger 12 ("who did an action").
- **Fix:** Call `_lkSoftReset()` after the token swap in `enterPreview`, `exitPreview` and the preview branch of
  `_handleAuthExpired`; await an in-flight flush before swapping (or ignore its results when `S.user.id` changed). Use
  `LINK.mem` only when localStorage throws (`LINK.memOnly`), keyed by user id. Write down that preview actions are logged
  as the previewed login.
- **Other side must change:** no.

### APP-14. A phone left open over several days checks youth in to last week's service, with no warning — Important · side app
- **Sources:** edge I3. Related: APP-8 (same "not today" warning).
- **Where:** `index.html:9449-9463` (`renderLinkCheckin` sets `LINK.svc = LINK.defaultSvc` only when `!LINK.services`,
  never re-checked), `:10069-10088` (`_nyLinkHtml` / `_nyLinkLoad`: `if (LINK.services) return;`, so New person's
  "Check them in to …" tick, on by default, uses the cached default); server accepts any pick-list service
  (`link.service.ts:257`, `link-rules.ts:37-42`).
- **Scenario:** A leader opens the door on Fri 9 Oct; the PWA stays in memory; on Fri 16 Oct `LINK.svc` is still 9 Oct,
  which is still in the pick list (today−7), so every tap goes to last Friday. The 60 s refresh updates
  `LINK.services`/`LINK.defaultSvc` but not `LINK.svc`. A New person sent from Home the same day ticks "Check them in to
  Fri 9 Oct" by default.
- **Fix:** Store the Brisbane day of each pick (`LINK.svcDay`). On every link render, on `visibilitychange` → visible
  and in `_nyLinkLoad`, if the day changed drop `LINK.services`, `defaultSvc`, `svc`, `people` (keep the queue) and
  reload. Show an amber line when `svc.ymd` is not today (or not yesterday before 03:00).
- **Other side must change:** no.

### APP-15. Undo tapped while the item is in flight is silently lost (phone-side race) — Important · side app
- **Sources:** rel I1. (Distinct from APP-3, which is server/console ordering.)
- **Where:** `index.html:9236-9241` (`_lkFlush` snapshots `q.slice(0, 50)` and posts it); `:9531-9532` (`_lkCheck`) and
  `:9540-9541` (`_lkUndo`): "still in the queue → splice locally, nothing is sent"; `:9259-9283` (`_lkResults` applies
  the answer for every item in the snapshot). Same for report and flow cancels (`:9918-9921`, `:10020-10023`).
- **Scenario:** A leader taps the wrong youth; the batch is in flight (up to 20 s on a weak signal); they tap again to
  undo. The item is still in localStorage, so it is spliced ("nothing sent"), but the server already saved it. When the
  reply arrives the row flips back to "In · Waiting for the console", and Elvanto gets a check-in for a youth who isn't
  there. If the reply is lost, the phone shows nothing at all.
- **Fix:** Keep `LINK.inflight` ids (set in `_lkFlush`, cleared in `.finally`). For a tap on an in-flight item, don't
  splice; queue an `undo` (check-in) or `cancel` (report/flow) for that id. The server handles both. SPA test: flush
  pending, tap again, resolve `saved`, expect an undo item queued.
- **Other side must change:** no.

### APP-16. Queued phone items carry no tap time, so the 3-day cut-off is bypassed and late items replay over newer state — Important · side app
- **Sources:** rel I2, edge M5.
- **Where:** items have no timestamp (`index.html:9534-9535`, `:9648`, `_lkPush`); `created_at` is the server insert time
  (`0017_elvanto_link.sql:27`) and the sweep ages from it (`supabase.link.ts:127-129`, `in-memory/link.repository.ts:84`);
  enqueue accepts any service in today−7…today (`link-rules.ts:37-41`, `link.service.ts:257-260`); the same-action check
  sees only what has arrived (`link.service.ts:313-321`).
- **Scenario:** (A) A door phone with no signal queues 30 check-ins on Friday and is opened again 6–7 days later; last
  Friday is still in the pick list, so all 30 are `saved` with `created_at` = now and go to Elvanto a week late, past the
  binding 3-day cut-off. Same for a queue stranded under another login (APP-33). (B) Phone A (offline) checks Y in at
  7:00; phone B checks Y in at 7:01 and out at 9:00; A flushes at 9:30 → Y is checked back in after leaving.
- **Fix (app only):** Stamp `_at` on each queued item; send `queuedAt` per item and `sentAt` on the envelope; server
  computes `tapAt = queuedAt + (serverNow − sentAt)` (clamped), refuses `too-old` past `LINK_CUTOFF_DAYS`, and for
  check-in/out refuses with a new app-only reason (e.g. `stale`, "Someone else changed this after your tap. Reload.")
  when the newest live row has `created_at > tapAt`. Items with no `_at` → treat as now.
- **Other side must change:** no (`/link/batch` is app-only; `/sync` untouched).

### APP-17. A whole-batch 4xx (including 404 when the switch goes Off mid-night) blocks the phone queue forever, with no reason shown — Important · side app
- **Sources:** rel I3, edge I4, six-hat M6.
- **Where:** `link.service.ts:512-513` (one bad item shape fails the whole call with 400), `:166-174` (gate → 404);
  `index.html:9240-9253` (`_lkFlush` → `_lkFailed` on any non-401 error; back off and retry the same first 50 forever),
  `:9302-9308` (pill), `:9349-9351` (`_lkStatusLoad` swallows the 404, banner stays stale), `:9316-9325` (logout "Log out
  anyway (they'll be lost)").
- **Scenario:** (a) At 19:30 the operator sets the switch Off (the stop button) or Shadow. Phones keep the old settings,
  each tap is queued, every flush gets 404 `MODULE_DISABLED`, the pill turns red "Not saved — tap to retry" with no
  reason, and leaders skip the kiosk thinking the app will catch up. If the switch returns days later, the old items go
  late (APP-16). (b) A later deploy tightens `BatchBody` or a stored item is corrupt (e.g. a legacy id that `Uuid`
  rejects): every retry returns the same 400, and items behind it never send.
- **Fix:** On 404 `MODULE_DISABLED`: stop retrying, keep the queue, show "Check-in is switched off. Use the kiosk. N taps
  were not sent.", refresh `S.settings`, leave the link page (optionally drop items after confirmation). On 400: validate
  items one by one on the server (envelope checks only `{kind, id}`; each item parsed in the loop → per-item `refused:
  VALIDATION_ERROR`), or bisect on the phone and park the bad item in a "could not send" list. Add a queue item version
  (`v: 1`) for later migrations.
- **Other side must change:** no.

### APP-18. Admin Roster matching: the Match buttons are pushed out of the card on a phone — Important · side app
- **Sources:** ui I1.
- **Where:** `index.html:780` (`.lk-kv span{…;flex:none}`), `:10190-10191` (candidate row = `.lk-kv` with "name · Yr ·
  DOB" in a `<span>` and the Match button beside it).
- **Scenario (measured at 360 px):** for a long name, the card's right edge is at 329 px, the first candidate's Match
  button at 469 px (clipped, invisible), the DOB cut off. An admin on a phone can't match that person, and matching is how
  check-ins reach YS attendance (the shadow check).
- **Fix:** Give the candidate row its own class (or override inside it: `span{flex:1 1 auto;min-width:0}`), keep the
  button `flex:none`; or put the Match button on its own line on narrow screens. Don't change `.lk-kv` globally (the
  Status card relies on it).
- **Other side must change:** no.

### APP-19. Disabled primary buttons look exactly like enabled ones — Important · side app
- **Sources:** ui I2.
- **Where:** `index.html:161` (`.btn-primary` has no `:disabled` rule; only `.btn-ghost` at `:167` has one). Affected link
  buttons: report Send under the date-clash warning, **Submit (0)** in the leader sheet (`:9624`), **Use this service**
  before a pick (`:9567`).
- **Scenario (measured):** a disabled Send shows full accent colour, opacity 1 and `cursor:pointer`; the leader taps and
  nothing happens, with no cue. (The smoke's "Submit (0) was disabled" is true of the attribute, not the look.)
- **Fix:** `.btn:disabled{opacity:.45;cursor:not-allowed;transform:none}` (or scope it to `.lk-*` /
  `.bus-sheet-actions` if the app-wide change needs its own check).
- **Other side must change:** no.

### APP-20. The single-item write routes and the device-header plumbing have no caller — Important · side app
- **Sources:** ponytail I1.
- **Where:** routes `src/api/http/router.ts:219` (`POST /link/actions`), `:221` (`DELETE /link/actions/:id`); controller
  `src/api/controllers/link.controller.ts:116-125` (`device()`, `single()`), `:132`, `:134`; `StatusResponse`
  (`src/api/http/types.ts:10-17`) and `express-adapter.ts:174`; device headers `express-adapter.ts:99`, `:163-167`;
  public `enqueue`/`cancel`/`undo` (`link.service.ts:98-100`, `:465-490`), `httpStatus` + `strip()` (`:63-67`, `:412`).
- **Scenario:** The SPA writes only through `/link/batch`; nothing sends `X-Device-*`; `LinkService.undo` has no route.
  A fix to item handling made and tested on `/link/batch` silently diverges on the single routes (e.g. `single()` throws
  `LinkOpenDuplicate` with `existingId ?? ''`; no device → null device in the log). It is a second authenticated write
  route that skips the phone queue, and nothing in production exercises it.
- **Fix:** Delete the two routes, `single()`, `device()`, `StatusResponse` + its adapter branch, the header parsing, the
  CORS header change and `HttpRequest.headers`; make `enqueue`/`cancel`/`undo` private; drop `httpStatus`/`strip()`
  (~80 lines plus their route tests).
- **Other side must change:** no code. Add a one-line doc note to contract §4 ("`/link/batch` replaces the single
  routes"); doc text only, not a fixture or schema change.

### APP-21. The admin "Today" card sends 6 `/link/actions` requests where 1 is enough — Important · side app
- **Sources:** ponytail I2, speed M4.
- **Where:** `index.html:10238-10247` (`_lkAdmLoadActs`: one `GET /link/actions?serviceDate=…&type=<t>` per type);
  `link.service.ts:499` (`serviceDate` alone is accepted), `:502-504` (one `users.findById` per creator per call).
- **Scenario:** Opening the admin page fires 6 parallel `/link/actions` calls plus `/link/admin/roster`, `/link/admin/log`,
  `/link/checkin`, `/link/status`: about 10 requests at once against `max: 2` connections per instance and a Supavisor
  pool of 15 that the door phones share on a Friday.
- **Fix:** One `API.fresh('/link/actions?serviceDate=' + today)`; the card already groups by status. Optionally a
  per-call `users` memo in `listActions`. The server `type` param can stay (contract §4 lists it).
- **Other side must change:** no.

### APP-22. A backlog over 50 items drains in 15 s steps, and the logout guard says "could not be sent" while the network is fine — Important · side app
- **Sources:** speed I1, rel m8.
- **Where:** `index.html:9232-9246` (`_lkFlush`), `:9298` (`_lkResults`: `if (left.length) _lkSchedule(15000)`),
  `:9316-9325` (`_lkLogoutGuard`), `:9660-9670` (`_lkSwitchGuard`).
- **Scenario:** 160 check-ins queue during a 20-minute dead signal. Signal returns: 50 go, then a 15 s wait, ×3 ≈ 45 s
  of "110 waiting to send". If the host logs out, the guard races one flush against 10 s, 110 remain, and it says "They
  could not be sent. Log out anyway (they'll be lost)" — 110 check-ins lost if taken. Smaller case: a tap during an
  in-flight flush waits 15 s instead of <1 s, which is common at a busy door.
- **Fix:** In `_lkResults`, when the batch succeeded and the leftovers aren't `RATE_LIMITED`, `_lkSchedule(300)` (keep
  15 s only for rate-limited/unanswered). In both guards loop `_lkFlush()` until empty, a flush fails, or 10 s passes;
  say "could not be sent" only when a flush actually failed.
- **Other side must change:** no.

### APP-23. The 60 s list refresh can overwrite a just-confirmed tap with older server data — Important · side app · Plausible (timing)
- **Sources:** speed I3.
- **Where:** `index.html:9363` (60 s tick → `_lkLoadPeople`), `:9439-9447` (replaces `LINK.people[svc]` wholesale),
  `:9254-9300` (`_lkResults` → `_lkApply` mutates the old object and drops the item from the queue), `:9368-9375`
  (`_lkPollOpen` polls only `p.mine && action` rows).
- **Scenario:** The refresh GET reads the outbox just before Jamie's check-in is inserted; the flush returns and Jamie is
  marked in and leaves the queue; then the older refresh reply replaces the list. Jamie is back under "Still to come"
  with `action: null` (so the 15 s poll skips her) for up to 60 s. A re-tap gets `duplicate` (data safe), but the list
  and count are wrong.
- **Fix:** Stamp each load (`++LINK.loadGen`) and drop a load that started before the latest `_lkResults`; or keep
  confirmed acts of the last ~2 min in `LINK.recent` and re-apply them on top of each load (as `_lkMerge` does for the
  queue).
- **Other side must change:** no.

---

## Part 3 — Minor findings (compact)

Cross-side and CONTRACT minors first, then app-only. "Other side" = whether the fix needs the other side to change.

### 3a. CONTRACT and cross-side minors

| ID | Side | Sources | Where (file:line) | Failure scenario | Proposed fix | Other side |
|---|---|---|---|---|---|---|
| APP-24 | app + **CONTRACT** (ids part) | smoke 2; six-hat M2; ponytail S2; fpn M3; edge M16; rel m9(2); speed M10; ui smoke 3 | `link-rules.ts:100-104` (`resolved` sets only status/resultAt/updatedAt); `link-rules.test.ts:138,146,150,154,158,167` (`objectContaining`) | A `lease-lost`/unclear row resolved `landed:true` becomes `sent` but keeps `reason: 'lease-lost'` and "Elvanto may not have saved this."; admins see a stale line on a sent row. A resolved `submitReport` has no `reportId` (group not editable until next groups push); a resolved first-timer keeps `personId` null. The loose tests can't catch a missing `reason: null, detail: null` in `sent` or `resolved`. | `landed:true` → `reason: null, detail: null`; `landed:false` → `detail: null` (keeps `not-landed`). Use exact `toEqual` in those tests. Carrying `reportId`/`personId` on `resolved` needs a `ResultItem` schema change → CONTRACT; accept the gap until then. | **CONTRACT** for the ids only; the detail/reason fix is app-only |
| APP-25 | **CONTRACT** | ponytail M12 (Plausible; owner call, decision 10). Related app-side: APP-81 | contract §4.1 (accepts `locked` at enqueue); `index.html:9168` | A leader taps Check out; the row reads "Waiting to send" ~1 min, then flips to "This isn't connected yet". One outbox row, claim and result for nothing. | App refuses a `locked` type at enqueue with `LINK_UNAVAILABLE` (same line, at once); the button can stay (check-out still "offered"). | Console orchestrator must agree the §4.1 rule change; no console code change (it still handles `locked` claims for older rows) |
| APP-26 | both (docs + operator step) | smoke 4; six-hat M4; ponytail S4; fpn smoke rank 4 ("not a bug"); edge M18; ui smoke 1; rel m9(4); speed M11 | `sync.service.ts:66-83` / `:254-271` (no switch check in `push`); claim sets `max = 0` when Off (`:38` / `:226`) | The switch is turned Off as a stop button or for good; the console keeps pushing the roster (names, gender, grade of every youth) every 6 h and services hourly, and the app keeps storing them. Spec §2.1 intends this (mirror fresh when turned back On). | Most reviewers: keep, and document it (spec §2.1, a code comment, a line on the admin Status card; §15 step 8: "To stop all data flow, also stop the console poller"). Alternatives: skip roster pushes when Off, or return `{ applied: false }` when Off (already allowed by `push-response.json`, so not CONTRACT). | Console: an operator step (stop the poller); if `applied:false` is chosen, confirm the console tolerates it |
| APP-27 | both | fpn M6 (Plausible) | `link-rules.ts:184` (`resultAt` server clock > `takenAt` console clock) | The office PC is 2 min fast, or stamps `takenAt` at the end of a slow read: a check-in sent at 19:01 server time is hidden by a 19:00 snapshot stamped 19:02; the row shows **out** for up to 60 s and a leader taps again (`already`). | App: let the row decide while `resultAt + 120 s > takenAt`. Console: stamp `takenAt` at the start of the read. | Console: yes (stamp time). No contract change |
| APP-28 | both | fpn M9 (Plausible) | `link-rules.ts:40, 47`; `link.service.ts:260` (`serviceDate = svc.ymd`) | If the console ever derives `ymd` in UTC, a Sunday 8:00 am service is filed under Saturday: it drops out of Sunday's default, and its `service_date` and too-old window are a day off. | App ignores or flags a row whose `ymd !== brisbaneToday(startsAt)`. | Console confirms it uses the Brisbane date. No fixture change |
| APP-29 | both | edge M10 (scenario 2 Plausible) | `link.service.ts:208-215` (`lastReportOf`: overlay = sent `submitReport` only, newest by `created_at`, always `editable: true, blocked: null`), `:286-295` | (1) Submit → sent, edit → sent, edit again before the next groups push: the screen shows the submit's values, the console finds the first edit's values and refuses `report-changed`. (2) If the console's attribution line makes Elvanto treat the report as `unkept-notes`, the overlay still offers Edit. (3) Two submits (D2 then older D1) make D1 the "last report". | Overlay the newest sent `submitReport` **or** `editReport`, by report `date` then `resultAt`. Mark it `editable` only if link-sent reports stay editable. | Console to confirm whether link-sent reports stay editable |
| APP-32 | both | edge M11; six-hat M8 | `index.html:10054-10062`, `:10093-10111` (first-timer queued for `sent`/`unconfirmed`, decision 23); `:9278-9283` (results with no `personId` shown only as a refusal toast); contract §5.5 (`retry` `awaiting-approval` every 5 min until the sweep) | The student POST times out (`unconfirmed`) and the form never landed. The first-timer check-in leaves the phone; the console answers `awaiting-approval` ~860 times until the sweep refuses `too-old` 3 days later. The door host never sees how it ended (approval wait, refusal, sent); only the admin Status card does. A re-send is correctly deduped. | App: show the first-timer row's status on the New person result page / a small "New people tonight" list on the door (`GET /link/actions?ids=`); admin page lists first-timers waiting > 1 h. | Console: back off after N `awaiting-approval` answers |

(APP-30 and APP-31 are app-only and are listed in 3b.)

### 3b. App-only minors

| ID | Sources | Where (file:line) | Failure scenario | Proposed fix | Other side |
|---|---|---|---|---|---|
| APP-30 | smoke 3; six-hat M3; ponytail S3; fpn M5; edge M17; ui smoke 2; rel m1; speed M10 | `link.service.ts:229-237` (replay returns / `LINK_ID_REUSED` throws before `tgt` is filled; logged at `:358-363`) | Log rows for `replay` and `LINK_ID_REUSED` have null `target_kind/id/name`; an admin filtering the Activity log for "who touched Alex" misses retried rows (worse with APP-7). Also `stable(prev.payload) === stable(it.payload)` ignores `note` and `leaderId`, so the same id with a new note is reported `replay` and the new note is silently dropped. | Fill `tgt` from `prev` (`personId` → roster name; `groupId`/`rowId` from payload) before returning. Include note (hasNote) and `leaderId` in the replay equality so a changed note becomes `LINK_ID_REUSED`. | no |
| APP-31 | smoke 1; six-hat M1; ponytail S1; fpn M4; edge M15; rel m9(1); speed M9; ui smoke 4 | `link.service.ts:264-267` (enqueue checks only `!r || !r.active`); door list shows student + leader only (`:454`) | A stale list or a crafted `/link/batch` item with a parent's `personId` (kind `other`) is `saved` and the console checks an adult in to the youth service (or refuses `no-room` a minute later). | Refuse `checkIn` for kind `other` (admin exception optional); allow `checkOut` for any kind so an existing check-in can still be undone. **Order:** fix APP-10 first (or exempt the read-time match of an active app leader), else leaders mapped to `other` rows break. | no |
| APP-33 | six-hat M7; edge M14; rel m6 | `index.html:9069-9072` (comment says minors' names never go to localStorage), `:9173`, `:9181`, `:10108` (first-timer names), `:9911`, `:10013` (notes), `:9342-9346` / `:2140` / `:11938-11942` (`_lkSoftReset` keeps the queue on session expiry) | A queued first-timer (a minor's name) or a pastoral note stays in `ysc.lkq.<old id>` after a session expiry; if another login then uses the phone, those items sit there (and never send) until the first login returns, possibly never, then land as "fresh" (APP-16). | Fix the comment. On login, show "N unsent items from another login on this phone: Send / Discard", or delete keys older than 3 days (stamp stored-at); optionally keep notes in memory only. | no |
| APP-34 | six-hat M9; edge M12; ui M13 (1st bullet); rel m3 | `index.html:9316-9325` (`_lkLogoutGuard`), `:9320`, `:1503` (identity items pushed with `soon = false`), `:9337-9338`, `:2342-2344` | The guard says "1 check-in hasn't been sent" for a report or step; "they'll be lost" can be wrong (an in-flight request may still land); a queue holding only identity ("I am" switch) items skips the prompt and `_lkClear` drops them, so ledger 12 misses the switch. | Say "N actions"; word it "they may not be sent"; if only identity items remain, do one bounded silent `_lkFlush()` before clearing. | no |
| APP-35 | six-hat M10 | `index.html:9499-9500` | "Still to come 580": every active Elvanto youth counts, so the big number is noise on a Friday. | Show "In N" only, or count people who came last term. | no (unless the roster push should be narrower: console's call) |
| APP-36 | six-hat M11; ui M13 (2nd bullet) | `index.html:9467` (grade filter fixed 7–12, labelled "Grade 7"), `:9511` (chip says "Yr 7") | With Youth Setup "Include Grade 6" on, Grade 6 youth appear only under All; the filter and chip use different words. | Build the list from `_gradeList()`; use one label style. | no |
| APP-37 | six-hat M13 | spec §2.5 (`:102`) names `src/tests/migration-numbers.test.ts` (the check is `migrate-runner.test.ts:99`); `CLAUDE.md` | Doc drift: CLAUDE.md has no "Elvanto link (app side)" section and no `/link`/`/sync` rows in Key API routes; rotating `LINK_SYNC_TOKEN` (both sides, then redeploy) is not written down. | Update before V3. | no |
| APP-38 | ponytail M1 | `link.service.ts:75-78`, `:451`, `:460` (`practice` on views); `link-rules.ts:176-188` (`CheckState.practice/.row/.source`); SPA writes only (`index.html:9216`, `:9228`, `:9384`) | `practice` is computed and sent but no render reads it (the practice line comes from `status === 'shadowed'`); a later "fix" to it changes nothing on screen. | Drop `practice` from both views and the SPA writes; `effectiveCheckState` returns `{ in }`; small spec §5.2/§8.2 edit. | no |
| APP-39 | ponytail M2 | `access-control.ts:157-160` (`canUseLink`, no caller); `env.ts:37` (`env.LINK_SYNC_TOKEN` never read); `setup.service.ts:96` (repeats trim/length rule) | Dead helpers and a duplicated token rule drift apart. | Delete `canUseLink` + its test and `env.LINK_SYNC_TOKEN`; setup uses `readLinkSyncToken(env)`. | no |
| APP-40 | ponytail M3; speed M8 | `link.service.ts:573-583`; SPA `index.html:10187`, `:10249` (no `?match=`, filters client-side) | `/link/admin/roster` returns every active roster row (leaders, `other`, `auto`) with candidates computed for each (~600 × ~680 students, ~1 M string ops, 0.2–0.5 s) and sends minors' DOBs the page never shows (data minimisation, contract §7.4). | Return only `kind = 'student'` rows with `match !== 'auto'`; compute candidates only for `none`/`ambiguous`; index students by folded name once; drop unused fields (`firstName`, `lastName`, `gender`). | no |
| APP-41 | ponytail M4 | `link.service.ts:623`; `index.html:10201` | The shadow-check `message` is sent by the server and also held in the SPA `V` map. | Drop the server field; keep the verdict code. | no |
| APP-42 | ponytail M5 | `index.html:9826-9828` (`LINK.rServices`/`rToday` duplicate `LINK.services`/`today`), `:10282` (`renderLinkAdmin` fetches `/link/checkin` only for `today`; `_lkToday()` at `:9932` already falls back) | Two copies of the pick list and an extra admin request. | One `LINK.services`/`LINK.today`, loaded once; drop the admin fetch. | no |
| APP-43 | ponytail M6 | client `_lkDefaultSvcFor`/`_lkHHMM` (`index.html:9709-9719`); server `defaultService`/`brisbaneHHMM` (`link-rules.ts:29-51`) | The which-service default lives in both; if the Sunday time changes and only the server is edited, the report form and door disagree and SPA tests still pass. | Server marks each pick-list service `isDefault` (= `defaultService(s.ymd, services)`); client uses `services.find(s => s.ymd === day && s.isDefault)`. `/link` only, no fixture change. | no |
| APP-44 | ponytail M7 (Plausible) | `index.html:9358-9388` (`_lkPollOpen` every 15 s alongside the 60 s list refresh) | ~4 extra requests per minute per door phone, mostly returning unchanged rows (the console reports ~once per 60 s). | Drop `_lkPollOpen`, or poll every 30 s and skip the 60 s refresh on that tick. Owner/RV7 call on how fast "In Elvanto ✓" must appear. | no |
| APP-45 | fpn M1. Related: APP-3 | `link.service.ts:313-321` (step 5), `:325-334` (open-unique index → `duplicate`) | Console offline: A checks X in (pending), B checks X out (pending), someone checks X in again → index returns the first pending check-in as `duplicate`; the phone shows **In**, but the console runs in then out, so Elvanto has X **out**. With an `unclear` check-in, X can't be checked in again for that service until resolved. | For a new checkIn whose newest live row is a **pending** checkOut, cancel that checkOut and return the existing checkIn as `duplicate` (and the mirror case); if the opposite row is claimed/unclear, refuse "Still sending, try again in a minute". | no |
| APP-46 | fpn M2 (operator call; may be intended) | `link-rules.ts:183-185` (shadowed decides `in`); `link.service.ts:319` | The console switches `checkIn` from shadow to live at 7:15 pm; re-tapping someone checked in (shadowed) at 6:45 returns `duplicate`, so the real check-in is never sent. | Don't let a `shadowed` row count as `in` for the step-5 duplicate check (keep it for display). | no |
| APP-47 | fpn M7 | `link-rules.ts:135` (`nameKey` lower-cases only); `link-contract.ts:278` (`lastName` untrimmed) | "Smith " or "Mary  Ann" never auto-match (and `rosterPersonOf` uses `fold`, so the matchers disagree); two "Josh Smith" students (Yr 8 and Yr 11) are both `ambiguous` though grade separates them. | Fold whitespace in `nameKey`; use roster grade as a tie-break only when exactly one candidate's grade matches. | no |
| APP-48 | fpn M8 | `link-rules.ts:57` (`\b(sun|mon|…)[a-z]*\b`) | `lastMeetingDate` reads "Monthly" as Monday and "Sunset" as Sunday, so the default report date is wrong. | Match full day names or exact 3-letter forms. | no |
| APP-49 | fpn M10 | `link.spa.test.ts` prelude `const LK_DOOR_TYPES = [...]` (copy of `index.html:9080`) | If the real constant changes, the SPA tests keep the old value. | Add `LK_DOOR_TYPES` to the extracted names (or read it by regex). | no |
| APP-50 | edge M2 | `index.html:9226` (`_lkApply` sets `p.mine = true` for any non-refused outcome, `duplicate` included) | Phone B taps Mia a moment after phone A (other login) → `duplicate` → B shows Undo, which then fails `LINK_NOT_YOURS` (until the 60 s refresh). | Set `mine` from the server (a flag in the batch result), or `false` on `duplicate`. | no |
| APP-51 | edge M3 | `index.html:9281-9285` (undo branch handles `cancelled`, `saved`, `too-late`, `refused` only) | An undo whose reply was lost comes back `replay`; a second Undo gets `duplicate`; the row stays "In" with Undo for up to 60 s. | Treat `replay` and `duplicate` like `saved` (apply a `checkOut` with `r.action`/`existingId`). | no |
| APP-52 | edge M4 | `index.html:9129`, `:9157`, `:9166` (`_lkTime` only) | "The console was last seen 7:02 pm" on Monday for a Friday sighting reads as today. | Use `_lkAt()` (day + time) when the date isn't today. | no |
| APP-53 | edge M6 (spec call) | `link-rules.ts:16-18`, `:45-51`; `index.html:9461` | A phone opened fresh after midnight on Friday night gets "Pick a service" (Saturday has no default); a leader doing 00:15 check-outs must pick Friday by hand. | Optional: before ~03:00 Brisbane, use the previous day for the default. | no |
| APP-54 | edge M7 (Plausible; spec call) | `link-rules.ts:48`; `index.html:9459`, `:9711-9719` | Sunday with a 10:15 Connect and an 18:00 youth service: at 18:05 the default is 10:15 and the leader checks youth in to the morning service. | For check-ins only, prefer the day's service nearest to now / in progress; keep 10:15 for reports. | no |
| APP-55 | edge M8; ui Plausible ("same name and grade") | `link.service.ts:145-152` (counts roster hits, not app leaders with that name); `index.html:9678-9690` ("I am" picker shows `fullName` only), `:9507-9523` (door rows name + "Yr N") | Two app leaders "Sam Smith", only one in Elvanto: both map to the same `personId`, so ticking the wrong Sam checks the other in; "I am" can't tell them apart (`by.leaderName` ambiguous in Elvanto). Two same-name same-grade students look identical at the door. | In `rosterPersonOf` return null when more than one active app leader folds to the name; show grade/gender in the picker and on door rows when names collide. Owner decision if it occurs at YS. | no |
| APP-56 | edge M9 | `index.html:9597`, `:9613`, `:9584-9586` (`_lkOpenLeaders` returns silently if the list isn't loaded) | With unlinked leaders, rows are grey "Not linked" with no explanation (the only fix is renaming the app leader to the exact Elvanto name); tapping "Check in leaders" while the list loads does nothing. | One line when `nNl > 0`: "Not linked: no Elvanto person has this exact name. Ask the admin to fix the name."; disable or show "Loading…" until loaded. | no |
| APP-57 | ui M1 | `index.html:727` (`.lk-pill` 12 px font, 4 px padding), `:9305` | The red "Not saved — tap to retry" pill (the only manual retry) is ~22 px tall. | `.lk-pill.bad{min-height:40px;padding:8px 14px}`. | no |
| APP-58 | ui M2 | `index.html:784-785` (`.lk-chk`), `:10075` | Checkbox rows ("Group did not meet", "Keep note(s) private", the first-timer tick) measure ~20 px. | `.lk-chk{min-height:40px}`. | no |
| APP-59 | ui M3 | `index.html:757` (`.lk-done summary`), `.btn-full` secondaries | "Checked in · N" summary and full-width secondary buttons are 39 px (1 px under target; cosmetic). | `min-height:40px` on `.lk-done summary`. | no |
| APP-60 | ui M4 | `index.html:9618`, `:9820` (`btn-ghost btn-sm`) | "Back to the group" / "All groups" / "Tick all" are 29 px on desktop or touch laptops (coarse phones get 40 px). | Optional min-height. | no |
| APP-61 | ui M5 | `index.html:10224-10225` (two `type=date` `.fi` in one `.lk-filters` row) | At phone width the Activity "To" date runs to 359 px against a 345 px page and is clipped. | `flex-wrap:wrap` on that row, or `min-width:0;flex:1 1 140px` on the inputs. | no |
| APP-62 | ui M6 | `index.html:9468-9477` | At 360 × 740 with three banners, the first door name starts at ~y = 490 px, and the search box scrolls away. | Make the door `.lk-filters` sticky (with background); optionally put New person and Check in leaders side by side. | no |
| APP-63 | ui M8 | `index.html:10168`, `:10176`, `:10140`, `:10146` | Admin Status/Today/Activity show raw codes (`shadow`, `locked`, `claimed`, `unclear`, `refused:LINK_ID_REUSED`, "Mirror: roster"). | A small label map (Practice / Not connected / Live; Waiting / Sending / Not sure; Saved / Already sent / Refused). | no |
| APP-64 | ui M9 | `index.html:10229` | The Export button uses the `upload` icon for a download. | Download-style icon, or none. | no |
| APP-65 | ui M10 | `index.html:9683-9686` | "Who are you?" lists 40+ leaders A–Z with no search and a non-sticky Cancel at the very end; it opens before every first report/step. | Wrap Cancel in `.bus-sheet-actions`; add a filter box above ~12 leaders. | no |
| APP-66 | ui M11 | `index.html:9978`, `:9990` (`.bus-sheet-actions` inside `#lk-fs`, so `.mo-box > .bus-sheet-actions` at `:718-719` doesn't match) | The Complete sheet's buttons are content-width, left-aligned and not sticky (nothing hidden today). | Render the actions outside `#lk-fs`, as the leader sheet does. | no |
| APP-67 | ui M12 | `index.html:9857` (date = `g.defaultDate`), `:9785` | New report opens straight into the yellow "already a report" warning with Send disabled (and looking enabled, APP-19); "Edit it." isn't a link. | When `defaultDate` equals `lastReport.date` and it's editable, open Edit; or add an "Edit the last report" button in the warning. | no |
| APP-68 | ui M13 (remaining bullets) | `index.html:9745` (full "Brisbane - YS - …" group prefix; `lgDisplayName()` exists), `:9965` (no affordance on completable flow rows), `:9615`, `:9796` (circle-check inside a filled square), `:9989` | Small wording/consistency issues. | Use `lgDisplayName()`; add a chevron/button to flow rows; plain tick path; "Completing may send Elvanto's email or text for this step." | no |
| APP-69 | ui Plausible | `index.html:8892-8895` (`_nyHost()` needs `LINK.ldrs` from `/leaders`) | If New person Send is tapped before `/leaders` returns, the host is empty and "Who are you?" opens although a leader is picked (harmless but confusing). A junior `leader` falls back to the account display name, not the leader's name. | Await the leaders load before deciding; use the bound leader's name for junior logins. | no |
| APP-70 | ui Plausible (not tested on a device) | door search at ~360–400 px of 740 | With an iOS keyboard (~300 px), the filtered rows under the search box sit behind the keyboard. | Covered by APP-62's sticky filters; verify on a device. | no |
| APP-71 | rel m2 | `link.service.ts:193` (`logRow` uses `randomUUID()`), `:526-531` | A lost reply retried three times writes three identical "I am" switch rows (plus a `replay` row per retry) in the admin log and export. | For identity items use `id: it.id` as the log id with `on conflict (id) do nothing`; optionally skip log rows for pure replays. | no |
| APP-72 | rel m4 | `supabase.link.ts:74-82` (only `link_outbox_open_uq` 23505 is mapped; PK 23505 re-thrown); `link.service.ts:230-236` | The PWA and a tab on one phone both flush, or a 20 s client timeout re-sends while the server is still working: both insert the same id → PK violation → 503 for the loser's whole batch (heals as `replay`; pill turns amber/red). | `insert … on conflict (id) do nothing returning *`; if nothing returns, re-read and run the replay/reuse check. | no |
| APP-73 | rel m7 (Plausible) | `index.html:9174-9184` (`_lkQGet` prefers localStorage; `_lkQSet` may throw after updating `LINK.mem`) | After a `QuotaExceededError` (or Safari eviction), `_lkQGet` returns the stale stored copy: new taps vanish and confirmed items reappear (harmless replays). | In `_lkQSet`'s catch, `removeItem(_lkKey())` and set `LINK.memOnly = true` (shared fix with APP-13). | no |
| APP-74 | speed M1 | `index.html:9399-9417` (`_lkRefreshView`), `:9492-9505` (`_lkListHtml`), `:9479` (`_lkSetSearch`) | Each tap and each keystroke rebuilds the whole ~500-row list (re-parsing the queue 3×, ~150–250 KB `innerHTML`): ~10–30 ms on a recent iPhone, plausibly >100 ms on a low-end Android. | Render "Checked in" rows only when `LINK.doneOpen`; debounce search ~80 ms; optionally patch only the tapped row. | no |
| APP-75 | speed M2 | `index.html:908-909`, `:947` (`r()` always runs `_npStart`/`_npDone`), `:998`, `:9240`, `:9350`, `:9377` | Every background flush/poll animates the global `#nprog` loading bar (up to 20 s on a dead signal), contradicting "the phone never waits". | A `quiet` flag on `r()` (or `API.bg`) for `_lkFlush`, `_lkPollOpen`, `_lkStatusLoad` and tick loads. | no |
| APP-76 | speed M3 | `index.html:9450-9462` (`renderLinkCheckin`); `link.service.ts:432-441` | Opening the door makes two sequential `/link/checkin` requests (services, then people) before any name shows; worse after a cold start. | Accept `serviceTime=default` (or return people for the default when no `serviceTime` is given) so one request paints the list. App-only shape; prefer the query-value form if the reply is considered frozen. | no |
| APP-77 | speed M5 (Plausible; not urgent) | `0017_elvanto_link.sql:30-33` (indexes); `supabase.link.ts:101-102` (`person_id =`, `payload->>'serviceTimeId' =`); `link.service.ts:217-218`, `:436` | `/link/checkin` and per-item dedupe scan `link_outbox` in full (no usable index), and outbox rows are never deleted (~20 k/year); by late 2027 each call scans 20–40 k jsonb rows. | Pass `serviceDateFrom/To = svc.ymd` in `checkRows` and `checkin` so `link_outbox_date_idx` narrows to one day (no migration); later an index or purge in `0018`. | no |
| APP-78 | speed M6 | `link.service.ts:518-540` (sequential loop), `:230`, `:314`, `:326` | A 40–50-item batch runs ~3 queries per item in sequence (~0.3–0.6 s on one connection). Acceptable today. | If it grows: one `listActions({ ids })` before the loop; read check rows once per `serviceTimeId` and update that memo after each insert. | no |
| APP-79 | speed M7 | `link.service.ts:145-152` (`rosterPersonOf`), `:457-461` | `/link/checkin` repeats ~60 k `fold` calls (leaders × roster) per request, ~10–40 ms CPU at 30 phones × 1/min. | Build `Map<foldedName, rows[]>` once per call. | no |
| APP-80 | ponytail M8 | `supabase.link.ts:133-141`; memory repo `:134-141` | Three purge statements run inside every claim transaction (every 60 s, per console), holding the `skip locked` lease transaction open longer; nothing needs them more than daily. | Run the purge on the roster push, or only when the Brisbane date changed since the last purge. | no |
| APP-81 | ui M7. Related: APP-25 | `index.html:9520` (hides Check out only for `off`) | With the console reporting `checkOut: locked` (the normal state today), every checked-in row offers Check out, and the tap is refused later. | Hide or disable Check out with the locked line when `_lkCap('checkOut') === 'locked'` (decide together with APP-25 and decision 10, "check-out on"). | no |
| APP-82 | ponytail M9 | `supabase.link.ts:192-206` | `applyResults` reads each row `for update`, then re-checks `where status = old.status [and lease_owner = …]`; the re-select + second `applyOutcome` (`:203-206`) can never run. | Keep the row lock and use an unconditional `update … where id`, or keep the guard and drop `for update` — not both. | no |
| APP-83 | ponytail M10 (Plausible; refactor tested code only if touching it anyway) | caches `LINK.refusals`/`gres`/`fres`; loops `_lkQueuedIdx`, `_lkGroupAct`, `_lkFlowAct`, `_lkReportUndo`, `_lkStepUndo` (`index.html:9199`, `:9728`, `:9935`, `:9915`, `:10019`) | Three answer caches and five copies of "find the queued item". | One `LINK.ans[key]` and one `_lkQueuedFor(key)` (key `svc:pid` / `g:groupId` / `f:rowId`), ~40 fewer lines. | no |
| APP-84 | ponytail M13 | `link-rules.ts:82` (`FINAL` includes `unclear`); `in-memory/link.repository.ts:54` (`FINAL` excludes it) | Two constants named `FINAL` mean different things: a trap for the next edit. | Rename the memory one `PURGEABLE`, or inline it. | no |

---

## Merge notes (what was combined, and what was kept apart on purpose)

- **"Supabase SQL never run"** (fpn I3 + rel I4) → APP-2.
- **"Row jumps into the collapsed list / double tap"** (six-hat I6 + speed I2) → APP-9.
- **Undo / check-out ordering** — kept **separate**: APP-3 (edge I2, server claim order; needs a console ordering
  guarantee) and APP-15 (rel I1, phone-side in-flight race). APP-45 (fpn M1, server dedupe of in-out-in) is a third,
  related mechanism. APP-5 (ownership) is about who may undo, not ordering.
- **The four V1 smoke minors** → APP-31 (kind `other`), APP-24 (resolved detail), APP-30 (replay log target), APP-26
  (pushes while Off). Smoke observation 5 is not a bug (see Context).
- **Wrong service**: APP-8 (mirror lacks tonight's service) and APP-14 (stale pick on a phone left open) are separate
  causes that share the "not today" warning.
- **Rate limiter** (five reviews) → APP-12. **Queue blocked by 4xx / switch Off** (three reviews) → APP-17.
  **No tap time** (rel I2 + edge M5) → APP-16. **Admin preview** (edge I1 + six-hat M12) → APP-13.
  **Leader name-matching**: APP-10 (wrong kind), APP-31 (enqueue kind check, ordered after APP-10), APP-55 (same-name leaders).
- **Severity** of a merged entry = the highest any source gave it.
- **Counting:** APP-1 to APP-23 are Important (APP-2, 3, 4 cross-side; the rest app). APP-24 to APP-84 are Minor
  (APP-24 to 29 and APP-32 cross-side/CONTRACT; the rest app). Side totals: CONTRACT 2 (APP-24, APP-25), both 8
  (APP-2, 3, 4, 26, 27, 28, 29, 32), app 74.
