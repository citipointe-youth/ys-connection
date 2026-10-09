# Multi-location rollout + simple Google setup — design

Date: 2026-10-10. Status: spec — reviewed by four Sonnet subagents (owner delegated review;
findings applied). Next: implementation plan (`superpowers:writing-plans`).

## 1. Goal

Other Citipointe locations — and later other churches — run their own copy of YS Connection:
own GitHub fork, own Supabase, own Vercel, own Google Cloud project. Same code. The owner stays
the developer for every location. Location staff are **not technical**: they use web dashboards,
never a terminal, SQL or code.

Success = a non-technical person, using only `docs/DEPLOYING.md` (and `docs/GOOGLE-SETUP.md` if
they want Bus), gets a working, secure location without running SQL, opening a terminal, or
contacting the owner. Updates after that need one click ("Sync fork").

### Decisions (owner, 2026-10-10)

| Topic | Decision |
|---|---|
| Accounts | Each location has its own GitHub fork, Supabase, Vercel and Google Cloud. The repo is public (verified), so forking works from any account. |
| Updates | Everyone deploys from `master`. No `stable` branch, no release tags. Locations select GitHub **Sync fork**; their Vercel deploys by itself. Citipointe keeps its manual Vercel promote. |
| Database changes | Applied automatically by a script in the Vercel production build. No squashing of the migration files. |
| First login | `SETUP_CODE` env var + a one-time "Create your admin" screen. The 18 shared-password seed accounts are removed for new databases. |
| Setup help | An in-app setup checklist checks the Vercel settings and the database, and generates secrets to copy. |
| Google | Own Google project per location, set up with a written guide + one Cloud Shell script. |
| Guides | One guide, `docs/DEPLOYING.md` (on GitHub). The in-app "Deploy this setup" card becomes a link + settings-file export. All user-facing text follows ASD-STE100, with screenshots (§6.3). |

### Out of scope (later specs)

- Timezone / locale / address region / Elvanto-guide wording as per-location settings
  (`Australia/Brisbane`, `en-AU`, `'au'` stay hard-coded; fine for Queensland locations. A
  location in a daylight-saving state sees Bus times 1 h off in summer — the guide says so).
- Default branding text ("Youth Society Brisbane") shown before Setup is saved.
- Keeping free Supabase projects awake, backups, Elvanto Sync multi-location support,
  lost-admin password recovery.
- Removing the unused `web-push` dependency; the pre-existing `push` mismatch between
  `vercel.json` and `sw.js` `API_RE`.
- Keyless Google auth (Vercel OIDC → Workload Identity Federation) — a later option if the
  org-policy problem (§5.3) becomes common.

## 2. Automatic database updates

### 2.1 Runner — `scripts/migrate.ts`

- `package.json`: `"vercel-build": "tsx scripts/migrate.ts"`, `"migrate": "tsx scripts/migrate.ts"`.
  `tsx` is a devDependency; Vercel installs devDependencies unless `NODE_ENV=production` is set as
  a project env var — DEPLOYING.md says **do not set `NODE_ENV`**.
- Runs only when `VERCEL_ENV === 'production'` **and** `PERSISTENCE === 'supabase'`, or locally
  with `npm run migrate -- --force` (reads `DATABASE_URL` from the shell environment; the script
  never reads `.env` files). Otherwise prints "skipped" and exits 0 (preview builds, memory mode).
- `DATABASE_URL` missing in a production build: print a plain message and **exit 0**, so the
  first deploy of a new location still builds; the setup checklist then shows the missing value.
  Any other error exits 1 → the build fails → the current live deployment keeps serving.
- DEPLOYING.md says: `DATABASE_URL` must be enabled for the **Production** environment (env vars
  are available to the build only for the environments they are ticked for).
