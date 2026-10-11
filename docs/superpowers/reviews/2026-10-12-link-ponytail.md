# Link app side: RV2 Ponytail (YAGNI) review (2026-10-12)

Reviewer RV2. Branch `feat/elvanto-link-app` at `905d62e` (`git diff origin/master...HEAD`). Read-only. I did not run a
server. Every claim below comes from reading the code. Where I am not sure, the finding says **Plausible**.

Lens: outbox states that aren't needed, over-built admin pages, logic in both client and server, config nobody asked
for, code paths that nothing calls, and over-built test helpers. Each finding proposes a smaller version.

**Counts:** Critical 0 · Important 2 · Minor 17. By side: app 18 · CONTRACT 1 · console 0 · both 0.

---

## Important

### I1. The single-item write routes and the device-header plumbing have no caller — side: app (contract §4 doc text only; no fixture)

- **Where:**
  - Routes: `src/api/http/router.ts:219` (`POST /link/actions`) and `:221` (`DELETE /link/actions/:id`).
  - Controller: `src/api/controllers/link.controller.ts:116-125` (`device()`, `single()`), `:132`, `:134`.
  - `StatusResponse`: `src/api/http/types.ts:10-17`, and the branch in `express-adapter.ts:174` that sends it.
  - Device headers: `express-adapter.ts:99` (CORS `X-Device-Id`/`X-Device-Label`) and `:163-167`.
  - Service: the public `enqueue`, `cancel` and `undo` in `link.service.ts:98-100` and `:465-490`, and `httpStatus` on
    `ItemResult` (`:63-67`) with `strip()` (`:412`).
- **Facts:**
  - The SPA writes only through `POST /link/batch` (`public/index.html:9240`). It calls neither `POST /link/actions`
    nor `DELETE /link/actions/:id`, and it never sends `X-Device-*` headers (grep finds no match in `public/`).
  - The console calls only `/sync/*` (contract §1).
  - `LinkService.undo` has no route at all; only `link.service.test.ts` calls it.
  - The plumbing was built because spec §6.2 lists it. The ledger 18 batch replaced its only purpose.
- **Failure scenario:** a fix to item handling is made and tested on `/link/batch`. The single routes then reply in a
  different way. Examples:
  - `single()` throws `LinkOpenDuplicate` with `existingId ?? ''` (an empty id).
  - A device that is not sent gives log rows with a null device.
  - Nothing in production runs this path, so the difference stays hidden. Meanwhile it is a second authenticated write
    route that skips the phone queue.
- **Smaller version:**
  - Delete the two routes, `single()`, `device()`, `StatusResponse` and its adapter branch, the header parsing and the
    CORS header change, and `HttpRequest.headers`.
  - Make `enqueue`, `cancel` and `undo` private (only `batch` uses `doEnqueue`, `doCancel` and `doUndo`).
  - Drop `httpStatus` and `strip()`.
  - The device comes from the batch envelope only.
  - About 80 lines of source, plus the route tests for them.
- **Other side:** none. Add a one-line note to contract §4 ("`/link/batch` replaces the single routes"). It is doc
  text, not a fixture or schema change.

### I2. The admin "Today" card sends 6 requests where 1 is enough — side: app

- **Where:** `public/index.html:10238-10247` (`_lkAdmLoadActs`) sends one `GET /link/actions?serviceDate=…&type=<t>` for
  each of the 6 types. The server accepts `serviceDate` alone (`link.service.ts:499` refuses only when `ids`,
  `serviceDate` and `type` are all missing).
- **Failure scenario:** an admin opens the Elvanto link page. That sends:
  - 6 parallel `/link/actions` calls, each doing its own `users.findById` for every creator (`:502-504`);
  - plus `/link/admin/roster`, `/link/admin/log`, `/link/checkin` and `/link/status`.

  That is about 10 requests at once, against a Supavisor pool of 15 (memory: pooler cap, `EMAXCONNSESSION`). On a
  Friday the door phones are using that same pool.
- **Smaller version:** one `API.fresh('/link/actions?serviceDate=' + today)`. The status card already groups by
  `status` on the client. Optionally drop the `type` filter from the SPA altogether. The server param can stay,
  because contract §4 lists it.
- **Other side:** none.

---

## Minor

### M1. `practice` is computed and sent, but nothing reads it — side: app

