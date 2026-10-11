# RV7 — Speed / end-user feel review (Elvanto link, app side)

Reviewer RV7. Read-only. Scope: plan Lane RV row RV7. Branch `feat/elvanto-link-app` @ `905d62e`, diff
`origin/master...HEAD`. Every claim below comes from reading the code. Timings are estimates, marked as such; none
were measured on a phone.

Totals: **Critical 0 · Important 3 · Minor 11** (all side=app; 0 console, 0 both, 0 CONTRACT).

---

## Important

### I1. A backlog of more than 50 items drains in 15 s steps, and the logout guard reports "could not be sent" when the network is fine
- **side:** app · **files:** `public/index.html:9232-9246` (`_lkFlush`), `:9298` (`_lkResults`: `if (left.length) _lkSchedule(15000)`), `:9316-9325` (`_lkLogoutGuard`), `:9660-9670` (`_lkSwitchGuard`)
- **Failure scenario:** the door has no signal for 20 minutes and 160 check-ins queue up. Signal returns. `_lkFlush`
  sends 50 (`q.slice(0, 50)`). The batch succeeds, 110 are left, and `_lkResults` waits **15 s** before the next
  batch. Draining takes about 3 × 15 s = 45 s, and the pill shows "110 waiting to send" the whole time. Worse: the host
  taps Log out. The guard runs `Promise.race([_lkFlush(), 10 s])`, one batch of 50 succeeds, 110 are still queued, and
  the guard says **"They could not be sent. Log out anyway (they'll be lost)"**. The server was reachable the whole time.
  If the host takes that option, 110 check-ins are lost. The "I am" switch guard has the same one-batch limit, but it
  continues anyway and the items keep their own "I am", so nothing is lost there.
- **Same root cause, smaller case:** a tap made while a flush is in flight. Its 300 ms timer fires, `_lkFlush` returns
  the in-flight promise (`:9233`), and nothing new is sent. When the flush ends, the new item is left over, so it waits
  15 s. At a busy door (taps every 1–2 s, a flush of about 0.3–1 s, longer on a cold start) this happens often. The row
  says "Waiting to send." for 15 s instead of under 1 s.
- **Fix:** in `_lkResults`, when the batch succeeded and the leftovers are not `RATE_LIMITED`, call
  `_lkSchedule(300)` (or flush again at once), not `_lkSchedule(15000)`. Keep 15 s only for rate-limited items. In
  `_lkLogoutGuard` and `_lkSwitchGuard`, loop `_lkFlush()` until the queue is empty, a flush fails, or 10 s has passed,
  and say "could not be sent" only when a flush actually failed. **Other side:** no change.

### I2. A tapped row leaves the list under the finger, so a quick second tap checks in the next person
- **side:** app · **files:** `public/index.html:9498` (`due`/`done` split), `:9507-9523` (`_lkRowHtml`: the whole row is
  the tap target, `role="button" onclick="_lkCheck(...)"`), `:9526-9535` (`_lkCheck`), `:9503` (collapsed "Checked in")
- **Failure scenario:** the list is not filtered, and the host taps "Alex Sample". `_lkPush` → `_lkRefreshView`
  rebuilds `#lk-list` at once. Alex is now `checkedIn` (from the queue merge) and moves into the **collapsed**
  "Checked in" `<details>`. The next row slides up into the same place. A double tap, or a second tap by an impatient
  host, lands on the next name and queues a check-in for a different minor. To undo it, the host must notice, open
  "Checked in", find that person and tap Undo. If the 300 ms flush has already gone, this sends an `undo` (a real
  `checkOut`) to Elvanto instead of a silent local removal. **Plausible:** how often it happens depends on the
  double-tap behaviour of iOS and Android, which was not tested. The spec copies the camp app's list (§11, frame 1),
  so this is a design trade-off, not a coding error.
- **Fix (pick one):** keep a tapped row in place for about 3 s with "Waiting to send · Undo" before it moves; or
  ignore a row tap within about 400 ms of the last list rebuild; or show a "Just checked in: Alex · Undo" strip at the
  top of the list. **Other side:** no change.

