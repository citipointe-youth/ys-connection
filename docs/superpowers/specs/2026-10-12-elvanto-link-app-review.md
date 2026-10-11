# Review: Elvanto link app-side design (2026-10-12)

Reviewed: `2026-10-12-elvanto-link-app-design.md` (the spec) + `2026-10-12-door-checkin-mockup.html`, against the
contract `2026-10-11-elvanto-link-contract.md`, the draft SQL, `src/core/link-contract.ts`, the fixtures, the
ledger `elvanto-link-progress.md` (decisions 1-8), the rework spec `../rework/docs/superpowers/specs/2026-10-12-oct-rework-design.md`,
and the code it builds on (`express-adapter.ts`, `error.middleware.ts`, `setup.service.ts`, `migrate/runner.ts`,
`access-control.ts`, `vercel.json`, `sw.js`, the NEW-YOUTH SPA block). Nothing was edited apart from this file.

**Summary:** 0 Critical, 9 Important, 15 Minor. The spec is close to plannable. It covers contract §10.1 items 1-7
and honours decisions 1, 4, 6 and 7 and the "decisions already made". The main risks: three places where the spec
contradicts itself or the code (Off-mode matching, the deploy hazard, the lane order), two flows that cannot be
tested as written (first-timer, check-out in shadow), and one quiet change to what the frozen `note` field means.

---

## Critical

None.

---

## Important

### I1. The composed attribution line changes what `note` means, but no fixture or contract text changes with it (§2.2, §13)
- The frozen `claim-response.json` (shared byte-for-byte with 11.1) has `note` set to the leader's raw text
  ("Good night, talked about…"). The 11.1 verify test and the contract §5.2 mapping
  (`notes = note + signature`) both assume this. The spec makes `note` a composed line
  (`Self identified leader: <name> — <note>`) and says "No schema changes". That is true for the Zod schema, but the
  meaning of the field changes. After this, the fixture no longer shows real traffic, and Elvanto shows the name
  twice until the console changes.
- The console already gets `by.leaderName` in every claim row and already builds a signature line from it
  (contract §7.1). Decision 6 says what Elvanto must show. It does not say which side builds the line.
- **Fix:** pick one owner and write it down in the contract as a dated prose amendment (no version bump). The
  smallest change is **console composes**: keep `note` raw (the fixture stays true, `hasNote` keeps its contract
  meaning, and the 1,900 cap needs no 1,800/60 arithmetic). The console changes its signature from
  `— via YS Connection (<name>)` to `Self identified leader: <name> — <note>` and adds the line even when `note`
  is null for the three note types. If the app keeps composing, then (a) add the amendment to contract §7.1/§5.2,
  (b) block the first **live** send of report and flow types until the console has dropped its signature
  (§11 step 5), and (c) record it in the ledger.
  Either way, say what an `editReport` with no new note appends. Today every edit adds another attribution line, and
  the console's "replace, don't stack" rule does not know this line.

### I2. "Off" makes matching impossible, but §2.1 and §11 step 3 say the admin can match while Off (§2.1, §8.4, §11)
- §2.1: "Off: every `/link/*` route answers 404". `/link/admin/roster` is a `/link/*` route, and `_linkOn()` hides
  the Elvanto link page when Off. But §2.1 also says "the admin can do matching first", and §11 step 3 says
  "Switch still Off or Shadow". Matching only works in Shadow.
- **Fix:** do one of these. (a) Make §11 step 3 say "Switch = Shadow". This also exposes New person and the four
  screens to the admin, which is fine. (b) Exempt the `link:admin` routes and the admin page from Off for the
  `admin` role only. Option (a) is simpler, and it matches decision 1 ("one switch"). Then remove "and the admin can
  do matching first" from the Off sentence.

