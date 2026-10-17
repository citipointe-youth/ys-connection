# DEPLOY — YS Connection

Ship with `bash scripts/ship.sh <branch>` (or `/ship`). It gates (SPA inline-script syntax, `npm run typecheck`, and a `public/sw.js` `CACHE` bump whenever anything else under `public/` changed), tests, rewrites the live block below, fast-forwards `master`, pushes, and reports the Vercel build. `--dry-run` runs the gates and prints the rest; `--promote` promotes via the vercel CLI. The same gates + tests run on GitHub Actions (`.github/workflows/ci.yml`) on every push.
Pushing `master` builds on Vercel and the build applies migrations (`vercel-build` = `scripts/migrate.ts`), but **production changes only when the owner promotes** the build in Vercel.

<!-- live -->
- master sha: 2220a92 (ux18/rel)
- last ship: 2026-10-18 06:45 EAST
- migration: 0037
- SW version: ysc-v128
- promote: pending (Vercel) — update this line by hand once promoted; last promoted: b10fbd4 (ysc-v123, 2026-10-17 09:05)
- pending branches: chore/ship ux17/bus 
<!-- /live -->

Link contract changes (`src/core/link-*`, link/sync services+controllers, `src/tests/fixtures/elvanto-link/`): ship YS before the 11.1 console; console e2e = `spike/e2e-ys-link.js` in 11.1.