### I3. The 60 s list refresh can overwrite a just-confirmed tap with older server data, so the person shows "not in" again for up to 60 s
- **side:** app · **files:** `public/index.html:9363` (60 s tick → `_lkLoadPeople`), `:9439-9447` (replaces
  `LINK.people[svc]` wholesale), `:9254-9300` (`_lkResults` → `_lkApply` mutates the old object and removes the item
  from the queue), `:9368-9375` (`_lkPollOpen` polls only rows with `p.mine && action`)
- **Failure scenario (Plausible, timing):** at T0 the 60 s refresh sends `GET /link/checkin?serviceTime=…`. The server
  reads `link_outbox` before the next insert. At T0+0.1 s the flush of Jamie's check-in reaches the server, is inserted,
  and returns. `_lkApply` marks Jamie in, and the item leaves the queue. At T0+0.4 s the refresh reply arrives. It was
  read before the insert, so it replaces the list and Jamie is back under "Still to come" with a Check in button.
  Nothing in the queue covers Jamie any more, and her row has `action: null`, so the 15 s poll skips it. She stays
  wrong until the next 60 s refresh. A host taps her again, and the server answers `duplicate` (the data is safe), but
  the door count and the list are wrong for up to a minute. The race window is the overlap of two ~0.5 s requests once
  a minute, so a busy door sees it now and then.
- **Fix:** stamp each load (`const gen = ++LINK.loadGen`). In `_lkResults`, keep the confirmed acts of the last ~2
  minutes in `LINK.recent[svc:pid]`. When a load lands, re-apply `LINK.recent` on top (as `_lkMerge` does for the
  queue). The simpler fix is to drop a load that started before the latest `_lkResults`. **Other side:** no change.

---

## Minor

### M1. Each tap and each keystroke rebuilds the whole door list (~500 rows); probably 30–120 ms on an older phone
- **side:** app · **files:** `public/index.html:9399-9417` (`_lkRefreshView`), `:9492-9505` (`_lkListHtml`), `:9479`
  (`_lkSetSearch`)
- Tap path (traced): `_lkCheck` → `_lkQGet` (localStorage parse) → `_lkPush` → `_lkQSet` (stringify + write) →
  `_lkSchedule(300)` → `_lkRefreshView` → `_lkTop` (`_lkPill` parses the queue again) + `_lkListHtml` (parses again,
  then `_lkMerge`, `_lkFilter`, and `_lkRowHtml` for **every** row, including the collapsed "Checked in" rows) → one
  `innerHTML` of roughly 150–250 KB. The paint happens in the same task as the tap, with **no network wait**, which
  verifies the spec's rule. The cost scales with the roster (~500 student + leader rows from about 600 roster rows),
  not with the change. The estimate is about 10–30 ms on a recent iPhone and **plausibly over 100 ms on a low-end
  Android**, and every search keystroke costs the same.
- **Fix:** cap the "Still to come" rows to the filter result (already done) and render the "Checked in" rows only when
  `LINK.doneOpen` is true. Debounce search input by about 80 ms. Optionally, patch only the tapped row on tap. **Other
  side:** no change.

### M2. Every background flush and poll drives the global `#nprog` loading bar
- **side:** app · **files:** `public/index.html:908-909, 947` (`r()` always calls `_npStart`/`_npDone`), `:998`
  (`API.fresh`), `:9240` (flush), `:9350`, `:9377`
- About 300 ms after each tap, every 15 s (open-row poll) and every 60 s (status + list), the top bar animates. When
  the signal is down, each retry crawls for up to 20 s. The screen promises "the phone never waits", but the bar says
  "loading". **Fix:** add a `quiet` flag to `r()` (or an `API.bg` helper) that skips `_npStart`/`_npDone`, and use it
  for `_lkFlush`, `_lkPollOpen`, `_lkStatusLoad` and the tick-driven loads. **Other side:** no change.