- **Where:**
  - `link.service.ts:75-78`, `:451`, `:460` (`CheckinPerson.practice`, `CheckinLeader.practice`).
  - `link-rules.ts:176-188`: `CheckState.practice`, `.row` and `.source`. Only `.in` and `.practice` are read, at
    `link.service.ts:315-319` and `:449-451`.
  - SPA: only *writes* `p.practice` (`index.html:9216`, `:9228`, `:9384`). No render reads it; the practice line comes
    from `action.status === 'shadowed'`.
- **Scenario:** a later change "fixes" the practice display by editing `effectiveCheckState`. Nothing on screen
  changes, because the screen never looked at the field.
- **Smaller version:** drop `practice` from both views and from the SPA writes. Return only `boolean` (`in`) from
  `effectiveCheckState`, or `{ in }`. Spec §5.2 / §8.2 text needs a small edit.

### M2. Dead helpers and repeated token logic — side: app

- `canUseLink` (`access-control.ts:157-160`) is exported and tested but has no caller. `gate()`
  (`link.service.ts:166-174`) does the same job with a different 404/403 split.
- `env.LINK_SYNC_TOKEN` (`env.ts:37`) is never read: the adapter calls `readLinkSyncToken()` on each request.
- `setup.service.ts:96` repeats the trim and length rule instead of calling `readLinkSyncToken`.
- **Smaller version:** delete `canUseLink` and its test, and delete `env.LINK_SYNC_TOKEN`. In setup, use
  `readLinkSyncToken(env)` and keep only the "too short" branch on the raw length.

### M3. The matching endpoint returns much more than the page shows — side: app

- **Where:** `link.service.ts:573-583`; SPA `index.html:10187`.
- **Facts:**
  - The SPA calls `/link/admin/roster` with no `?match=`, then filters on the client: `kind === 'student'`, and
    `manual` + `ignored` together (one `?match=` value cannot express that pair).
  - The server returns **every** active roster row (leaders, `other`, already `auto`) and computes `candidates` for
    each: a name or last-name scan of all students per row, about 600 × 700.
  - The SPA never reads `firstName`, `lastName` or `gender` from the reply.
- **Scenario:** with about 600 roster rows, each admin page load computes candidates for about 550 rows that will never
  be shown, and sends them with their DOBs to the browser. Those are minors' DOBs, so this is also data minimisation
  (contract §7.4: admin matching = "candidate students").
- **Smaller version:** drop `?match`. Return only `kind = 'student'` rows with `match !== 'auto'`. Compute
  `candidates` only for `none` and `ambiguous`. Drop the unused fields.

### M4. The shadow-check `message` is sent twice — side: app

`link.service.ts:623` sends `message: 'In Elvanto; in YS attendance after the next import.'`. The SPA's `V` map
(`index.html:10201`) already has the same sentence for `sent-not-imported`. Drop the server field and keep the
verdict code only.

### M5. Two copies of the pick list, and an extra request on the admin page — side: app

- `LINK.services` / `LINK.today` (door screen) and `LINK.rServices` / `LINK.rToday` (reports, `index.html:9826-9828`)
  both come from `GET /link/checkin`.
- `renderLinkAdmin` (`:10282`) calls `/link/checkin` only to learn `today`, but `_lkToday()` (`:9932`) already falls
  back to the phone clock.
- **Smaller version:** keep one `LINK.services` / `LINK.today`, loaded once by whichever screen opens first. Drop the
  admin fetch.

### M6. The "which service" default rule exists in both client and server — side: app

- **Where:**
  - Client: `_lkDefaultSvcFor` and `_lkHHMM` (`index.html:9709-9719`).
  - Server: `defaultService` and `brisbaneHHMM` (`link-rules.ts:29-51`).
- **Scenario:** the Sunday time changes from 10:15, or a Wednesday service is added. Someone edits `link-rules.ts`.
  Then the report form's default disagrees with the door screen's default, and the SPA tests (which run the client
  copy) still pass.
- **Smaller version:** the server marks each pick-list service with `isDefault`, meaning the default for its own `ymd`
  (that is just `defaultService(s.ymd, services)`). The client uses
  `services.find(s => s.ymd === day && s.isDefault)`. `defaultServiceTimeId` then becomes the `isDefault` service for
  today, or can be derived. This is `/link` only; no fixture change.

### M7. The 15-second open-row poll runs alongside the 60-second list refresh — side: app — **Plausible**

- **Where:** `index.html:9358-9388`. Every 15 s the door screen calls `GET /link/actions?ids=…`. Every 60 s it reloads
  `/link/checkin?serviceTime=`, which already carries each person's `action`.