### I3. Check-out is refused for a person who is "in" through a pending, claimed or shadowed check-in (§2.4, §4.3, §5.2)
- Contract §5.1 lets check-out through only when the person is checked in to that service in the mirror or by a
  **`sent`** check-in. `effectiveCheckState` shows a person as in (with a Check out button) for a
  `pending`/`claimed`/`shadowed`/`unclear` check-in. So:
  - On the shadow Friday, every door check-in is `shadowed`. Every Check out tap then gets a 400, and §10/§11
    step 4 cannot test check-out at all.
  - Live, a leader who taps Check out a minute after Check in (still `pending`) gets a 400.
- **Fix:** write down the enqueue rule for check-out. Recommended: allowed when the mirror has them in, or the
  newest check-in row for that person and service is `sent`, `shadowed`, `pending` or `claimed`. A `shadowed`
  check-in counts only when the `checkOut` capability is not `live`. For `pending`/`claimed`, either allow it (the
  console reads first and refuses `already`/not-checked-in) or hide the button and show "Wait until the check-in
  is in Elvanto". State which, and add both cases to `link.service.test.ts`.

### I4. A first-timer is never sent in dry run, so §10 step 4 and the shadow Friday cannot test `firstTimerCheckIn` (§8.4, §10, §11)
- F4 sends `firstTimerCheckIn` only when the New person result was **not** a dry run. `ELVANTO_FORMS_LIVE` is unset
  locally and on prod until Task 0 is done (CLAUDE.md: Task 0 is still open). So in the §10 local run and on the
  shadow Friday, no first-timer row is ever created. §10 step 4 still expects one to reach `shadowed`.
- **Fix:** while the `firstTimerCheckIn` capability is `shadow` (or `locked`), also send the first-timer after a
  dry run. The console then refuses or shadows it, and nothing reaches Elvanto. Only skip it after a dry run when
  the capability is `live`. Or say plainly that first-timer is tested only by a direct `POST /link/actions` in §10,
  and moves to the last go-live step after Task 0. Also say what happens when the host leaves the screen mid-send.
  `nySend` already shows the reply in a toast, so the first-timer POST must still run.

