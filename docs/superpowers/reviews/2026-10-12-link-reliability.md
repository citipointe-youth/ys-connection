# Link app side: reliability review (RV6)

Reviewer: RV6, reliability. 2026-10-12. Read-only review of `git diff origin/master...HEAD` on `feat/elvanto-link-app`
(`905d62e`). Scope (plan Lane RV, row RV6): the phone queue, flush and backoff, idempotency end to end, leases and a
double console, partial batch failures and 503s, the Supabase claim transaction, 0017 with 0016 and RLS, rate limits on
a real Friday, phone/server clock skew, and queued items across a deploy (cache `ysc-v92`).
Every claim below comes from reading the code. Nothing was run against Postgres. "Plausible" means I could not prove it
from the code alone.

**Totals: 0 Critical, 4 Important, 9 Minor.** By side: app 12, both 1 (I4 needs the console to retry on 500), CONTRACT 0.

---

## Important

### I1. Undo tapped while the item is being sent is silently lost (in-flight race)
- **Side:** app. **Other side changes:** no.
- **Where:** `public/index.html:9236-9241` (`_lkFlush` takes a snapshot `items = q.slice(0, 50)` and posts it);
  `public/index.html:9531-9532` (`_lkCheck`) and `9540-9541` (`_lkUndo`): "still in the queue → splice locally, nothing
  is sent"; `public/index.html:9259-9283` (`_lkResults` applies the answer for every item in the snapshot).
- **Failure:** a leader taps the wrong youth. The 300 ms debounce fires and the batch is in flight (on a weak hall signal
  it can stay in flight for up to the 20 s timeout). The leader taps the row again to undo it. The item is still in
  localStorage, so `_lkQueuedIdx` finds it and splices it: "nothing sent". But the server already has it, so it is
  `saved`. When the reply comes back, `_lkResults` calls `_lkApply(..., status 'pending')` and the row flips back to
  "In · Waiting for the console". Elvanto then gets a check-in for a youth who is not there. If the reply is lost
  (timeout), the server still has the row, but the phone dropped the item, so nothing on the phone shows it.
  The same race applies to report and flow cancels (`index.html:9918-9921`, `10020-10023`).
- **Fix:** keep a set of ids in flight (`LINK.inflight`, set in `_lkFlush`, cleared in `.finally`). For a tap on an item
  that is in flight, do not splice it. Queue an `undo` (check-in) or a `cancel` (report or flow step) for that id, as if
  it had already been sent. The server handles both whether the row is pending or sent (`link.service.ts:396-403`, `378`).
  Add a SPA test: flush pending (the promise is not resolved), tap again, resolve with `saved`, and expect an undo item
  in the queue.

### I2. Queued phone items carry no tap time, so the 3-day cut-off and the order of actions can be wrong
- **Side:** app. **Other side changes:** no (the `/link/batch` envelope is app-only; the frozen `/sync` shapes are not touched).
- **Where:** the item has no timestamp (`index.html:9534-9535`, `9648`); `created_at` is the server insert time
  (`0017_elvanto_link.sql:27`); the sweep ages rows from `created_at` (`supabase.link.ts:127-129`); enqueue accepts any
  service in `pickList` = today−7 … today (`link-rules.ts:37-41`, `link.service.ts:257-260`); the same-action check works
  only on what has arrived so far (`link.service.ts:313-321`).
- **Failure A (cut-off bypass):** on Friday at 9 pm the door phone has no signal and has 30 check-ins queued. The phone
  is not opened again until the next Friday. On boot it flushes (`_lkBoot`, `index.html:9310-9314`). Last Friday is
  still in `pickList` (`ymd >= today−7`), so all 30 are `saved` with `created_at` = now. The sweep never sees them as
  old, and the console sends week-old check-ins. The operator decided on a 3-day cut-off (contract §12 Q1), and it is
  bypassed for anything that waited on a phone. The same happens with a queue stranded under another login on a shared
  phone (see m6).
