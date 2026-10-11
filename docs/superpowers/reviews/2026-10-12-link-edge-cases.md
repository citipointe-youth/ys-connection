# Elvanto link (app side): edge-case review (RV4)

Reviewer RV4, 2026-10-12. Read-only. Branch `feat/elvanto-link-app` at `905d62e` (diff `origin/master...HEAD`).
Inputs: the app spec (incl. §17), the frozen contract and fixtures, the plan (Lane RV row RV4), the ledger (decisions 1–23),
the V1 smoke results and the repo CLAUDE.md. Every claim below comes from the code. Where I am not sure, the finding says **Plausible**.
No tests or servers were run. Static reading only.

**Totals: Critical 0 · Important 4 (app 3, both 1) · Minor 18 (app 16, both 2) · console-only 0 · CONTRACT 0.**

---

## Important

### I1. An admin preview mixes the admin's link queue and cached lists with the previewed account's (both ways)
- **Side:** app. **Other side changes:** no.
- **Where:** `public/index.html:9173-9184` (`_lkKey`, `_lkQGet`, `_lkQSet`), `7505-7530` (`enterPreview`, `exitPreview`),
  `11922-11935` (`_handleAuthExpired`, preview branch).
- **What:** The queue key is per login (`ysc.lkq.<user id>`). But `_lkQGet()` falls back to `LINK.mem` when the current
  login's key is empty, and `LINK.mem` is one in-memory copy for every login. `enterPreview`, `exitPreview` and the preview
  branch of `_handleAuthExpired` change `S.user` and the token, but they never call `_lkSoftReset()`. So `LINK.mem`,
  `LINK.timer`, `LINK.services`, `LINK.people`, `LINK.groups`, `LINK.flows`, `LINK.status`, `LINK.refusals` and `LINK.gres` all carry over.
- **Scenario:** An admin taps 3 check-ins on the door screen, and they are still queued (no signal). The admin then
  previews `g79` (Simple logins: Junior Girls). The queue key is now `ysc.lkq.<g79 id>`, which is empty, so `_lkQGet()`
  returns the admin's 3 items from `LINK.mem`. The pending `LINK.timer` fires, and `_lkFlush` posts them with the
  **quad's** token. They are saved with `created_by = g79`, the claim gives `by.login = "g79"`, and `link_log` writes them
  under `g79`. After Exit Preview the admin's own localStorage key still holds them. They go again as `replay`, but the row
  stays attributed to the quad. The reverse is also true: a 1 h preview token expiry sends the quad's queued items as the
  admin. The cached `LINK.groups` that the admin loaded (every group) also shows in the quad preview until the next 60 s
  refresh. Taps on groups out of scope there come back `refused` "This group is not one of yours."
  This breaks the purpose of decision 12, the action log ("who did an action").
