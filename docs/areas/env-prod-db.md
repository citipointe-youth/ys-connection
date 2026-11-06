# Environment variables and production database

```
PORT=4300
NODE_ENV=production      # LOCAL/other hosts only. Do NOT set NODE_ENV in Vercel: it makes Vercel skip devDependencies, so `tsx` is missing in the build.
PERSISTENCE=supabase     # production; use "memory" for local dev with seed data
DATABASE_URL=<supabase-connection-string>
CORS_ORIGINS=*
APP_ORIGIN=https://<your-deployment>.vercel.app   # CORS fallback when CORS_ORIGINS is unset
SESSION_SECRET=<random>  # REQUIRED in production, or session tokens can be forged
SETUP_CODE=<16+ chars>   # first-run admin creation (setup screen); ignored once an admin exists
GOOGLE_SA_JSON=<key file as one line>   # Bus; replaces the three GOOGLE_SA_* vars (they still work; JSON wins if both set)
GOOGLE_MAPS_API_KEY=<key>               # Bus; always required
LINK_SYNC_TOKEN=<32+ chars>             # Elvanto link console (/sync/*); unset or shorter = /sync answers 503 LINK_OFF
VAPID_PUBLIC_KEY=<base64url>            # Notice alerts (web push). Any of the three unset = alerts silently off
VAPID_PRIVATE_KEY=<base64url>           #   ("Alerts aren't set up yet"). Make a pair: npx web-push generate-vapid-keys
VAPID_SUBJECT=<mailto: or https: URL>   #   Contact sent to the push services, e.g. https://ys-connection.vercel.app
CRON_SECRET=<32+ chars>                 # Vercel cron catch-up GET /sync/alerts (Bearer). Unset or shorter = that GET answers 503 CRON_OFF, nothing runs.
                                        #   NOT SET in prod and no vercel.json cron exists (2026-11-07): the console's 15-min POST /sync/alerts is the only scheduler.
                                        #   Follow-up: set it (Vercel sends it as the Bearer when a cron entry exists), then add a crons entry.

# Required whenever PERSISTENCE=supabase — read directly from process.env by
# src/utils/field-crypto.ts, NOT via src/config/env.ts. Encrypts students.mobile and
# students.parent_phone at rest. See the "Phone field encryption at rest" section below.
FIELD_ENCRYPTION_KEY=<base64, 32 bytes>
FIELD_ENCRYPTION_KEY_ID=<id>
FIELD_ENCRYPTION_KEY_PREV=<base64>    # only during a key rotation
FIELD_ENCRYPTION_KEY_PREV_ID=<id>     # only during a key rotation
```

⚠ **`FIELD_ENCRYPTION_KEY` is a hard runtime dependency of nearly every read endpoint** once any row is encrypted — a whole-table read maps every row through the decrypt, so one undecryptable value fails the entire query (Home / `/overview` / `/trends` / `/students` / `/connections` together). It must be set in prod env **before or with** any deploy that ships the encryption-aware code, never after. Losing it = losing both phone columns permanently.

**GOTCHA — production `DATABASE_URL` must use the connection POOLER, not the direct connection.** On Vercel serverless, the direct connection (`db.<ref>.supabase.co:5432`) fails because Supabase now serves it over IPv6 only and Vercel functions are IPv4. Use the Supavisor pooler with the `postgres.<ref>` username: `postgresql://postgres.<ref>:<password>@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres`.

**Use SESSION mode (port `5432`), NOT transaction mode (`6543`).** The transaction-mode pooler intermittently handed back dead connections (queries dispatched, no response, 20 s timeout → 503) under this app's serverless + burst pattern — the root cause of the 2026-07 outage. Session mode fixed it; see "Production database" below and docs/HISTORY.md "✅ RESOLVED — the actual root cause was the pooler CONNECTION MODE (2026-07-06)" for the full evidence.

The `0015` migration now carries the role `statement_timeout = '15s'` (wrapped so it can never fail a deploy); the manual `ALTER ROLE` step in the 2026-07-05 history is no longer needed for a new database.

- **Google (Bus):** The prod `GOOGLE_SA_PRIVATE_KEY` is stored as the bare base64 body (no BEGIN/END lines) — `normalisePrivateKey` rewraps it; don't "fix" that path away. **The Google key now also needs Routes API `computeRoutes`** (past-night route maps). The Vercel MCP can't write prod env vars (403) — the owner edits them in the dashboard, then redeploys.

### Production database

The 2026-07 production incident (every endpoint 503'ing together) had two causes: the transaction-mode Supavisor pooler handing back dead connections (fixed by session mode, above) and a login rate limiter keyed by raw IP behind the church's shared NAT (now IP + account). Full investigation: docs/HISTORY.md "Production performance incident", "Incident continuation" and "✅ RESOLVED — the actual root cause was the pooler CONNECTION MODE (2026-07-06)". Levers and the remedy:

**Session-mode trade-off + mitigation levers (if the connection ceiling is ever hit).** Session mode holds a dedicated backend per app connection (transaction mode multiplexed them), so the ceiling is `max_connections = 60`. **Correction 2026-10-09:** the binding limit is the Supavisor session **Pool Size (15)** — `EMAXCONNSESSION … pool_size: 15` fired 52× since July (3× on 2026-10-09 right after a deploy). Raise Pool Size in the dashboard (≈30 is safe at max_connections 60). **2026-10-14:** it recurred after two deploys ~40 min apart (bus /trends /prayers 500s). `isTransientDbError` (`src/utils/transient-db.ts`) now maps `XX000` + `(EMAXCONN…)` to a 503 the SPA retries, and `trackForCancellation` (`client.ts`) no longer runs nested sql`` fragments as standalone queries (postgres.js `.then()` executes; ~571 syntax errors/h since 13 Oct). Pool Size raise still pending (operator). At current usage this is comfortable (~5–20 of 60), and it should still serve 30–40 leaders because connections are per *Vercel instance* (not per user — Fluid Compute packs many users onto few instances at `max: 2` each) and the `GET /batch` endpoint already cut requests-per-screen. **If a real Friday-night session ever approaches the limit** (symptom: new connections failing / queueing under peak load), the levers, in order of preference:
1. **Lower the app's `idle_timeout`** in `client.ts` (currently 120 s) so idle backends free their slot faster — more headroom without touching infra. (Reconnects are cheap + reliable in session mode, unlike the transaction-mode dead-connection issue we escaped.)
2. **Raise the Supavisor Pool Size** (Supabase Dashboard → Database → Connection Pooling), staying under `max_connections = 60`.
3. **Keep the app's `max` low** (currently 2) so total held backends = instances × max stays bounded. Do **not** stress-test production to find the limit — heavy load testing is what degraded the pooler during the incident. Watch the connection count during a real session instead.

   - **Operational remedy** if the pooler is ever saturated by orphans (symptom: even a single
     `/auth/login` takes 20s→503 while `/health` is fine): terminate them in the Supabase SQL
     editor —
     ```sql
     select pid, pg_terminate_backend(pid), now()-query_start
     from pg_stat_activity
     where state='active' and wait_event='ClientRead'
       and pid<>pg_backend_pid() and now()-query_start > interval '60 seconds';
     ```
     (Claude cannot run `pg_terminate_backend` — it's blocked as a destructive prod-infra action;
     the human must run it.)