### M3. Opening the door screen makes two `/link/checkin` requests in sequence
- **side:** app · **files:** `public/index.html:9450-9462` (`renderLinkCheckin`), `src/services/link.service.ts:432-441`
- The first visit sends `GET /link/checkin` (services only) and waits for it, then sends
  `GET /link/checkin?serviceTime=<default>`. Both requests read services, the mirror state and the settings. On the
  first Friday open after a cold start, that is a cold start plus two round trips before any name shows. **Fix:** accept
  `serviceTime=default` (or return `people`/`leaders` for `defaultServiceTimeId` when no `serviceTime` is given) so
  one request paints the list. **Other side:** no change (`/link/checkin` is app-only shape beyond contract §4's
  fields; adding the people to the no-arg reply is additive). If RV-contract readers consider the reply frozen, use
  the `serviceTime=default` query value instead, which needs no shape change.

### M4. The admin Status card makes six `/link/actions` calls when one would do
- **side:** app · **files:** `public/index.html:10238-10247` (`_lkAdmLoadActs`), `src/services/link.service.ts:492-508`
- `listActions` already accepts `serviceDate` with no `type` (`:499` refuses only when ids, serviceDate **and** type are
  all missing), and then returns every type. So `GET /link/actions?serviceDate=<today>` returns the same rows as the
  six calls. Opening the page currently sends 6 × (settings read + an outbox query + one `users.findById` per distinct
  creator, `:502-504`), plus `/link/admin/roster`, `/link/admin/log`, `/link/status` and possibly `/link/checkin`:
  about 10 requests at once on `max: 2` connections. **Fix:** make one call in the SPA. Optionally, give `listActions`
  a per-call `users` memo (or one `users.findAll()`). **Other side:** no change.

### M5. `/link/checkin` and batch dedupe filter the outbox on columns with no index; the outbox is never purged
- **side:** app · **files:** `supabase/migrations/0017_elvanto_link.sql:30-33` (indexes: `dedupe_key` partial,
  `created_at` partial, `service_date`), `src/repositories/supabase/supabase.link.ts:101-102` (`person_id =`,
  `payload->>'serviceTimeId' =`), `src/services/link.service.ts:217-218` (`checkRows`, one per check-in item),
  `:436` (`checkin`)
- Neither filter can use an index, so each call scans `link_outbox` in full. `claim()` only nulls old notes. No outbox
  row is ever deleted, so the table grows by roughly 300–400 rows a week (about 20 k a year). Today a scan takes about
  a millisecond. By late 2027 each `/link/checkin` (30 phones × 1/min) and each check-in item in a batch (up to 50 in
  sequence) scans about 20–40 k jsonb rows. **Plausible** at a few ms each; not urgent. **Fix (no migration needed):**
  pass `serviceDateFrom/To = svc.ymd` in `checkRows` and in `checkin` (the service is known in both), so the existing
  `link_outbox_date_idx` narrows the scan to one day. Later, add an index or a purge in `0018`. **Other side:** no
  change.

### M6. A 40-leader or 50-item batch runs about 3 queries per item, one after another
- **side:** app · **files:** `src/services/link.service.ts:518-540` (sequential loop), `:230` (`getAction`), `:314`
  (`checkRows`), `:326` (`insertAction`)
- Per action item: a PK read, the M5 scan and an insert, all in sequence. The memoised reads (roster, services,
  consoles, mirror, leaders, settings, login) run once per call. For 40 leaders that is about 120 round trips. On
  `syd1` to the Sydney pooler at about 2–4 ms each, that is roughly **0.3–0.6 s**, held on one connection. That is well
  inside the 20 s route timeout and the 20 s client timeout, so this is **acceptable today**. If it grows: read all
  `getAction` ids with one `listActions({ ids })` before the loop, and read the check rows once per `serviceTimeId` and
  update that memo after each insert. **Other side:** no change.