- **Fix:** In `enterPreview`, `exitPreview` and the preview branch of `_handleAuthExpired`, call `_lkSoftReset()` after the
  token swap. A flush already in flight has the old token. Wait for it (`await LINK.flushing`) before you swap, or ignore its
  results when `S.user.id` changed. Use `LINK.mem` only when localStorage throws (set a `LINK.memOnly` flag in
  `_lkQSet`'s catch), and key it by user id.

### I2. A check-out or an Undo can reach Elvanto before its check-in, so the youth ends up checked in
- **Side:** both. **Other side changes:** the console must also keep `createdAt` order inside one claim. The app fix
  alone does not need a console change.
- **Where:** `src/services/link.service.ts:313-321` (check-out allowed while the check-in is `pending`/`claimed`), `388-403`
  (Undo of a `claimed` check-in queues a new `checkOut`), `src/services/link-rules.ts:121-122` (`retry` → `pending` +
  `retryAt`), `src/repositories/supabase/supabase.link.ts:141-152` and `in-memory/link.repository.ts:100-104` (the claim
  picks every due row in `created_at` order; it has no per-person ordering, and `skip locked` skips a locked check-in).
- **Scenario A (retry):** Phone A (`grade9g`) checks in Josh at 18:40, and the row is claimed. The console answers `retry`
  (`console-busy`, 60 s). Phone B (`grade10b`, not "mine") taps Check out at 18:40:30, and the server saves the `checkOut`
  because Josh's effective state is "in". At 18:41 the check-in is not due yet (`retry_at`), but the check-out is. The next
  claim leases only the check-out, and Elvanto checks Josh out (or answers `already`). At 18:41:30 the check-in is sent.
  Result: Elvanto has Josh **in**, and the app shows him **out**. After the next services push the mirror wins, and he shows "In".
- **Scenario B (Undo after claim):** A leader taps Undo while the check-in is `claimed`, and the console then answers
  `retry`. The same inversion follows.
- **Scenario C (two consoles):** Console 1 holds a row lock on the check-in. Console 2's claim runs `for update skip locked`,
  skips the check-in and leases the later check-out.
- **Fix (app):** (1) At enqueue, when a `checkOut` arrives and the newest check-in row for (person, service) is still
  `pending`, call `cancelPending` on it and return `cancelled` instead of inserting. That is the same net result as the
  phone's own Undo (spec §2.4). (2) In `claim`, do not lease a `checkOut` while an older `checkIn` for the same
  `payload->>'personId'` + `payload->>'serviceTimeId'` is `pending` or `claimed`:
  `and not (type = 'checkOut' and exists (select 1 from link_outbox i where i.type = 'checkIn' and i.status in ('pending','claimed') and i.person_id = link_outbox.person_id and i.payload->>'serviceTimeId' = link_outbox.payload->>'serviceTimeId' and i.created_at < link_outbox.created_at))`.
  Do the same in the in-memory repo. **Console:** handle the rows of one claim in the order given.

### I3. A phone left open over several days checks youth in to last week's service, with no warning
- **Side:** app. **Other side changes:** no.
- **Where:** `public/index.html:9449-9463` (`renderLinkCheckin` sets `LINK.svc = LINK.defaultSvc` only when `!LINK.services`,
  and never re-checks it); `10069-10088` (`_nyLinkHtml` / `_nyLinkLoad`: `if (LINK.services) return;`, so the New person
  "Check them in to …" tick, which is on by default, uses the cached `LINK.defaultSvc`); the server accepts any service
  in the 7-day pick list (`link.service.ts:257`, `link-rules.ts:37-42`).
- **Scenario:** On Friday 9 Oct a leader opens the door screen, and `LINK.svc` is Fri 9 Oct. The PWA stays in memory (an
  Android tab, or iOS not killing it). On Friday 16 Oct the leader opens the app and goes to Check-in. `LINK.services` is
  set, so `LINK.svc` stays on 9 Oct. That service is still in the pick list (today−7), so every tap is accepted and sent
  to **last Friday's** service. The only cue is the small label "Fri 9 Oct · …". The 60 s refresh updates
  `LINK.services`/`LINK.defaultSvc`, but not `LINK.svc`. In the same way, a New person sent from Home on 16 Oct (the door
  screen never opened) ticks "Check them in to Fri 9 Oct" by default, and the first-timer goes to the wrong service.
  This is "a leader picking a past service" without knowing it.
- **Fix:** Store the Brisbane day each pick was made (`LINK.svcDay = LINK.today`). On every link render, on
  `visibilitychange` → visible and in `_nyLinkLoad`, compare `LINK.today` (or the phone's Brisbane date) with it. When the
  day changed, drop `LINK.services`, `LINK.defaultSvc`, `LINK.svc` and `LINK.people` (keep the queue) and reload. Also show
  an amber line on the door screen when `svc.ymd` is not today (or not yesterday before 03:00): "This is the service on
  Fri 9 Oct, not today."

### I4. Switch turned Off (or to Shadow) mid-night: phones keep queueing, say "waiting to send", and lose the items at logout
- **Side:** app. **Other side changes:** no.
- **Where:** `public/index.html:9240-9252` (`_lkFlush` → `_lkFailed` on any non-401 error, including a 404
  `MODULE_DISABLED`), `9302-9308` (pill), `9349-9351` (`_lkStatusLoad` swallows the 404, so the banner stays stale),
  `9316-9325` (logout: "Log out anyway (they'll be lost)"); server gate `link.service.ts:166-174`.
- **Scenario:** At 19:30 the operator sets `newYouthForms` to Off (the stop button) or to Shadow. The leaders' phones
  still have the old `S.settings`, so the door screen stays. Each tap is instant and queued. Every flush gets a 404, and
  after 4 failures (about 65 s) the pill turns red: "Not saved — tap to retry". Retry fails the same way, and nothing says
  why. Leaders keep checking in at the door and think the app will catch up, so they skip the kiosk. At logout they get
  "They could not be sent. Log out anyway (they'll be lost)". If they don't log out and the switch comes back On days
  later, the old items go to Elvanto late (see M5).
- **Fix:** When `/link/batch` (or `/link/status`) answers 404 `MODULE_DISABLED`, stop the retries, keep the queue, and show
  a red banner: "Check-in is switched off. Use the kiosk. N taps were not sent." Refresh `S.settings` and leave the link
  page. Optional: drop the queued items after the leader confirms.

---

## Minor

### M1. Undo is offered, then refused "Only the leader who sent this can undo it", after an "I am" change
- **Side:** app. **Where:** `link.service.ts:368-371` (`owns`: same login **and** same "I am", null = null),
  `public/index.html:9546-9548` (`_lkUndo` sends the *current* `getMyLeaderId()`), `link.service.ts:451` (`mine` = same login only).
- **Scenario:** On `grade9g`, a leader checks Josh in before they pick "I am", so `leaderId` is null. They then open a
  lifegroup report, which forces the "Who are you?" picker (decision 11), and pick Cody. Back at the door they tap Undo on
  Josh. The undo item has `leaderId = Cody`, `owns` fails, and the toast says "Only the leader who sent this can undo it."
  Josh stays in. The Undo button showed because `mine` checks the login only.
- **Fix:** In `_lkUndo`, send the `leaderId` that the action was created with. Keep it on the queued item and in
  `_lkApply`, or return `leaderId` in `ActionView`. Or make `mine` in `checkin()` include the "I am" match, so the button is
  not shown.

### M2. A `duplicate` answer marks another login's check-in as "mine" and shows an Undo that will fail
- **Side:** app. **Where:** `public/index.html:9226` (`_lkApply` sets `p.mine = true` for any non-refused outcome, `duplicate` included).
- **Scenario:** Phone A (`grade9g`) checks Mia in. Phone B (`grade10b`) taps her a moment later, and the server answers
  `duplicate` with `existingId` = A's row. Phone B now shows Undo on Mia. If B taps it, the answer is `LINK_NOT_YOURS`.
  After the 60 s refresh it is corrected.
- **Fix:** Set `mine` from the server: `r.action` plus a `mine` flag in the batch result, or `false` when `outcome === 'duplicate'`.

### M3. Undo answers `replay` and `duplicate` change nothing on the screen
- **Side:** app. **Where:** `public/index.html:9281-9285` (the undo branch handles `cancelled`, `saved`, `too-late` and `refused` only).
- **Scenario:** An undo flush times out on the phone after the server saved the check-out. The retry answers `replay`. The
  item is removed, but the row stays "In" with Undo for up to 60 s. A second Undo tap queues a new undo with a new
  `newId`, and that one gets `duplicate`. The screen is still unchanged.
- **Fix:** Treat `replay` and `duplicate` like `saved`: apply a `checkOut` with `r.action` or `existingId`.

### M4. "Console last seen 7:02 pm" shows no day, so after 3 days it reads as minutes ago
- **Side:** app. **Where:** `public/index.html:9129`, `9157`, `9166` (`_lkTime` only).
- **Scenario:** The console PC sleeps on Friday at 19:02. On Monday a leader sees "The console was last seen 7:02 pm".
  The day is not shown, and it looks like today.
- **Fix:** Use `_lkAt()` (day + time) when the date is not today.

### M5. The phone queue has no age limit, so it gets past the 3-day cut-off and replays old taps over newer state
- **Side:** app. **Where:** the sweep counts from the server's `created_at` (`in-memory/link.repository.ts:84`,
  `supabase.link.ts:127-129`), which is stamped when the item is flushed. The phone queue (`_lkPush`) keeps items with no
  tap time, and enqueue accepts any service in the 7-day pick list (`link.service.ts:257`).
- **Scenario:** At an off-site Friday with no signal, a phone queues 20 check-ins. The app is next opened 6 days later.
  The flush gets `saved` for all 20, and they go to Elvanto after 6 days, past the binding 3-day cut-off (decision 8).
  A second case: phone B queued "check in Ella" offline. Phone A then checked her in and later checked her out. When B
  comes online, Ella is checked in again.
- **Fix:** Add the tap time `at` to action items. `/link/batch` is app-side, so the frozen `/sync` contract does not
  change. Refuse with `too-old` when `at` is older than `LINK_CUTOFF_DAYS`. Optionally also refuse a check-in/check-out
  whose `at` is older than the person's newest server row for that service.

### M6. Friday after midnight: a phone opened fresh after 00:00 gets the "Pick a service" sheet
- **Side:** app (spec call). **Where:** `link-rules.ts:16-18`, `45-51` (Saturday → no default), `public/index.html:9461`.
- **What works:** a phone that was already open keeps Friday's service, Friday is first in the pick list (newest first),
  and `serviceDate` stays Friday. **Edge:** a leader who arrives at 00:15 to do check-outs must pick Friday by hand.
  The leaders' "Not yet in" count is also against Friday's list, which is correct.
- **Fix (optional):** Before about 03:00 Brisbane, use the previous day for the default (spec §2.3 "the day").

### M7. Sunday with two services: the check-in default is always the 10:15 service, even at an evening service
- **Side:** app (spec call). **Where:** `link-rules.ts:48`, `public/index.html:9459`, `9711-9719`.
- **Scenario:** Sunday has a 10:15 Connect and an 18:00 youth service. A leader opens the door screen at 18:05. The
  default is the 10:15 service, and it is selected without a pick. The leader checks youth in to the morning service.
  (With two 10:15 services there is no default. That is correct.) **Plausible:** it depends on whether YS ever runs a
  second Sunday service.
- **Fix:** For check-ins only, prefer the service of the day that starts nearest to now (or is in progress). Keep 10:15 for reports.

### M8. Leaders with the same name: a wrong-person check-in, and an "I am" picker that can't tell them apart
- **Side:** app. **Where:** `link.service.ts:145-152` (`rosterPersonOf` checks the number of roster hits, not the number of
  app leaders with that name); `public/index.html:9678-9690` (picker shows `fullName` only); door rows show name + "Yr N" only (`9507-9523`).
- **Scenario:** The app has two active leaders called Sam Smith. Only one is in Elvanto's leader category. Both map to
  the same `personId`. If you tick the second Sam (who is not in Elvanto), the other Sam is checked in. In "I am", the
  two look the same, so `by.leaderName` "Sam Smith" in the Elvanto attribution line could be either. (`link_log` keeps
  `leaderId`, so the admin can tell them apart, but the log screen shows names only.) Two students with the same name
  and grade show as two identical door rows.
- **Fix:** In `rosterPersonOf`, return null (Not linked) when more than one active app leader folds to the same name.
  Show grade/gender in the "I am" picker and on the door rows when names collide.

### M9. Leader sheet: "Not linked" has no explanation; the button does nothing while the list loads
- **Side:** app. **Where:** `public/index.html:9597`, `9613`, `9584-9586` (`_lkOpenLeaders` returns silently if `LINK.people[svc]` is not loaded).
- **Scenario:** With 0 linked leaders, every row is grey "Not linked", Submit (0) is disabled and there is no Tick all.
  This is correct, but nothing says why or what to do. Leaders link by name at read time only. There is no admin match
  for leaders, so the only fix is to rename the app leader to match Elvanto exactly. With all leaders linked and all
  done, the sheet shows "N done · 0 not linked" and Submit (0) disabled. That is correct. Over 50 ticked leaders, the
  flush sends 50, then the rest after 15 s. That is correct.
- **Fix:** Add one line under the header when `nNl > 0`: "Not linked: no Elvanto person has this exact name. Ask the
  admin to fix the name." Disable the button (or show "Loading…") until the list is in.

### M10. Report overlay: a second edit before the next groups push fails at the console, and `editable` is always true
- **Side:** both. **Where:** `link.service.ts:208-215` (`lastReportOf`: the overlay uses sent `submitReport` rows only,
  newest by `created_at`, always `editable: true, blocked: null`), `286-295` (the edit base check uses that overlay).
- **Scenario 1:** A leader submits a report, and it is sent. They edit it, and the edit is sent too. Before the next groups
  push they edit again. The screen still shows the **submit's** values, because sent edits are not overlaid. The base is
  the submit's values, the app accepts it, and the console finds that Elvanto has the first edit's values and refuses it
  `report-changed`. The leader saw their first edit "disappear".
- **Scenario 2 (Plausible):** The console's attribution line makes every link report carry a note. If Elvanto's edit
  form then reads that report as `unkept-notes`, the overlay still offers Edit until the next push, and the console refuses.
- **Scenario 3:** Two link submits for one group (dates D2, then the older D1) make D1 the overlay "last report",
  because the overlay picks by `created_at`, not by date.
- **Fix:** Overlay the newest sent `submitReport` **or** `editReport`, picked by report `date`, then `resultAt`. Mark the
  overlay `editable` only if the console says that link-sent reports stay editable (console to confirm).

### M11. New person "unconfirmed" + first-timer: if the form never landed, nobody finds out for 3 days
- **Side:** both. **Where:** `public/index.html:10054-10062`, `10093-10106` (queued for `sent` or `unconfirmed`, decision 23);
  contract §5.5 (`retry` `awaiting-approval` every 5 min until the sweep).
- **Scenario:** The student POST times out (`unconfirmed`), and the form did not land. The first-timer check-in is queued,
  flushed and leaves the phone. The console then answers `retry` / `awaiting-approval` every 5 min, about 860 times,
  until the sweep refuses it `too-old` on Monday. The host never sees a status (no door row, and the item is gone from the
  pill). If the host follows "check the forms list" and sends again, the second first-timer is a `duplicate` (one row).
  That is correct.
- **Fix (app):** Show the first-timer row's status on the New person result page (poll `/link/actions?ids=`). Admin
  "Elvanto link" page: list first-timers waiting for approval for more than 1 h. **Console:** back off after N
  `awaiting-approval` answers.

### M12. Logout guard: "check-ins" for every kind; "they'll be lost" can be wrong; "I am" switches can be dropped
- **Side:** app. **Where:** `public/index.html:9316-9325`, `1503` (identity items are pushed with `soon = false`), `2342-2344`.
- **Scenario:** A queue with one lifegroup report says "1 check-in hasn't been sent yet". After 10 s with the flush still
  in flight, the leader picks "Log out anyway (they'll be lost)". The request can still land and save them. A queue with
  only identity items (a switch of "I am" with no action after it) skips the prompt, and `_lkClear` drops those items.
  So the decision 12 log misses that switch.
- **Fix:** Use "N actions" in the text. Flush identity-only queues without asking (best effort). Change the wording to
  "they may not be sent".

### M13. The rate limit counts replays, so retries after a slow reply use up the 300-per-10-min budget of a shared login
- **Side:** app. **Where:** `link.service.ts:228-236` (step 1 `isBlocked` runs before the step 2 replay check), `container.ts:259`.
- **Scenario:** Three phones on `grade9g` at the door on a weak signal. Each 50-item batch that times out is re-sent and
  counted again. 160 real items + 3 re-sends of 50 = 310, so the next taps get `RATE_LIMITED` for up to 10 min.
  **Plausible** (the limiter is per serverless instance).
- **Fix:** Do the replay check (step 2) before the limiter, or count only `saved` items.

### M14. A queue left behind by an expired session keeps first-timer names and report notes in localStorage
- **Side:** app. **Where:** `public/index.html:9342-9346` (`_lkSoftReset` keeps the queue), `9173` (one key per login).
- **Scenario:** A 12 h session expires with a queued first-timer (a minor's first and last name) and a lifegroup note.
  The phone is then used by another login. `ysc.lkq.<old id>` stays in localStorage until that old login signs in again
  on this phone, which may be never. The comment at `9071-9072` says minors' names are kept in memory only.
- **Fix:** At login, flush any other `ysc.lkq.*` key, or delete keys older than 3 days (add a stored-at time to each item).

### M15 (V1 smoke 1). The server accepts a check-in for a roster person of kind `other`
- **Side:** app. **Where:** `link.service.ts:264-267` (checks `active` only, not `kind`).
- **Scenario:** A crafted `/link/batch` item with a parent's `personId` (kind `other`) is `saved`, and the console checks
  the parent in to the youth service. The door list never shows them, so a normal tap can't do this.
- **Fix:** Allow `kind` `student` or `leader`, or a `personId` that `rosterPersonOf` returns for an active app leader. The
  leader sheet can map to an `other` row, so a plain kind check would break it.
- **Rank:** Minor.

### M16 (V1 smoke 2). `resolved landed:true` keeps the old `unclear` detail and reason
- **Side:** app. **Where:** `link-rules.ts:102-104`.
- **Scenario:** A row goes `unclear` (detail "Elvanto may not have saved this.", or reason `lease-lost` from the sweep).
  The admin resolves it as landed, and it is now `sent`, but the admin list still shows that detail/reason.
- **Fix:** Set `reason: null, detail: null` on resolved → `sent`. For `not-landed`, keep `detail`.
- **Rank:** Minor.

### M17 (V1 smoke 3). Log rows for `replay` and `LINK_ID_REUSED` have no target
- **Side:** app. **Where:** `link.service.ts:229-237` (returns before `tgt` is filled).
- **Fix:** Fill `tgt` from `prev` (`personId` → roster name; `groupId`/`rowId` from the payload) before you return.
- **Rank:** Minor.

### M18 (V1 smoke 4). Pushes still apply when the switch is Off
- **Side:** app. **Where:** `sync.service.ts` `push()` (no settings read); `claim()` sets `max = 0` when Off.
- **Verdict:** Keep it. The mirror stays fresh, so turning the switch On shows current data, and auto-match on a roster
  push writes only `link_roster`. Note it in the spec as intended. **Rank:** Minor (information only).

---

## Verified OK

- **Friday after midnight (server):** `brisbaneToday` flips at 14:00Z. Friday's service stays in the pick list
  (today−7…today). `serviceDate` comes from the service `ymd`, not from today. An open phone keeps `LINK.svc`, so
  check-outs after midnight go to Friday.
- **Two phones, same youth:** dedupe at read time on (person, service, type) plus the live state (`link.service.ts:313-321`).
  Two inserts at the same moment are caught by the partial unique index `link_outbox_open_uq`. Supabase maps 23505 to
  `LinkOpenDuplicate` (`supabase.link.ts:76-79`), and the in-memory repo loops over open rows. A re-check-in after a kiosk
  check-out is allowed (`st.in` false).
- **Undo after the console claimed:** `doUndo` cancels only a `pending` row and otherwise queues a `checkOut`
  (`link.service.ts:396-403`). A refused or mirror-out check-in gives "Not checked in to this service." Undo of a report
  is refused. `cancelPending` is conditional on `status = 'pending'` in both repos.
- **Check-out before the check-in is sent (same phone):** while the item is queued, the row shows Undo, and a tap removes
  it locally (`_lkCheck`/`_lkUndo` → `_lkQueuedIdx`). A server `pending` row from this login is cancelled by Undo. The
  other-login case is I2.
- **Switch flipped mid-night (server):** Off → claim leases nothing, but heartbeat, sweep and `/sync/result` still apply,
  so rows already leased finish cleanly. Back On → the queued rows lease. (The phone side is I4.)
- **Console offline 3+ days:** the sweep runs on the first claim back. `pending` rows older than 3 days become `too-old`,
  and leases lost for more than 1 h become `unclear`, `lease-lost`. While the console is offline, Cancel still works on
  `pending` rows.
- **"I am" switch with items queued:** every queued item keeps the `leaderId` of its tap (`_lkCheck`, `_lkLeadersSubmit`,
  `_lkReportSend`). `_lkSwitchGuard` asks and flushes first. `setMyLeaderId` queues an `identity` row with `from`/`to`.
- **Logout with a queued item:** `doLogout` runs `_lkLogoutGuard` (ask → flush up to 10 s → ask again) before
  `_lkClear`, and `_lkClear` runs while `S.user` still gives the right key. A 401 during flush does not count as a failure.
- **Leader quick check-in, 0 or all linked:** Submit (N) counts only rows you can tick. "Tick all" is hidden when nothing
  can be ticked. Leaders already done show a check and no box. Each one is an ordinary `checkIn` through the queue and
  is deduped on the server.
- **Lifegroup edit after a newer Elvanto report:** when the groups push is newer, `lastReportOf` returns the mirror's
  report. An edit of the older `reportId` is refused "Only the last report can be edited. Reload." A changed base is
  refused "This report changed. Reload and try again." The console checks the base again at send time (contract §5.5).
- **New person "unconfirmed" → first-timer:** queued for `sent` or `unconfirmed`, never for `failed` or capability `off`
  (decision 23). A parent-only retry never queues it again (`mine.lkSvc = null`). A full resend while the first is still
  open is a `duplicate` (`first:<svc>:<folded name>`).
- **Prayers off + the link More entries:** `_linkOn()` is `_nyOn()`, so when the link is on, More always has at least
  New person + Check-in (2 or more entries) and the slot is More. The single-entry fallback in `_navSlots` can only see
  `bus` or `new-youth`. Junior `leader` gets Check-in only; `link-admin` is for admin/director only (`renderLink` also bounces).
- **Admin preview of a quad, gate and scope:** the link routes run as the quad (a real token), so the server scope is the
  quad's. In Shadow mode, a previewed quad gets no link entries, the same as a real quad. That is correct, but the admin
  can't preview the quad's link screens before the switch is On. The state leak is I1.