### I5. The lanes depend on each other in a circle, and the shared types have no owner (§3.1, §4.3, §9)
- Lane A "needs B's `applyOutcome` signature". B's `applyOutcome(row: OutboxRow, …)`, `effectiveCheckState(…,
  rows: OutboxRow[])` and `autoMatch(roster, …)` need `OutboxRow` / `RosterRow`, which §3.1 puts in A's
  `link.repository.ts`. A's `insertAction` also throws `LinkOpenDuplicate`, which lives in B's `link-errors.ts`.
  Both lanes run in wave 1, at the same time. `NewOutboxRow`, `ClaimArgs`, `ClaimedRow`, `ConsoleRow`,
  `MirrorStateRow`, `Match`, `Why` and the `ServiceRow`/`GroupRow`/`FlowRow` row types (which clash with the
  contract's Zod names) are never given a home.
- **Fix:** add a **wave 0** step, or give it to lane B: one file `src/core/link-types.ts` that holds every row type,
  arg type and union above, plus `link-errors.ts`. A and B then import from it. Write the exact TypeScript in the
  spec, because two parallel agents will otherwise invent two versions. Also name the "repo index files"
  (`src/repositories/interfaces/index.ts`, `src/repositories/in-memory/index.ts`), so no other lane touches them.

### I6. The deploy hazard names the wrong mechanism. The real hazard is a duplicate migration number (§2.5, §11 step 1)
- `src/migrate/runner.ts` `shouldRun` runs migrations **only** when `VERCEL_ENV === 'production' && PERSISTENCE ===
  'supabase'`. Preview builds always skip, whatever `DATABASE_URL` is. So "nobody pushes this branch until the
  operator has confirmed which `DATABASE_URL` Vercel preview builds use" blocks work that is safe. It also misses
  the hazard that is real: a push to `master` applies the migration to prod at **build** time, before the owner
  promotes the build.
- The rework spec says the rework takes `0016`, and that the runner records only the number: "if two files share
  `0016`, prod applies the first one and skips the second forever, with no error". The spec still says
  "`<NNNN>` = the next free number at merge time … likely `0017`". It also lets wave 1 start before the rework
  lands, and in that case the "next free" number is `0016`.
- **Fix:** (a) Use **`0017`** now, because the rework reserves `0016`. Write it into §2.5 and lane A. (b) Add a test
  (lane A, in `schema-version.test.ts` or a new one) that fails when two files in `supabase/migrations/` share a
  4-digit prefix. That turns a silent skip into a red build. (c) Rewrite the hazard as: "Preview builds never
  migrate (`shouldRun`). Merging to `master` migrates prod at build time, before promotion. The migration is
  additive, so that is safe. Read the `Database up to date — …` line, and check that it names `0017`."

### I7. A `sent` check-in beats the mirror forever, so the door list goes stale (§4.3 `effectiveCheckState`)
- "The newest non-cancelled row wins over the mirror while it is `pending`, `claimed`, **`sent`**, `shadowed` or
  `unclear`." After a `sent` check-in, a kiosk check-out (the mirror has them out) never shows. A `sent` check-out
  followed by a kiosk re-check-in also never shows. The door list is wrong for the rest of the night.
- **Fix:** a `sent` (or `shadowed`) row wins only until a `services` push with `taken_at > result_at` arrives.
  After that the mirror decides. (`link_mirror_state.taken_at` is already read for `status`.) Give
  `effectiveCheckState` a `mirrorTakenAt` argument and test both orders.

### I8. The Supabase repo, which holds the riskiest SQL, has no automated test (§3.2, §5.1)
- Every claim, sweep, lease, reclaim and result rule is tested only against `InMemoryLinkRepository`. The
  Supabase claim (`for update skip locked`, `now()`, sweep and lease in one transaction, per-row decrypt, then
  `refused note-unreadable`) and `applyResults` (which needs a row lock or a conditional `update … where status =
  'claimed' and lease_owner = $consoleId`) have no tests. CLAUDE.md records a past memory-vs-Supabase split (the
  `ON DELETE CASCADE` incident).
  The spec's `sync.service` test "a row whose note fails to decrypt is refused `note-unreadable`" also cannot run as
  written, because the memory repo never encrypts.
- **Fix:** (a) Write the repo tests as one shared suite, `describeLinkRepo(makeRepo)`, so a Supabase run can reuse
  it later. (b) Give the memory repo an optional `decrypt` hook (default: identity). The note-unreadable test then
  injects a hook that throws. (c) Add SQL-text tests for `supabase.link.ts`: `skip locked`, `now()`,
  `lease_owner =` in the reclaim and result conditions, and `status in ('pending','claimed','unclear')` matching
  the index. (d) Before merging, run the suite or the §10 flow once against a scratch Supabase branch. Put this in
  the wave-4 checklist.

### I9. `POST /link/actions` has no rate limit, and any login can cancel any pending row (§5.2, §7)
- The logins are shared (`grade9g`). Once a type is live, each outbox row becomes a real Elvanto write by the
  operator's admin account. The open-row index stops parallel duplicates, but it does not stop a loop of
  check-in/check-out, or of submit/cancel. `cancel(actor, id)` has no owner check either, so one leader can undo
  another leader's pending report or check-in.
- **Fix:** reuse `RateLimiter` per login, as New person does (for example 120 actions per 10 min per login; check
  the numbers against a Friday door). On 429, show "Too many taps, wait a minute". Limit `cancel` to rows with
  `created_by = actor.id`, or to `link:admin`. The door's "Undo on my own row" then has a server rule to match.
  Add both to `link.service.test.ts`.

---

## Minor

1. **Token compare: do not copy `codeMatches` (§7.1).** "The `setup.service.ts` pattern" is `codeMatches()`, which
   removes spaces and dashes and upper-cases the code before the digest. That suits a typed setup code, but for a
   bearer token it is wrong. Say: `timingSafeEqual(sha256(bearer), sha256(token))` on the raw strings. Parse the
   bearer as exactly `Bearer <token>`. Never log the header or any `/sync` body (notes come in decrypted). Neither
   `express-adapter` nor `sendError` logs headers today. Keep it that way, and say so in the spec.
2. **Missing vs wrong `contractVersion` (§5.1).** "Not `1` → `LinkContractMismatch`" turns a **missing** version
   into 409. The contract test treats a missing version as a schema rejection (400). Say: a number other than 1
   gives 409, and missing or not a number gives 400 `VALIDATION_ERROR`. An unknown `:kind` and any other body error
   must also be `VALIDATION_ERROR` (a code in `SYNC_ERROR_CODES`), not `BAD_REQUEST`/`NOT_FOUND`. The console reads
   the code.
3. **`makeSyncService` lacks `users`** but must join `users.email` for `by.login` (§5.1). Add it to the deps. Also
   say what `leader_name` is for check-ins and first-timers, which have no `leaderId`: the login's `displayName`
   (contract §2.1). The column is `not null`.
4. **`leaderId` is now required for the three note types.** This differs from contract §4.1 ("optional"). It is fine
   (that table is app-only, not a fixture), but list it in §13 as a contract deviation.
5. **Report service pick list (§2.3).** A report date can be up to today−14, but the pick list is today−7..today and
   the mirror keeps only 7 past days. A report 8-14 days old can only be "No service". The contract checks a report
   against `link_services`, not against the pick list. Say this, and have the form say it ("Older services are not
   listed. Pick No service or do it in Elvanto").
6. **`LINK_DUPLICATE` in the SPA (§8.1).** Two phones tapping the same young person will be common. On 409
   `LINK_DUPLICATE`, take `existingId` as that person's row and show its status. Do not show an error. Write this
   into `_lkSend`.
7. **"My own row" (§8.1 item 8).** `checkin.people[].action` has no owner field. Either add `mine: boolean`
   (`created_by === actor.id`), or say the SPA keeps the ids it created in `LINK`. Those ids are lost on reload.
   Clear `LINK` on logout, as `nyReset()` does, because phones are shared.
8. **Mockup vs §8.1 "word for word".** The mockup shows "Practice: not sent to Elvanto" (the contract text is
   "Practice mode: not sent to Elvanto. Check in the usual way.") and "In Elvanto (kiosk)", which is not a contract
   line. Give the mirror-only "in" state a string in the spec (it has no outbox row), and make the mockup and §8.1
   agree.
9. **`listActions` scope (§5.2).** `?serviceDate=&type=` returns every row (leader names, logins) to every login,
   including report rows for groups the caller cannot see. Limit non-admin callers to their own rows plus rows in
   their lifegroup/flow scope, or to `ids=` that they created.
10. **Draft SQL edit (§2.5).** Keep the moved body byte-for-byte the same as the draft. Add `report_id` as a
    trailing `alter table link_outbox add column if not exists report_id uuid;`, so the diff against the
    contract's draft is one clear line. The glob in `link-contract.test.ts` should assert **exactly one** match.
    Leave a one-line pointer at the old draft path, or update the contract §1.1/§9 path.
11. **Retention of minors' data.** `link_roster` keeps `active = false` rows (names, grades, genders of people who
    left) for ever, and Full Reset never touches link tables. `link_outbox` keeps encrypted notes for ever. Add a
    purge to the claim sweep, as Bus purges guests after 28 days. For example: delete roster rows that have been
    inactive for 90+ days with `match` in (`none`, `ignored`), and null the `note` of final rows older than 30 days.
12. **Shadow check and Sundays (§5.2 `shadowCheck`).** The weekly import is Friday-only. A check-in to the Sunday
    10:15 Connect will always read `sent-not-imported`/`practice-missing`. Only reconcile dates that have a
    `service_sessions` row. Report the rest as "not in the import".
13. **`canUseLink` after the rebase (§2.1).** The rework adds `modeAllows(actor, mode)` and rebuilds
    `canUseNewYouth` on it. Define `canUseLink = can(actor, action) && modeAllows(actor, mode)`. Then all three
    features use one rule. Also say that decision 1's "Bus read-only routes" and contract §10.1 item 8 (role
    relabel, grade filter, Prayers off) belong to the rework stream. The spec now leaves §10.1 item 8 out without a
    word.
14. **Polling load (§2.4).** 30-40 phones re-reading every 15 s and 60 s, each doing roster + services + outbox
    reads, runs into the Supavisor session pool of 15 (memory note, 2026-10-09). Run the screen reads in one
    `Promise.all` and wrap the link repo in `dedupeReads` in `container.ts`. Make the 15 s poll `GET
    /link/actions?ids=` only, as written, and stop it when the tab is hidden (`visibilitychange`).
15. **§10 practicalities.** The PC is Windows, but the command uses bash env syntax. Give the PowerShell form
    (`$env:PERSISTENCE='memory'; …`). Use `npm run start`, not `npm run dev`: a `tsx watch` restart on any file
    save wipes the memory outbox and mirrors in the middle of a test. Also: `firstTimerCheckIn` names are capped
    at 60 characters by Zod. Check the New person names against that before the first-timer POST, so a long name
    does not give a 400 after the student form has already gone.

---

## Checklist answers

- **(1) Contract §10.1 coverage:** items 1-7 are covered (item 6 is replaced by decision 1, which is correct).
  Item 8 is not mentioned (Minor 13). Nothing contradicts §2-§8 apart from I1 (the meaning of `note`), I3 (the
  check-out rule), Minor 2 (missing version) and Minor 4 (`leaderId`). Contract §3.2 says one transaction with
  the console upsert; the spec calls `upsertConsole` and `claim` separately. That is fine, but do it on purpose.
  Length check: 1,800 + `"Self identified leader: "` (24) + 60 + `" — "` (3) = 1,887 ≤ 1,900. This fits
  `ClaimRow.note` (`max(1900)`, counted in UTF-16 units, the same as `String.length`). Cut the name by code point,
  so a surrogate pair is not split. The console's edit check (`note-too-long` > 2,000, with Elvanto's existing
  notes) will fire more often. `link_outbox.report_id` conflicts with nothing the console reads, because the
  console never reads the database and no `/sync` body changes. That claim is correct.
- **(2) Decisions:** one switch (yes, but see I2), attribution on flow steps and reports only (yes), door: any
  login, both genders, name + grade only (yes; the mockup also has no gender), which-service rule (yes, plus
  Minor 5), 3-day too-old (yes), check-out on (yes, but I3), latency (yes).
- **(3) Security:** timing-safe compare (yes; Minor 1 on the pattern), token not logged (true today; make it a
  stated rule), RLS on all 7 tables (yes, in the draft; `report_id` adds no table), door-list PII (decision-backed;
  Minors 7, 11), shadow is admin-only on the server (yes; `canUseLink` in every service method), rate limits (I9),
  idempotency and double taps (replay and the open-row index, yes; the SPA side in Minor 6).
- **(4) Migration safety:** additive, RLS, no FK (good). The number and the hazard: I6.
- **(5) Lanes:** the file lists do not overlap, apart from the unnamed index files. The SPA is one lane at a time
  (F1→F4). The type/error dependency is circular: I5.
- **(6) Testability with `PERSISTENCE=memory`:** works for most flows. It breaks for first-timers (I4), check-out
  in shadow (I3) and note-unreadable (I8). Also see Minor 15.
- **(7) Planner traps:** I5 (types), I6 (number), Minor 3 (deps), Minor 7 (`mine`), the unnamed "setup test case"
  file in lane E (name it: `setup.service.test.ts`), and the `retry` outcome (say that it clears
  `lease_owner`/`lease_until`).
