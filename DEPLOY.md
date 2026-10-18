# DEPLOY — YS Connection

Ship with `bash scripts/ship.sh <branch>` (or `/ship`). It gates (SPA inline-script syntax, `npm run typecheck`, and a `public/sw.js` `CACHE` bump whenever anything else under `public/` changed), tests, rewrites the live block below, fast-forwards `master`, pushes, and reports the Vercel build. `--dry-run` runs the gates and prints the rest; `--promote` promotes via the vercel CLI. The same gates + tests run on GitHub Actions (`.github/workflows/ci.yml`) on every push.
Pushing `master` builds on Vercel and the build applies migrations (`vercel-build` = `scripts/migrate.ts`), but **production changes only when the owner promotes** the build in Vercel.

<!-- live -->
- master sha: ec467c5 (ux18/rel 2220a92; pushed 2026-10-18, promoted ~07:21)
- last ship: 2026-10-18 06:45 EAST
- migration: 0037
- SW version: ysc-v128
- promote: PROMOTED by operator 2026-10-18 ~07:21 (new UI seen on phone); last promoted: ec467c5 (ysc-v128, 2026-10-18 07:21)
- pending branches: chore/ship ux17/bus; rel18b/ys (backlog round bl18 y1+y2+y3+c01, SW ysc-v129, LINK_REV 12, no migration; awaiting ship after 11:30 + operator promote)
<!-- /live -->

Link contract changes (`src/core/link-*`, link/sync services+controllers, `src/tests/fixtures/elvanto-link/`): ship YS before the 11.1 console; console e2e = `spike/e2e-ys-link.js` in 11.1.
