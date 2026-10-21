# DEPLOY — YS Connection

Ship with `bash scripts/ship.sh <branch>` (or `/ship`). It gates (SPA inline-script syntax, `npm run typecheck`, and a `public/sw.js` `CACHE` bump whenever anything else under `public/` changed), tests, rewrites the live block below, fast-forwards `master`, pushes, and reports the Vercel build. `--dry-run` runs the gates and prints the rest. The same gates + tests run on GitHub Actions (`.github/workflows/ci.yml`) on every push.
Pushing `master` builds on Vercel and the build applies migrations (`vercel-build` = `scripts/migrate.ts`). **Vercel auto-promotes every `master` build to production** (since 2026-10-20), so a push to `master` is a release: there is no manual promote step and no chance to read `/health` first. Check the clock before you push (no ships Fri 17:30-20:00 or Sun 10:00-12:00). After the build, read `Database up to date — …` in the build log and `/health` `schema.current`.
Rollback = Vercel dashboard > Deployments > the previous good build > Instant Rollback (migrations are additive, nothing to undo). While rolled back, Vercel stops auto-promoting; promote the fixed build by hand to turn it back on.

<!-- live -->
- master sha: aa0dd3f (r22/ys-release)
- last ship: 2026-10-22 09:21 EAST
- migration: 0042
- SW version: ysc-v139
- promote: auto (Vercel promotes every master build); check /health after the build
- pending branches: chore/ship ux17/bus 
<!-- /live -->

_The rel19/svc notes below predate auto-promote (2026-10-20): read "before the owner promotes" as "after the build"._

**rel19/ys (BUS-1 Trip logging + BUS-2 Charter bus, SW `ysc-v130`) carries migration `0038_bus_charter.sql`** (additive: `kind` on `bus_vehicles` + `bus_run_vehicles`, `vehicle_id` on `bus_addresses`). Apply it the repo's way at ship: the Vercel build's `scripts/migrate.ts` applies it; read `Database up to date — … (1 new)` in the build log and `/health` `schema.current` = `0038` before the owner promotes (never via the Supabase MCP).

**svc/ys (Service Visits, SW `ysc-v134`, `LINK_REV` 13) carries migration `0039_link_flow_service_visits.sql`** (additive: `service_visits int` on `link_flow_people`). The Vercel build applies it; read `Database up to date — … (1 new)` and `/health` `schema.current` = `0039` before the owner promotes (never via the Supabase MCP). Ship YS before the console's `feat/svc-visits`; a rev-13 console against an unpromoted rev-12 app is refused capabilities.

**Rollback of rel19/ys (to a pre-0038 build, e.g. `ec467c5` / `ysc-v128`) is safe but degrades.** Promote the previous deployment as usual; 0038 stays (additive, nothing to undo) and nothing crashes (`setup.service` checks `schema >=`, inserts get `kind` from its default, old upserts never touch `kind`/`vehicle_id`). But while the old build serves:
- bus drop-off rows (`bus_addresses.vehicle_id` set) show as ordinary saved addresses ("Bus drop off");
- a fleet bus is copied into a new night as a car (it routes to its drop-off as a normal car);
- old `ensureRun` takes the newest earlier run as `prev`, so a bare midweek trip run can wipe the carry-over (running cars, leaders, pool) for the next bus night. Re-check Car setup before that night, or roll forward again before it.
Roll forward = promote the rel19 build again. The new build reads `kind`/`vehicle_id` again, but a night created by the old build has its bus copied as a car: open Car setup and save the bus (Charter bus ticked) to re-kind tonight's copy.

Link contract changes (`src/core/link-*`, link/sync services+controllers, `src/tests/fixtures/elvanto-link/`): ship YS before the 11.1 console; console e2e = `spike/e2e-ys-link.js` in 11.1.