- **Failure B (reordering):** phone A (no signal) taps Check in for Y at 7:00 pm. Phone B checks Y in at 7:01 (sent)
  and checks Y out at 9:00 (sent). Phone A gets a signal at 9:30 and flushes. The newest live row is B's `checkOut`
  (`st.in` = false), so A's check-in is not a duplicate and is `saved`. Y is checked back in after leaving.
- **Fix (app only):** stamp `_at: Date.now()` on each queued item. Send `queuedAt` per action item, plus `sentAt` on
  the batch envelope. On the server, correct for clock skew: `tapAt = queuedAt + (serverNow − sentAt)`, clamped to
  ≤ serverNow. Refuse with `too-old` (the existing reason, already worded on the phone) when `tapAt` is older than
  `LINK_CUTOFF_DAYS`. For checkIn/checkOut, also refuse with a new app-only refusal (e.g. `stale`, "Someone else changed
  this after your tap. Reload.") when the newest live row for that person and service has `created_at > tapAt`. The
  `sentAt` delta makes this safe against a wrong phone clock. Old queued items with no `_at` → treat as now (today's
  behaviour).

### I3. A whole-batch 4xx blocks the phone queue forever (no poison-pill handling)
- **Side:** app. **Other side changes:** no.
- **Where:** `link.service.ts:512-513` (one bad item shape fails the whole call with 400); `index.html:9242`
  (any non-401 error → `_lkFailed`); `index.html:9247-9253` (back off and retry the same first 50 items forever).
- **Failure:** any 400/403/404/413 for the envelope repeats on every retry, because the head of the queue never
  changes. Cases: (a) a later deploy tightens `BatchBody` or renames a `kind` while phones hold items in the old shape
  (deploys keep localStorage; the `ysc-v92` bump only clears the shell cache), and every phone with old items is stuck;
  (b) a corrupt item (a non-lowercase or legacy `yap_leader_id` in `leaderId` / identity `from`, which `Uuid` rejects);
  (c) the switch turned Off → `ModuleDisabledError` 404 for the whole batch. (c) is intended ("queued rows wait"), but
  the pill stays red. In every case, items behind the bad one never send, and logout offers "Log out anyway (they'll be
  lost)".
- **Fix:** on 400 (`VALIDATION_ERROR`), re-send the items one at a time (or bisect) and move any item that fails alone
  into a "could not send" list that the pill shows, so the rest drain. Better still, validate items one by one on the
  server: `BatchBody` checks only the envelope plus `{kind, id}`, and each item is parsed inside the loop, so a bad item
  gets a per-item `refused: VALIDATION_ERROR` (`enqueueItem` already does this for action items,
  `link.service.ts:343-347`). Add a queue item version (`v: 1`) so a later deploy can migrate old items. For 404
  `MODULE_DISABLED`, show "Elvanto link is off. Your taps are kept." and poll slowly, not the red pill.

### I4. The Supabase repo has never run against Postgres; a deadlock or statement timeout in claim/result is a raw 500
- **Side:** both (app: run the suite and map the error codes; console: treat 500 on `/sync/*` as retryable).
  **Other side changes:** console, only if it does not already retry on 500.
- **Where:** `src/tests/link.repository.supabase.test.ts:18-49` (the DB block is skipped unless
  `LINK_TEST_DATABASE_URL` is set; plan Task V2 is conditional, and neither the ledger nor the V1 smoke records a run);
  `supabase.link.ts:114-180` (claim: the console upsert, two sweep UPDATEs that do **not** skip locked rows, purges,
  then `for update skip locked`); `supabase.link.ts:187-209` (applyResults locks rows one by one in item order);
  `error.middleware.ts:13-16` (transient codes are class 08 plus socket errors only).
