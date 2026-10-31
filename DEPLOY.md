# DEPLOY — YS Connection

Ship with `bash scripts/ship.sh <branch>` (or `/ship`). It gates (SPA inline-script syntax, `npm run typecheck`, and a `public/sw.js` `CACHE` bump whenever anything else under `public/` changed), tests, rewrites the live block below, fast-forwards `master`, pushes, and reports the Vercel build. `--dry-run` runs the gates and prints the rest. The same gates + tests run on GitHub Actions (`.github/workflows/ci.yml`) on every push.
Pushing `master` builds on Vercel and the build applies migrations (`vercel-build` = `scripts/migrate.ts`). **Vercel auto-promotes every `master` build to production** (since 2026-10-20), so a push to `master` is a release: there is no manual promote step and no chance to read `/health` first. Check the clock before you push (no ships Fri 17:30-20:00 or Sun 10:00-12:00). After the build, read `Database up to date — …` in the build log and `/health` `schema.current`.
Rollback = Vercel dashboard > Deployments > the previous good build > Instant Rollback (migrations are additive, nothing to undo). While rolled back, Vercel stops auto-promoting; promote the fixed build by hand to turn it back on.

**Rollback below 0052 (the `director` -> `oversight` rename): run before Instant Rollback**, else oversight logins get 403 on an older build. In the Supabase SQL editor:

```sql
update users set role = 'director' where role = 'oversight';
update prayer_requests set created_by_role = 'director' where created_by_role = 'oversight';
update connections set assigned_by_role = 'director' where assigned_by_role = 'oversight';
update error_log set last_role = 'director' where last_role = 'oversight';
update app_settings set ministry_config = jsonb_set(ministry_config #- '{roles,enabled,oversight}', '{roles,enabled,director}', ministry_config->'roles'->'enabled'->'oversight')
 where id = 'global' and jsonb_typeof(ministry_config) = 'object' and jsonb_typeof(ministry_config->'roles'->'enabled') = 'object' and ministry_config->'roles'->'enabled' ? 'oversight';
```

**Rollback below bc18 (0044 dropped `bus_consents`)**: an older build reads that table. Before an Instant Rollback, the owner runs in the Supabase SQL editor: `create table if not exists bus_consents (id uuid primary key, student_id uuid unique references students(id) on delete cascade, guest_id uuid unique references bus_guests(id) on delete cascade, given boolean not null default false, note text, recorded_by text not null default '', recorded_at timestamptz not null default now(), check (student_id is not null or guest_id is not null)); alter table bus_consents enable row level security;` (empty: every rider reads Consent: not yet).

**Rollback below bus/remove-fixed-leaders (43e253b; 0026 is also not additive, it dropped `bus_leader_prefs.fixed_vehicle_id`)**: before an Instant Rollback to a build older than 0026, the owner also runs in the Supabase SQL editor: `alter table bus_leader_prefs add column if not exists fixed_vehicle_id uuid;` (any such target is also below 0044, so run the bc18 SQL above too).

**Shipping bc18 (0044 is not additive):** the Vercel build applies 0044 (it drops `bus_consents`) while the old build is still live, so the old build's Bus screens fail until the new build is live (about 1-3 min). Ship only when nobody is on Bus (not Friday afternoon or evening; the blockouts alone are not enough). If the build fails after the build log shows the migration applied, run the recreate SQL above at once.

**consent-hub/ys carries 0045 + 0046 (additive) and LINK_REV 19 (SW `ysc-v147`); ship before the console's consent-hub/console; rollback = Instant Rollback (tables stay, nothing to undo); the console at rev 19 against a rolled-back rev 18 app sends no snapshot (it checks appRev) and the old screens work as before.**

**fix24/ys (flows reassign + consent hub "Saving X of N" + `fix-no-field`, SW `ysc-v149`): no migration (`/health` `schema.current` stays `0046`), `LINK_REV` stays 19, ship order vs the console does not matter; rollback = Instant Rollback to 20c0632 (`ysc-v148`), nothing to undo.**

**round/2026-10-30: LINK_REV 21, no migration (`schema.current` stays 0051), SW ysc-v160; ship before the console; rollback = Instant Rollback to f800e08, nothing to undo.**

