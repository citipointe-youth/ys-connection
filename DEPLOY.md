# DEPLOY — YS Connection

Ship with `bash scripts/ship.sh <branch>` (or `/ship`). It tests, rewrites the live block below, fast-forwards `master`, pushes, and reports the Vercel build. `--dry-run` prints steps; `--promote` promotes via the vercel CLI.
Pushing `master` builds on Vercel and the build applies migrations (`vercel-build` = `scripts/migrate.ts`), but **production changes only when the owner promotes** the build in Vercel.

<!-- live -->
- master sha: a5f7621 (release/2026-10-16)
- last ship: 2026-10-16 09:59 EAST
- migration: 0031
- SW version: ysc-v113
- promote: promoted 2026-10-16 10:00 (ad0ce91, ysc-v113)
- pending branches: chore/ship 
<!-- /live -->

Link contract changes (`src/core/link-*`, link/sync services+controllers, `src/tests/fixtures/elvanto-link/`): ship YS before the 11.1 console; console e2e = `spike/e2e-ys-link.js` in 11.1.
