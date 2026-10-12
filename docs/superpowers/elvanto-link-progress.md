# Elvanto link (app side) + October rework — orchestrator ledger

Started 2026-10-12 (laptop session "laptop2"). Orchestrator prompt: `Downloads\2026-10-11-link-orchestrator-prompt.md`.

## Branches / worktrees (outside OneDrive; main checkout is shared with another instance)
| Stream | Branch | Worktree | Base |
|---|---|---|---|
| A. Rework (ships first) | `feat/oct-rework` | `C:\Users\thoma\ysc-work\rework` | master `f105c46` |
| B. Link app side | `feat/elvanto-link-app` | `C:\Users\thoma\ysc-work\link` | step 0 `7252485` + merge of master `f105c46` = `8ab1043` |

Step 0 came from `Downloads\elvanto-link-contract.bundle` (not OneDrive as the prompt said). Contract fixtures live at
`src/tests/fixtures/elvanto-link/` (the prompt's `fixtures/ys-link/` path is wrong) — frozen, LF, shared byte-for-byte with 11.1.

## Already done (don't rebuild)
- **New person form** (Elvanto connect forms): on master `601522f`, **promoted** (operator 2026-10-12). Module
  `newYouthForms` Off / Shadow (admin only) / On — this is "the shadow mode feature". Task 0 capture + `ELVANTO_FORMS_LIVE` still pending.
- **More menu** in the Prayers nav spot (Prayers, Bus, New person): master `f105c46`, by another instance. That instance
  owns the More menu / nav hub — **not in our specs**.

## Operator decisions (2026-10-12 interview; binding)
1. **One switch.** All new additive screens (check-in/out, door check-in, lifegroup reports, flow steps, first-timer
   check-in, bus read-only routes) sit under the **existing `newYouthForms` Off / Shadow / On switch** (Shadow = admin only,
   like New person). No per-action switches. Go-live = operator turns it On after the shadow Friday checks out.
   (Spec may relabel the switch in the UI; the key stays.)
2. **Accounts use a different switch** ("Simple logins"), behind its own flag until YS Brisbane switches (1–2 weeks, with
   the check-in release). When on:
   - quads relabelled Junior Girls / Junior Guys / Senior Girls / Senior Guys (usernames unchanged);
   - grade logins retired (off + hidden; back if the switch goes off);
   - grade filter for Junior/Senior logins, **saved against the self-identified leader on the server** (follows them across
     phones and logins), default = that leader's grade(s);
   - quad role loses `bus:coordinate` while the switch is on.
   - **One-time YS Brisbane migration:** pre-set each grade-scoped leader's filter to their grade (e.g. Cody Cobb, Yr 10
     leader → sees Year 10 on first login to the new account).
   - New installs default to Simple logins; existing installs unchanged until an admin flips it.
3. **Bus coordinators** = admin + director + self-identified leaders in `busMinistry.coordinatorLeaderIds` (as coded today).
4. **Bus read-only routes** for non-coordinators: car, stop order, suburb only. No street address, no phone.
5. **Prayers off:** new `modules.prayers` on/off switch (default on). Operator exports with the existing admin CSV export,
   then switches it off. Data kept.
6. **Attribution:** everything goes to Elvanto on the operator's admin account, so flow steps (tick and note) and lifegroup
   reports carry the self-identified leader: `Self identified leader: Cody Cobb — <note>` (name only if no note).
   Not added to check-ins.
7. **Door check-in screen:** spec writer proposes a one-shot HTML mockup, modelled on the camp platform's Day 1 check-in
   (`OneDrive\Claude Programs\Project 9 - Camp Platform\youth-camp-platform-masterv2`, CLAUDE.md "Daily check-in";
   SPA `public/index.html`). Any login, both genders, name and grade only.
8. Prompt's "Decisions already made" also bind (up actions, latency, 3-day cut-off, check-out on, which-service rule).

