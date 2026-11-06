# CLAUDE.md — YS Connection

**YS Connection** (`ys-connection`): youth ministry platform for YS Brisbane. Phone-first SPA (`public/index.html`) on a TypeScript/Express API; students are *connected* to leaders. GitHub `citipointe-youth/ys-connection`; live at https://ys-connection.vercel.app (Vercel team `citipointe-youth`); Supabase Sydney, ref `ltcblcudlzlzfcyzlhpc`. The other half of the Elvanto link is Project 11.1 (Elvanto Sync Console); this app never talks to Elvanto itself.

## Commands

```bash
npm run dev                          # tsx watch, http://localhost:4300 (PORT overrides); PERSISTENCE=memory default
npm run typecheck                    # tsc --noEmit (strict); there is no separate build step
npm run migrate                      # scripts/migrate.ts (also the Vercel build: vercel-build)
npm test                             # vitest run, all of src/tests/**/*.test.ts
npx vitest run src/tests/bus.service.test.ts         # ONE file
npx vitest run src/tests/link                         # files matching a path fragment
npx vitest run src/tests/x.test.ts -t "rev 21"        # one test by name
node scripts/check-spa-syntax.js     # run after EVERY public/index.html edit
```
Full gate (ship.sh + CI): `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`. Memory mode seeds demo logins with one random password printed in the server log. Details: `docs/areas/dev-testing.md`.

## Where things live

| Area | Key files | Notes |
|---|---|---|
| Layers | `src/core` (types, Zod, errors; no other imports) → `src/repositories` (interfaces, in-memory, `supabase/`) → `src/services` → `src/api` | `src/container.ts` is the ONLY file naming concrete repos; `src/app.ts`, `api/index.ts` (Vercel entry) |
| SPA | `public/index.html` (one inline script), `public/sw.js` | **read `docs/areas/spa-rules.md` before editing**; `spa-ui.md` |
| Routes | `src/api/http/router.ts`, `express-adapter.ts`, `vercel.json` | `src/api/CLAUDE.md` |
| RBAC / roles | `src/services/access-control.ts` | `src/services/CLAUDE.md`, `docs/areas/roles-terms.md` |
| Config | `src/core/ministry-config.ts` (`ministryConfig`, `L(key)`, `modules.*`) | `docs/areas/setup-locations.md` |
| Elvanto link | `link.service.ts`, `sync.service.ts`, `link-rules.ts`, `core/link-contract.ts` (`LINK_REV`), `supabase.link.ts`, SPA `/* ── LINK MODULE ── */` | `docs/areas/elvanto-link.md`, `link-contract-revs.md` |
| Consent / flows / intake | `link-intake.service.ts`, `dnc.ts`, `supabase.link-consent.ts` | `docs/areas/consent-flows.md` |
| New person | `new-youth.service.ts`, `elvanto-forms.ts`, SPA `/* NEW-YOUTH */` | `docs/areas/new-person.md` |
| Bus | `bus.service.ts`, `bus-logic.ts`, `bus-plan.ts`, `services/routing/`, `supabase.bus.ts`, SPA `/* ── BUS MODULE ── */` | `docs/areas/bus.md` |
| Connection Audit / import | `connection-audit.service.ts`, `audit-*.ts`, `import.service.ts`, `aggregates.ts`, `terms.ts`, SPA `/* ── CA MODULE … ── */` | `docs/areas/connection-audit-import.md` |
| Error log / reconcile | `error-log.service.ts`, `error-log-text.ts`, `reconcile.service.ts` | `docs/areas/error-log-reconcile.md` |
| Notices / prayers | `notice.service.ts`, `prayer.service.ts` | `docs/areas/notices-prayers.md` |
| DB / persistence | `src/repositories/supabase/`, `supabase/migrations/`, `src/core/schema-version.ts` | `supabase/migrations/CLAUDE.md`, `docs/areas/env-prod-db.md` |
| ID Checks | `id-check.service.ts`, `id-check-rhythm.ts`, `supabase.id-checks.ts`, SPA `/*IC-LIST*/`..`/*IC-GRID*/` | `docs/areas/id-checks.md` |
| Encryption | `src/utils/field-crypto.ts` (only called in `supabase.students.ts`) | `docs/areas/security.md` |
| Ship / deploy | `scripts/ship.sh`, `DEPLOY.md`, `.github/workflows/ci.yml` | `docs/areas/release.md` |

## Always-true rules