### M7. `/link/checkin` repeats O(leaders × roster) name folding on every call
- **side:** app · **files:** `src/services/link.service.ts:145-152` (`rosterPersonOf`: `roster.filter` with
  `fold(fullName(r))` per row), `:457-461`
- About 100 leaders × 600 roster rows = 60 k `fold` calls (trim, regex, lowercase) per request, roughly 10–40 ms of CPU.
  At 30 phones × 1/min this is noticeable but not harmful. **Fix:** build `Map<foldedName, LinkRosterRow[]>` once per
  call. **Other side:** no change.

### M8. `/link/admin/roster` builds candidates for every roster row with an O(roster × students) scan
- **side:** app · **files:** `src/services/link.service.ts:573-583`
- The SPA calls it with no `match` filter (`public/index.html:10249`), so the server builds candidates for all ~600
  active rows, including `auto` and leader rows, which the SPA never shows (`:10187` keeps `kind === 'student'` and
  one match state, and shows at most 60). That is 600 × ~680 students × 2–3 `fold`/`fullName` calls, about 1 M string
  operations, plausibly 0.2–0.5 s per open, plus a large reply. **Fix:** index the students by folded full name and by
  folded last name once. Have the SPA pass `?match=` for the tab, or skip candidates for `auto`/`manual`/`ignored`
  rows. **Other side:** no change.

### M9. V1 minor: a check-in for a roster `other` person is accepted
- **side:** app · **file:** `src/services/link.service.ts:264-267` (only `!r || !r.active` is refused)
- Verified. The contract §4 door list is `student` + `leader` only, but a crafted batch with an `other` person id is
  saved and sent. **Careful with the fix:** `rosterPersonOf` (`:145-152`) can link an app leader to an **`other`**
  roster row (it prefers `leader` rows but does not require one), and the leader sheet then sends that `personId`. So
  refuse `other` only when the person is not the read-time match of an active app leader. Otherwise also restrict
  `rosterPersonOf` to `student`/`leader` rows. No speed impact. **Other side:** no change.

### M10. V1 minors: replay log rows have no target, and a resolved unclear row keeps its old detail
- **side:** app · **files:** `src/services/link.service.ts:230-235` (replay returns before `tgt` is set →
  `targetKind/Id/Name` null in the log row built at `:362-363`); `src/services/link-rules.ts:100-104` (`resolved`
  sets `status`/`resultAt` but not `detail: null`)
- Both verified. **Fix:** on replay, fill `tgt` from `prev` (`personId`, or `payload.groupId`/`rowId`, with the name
  from the memoised roster/groups/flows). In `applyOutcome` `resolved`, also set `detail: null` (and `reason: null`
  for `landed`). The second one changes a shared rule, so add a `link-rules.test.ts` case. No speed impact. **Other
  side:** no change.

### M11. V1 minor: pushes still apply while the switch is Off
- **side:** app · **file:** `src/services/sync.service.ts:66-73` (no switch check; `claim` at `:38` does check it)
- Verified. From the speed side, a console left in its window rewrites `link_services` (delete + insert, with the
  `checked_in` jsonb) every 60 s and the roster every 6 h even when nothing reads them. The load is small. Keeping the
  mirrors warm while Off may be intended, so that turning On has fresh data. **Decide, then either** document it or
  return `{ applied: false }` when Off. Answering `applied: false` matches the fixture shape (`push-response.json`
  already allows it), so no CONTRACT change is needed. **Other side:** no change (the console already tolerates
  `applied: false`; confirm with RV-console).

---

## Verified OK

- **Tap-to-tick with no network wait.** `_lkCheck` (`index.html:9526`) → `_lkPush` (`:9189`) writes localStorage and
  repaints `#lk-top`/`#lk-list` in the same task. The POST happens later on a 300 ms debounced timer (`:9194`).
  Nothing awaits a fetch. (The cost of that repaint is M1.)
- **The roster loads once per service.** `LINK.people[svc]` is fetched only when it is missing (`:9462`), then
  revalidated every 60 s by the tick (`:9363`), as the spec requires. A different service causes a new load; going
  back to a loaded service does not.
