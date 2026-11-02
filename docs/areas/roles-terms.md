# Roles (more rules), quads, term model, trends

Core role table + scoping: `src/services/CLAUDE.md`. The `director` role was renamed `oversight` (migration 0052, 2026-10-30); older rounds in the archives still say director.

**More role rules (lifted from the history).**
- **No `cohortModel` bypass.** grade/quad accounts are scoped by their assigned grades/gender identically under both cohort models; cohortModel only changes account layout and report-breakdown granularity. **If you're touching `canAccessGrade`/`genderScopeOf` again: do not reintroduce a `cohortModel === 'none'` bypass** (2026-07-12 fix).
- **Multi-grade grade accounts:** `User`/`Actor` carry `grades: Grade[]` + explicit `gender` beside the legacy single `grade`; `access-control.actorGrades()` returns `grades ?? [grade]`. Every scoping read uses it, incl. `actor-key` — which MUST key on the full set or two multi-grade accounts collide their scoped caches.
- **The `leader` role** (junior leader) is read-only, except that it may save its own message template, and is bound to one `Leader` record (`Actor.leaderId`); it sees only that leader's connected students. `canAccessGrade` has no `leader` case (returns false), so every service that scopes a `leader` resolves its students via `connRepo` instead of `canAccessStudent` (students, at-risk, connections, prayers, follow-up).
- **Role toggles:** disabling a role in Youth Setup deactivates its active accounts. Re-enabling a role later does **not** auto-reactivate them (reactivation is manual, per account).
- **"Apply account layout"** (`cohort-account-layout.ts`, `POST /accounts/cohort-layout/preview|apply`): reconciles Accounts with the cohort model by username; matches are left alone, extras deactivated (never deleted), missing targets created with a one-time password; drifted matches are listed as `mismatched` (informational only). Since r27 (2026-10-27) no screen calls it (the Youth Setup button and its SPA mirror are gone); the routes stay as the only bulk creator of the 4 Junior/Senior logins.
- **Account preview** (Admin → Accounts → Preview, active grade/quad only): a real session as that account with a 1 h token (`PREVIEW_TOKEN_TTL_MS`); the admin's own session is stashed in `localStorage['yap_preview_stash']` and restored in `boot()`. `boot()`'s `/auth/me` refresh must not re-trigger the target's forced-password screen: never ship a preview path without re-applying the `mustChangePassword:false` override there too.
- **Protected admin:** `isProtectedAdmin()` (`account.service.ts`, client `_isProtectedAdmin()`). Now keys off `email === 'admin'` (falls back to `displayName === 'Admin'`); that account's username is locked, its display name is editable.
- **Simple logins** (module switch, default off for YS Brisbane): labels become Junior and Senior, grade logins retire (reversible via `gradeRoleWasOn`), each leader gets a server-side grade filter (`leaders.view_grades`, saves send `expect`, stale = 409); while on, the quad loses `bus:coordinate`.
- **Service day:** `saturdayOf(iso, serviceDayOfWeek)` buckets weeks ending the day after `structure.serviceDayOfWeek`; grade loops use `gradeRange(structure)`. `year-aggregates.ts` (Connection Audit only) is deliberately left Friday-anchored.
- Grade 6: One entry rule, `assertGradesInRange(structure, grades)` in `ministry-config.ts` (grade 6 only when Include Grade 6 is on). T14b: ONE junior bracket, `quadGradesOf(quad, structure)` (6-9 when `gradeMin` is 6, else 7-9).

### Quads

Four quads (internal ids; users see only Junior/Senior Girls/Guys, or "group") by age band + gender:
- `g79` Junior Girls, `b79` Junior Guys, `g1012` Senior Girls, `b1012` Senior Guys

The bands come from ONE helper, `gradeBands(structure)` in `src/core/types/enums.ts` (SPA mirror
`gradeBands()` in `public/index.html`): junior = gradeMin (6 with Include Grade 6, else 7) to 9,
senior = 10 to gradeMax. `GET /settings` returns it as `gradeBands: { junior, senior }` for the console
(r27, additive). `computeQuad()`, `quadGradesOf()` and the SPA buckets all read it. Grade labels on
screen use `structure.gradeLabel` (`_gradeWord()`), never a hard-coded "Yr".