**Deploy / ship**
- Pushing `master` IS a release: Vercel auto-promotes every master build and the build applies migrations. Ship only with `/ship` = `bash scripts/ship.sh <branch>` (`--dry-run` = preflight). Never ship Fri 17:30-20:00 or Sun 10:00-12:00 (site time); any other time is fine.
- Any change under `public/` needs a bumped `public/sw.js` `const CACHE = 'ysc-vN'` (next free number); ship.sh refuses otherwise.
- After a push: build log shows `Database up to date — …`; `/sw.js` line 1 shows the new `ysc-vN`; `/health` `schema.current` matches. Snapshot prod first when a migration adds tables. Roll back = Vercel Instant Rollback (then auto-promote stops until a build is promoted by hand).
- Link contract: bump `LINK_REV` in `core/link-contract.ts`; ship YS first, then the console; frozen fixtures in `src/tests/fixtures/elvanto-link/` (11.1 keeps byte copies). `MIN_CONSOLE_REV` (12) rises only once every console runs the new rev.
- New writers ship live: no practice/shadow stage, no operator first-click lock (operator 2026-10-15). Claude still never writes to live Elvanto or the prod DB itself, never applies migrations with the Supabase MCP, and never tests destructive admin actions against prod (use `PERSISTENCE=memory`).

**Migrations**: next is `0057` (check `ls supabase/migrations/*.sql | tail -1`); 4-digit, additive only, never edit a shipped file, no `create index concurrently`, bump `LATEST_MIGRATION` in `src/core/schema-version.ts` (a test enforces it). 3-digit numbers in old docs are folded into `0001`.

**New top-level API route**: register in all three of `router.ts`, `vercel.json` `routes[]` regex, `public/sw.js` `API_RE` (`route-registration.test.ts` checks), then `curl` it after deploy for a JSON 401.

**Security / privacy**
- `esc()` every user-data interpolation in the SPA (incl. error messages); `spa-xss-guard.test.ts` is a ship gate. No raw-markup `innerHTML`.
- `students.mobile` / `parent_phone` are AES-256-GCM encrypted; `FIELD_ENCRYPTION_KEY` must be in prod env before/with any deploy; never hand-copy ciphertext between rows.
- DNC: non-admin/oversight responses get phones `null` server-side; any new student-shaped route goes through `dnc.forActor`.
- No personal data in logs, error log, commits, fixtures or tests: ids only, fictional names only (Sample, Dummyton, Codeman).
- `SESSION_SECRET` required in prod; CORS never `*` in prod. Commit with explicit paths, never `git add -A` (`supabase/.temp/`, `_design/`). Never `npm audit fix --force`.
- Accepted risks (do not re-flag): Bus `as=` coordinator soft guard; prayer text plaintext; token in localStorage; stateless logout.

**Roles**: `leader` (own connected students, read-only except its own message template, default off) < `grade` (own grade + own gender) < `quad` (gender + bracket) < `oversight` (all + import) < `admin` (all + back office; exactly one, undeletable). Never add a `cohortModel === 'none'` scoping bypass. `actor-key` must key on the full grade set.

**Code**: repos return deep clones; ESM extensionless imports; strict TS (`noUncheckedIndexedAccess`); jsonb via `sql.json(value)`, never `JSON.stringify(x)::jsonb`; prod `DATABASE_URL` = Supavisor pooler SESSION mode port 5432. Keep client mirrors in sync (see `docs/areas/spa-rules.md`). Every bulk path caps at 50. Status/quad colours are not configurable. No dark mode.

**Operator rulings are not flipped on test findings** (e.g. new lifegroup reports default to "No service").

## Fix mode

For a targeted fix or tweak: one session, no subagents, write the failing test first, run only the affected test file(s), one self-review of the diff. Full review gates only for new features.

## Docs

- `docs/areas/`: `spa-rules`, `architecture`, `dev-testing`, `release`, `link-contract-revs`, `elvanto-link`, `consent-flows`, `new-person`, `bus`, `connection-audit-import`, `error-log-reconcile`, `notices-prayers`, `id-checks`, `roles-terms`, `setup-locations`, `spa-ui`, `security`, `env-prod-db`, `open-items` (pending operator decisions, known bugs, deferred items, HOMESERVER to-dos).
- Nested (auto-loaded per folder): `src/api/CLAUDE.md`, `src/services/CLAUDE.md`, `supabase/migrations/CLAUDE.md`.
- `DEPLOY.md` (live state, rollback notes), `docs/DEPLOYING.md` + `docs/GOOGLE-SETUP.md` (other locations), `debug.md` (symptom router), `docs/superpowers/` (specs, plans).
- History: `docs/history/claude-md-archive.md` (dated rounds 2026-10-16/17), `docs/HISTORY.md` (up to 2026-10-15), pre-slim file `git show eb41ada:CLAUDE.md`, pre-trim `git show a71a2c0:CLAUDE.md`.