- **Failure (Plausible):** console X posts `/sync/result` for rows R1, R2 whose leases ended over an hour ago (the PC
  slept; the memory notes say this happens). It locks R1. At the same moment console Y's claim runs the lease-lost
  sweep, locks R2 and waits on R1. X then waits on R2. Postgres aborts one with 40P01, and the client gets a 500
  `INTERNAL` rather than a retryable 503. A `57014` statement timeout (0015) on the unindexed note purge or sweep would
  do the same. All the SQL in this file (`make_interval` with `prepare: false`, the dynamic `set ${tx(set)}`, the
  multi-row json helpers) is checked only as text by the tests.
- **Fix:** run Task V2 on a scratch DB before prod (the operator provides the URL). Add `40P01`, `40001` and `57014` to
  `TRANSIENT_DB_CODES`, or catch them in `sync.service` and return 503. Make the two sweep UPDATEs lock in a fixed order
  (`where id in (select id … order by id for update skip locked)`), so a busy row is left for the next poll instead of
  blocking.

---

## Minor

### m1. A 503 mid-batch loses the `saved` log rows; the retry logs `replay` rows with no target (V1 smoke minor 3)
- **Side:** app. **Where:** `link.service.ts:535-541` (on a DB fault, throws 503 before `addLog(logs)`; items already
  inserted are not logged); `link.service.ts:230-234` (a replay returns before `tgt` is filled).
- **Failure:** item 31 of 50 hits a pool error → 503. Items 1–30 are in `link_outbox`, but `link_log` has nothing for
  them. The phone retries, and all 30 come back `replay` with `target_*` null. So the ledger-12 log never records who was
  checked in, only an outbox id.
- **Fix:** on replay, fill `tgt` from the stored row (person from `prev.personId` via the memoised roster, group or flow
  from the payload), and/or write the logs collected so far in a `finally` before re-throwing. **Rank:** Minor (the
  outbox id still links the row).

### m2. Retrying a batch duplicates identity rows and adds a `replay` log row each time
- **Side:** app. **Where:** `link.service.ts:193` (`logRow` uses `randomUUID()`, not the item id),
  `link.service.ts:526-531`.
- **Failure:** the reply is lost on a weak signal three times → three identical "I am" switch rows in the admin log and
  export.
- **Fix:** for identity items use `id: it.id` as the log id, and have `addLog` use `on conflict (id) do nothing`.
  Optionally skip a log row for a pure replay.

### m3. "I am" switch events still on the phone are dropped at logout
- **Side:** app. **Where:** `index.html:9318-9319` (the guard counts only non-identity items and returns true),
  `index.html:9337-9338` (`_lkClear` removes the key). Identity items are pushed with `soon = false`
  (`index.html:1503`).
- **Failure:** a leader switches "I am", does nothing else, and logs out → the switch never reaches `link_log`, which is
  the event ledger 12 exists to capture.
- **Fix:** in `_lkLogoutGuard`, if only identity items remain, do one silent `_lkFlush()` (bounded wait) before clearing.

### m4. Concurrent sends of the same id give a 503 rather than a replay
- **Side:** app. **Where:** `supabase.link.ts:74-82` (only `link_outbox_open_uq` is mapped; a primary-key 23505 is
  re-thrown); `link.service.ts:230-236`.
- **Failure:** the PWA and a browser tab on the same phone share the localStorage queue and both flush; or the 20 s
  client timeout fires while the server is still working and the phone re-sends. Both requests see `getAction` = null
  and insert. The loser gets a `link_outbox_pkey` violation → the batch returns 503 → it heals on the next retry as
  `replay`. There is no data harm, but the loser's whole batch is retried and its pill turns amber or red.
- **Fix:** `insert … on conflict (id) do nothing returning *`. If nothing comes back, re-read the row and run the
  replay/reuse check.