**One name per quad in the SPA (impeccable review 2026-10-24):** `quadLabel()` always returns Junior/Senior Girls/Guys (`SIMPLE_QUAD_LABELS`) on every screen (header badge, Home cards, Connection Audit, pickers), the same names as the quad logins, Notices and Lifegroups; Flows keeps its ruled "Jr/Sr Guys/Girls" pills. `QUAD_LABELS` ("Girls Yr 7–9") stays only for the server mirror (`quadLabelFor`) and the Simple-logins display-name switch.

### Term model (this-term vs previous-term)

Attendance is split into the **current** and **previous** term everywhere; "this term" is the default, previous is shown as a comparison.

- **Boundaries** come from gaps between consecutive **service dates** > `termGapDays` (default 14), Saturday-bucketed so service Fridays and lifegroup Mondays land in the same Sat–Fri week. Only the last two terms are kept; resilient across the calendar-year boundary (last year's T4 as previous + this year's T1 as current). Pure helpers: `src/services/terms.ts` (`computeTerms`, `classifyDate`, `saturdayOf`).
- **Per-student aggregates** (`svc*`, `grp*`, `prev*` on `Student`) are computed **at import time** by `src/services/aggregates.ts` (`computeStudentAggregates`). BOTH imports (service and lifegroup) recompute BOTH streams from the authoritative service boundaries (lifegroup falls back to its own week-gaps when no service data), so the split is import-order-independent. Holiday-gap weeks classify to neither term and are excluded. **Re-import is required** for these fields to reflect new logic — trends/lifegroup-stats compute live and update immediately.
- `import` is the **sole writer** of `prev*` (new-year rollover only wipes data).
- `GET /trends` ministry block is **whole-ministry for every login** (a grade/quad login still sees ministry-wide unique + average there); `byQuad`/`byGrade` stay scoped. The "Improving/Declining" badge is the trend WITHIN the current term.
- `GET /lifegroups/stats` (`lifegroup-stats.service.ts`) is the per-lifegroup / grade / quad / overall source — current + previous term, role-scoped. Each `TermAgg` has `uniqueAttenders`, `avgPerWeek`, `weeksRan`, `members` (enrolled = distinct students the scope ran for), `totalVisits` (Σ weekly attenders). Notes:
  - **Average denominator depends on scope:** grade / quad / overall use **VALID
    SERVICES in the term** — `avgPerWeek = totalVisits / (valid Fridays meeting the
    floor that term)`, falling back to `weeksRan` when there's no service data —
    which normalises those averages to the service calendar. An **individual
    lifegroup** instead divides by the **weeks THAT group met** (`weeksRan`), so its
    average reflects its own cadence. (`termAgg`'s `divideByWeeksRan` flag, set by
    `statForGroup`.)
  - Each `QuadLifegroupStat` carries a **gendered** per-grade breakdown (`q.grades`);
    the SPA uses that for the oversight drilldowns (not the combined top-level `byGrade`).
  - **Deliberate attribution:** per-LIFEGROUP counts ALL its attenders; per-grade /
    quad / overall count only attenders whose OWN `grade`/`quad` matches. So a single
    lifegroup can show more unique attenders than its grade total when it draws in
    other-grade / no-grade students — kept on purpose as a "reaching beyond its year"
    signal. Don't "fix" it to roll up by the group's grade.

### Trend qualifiers

- Rising/declining fire only when a stream's attendance **rate** moved **≥ 20 percentage points** vs the previous term (raised from 5pts). Threshold lives in **both** the backend (`atrisk.service.ts`, `trends.service.ts` groupSummary) and the SPA (`isRising`, `_streamQual`, and the CA module rate trends) — keep them in sync.

- Leader search on Connect Setup (`#cs-lq`) is admin/oversight, and quad (Junior/Senior) since 2026-10-21; non-matches hidden, count unchanged, focus kept across repaints (`setup-leader-search.spa.test.ts`).