- **Why it adds little:** the console claims and reports about once per poll (60 s, contract §7.3), so most 15-s polls
  return rows that have not changed.
- **Cost:** about 4 extra requests per minute per door phone, against the pool of 15.
- **Smaller version:** drop `_lkPollOpen`, or poll every 30 s and skip the 60 s list refresh on that tick.
- **Owner/RV7 call:** how quickly "In Elvanto ✓" must appear on screen.

### M8. Housekeeping runs inside every claim — side: app

- **Where:** `supabase.link.ts:133-141` and the memory repo `:134-141`.
- **Facts:** three purge statements (delete stale roster rows, null out old notes, delete old log rows) run in the
  claim transaction on every heartbeat: every 60 s, from every console. That keeps the `for update skip locked` lease
  transaction open longer. Spec §4.3 chose this spot, but nothing needs it more often than once a day.
- **Smaller version:** run the purge on the `roster` push (every 6 h in window), or only when the Brisbane date has
  changed since the last purge. The claim then does upsert + sweep + lease only.

### M9. `applyResults` has a guard branch that can never run — side: app

- **Where:** `supabase.link.ts:192-206`.
- **Facts:** each item is first read with `select … for update` in the same transaction. The following
  `update … where status = old.status [and lease_owner = …]` therefore always matches:
  - nobody else can change a locked row;
  - outbox rows are never deleted;
  - a duplicate id in the same batch is re-read after the first update.

  So the re-select and second `applyOutcome` (`:203-206`) never run.
- **Smaller version:** keep the row lock. Drop the guard conditions and the re-read branch (an unconditional
  `update … where id`). Or keep the guard and drop `for update`, but not both.

### M10. Three answer caches and five copies of "find the queued item" — side: app — **Plausible**

- **Where:**
  - Caches: `LINK.refusals` (door), `LINK.gres` (groups) and `LINK.fres` (flows).
  - Loops that each walk the queue backwards: `_lkQueuedIdx`, `_lkGroupAct`, `_lkFlowAct`, `_lkReportUndo` and
    `_lkStepUndo` (`index.html:9199`, `:9728`, `:9935`, `:9915`, `:10019`).
- **Smaller version:** one `LINK.ans[key]` and one `_lkQueuedFor(key)`, with `key` = `svc:pid`, `g:groupId` or
  `f:rowId`. About 40 fewer lines.
- **Caveat:** this is a refactor of tested code, so only do it if the screens are being touched anyway.

### M11. The rate limiter counts replays, and it is per instance with shared logins — side: app (owner call)

- **Where:** `link.service.ts:228` runs `limiter.isBlocked` *before* the replay check (`:230-235`). The limiter
  (`RateLimiter(300, 10 min)`, `container.ts`) is in memory per serverless instance and keyed by `actor.id`. Grade and
  quad logins are shared across phones.
- **Scenario:** a door phone loses the reply to a 50-item batch and retries it 6 times (`_lkFailed` backoff). Each retry
  counts 50 hits, even though every item is a `replay`. After 300 hits, that login on that instance gets
  `RATE_LIMITED` for up to 10 minutes. The other phones on the same shared login are hit too.
- **Smaller version:** move the limiter check after the replay return, so replays are free. Or drop it: spec I9 asked
  for it, but the 50-item batch cap plus session auth already bound a request.

### M12. `locked` queues rows that can only be refused — side: CONTRACT — **Plausible** (owner call; decision 10)

- **Facts:** contract §4.1 accepts `locked` at enqueue. The console then claims each row and answers `refused`,
  `locked` about a minute later. The SPA banner already says "Check-out: this isn't connected yet. Do it in Elvanto."
  (`index.html:9168`).
- **Scenario:** a leader taps Check out. The row reads "Waiting to send" for about a minute, then flips to "This isn't
  connected yet". That is one outbox row, one claim and one result for nothing.
- **Smaller version:** the app refuses a `locked` type at enqueue with `LINK_UNAVAILABLE` (the same line, at once). The
  button can stay shown, so check-out is still "offered" (decision 10).
- **Other side:** this changes the contract §4.1 rule, so the console orchestrator must agree. The console needs no code
  change: it still handles a `locked` claim for older rows.

### M13. Two constants named `FINAL` that mean different things — side: app

- `link-rules.ts:82` `FINAL` includes `unclear`; it is used for result transitions.
- `in-memory/link.repository.ts:54` `FINAL` excludes `unclear`; it is used for the 30-day note purge.
- **Smaller version:** rename the memory one to `PURGEABLE`, or inline it. That removes the trap.

