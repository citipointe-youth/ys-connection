# Services (src/services): roles and scoping

All business logic + RBAC; services depend on repo *interfaces* only. **RBAC lives in one file: `access-control.ts`. Never scatter role checks.** All external input is parsed with Zod inside the service. More role rules, quads, term model and trend thresholds: `docs/areas/roles-terms.md`. Area docs for bus, link, consent, new person, audit, error log: `docs/areas/`.

### Role hierarchy

| Role | Scope | Key capabilities |
|------|-------|-----------------|
| `leader` | **Own connected students only** | Junior leader, bound to one `Leader` record via `Actor.leaderId`. Read-only: `student:read` (+sensitive, for call sheets), `leader:read`, `atrisk:read`, `prayer:read`/`prayer:write`. **No** `connection:write`, `leader:write`, `overview:read`, import or admin. Defaults **off** (`ministryConfig.roles.enabled.leader`) — opt in via Youth Setup → Roles. |
| `grade` | Own grade + **own gender** | List own grade/gender students; manage leaders for their cohort; connect same-gender students from any grade. Each grade has separate girls/boys logins (e.g. `grade9g` / `grade9b` — see the username convention under Commands and testing → Seed demo accounts; `…f`/`…m` is an older scheme). |
| `quad` | Own quad (e.g. Girls Yr 7–9) | Full connection management **within their gender + bracket**: add leaders, connect/disconnect, edit/remove. Sees only same-gender leaders/students. |
| `oversight` | Ministry-wide | All of above + import CSV data |
| `admin` | All + back office | Everything + settings, accounts, year-rollover |

There is always exactly one `admin` account. It cannot be deleted. Oversight/Grade/Quad default **on** and Leader defaults **off**; all four are toggled in Youth Setup → Roles (`ministryConfig.roles.enabled`), which is UI-level only — `account.service.ts` does not gate account creation on it.

**Scoping reality:**
- `Actor.gender` is **derived at sign-in** (`auth.service.deriveActorGender`): quad logins from their quad; grade logins from the **username convention** (`grade7g`→female, `grade7b`→male, or a "girls"/"boys" word). An ungendered grade account (`grade7@`) → `gender: null` → sees **both** genders (back-compat). `access-control` exposes `genderScopeOf` + `canAccessStudent` (`canAccessGrade && canAccessGender`); every read path (students, at-risk, trends, lifegroup-stats, overview, connections, leaders) scopes grade+quad via `canAccessStudent`.
- So a gendered grade login sees **only its grade + gender** across home, leaders/connect, my-students, trends, at-risk and search. `oversight`/`admin` = all. UI leader filters: `grade` → none, `quad` → grade-only (own bracket), `oversight`/`admin` → grade + gender.
- Connect exception: a `grade`/`quad` login may connect/search a student of **another grade** but only of **their own gender** (`student.get` is gender-only; `connection.assign` enforces the leader-gender match; the picker keeps searches within the leader's gender). Since 2026-10-17 the other-grade student comes back **without mobile / parent phone** (`studentRecordVisible` + the `phonesHidden` strip in `student.service`); the picker and detail modal need names only. `GET /connections/student/:id` follows the same rule.

**Status model:** there are **no manual at-risk thresholds**. `atRiskStatus` (`computeStatus` in `atrisk.service.ts`) is **threshold-free** and mirrors the SPA's `attendQual`: never-engaged (no attendance this OR previous term) → `regular`; attended before but **neither** service nor lifegroup this term → `stopped`; a stream's rate dropped **≥20pts** vs last term (or a stream stopped) → `declining`; otherwise `regular`. It feeds the My Students chips, the leader-card "at risk" counts, and the home At-Risk highlight. Student search + the At-Risk screen compute the same model client-side (`attendQual`/`qualChips`, ±20pts), and the At-Risk page additionally filters out never-engaged youth (`_hasAttended`). Keep `computeStatus` and `attendQual` in sync.

**Connection counts:** only students who **attended** a service or lifegroup in the current OR previous term are "connectable" (`_hasAttended` in the SPA; `attended` in `overview.service`). Never-attended students are excluded from connected / unconnected / total counts (so they're never "unconnected") and hidden from the quick-add picker's default view — but stay **searchable** to add, and still appear if already assigned.

**Leader scope (2026-10-17 access round, still binding):**
- `link.service` `resolveLeader`/`iAm` (`scopedLeader`): a grade/quad login may act only as a leader in `leaderInScope` (the `?pick=1` rule; strict, operator ruling: `grades: []` or `gender: null` leaders fail); an out-of-scope or unknown "I am" counts as no leader: a plain check-in is recorded under the login's own name, notes are refused "Pick who you are first." Oversight/admin unchanged. `identity` log items untouched.
- `GET /leaders/:id`, `PATCH /leaders/:id/grades`, `PATCH /leaders/:id/sms-template`: `assertLeaderInScope` (403). Grade/quad can no longer broaden a `grades: []` / `gender: null` leader; admin/oversight do that.
- `studentRecordVisible` (access-control) is the one rule for `GET /students/:id` and `GET /connections/student/:id`; other-grade same-gender students come back without phones (`phonesHidden`) on `/students?crossGrade=1`, `/batch studentsConnect`, `/students/:id`.
- Probe matrix (`review-2026-10-16\probe\matrix.md`): remaining LEAK cells are documented design (names via the connect exception; Bus ministry-wide; junior leader's unfiltered `GET /leaders` names; `/link/checkin?serviceTime=` roster). Keep it green.