- Steps:
  1. Connect: `postgres(DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} })`. Session
     pooler (port 5432) is required for the session-level advisory lock. The build runs in
     Vercel's build region (not `syd1`), so each round trip is ~200 ms — fine for ~15 files.
  2. `select pg_advisory_lock(<fixed bigint>)` — two builds never migrate at once.
  3. `create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())`.
  4. **Baseline handover:** if `schema_migrations` is empty **and** tables `users` **and**
     `bus_run_edits` (created by 0014) both exist, insert every file version `<= '0014'`
     (`BASELINE_MAX`) without running them. One-time handover for Citipointe. A database with
     only some tables is not baselined (each migration is atomic, so this means a hand-built DB —
     the runner exits 1 with "Database is part set up; contact the developer").
  5. List `supabase/migrations/*.sql` sorted by filename. For each version not in the table:
     `await sql.begin(async tx => { await tx.file(path); await tx\`insert into schema_migrations (version) values (${v})\` })`.
     On error: print the file name and the Postgres message, exit 1. Versions in the table with
     no file (old code rolled back) are ignored.
  6. Print one summary line: "Database up to date — 15 of 15 changes applied (1 new)."
  7. Unlock and close.
- Migration rules (add to CLAUDE.md "Migrations"): files stay **additive**; no
  `create index concurrently`; never edit a file after it ships (one exception: 0003 below).

### 2.2 Migration changes

- **`0003_seed_accounts.sql`** → only a comment: "Superseded by the first-run setup code
  (2026-10-10). Intentionally empty." Citipointe is unaffected (baselined). Verified safe: 0004
  only updates rows (no-op when empty), nothing else inserts or depends on seeded rows, tests do
  not read migration files.
- **`0015_statement_timeout.sql`** — must never fail a deploy:
  ```sql
  do $$ begin
    alter role postgres set statement_timeout = '15s';
  exception when others then raise notice 'statement_timeout skipped: %', sqlerrm;
  end $$;
  ```
- **`src/core/schema-version.ts`**: `export const LATEST_MIGRATION = '0015'`. A unit test asserts
  it equals the highest filename in `supabase/migrations/`.

### 2.3 Citipointe rollout (one time)

1. Push `master` as normal. The build baselines 0001–0014 and applies 0015.
2. Before promoting: read the build-log summary line; in Supabase run
   `select * from schema_migrations order by version` → 15 rows.
3. Promote. From now on Claude does **not** apply migrations with the Supabase MCP; it pushes and
   tells the owner to check the build-log summary line before promoting. Update the Bus
   "Deploying" note in CLAUDE.md and the project memory to match.

## 3. First login — setup code

- New env var `SETUP_CODE` (≥ 16 characters). The checklist (§4) can generate one: 20 characters
  from an unambiguous alphabet (no 0/O/1/l/I), shown in groups of 4.
- **`needsAdmin`** = no user with role `admin` and status `active`. New
  `IUserRepository.countActiveAdmins()` in the in-memory and Supabase repos.
- `POST /setup/admin`, body `{ code, displayName, password }`, `auth: false`:
  - The username is always **`admin`**, so the protected-admin rule (`isProtectedAdmin()`,
    `account.service.ts:67`, keys on username `admin`) applies unchanged. `displayName` is free
    text, default "Admin".
  - Validation reuses `CreateUserSchema` (password min 8). Fields: `role: 'admin'`,
    `grade/grades/gender/quad/leaderId: null`, `mustChangePassword: false`.
  - Errors (plain text, §6.3):
    - 409 — "An admin already exists. Log in."
    - 400 — "SETUP_CODE is missing or too short. In Vercel, add a SETUP_CODE of 16 or more characters. Then redeploy."
    - 403 — "The setup code is wrong. Copy it again from the checklist."
    - password errors — the existing messages.
  - Code compare: `crypto.timingSafeEqual` on SHA-256 digests of both strings.
  - Rate limit: add `/setup/admin` to the existing login rate-limiter block in
    `express-adapter.ts` (~line 110); failed attempts count. No extra delay.
  - Race safety: Supabase repo `createFirstAdmin(user)` — inside `sql.begin`:
    `select pg_advisory_xact_lock(<bigint>)`, then insert only if no active admin exists
    (`insert … where not exists`); no row inserted → 409. In-memory repo checks and inserts
    synchronously. (`users.email` unique already blocks a second `admin`.)
  - Response = the `/auth/login` shape `{ token, user }`, built via `auth.issueTokenFor(id)` +
    the existing safe-user mapper.