- **Search runs on the phone.** `_lkSetSearch`/`_lkSetGrade` (`:9479-9480`) only filter `LINK.people` in memory, with
  all words in any order (`:9482-9491`). There is **no request per keystroke**. The input is never rebuilt, so it keeps
  focus.
- **The shell is not rebuilt when the queue changes.** `_lkRefreshView` (`:9399-9417`) sets only the `innerHTML` of
  `#lk-top`, `#lk-list`, `#lk-lq`/`#lk-lq-foot` and the other `lk-*` containers. `setApp(shell(...))` runs only on
  page entry or a service change (`:9451`, `:9468`), never from the queue.
- **Leader quick check-in, 40 leaders, one request.** `_lkLeadersSubmit` (`:9641-9657`) pushes one `checkIn` per
  ticked leader into the queue in one `_lkQSet`, then calls one `_lkSchedule(300)`. `_lkFlush` sends up to 50 per
  POST (`:9236`), which matches `LINK_BATCH_MAX = 50` on the server (`link.service.ts:27, 53`). So 40 leaders on an
  empty queue go in **one** `/link/batch`. (With more than 10 already queued, the rest follow 15 s later, which is I1.)
- **Batch size against the Supavisor pool (15).** The batch loop is sequential and holds about one connection
  (`max: 2` per instance, `client.ts:36`) for roughly 0.3–1.5 s for 50 items (M6). At a peak of about 30 door phones,
  the request mix is about 0.5 req/s of `/link/checkin`, 0.5 of `/link/status`, up to 1.5 of the `ids` poll, plus the
  flushes. That is about 3 req/s at 50–500 ms each, so a few requests are in flight at once. On Fluid Compute that is
  1–3 instances × 2 connections = **≤ 6 of the 15 session slots**, leaving room for Home `/batch` loads and the
  console's claim/result transactions. `dedupeReads` also coalesces the roster/services/mirror/consoles reads across
  concurrent requests on one instance (`container.ts:211`). Estimate, not measured.
- **Server cost of `/link/checkin`.** It reads whole mirror tables per call (roster ~600 rows, services, mirror state,
  all leaders), plus one outbox query for the service. There is **no cross-request cache**, only the per-call memo and
  in-flight dedupe. With the arithmetic above it is fine at current size. M5 and M7 are the parts that grow. A
  `takenAt`-keyed cache of the roster and services would be a cheap win later, not needed now.
- **The 60 s status poll and the 15 s open-row refresh run only while a link page is visible.** `_lkTickStart` runs
  only from `renderLink`. `_lkTick` stops itself when the page is hidden or another page is open (`:9359`). The
  `visibilitychange` handler stops it on hide and restarts it on show (`:9391-9396`). The 15 s poll is skipped when
  there are no open rows of mine (`:9376`) and is capped at 50 ids. `/link/status` costs 3 small reads. At about 30
  phones this is the 3 req/s above. That is fine.
- **Cold start on the first Friday tap.** The tap itself never waits (local queue). The first flush may hit a cold
  function (module load plus a pooler TLS connect, `connect_timeout: 10`), which takes about 1–3 s and is inside the
  20 s client timeout. If it fails, the backoff is 5 s, 15 s, 45 s (`:9247-9251`). The cold start the user does see is
  the door list load on page open, made longer by the two-request sequence in M3. `/link/batch` and `/link/checkin`
  are under the 20 s route guard, not `UNTIMED_ROUTES`, which is right for idempotent calls.
- **Rate limiter** (`LINK_RATE_MAX` 300 per login per 10 min) counts items, not requests. A rate-limited item stays
  queued and is retried after 15 s (`:9262`, `:9298`). Whether 300 is enough for one shared login at the door is RV6's
  call. From the speed side the retry behaviour is correct.
- **Region:** `vercel.json` pins `syd1`, the same region as the Sydney Supabase project, so per-query round trips stay
  in single-digit ms. That makes the sequential batch (M6) affordable.