### m5. Rate limit under a real Friday: shared logins, replays count, fixed window
- **Side:** app. **Where:** `link.service.ts:28-29, 228`; `rate-limiter.ts:15-26`; `container.ts:258-259`.
- **Arithmetic:** 300 items per 10 min per **login** (not per device), in memory per Vercel instance, fixed window. Every
  replayed item counts again, and so do blocked items. A door on a shared login (decision 2's quad logins, or two door
  phones on one login): a 15-minute rush of about 150 arrivals plus the 40-leader quick check-in is about 170–190 items
  in one window. Each lost reply on a weak signal adds up to 50 more. Three lost replies (about 150 extra) reach 300, and
  the rest of that window (up to 10 min, mid-rush) is "Too many taps. Wait a minute." for **every** phone on that login.
  Nothing is lost (`RATE_LIMITED` stays queued, `index.html:9262`; the code matches `app-error.ts:67`), but Elvanto gets
  the check-ins late. With several warm instances the limit becomes non-deterministic (higher).
- **Fix:** do not count replays: move the limiter check after the `getAction` replay check (`link.service.ts:230`).
  Raise the limit to about 600 per 10 min, or key it by `actor.id + device.id` with a per-login ceiling. This is Minor
  unless a real Friday at YS Brisbane has more than about 250 arrivals in 10 minutes on one login.

### m6. A queue is stranded when the login on a shared phone changes without a logout
- **Side:** app. **Where:** `index.html:9173` (key = `ysc.lkq.<user id>`); session expiry → `_lkSoftReset` keeps the
  key (`index.html:2140`, `11938-11942`); preview expiry / exit leaves the previewed login's taps behind
  (`index.html:11931`, comment).
- **Failure:** Monday's session expires with 5 items queued, and someone else logs in on that phone. Those 5 flush only
  when the first login uses this phone again, possibly days later, and then they count as fresh (I2). An admin
  previewing a leader login and tapping Check in leaves taps that never send.
- **Fix:** on login, if other `ysc.lkq.*` keys hold items, show "N unsent items from another login on this phone:
  Send / Discard" (sending needs that login; at least show them). With I2's cut-off, a stranded item can no longer land
  late. Block link taps in preview, or flush before `exitPreview`.

### m7. When localStorage writes fail, an older copy wins over memory
- **Side:** app. **Where:** `index.html:9174-9184`: `_lkQGet` prefers localStorage when the key exists; `_lkQSet`
  updates `LINK.mem`, then `setItem` may throw (quota, Safari ITP eviction mid-session).
- **Failure (Plausible):** after one successful write, a later `setItem` throws `QuotaExceededError`. The next
  `_lkQGet` returns the stale stored copy, so new taps vanish and confirmed items reappear (the latter are harmless
  replays).
- **Fix:** in `_lkQSet`'s catch, `removeItem(_lkKey())` and set `LINK.memOnly = true`, so `_lkQGet` uses memory from
  then on.

### m8. Draining a long queue waits 15 s between chunks of 50
- **Side:** app. **Where:** `index.html:9298`.
- **Failure:** 180 items queued during a dead signal take 3 × 15 s to drain after the first success, and the door shows
  "130 waiting to send" for 45 s with a working network.
- **Fix:** if the batch was full (`items.length === 50`) and items remain, `_lkSchedule(300)`. Keep 15 s only when the
  rest are rate-limited or unanswered.

### m9. V1 smoke minors 1, 2 and 4 (verified and ranked)
- **(1) A check-in for a roster `other` person is accepted.** `link.service.ts:264-267` checks only `r && r.active`; the
  door list shows students and leaders only (`:454`). A crafted request can queue an Elvanto check-in for any adult in
  the roster. Reliability impact is none, but it widens scope. **Minor, app:** refuse `kind === 'other'`, except for
  admin.
- **(2) A row resolved from `unclear` to `sent` keeps its old reason and detail.** `link-rules.ts:102-104` sets only
  status/resultAt. A lease-lost row becomes `sent` with `reason = 'lease-lost'`. The leader text is fine (`sent` reads
  `reason` only for `already`, `index.html:9131`). The admin list shows a stale detail. **Minor, app:** set
  `reason: null, detail: null` when `landed`.