- Route: add to `src/api/http/router.ts`, the `vercel.json` route regex and `sw.js` `API_RE`
  (all three — CLAUDE.md checklist); bump `sw.js` `CACHE`.
- Memory mode: `seedDemoData` already creates `admin`, so setup is inert there. Supabase mode
  never seeds; zero users is safe (nothing at boot reads users).
- `SETUP_CODE` may stay set; it does nothing once an admin exists. The guide says they may
  delete it.
- "Apply account layout" (Setup wizard) creates the other logins; it needs only an admin actor.

## 4. Setup checklist + health

### 4.1 Make the app start without secrets

- `auth.service.ts:45` throws at **module load** when `SESSION_SECRET` is missing in production,
  which kills the function before any handler runs (Vercel shows a generic error page; the
  checklist cannot load). Change: keep the fail-closed rule but move the check into the
  functions that sign or verify a session token (`signSession` and the token verify path). The
  app then starts, every login/authenticated request still refuses with a clear error, and the
  public setup routes work.
- `api/index.ts`: when `createAppInstance()` fails, stop returning the stack trace. Return
  `{ error: 'The app cannot start.', hint }` (plain hint for known cases; full error stays in
  `console.error`). Load `../src/app` with `await import()` inside `getApp()` so an import-time
  error is also caught.

### 4.2 `GET /setup/status`

- **Access:** public while `needsAdmin` is true **or cannot be determined** (database down →
  treated as true; the `database` row then shows a fix). After an admin exists: admin only
  (`admin:manage`), otherwise 401/403.
- Returns `{ needsAdmin, checks: [{ id, label, state: 'ok'|'fix'|'optional', fix?, generate? }] }`.
  Never returns a secret, the database host, or any env value. `DATABASE_URL` missing → `fix`
  (not an error).
- Checks, in order (fix texts are final wording, STE-checked):

| id | Pass when | Fix text |
|---|---|---|
| `persistence` | `PERSISTENCE === 'supabase'` | "In Vercel, set PERSISTENCE to supabase. Then redeploy." |
| `database` | `select 1` answers within 3 s | "The app cannot reach the database. Copy the Session pooler connection string from Supabase again. Paste it as DATABASE_URL in Vercel. Then redeploy." |
| `databasePort` | `new URL(DATABASE_URL).port` is `5432` (empty port = 5432) | "The connection string must use port 5432. Copy the Session pooler string. Do not use the Transaction pooler string (port 6543). Then redeploy." |
| `schema` | max `schema_migrations.version` = `LATEST_MIGRATION` | "The database is not up to date. In Vercel, open Deployments. Select Redeploy on the top row." |
| `sessionSecret` | `SESSION_SECRET` set, ≥ 32 chars | "Select Generate. Select Copy. In Vercel, add the value as SESSION_SECRET. Then redeploy." |
| `encryptionKey` | `isEncryptionKeyValid()` (new pure export in `field-crypto.ts`: base64 decodes to 32 bytes, never throws) | "Select Generate. Select Copy. In Vercel, add the value as FIELD_ENCRYPTION_KEY. Then redeploy." + WARNING line: "Save this key in a safe place. If you lose it, the app cannot read phone numbers. If the app already has data, do not replace this key." |
| `appOrigin` | `APP_ORIGIN` equals the request origin (from `X-Forwarded-Host`; case-insensitive; no trailing slash) | "In Vercel, set APP_ORIGIN to `<origin of this page>`. Then redeploy." (Advisory only — nothing else trusts it. Required because CORS falls back to the YS Brisbane URL without it.) |
| `setupCode` | only while `needsAdmin`: `SETUP_CODE` ≥ 16 chars | "Select Generate. Select Copy. In Vercel, add the value as SETUP_CODE. Then redeploy." |
| `google` | `optional`; from `googleConfigStatus()` (§5.1) | "Google: connected." / "Google: not set up. Bus uses test routes." / "Google: part set up. Missing: `<names>`." + link "Open GOOGLE-SETUP.md" |