### V1 smoke minors (verified and ranked)

#### S1. A check-in for a roster `other` person is accepted — **confirmed**, Minor, side: app

- **Where:** `link.service.ts:264-267` checks only `!r || !r.active`, not `r.kind`.
- **Scenario:**
  - A stale or crafted item `{ checkIn, personId: <kind other> }` is saved and claimed.
  - The console answers `refused`, `no-room` (contract §5.2 room rule), so the leader sees a refusal about a minute
    later.
  - The door list never shows `other` people, so only a stale list or a crafted payload can reach this.
  - It wastes one outbox row and one claim, and the server and the door list disagree about who can be checked in.
- **Fix:** add `|| r.kind === 'other'` to the same refusal ("This person is not on the list. Reload."). It covers
  `checkOut` too.
- **Other side:** none.

#### S2. `resolved` keeps the old `unclear` detail — and the reason — **confirmed**, Minor, side: app

- **Where:** `link-rules.ts:102-104` sets only `status`, `resultAt` and `updatedAt`.
- **Scenario:** a `lease-lost` row (reason `lease-lost`) gets `resolved`, `landed: true`. It becomes `sent` with
  `reason = 'lease-lost'` and the old detail. The leader text is still right (the SPA reads only `reason === 'already'`
  on `sent`), but the admin `/link/actions` rows show a `sent` row with a lease-lost reason and an "Elvanto may not
  have saved this" detail.
- **Fix:**
  - `landed: true` → add `reason: null, detail: null`.
  - `landed: false` → add `detail: null` (it already sets `reason: 'not-landed'`).
- **Other side:** none (the contract only says that `landed` is set).

#### S3. Log rows for replays and `LINK_ID_REUSED` have no target — **confirmed**, Minor, side: app

- **Where:** `link.service.ts:230-236` returns (replay) or throws (reuse) before `tgt` is filled, so `doEnqueue` logs
  `targetKind/id/name = null`.
- **Scenario:** an admin filters the Activity log for "who touched Alex". The retried batch rows for Alex's check-in
  don't show his name.
- **Fix:** when `prev` exists, set `Object.assign(tgt, { kind: 'action', id: prev.id })` before the return or throw
  (one line). Or copy the person/group from `prev`.
- **Other side:** none.

#### S4. Pushes still apply while the switch is Off — **confirmed**, Minor (doc only), side: app

- **Where:** `sync.service.ts:254-271` has no settings check; claim stops leasing when Off (`:226`).
- **Ponytail verdict: keep.** If pushes were gated, the roster (pushed every 6 h outside the window) and the groups
  would be stale or empty for hours after the switch is turned On.
- **Cost of keeping it:** minors' names sit in `link_roster` while the feature is Off. Spec I2 ("Off hides
  everything") covers the screens, not the storage. Say so in spec §2.1 so nobody "fixes" it.

---

## Verified OK

- **Outbox states:** each of the 7 contract statuses is used:
  - `shadowed`: practice mode;
  - `unclear`: may have been sent;
  - `cancelled`: undo;
  - `claimed`, `pending`, `sent` and `refused`: the core flow.

  The app adds no persisted state of its own. `queued` and `mirror` are SPA display states only
  (`index.html:9097-9098`).
- **One state machine:** `applyOutcome` (`link-rules.ts:94`) is shared by both repos. The client does not copy it.
- **One enqueue path:** batch actions, undo's check-out, and (for now) the single route all go through
  `enqueueChecked`.
- **No new switch:** everything sits on the existing `newYouthForms` switch (decision 1). The only new config is
  `LINK_SYNC_TOKEN`, which is required.
- **`/sync` gate:** one small function (`express-adapter.ts:57-62`). The sync controller is a thin 3-line pass-through.
- **Test helpers are the right size:**
  - `link-repo-suite.ts` runs the same cases on memory and Supabase (spec §4.2). `backdate` and `peekNote` are the
    minimum needed to age rows on a real DB clock.
  - `link.spa.test.ts` runs the real SPA functions against small stubs. Its long `FNS` list is the cost of
    extract-and-run, not a fake reimplementation.
- **Client-side checks that look duplicated are needed:** date ±14, the note ≤1,800, and "pick a service" are checked
  in the SPA *and* the server. That is justified: the queue is async, so the server's refusal arrives late, and the
  local check gives instant feedback.
- **The status-text map** (`_lkStatusText`) is not duplication: the server sends codes only (contract §5.4).
