# DEPLOY — YS Connection

Ship with `bash scripts/ship.sh <branch>` (or `/ship`). It gates (SPA inline-script syntax, `npm run typecheck`, and a `public/sw.js` `CACHE` bump whenever anything else under `public/` changed), tests, rewrites the live block below, fast-forwards `master`, pushes, and reports the Vercel build. `--dry-run` runs the gates and prints the rest; `--promote` promotes via the vercel CLI. The same gates + tests run on GitHub Actions (`.github/workflows/ci.yml`) on every push.
Pushing `master` builds on Vercel and the build applies migrations (`vercel-build` = `scripts/migrate.ts`), but **production changes only when the owner promotes** the build in Vercel.

<!-- live -->
- master sha: b75db1b (release/2026-10-17-access)
- last ship: 2026-10-17 08:06 EAST
- migration: 0033
- SW version: ysc-v119
- promote: live ysc-v119 (auto-promoted within ~1 min, verified 2026-10-17 08:08 EAST; read-only live checks green); last promoted: eb790f9 (ysc-v119, 2026-10-17 08:07)
- pending branches: chore/ship chore/ship-gate-ci feat/checkin-poll release/2026-10-17-ux ux17/bus 
<!-- /live -->

Link contract changes (`src/core/link-*`, link/sync services+controllers, `src/tests/fixtures/elvanto-link/`): ship YS before the 11.1 console; console e2e = `spike/e2e-ys-link.js` in 11.1.