- No `statementTimeout` row: postgres.js already sets `statement_timeout` on every connection
  (`client.ts:51`), so the check could not test 0015 and the app is protected anyway.

### 4.3 SPA

- `boot()` today renders the normal login when `GET /settings` fails, so a broken deployment
  looks like a working login page. Change: when there is no token, `boot()` reads `needsAdmin`
  (added to the public `GET /settings` response — no extra request) and calls
  `/setup/status` when `needsAdmin` is true **or** `/settings` fails / returns the boot-error
  shape. Then show **`renderSetup()`** instead of `renderLogin()`.
- Setup screen: the checklist (ticks / fix messages, "Check again" button). Generated values are
  made **in the browser** (`crypto.getRandomValues`: hex for `SESSION_SECRET`, base64 32 bytes
  for `FIELD_ENCRYPTION_KEY`, grouped code for `SETUP_CODE`), each with **Copy**. They are held
  in memory only — never in localStorage, never sent to the server. A Generate button shows only
  while its row is `fix`. When every required row is `ok`: the "Create your admin" form
  (setup code, display name, password ×2; username shown as fixed "admin").
- Admin gets a new **System check** tab in Admin (add `'system'` to the `tabs` / `tabLabels`
  arrays, `index.html` ~5393) showing the same checklist without Generate buttons for rows that
  are ok.
- Bump `sw.js` `CACHE`.

### 4.4 `/health`

- Adds `db: 'ok'|'down'` and `schema: { current, expected }`. The DB probe (`select 1`, 3 s
  timeout) is cached for 30 s per instance so uptime monitors cannot use up pool connections
  (Supavisor pool size is 15). `health` is already in the `vercel.json` regex.

## 5. Simpler Google setup

### 5.1 Two env vars instead of four

- New `GOOGLE_SA_JSON` = the service-account key file as **single-line JSON** (the script prints
  it compact; multi-line values are error-prone in the Vercel dashboard). `client_email`,
  `project_id`, `private_key` are read from it; the key goes through the existing
  `normalisePrivateKey`.
- `googleRoutingEnabled()` / `routingFromEnv()` accept either `GOOGLE_SA_JSON` (used only when it
  is valid JSON with all three fields) or the old three vars (`GOOGLE_SA_EMAIL`,
  `GOOGLE_SA_PRIVATE_KEY`, `GOOGLE_PROJECT_ID`) — Citipointe keeps working unchanged. If both are
  set, `GOOGLE_SA_JSON` wins. `GOOGLE_MAPS_API_KEY` is still required.
- New `googleConfigStatus(env)` → `{ state: 'off'|'partial'|'on', missing: string[] }`, used by
  the checklist and Bus settings. Bad JSON → `partial`, missing
  `["GOOGLE_SA_JSON (not a valid key file. Paste the whole key file again.)"]`.

### 5.2 Bus settings status + test

- Bus settings (admins) shows one status line: "Google: connected." / "Google: not set up. Bus
  uses test routes." / "Google: part set up. Missing: `<variable names>`." When Bus is on and
  Google is off, the Bus page shows the same text as a small admin-only banner (today it is a
  silent `console.warn`).
- **Test Google connection** button → `POST /bus/google-check`, gated `admin:manage` (same as
  `PATCH /settings`), rate-limited to once per 10 s. New entry in `router.ts`; `bus` is already in
  `vercel.json` and `sw.js`. Five checks, one row each ("Sign-in: OK", "Places: Fix needed", …):
  1. Sign-in — the service-account token call (`accessToken`).
  2. Route Optimization — `optimizeTours` with `solvingMode: VALIDATE_ONLY` (not billed; HTTP
     200 = pass).
  3. Places — one autocomplete request (also covers Place Details, same API).
  4. Routes — a 1×1 `computeRouteMatrix`.
  5. Static Maps — one tiny map image.
  Cost: a few cents at most per press.
