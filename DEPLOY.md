# DEPLOY — YS Connection

Ship with `bash scripts/ship.sh <branch>` (or `/ship`). It gates (SPA inline-script syntax, `npm run typecheck`, and a `public/sw.js` `CACHE` bump whenever anything else under `public/` changed), tests, rewrites the live block below, fast-forwards `master`, pushes, and reports the Vercel build. `--dry-run` runs the gates and prints the rest; `--promote` promotes via the vercel CLI. The same gates + tests run on GitHub Actions (`.github/workflows/ci.yml`) on every push.
Pushing `master` builds on Vercel and the build applies migrations (`vercel-build` = `scripts/migrate.ts`), but **production changes only when the owner promotes** the build in Vercel.

<!-- live -->
- master sha: b9292db (feat/checkin-poll)
- last ship: 2026-10-17 08:19 EAST
- migration: 0033
- SW version: ysc-v121
- promote: live ysc-v121 (auto-promoted, checked 08:19); last promoted: 95aedd2 (ysc-v121, 2026-10-17 08:19)
- pending branches: chore/ship release/2026-10-17-ux ux17/bus 
<!-- /live -->

Link contract changes (`src/core/link-*`, link/sync services+controllers, `src/tests/fixtures/elvanto-link/`): ship YS before the 11.1 console; console e2e = `spike/e2e-ys-link.js` in 11.1.
