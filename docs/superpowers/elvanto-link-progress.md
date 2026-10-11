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

## Ledger
- 2026-10-12 interview done; worktrees created; specs dispatched.