- Error classification needs a new classifier that reads the response body (the existing
  `call()` drops it on purpose): HTTP status + `error.details[].reason` for JSON APIs; Static
  Maps 403 by status alone. Never echo the body or any key text (`describeKeyShape` for key
  errors). Fix texts:
  - `SERVICE_DISABLED` — "`<API name>` is off. In Google Cloud, open APIs & Services. Turn on `<API name>`."
  - `IAM_PERMISSION_DENIED` / 403 on Route Optimization — "The service account cannot use Route Optimization. In Google Cloud, give it the role Route Optimization Editor."
  - `BILLING_DISABLED` — "Billing is off for this Google project. Turn on billing."
  - `API_KEY_INVALID` / `API_KEY_SERVICE_BLOCKED` — "The API key is not valid, or its restrictions block this API. Check the key and its API restrictions."
  - Static Maps 403 — "Maps Static API is off, or the API key blocks it."
  - other — "Google reported: `<message>`."

### 5.3 Cloud Shell setup script — `scripts/google-setup.sh`

Run from Google Cloud Shell with one pasted line, pinned to a commit SHA (the repo is public):
`bash <(curl -sL https://raw.githubusercontent.com/citipointe-youth/ys-connection/<sha>/scripts/google-setup.sh)`
(the guide's line is updated when the script changes).

1. Use the current project (`gcloud config get-value project`); if none, list projects and ask
   for the Project ID. (Cloud Shell starts with no project and shows an **Authorize** pop-up on
   the first command — the guide shows both.)
2. Check billing (`gcloud billing projects describe`). Off → print "Billing is off. Open `<link>`.
   Turn on billing. Then run this command again." and stop. If the check itself errors → print
   "Cannot check billing. Confirm it at console.cloud.google.com/billing/linkedaccounts." and
   continue.
3. Enable `iam`, `apikeys`, `cloudresourcemanager`, `routeoptimization`, `places`, `routes`,
   `static-maps-backend` (`.googleapis.com`).
4. Create service account `ys-bus` (skip if it exists); grant `roles/routeoptimization.editor`
   (`--condition=None`). Verify the role name against Google's IAM role list when building.
5. Create a JSON key. If the error mentions `constraints/iam` (key creation blocked — newer
   Google Cloud organisations, including most church Google Workspace domains, block it by
   default): print "Your organisation blocks key files. Ask an organisation admin to allow key
   files for this project, or create the project under a personal Gmail account. Then run this
   command again." Print the admin command on a separate "Technical:" line (owner verifies the
   exact `gcloud` org-policy override command for both `iam.disableServiceAccountKeyCreation` and
   `iam.managed.disableServiceAccountKeyCreation` when building). Stop.
6. Reuse an API key named `ys-bus-key` (`gcloud services api-keys list --filter=displayName=ys-bus-key`)
   or create one with `--api-target=service=places.googleapis.com`,
   `--api-target=service=routes.googleapis.com`,
   `--api-target=service=static-maps-backend.googleapis.com` (no IP/referrer restriction — Vercel
   has no fixed IP). Read the key with `gcloud services api-keys get-key-string`.
7. Print, between clear marker lines, `GOOGLE_SA_JSON` (single-line JSON via
   `python3 -c 'import json,sys;print(json.dumps(json.load(sys.stdin),separators=(",",":")))'`)
   and `GOOGLE_MAPS_API_KEY`, then: "Copy the two values between the lines. Paste them in
   Vercel. Then close this tab." Delete the key file (`shred -u`).
- Safe to run twice: reuses the account and API key; makes a new service-account key each run
  (the guide says to delete old keys under "Remove the access").
- All script messages follow §6.3; technical names only on a separate "Technical:" line.

## 6. Guides

### 6.1 `docs/DEPLOYING.md` (rewrite, ≤ 250 lines)

0. **Before you start** — what you need (an email address, a payment card only for Bus, ~45 min);
   cost (free tiers; Vercel Hobby is for non-commercial use — the owner confirms which plan a
   church picks before publishing); **Glossary** (≤ 15 lines: Fork, Repository, Environment
   variable, Session pooler, Redeploy, Service account); **Save these values** box (database
   password, SESSION_SECRET, FIELD_ENCRYPTION_KEY, admin password — keep them in a password
   manager); "last checked: <date>".