## Round 2 decisions (2026-10-12, after both specs)
9. Bus "All cars" read-only: car, stop order, suburb **+ rider name and grade**. No street, no phone.
10. Grade/quad logins already seeing full bus addresses/phones (via `bus:roster` and `as=`): **acknowledged and accepted risk** — out of scope, not a bug.
11. "I am…" (self-identified leader) is **required** before a lifegroup report or flow step can be sent.
12. **New: exportable identity + action log.** Every time a device switches self-identified leader, and every
    check-in / check-out / first-timer / flow step / lifegroup report action, write a log row: when, login (account),
    device id + label (`yap_device_id` / `_deviceLabel`), self-identified leader (before → after for a switch), action
    type + target (student/report), outbox id if any. Admin can view and export it (xlsx, like other exports). Purpose:
    see who did an action, or who swapped identity to do it (accidental action on someone else's profile).
    Belongs in the link spec (it records link actions); the switch event comes from the shared "I am" picker.
13. Door check-in list includes leaders, marked "Leader" instead of a grade chip.
14. Rework: no data copy for grade filters — a leader with no saved filter defaults to `leader.grades`.
15. Link migration renumbers to **0017** (rework owns 0016).
16. Console-side kiosk push cadence: adopt the spec's recommendation (60 s on the shadow Friday, then decide) — console's call.
17. **Attribution is composed by the CONSOLE** (revised after link review I1). The app sends the raw note, so the fixtures
    stay true. The console replaces its §7.1 "— via YS Connection (name)" line with
    `Self identified leader: <by.leaderName> — <note>` (name only if no note), for flow steps and lifegroup reports.
    That is a wording change on the console side only. **Tell the operator / console orchestrator.** The app makes sure
    `by.leaderName` is always set (decision 11).
19. Deploy hazard corrected (link review I6): preview builds never run migrations (`shouldRun` needs
    `VERCEL_ENV=production`). The real hazard is a duplicate migration number, which the runner silently skips. Link uses
    0017, and a test fails on a duplicate migration number.

18. **Check-in is instant and queued on the phone** (operator asked 2026-10-12; orchestrator ruling). Two hops:
    phone → app (must feel instant) and app → Elvanto (already async via the outbox + console, ~1 min).
    - **Instant tick:** a tap marks the row In/Out immediately (pending style). It never waits for the network.
    - **Local queue:** each action (client UUID, as today) goes into a persistent device queue (localStorage, try/catch;
      keyed per login + service) so it survives a reload, app close or a dead signal. Flush in the background: right
      away, on `online`, on `visibilitychange`, and on every next tap. iOS has no SW Background Sync — don't rely on it.
    - **Batch the flush:** one POST carries every queued action (cap ~50). Fewer requests on a busy Friday — the
      Supavisor pool is only 15 (see memory: pooler cap). Same per-action schema and idempotent ids, wrapped in an
      array, on an app-side `/link` route (the frozen `/sync` contract and fixtures are untouched).
    - **Undo before send:** tapping again while still queued cancels locally; after send it queues a check-out/undo.
    - **Roster cached for the service:** the door list loads once per service (stale-while-revalidate like other
      screens); search and grade filter run on the phone, no request per keystroke. Refresh merges other phones'
      check-ins (server is the truth; local pending ticks stay on top until confirmed).
    - **Visible state:** a small pill "3 waiting to send" / "All saved"; red only after repeated failures, with tap to
      retry. Logout or switching "I am" with unsent items warns first and flushes before clearing.
    - **Server:** dedupe by client id (already) and by (person, service, type) so two phones checking in the same youth
      give one Elvanto action. Server reply per item: saved / duplicate / refused (too-old, etc.) → row updates.
    - Same queue for flow ticks and lifegroup reports (they are less time-critical, but get the same safety).

20. **Leader quick check-in** (operator, 2026-10-12). A button on the door screen ("Check in leaders") opens a sheet
    listing every active Leader in the app (name only, A–Z), each with a tick box, plus a "Tick all" control at the
    top, and a sticky **Submit (N)** at the bottom — modelled on the camp app's daily check-in. Usually 90–95% are
    there, so it is used before the service. Leaders already checked in for the chosen service show as done (no box).
    Leaders not matched to an Elvanto person show greyed "Not linked" (can't be ticked). Submit queues one ordinary
    check-in per ticked leader through the same phone queue and `/link/batch` (ledger 18): instant, deduped by
    (person, service, type), logged per action (ledger 12). Same gate (shared switch), any login, same service pick.
    No contract change: each is a normal check-in action.

21. **Cross-device review triage** (operator, 2026-10-12). The link review wave (plan Lane RV) ends by consolidating
    every link finding into ONE self-contained file → `OneDrive\2026-10-12-link-app-review-findings.md`. A separate
    Claude instance triages it together with the console's review file and sends solutions back to each device.
    App side waits for those solutions before fixing. Rework reviews (plan Lane R) are triaged locally as before.

22. **New person: no "Your name (host)" field** (operator, 2026-10-12). The host is the self-identified "I am" leader.
    The form shows "Host: <leader name>" with a Change link (the shared "I am" picker, with `_lkSwitchGuard`). With no
    leader picked, the picker opens before the form can be sent. A junior `leader` login uses its bound leader. The
    value sent to Elvanto where the host name went before is the leader's name. Drop `localStorage ysc.nyHost`.
    Done in the link branch with F4.1.

23. **First-timer tick: no dry-run branch** (R1 merge, 2026-10-12). Master commit `382a35b` removed the
    `ELVANTO_FORMS_LIVE` gate, so New person sends are always live. `_lkFirstTimerDecision` no longer reads
    `dryRun`: after a send where the student form went (sent or unconfirmed), the first-timer check-in is queued
    as normal, subject to the shared switch (`_linkOn`) and the console (`firstTimerCheckIn` not off). The
    dry-run test was replaced by one that checks every non-off console mode queues.

24. **V2 runs on the real database, not a scratch one** (operator, 2026-10-12: the changes are additive). Safe only
    while the link tables are empty, i.e. after 0017 lands and before the switch leaves Off. Before running, the suite
    must change: (a) do not run the migration itself (the prod runner applies 0017 on the push); (b) drop the
    PROD_REF refusal for an explicit opt-in (`LINK_TEST_ALLOW_PROD=1`); (c) refuse unless all 8 link tables are empty
    at the start; (d) truncate again at the end so prod is left empty. Touches only the 8 `link_*` tables.
    **Timing:** the tables only stay empty until the practice Friday, so the run happens right after the push lands
    0017, before the switch leaves Off. This brings forward the triage's L1/T-25 (deferred "before leaders") and
    overrides its "scratch database (never production)" wording, on the operator's instruction.
    **How to run V2 on prod** (suite changes done, 7c4c12a; not yet run). Only before the switch leaves Off.
    Set `LINK_TEST_DATABASE_URL` (the prod pooler URL, session mode, port 5432) and `LINK_TEST_ALLOW_PROD=1`
    (`FIELD_ENCRYPTION_KEY` is optional: a random key is used if unset), then run
    `npx vitest run src/tests/link.repository.supabase.test.ts`. It stops with "0017 not applied" if a link table is
    missing, and refuses (changing nothing) if any of the 8 link tables has rows. It truncates only those 8 tables,
    before each test and once at the end. Record the result in the Ledger below.

25. **Cross-device triage applied** (`reviews/2026-10-12-link-review-outcomes-app.md`, operator decisions D1–D4).
    - D1: one switch stays (APP-1 not done; revisit before leaders get access).
    - **D2 reverses ledger 17: the APP prefixes `Self identified leader: <name> — <note>` (or the name alone) in the
      `/sync/claim` row for submitReport, editReport and completeStep.** The console adds nothing.
    - D3: before 03:00 Brisbane the default is the previous day's service; Sunday stays 10:15 only.
    - D4: see ledger 24 (real DB, brought forward).
    - D5 (first live send of each type): pending operator; recommendation in the outcomes file.
    - Contract stays v1; X1–X17 are text-only amendments. Scope here: sections A and B, plus L1's code parts.
      Section C ("can wait") follows later.

## Ledger
- 2026-10-12 interview done; worktrees created; specs dispatched.
- 2026-10-12 late: rework pushed (deccde3, prod build applied 0016). Link built, V1 smoke 10/10, rework merged (905d62e), 7 reviews → OneDrive\2026-10-12-link-app-review-findings.md (b4d074f; 84 findings: 0 Crit / 23 Imp / 61 Minor; 2 CONTRACT, 8 both). WAITING for cross-device triage solutions (ledger 21). Next: apply solutions → V2 (scratch DB, needs operator) → V3 → V4 → H1.
- 2026-10-12: triage section A done (A1–A8 + L1 code parts), d31eb60..7a906ed (not pushed). A1 app prefixes `Self identified leader: <name> — <note>` in /sync/claim (D2; leader note capped so it fits 1,900); A2 contract X1–X17 text + .gitattributes LF; A3 lines by type; A4 spec docs + Status stop line; A5 phone CSS; A6 matching; A7 per-item batch validation + switched-off stop; A8 batch errors/log rows/on-conflict; L1 40P01/40001 → 503, ordered skip-locked sweep, per-method SQL checks (DB block untouched; the real-Postgres run is still the operator's). SW ysc-v93. 1672 tests pass (91 files, 1 skipped). Next: section B.
- 2026-10-12: triage section B done (B1–B18), d1c69d9..ccc0a9a (not pushed). B1 sweep skips the claiming console's own rows; B2 resolved clears reason/detail; B3 unclear rows named for the admin; B4 check ordering (LINK_STILL_SENDING, claim never leases a checkOut behind an open checkIn); B5 shadowed not "in" for duplicates; B6 Undo = cancel only while pending, Check out on every in row, server `mine`; B7 undo/cancel queued behind an in-flight item; B8 tap time (queuedAt/sentAt on /link/batch only: LINK_TOO_OLD, app-only reason `stale`); B9 Not today chip/confirm, day-change drop, D3 03:00 default; B10 tap toast with Undo; B11 leader rows only (X8 fold), same-name app leaders Not linked, check-in of kind other refused; B12 limiter 600 new rows/10 min; B13 queue per login (preview reset, memOnly, {at,q}, 3-day purge); B14 300 ms re-flush, guards drain; B15 stale list loads dropped; B16 nameFold everywhere + grade tie-break; B17 first-timer status, New people tonight, admin 1 h list; B18 empty flows push pinned. SW ysc-v94. V2 DB block ready for the operator (7c4c12a, ledger 24; not run). 1732 tests pass (91 files, 1 skipped). Next: operator V2 run after the push lands 0017; section C.
- 2026-10-12: B8 follow-up: a phone's own rows never make its later item stale across batches (same login + same device id, read from the row's link_log line; listLog gained an outboxId filter); spec I9 now says 600 new rows/10 min. 1733 tests pass (91 files, 1 skipped).
- 2026-10-12: link pushed to master cbe0255 (operator ok). Prod build dpl_BsJvAUzBejqKUBQQawRdJNfQLMjq applied 0017 ("17 of 17, 1 new"); not promoted. Next: V2 on prod BEFORE promoting (tables empty until then), then promote.
- 2026-10-12: V2 run on the real database (prod, session pooler, before promotion): 41/41 pass in 33 s. Afterwards all 8 link tables read back 0 rows. T-25 / L1 real-Postgres run done. OK to promote dpl_BsJvAUzBejqKUBQQawRdJNfQLMjq.
- 2026-10-12: triage section C done, 50d890f..61b77c2 + this line (not pushed). T-42 single /link/actions write routes, StatusResponse and X-Device-* plumbing gone (GET ?ids= kept; vercel.json/API_RE keep /link); T-49 full day names; T-21 120 s grace; T-27 overlay = newest sent submit or edit; T-47 APP-38/39/41/43/49/84; T-43 APP-21/42/44/74/75/79 (+77 on /link/checkin); T-46 APP-35 "In N", 36, 57-59, 61-69; T-17 15-minute hint + last seen with the day; T-48 CLAUDE.md link section + LINK_SYNC_TOKEN rotation. Skipped: T-10 (keeping the claim max needs a new link_console column = migration 0018; operator call), APP-82 (applyResults SQL was verified by V2 on real Postgres; dead branch is harmless), APP-83 and APP-60 (optional). SW ysc-v95. 1720 tests pass (91 files, 1 skipped; was 1733: the canUseLink matrix and single-route tests went with the code).
