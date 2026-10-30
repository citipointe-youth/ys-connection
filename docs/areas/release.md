# Release, deploy and CI

Lifted from the root CLAUDE.md (2026-10-30). Link contract revisions: `docs/areas/link-contract-revs.md`.

## Release process

- `master` pushes build on Vercel and the build applies migrations. Ship with `/ship` = `bash scripts/ship.sh <branch>` (gates: `check-spa-syntax`, `typecheck`, the SW-bump rule, then `npm test`; it rewrites `DEPLOY.md`'s live block, fast-forwards and pushes `master`). `--dry-run` runs the gates as a preflight. CI (`.github/workflows/ci.yml`, check `ci / gate-and-test`) runs the same on every push; it is not a required check. **2026-10-22 (r22 F6):** CI also starts a throwaway `postgres:17` service (prod is PG 17.6), applies every migration on the empty DB with `scripts/migrate.ts --force` (twice; the second must print `(0 new)`), and runs `npm test` with `LINK_TEST_DATABASE_URL` set, so the real-DB repo suite runs there (it still skips locally). Guard: `ci-workflow.test.ts`. A ship.sh CI-wait gate is proposed for Sat 24 Oct (round-2026-10-22 F6 report), not applied.
- **Deploying (2026-10-22):** Vercel **auto-promotes** every `master` build to `ys-connection.vercel.app` (since 2026-10-20), so a push to `master` is a release. Migrations apply in the build. After a push, read the build-log line `Database up to date — …` and check `/health`. Never apply migrations with the Supabase MCP. After an Instant Rollback Vercel stops auto-promoting until a build is promoted by hand.
- The custom domain `ys-connection.vercel.app` historically did not automatically re-alias to the newest deployment (2026-07 incident, docs/HISTORY.md "Prayers feature + a real deployment incident"); since 2026-10-20 Vercel auto-promotes every master build, live about a minute after the push. Always check: `/sw.js` line 1 shows the new `ysc-vN` and `/health` `schema.current` matches. With the CLI, `vercel inspect <the-domain-itself>` (not a `-xxxxx-` deployment URL) is authoritative.
- **Docs (2026-10-22):** CHANGELOG.txt covers releases to ysc-v140; `docs/DEPLOYING.md` developer contact reads "Contact your church's youth admin." (operator ruling, no personal details).
- **r22 YS release (2026-10-22):** `r22/ys-release` = F7, F1, F4, F5, F6, F8, U1, admin L2/L3/L5/L4/L1; SW `ysc-v139`, migration 0042 `link_created_students` (additive).
- **SW bump rule:** Bump `public/sw.js` `CACHE` on SPA changes (any change under `public/`; `ysc-vN`, next free number at ship time). `scripts/ship.sh` refuses a `public/` change without a changed `const CACHE = ` line and records the number in `DEPLOY.md`.
- **Release checklist (any release with a migration or a new route):** snapshot the prod DB before the push when a migration adds tables (auto-promote means there is no later step); after the build the log must apply the new migration and print `Database up to date`; `curl -s https://ys-connection.vercel.app/health` -> `schema.current` = the new number; `curl` each new route for a JSON 401 (not 500, not HTML). Roll back = Instant Rollback to the previous deployment (migrations are additive, nothing to undo).

## LINK_SYNC_TOKEN

**`LINK_SYNC_TOKEN`** (Vercel, Production only; the same value in the console's link settings).
- `/sync/*` refuses with 503 `LINK_OFF` while the token is unset or under 32 characters (after trimming), so the console cannot claim or push until it is set. A wrong token is 401. Admin → System check shows the token row (set / too short / not set; never the value).
- The adapter reads it per request (`readLinkSyncToken`), so a new value takes effect as soon as the deploy carrying it is promoted.
- **Set or rotate it** (outside the service window; queued rows just wait):
  1. Make a token: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` (43 characters).
  2. Vercel → Settings → Environment Variables → `LINK_SYNC_TOKEN` (Production) → paste → redeploy. A production
     redeploy goes live by itself (auto-promote).
  3. Paste the same token into the console's link settings (Project 11.1). Between steps 2 and 3 the console gets 401
     and backs off; nothing is lost.
  4. Check: the admin Elvanto link page shows the console Online within a poll or two.
  5. A leaked token: do steps 1-4 at once. The old token stops working when the new build is live.

## Ship gate details (from the 2026-10-17 round, still true)

- `scripts/ship.sh` gates BEFORE `npm test` and before DEPLOY.md is touched. The `promote:` line it writes carries the hand-written `last promoted: <sha> (<ysc-vN>, <when>)` tail forward; after promoting, update that tail by hand.
- CI: Node 20, `npm ci`, no secrets, on every push and on PRs to `master`; the Supabase repo suite self-skips locally. Not a required status check (operator ruling 2026-10-17).