1. **GitHub** — create an account (skip if you have one); open the repo; **Fork** → **Create fork**.
2. **Supabase** — create an account; **New project**; name; create the database password and save
   it; pick the region; wait for "project ready" (~2 min); **Connect** → **Session pooler** →
   copy; replace `[YOUR-PASSWORD]` in the string by hand.
3. **Vercel** — sign up with GitHub; choose the plan; **Add New** → **Project** → import the
   fork; open **Environment Variables** on the import screen; add `PERSISTENCE`=`supabase`,
   `DATABASE_URL`, `APP_ORIGIN`; keep **Production** ticked; do not add `NODE_ENV`; **Deploy**;
   Expected result: "Congratulations"; copy the domain; if it differs from `APP_ORIGIN`, edit it
   and **Redeploy**.
   3b. **If the build fails** — open the deployment → **Build Logs** → copy the last 20 lines to
   the developer.
4. **Open the app** — the setup checklist; generate and add `SESSION_SECRET`,
   `FIELD_ENCRYPTION_KEY`, `SETUP_CODE` (**Settings** > **Environment Variables** > **Add**);
   **Redeploy**; **Check again**; create the admin; save the password in a password manager
   shared by two staff.
5. **Set up your ministry** — Setup wizard: optional **Load settings file** (from Citipointe), then
   **Apply account layout**. CAUTION: do this once.
6. **Updates** — on the fork page, "This branch is N commits behind" → **Sync fork** →
   **Update branch**. Vercel deploys by itself in ~2 min.
7. **Bus Ministry (optional)** — link to GOOGLE-SETUP.md. NOTE on daylight-saving states.
8. **Change the app icon (optional)** — `public/icons/*` in the fork (no runtime setting).
9. **Troubleshooting** (≤ 25 rows: symptom → fix) — includes port 6543 vs 5432 (the reason moves
   here), APP_ORIGIN fallback, Rollback (**Deployments** > **Instant Rollback**; does not touch
   the database), build failures, Supabase paused project.
- Remove: seed-account tables, the shared-password text, `../Generalisation of the app/` links,
  "Seed accounts by preset" (keep a short role-preset note in the Setup step).
- Keep: PERSISTENCE requirement, CORS_ORIGINS ("leave empty"), rollback, icon note.

### 6.2 `docs/GOOGLE-SETUP.md` (new, ≤ 120 lines)

0. Before you start — Google account, payment card, ~30 min, typical cost (usually $0/month;
   heavy use about AUD 30/month).
1. Create the project (console.cloud.google.com → **New project**; note the Project ID).
2. Turn on billing (link a billing account; a card is required).
3. Open Cloud Shell (the **>_** icon, top right — "a command window inside your browser").
4. Paste the line; press Enter; select **Authorize** if asked. Expected result: the two values
   between marker lines.
5. If the script stops — table of its stop messages and fixes.
6. Copy the two values (the key file shows only now).
7. Vercel → add `GOOGLE_SA_JSON` (the whole line, including `{ }`) and `GOOGLE_MAPS_API_KEY`,
   **Production** ticked → **Redeploy**.
8. Budget alert: **Billing** > **Budgets & alerts** > **Create budget**, AUD 20.
9. Bus settings → **Test Google connection**. Expected result: 5 rows, all OK.
10. Remove the access (when a person leaves): delete old service-account keys.

Other files: `.env.example` (commented `SETUP_CODE`, `FIELD_ENCRYPTION_KEY`, `GOOGLE_SA_JSON`,
`GOOGLE_MAPS_API_KEY`); `README.md` (seed table labelled "local demo only", link to
DEPLOYING.md); CLAUDE.md (Migrations, Environment variables, Seed accounts, Bus "Deploying").

### 6.3 Writing rules (guides, checklist, error and script messages)

- **ASD-STE100**: one instruction per sentence; procedural sentences ≤ 20 words, descriptive
  ≤ 25; active voice; imperative.
