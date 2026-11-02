# Open items, pending operator decisions, known bugs

## First change after the HOMESERVER cutover (operator, 2026-10-25)

Cutover planned Sun 25 Oct night (fallback Mon 26 / Wed 28). Do these first, in this order:

1. **Replace the Admin "New Year" wizard with a data export + backup** (operator ruling). Since r25 (YS 3159fd6, ysc-v153) `students.grade`/`quad` follow the matched Elvanto roster grade on every roster push (`gradeFixes`/`saveRosterFixes`, link-rules/link.service), and Year 12s get `students.graduated_at` (migration 0048) when Elvanto's grade goes 12 -> blank (skipped when >50% of pushed grades are blank, `gradeGlitch`). So the Full Reset (step 4) is no longer needed for rollover: it wipes students and cascades (lifegroups, import history, bus consents/addresses, My car, flow assignments, connections, attendance, prayers). Keep the exports (allocations, prayers, Connection Audit), add a full data export/backup, remove or hide Full Reset from the year-end path (server route may stay).
2. Unlinked legacy students (~326, no active roster row) never roll grade or graduate: decide mark graduated vs a one-off +1 grade.
3. Confirm the door "Slow: Search Elvanto" Brisbane location filter on live Elvanto (phone test); run `spike/e2e-ys-link.js` (ship.sh warned it was not run for LINK_REV 20).
4. Console side: the weekly digest does not exclude graduated students yet (see the console CLAUDE.md).

## Open items

**Operator decisions pending**
- Bus: Safeguarding sign-off with the youth director: the **female-leader rule** (girls auto-placed only in a car with ≥1 female leader; leaders with no gender count as not female; hand-placed girl only warned; Move/Undo don't enforce), gender soft, consent warning-only, and **`as=` self-identification lets any bus:use login (except junior `leader`) view any car's addresses + phone numbers** — spec-intended, needs a conscious decision before `visibility:'all'` (the `as=` soft guard itself is an accepted risk, see Security notes). Also: `as=` reaching Past/xlsx full addresses, lone-adult cars, a leader on two cars not blocked server-side.
- `/security-review` (not yet run) for Bus. Confirm API-key restrictions + a billing budget alert in Google project `ys-bus`.
- Supabase: Pool Size raise still pending (operator) (≈30 is safe at max_connections 60).
- Simple logins flip for YS Brisbane (October rework step 5): confirm whether done.
- New person owner calls: "Check the forms list in Elvanto" wording for hosts without Elvanto (M7); a loaded settings file carrying `newYouthForms` to another location (M8); no server deadline before the student POST (M2).
- Prayers: a `leader`-created general prayer stays visible to everyone (no cohort to derive a boundary from).
- **Elvanto attach (finding, not implemented):** Elvanto's own attach is `submissions[0][person_id]` on POST `admin/forms/form_submission/?id=<sub>`.

**Known bugs / leaks**
- **Pre-existing leak:** junior-leader `GET /bus/run` still carries each car's `endsAddress` (six-hat M7). Closed for the My-car-only leader by Plan B F4 (2026-10-17) except its own car; re-check `_busMapsLinks` if this area changes.
- viewGrades writes are not chained (an out-of-order save can leave the older pick; reliability M3).
- OPEN: resolveLeader / iAm scope in link.service — addressed by Plan B F1 (2026-10-17, `scopedLeader`); keep the probe matrix green.

**Deferred technical (ids from the reviews, see docs/HISTORY.md for the full text)**
- 2026-10-13 DEFER list: perf S6-S8, S10, S11, C6, C9; design S9, C3-C5, H3, H6, H7, H10, H12, H15; cleanup P7, P8, P12-P15; UI U15, U16, U18; real-DB V2 suite lacks `error_log`, intake tables and `link_flow_assign`.
- 2026-10-12 UX batch: CA CSV builder and SPA CA loop refuse grade 6; `FEATURES` list duplicated in `sync.service.ts` and the SPA; a lifegroupReport-only login gets the full door list (spec-allowed).
- 2026-10-12 October rework: near-simultaneous opposite flips (M2), quad may set any leader's filter (M3, by design), `enterPreview`/`exitPreview` don't reset BUS session fields (M11), source-regex SPA tests (M7/M8).
- New person deferred minors: colliding toasts, Youth Setup nav rebuild loses scroll, json-mode legacy boolean 404, `classifyPost` 201/202/204/408/429 = failed, weak Bus "New Person" regex test.
- Import: `#import-status` guard done 2026-10-02 (`_setImportStatus` null-safe); what emptied the history cache mid-flow is still not established (docs/HISTORY.md "OPEN — raise on the next update").

**Never visually verified by Claude** (owner checks on a real phone): Bus past-night map, Optimise route, iOS reload viewport fix, `ce7eaff`/`4c4a9e1`; real-phone 360 px grade chips (P1-22 / I1).