- **(3)** See m1.
- **(4) Pushes still apply when the switch is Off.** `sync.service.ts` `push` has no settings check (claim does,
  `max = 0`). The mirror stays fresh for when the switch goes back On, and nothing is sent to Elvanto. **Minor, app,
  accept:** it keeps minors' names in `link_roster` while the module is Off. Document it, or skip roster pushes when
  Off.

---

## Verified OK
- **Survives reload, app kill, dead signal:** the queue is in `localStorage['ysc.lkq.<login id>']`, with every access
  in try/catch (`index.html:9172-9184`). `_lkBoot` flushes 1 s after start (`:9310-9314`, called at `:2146`). It also
  flushes on `online` and `visibilitychange` (`:9389-9397`) and on each tap (300 ms debounce). There is no SW Background
  Sync. The key is per login, not per login + service, which is fine: every item carries `serviceTimeId`, and
  `_lkMerge` filters by service (`:9208-9219`).
- **Flush:** one at a time (`LINK.flushing`), 50 per POST, 20 s client timeout = 20 s `ROUTE_TIMEOUT_MS`. Back-off is
  5/15/45/60 s, then red. 401 does not count as a failure, and the queue survives re-login as the same user. Unanswered
  and `RATE_LIMITED` items stay queued. Items added during a flush are kept (`_lkResults` re-reads the queue).
- **Idempotency:** phone UUID → `getAction` replay with a key-order-independent payload compare (strict schemas, so the
  stored payload equals the sent one; first-timer names are trimmed on the phone before the server trims them) →
  `link_outbox_open_uq` partial unique index → `LinkOpenDuplicate` → `duplicate` + `existingId`, adopted by the phone.
  Undo and cancel replays return `cancelled` or a `replay` of `newId`. Claim with a lost reply: rows stay leased to the
  same console until `lease_until`, then are reclaimed by it (`reclaimed: true`). A repeated result → `already-final`;
  a `retry` replay → `not-leased`. All harmless.
- **Leases and two consoles:** `for update skip locked` + `limit`. Only the owner may reclaim an expired lease
  (`supabase.link.ts:149`). Another console's dead lease becomes `unclear/lease-lost` after 1 h and is never re-sent.
  `applyResults` re-checks status + `lease_owner` in a guarded UPDATE inside one transaction. The SPA banner shows "N
  consoles are running" to the admin.
- **Partial batch failures:** a per-item `AppError` → that item is `refused` and the rest go on; a DB fault → 503 for
  the call and a safe retry (but see m1, m4).
- **Clock skew:** every server-side time compare uses the DB `now()` (claim, sweep, purge, lease) or the server clock
  (`brisbaneToday`). The phone's identity `at` is clamped to [now − 3 d, now] (`link.service.ts:527-528`). Status times
  shown on the phone are server times. The only gap is the missing tap time (I2).
- **0017 with 0016:** distinct numbers (`uniq -d` on prefixes is empty), no overlap (0016 alters `leaders`, 0017 only
  creates `link_*`), `LATEST_MIGRATION = '0017'`, all additive (`if not exists`), no FKs. **RLS is enabled on all 8 new
  tables** (`link_outbox`, `link_roster`, `link_services`, `link_groups`, `link_flow_people`, `link_console`,
  `link_mirror_state`, `link_log`) with no policies, so the anon key is blocked and the superuser API is unaffected.
- **Deploy / `ysc-v92`:** the bump deletes only Cache Storage. localStorage (queue, device id, "I am") survives, the
  shell is network-first, and `/link` and `/sync` are in `API_RE` (never cached) and in the `vercel.json` routes. Items
  queued before the deploy flush with the new code unchanged, since this is the first queue format. The risk is a
  later format change (I3).
- **Supavisor:** the client `max: 2` per instance. The claim transaction holds one connection; the batch runs one item
  at a time on the other.