- Banned words: simply, just, easily, etc., should, may, e.g., i.e., click, press, tap, hit,
  enter (use "type"), choose, pick. Use **select** for buttons and links, **type** for text,
  **copy** / **paste**.
- Keep dashboard terms the reader will see (Session pooler, Redeploy, Environment Variables,
  service account) and define each once in the Glossary; first use links to it. Do not write
  "env var", "pooler", "JSON" or "build log" in app text.
- Button and field names **bold**, exactly as on screen; typed/pasted values in `code`; menu
  paths **Settings** > **Environment Variables**.
- Notices are one line starting `WARNING:` (data or security risk), `CAUTION:` (risk of error or
  delay) or `NOTE:`.
- Each step that changes the screen ends with "Expected result: …" — always after Deploy,
  Redeploy and Create.
- Each section has a time tag ("5 min"); each large part ends with "You can stop here."
- **Screenshots** in `docs/img/deploy/` (PNG, ≤ 1200 px wide, red box on the target). Until
  captured, a placeholder line `[Screenshot: <description>]`. Required list:
  01 github-fork-button · 02 github-create-fork · 03 supabase-new-project (password masked) ·
  04 supabase-connect-session-pooler (placeholder password, project ref blurred) ·
  05 vercel-import · 06 vercel-env-vars-import (dummy values) · 07 vercel-env-vars-settings
  (dummy values) · 08 vercel-redeploy · 09 vercel-deploy-success · 10 app-setup-checklist (fake
  values) · 11 app-create-admin · 12 github-sync-fork · 13 vercel-build-log · 14 gcp-new-project
  · 15 gcp-billing (IDs cropped) · 16 cloudshell-button · 17 cloudshell-output (throwaway project,
  key deleted afterwards, values blurred) · 18 gcp-budget (IDs cropped) · 19 bus-test-google.
  No screenshot for: pasting the Cloud Shell line, Copy buttons, troubleshooting, Load settings
  file. **No real secret, email, billing ID, name or student data in any image.**
  Capture: in-app screens by Claude (Chrome automation, demo data); dashboards during the
  acceptance run (§7) with the owner's accounts.
- Mechanical check (part of the plan): grep the guides for banned words, and a small script that
  flags numbered-step sentences over 20 words.

### 6.4 Guide review

After the guides and in-app texts are written, a **Sonnet subagent** reviews them against §6.3
and returns a list; Claude applies the fixes. The cold walk-through is the §7 acceptance run.

## 7. Testing

- Unit tests (vitest), DB access behind a small interface so tests use a fake:
  - runner: skip rules; baseline only when `users` + `bus_run_edits` exist and the table is empty;
    part-built DB → exit 1; applies only new files in order; stops on first failure; ignores
    table versions with no file; summary line.
  - `LATEST_MIGRATION` equals the highest migration filename.
  - setup: `needsAdmin`; 409 when an admin exists; 400 code missing/short; 403 wrong code;
    creates `admin` + session; concurrent second call → 409; rate-limited.
  - app starts without `SESSION_SECRET`; login and authenticated routes refuse; setup routes
    work.
  - `/setup/status`: public before admin and when DB is down, 401/403 after for non-admins;
    response never contains env values or the DB host; each row's ok/fix states.
  - `isEncryptionKeyValid`; `/health` probe caching.
  - Google: `GOOGLE_SA_JSON` parsing (valid, missing field, invalid JSON, escaped newlines);
    old 3-var form still works; JSON wins when both set; `googleConfigStatus`; each error →
    fix mapping, incl. Static Maps 403.
- `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js` before every commit.
- **Acceptance run (also the cold walk-through):** a fresh fork + throwaway Supabase + Vercel
  project (owner's accounts). Follow DEPLOYING.md literally; reach a working admin login with the
  checklist all green; run the Google script in a throwaway Google project; Test button all
  green. Fix every place the guide was unclear. Capture the screenshots. Delete the test location
  and its Google keys afterwards.
- Citipointe rollout check per §2.3.
