# DEPLOY — YS Connection

Ship with `bash scripts/ship.sh <branch>` (or `/ship`). It tests, rewrites the live block below, fast-forwards `master`, pushes, and reports the Vercel build. `--dry-run` prints steps; `--promote` promotes via the vercel CLI.
Pushing `master` builds on Vercel and the build applies migrations (`vercel-build` = `scripts/migrate.ts`), but **production changes only when the owner promotes** the build in Vercel.

<!-- live -->
- master sha: abdf25e (feat/notice-push)
- last ship: 2026-10-15 19:41 EAST
- migration: 0029
- SW version: ysc-v111
- promote: pending (Vercel) — update this line by hand once promoted
- pending branches: chore/ship 
<!-- /live -->

Link contract changes (`src/core/link-*`, link/sync services+controllers, `src/tests/fixtures/elvanto-link/`): ship YS before the 11.1 console; console e2e = `spike/e2e-ys-link.js` in 11.1.