**Part 2: ID Checks (0053, additive, SW `ysc-v162`).** Ship after Part 1 (0052) has been live. Checklist:
1. Snapshot the prod DB first (0053 adds two tables); `FIELD_ENCRYPTION_KEY` is already set (required).
2. Ship outside Fri 17:30-20:00 and Sun 10:00-12:00. After the build: log shows `0053` applied and `Database up to date`; `/health` `schema.current` = `0053`.
3. `curl -s https://ys-connection.vercel.app/id-checks` must return a JSON 401 (not 500, not HTML).
4. The module stays Off until the admin turns it on (Youth Setup > Modules), sets the cycle start and ticks leaders in the Assign leaders grid.
5. Merge the console docs branch `feature/oversight-wording` (`wt24-console`) with Part 2. No console code, no `LINK_REV` change.
6. Rollback below Part 2 needs nothing: 0053 is additive and the tables stay unused. Rollback below Part 1 uses the SQL above, run before the Instant Rollback.

<!-- live -->
- master sha: 136a552 (fix/idcheck-grid-buttons)
- last ship: 2026-10-31 13:27 EAST
- migration: 0053
- SW version: ysc-v164
- promote: auto (Vercel promotes every master build); check /health after the build
- pending branches: chore/ship docs/slim-claude-md ux17/bus 
<!-- /live -->

_The rel19/svc notes below predate auto-promote (2026-10-20): read "before the owner promotes" as "after the build"._

**rel19/ys (BUS-1 Trip logging + BUS-2 Charter bus, SW `ysc-v130`) carries migration `0038_bus_charter.sql`** (additive: `kind` on `bus_vehicles` + `bus_run_vehicles`, `vehicle_id` on `bus_addresses`). Apply it the repo's way at ship: the Vercel build's `scripts/migrate.ts` applies it; read `Database up to date — … (1 new)` in the build log and `/health` `schema.current` = `0038` before the owner promotes (never via the Supabase MCP).

**svc/ys (Service Visits, SW `ysc-v134`, `LINK_REV` 13) carries migration `0039_link_flow_service_visits.sql`** (additive: `service_visits int` on `link_flow_people`). The Vercel build applies it; read `Database up to date — … (1 new)` and `/health` `schema.current` = `0039` before the owner promotes (never via the Supabase MCP). Ship YS before the console's `feat/svc-visits`; a rev-13 console against an unpromoted rev-12 app is refused capabilities.

**Rollback of rel19/ys (to a pre-0038 build, e.g. `ec467c5` / `ysc-v128`) is safe but degrades.** Promote the previous deployment as usual; 0038 stays (additive, nothing to undo) and nothing crashes (`setup.service` checks `schema >=`, inserts get `kind` from its default, old upserts never touch `kind`/`vehicle_id`). But while the old build serves:
- bus drop-off rows (`bus_addresses.vehicle_id` set) show as ordinary saved addresses ("Bus drop off");
- a fleet bus is copied into a new night as a car (it routes to its drop-off as a normal car);
- old `ensureRun` takes the newest earlier run as `prev`, so a bare midweek trip run can wipe the carry-over (running cars, leaders, pool) for the next bus night. Re-check Car setup before that night, or roll forward again before it.
Roll forward = promote the rel19 build again. The new build reads `kind`/`vehicle_id` again, but a night created by the old build has its bus copied as a car: open Car setup and save the bus (Charter bus ticked) to re-kind tonight's copy.

**Dashboard birthdays reader (0051, ys/dashboard-birthdays):** the migration creates `dashboard.upcoming_birthdays` and the role `dashboard_reader` with NOLOGIN. To let the Personal Dashboard log in, the owner runs once in the Supabase SQL editor (never commit the password; keep it in the dashboard's secrets): `alter role dashboard_reader login password '<STRONG-PASSWORD>';`. The dashboard connects through the Session pooler as user `dashboard_reader.<ref>` (same host and port as `DATABASE_URL`) and runs `select * from dashboard.upcoming_birthdays order by days_away, first_name`. Revoke: `alter role dashboard_reader nologin;`.

Link contract changes (`src/core/link-*`, link/sync services+controllers, `src/tests/fixtures/elvanto-link/`): ship YS before the 11.1 console; console e2e = `spike/e2e-ys-link.js` in 11.1.

**mod17/ys (`LINK_REV` 17, claim reply `modules`, no migration, no `public/` change)** ships before the console's module-alignment branch. `/health` `schema.current` is unchanged (0043).
