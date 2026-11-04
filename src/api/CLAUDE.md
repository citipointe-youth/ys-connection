# API layer (src/api)

Thin controllers -> declarative route table (`http/router.ts`) -> Express adapter (`http/express-adapter.ts`). An `auth: true` route's handler takes `AuthedRequest` (`ctx` non-null): the adapter returns 401 before it runs, so controllers do not re-check `req.ctx` (`auth-routes.test.ts` pins the 401 for every such route). Every route fails fast with a retryable 503 after 20 s; CSV/audit import routes and New person are exempt (`UNTIMED_ROUTES`).

## Adding a new top-level API route

**Checklist: adding a new top-level API route.** This has caused two separate production incidents (`/manifest.json` 2026-07-11, `/prayers` 2026-07-18) from the same root cause. The second incident's own writeup notes the lesson from the first "apparently didn't stick as a checklist item" — hence this checklist. A new top-level resource needs registering in **all three** of:
1. `src/api/http/router.ts` — the Express route table.
2. `vercel.json`'s `routes[]` regex allowlist — Vercel's edge routing runs BEFORE Express; a path not in the regex falls through `{"handle":"filesystem"}` to the SPA catch-all and returns the HTML shell with a **200**, which fails client-side as a confusing JSON-parse error, not a clean 404.
3. `public/sw.js`'s `API_RE` — otherwise the route gets cache-first treatment and can serve stale/HTML responses.

Then `curl` the new route post-deploy and confirm JSON + the right auth status code (401/403 unauthenticated) — not just "some 2xx came back".

## Routes

| Resource | Routes |
|---|---|
| Auth | `POST /auth/login`, `GET /auth/me`, `POST /auth/logout` |
| Students | `GET/POST /students`, `GET/PATCH/DELETE /students/:id`. `?crossGrade=1` widens a grade/quad login from "own grade/bracket + own gender" to "own gender only" (Connect Setup picker; other-grade rows come back without phones). Admin only: `GET /students/graduated`, `POST /students/:id/ungraduate`, `GET /students/off-roster`, `POST /students/off-roster/graduate` (`{ids}`, up to 50, re-checked against the current candidates) |
| Leaders | `GET/POST /leaders` (`?pick=1`, `?inactive=1`), `GET/PATCH/DELETE /leaders/:id`, `PATCH /leaders/:id/sms-template`, `PATCH /leaders/:id/grades`, `PATCH /leaders/:id/view-grades`. The self-service routes skip the creator check but need `leaderInScope` (403) since 2026-10-17 |
| Prayers | `GET/POST /prayers`, `GET /prayers/export`, `POST /prayers/import`, `PATCH /prayers/:id`, `PATCH /prayers/:id/status`, `DELETE /prayers/:id`. A general prayer (no student) is scoped by its creator's grade+gender (`generalPrayerCreatorScope` / `canAccessGeneralPrayer`); a `leader` resolves students via `connRepo` |
| Connections | `GET/POST /connections` (`?crossGrade=1`), `GET /connections/export` (own-gender-only for grade/quad), `GET /connections/student/:id`, `GET /connections/leader/:id` (+ `/followup`), `DELETE /connections/:studentId/:leaderId`, `GET /connections/allocations/export`, `POST /connections/allocations/import` (admin; `autoCreateLeaders: true` optional) |
| Stats | `GET /overview`, `GET /at-risk`, `GET /trends`, `GET /lifegroups/stats`, `GET /batch` (several sections in one request) |
| Import | `POST /import/csv`, `GET /import/history`, `DELETE /import/history`, `DELETE /import/history/:id` |
| Settings / setup / health | `GET/PATCH /settings` (GET is public, themes the login screen), `GET /setup/status`, `POST /setup/admin` (needs `SETUP_CODE`), `GET /health`, `GET /manifest.json` |
| Admin | `POST /admin/reset` (also wipes `connection_audits`), `POST /admin/clear-service-group`, error log `GET/PATCH/DELETE /admin/errors(/:id)`, `POST /admin/errors/client`, unsent New person `GET /admin/unsent`, `POST /admin/unsent/:id/retry`, `DELETE /admin/unsent/:id` |
| Connection audits | `POST/GET /audits`, `GET/DELETE /audits/:year`, `GET /audits/export-all`, `POST /audits/import-all` (registered before `/audits/:year`: Express matches in registration order) |
| Accounts | `GET/POST /accounts/users`, `PATCH /accounts/users/:id`, `POST /accounts/users/password` (admin), `POST /accounts/me/password` (self, returns `{ ok, token }`), `POST /accounts/users/:id/preview`, `POST /accounts/cohort-layout/preview|apply` |
| New person | `POST /intake/new-youth` (`intake:write`; module `newYouthForms`) |
| Notices | `GET/POST /notices`, `DELETE /notices/:id`, `GET/POST /notices/push`, `POST /notices/push/off` |
| ID Checks | `GET /id-checks`, `GET/PUT /id-checks/access` (admin grid), `GET /id-checks/leaders/:id`, `PUT/DELETE /id-checks/entries/:id`, `GET /id-checks/archived`, `POST /id-checks/archived/delete|attach` (module `idChecks`, default Off; see `docs/areas/id-checks.md`) |
| Bus | `/bus/*` (see Modules → Bus Ministry) |
| Elvanto link (session) | `GET /link/status`, `GET /link/checkin` (`?serviceTime=`), `GET /link/actions` (`?ids=` / `?serviceDate=` / `?type=` / `?status=unclear`: every unclear row of any date, newest 100, for the admin Status card's Landed / Not landed, CY-A1; a non-admin gets only their own rows), `POST /link/batch` (every write), `GET /link/lifegroups` (+ `/:groupId/members`), `GET /link/youth`, `GET /link/flows`, `POST /link/flows/assign`, `GET /link/intake` (+ `/row`, `POST /refresh`), `GET /link/consents/lookup`; admin only (`link:admin`): `GET /link/admin/roster`, `POST /link/admin/roster/:personId`, `GET /link/admin/log`, `POST /link/admin/unclear/:id` (`{landed}`: an unclear row -> sent, or refused `not-landed`; frees its dedupe key; CY-A1) |
| Elvanto link (console) | `POST /sync/claim`, `POST /sync/result`, `POST /sync/push/:kind`, `POST /sync/leaders` — no session: `Authorization: Bearer <LINK_SYNC_TOKEN>`, checked in the adapter; 503 `LINK_OFF` while the token is unset |

Self-service endpoints that skip the creator/ownership check (`/leaders/:id/sms-template`, `/leaders/:id/grades`) do so because most leaders are created by CSV import with no owner; they still need `leaderInScope`.

**Clearing import history ≠ deleting data.** The `DELETE /import/history` routes only remove `import_records` log rows (2026-10-22 r22 B5: the Import screen no longer has Clear All or per-row trash, because the log is the console's duplicate-upload evidence; the routes stay). `service_sessions.import_id` / `lifegroup_weeks.import_id` are **`ON DELETE SET NULL`** (archived migration `013`, now folded into `0001_baseline_schema.sql` — see Migrations; they were `CASCADE` before, which silently wiped attendance in production while the in-memory dev path didn't — a nasty divergence). The admin **Clear Service/Group data** button is gone (2026-10-22, Data tab removed); the server route `POST /admin/clear-service-group` (`clearServiceGroupData`, deletes sessions/weeks/attendance and resets student aggregates) stays, and the New Year wizard's gated step 4 is the only reset in the UI. `import_id` is provenance only (imports are full-replace; `deleteByImport` is unused), so nulling it is safe.

**Import screen (2026-10-22, r22 A8/B5):** a top "Last service/group import" line per kind, history capped at 6 rows with a `_drop` "Show all (N)", and no second page header inside Admin (`S.page==='admin'`). `src/tests/import-contract.spa.test.ts` pins what the console's Friday import drives: the desk-nav Import link, `#csv-file`, `#import-status`, the "Import" confirm buttons and the "Import complete:" / "View import report (" strings. Change the console first if any of these must move.

The Import screen's **new-vs-known preview** (`previewServiceImport`) counts against a fresh `/students` fetch, NOT the 30s `Cache.get` — that cache expires and is wiped by `Cache.clear()` after every import, which made a re-upload preview show everyone as "new" with 0 updates even though the server correctly matched them by name.
