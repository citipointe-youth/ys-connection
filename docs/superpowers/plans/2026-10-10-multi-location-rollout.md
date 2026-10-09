# Multi-location rollout + simple Google setup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A non-technical person can stand up their own copy of YS Connection (own GitHub fork, Supabase, Vercel, Google project) using only `docs/DEPLOYING.md` (+ `docs/GOOGLE-SETUP.md`), with automatic database updates, a first-run setup checklist and admin creation, and a one-script Google setup.

**Architecture:** A build-time migration runner (`vercel-build` → `scripts/migrate.ts` → pure `src/migrate/runner.ts`) replaces hand-applied migrations. The app starts even with missing secrets; a public `/setup/status` checklist + `POST /setup/admin` (guarded by `SETUP_CODE`) replace the seeded shared-password accounts. Google config collapses to `GOOGLE_SA_JSON` + `GOOGLE_MAPS_API_KEY`, with a server-side 5-call connection test. Guides are rewritten to ASD-STE100.

**Tech Stack:** TypeScript/Express (CommonJS, strict), postgres.js, vitest, vanilla-JS SPA (`public/index.html`), Vercel, Supabase, bash (Google Cloud Shell).

**Spec:** `docs/superpowers/specs/2026-10-10-multi-location-rollout-design.md` (commit `0203c7b`). Executors read the spec section named in each task before starting it.

## Global Constraints

- Repo: `C:\Users\thoma\OneDrive\Claude Programs\Project 7 - Connection Made Simple\connection-made-simple` (git, branch `master`). Work on `master` (owner's standing workflow: no PR, no feature branch).
- **Subagents never commit.** After each batch the controller (Claude) reviews the diff, runs `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`, and commits with explicit paths (never `git add -A` — `_design/` and `supabase/.temp/` must stay out).
- **Do not push and do not touch prod** until Task 9, and only after the owner says yes. Never run the Supabase MCP `apply_migration` on prod again (§2.3) — after Task 9 the build applies migrations.
- `vercel-build`: `"tsx scripts/migrate.ts"`; `migrate`: `"tsx scripts/migrate.ts"`. Guides say **do not set `NODE_ENV`**.
- Runner runs only when `VERCEL_ENV === 'production'` **and** `PERSISTENCE === 'supabase'`, or with `--force`. Never reads `.env` files. Missing `DATABASE_URL` in a production build → message + **exit 0**. Any other error → exit 1.
- `BASELINE_MAX = '0014'`; baseline only when `schema_migrations` is empty **and** `public.users` **and** `public.bus_run_edits` exist.
- `LATEST_MIGRATION = '0015'` in `src/core/schema-version.ts`.
- Migration rules: files stay additive; no `create index concurrently`; never edit a shipped file (the one exception is `0003`).
- `SETUP_CODE` ≥ 16 characters; generated codes are 20 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, shown in groups of 4 joined by `-`.
- First admin username is always `admin`; `role:'admin'`, `grade/grades/gender/quad/leaderId: null`, `mustChangePassword:false`; password min 8 (reuse `CreateUserSchema`).
- Error texts (copy exactly): 409 `An admin already exists. Log in.` · 400 `SETUP_CODE is missing or too short. In Vercel, add a SETUP_CODE of 16 or more characters. Then redeploy.` · 403 `The setup code is wrong. In Vercel, open Settings > Environment Variables. Copy SETUP_CODE again.`
  - *Changed from the reviewed spec (spec §3 updated to match):* the old 403 text said "Copy it again from the checklist", but generated values live only in browser memory and are gone after the Redeploy reload; the code is always readable in Vercel.
- Setup-code compare: normalise both sides (remove whitespace and `-`, uppercase), then `crypto.timingSafeEqual` on SHA-256 digests.
- `/setup/status` never returns a secret, the database host, or any env value. Checklist fix texts are copied **verbatim** from spec §4.2's table (Task 3 code contains them).
- `/health` DB probe: `select 1`, 3 s timeout, cached 30 s per instance.
- Google: `GOOGLE_SA_JSON` wins over the old three vars when both are set; `GOOGLE_MAPS_API_KEY` always required. Never echo a response body or any key text.
- All user-facing text (guides, checklist, errors, script messages, new SPA text) follows spec §6.3 (ASD-STE100; banned words: simply, just, easily, etc., should, may, e.g., i.e., click, press, tap, hit, enter, choose, pick; use **select**, **type**, **copy**, **paste**). Do not write "env var", "pooler", "JSON" or "build log" in app text.
- SPA: wrap all interpolated user data in `esc()`; any JS string containing an apostrophe uses double quotes (see CLAUDE.md "white screen" incident); bump `public/sw.js` `CACHE` (`ysc-v85` → `ysc-v86`) once in Task 4.
- New top-level route `/setup` must be added to **all three**: `src/api/http/router.ts`, `vercel.json` route regex, `public/sw.js` `API_RE`.
- Owner model: the owner promotes Vercel deployments; Claude never aliases/promotes.

## Review Focus

1. **A new Supabase project already has `auth.users`.** The baseline/part-built check must look at `public.users` and `public.bus_run_edits` (`to_regclass('public.users')`), or a fresh database is wrongly called "part set up" and the first build fails. → test in Task 1 (`tableExists` is called with `public.`-qualified names; fake DB with only `auth.users`-equivalent returns fresh-run).
2. **Setup code pasted with spaces, dashes or lowercase** (copied from Vercel, typed on a phone) must still be accepted. → test in Task 3 (`codeMatches(' abcd-efgh-jkmn-pqrs-tuvw ', 'ABCD-EFGH-JKMN-PQRS-TUVW')` is true).
3. **`DATABASE_URL` forms:** no explicit port (= 5432 → ok), `?pgbouncer=true` query string (ok), `:6543` (fix), unparseable string (fix, no throw). → test in Task 3 (`databasePort` row).
4. **`GOOGLE_SA_JSON` pasted pretty-printed (multi-line) or with surrounding whitespace** must parse; a key file with `\n`-escaped `private_key` must normalise. → test in Task 2.
5. **`APP_ORIGIN` with a trailing slash or different case**, and a request host with a port, must compare correctly (case-insensitive, trailing slash ignored). → test in Task 3.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/migrate/runner.ts` (new) | Pure migration runner: `MigrationDb` interface, `listMigrationFiles`, `runMigrations`, `shouldRun` |
| `src/migrate/postgres-db.ts` (new) | `MigrationDb` implemented on postgres.js |
| `scripts/migrate.ts` (new) | CLI/build entry: env checks, exit codes |
| `src/core/schema-version.ts` (new) | `LATEST_MIGRATION` |
| `supabase/migrations/0003_seed_accounts.sql` | Emptied (comment only) |
| `supabase/migrations/0015_statement_timeout.sql` (new) | Role statement timeout, never fails |
| `src/services/routing/google-config.ts` (new) | `googleConfigFromEnv`, `googleConfigStatus` |
| `src/services/routing/google-check.ts` (new) | 5-call connection test + error classifier |
| `src/services/routing/google-routing-provider.ts` | `googleRoutingEnabled`/`routingFromEnv` use `google-config.ts` |
| `src/services/setup.service.ts` (new) | `needsAdmin`, `status`, `createFirstAdmin` |
| `src/api/controllers/setup.controller.ts` (new) | `/setup/status`, `/setup/admin`, `/bus/google-check` handlers |
| `src/utils/cached-probe.ts` (new) | 30 s cached async probe for `/health` |
| `src/services/auth.service.ts` | Lazy `SESSION_SECRET` check; `sessionSecretConfigured()` |
| `src/utils/field-crypto.ts` | `isEncryptionKeyValid()` |
| `src/repositories/...users` | `countActiveAdmins()`, `createFirstAdmin()` |
| `api/index.ts` | Dynamic import; no stack trace in response |
| `src/api/http/express-adapter.ts`, `types.ts`, `router.ts` | `origin` on request; `/setup/admin` rate limit; `/health` db+schema; new routes |
| `public/index.html` | Setup screen, System check tab, Bus Google status/test/banner, settings-file export/load (replaces deploy guide card) |
| `scripts/google-setup.sh` (new) | Cloud Shell setup script |
| `scripts/check-guide-style.js` (new) | Banned-word + long-step checker |
| `docs/DEPLOYING.md`, `docs/GOOGLE-SETUP.md` (new), `.env.example`, `README.md`, `CLAUDE.md` | Guides and docs |

## Execution batches (controller instructions)

Dispatch one Sonnet subagent per batch, **sequentially** (they share the working tree). Brief each with: this plan's Global Constraints, the named tasks' full text, the spec sections named, "do not commit, do not push, do not touch prod; report the files changed and the test output".

| Batch | Tasks | Commit message after review |
|---|---|---|
| A | Task 1, Task 2 | `feat: build-time database updates + GOOGLE_SA_JSON and Google connection test` |
| B | Task 3 | `feat: first-run setup code, setup checklist API, health db/schema` |
| C | Task 4 | `feat(spa): setup checklist screen, System check tab, Bus Google status, settings file` |
| D | Task 5, Task 6 | `docs: STE guides for deploying + Google setup; Cloud Shell setup script` |
| E | Task 7 (guide-review subagent, read-only) → controller applies fixes | `docs: guide review fixes` |
| — | Task 8 (controller), Task 9 (owner-gated), Task 10 (owner + controller) | per task |

After each batch the controller also checks the batch against the spec sections it covers before committing (spec compliance first, then code quality).

---

### Task 1: Build-time database updates (spec §2)

**Files:**
- Create: `src/migrate/runner.ts`, `src/migrate/postgres-db.ts`, `scripts/migrate.ts`, `src/core/schema-version.ts`, `supabase/migrations/0015_statement_timeout.sql`, `src/tests/migrate-runner.test.ts`, `src/tests/schema-version.test.ts`
- Modify: `package.json` (scripts), `supabase/migrations/0003_seed_accounts.sql`

**Interfaces:**
- Produces: `LATEST_MIGRATION: string` (`src/core/schema-version.ts`) — used by Task 3.
- Produces: `listMigrationFiles(dir: string): MigrationFile[]`, `runMigrations(db: MigrationDb, files: MigrationFile[], log: (line: string) => void): Promise<RunSummary>`, `shouldRun(env, argv): 'run' | 'skip'`, `BASELINE_MAX = '0014'`, class `MigrationAbort extends Error` (message is the plain text to print).

- [ ] **Step 1: Write the failing runner tests**

`src/tests/migrate-runner.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations, listMigrationFiles, shouldRun, MigrationAbort, type MigrationDb, type MigrationFile } from '../migrate/runner';

function fakeDb(opts: { tables?: string[]; applied?: string[]; failOn?: string } = {}) {
  const applied = new Set(opts.applied ?? []);
  const ran: string[] = [];
  const tableChecks: string[] = [];
  let locked = false;
  const db: MigrationDb = {
    async lock() { locked = true; },
    async unlock() { locked = false; },
    async ensureTable() {},
    async appliedVersions() { return [...applied]; },
    async tableExists(name) { tableChecks.push(name); return (opts.tables ?? []).includes(name); },
    async markApplied(versions) { versions.forEach((v) => applied.add(v)); },
    async apply(file) {
      if (file.version === opts.failOn) throw new Error('relation "x" does not exist');
      ran.push(file.version); applied.add(file.version);
    },
    async close() {},
  };
  return { db, ran, applied, tableChecks, isLocked: () => locked };
}
const files = (...v: string[]): MigrationFile[] => v.map((x) => ({ version: x, name: `${x}_x.sql`, path: `/m/${x}_x.sql` }));
const all = files('0001', '0002', '0013', '0014', '0015');

describe('shouldRun', () => {
  it('runs on a production supabase build', () => {
    expect(shouldRun({ VERCEL_ENV: 'production', PERSISTENCE: 'supabase' }, [])).toBe('run');
  });
  it('skips preview builds and memory mode', () => {
    expect(shouldRun({ VERCEL_ENV: 'preview', PERSISTENCE: 'supabase' }, [])).toBe('skip');
    expect(shouldRun({ VERCEL_ENV: 'production', PERSISTENCE: 'memory' }, [])).toBe('skip');
    expect(shouldRun({}, [])).toBe('skip');
  });
  it('runs locally with --force', () => {
    expect(shouldRun({}, ['--force'])).toBe('run');
  });
});

describe('runMigrations', () => {
  it('fresh database: applies every file in order', async () => {
    const f = fakeDb();
    const s = await runMigrations(f.db, all, () => {});
    expect(f.ran).toEqual(['0001', '0002', '0013', '0014', '0015']);
    expect(s).toMatchObject({ total: 5, applied: 5, newCount: 5, baselined: 0 });
  });
  it('checks public-schema tables only (a new Supabase project has auth.users)', async () => {
    const f = fakeDb({ tables: ['auth.users'] });
    await runMigrations(f.db, all, () => {});
    expect(f.tableChecks).toEqual(['public.users', 'public.bus_run_edits']);
    expect(f.ran).toHaveLength(5);
  });
  it('baselines <= 0014 when users + bus_run_edits exist and the table is empty', async () => {
    const f = fakeDb({ tables: ['public.users', 'public.bus_run_edits'] });
    const lines: string[] = [];
    const s = await runMigrations(f.db, all, (l) => lines.push(l));
    expect(f.ran).toEqual(['0015']);
    expect(s).toMatchObject({ total: 5, applied: 5, newCount: 1, baselined: 4 });
    expect(lines.at(-1)).toBe('Database up to date — 5 of 5 changes applied (1 new).');
  });
  it('part-built database (users but no bus_run_edits) aborts', async () => {
    const f = fakeDb({ tables: ['public.users'] });
    await expect(runMigrations(f.db, all, () => {})).rejects.toThrow(MigrationAbort);
    await expect(runMigrations(fakeDb({ tables: ['public.users'] }).db, all, () => {}))
      .rejects.toThrow('Database is part set up; contact the developer');
    expect(f.ran).toEqual([]);
  });
  it('does not baseline when schema_migrations already has rows', async () => {
    const f = fakeDb({ tables: ['public.users', 'public.bus_run_edits'], applied: ['0001', '0002', '0013', '0014'] });
    await runMigrations(f.db, all, () => {});
    expect(f.ran).toEqual(['0015']);
  });
  it('stops on the first failure and names the file', async () => {
    const f = fakeDb({ failOn: '0002' });
    await expect(runMigrations(f.db, all, () => {})).rejects.toThrow(/0002_x\.sql.*relation "x" does not exist/);
    expect(f.ran).toEqual(['0001']);
    expect(f.isLocked()).toBe(false); // unlocked even on failure
  });
  it('ignores table versions with no file (old code rolled back)', async () => {
    const f = fakeDb({ applied: ['0001', '0002', '0013', '0014', '0015', '0016'] });
    const s = await runMigrations(f.db, all, () => {});
    expect(f.ran).toEqual([]);
    expect(s).toMatchObject({ total: 5, applied: 5, newCount: 0 });
  });
});

describe('listMigrationFiles', () => {
  it('lists NNNN_*.sql sorted by filename, ignoring other files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-'));
    for (const n of ['0010_b.sql', '0002_a.sql', 'README.md', 'x.sql']) writeFileSync(join(dir, n), '--');
    expect(listMigrationFiles(dir).map((f) => f.version)).toEqual(['0002', '0010']);
  });
});
```

`src/tests/schema-version.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { LATEST_MIGRATION } from '../core/schema-version';
import { listMigrationFiles } from '../migrate/runner';

describe('LATEST_MIGRATION', () => {
  it('equals the highest migration filename', () => {
    const files = listMigrationFiles(join(__dirname, '..', '..', 'supabase', 'migrations'));
    expect(LATEST_MIGRATION).toBe(files.at(-1)!.version);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/tests/migrate-runner.test.ts src/tests/schema-version.test.ts`
Expected: FAIL — cannot resolve `../migrate/runner` / `../core/schema-version`.

- [ ] **Step 3: Implement the runner**

`src/migrate/runner.ts`:

```ts
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export const BASELINE_MAX = '0014';
const FILE_RE = /^(\d{4})_.+\.sql$/;

export interface MigrationFile { version: string; name: string; path: string }
export interface RunSummary { total: number; applied: number; newCount: number; baselined: number }

/** DB access behind a small interface so the runner is unit-tested with a fake. */
export interface MigrationDb {
  lock(): Promise<void>;
  unlock(): Promise<void>;
  ensureTable(): Promise<void>;
  appliedVersions(): Promise<string[]>;
  /** `name` is schema-qualified, e.g. 'public.users'. */
  tableExists(name: string): Promise<boolean>;
  markApplied(versions: string[]): Promise<void>;
  /** Runs the file and records its version in ONE transaction. */
  apply(file: MigrationFile): Promise<void>;
  close(): Promise<void>;
}

/** A stop with a plain message for the build output (exit 1). */
export class MigrationAbort extends Error {}

export function shouldRun(env: Record<string, string | undefined>, argv: string[]): 'run' | 'skip' {
  if (argv.includes('--force')) return 'run';
  return env['VERCEL_ENV'] === 'production' && env['PERSISTENCE'] === 'supabase' ? 'run' : 'skip';
}

export function listMigrationFiles(dir: string): MigrationFile[] {
  return readdirSync(dir)
    .filter((n) => FILE_RE.test(n))
    .sort()
    .map((name) => ({ version: FILE_RE.exec(name)![1]!, name, path: join(dir, name) }));
}

export async function runMigrations(db: MigrationDb, files: MigrationFile[], log: (line: string) => void): Promise<RunSummary> {
  await db.lock();
  try {
    await db.ensureTable();
    let done = new Set(await db.appliedVersions());
    let baselined = 0;
    if (done.size === 0) {
      const hasUsers = await db.tableExists('public.users');
      const hasBusEdits = await db.tableExists('public.bus_run_edits');
      if (hasUsers && hasBusEdits) {
        const base = files.filter((f) => f.version <= BASELINE_MAX).map((f) => f.version);
        await db.markApplied(base);
        baselined = base.length;
        log(`Baseline: marked ${baselined} existing changes as applied.`);
        done = new Set(base);
      } else if (hasUsers || hasBusEdits) {
        throw new MigrationAbort('Database is part set up; contact the developer.');
      }
    }
    let newCount = 0;
    for (const f of files) {
      if (done.has(f.version)) continue;
      try { await db.apply(f); }
      catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new MigrationAbort(`Database change ${f.name} failed: ${msg}`);
      }
      done.add(f.version);
      newCount++;
      log(`Applied ${f.name}`);
    }
    const applied = files.filter((f) => done.has(f.version)).length;
    log(`Database up to date — ${applied} of ${files.length} changes applied (${newCount} new).`);
    return { total: files.length, applied, newCount, baselined };
  } finally {
    await db.unlock();
  }
}
```

Note: the test expects `'Database is part set up; contact the developer'` as a substring — the message above ends with a full stop, which still matches `toThrow(string)` (substring match).

- [ ] **Step 4: Run the runner tests**

Run: `npx vitest run src/tests/migrate-runner.test.ts`
Expected: PASS (schema-version test still fails).

- [ ] **Step 5: postgres.js `MigrationDb` + entry script + schema version**

First confirm postgres.js runs a parameterless `file()`/`unsafe()` with the simple protocol (needed for multi-statement files): `grep -n "simple" node_modules/postgres/cjs/src/index.js | head`. Expected: `unsafe`/`file` set `simple: args.length === 0` (or equivalent). If not, use `tx.unsafe(readFileSync(path,'utf8')).simple()`.

`src/migrate/postgres-db.ts`:

```ts
import postgres from 'postgres';
import type { MigrationDb } from './runner';

const LOCK_KEY = 7201010001; // fixed bigint: only one build migrates at a time

export function postgresMigrationDb(url: string): MigrationDb {
  // Session pooler (port 5432) is required for the session-level advisory lock.
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  return {
    async lock() { await sql`select pg_advisory_lock(${LOCK_KEY})`; },
    async unlock() { await sql`select pg_advisory_unlock(${LOCK_KEY})`.catch(() => {}); },
    async ensureTable() {
      await sql`create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())`;
    },
    async appliedVersions() {
      return (await sql<{ version: string }[]>`select version from schema_migrations`).map((r) => r.version);
    },
    async tableExists(name) {
      const [r] = await sql<{ t: string | null }[]>`select to_regclass(${name})::text as t`;
      return !!r?.t;
    },
    async markApplied(versions) {
      for (const v of versions) await sql`insert into schema_migrations (version) values (${v}) on conflict do nothing`;
    },
    async apply(file) {
      await sql.begin(async (tx) => {
        await tx.file(file.path);
        await tx`insert into schema_migrations (version) values (${file.version})`;
      });
    },
    async close() { await sql.end({ timeout: 5 }); },
  };
}
```

`scripts/migrate.ts`:

```ts
import { join } from 'node:path';
import { runMigrations, listMigrationFiles, shouldRun, MigrationAbort } from '../src/migrate/runner';
import { postgresMigrationDb } from '../src/migrate/postgres-db';

async function main(): Promise<number> {
  if (shouldRun(process.env, process.argv.slice(2)) === 'skip') {
    console.log('Database update skipped (not a production Supabase build).');
    return 0;
  }
  const url = process.env['DATABASE_URL'];
  if (!url) {
    console.log('Database update skipped: DATABASE_URL is not set for Production. The app setup checklist shows the fix.');
    return 0; // the first deploy of a new location must still build
  }
  let host = '(unreadable)';
  try { host = new URL(url).hostname; } catch { /* keep placeholder */ }
  console.log(`Database update: connecting to ${host}`); // host only — never the password
  const db = postgresMigrationDb(url);
  try {
    await runMigrations(db, listMigrationFiles(join(__dirname, '..', 'supabase', 'migrations')), (l) => console.log(l));
    return 0;
  } catch (err) {
    console.error(err instanceof MigrationAbort ? err.message : `Database update failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  } finally {
    await db.close().catch(() => {});
  }
}

main().then((code) => process.exit(code));
```

`src/core/schema-version.ts`:

```ts
/** Highest file in supabase/migrations/. A unit test keeps this in sync. Read by /setup/status and /health. */
export const LATEST_MIGRATION = '0015';
```

- [ ] **Step 6: Migration files + package.json**

Replace the whole of `supabase/migrations/0003_seed_accounts.sql` with:

```sql
-- Superseded by the first-run setup code (2026-10-10). Intentionally empty.
-- New databases create their first admin through the app's setup screen
-- (POST /setup/admin, guarded by the SETUP_CODE environment variable).
-- Existing databases are baselined past this file by scripts/migrate.ts.
```

Create `supabase/migrations/0015_statement_timeout.sql`:

```sql
-- Role-level statement timeout (was a manual prod-only step; see CLAUDE.md
-- "Home-load performance investigation"). Must never fail a deploy.
do $$ begin
  alter role postgres set statement_timeout = '15s';
exception when others then raise notice 'statement_timeout skipped: %', sqlerrm;
end $$;
```

`package.json` scripts: replace `vercel-build` and add `migrate`:

```json
"vercel-build": "tsx scripts/migrate.ts",
"migrate": "tsx scripts/migrate.ts"
```

- [ ] **Step 7: Verify**

Run: `npx vitest run src/tests/migrate-runner.test.ts src/tests/schema-version.test.ts` → PASS.
Run: `npx tsx scripts/migrate.ts` (no env) → prints `Database update skipped (not a production Supabase build).`, exit 0.
Run (PowerShell): `Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue; $env:VERCEL_ENV='production'; $env:PERSISTENCE='supabase'; npx tsx scripts/migrate.ts; Remove-Item Env:VERCEL_ENV,Env:PERSISTENCE` → prints the `DATABASE_URL is not set` line, exit 0. **Always clear `DATABASE_URL` first** — a prod string left in the shell would migrate prod.
Do **not** run `--force` against any real database in this task.

---

### Task 2: Google config from two values + connection test (spec §5.1, §5.2 backend)

**Files:**
- Create: `src/services/routing/google-config.ts`, `src/services/routing/google-check.ts`, `src/tests/google-config.test.ts`, `src/tests/google-check.test.ts`
- Modify: `src/services/routing/google-routing-provider.ts` (`googleRoutingEnabled`, `routingFromEnv`)

**Interfaces:**
- Consumes: `normalisePrivateKey`, `signJwt`, `GoogleConfig` (existing, `google-routing-provider.ts`).
- Produces: `googleConfigFromEnv(e?: NodeJS.ProcessEnv): GoogleConfig | null` (ignores the memory-mode rule); `googleConfigStatus(e?): { state: 'off'|'partial'|'on'; missing: string[] }`; `googleStatusText(s): string`; `checkGoogleConnection(cfg: GoogleConfig, fetchFn?: typeof fetch, now?: () => number): Promise<GoogleCheckRow[]>` where `GoogleCheckRow = { id: 'signin'|'routeopt'|'places'|'routes'|'staticmap'; label: string; ok: boolean; fix?: string }`; `classifyGoogleError(api: GoogleApiName, status: number, bodyText: string, apiKey: string): string`.

- [ ] **Step 1: Write failing config tests**

`src/tests/google-config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { googleConfigFromEnv, googleConfigStatus, googleStatusText } from '../services/routing/google-config';
import { googleRoutingEnabled } from '../services/routing/google-routing-provider';

const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const keyFile = { type: 'service_account', project_id: 'p1', client_email: 'ys-bus@p1.iam.gserviceaccount.com', private_key: pem };
const json = JSON.stringify(keyFile);

describe('googleConfigFromEnv', () => {
  it('reads GOOGLE_SA_JSON (compact)', () => {
    const c = googleConfigFromEnv({ GOOGLE_SA_JSON: json, GOOGLE_MAPS_API_KEY: 'k' });
    expect(c).toMatchObject({ apiKey: 'k', saEmail: keyFile.client_email, projectId: 'p1' });
    expect(c!.saPrivateKey).toContain('-----BEGIN PRIVATE KEY-----\n');
  });
  it('reads pretty-printed JSON with surrounding whitespace', () => {
    const c = googleConfigFromEnv({ GOOGLE_SA_JSON: `\n  ${JSON.stringify(keyFile, null, 2)}  \n`, GOOGLE_MAPS_API_KEY: 'k' });
    expect(c?.projectId).toBe('p1');
  });
  it('normalises a \\n-escaped private_key', () => {
    const escaped = JSON.stringify({ ...keyFile, private_key: pem.replace(/\n/g, '\\n') });
    expect(googleConfigFromEnv({ GOOGLE_SA_JSON: escaped, GOOGLE_MAPS_API_KEY: 'k' })!.saPrivateKey.split('\n')[0]).toBe('-----BEGIN PRIVATE KEY-----');
  });
  it('still accepts the old three variables', () => {
    const c = googleConfigFromEnv({ GOOGLE_SA_EMAIL: 'a@b', GOOGLE_SA_PRIVATE_KEY: pem, GOOGLE_PROJECT_ID: 'old', GOOGLE_MAPS_API_KEY: 'k' });
    expect(c?.projectId).toBe('old');
  });
  it('GOOGLE_SA_JSON wins when both are set', () => {
    const c = googleConfigFromEnv({ GOOGLE_SA_JSON: json, GOOGLE_SA_EMAIL: 'a@b', GOOGLE_SA_PRIVATE_KEY: pem, GOOGLE_PROJECT_ID: 'old', GOOGLE_MAPS_API_KEY: 'k' });
    expect(c?.projectId).toBe('p1');
  });
  it('returns null without GOOGLE_MAPS_API_KEY, or with invalid JSON and no old vars', () => {
    expect(googleConfigFromEnv({ GOOGLE_SA_JSON: json })).toBeNull();
    expect(googleConfigFromEnv({ GOOGLE_SA_JSON: '{bad', GOOGLE_MAPS_API_KEY: 'k' })).toBeNull();
    expect(googleConfigFromEnv({ GOOGLE_SA_JSON: JSON.stringify({ project_id: 'p' }), GOOGLE_MAPS_API_KEY: 'k' })).toBeNull();
  });
});

describe('googleConfigStatus', () => {
  it('off when nothing is set', () => expect(googleConfigStatus({})).toEqual({ state: 'off', missing: [] }));
  it('on with the two new values', () => expect(googleConfigStatus({ GOOGLE_SA_JSON: json, GOOGLE_MAPS_API_KEY: 'k' }).state).toBe('on'));
  it('partial: bad JSON', () => {
    expect(googleConfigStatus({ GOOGLE_SA_JSON: '{bad', GOOGLE_MAPS_API_KEY: 'k' })).toEqual({
      state: 'partial', missing: ['GOOGLE_SA_JSON (not a valid key file. Paste the whole key file again.)'] });
  });
  it('partial: key file present, API key missing', () => {
    expect(googleConfigStatus({ GOOGLE_SA_JSON: json })).toEqual({ state: 'partial', missing: ['GOOGLE_MAPS_API_KEY'] });
  });
  it('partial: only the API key', () => {
    expect(googleConfigStatus({ GOOGLE_MAPS_API_KEY: 'k' })).toEqual({ state: 'partial', missing: ['GOOGLE_SA_JSON'] });
  });
  it('partial: old form with one var missing names it', () => {
    expect(googleConfigStatus({ GOOGLE_SA_EMAIL: 'a', GOOGLE_PROJECT_ID: 'p', GOOGLE_MAPS_API_KEY: 'k' }).missing).toEqual(['GOOGLE_SA_PRIVATE_KEY']);
  });
  it('status text', () => {
    expect(googleStatusText({ state: 'on', missing: [] })).toBe('Google: connected.');
    expect(googleStatusText({ state: 'off', missing: [] })).toBe('Google: not set up. Bus uses test routes.');
    expect(googleStatusText({ state: 'partial', missing: ['A', 'B'] })).toBe('Google: part set up. Missing: A, B.');
  });
});

describe('googleRoutingEnabled', () => {
  it('true with GOOGLE_SA_JSON in supabase mode; memory mode still needs BUS_ROUTING=google', () => {
    expect(googleRoutingEnabled({ PERSISTENCE: 'supabase', GOOGLE_SA_JSON: json, GOOGLE_MAPS_API_KEY: 'k' })).toBe(true);
    expect(googleRoutingEnabled({ PERSISTENCE: 'memory', GOOGLE_SA_JSON: json, GOOGLE_MAPS_API_KEY: 'k' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/tests/google-config.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `google-config.ts` and rewire the provider**

`src/services/routing/google-config.ts`:

```ts
import { normalisePrivateKey, type GoogleConfig } from './google-routing-provider';

export interface GoogleConfigStatus { state: 'off' | 'partial' | 'on'; missing: string[] }
const BAD_JSON = 'GOOGLE_SA_JSON (not a valid key file. Paste the whole key file again.)';
const OLD = ['GOOGLE_SA_EMAIL', 'GOOGLE_SA_PRIVATE_KEY', 'GOOGLE_PROJECT_ID'] as const;

function parseKeyFile(raw: string | undefined): { saEmail: string; saPrivateKey: string; projectId: string } | null {
  if (!raw || !raw.trim()) return null;
  try {
    const j = JSON.parse(raw.trim()) as Record<string, unknown>;
    const email = j['client_email'], key = j['private_key'], project = j['project_id'];
    if (typeof email !== 'string' || typeof key !== 'string' || typeof project !== 'string' || !email || !key || !project) return null;
    return { saEmail: email, saPrivateKey: normalisePrivateKey(key), projectId: project };
  } catch { return null; }
}

/** The routing credentials, or null. GOOGLE_SA_JSON (when valid) wins over the old three vars. */
export function googleConfigFromEnv(e: NodeJS.ProcessEnv = process.env): GoogleConfig | null {
  const apiKey = e['GOOGLE_MAPS_API_KEY'];
  if (!apiKey) return null;
  const fromJson = parseKeyFile(e['GOOGLE_SA_JSON']);
  if (fromJson) return { apiKey, ...fromJson };
  const saEmail = e['GOOGLE_SA_EMAIL'], key = e['GOOGLE_SA_PRIVATE_KEY'], projectId = e['GOOGLE_PROJECT_ID'];
  if (saEmail && key && projectId) return { apiKey, saEmail, saPrivateKey: normalisePrivateKey(key), projectId };
  return null;
}

export function googleConfigStatus(e: NodeJS.ProcessEnv = process.env): GoogleConfigStatus {
  if (googleConfigFromEnv(e)) return { state: 'on', missing: [] };
  const hasJson = !!e['GOOGLE_SA_JSON']?.trim();
  const oldSet = OLD.filter((k) => !!e[k]);
  const hasKey = !!e['GOOGLE_MAPS_API_KEY'];
  if (!hasJson && oldSet.length === 0 && !hasKey) return { state: 'off', missing: [] };
  const missing: string[] = [];
  if (hasJson && !parseKeyFile(e['GOOGLE_SA_JSON'])) missing.push(BAD_JSON);
  else if (!hasJson && oldSet.length > 0) missing.push(...OLD.filter((k) => !e[k]));
  else if (!hasJson) missing.push('GOOGLE_SA_JSON');
  if (!hasKey) missing.push('GOOGLE_MAPS_API_KEY');
  return { state: 'partial', missing };
}

export function googleStatusText(s: GoogleConfigStatus): string {
  if (s.state === 'on') return 'Google: connected.';
  if (s.state === 'off') return 'Google: not set up. Bus uses test routes.';
  return `Google: part set up. Missing: ${s.missing.join(', ')}.`;
}
```

In `google-routing-provider.ts`, replace the bodies of `googleRoutingEnabled` and `routingFromEnv` (keep their doc comments, updated to say "GOOGLE_SA_JSON or the old three vars, plus GOOGLE_MAPS_API_KEY"):

```ts
export function googleRoutingEnabled(e: NodeJS.ProcessEnv = process.env): boolean {
  const memory = (e['PERSISTENCE'] ?? 'memory') === 'memory';
  return !!googleConfigFromEnv(e) && (!memory || e['BUS_ROUTING'] === 'google');
}

export function routingFromEnv(e: NodeJS.ProcessEnv = process.env): RoutingProvider {
  const memory = (e['PERSISTENCE'] ?? 'memory') === 'memory';
  const cfg = googleRoutingEnabled(e) ? googleConfigFromEnv(e) : null;
  if (!cfg) {
    if (!memory) {
      console.warn('[routing] Google env not set — Bus Ministry uses straight-line fake routes');
      return new FakeRoutingProvider({ suggest: false });
    }
    return new FakeRoutingProvider();
  }
  return new GoogleRoutingProvider(cfg);
}
```

Add `import { googleConfigFromEnv } from './google-config';` at the top. The circular import (`google-config` imports `normalisePrivateKey` and the type from the provider file) is safe because both are only used inside functions; if vitest reports `normalisePrivateKey is not a function`, move `normalisePrivateKey` + `describeKeyShape` into a new `src/services/routing/google-key.ts` and re-export them from the provider file.

- [ ] **Step 4: Run** `npx vitest run src/tests/google-config.test.ts src/tests/routing.google-transport.test.ts src/tests/routing.google-requests.test.ts` → PASS.

- [ ] **Step 5: Write failing check/classifier tests**

`src/tests/google-check.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { checkGoogleConnection, classifyGoogleError } from '../services/routing/google-check';

const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const cfg = { apiKey: 'AIzaSECRET', saEmail: 'a@p.iam.gserviceaccount.com', saPrivateKey: pem, projectId: 'p1' };
const errBody = (status: number, reason: string, message = 'msg') =>
  JSON.stringify({ error: { code: status, message, details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason }] } });

type Handler = (url: string) => { status: number; body: string };
function fakeFetch(h: Handler): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const { status, body } = h(String(input));
    return new Response(body, { status });
  }) as typeof fetch;
}
const okAll: Handler = (url) =>
  url.includes('oauth2') ? { status: 200, body: JSON.stringify({ access_token: 't', expires_in: 3600 }) }
  : url.includes('staticmap') ? { status: 200, body: 'PNG' }
  : { status: 200, body: '{}' };

describe('classifyGoogleError', () => {
  it('SERVICE_DISABLED names the API', () => {
    expect(classifyGoogleError('places', 403, errBody(403, 'SERVICE_DISABLED'), cfg.apiKey))
      .toBe('Places API (New) is off. In Google Cloud, open APIs & Services. Turn on Places API (New).');
  });
  it('IAM_PERMISSION_DENIED and any 403 on Route Optimization', () => {
    const t = 'The service account cannot use Route Optimization. In Google Cloud, give it the role Route Optimization Editor.';
    expect(classifyGoogleError('routeopt', 403, errBody(403, 'IAM_PERMISSION_DENIED'), cfg.apiKey)).toBe(t);
    expect(classifyGoogleError('routeopt', 403, '{}', cfg.apiKey)).toBe(t);
  });
  it('BILLING_DISABLED', () => {
    expect(classifyGoogleError('routes', 403, errBody(403, 'BILLING_DISABLED'), cfg.apiKey)).toBe('Billing is off for this Google project. Turn on billing.');
  });
  it('API_KEY_INVALID / API_KEY_SERVICE_BLOCKED', () => {
    const t = 'The API key is not valid, or its restrictions block this API. Check the key and its API restrictions.';
    expect(classifyGoogleError('places', 400, errBody(400, 'API_KEY_INVALID'), cfg.apiKey)).toBe(t);
    expect(classifyGoogleError('routes', 403, errBody(403, 'API_KEY_SERVICE_BLOCKED'), cfg.apiKey)).toBe(t);
  });
  it('Static Maps 403 by status alone', () => {
    expect(classifyGoogleError('staticmap', 403, 'The Google Maps Platform server rejected your request', cfg.apiKey))
      .toBe('Maps Static API is off, or the API key blocks it.');
  });
  it('other: echoes only error.message, with the key masked', () => {
    expect(classifyGoogleError('routes', 500, errBody(500, 'X', 'boom AIzaSECRET'), cfg.apiKey)).toBe('Google reported: boom ***.');
    expect(classifyGoogleError('routes', 500, 'not json AIzaSECRET', cfg.apiKey)).toBe('Google reported: error 500.');
  });
});

describe('checkGoogleConnection', () => {
  it('five OK rows when everything answers', async () => {
    const rows = await checkGoogleConnection(cfg, fakeFetch(okAll));
    expect(rows.map((r) => [r.id, r.ok])).toEqual([['signin', true], ['routeopt', true], ['places', true], ['routes', true], ['staticmap', true]]);
  });
  it('sign-in failure marks Route Optimization as not tested', async () => {
    const rows = await checkGoogleConnection(cfg, fakeFetch((u) => u.includes('oauth2') ? { status: 400, body: '{"error":"invalid_grant"}' } : okAll(u)));
    expect(rows[0]).toMatchObject({ id: 'signin', ok: false });
    expect(rows[1]).toMatchObject({ id: 'routeopt', ok: false, fix: 'Fix Sign-in first.' });
    expect(rows[2]!.ok).toBe(true);
  });
  it('sends VALIDATE_ONLY to Route Optimization and never puts the key in a fix', async () => {
    let roBody = '';
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('optimizeTours')) { roBody = String(init?.body); return new Response(errBody(403, 'SERVICE_DISABLED', 'AIzaSECRET'), { status: 403 }); }
      const r = okAll(url); return new Response(r.body, { status: r.status });
    }) as typeof fetch;
    const rows = await checkGoogleConnection(cfg, f);
    expect(JSON.parse(roBody).solvingMode).toBe('VALIDATE_ONLY');
    expect(JSON.stringify(rows)).not.toContain('AIzaSECRET');
  });
});
```

- [ ] **Step 6: Run** `npx vitest run src/tests/google-check.test.ts` → FAIL (module not found).

- [ ] **Step 7: Implement `google-check.ts`**

```ts
import { signJwt, describeKeyShape, type GoogleConfig } from './google-routing-provider';

export type GoogleApiName = 'signin' | 'routeopt' | 'places' | 'routes' | 'staticmap';
export interface GoogleCheckRow { id: GoogleApiName; label: string; ok: boolean; fix?: string }

const API_TITLE: Record<GoogleApiName, string> = {
  signin: 'Sign-in', routeopt: 'Route Optimization API', places: 'Places API (New)', routes: 'Routes API', staticmap: 'Maps Static API',
};
const ROW_LABEL: Record<GoogleApiName, string> = {
  signin: 'Sign-in', routeopt: 'Route Optimization', places: 'Places', routes: 'Routes', staticmap: 'Static Maps',
};
const TIMEOUT_MS = 6_000; // sign-in + route opt run in sequence, then a parallel batch: <= 18 s < the 20 s route timeout
const PT = { latitude: -27.4698, longitude: 153.0251 }; // any fixed point; no rider data is ever sent

export function classifyGoogleError(api: GoogleApiName, status: number, bodyText: string, apiKey: string): string {
  if (api === 'staticmap' && status === 403) return 'Maps Static API is off, or the API key blocks it.';
  let reasons: string[] = [];
  let message = '';
  try {
    const j = JSON.parse(bodyText) as { error?: { message?: string; details?: { reason?: string }[] } };
    reasons = (j.error?.details ?? []).map((d) => d.reason ?? '').filter(Boolean);
    message = j.error?.message ?? '';
  } catch { /* not JSON */ }
  if (reasons.includes('SERVICE_DISABLED'))
    return `${API_TITLE[api]} is off. In Google Cloud, open APIs & Services. Turn on ${API_TITLE[api]}.`;
  if (reasons.includes('BILLING_DISABLED')) return 'Billing is off for this Google project. Turn on billing.';
  if (reasons.includes('API_KEY_INVALID') || reasons.includes('API_KEY_SERVICE_BLOCKED'))
    return 'The API key is not valid, or its restrictions block this API. Check the key and its API restrictions.';
  if (api === 'routeopt' && (reasons.includes('IAM_PERMISSION_DENIED') || status === 403))
    return 'The service account cannot use Route Optimization. In Google Cloud, give it the role Route Optimization Editor.';
  const safe = message ? message.split(apiKey).join('***').slice(0, 200) : `error ${status}`;
  return `Google reported: ${safe.replace(/\.$/, '')}.`;
}

async function attempt(fetchFn: typeof fetch, url: string, init: RequestInit): Promise<{ status: number; text: string } | 'unreachable'> {
  try {
    const res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return { status: res.status, text: res.ok ? '' : await res.text().catch(() => '') };
  } catch { return 'unreachable'; }
}

export async function checkGoogleConnection(cfg: GoogleConfig, fetchFn: typeof fetch = (i, n) => fetch(i, n), now: () => number = Date.now): Promise<GoogleCheckRow[]> {
  const row = (id: GoogleApiName, ok: boolean, fix?: string): GoogleCheckRow => ({ id, label: ROW_LABEL[id], ok, ...(fix ? { fix } : {}) });
  const result = async (id: GoogleApiName, url: string, init: RequestInit) => {
    const r = await attempt(fetchFn, url, init);
    if (r === 'unreachable') return row(id, false, 'Google did not answer. Try again later.');
    return r.status >= 200 && r.status < 300 ? row(id, true) : row(id, false, classifyGoogleError(id, r.status, r.text, cfg.apiKey));
  };

  // Build the VALIDATE_ONLY body from the real request builder so Google sees the same model shape as Generate.
  // Implementer: read optimizeToursBody()'s SolveProblem type in google-requests.ts / routing-provider.ts and build the
  // smallest valid 1-vehicle, 1-stop problem using two dummy place ids mapped to PT through a ResolvedPlaces map
  // (the same mechanism withBadPlaceIdRetry uses), so the body carries lat/lng only. Then:
  //   const validateOnlyBody = () => ({ ...optimizeToursBody(problem, resolved), solvingMode: 'VALIDATE_ONLY' });
  // Add a unit test asserting the body has solvingMode VALIDATE_ONLY and model.vehicles.length === 1.

  // 1. Sign-in
  let token: string | null = null;
  let signin: GoogleCheckRow;
  let assertion: string | null = null;
  try { assertion = signJwt(cfg.saEmail, cfg.saPrivateKey, Math.floor(now() / 1000)); }
  catch {
    console.error(`[google-check] signJwt failed — key shape: ${describeKeyShape(cfg.saPrivateKey)}`);
    signin = row('signin', false, 'The key file is not valid. Paste the whole key file again as GOOGLE_SA_JSON.');
  }
  if (assertion) {
    try {
      const res = await fetchFn('https://oauth2.googleapis.com/token', { method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString() });
      if (res.ok) { token = ((await res.json()) as { access_token: string }).access_token; signin = row('signin', true); }
      else signin = row('signin', false, 'Google did not accept the key. Make a new key with the setup command.');
    } catch { signin = row('signin', false, 'Google did not answer. Try again later.'); }
  }

  // 2. Route Optimization — VALIDATE_ONLY is not billed
  const routeopt = token
    ? await result('routeopt', `https://routeoptimization.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}:optimizeTours`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(validateOnlyBody()) })
    : row('routeopt', false, 'Fix Sign-in first.');

  // 3–5 use the API key
  const [places, routes, staticmap] = await Promise.all([
    result('places', 'https://places.googleapis.com/v1/places:autocomplete', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': cfg.apiKey, 'X-Goog-FieldMask': 'suggestions.placePrediction.placeId' },
      body: JSON.stringify({ input: 'Brisbane', includedRegionCodes: ['au'] }) }),
    result('routes', 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': cfg.apiKey, 'X-Goog-FieldMask': 'originIndex,destinationIndex,condition' },
      body: JSON.stringify({ origins: [{ waypoint: { location: { latLng: PT } } }], destinations: [{ waypoint: { location: { latLng: PT } } }] }) }),
    result('staticmap', `https://maps.googleapis.com/maps/api/staticmap?size=1x1&center=${PT.latitude},${PT.longitude}&zoom=1&key=${encodeURIComponent(cfg.apiKey)}`, { method: 'GET' }),
  ]);
  return [signin!, routeopt, places, routes, staticmap];
}
```

- [ ] **Step 8: Run** `npx vitest run src/tests/google-check.test.ts src/tests/google-config.test.ts` → PASS. Then the full gate: `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js` → all PASS.

(The `/bus/google-check` route and its rate limit are wired in Task 3, which owns the setup controller.)

---

### Task 3: Start without secrets, first admin, setup checklist API, health (spec §3, §4.1, §4.2, §4.4)

**Files:**
- Create: `src/services/setup.service.ts`, `src/api/controllers/setup.controller.ts`, `src/utils/cached-probe.ts`, `src/tests/setup.service.test.ts`, `src/tests/setup.routes.test.ts`, `src/tests/auth.no-secret.test.ts`, `src/tests/cached-probe.test.ts`
- Modify: `src/services/auth.service.ts`, `src/utils/field-crypto.ts`, `src/repositories/interfaces/entity-repositories.ts`, `src/repositories/in-memory/in-memory.repositories.ts`, `src/repositories/supabase/supabase.users.ts`, `src/services/account.service.ts` (export `CreateUserSchema`), `src/api/http/types.ts`, `src/api/http/express-adapter.ts`, `src/api/http/router.ts`, `src/api/controllers/settings.controller.ts`, `src/api/controllers/bus.controller.ts`, `src/core/errors/app-error.ts`, `src/container.ts`, `src/app.ts`, `api/index.ts`, `vercel.json`, `public/sw.js` (API_RE only; the CACHE bump happens once in Task 4)
- Test harness (no supertest in this repo): copy the pattern of `src/tests/http.raw-response.test.ts` — `const { services } = await buildContainer();` (memory mode does NOT seed; `seedDemoData` runs only in `createAppInstance`, so the user repo is empty), `const app = createApp(buildRoutes(services), services.auth, services.health)`, `const server = app.listen(0)`, call it with `fetch`, close the server in `afterAll`. For a grade user (case 8): `services.users.save({...})` a `role:'grade'` user, then `services.auth.issueTokenFor(id)` for its token.

**Interfaces:**
- Consumes: `LATEST_MIGRATION` (Task 1); `googleConfigStatus`, `googleStatusText`, `googleConfigFromEnv`, `checkGoogleConnection` (Task 2).
- Produces (HTTP, used by Task 4):
  - `GET /settings` → existing settings object **plus** `needsAdmin: boolean`.
  - `GET /setup/status` → `{ needsAdmin: boolean, checks: SetupCheck[] }`, `SetupCheck = { id: string; label: string; state: 'ok'|'fix'|'optional'; fix?: string; generate?: 'hex32'|'base64key'|'setupCode'; link?: string }`.
  - `POST /setup/admin` body `{ code, displayName, password }` → `{ token, user }` (same shape as `/auth/login`).
  - `POST /bus/google-check` → `{ rows: GoogleCheckRow[] }` (admin only, once per 10 s).
  - `GET /bus/run` → adds `google: { state, missing, text }` **only for role `admin`**.
  - `GET /health` → `{ status:'ok', ts, db:'ok'|'down', schema:{ current: string|null, expected: string } }`.
- Produces (TS): `IUserRepository.countActiveAdmins(): Promise<number>`, `IUserRepository.createFirstAdmin(user: User): Promise<User | null>`; `sessionSecretConfigured(): boolean`; `isEncryptionKeyValid(): boolean`; `codeMatches(input: string, expected: string): boolean`; `makeSetupService(deps): SetupService`.

- [ ] **Step 1: Failing tests — auth without SESSION_SECRET, key validity, cached probe**

`src/tests/auth.no-secret.test.ts` (uses `vi.resetModules()` because the secret is read per call but the module reads env at import in old code):

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('auth without SESSION_SECRET in production', () => {
  const saved = { ...process.env };
  beforeEach(() => { vi.resetModules(); process.env['NODE_ENV'] = 'production'; delete process.env['SESSION_SECRET']; });
  afterEach(() => { process.env = { ...saved }; });

  it('the module loads (no throw at import)', async () => {
    await expect(import('../services/auth.service')).resolves.toBeDefined();
  });
  it('sessionSecretConfigured() is false; resolveToken returns null; issuing a token throws a clear error', async () => {
    const { makeAuthService, sessionSecretConfigured } = await import('../services/auth.service');
    const { InMemoryUserRepository } = await import('../repositories/in-memory/in-memory.repositories');
    const auth = makeAuthService(new InMemoryUserRepository());
    expect(sessionSecretConfigured()).toBe(false);
    expect(await auth.resolveToken('abc.def')).toBeNull();
    await expect(auth.login({ email: 'admin', password: 'whatever1' })).rejects.toThrow(/SESSION_SECRET/);
  });
  it('a 32+ char secret is configured', async () => {
    process.env['SESSION_SECRET'] = 'x'.repeat(32);
    const { sessionSecretConfigured } = await import('../services/auth.service');
    expect(sessionSecretConfigured()).toBe(true);
  });
});
```

Note for the implementer: `login` must hit the secret check even for an unknown user, so check `sessionSecretConfigured()` at the top of `login` (before the user lookup) and throw `new SetupIncompleteError('The app is missing SESSION_SECRET. In Vercel, add SESSION_SECRET. Then redeploy.')`. Add `SetupIncompleteError extends AppError` (`'SETUP_INCOMPLETE'`, 503) and `TooManyRequestsError extends AppError` (`'RATE_LIMITED'`, 429) to `app-error.ts`.

Add to `src/tests/field-crypto.test.ts`:

```ts
import { isEncryptionKeyValid } from '../utils/field-crypto';
describe('isEncryptionKeyValid', () => {
  let saved: string | undefined;
  beforeEach(() => { saved = process.env['FIELD_ENCRYPTION_KEY']; });
  afterEach(() => { if (saved === undefined) delete process.env['FIELD_ENCRYPTION_KEY']; else process.env['FIELD_ENCRYPTION_KEY'] = saved; });
  it('true for base64 of 32 bytes', () => { process.env['FIELD_ENCRYPTION_KEY'] = Buffer.alloc(32, 7).toString('base64'); expect(isEncryptionKeyValid()).toBe(true); });
  it('false when missing, short, or garbage — never throws', () => {
    delete process.env['FIELD_ENCRYPTION_KEY']; expect(isEncryptionKeyValid()).toBe(false);
    process.env['FIELD_ENCRYPTION_KEY'] = Buffer.alloc(16).toString('base64'); expect(isEncryptionKeyValid()).toBe(false);
    process.env['FIELD_ENCRYPTION_KEY'] = '%%%not base64%%%'; expect(isEncryptionKeyValid()).toBe(false);
  });
});
```

(Append this describe at the END of the file; merge the import into the existing imports; add `beforeEach`/`afterEach` to its vitest import if absent. Also add a case passing an explicit env object: `isEncryptionKeyValid({ FIELD_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64') })` → true.)

`src/tests/cached-probe.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { cachedProbe } from '../utils/cached-probe';

describe('cachedProbe', () => {
  it('calls the probe at most once per 30 s', async () => {
    let calls = 0; let t = 0;
    const p = cachedProbe(async () => { calls++; return 'ok' as const; }, 30_000, () => t);
    await p(); await p(); t = 29_999; await p();
    expect(calls).toBe(1);
    t = 30_001; await p();
    expect(calls).toBe(2);
  });
  it('shares one in-flight call', async () => {
    let calls = 0;
    const p = cachedProbe(async () => { calls++; await new Promise((r) => setTimeout(r, 5)); return 1; }, 30_000);
    await Promise.all([p(), p(), p()]);
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run** these three test files → FAIL.

- [ ] **Step 3: Implement**

`src/services/auth.service.ts` — delete the module-level `SESSION_SECRET` const and the import-time `throw`. Add:

```ts
function rawSecret(): string { return process.env['SESSION_SECRET'] ?? INSECURE_FALLBACK; }

/** True when a session secret is usable. In production a missing secret is never usable (fail closed).
 *  Same rule as the old import-time check: set and not the fallback. The >= 32 rule lives ONLY in the
 *  setup checklist row, never here — a shorter existing secret must not lock out a live deployment. */
export function sessionSecretConfigured(env: Record<string, string | undefined> = process.env): boolean {
  const s = env['SESSION_SECRET'];
  if (!s || s === INSECURE_FALLBACK) return env['NODE_ENV'] !== 'production';
  return true;
}

function secretOrThrow(): string {
  if (!sessionSecretConfigured()) {
    throw new SetupIncompleteError('The app is missing SESSION_SECRET. In Vercel, add SESSION_SECRET. Then redeploy.');
  }
  return rawSecret();
}
```

`signSession` uses `secretOrThrow()`; `parseSession` starts with `if (!sessionSecretConfigured()) return null;` and uses `rawSecret()`. `login` calls `secretOrThrow()` as its first line. Keep the existing comment explaining fail-closed, moved above `sessionSecretConfigured`.

Note: if Citipointe's existing `SESSION_SECRET` is shorter than 32 characters, only its System check row shows `fix`; logins keep working.

`src/utils/field-crypto.ts`:

```ts
/** Pure check for the setup checklist: FIELD_ENCRYPTION_KEY is base64 that decodes to 32 bytes. Never throws. */
export function isEncryptionKeyValid(env: Record<string, string | undefined> = process.env): boolean {
  const v = env['FIELD_ENCRYPTION_KEY'];
  if (!v || !/^[A-Za-z0-9+/]+={0,2}$/.test(v.trim())) return false;
  try { return Buffer.from(v.trim(), 'base64').length === KEY_LEN; } catch { return false; }
}
```

`src/utils/cached-probe.ts`:

```ts
/** Wraps an async probe so it runs at most once per `ttlMs` per instance; concurrent callers share one call. */
export function cachedProbe<T>(probe: () => Promise<T>, ttlMs: number, now: () => number = Date.now): () => Promise<T> {
  let value: { v: T; at: number } | null = null;
  let inflight: Promise<T> | null = null;
  return async () => {
    if (value && now() - value.at < ttlMs) return value.v;
    if (inflight) return inflight;
    inflight = probe().then((v) => { value = { v, at: now() }; return v; }).finally(() => { inflight = null; });
    return inflight;
  };
}
```

- [ ] **Step 4: Run** the three files → PASS.

- [ ] **Step 5: Failing setup-service tests**

`src/tests/setup.service.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { InMemoryUserRepository } from '../repositories/in-memory/in-memory.repositories';
import { makeSetupService, codeMatches } from '../services/setup.service';
import type { AuthService } from '../services/auth.service';

const fakeAuth = { issueTokenFor: vi.fn(async (id: string) => `tok-${id}`) } as unknown as AuthService;
const good = { PERSISTENCE: 'supabase', DATABASE_URL: 'postgresql://u:p@h.example.com:5432/postgres', SESSION_SECRET: 's'.repeat(64),
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'), APP_ORIGIN: 'https://church.vercel.app', SETUP_CODE: 'ABCD-EFGH-JKMN-PQRS-TUVW' };

function svc(env: Record<string, string | undefined> = good, over: Partial<Parameters<typeof makeSetupService>[0]> = {}) {
  const users = new InMemoryUserRepository();
  const s = makeSetupService({ users, auth: fakeAuth, env, probeDb: async () => true, schemaVersion: async () => '0015', ...over });
  return { s, users };
}
const byId = (checks: { id: string }[], id: string) => checks.find((c) => c.id === id) as any;

describe('codeMatches', () => {
  it('ignores spaces, dashes and case', () => {
    expect(codeMatches(' abcd-efgh-jkmn-pqrs-tuvw ', 'ABCD-EFGH-JKMN-PQRS-TUVW')).toBe(true);
    expect(codeMatches('ABCDEFGHJKMNPQRSTUVW', 'ABCD-EFGH-JKMN-PQRS-TUVW')).toBe(true);
    expect(codeMatches('ABCD-EFGH-JKMN-PQRS-TUVX', 'ABCD-EFGH-JKMN-PQRS-TUVW')).toBe(false);
  });
});

describe('needsAdmin', () => {
  it('true with no users, false once an active admin exists, true when the DB throws', async () => {
    const { s } = svc();
    expect(await s.needsAdmin()).toBe(true);
    await s.createFirstAdmin({ code: good.SETUP_CODE, displayName: 'Pat', password: 'longenough' });
    expect(await s.needsAdmin()).toBe(false);
    const broken = new InMemoryUserRepository();
    broken.countActiveAdmins = async () => { throw new Error('down'); };
    expect(await makeSetupService({ users: broken, auth: fakeAuth, env: good, probeDb: async () => false, schemaVersion: async () => null }).needsAdmin()).toBe(true);
  });
});

describe('createFirstAdmin', () => {
  it('creates username admin and returns { token, user } without a password hash', async () => {
    const { s, users } = svc();
    const r = await s.createFirstAdmin({ code: good.SETUP_CODE, displayName: '', password: 'longenough' });
    expect(r.token).toMatch(/^tok-/);
    expect(r.user).toMatchObject({ email: 'admin', role: 'admin', displayName: 'Admin', mustChangePassword: false, status: 'active' });
    expect((r.user as any).passwordHash).toBeUndefined();
    expect((await users.findByEmail('admin'))!.grade).toBeNull();
  });
  it('409 when an admin exists', async () => {
    const { s } = svc();
    await s.createFirstAdmin({ code: good.SETUP_CODE, displayName: 'A', password: 'longenough' });
    await expect(s.createFirstAdmin({ code: good.SETUP_CODE, displayName: 'B', password: 'longenough' }))
      .rejects.toMatchObject({ statusCode: 409, message: 'An admin already exists. Log in.' });
  });
  it('concurrent second call → exactly one admin, the other 409', async () => {
    const { s, users } = svc();
    const res = await Promise.allSettled([
      s.createFirstAdmin({ code: good.SETUP_CODE, displayName: 'A', password: 'longenough' }),
      s.createFirstAdmin({ code: good.SETUP_CODE, displayName: 'B', password: 'longenough' }),
    ]);
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await users.findByRole('admin'))).toHaveLength(1);
  });
  it('400 when SETUP_CODE is missing or short', async () => {
    for (const code of [undefined, 'short-code']) {
      const { s } = svc({ ...good, SETUP_CODE: code });
      await expect(s.createFirstAdmin({ code: 'anything', displayName: 'A', password: 'longenough' })).rejects.toMatchObject({
        statusCode: 400, message: 'SETUP_CODE is missing or too short. In Vercel, add a SETUP_CODE of 16 or more characters. Then redeploy.' });
    }
  });
  it('403 on a wrong code', async () => {
    const { s } = svc();
    await expect(s.createFirstAdmin({ code: 'WRONG-WRONG-WRONG-WRON', displayName: 'A', password: 'longenough' })).rejects.toMatchObject({
      statusCode: 403, message: 'The setup code is wrong. In Vercel, open Settings > Environment Variables. Copy SETUP_CODE again.' });
  });
  it('rejects a short password with the existing validation', async () => {
    const { s } = svc();
    await expect(s.createFirstAdmin({ code: good.SETUP_CODE, displayName: 'A', password: 'short' })).rejects.toThrow();
  });
  it('400 when SESSION_SECRET is not usable (no admin is created)', async () => {
    const { s, users } = svc({ ...good, SESSION_SECRET: undefined, NODE_ENV: 'production' }, { sessionSecretOk: () => false });
    await expect(s.createFirstAdmin({ code: good.SETUP_CODE, displayName: 'A', password: 'longenough' })).rejects.toMatchObject({ statusCode: 400 });
    expect(await users.findByEmail('admin')).toBeNull();
  });
});

describe('status', () => {
  const ids = ['persistence', 'database', 'databasePort', 'schema', 'sessionSecret', 'encryptionKey', 'appOrigin', 'setupCode', 'google'];
  it('all ok rows, in order, while needsAdmin', async () => {
    const { s } = svc();
    const r = await s.status(null, 'https://church.vercel.app');
    expect(r.needsAdmin).toBe(true);
    expect(r.checks.map((c) => c.id)).toEqual(ids);
    expect(r.checks.filter((c) => c.id !== 'google').every((c) => c.state === 'ok')).toBe(true);
    expect(byId(r.checks, 'google').state).toBe('optional');
  });
  it('never returns env values or the DB host', async () => {
    const { s } = svc();
    const text = JSON.stringify(await s.status(null, 'https://church.vercel.app'));
    for (const v of [good.SESSION_SECRET, good.FIELD_ENCRYPTION_KEY, good.SETUP_CODE, 'h.example.com', good.DATABASE_URL]) expect(text).not.toContain(v);
  });
  it('fix rows with generate hints', async () => {
    const { s } = svc({ PERSISTENCE: 'memory' }, { probeDb: async () => false, schemaVersion: async () => null });
    const r = await s.status(null, 'https://church.vercel.app');
    expect(byId(r.checks, 'persistence')).toMatchObject({ state: 'fix', fix: 'In Vercel, set PERSISTENCE to supabase. Then redeploy.' });
    expect(byId(r.checks, 'database').state).toBe('fix');
    expect(byId(r.checks, 'schema').state).toBe('fix');
    expect(byId(r.checks, 'sessionSecret')).toMatchObject({ state: 'fix', generate: 'hex32' });
    expect(byId(r.checks, 'encryptionKey')).toMatchObject({ state: 'fix', generate: 'base64key' });
    expect(byId(r.checks, 'encryptionKey').fix).toContain('WARNING: Save this key in a safe place.');
    expect(byId(r.checks, 'setupCode')).toMatchObject({ state: 'fix', generate: 'setupCode' });
    expect(byId(r.checks, 'appOrigin').fix).toBe('In Vercel, set APP_ORIGIN to https://church.vercel.app. Then redeploy.');
  });
  it('databasePort: empty port and query string are ok; 6543 and garbage are fix', async () => {
    const port = async (url: string | undefined) => byId((await svc({ ...good, DATABASE_URL: url }).s.status(null, 'https://church.vercel.app')).checks, 'databasePort').state;
    expect(await port('postgresql://u:p@h/postgres')).toBe('ok');
    expect(await port('postgresql://u:p@h:5432/postgres?pgbouncer=true')).toBe('ok');
    expect(await port('postgresql://u:p@h:6543/postgres')).toBe('fix');
    expect(await port('not a url')).toBe('fix');
    expect(await port(undefined)).toBe('fix');
  });
  it('appOrigin ignores case and a trailing slash', async () => {
    const st = async (appOrigin: string, req: string) => byId((await svc({ ...good, APP_ORIGIN: appOrigin }).s.status(null, req)).checks, 'appOrigin').state;
    expect(await st('https://Church.vercel.app/', 'https://church.vercel.app')).toBe('ok');
    expect(await st('https://church.vercel.app', 'https://other.vercel.app')).toBe('fix');
  });
  it('setupCode row only while needsAdmin; then admin-only access', async () => {
    const { s } = svc();
    await s.createFirstAdmin({ code: good.SETUP_CODE, displayName: 'A', password: 'longenough' });
    await expect(s.status(null, 'https://church.vercel.app')).rejects.toMatchObject({ statusCode: 401 });
    const grade = { id: 'g', role: 'grade' } as any;
    await expect(s.status(grade, 'https://church.vercel.app')).rejects.toMatchObject({ statusCode: 403 });
    const admin = { id: 'a', role: 'admin' } as any;
    const r = await s.status(admin, 'https://church.vercel.app');
    expect(r.needsAdmin).toBe(false);
    expect(r.checks.map((c) => c.id)).not.toContain('setupCode');
  });
  it('public when the DB is down (needsAdmin cannot be determined)', async () => {
    const users = new InMemoryUserRepository();
    users.countActiveAdmins = async () => { throw new Error('down'); };
    const s = makeSetupService({ users, auth: fakeAuth, env: good, probeDb: async () => false, schemaVersion: async () => null });
    const r = await s.status(null, 'https://church.vercel.app');
    expect(r.needsAdmin).toBe(true);
    expect(byId(r.checks, 'database').state).toBe('fix');
  });
  it('google row text', async () => {
    const r = await svc().s.status(null, 'https://church.vercel.app');
    expect(byId(r.checks, 'google')).toMatchObject({ state: 'optional', label: 'Google: not set up. Bus uses test routes.' });
  });
});
```

- [ ] **Step 6: Run** → FAIL.

- [ ] **Step 7: Implement repos + setup service**

`entity-repositories.ts` — extend `IUserRepository`:

```ts
  /** Active users with role admin. */
  countActiveAdmins(): Promise<number>;
  /** Inserts `user` only if no active admin exists (race-safe). Returns null when one already exists. */
  createFirstAdmin(user: User): Promise<User | null>;
```

`InMemoryUserRepository`:

```ts
  async countActiveAdmins(): Promise<number> {
    return Array.from(this.store.values()).filter((u) => u.role === 'admin' && u.status === 'active').length;
  }

  // Synchronous check-and-insert: no await between the check and the store write, so two
  // concurrent calls cannot both pass the check.
  async createFirstAdmin(user: User): Promise<User | null> {
    const exists = Array.from(this.store.values()).some((u) => (u.role === 'admin' && u.status === 'active') || u.email.toLowerCase() === user.email.toLowerCase());
    if (exists) return null;
    return this.save(user);
  }
```

Implementer: confirm `InMemoryBaseRepository.save` writes to `this.store` before its first `await` (read `in-memory.base.repository.ts`). If it awaits persistence before writing, write `this.store.set(user.id, this.clone(user))` directly, then call `save` for persistence.

`SupabaseUserRepository`:

```ts
  async countActiveAdmins(): Promise<number> {
    const [r] = await this.sql<{ n: number }[]>`select count(*)::int as n from users where role = 'admin' and status = 'active'`;
    return r?.n ?? 0;
  }

  async createFirstAdmin(user: User): Promise<User | null> {
    try {
      return await this.sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(7201010002)`;
        const rows = await tx`
          insert into users (id, display_name, email, role, grade, grades, gender, quad, leader_id, status, password_hash,
                             must_change_password, login_history, login_devices, created_at, updated_at)
          select ${user.id}, ${user.displayName}, ${user.email}, 'admin', null, null, null, null, null, 'active', ${user.passwordHash ?? null},
                 false, ${tx.json([])}, ${tx.json([])}, ${user.createdAt}, ${user.updatedAt}
          where not exists (select 1 from users where role = 'admin' and status = 'active')
          returning *`;
        return rows[0] ? toUser(rows[0]) : null;
      });
    } catch (err) {
      // users.email is unique: an inactive 'admin' row also means "an admin exists".
      if ((err as { code?: string }).code === '23505') return null;
      throw err;
    }
  }
```

(Match the column list to `save()`; if `tx.json` typing complains, use the same cast pattern as `save()`.)

Export `CreateUserSchema` from `account.service.ts` (`export const CreateUserSchema = …`).

`src/services/setup.service.ts`:

```ts
import { createHash, timingSafeEqual } from 'node:crypto';
import type { IUserRepository } from '../repositories/interfaces/entity-repositories';
import type { Actor, User, SafeUser } from '../core/entities/user';
import { AuthService, sessionSecretConfigured, toSafeUser } from './auth.service';
import { CreateUserSchema } from './account.service';
import { can } from './access-control';
import { hashPassword } from '../utils/crypto';
import { generateId } from '../utils/id';
import { isEncryptionKeyValid } from '../utils/field-crypto';
import { LATEST_MIGRATION } from '../core/schema-version';
import { googleConfigStatus, googleStatusText } from './routing/google-config';
import { BadRequestError, ConflictError, ForbiddenError, UnauthorizedError } from '../core/errors/app-error';

export interface SetupCheck {
  id: string; label: string; state: 'ok' | 'fix' | 'optional';
  fix?: string; generate?: 'hex32' | 'base64key' | 'setupCode'; link?: string;
}
export interface SetupStatus { needsAdmin: boolean; checks: SetupCheck[] }
export interface SetupService {
  needsAdmin(): Promise<boolean>;
  status(actor: Actor | null, requestOrigin: string | undefined): Promise<SetupStatus>;
  createFirstAdmin(input: unknown): Promise<{ token: string; user: SafeUser }>;
}

const GUIDE_GOOGLE = 'https://github.com/citipointe-youth/ys-connection/blob/master/docs/GOOGLE-SETUP.md';
const norm = (s: string) => s.replace(/[\s-]/g, '').toUpperCase();
const digest = (s: string) => createHash('sha256').update(s).digest();
export function codeMatches(input: string, expected: string): boolean {
  return timingSafeEqual(digest(norm(input)), digest(norm(expected)));
}
const normOrigin = (s: string) => s.trim().replace(/\/+$/, '').toLowerCase();

export function makeSetupService(deps: {
  users: IUserRepository;
  auth: AuthService;
  env: Record<string, string | undefined>;
  /** `select 1` with a 3 s timeout; false on any error. */
  probeDb: () => Promise<boolean>;
  /** max(schema_migrations.version), or null when unknown. */
  schemaVersion: () => Promise<string | null>;
  sessionSecretOk?: () => boolean;
}): SetupService {
  const { users, auth, env } = deps;
  const secretOk = deps.sessionSecretOk ?? (() => sessionSecretConfigured(env));

  // Once an admin exists it stays so for this instance: cache the "false" so GET /settings
  // does not add a DB query to every page load. "true" is never cached.
  let adminSeen = false;
  async function needsAdmin(): Promise<boolean> {
    if (adminSeen) return false;
    try { const n = await users.countActiveAdmins(); if (n > 0) adminSeen = true; return n === 0; } catch { return true; }
  }

  return {
    needsAdmin,

    async status(actor, requestOrigin) {
      const needs = await needsAdmin();
      if (!needs) {
        if (!actor) throw new UnauthorizedError();
        if (!can(actor, 'admin:manage')) throw new ForbiddenError();
      }
      const ok = (id: string, label: string): SetupCheck => ({ id, label, state: 'ok' });
      const fix = (id: string, label: string, text: string, generate?: SetupCheck['generate']): SetupCheck =>
        ({ id, label, state: 'fix', fix: text, ...(generate ? { generate } : {}) });
      const url = env['DATABASE_URL'];
      let port: string | null = null;
      try { if (url) port = new URL(url).port || '5432'; } catch { port = null; }
      const [dbOk, version] = await Promise.all([deps.probeDb(), deps.schemaVersion().catch(() => null)]);
      const origin = requestOrigin ?? '';
      const checks: SetupCheck[] = [
        env['PERSISTENCE'] === 'supabase' ? ok('persistence', 'Storage') :
          fix('persistence', 'Storage', 'In Vercel, set PERSISTENCE to supabase. Then redeploy.'),
        dbOk ? ok('database', 'Database connection') :
          fix('database', 'Database connection', 'The app cannot reach the database. Copy the Session pooler connection string from Supabase again. Paste it as DATABASE_URL in Vercel. Then redeploy.'),
        port === '5432' ? ok('databasePort', 'Database port') :
          fix('databasePort', 'Database port', 'The connection string must use port 5432. Copy the Session pooler string. Do not use the Transaction pooler string (port 6543). Then redeploy.'),
        version === LATEST_MIGRATION ? ok('schema', 'Database version') :
          fix('schema', 'Database version', 'The database is not up to date. In Vercel, open Deployments. Select Redeploy on the top row.'),
        secretOk() && (env['SESSION_SECRET'] ?? '').length >= 32 ? ok('sessionSecret', 'SESSION_SECRET') :
          fix('sessionSecret', 'SESSION_SECRET', 'Select Generate. Select Copy. In Vercel, add the value as SESSION_SECRET. Then redeploy.', 'hex32'),
        isEncryptionKeyValid(env) ? ok('encryptionKey', 'FIELD_ENCRYPTION_KEY') :
          fix('encryptionKey', 'FIELD_ENCRYPTION_KEY', 'Select Generate. Select Copy. In Vercel, add the value as FIELD_ENCRYPTION_KEY. Then redeploy.\nWARNING: Save this key in a safe place. If you lose it, the app cannot read phone numbers. If the app already has data, do not replace this key.', 'base64key'),
        env['APP_ORIGIN'] && origin && normOrigin(env['APP_ORIGIN']) === normOrigin(origin) ? ok('appOrigin', 'APP_ORIGIN') :
          fix('appOrigin', 'APP_ORIGIN', `In Vercel, set APP_ORIGIN to ${normOrigin(origin) || 'the address of this page'}. Then redeploy.`),
      ];
      if (needs) {
        checks.push((env['SETUP_CODE'] ?? '').length >= 16 ? ok('setupCode', 'SETUP_CODE') :
          fix('setupCode', 'SETUP_CODE', 'Select Generate. Select Copy. In Vercel, add the value as SETUP_CODE. Then redeploy.', 'setupCode'));
      }
      checks.push({ id: 'google', label: googleStatusText(googleConfigStatus(env as NodeJS.ProcessEnv)), state: 'optional', link: GUIDE_GOOGLE });
      return { needsAdmin: needs, checks };
    },

    async createFirstAdmin(input) {
      const body = (input ?? {}) as { code?: unknown; displayName?: unknown; password?: unknown };
      if (!(await needsAdmin())) throw new ConflictError('An admin already exists. Log in.');
      const expected = env['SETUP_CODE'] ?? '';
      if (norm(expected).length < 16) throw new BadRequestError('SETUP_CODE is missing or too short. In Vercel, add a SETUP_CODE of 16 or more characters. Then redeploy.');
      if (typeof body.code !== 'string' || !codeMatches(body.code, expected))
        throw new ForbiddenError('The setup code is wrong. In Vercel, open Settings > Environment Variables. Copy SETUP_CODE again.');
      if (!secretOk()) throw new BadRequestError('The app is missing SESSION_SECRET. In Vercel, add SESSION_SECRET. Then redeploy.');
      const displayName = typeof body.displayName === 'string' && body.displayName.trim() ? body.displayName.trim() : 'Admin';
      const data = CreateUserSchema.parse({ displayName, email: 'admin', password: body.password, role: 'admin' });
      const now = new Date().toISOString();
      const user: User = {
        id: generateId(), displayName: data.displayName, email: 'admin', role: 'admin',
        grade: null, grades: null, gender: null, quad: null, leaderId: null,
        status: 'active', passwordHash: await hashPassword(data.password), mustChangePassword: false,
        createdAt: now, updatedAt: now,
      };
      const saved = await users.createFirstAdmin(user);
      if (!saved) throw new ConflictError('An admin already exists. Log in.');
      const token = await auth.issueTokenFor(saved.id);
      if (!token) throw new ConflictError('An admin already exists. Log in.');
      return { token, user: toSafeUser(saved) };
    },
  };
}
```

Implementer checks: (a) `ConflictError` is 409 and `ForbiddenError` 403 (yes, `app-error.ts`); (b) the `User` type may require `loginHistory`/`loginDevices` — add `loginHistory: [], loginDevices: []` if so; (c) the `'admin:manage'` action name matches `access-control.ts` (it does). `import { AuthService ...}` must be `import type` for the interface.

- [ ] **Step 8: Run** `npx vitest run src/tests/setup.service.test.ts` → PASS.

- [ ] **Step 9: Wire HTTP + container + start-up hardening**

`src/api/http/types.ts` — add to `HttpRequest`: `/** Request origin (scheme://host), from X-Forwarded-Host when present. */ origin?: string;`

`express-adapter.ts`:
1. In the route loop, set `origin: `${req.protocol}://${req.get('x-forwarded-host') ?? req.get('host') ?? ''}`` on `httpReq`.
2. Extend the login rate-limit block to also cover setup: `if ((route.path === '/auth/login' || route.path === '/setup/admin') && route.method === 'POST')`, keying `/setup/admin` as `` `setup:${ip}` `` (no email). Keep the 429 response; for `/setup/admin` use message `'Too many attempts. Wait 15 minutes. Then try again.'`.
3. Change `createApp(routes, authService)` to `createApp(routes, authService, health?: () => Promise<Record<string, unknown>>)` and the `/health` handler to:

```ts
  app.get('/health', async (_req: Request, res: Response) => {
    const extra = health ? await health().catch(() => ({ db: 'down' })) : {};
    res.json({ status: 'ok', ts: new Date().toISOString(), ...extra });
  });
```

`src/container.ts` — build the setup service and the probes (supabase only; memory mode uses constants):

```ts
  const probeDb = async (): Promise<boolean> => {
    if (!useSupabase) return true;
    try {
      await Promise.race([sql`select 1`, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))]);
      return true;
    } catch { return false; }
  };
  const schemaVersion = async (): Promise<string | null> => {
    if (!useSupabase) return LATEST_MIGRATION;
    try { const [r] = await sql<{ v: string | null }[]>`select max(version) as v from schema_migrations`; return r?.v ?? null; }
    catch { return null; }
  };
  const setup = makeSetupService({ users, auth, env: process.env, probeDb, schemaVersion });
```

Add `setup` (and `probeDb`, `schemaVersion` as `health` helpers, or a ready-made `health: () => Promise<…>`) to `Services`. Build `health` with `cachedProbe`:

```ts
  const health = cachedProbe(async () => {
    const [db, current] = await Promise.all([probeDb(), schemaVersion()]);
    return { db: db ? 'ok' : 'down', schema: { current, expected: LATEST_MIGRATION } };
  }, 30_000);
```

`src/app.ts`: `createApp(routes, container.services.auth, container.services.health)`. Also guard the seed — **addition beyond the spec, approved at plan time; owner to confirm at hand-off**: `if (env.PERSISTENCE === 'memory' && process.env['VERCEL_ENV'] !== 'production') await seedDemoData(...)`. Without it, a new location that forgets `PERSISTENCE` gets a public `admin`/`demo1234` login and no setup screen; with it, the app has zero users, `needsAdmin` is true, and the checklist's `persistence` row shows the fix. Add a route test: with `VERCEL_ENV=production` and memory mode, `createAppInstance()` creates no users.

`src/api/controllers/setup.controller.ts`:

```ts
import type { HttpRequest } from '../http/types';
import type { SetupService } from '../../services/setup.service';
import { can } from '../../services/access-control';
import { ForbiddenError, UnauthorizedError, TooManyRequestsError, BadRequestError } from '../../core/errors/app-error';
import { googleConfigFromEnv, googleConfigStatus, googleStatusText } from '../../services/routing/google-config';
import { checkGoogleConnection } from '../../services/routing/google-check';

let lastGoogleCheck = 0; // per instance: at most once per 10 s

export function makeSetupController(deps: { setup: SetupService }) {
  return {
    status: (r: HttpRequest) => deps.setup.status(r.ctx, r.origin),
    createAdmin: (r: HttpRequest) => deps.setup.createFirstAdmin(r.body),
    async googleCheck(r: HttpRequest) {
      if (!r.ctx) throw new UnauthorizedError();
      if (!can(r.ctx, 'admin:manage')) throw new ForbiddenError();
      if (Date.now() - lastGoogleCheck < 10_000) throw new TooManyRequestsError('Wait 10 seconds. Then test again.');
      lastGoogleCheck = Date.now();
      const cfg = googleConfigFromEnv();
      if (!cfg) throw new BadRequestError(googleStatusText(googleConfigStatus()));
      return { rows: await checkGoogleConnection(cfg) };
    },
  };
}
```

`router.ts` — build `const setupCtl = makeSetupController({ setup: services.setup });` and add (group under a `// ----- Setup -----` comment):

```ts
    { method: 'GET',  path: '/setup/status', auth: false, handler: (r) => setupCtl.status(r) },
    { method: 'POST', path: '/setup/admin',  auth: false, handler: (r) => setupCtl.createAdmin(r) },
    { method: 'POST', path: '/bus/google-check', auth: true, handler: (r) => setupCtl.googleCheck(r) },
```

Register `/bus/google-check` **before** any `/bus/:param`-style routes if such exist (Express registration order).

`settings.controller.ts` — add an optional `setup` dep: `get: async () => ({ ...(await deps.settings.get()), needsAdmin: deps.setup ? await deps.setup.needsAdmin() : false })`; pass `setup: services.setup` in `router.ts`. Check `src/tests/settings*.test.ts` and `manifest.controller.test.ts` still pass (manifest calls `settings.get()` on the service, not the controller — unaffected).

`bus.controller.ts` — `run`: `async (r) => { const v = await b.getRun(ctxOf(r)); if (r.ctx?.role !== 'admin') return v; const s = googleConfigStatus(); return { ...v, google: { ...s, text: googleStatusText(s) } }; }`.

`api/index.ts` — replace the static import and the error response:

```ts
import type { Express } from 'express';

let appPromise: Promise<Express> | null = null;

function getApp(): Promise<Express> {
  if (!appPromise) {
    // Dynamic import so an error thrown while LOADING the app (not just building it) is caught here.
    appPromise = import('../src/app').then((m) => m.createAppInstance()).catch((err: unknown) => {
      console.error('[CMS] createAppInstance failed:', err);
      appPromise = null;
      throw err;
    });
  }
  return appPromise;
}

function startHint(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/DATABASE_URL/.test(msg)) return 'In Vercel, add DATABASE_URL. Then redeploy.';
  if (/Missing required env var: (\w+)/.test(msg)) return `In Vercel, add ${/Missing required env var: (\w+)/.exec(msg)![1]}. Then redeploy.`;
  return 'Open Vercel. Open the newest deployment. Copy the last 20 lines of the logs to the developer.';
}

function handler(req: any, res: any): void {
  getApp().then(
    (app) => { app(req, res); },
    (err: unknown) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'The app cannot start.', hint: startHint(err) }));
    },
  );
}
```

Keep the two `process.on(...)` handlers and `module.exports = handler;`.

`vercel.json` route regex: add `setup` to the alternation (`...|prayers|bus|setup)`). `public/sw.js` `API_RE`: add `setup` (do **not** bump `CACHE` here — Task 4 does it once).

- [ ] **Step 10: Route-level tests**

`src/tests/setup.routes.test.ts` — using the same app-building pattern as the existing routes tests, with `PERSISTENCE=memory` **but an empty user repo** (build the app via `createApp(buildRoutes(services), services.auth, services.health)` from a container you construct without `seedDemoData`, or delete the seeded users first). Cases:

```ts
// 1. GET /settings includes needsAdmin:true on an empty repo.
// 2. GET /setup/status → 200 with checks[] (public), no 'stack' and no env values in the body.
// 3. POST /setup/admin with the right code (set process.env.SETUP_CODE in the test) → 200 { token, user.email === 'admin' }.
// 4. Then GET /setup/status without a token → 401; with the new token → 200 and no setupCode row.
// 5. POST /setup/admin again → 409 'An admin already exists. Log in.'
// 6. 31 rapid POST /setup/admin with a wrong code from one IP → the 31st is 429.
// 7. GET /health → { status:'ok', db:'ok', schema:{ current: LATEST_MIGRATION, expected: LATEST_MIGRATION } } in memory mode (import LATEST_MIGRATION; no literal).
// 8. POST /bus/google-check without auth → 401; as a grade user → 403.
// 9. Unknown-user login with SESSION_SECRET unset and NODE_ENV=production → 503 SETUP_INCOMPLETE (use vi.resetModules + dynamic import as in auth.no-secret.test.ts).
// 10. Same no-secret production setup: GET /setup/status → 200 (setup routes work) and GET /students → 401.
```

Write each as a real `it(...)` with assertions on status code and body fields. Rate-limit test note: the limiter is module-level per process; use a unique `X-Forwarded-For` header value for that test (trust proxy is 1) so other tests are not affected.

Also add to `src/tests/batch.controller.test.ts` or a new small test: `GET /bus/run` for an admin carries `google.text`, for a quad login does not (only if a bus route test harness already exists — `bus.routes.test.ts`; add one case there).

- [ ] **Step 11: Run the gate** `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js` → all PASS. Then a manual smoke: `npm run start` in memory mode, `curl -s localhost:4300/health`, `curl -s localhost:4300/setup/status` (expect 401 — memory mode seeds `admin`), `curl -s localhost:4300/settings | grep needsAdmin` (false). Stop the server.

---

### Task 4: SPA — setup screen, System check tab, Bus Google UI, settings file (spec §4.3, §5.2 UI, §1 Decisions "Guides")

**Files:**
- Modify: `public/index.html`, `public/sw.js` (`CACHE` → `ysc-v86`)
- Create: `src/tests/spa-setup.test.ts`

**Interfaces:**
- Consumes (HTTP): everything Task 3 "Produces (HTTP)".
- Produces (SPA functions, all top-level `function` declarations so `extractFn` finds them): `_genSetupCode()`, `_genHex32()`, `_genBase64Key()`, `_setupChecklistHtml(status, opts)`, `renderSetup()`, `setupCheckAgain()`, `setupGenerate(id)`, `submitCreateAdmin()`, `renderSystemCheck()`, `busGoogleCheck()`, `exportSettingsFile()`, `_parseSettingsFile(text)`, `loadSettingsFile(input)`.

Read first: `boot()` (~line 9942), `renderLogin()` (~1906), `doLogin()`, `renderAdminView` tabs (~5393), `switchAdminTab`, `busSettings()` (~8858), the Bus page header (~8451–8470), the Youth Setup `deploy` card (~6349) and `_deployGuideText`/`copyDeployGuide`/`downloadDeployGuide` (~6557–6622), `_downloadText`, `copyText`, `modal`, `toast`, `helpTip`, `esc`, `_initShell`.

- [ ] **Step 1: Failing SPA tests**

`src/tests/spa-setup.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml } from './helpers/extract-fn';
import { webcrypto } from 'node:crypto';

const prelude = `const crypto = globalThis.__wc; const btoa = (s) => Buffer.from(s, 'binary').toString('base64');`;
(globalThis as any).__wc = webcrypto;

describe('setup generators', () => {
  const f = loadFns(['_genSetupCode', '_genHex32', '_genBase64Key'], prelude);
  it('setup code: 5 groups of 4 from the unambiguous alphabet', () => {
    for (let i = 0; i < 50; i++) expect(f._genSetupCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}(-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}){4}$/);
  });
  it('hex secret is 64 hex chars', () => expect(f._genHex32()).toMatch(/^[0-9a-f]{64}$/));
  it('encryption key is base64 of 32 bytes', () => expect(Buffer.from(f._genBase64Key(), 'base64')).toHaveLength(32));
});

describe('_parseSettingsFile', () => {
  const { _parseSettingsFile } = loadFns(['_parseSettingsFile']);
  it('accepts a file made by exportSettingsFile', () => {
    const r = _parseSettingsFile(JSON.stringify({ kind: 'ys-connection-settings', version: 1, ministryConfig: { branding: { appName: 'X' } }, serviceMinAttendance: 5, termGapDays: 14 }));
    expect(r).toMatchObject({ ministryConfig: { branding: { appName: 'X' } }, serviceMinAttendance: 5, termGapDays: 14 });
  });
  it('drops busMinistry (location-specific)', () => {
    const r = _parseSettingsFile(JSON.stringify({ kind: 'ys-connection-settings', version: 1, ministryConfig: { busMinistry: { churchPlaceId: 'x' } } }));
    expect(r.ministryConfig.busMinistry).toBeUndefined();
  });
  it('returns null for anything else', () => {
    expect(_parseSettingsFile('not json')).toBeNull();
    expect(_parseSettingsFile(JSON.stringify({ kind: 'other' }))).toBeNull();
  });
});

describe('no secret ever goes to storage', () => {
  it('generator and setup functions never touch localStorage/sessionStorage', () => {
    const src = loadIndexHtml();
    for (const name of ['_genSetupCode', '_genHex32', '_genBase64Key', 'renderSetup', 'setupGenerate', 'submitCreateAdmin']) {
      const m = new RegExp(`function ${name}\\(`).exec(src);
      expect(m, name).not.toBeNull();
    }
    const block = src.slice(src.indexOf('/* ── SETUP MODULE'), src.indexOf('/* ── END SETUP MODULE'));
    expect(block).not.toMatch(/localStorage|sessionStorage/);
  });
});
```

Implementer: check `loadFns`'s full signature in `src/tests/helpers/extract-fn.ts` (prelude is the 2nd arg) before using it.

- [ ] **Step 2: Run** `npx vitest run src/tests/spa-setup.test.ts` → FAIL.

- [ ] **Step 3: Implement the setup module**

Add a delimited block `/* ── SETUP MODULE (first-run checklist) ── */ … /* ── END SETUP MODULE ── */` near `renderLogin()`. Required content (text is final STE wording — do not reword):

```js
/* ── SETUP MODULE (first-run checklist) ── */
// Generated values live ONLY in this in-memory object — never localStorage, never sent to the server.
const SETUP = { status: null, generated: {}, error: null, hint: null };
function _genSetupCode() {
  // Alphabet inside the function so tests can extract it alone. Rejection sampling (31 x 8 = 248) avoids modulo bias.
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  while (s.length < 20) {
    const b = new Uint8Array(32); crypto.getRandomValues(b);
    for (const x of b) { if (x < 248 && s.length < 20) s += A[x % 31]; }
  }
  return s.match(/.{4}/g).join('-');
}
function _genHex32() {
  const b = new Uint8Array(32); crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
function _genBase64Key() {
  const b = new Uint8Array(32); crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b));
}
function _setupChecklistHtml(st, opts) {
  const rows = st.checks.map((c) => {
    const icon = c.state === 'ok' ? icS('check') : c.state === 'optional' ? icS('info') : icS('alert');
    const gen = c.state === 'fix' && c.generate && opts.generate
      ? (SETUP.generated[c.id]
          ? `<div class="setup-gen"><code>${esc(SETUP.generated[c.id])}</code><button class="btn btn-secondary btn-sm" onclick="copyText(SETUP.generated['${c.id}'])">Copy</button></div>`
          : `<button class="btn btn-secondary btn-sm" onclick="setupGenerate('${c.id}')">Generate</button>`)
      : '';
    const fix = c.fix ? `<div class="help-text">${esc(c.fix).replace(/\n/g, '<br>')}</div>` : '';
    const link = c.link ? `<a href="${esc(c.link)}" target="_blank" rel="noopener">Open GOOGLE-SETUP.md</a>` : '';
    return `<div class="li setup-row setup-${c.state}"><div style="flex:1"><div><b>${icon} ${esc(c.label)}</b></div>${fix}${gen}${link}</div></div>`;
  }).join('');
  return `<div class="card">${rows}</div>`;
}
async function _loadSetupStatus() {
  try { SETUP.status = await API.get('/setup/status'); SETUP.error = null; SETUP.hint = null; return 'ok'; }
  catch (e) {
    // 401/403 = an admin exists: this is a normal set-up app, so the sign-in page is right.
    if (e.status === 401 || e.status === 403) { SETUP.status = null; SETUP.error = null; return 'login'; }
    SETUP.status = null; SETUP.error = e.message || 'The app cannot start.'; SETUP.hint = e.hint || null; return 'error';
  }
}
async function renderSetup() {
  if (!SETUP.status && !SETUP.error) {
    if ((await _loadSetupStatus()) === 'login') { S.page = 'home'; renderLogin(); return; }
  }
  const st = SETUP.status;
  if (st && !st.needsAdmin) { S.page = 'home'; renderLogin(); return; }
  const required = st ? st.checks.filter((c) => c.state !== 'optional') : [];
  const ready = st && st.needsAdmin && required.every((c) => c.state === 'ok');
  setApp(`<div class="pg" style="max-width:560px;margin:0 auto">
    <h2>Set up the app</h2>
    <div class="help-text">Do each step in the list. Then select <b>Check again</b>.</div>
    ${SETUP.error ? `<div class="alert al-warn">${esc(SETUP.error)}${SETUP.hint ? `<br>${esc(SETUP.hint)}` : ''}</div>
      <a href="#" onclick="SETUP.error=null;S.page='home';renderLogin();return false">Go to sign in</a>` : ''}
    ${st ? _setupChecklistHtml(st, { generate: true }) : ''}
    <button class="btn btn-secondary btn-full" onclick="setupCheckAgain()">Check again</button>
    ${ready ? `<div class="card" style="margin-top:12px"><h3>Create your admin</h3>
      <form id="setupform" method="post" action="/setup/admin">
        <label class="fl">Username</label><input class="fi" name="username" value="admin" readonly autocomplete="username">
        <label class="fl">Setup code</label><input class="fi" id="su-code" autocapitalize="characters" autocorrect="off" spellcheck="false">
        <div class="help-text">Copy SETUP_CODE from Vercel: <b>Settings</b> &gt; <b>Environment Variables</b>.</div>
        <label class="fl">Display name</label><input class="fi" id="su-name" value="Admin">
        <label class="fl">Password</label><input class="fi" id="su-pw1" type="password" name="password" autocomplete="new-password">
        <label class="fl">Type the password again</label><input class="fi" id="su-pw2" type="password" autocomplete="new-password">
        <button class="btn btn-primary btn-full" type="submit">Create admin</button>
      </form>
      <div class="help-text">WARNING: Save the admin password in a password manager that two staff can open.</div></div>` : ''}
  </div>`);
  const f = document.getElementById('setupform');
  if (f) f.addEventListener('submit', (e) => { e.preventDefault(); submitCreateAdmin(); });
}
async function setupCheckAgain() { SETUP.status = null; SETUP.error = null; await renderSetup(); }
function setupGenerate(id) {
  const gen = { sessionSecret: _genHex32, encryptionKey: _genBase64Key, setupCode: _genSetupCode }[id];
  if (!gen) return;
  SETUP.generated[id] = gen();
  const sys = document.getElementById('sys-check');
  if (sys && SETUP.status) sys.innerHTML = _setupChecklistHtml(SETUP.status, { generate: true }) + `<button class="btn btn-secondary btn-full" onclick="SETUP.status=null;renderSystemCheck()">Check again</button>`;
  else renderSetup();
}
async function submitCreateAdmin() {
  const code = document.getElementById('su-code').value;
  const displayName = document.getElementById('su-name').value;
  const pw1 = document.getElementById('su-pw1').value, pw2 = document.getElementById('su-pw2').value;
  if (pw1.length < 8) { toast('The password must have 8 or more characters.'); return; }
  if (pw1 !== pw2) { toast('The two passwords are not the same.'); return; }
  try {
    const r = await API.post('/setup/admin', { code, displayName, password: pw1 });
    API.setToken(r.token); S.user = r.user;
    _offerSaveCredential('admin', pw1);
    SETUP.generated = {}; SETUP.status = null;
    S.settings = await API.get('/settings').catch(() => S.settings);
    setTimeout(() => go('home'), 150);
  } catch (e) {
    if (e.status === 409) { toast(e.message); SETUP.status = null; S.page = 'home'; renderLogin(); return; }
    toast(e.message);
  }
}
/* ── END SETUP MODULE ── */
```

Also in the API client's error branch (`public/index.html` ~line 855, where `err.code = e.code` is set) add `err.hint = e.hint;` so the `hint` from `api/index.ts` reaches the setup screen.

Implementer: match the real helper names (`icS` keys `check`/`info`/`alert` exist; `copyText`, `toast`, `setApp`, `go`, `_offerSaveCredential`, `API.setToken`). Follow how `doLogin()` finishes a login (it may call `_initShell()` or rely on `render()`); mirror it exactly. Add minimal CSS: `.setup-gen{display:flex;gap:8px;align-items:center;margin-top:6px}.setup-gen code{word-break:break-all;font-size:12px}` and colour the row icon (`.setup-ok` green, `.setup-fix` amber) using existing tokens.

- [ ] **Step 4: Boot + render routing**

In `boot()`, after the existing `/settings` fetch, decide whether to show setup (only when there is no logged-in user):

```js
  let settingsFailed = false;
  try { S.settings = await API.get('/settings'); } catch { S.settings = {}; settingsFailed = true; }
  ...
  if (!S.user && (settingsFailed || (S.settings && S.settings.needsAdmin))) S.page = 'setup';
```

In `render()`, when there is no `S.user` and `S.page === 'setup'`, call `renderSetup()` instead of `renderLogin()`. Ensure logout resets `S.page` away from `'setup'` only via the existing flow (a logged-out user on a set-up app sees the login). Do not show setup to a logged-in user.

- [ ] **Step 5: Admin → System check tab**

Add `'system'` to the `tabs` array and `system:'System check'` to `tabLabels` in `renderAdminView`. `renderAdminView` builds one `body` string and passes it to `setApp` (there is no per-tab container). Add `if (_adminTab === 'system') body += '<div id="sys-check"></div>';` where the other tabs append their body, and after the final `setApp(...)` in `renderAdminView` add `if (_adminTab === 'system') renderSystemCheck();`:

```js
async function renderSystemCheck() {
  const el = document.getElementById('sys-check');
  if (!el) return;
  await _loadSetupStatus();
  el.innerHTML = SETUP.error ? `<div class="alert al-warn">${esc(SETUP.error)}</div>`
    : `${_setupChecklistHtml(SETUP.status, { generate: true })}
       <button class="btn btn-secondary btn-full" onclick="SETUP.status=null;renderSystemCheck()">Check again</button>`;
}
```

(`_setupChecklistHtml` only shows Generate for `fix` rows — satisfies "without Generate buttons for rows that are ok". Place `renderSystemCheck` inside the SETUP MODULE block.)

- [ ] **Step 6: Bus — status line, Test button, admin banner**

In `busSettings()`, above the Save button, when `BUS.view.google` is present (admin only):

```js
    ${BUS.view.google ? `<div class="help-text" style="margin-top:8px"><b>${esc(BUS.view.google.text)}</b></div>
      <button class="btn btn-secondary btn-full" onclick="busGoogleCheck()">Test Google connection</button>
      <div id="bus-gcheck"></div>` : ''}
```

```js
async function busGoogleCheck() {
  const el = document.getElementById('bus-gcheck'); if (!el) return;
  el.innerHTML = `<div class="help-text">Testing…</div>`;
  try {
    const r = await API.post('/bus/google-check', {}, 45000);
    el.innerHTML = r.rows.map((x) => `<div class="li"><div style="flex:1"><b>${esc(x.label)}: ${x.ok ? 'OK' : 'Fix needed'}</b>${x.fix ? `<div class="help-text">${esc(x.fix)}</div>` : ''}</div></div>`).join('');
  } catch (e) { el.innerHTML = `<div class="alert al-warn">${esc(e.message)}</div>`; }
}
```

(Check `API.post`'s timeout argument position against the API IIFE before relying on it.)

On the Bus page (the header render near line 8451–8470), for admins when `BUS.view.google && BUS.view.google.state !== 'on'`, render a small banner directly under the header: `<div class="alert al-warn">${esc(BUS.view.google.text)}</div>`.

- [ ] **Step 7: Replace the "Deploy this setup" card**

Delete `_deployGuideText`, `copyDeployGuide`, `downloadDeployGuide` and the `deploy` card. Add a card `'share'` titled `Use this setup at another location`:

```js
  b += _setupCard('share', 'Use this setup at another location', `
    <div class="help-text" style="margin-bottom:8px">To start a new location, follow the deploy guide. To copy these settings to that location, select <b>Download settings file</b>. At the new location, select <b>Load settings file</b>. Then select <b>Save Youth Setup</b>.</div>
    <a class="btn btn-secondary btn-full" href="https://github.com/citipointe-youth/ys-connection/blob/master/docs/DEPLOYING.md" target="_blank" rel="noopener">Open the deploy guide</a>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn btn-secondary" style="flex:1" onclick="exportSettingsFile()">Download settings file</button>
      <label class="btn btn-secondary" style="flex:1;text-align:center">Load settings file<input type="file" accept=".json,application/json" hidden onchange="loadSettingsFile(this)"></label>
    </div>`);
```

```js
function exportSettingsFile() {
  const cfg = JSON.parse(JSON.stringify(_setupDraft || {}));
  delete cfg.busMinistry; // church address, coordinators: location-specific
  const file = { kind: 'ys-connection-settings', version: 1, ministryConfig: cfg,
    serviceMinAttendance: _setupServiceMinAttendance, termGapDays: _setupTermGapDays };
  _downloadText('ys-connection-settings.json', JSON.stringify(file, null, 2));
}
function _parseSettingsFile(text) {
  let j; try { j = JSON.parse(text); } catch { return null; }
  if (!j || j.kind !== 'ys-connection-settings' || typeof j.ministryConfig !== 'object' || !j.ministryConfig) return null;
  const cfg = { ...j.ministryConfig }; delete cfg.busMinistry;
  return { ministryConfig: cfg,
    serviceMinAttendance: typeof j.serviceMinAttendance === 'number' ? j.serviceMinAttendance : null,
    termGapDays: typeof j.termGapDays === 'number' ? j.termGapDays : null };
}
function loadSettingsFile(input) {
  const file = input.files && input.files[0]; if (!file) return;
  file.text().then((text) => {
    const r = _parseSettingsFile(text);
    if (!r) { toast('This is not a settings file from this app.'); return; }
    _setupDraft = { ..._setupDraft, ...r.ministryConfig, busMinistry: (_setupDraft || {}).busMinistry };
    if (r.serviceMinAttendance != null) _setupServiceMinAttendance = r.serviceMinAttendance;
    if (r.termGapDays != null) _setupTermGapDays = r.termGapDays;
    _setupRerender();
    toast('Settings loaded. Select Save Youth Setup.');
  });
}
```

Implementer: if `_setupDraft` is a merged ministryConfig object with nested sections, do a per-section shallow merge (`branding`, `labels`, `structure`, `roles`, `modules`, `import`) rather than a top-level spread, so a section missing from the file keeps its current value. Keep `_downloadText` (used elsewhere? check — if only the deleted functions used it, it is still used by `exportSettingsFile`).

- [ ] **Step 8: SW + checks**

`public/sw.js`: `const CACHE = 'ysc-v86';` (`API_RE` already has `setup` from Task 3 — confirm).
Grep the new text for apostrophes inside single-quoted strings: `grep -n "helpTip('[^']*'[a-z]" public/index.html` → no new hits.
Run: `npx vitest run src/tests/spa-setup.test.ts` → PASS; then the full gate `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js` → PASS.

- [ ] **Step 9: Browser check (controller, after the batch returns)**

First `Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue`. Run the app in memory mode, log in as `admin`, open Admin → System check (expect fix rows for persistence etc. with Generate buttons; Generate shows a value + Copy), open Bus → settings (status line "Google: not set up. Bus uses test routes." + Test button → 400 toast text). For the setup screen itself: temporarily run with `PERSISTENCE=supabase` and no `DATABASE_URL` (`$env:PERSISTENCE='supabase'; npm run start`) → the login page is replaced by the checklist with the database row as fix. Check at 375 px width. Use claude-in-chrome; no screenshots are kept from this step.

---

### Task 5: Cloud Shell Google setup script (spec §5.3)

**Files:**
- Create: `scripts/google-setup.sh`

**Interfaces:**
- Produces: printed `GOOGLE_SA_JSON` (one line) and `GOOGLE_MAPS_API_KEY` between marker lines; used by `docs/GOOGLE-SETUP.md` (Task 6).

- [ ] **Step 1: Verify names before writing** (implementer, with WebFetch/WebSearch):
  - The IAM role id for Route Optimization Editor (expected `roles/routeoptimization.editor`) — Google's IAM roles reference.
  - The `gcloud services api-keys create` flags `--display-name`, `--api-target=service=…` and `gcloud services api-keys get-key-string` — current gcloud reference.
  - The org-policy override commands for **both** `iam.disableServiceAccountKeyCreation` (legacy, `gcloud resource-manager org-policies disable-enforce …` or `gcloud org-policies reset`) and `iam.managed.disableServiceAccountKeyCreation` (managed constraint). Put the exact commands in the script's "Technical:" line and record the source URLs in a comment at the top of the script.

- [ ] **Step 2: Write the script**

```bash
#!/usr/bin/env bash
# YS Connection — Google setup for Bus Ministry. Run in Google Cloud Shell.
# Safe to run twice: reuses the service account and the API key; makes a NEW key file each run.
# Sources checked <date>: <IAM role URL>, <api-keys URL>, <org-policy URL>
set -uo pipefail

SA_NAME="ys-bus"
KEY_NAME="ys-bus-key"
APIS="iam.googleapis.com apikeys.googleapis.com cloudresourcemanager.googleapis.com routeoptimization.googleapis.com places.googleapis.com routes.googleapis.com static-maps-backend.googleapis.com"
ROLE="roles/routeoptimization.editor"

say()  { printf '%s\n' "$*"; }
tech() { printf 'Technical: %s\n' "$*"; }
stop() { say "$1"; [ -n "${2:-}" ] && tech "$2"; exit 1; }

# 1. Project
PROJECT="$(gcloud config get-value project 2>/dev/null)"
if [ -z "$PROJECT" ] || [ "$PROJECT" = "(unset)" ]; then
  say "No project is selected. These are your projects:"
  gcloud projects list --format="value(projectId)"
  read -r -p "Type the Project ID. Then push Enter: " PROJECT
  [ -z "$PROJECT" ] && stop "No Project ID was typed. Run this command again."
  gcloud config set project "$PROJECT" >/dev/null 2>&1 || stop "Cannot use that project. Check the Project ID. Then run this command again."
fi
say "Project: $PROJECT"

# 2. Billing
BILLING="$(gcloud billing projects describe "$PROJECT" --format='value(billingEnabled)' 2>/dev/null)"
if [ $? -ne 0 ] || [ -z "$BILLING" ]; then
  say "Cannot check billing. Confirm it at console.cloud.google.com/billing/linkedaccounts."
elif [ "$BILLING" != "True" ]; then
  stop "Billing is off. Open https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT. Turn on billing. Then run this command again."
fi

# 3. APIs
say "Turning on the Google services. This takes about 1 minute."
gcloud services enable $APIS --project "$PROJECT" >/dev/null 2>&1 || stop "Cannot turn on the Google services. Run this command again." "gcloud services enable $APIS"

# 4. Service account + role
SA_EMAIL="$SA_NAME@$PROJECT.iam.gserviceaccount.com"
gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT" >/dev/null 2>&1 \
  || gcloud iam service-accounts create "$SA_NAME" --display-name="YS Connection Bus" --project "$PROJECT" >/dev/null 2>&1 \
  || stop "Cannot make the service account. Run this command again."
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA_EMAIL" --role="$ROLE" --condition=None >/dev/null 2>&1 \
  || stop "Cannot give the service account its role. Run this command again." "add-iam-policy-binding $ROLE"

# 5. Key file
KEYFILE="$(mktemp)"
if ! ERR="$(gcloud iam service-accounts keys create "$KEYFILE" --iam-account="$SA_EMAIL" --project "$PROJECT" 2>&1)"; then
  rm -f "$KEYFILE"
  if printf '%s' "$ERR" | grep -q 'constraints/iam'; then
    stop "Your organisation blocks key files. Ask an organisation admin to allow key files for this project, or create the project under a personal Gmail account. Then run this command again." \
         "<verified org-policy override commands for iam.disableServiceAccountKeyCreation and iam.managed.disableServiceAccountKeyCreation, project $PROJECT>"
  fi
  stop "Cannot make a key file. Run this command again."
fi

# 6. API key
KEY_ID="$(gcloud services api-keys list --project "$PROJECT" --filter="displayName=$KEY_NAME" --format='value(name)' 2>/dev/null | head -n1)"
if [ -z "$KEY_ID" ]; then
  gcloud services api-keys create --project "$PROJECT" --display-name="$KEY_NAME" \
    --api-target=service=places.googleapis.com --api-target=service=routes.googleapis.com \
    --api-target=service=static-maps-backend.googleapis.com >/dev/null 2>&1 || { shred -u "$KEYFILE"; stop "Cannot make the API key. Run this command again."; }
  KEY_ID="$(gcloud services api-keys list --project "$PROJECT" --filter="displayName=$KEY_NAME" --format='value(name)' | head -n1)"
fi
API_KEY="$(gcloud services api-keys get-key-string "$KEY_ID" --format='value(keyString)')"

# 7. Output
SA_JSON="$(python3 -c 'import json,sys;print(json.dumps(json.load(sys.stdin),separators=(",",":")))' < "$KEYFILE")"
shred -u "$KEYFILE"
say ""
say "=============== COPY FROM HERE ==============="
say "GOOGLE_SA_JSON"
say "$SA_JSON"
say ""
say "GOOGLE_MAPS_API_KEY"
say "$API_KEY"
say "================ COPY TO HERE ================"
say "Copy the two values between the lines. Paste them in Vercel. Then close this tab."
```

Fill the two `<…>` placeholders and the `Sources checked` line with the values verified in Step 1 (this is the only allowed placeholder in this plan — it must be resolved from Google's docs, not guessed). All non-"Technical:" messages follow §6.3: "Push Enter" is acceptable because **Enter** is a key name — but if `scripts/check-guide-style.js` (Task 6) flags it, use "Type the Project ID, then use the Enter key."

- [ ] **Step 3: Static checks**: `bash -n scripts/google-setup.sh` (Git Bash) → no output. Real run happens in Task 10.

---

### Task 6: Guides, docs and the style checker (spec §6.1, §6.2, §6.3, "Other files")

**Files:**
- Create: `docs/GOOGLE-SETUP.md`, `scripts/check-guide-style.js`, `docs/img/deploy/.gitkeep`
- Rewrite: `docs/DEPLOYING.md` (≤ 250 lines)
- Modify: `.env.example`, `README.md`, `CLAUDE.md`

- [ ] **Step 1: Style checker** — `scripts/check-guide-style.js`:

```js
#!/usr/bin/env node
// Mechanical ASD-STE100 check for the guides (spec §6.3). Exit 1 on any finding.
// Ignores fenced code blocks, inline `code`, **bold** UI names, [Screenshot: …] lines and "Technical:" lines.
const fs = require('fs');
const files = process.argv.slice(2).length ? process.argv.slice(2)
  : ['docs/DEPLOYING.md', 'docs/GOOGLE-SETUP.md', 'scripts/google-setup.sh'];
const BANNED = ['simply', 'just', 'easily', 'etc', 'should', 'may', 'click', 'press', 'tap', 'hit', 'enter', 'choose', 'pick'];
// e.g. / i.e. end in a dot, so they need their own alternative (no trailing \\b after a dot).
const banned = new RegExp(`\\b(${BANNED.join('|')})\\b|\\b(e\\.g\\.|i\\.e\\.)`, 'i');
let problems = 0;
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  let fence = false;
  lines.forEach((raw, i) => {
    if (/^\s*```/.test(raw)) { fence = !fence; return; }
    if (fence || /Technical:|\[Screenshot:/.test(raw)) return;
    let text = raw.replace(/`[^`]*`/g, '').replace(/\*\*[^*]+\*\*/g, 'X').replace(/\]\([^)]*\)/g, ']');
    if (f.endsWith('.sh')) { const m = /(?:say|stop)\s+"([^"]*)"/.exec(raw); if (!m) return; text = m[1]; }
    const b = banned.exec(text);
    if (b) { problems++; console.log(`${f}:${i + 1}: banned word "${b[1] || b[2]}"`); }
    if (/^\s*\d+\.\s/.test(raw)) {
      for (const s of text.replace(/^\s*\d+\.\s/, '').split(/(?<=[.!?])\s+/)) {
        const words = s.trim().split(/\s+/).filter(Boolean).length;
        if (words > 20) { problems++; console.log(`${f}:${i + 1}: step sentence has ${words} words (max 20)`); }
      }
    }
  });
}
console.log(problems ? `${problems} problem(s).` : 'Guide style: OK');
process.exit(problems ? 1 : 0);
```

Run against the current `docs/DEPLOYING.md` once to see it flag the old text (expected: problems).

- [ ] **Step 2: Write `docs/DEPLOYING.md`** following spec §6.1 sections 0–9 exactly, with §6.3 rules: time tag per section ("5 min"), "Expected result: …" after every Deploy/Redeploy/Create and screen-changing step, `You can stop here.` at the end of each large part, Glossary (≤ 15 lines: Fork, Repository, Environment variable, Session pooler, Redeploy, Service account), a **Save these values** box, "last checked: 2026-10-10", `[Screenshot: …]` placeholder lines for screenshots 01–13 at the right steps (filenames `docs/img/deploy/NN-name.png` per §6.3's list), Troubleshooting table ≤ 25 rows (must include: port 6543 vs 5432 with the reason, APP_ORIGIN fallback, Rollback via **Deployments** > **Instant Rollback** "does not touch the database", build failure → copy the last 20 lines of the Build Logs, Supabase paused project, setup code wrong → copy it again from Vercel, "The app cannot start" page). Remove seed-account tables, the shared-password text, `../Generalisation of the app/` links, "Seed accounts by preset" (keep a 2-line role-preset note in step 5). Keep: PERSISTENCE requirement, `CORS_ORIGINS` ("leave empty"), rollback, icon note. Step 3 says: do **not** add `NODE_ENV`; keep **Production** ticked for every value. Step 4 lists exactly `SESSION_SECRET`, `FIELD_ENCRYPTION_KEY`, `SETUP_CODE`, tells the reader to copy `SETUP_CODE` from Vercel when they create the admin, and ends with "After you create the admin, you can delete `SETUP_CODE` in Vercel." (spec §3). Step 6 (Updates) is Sync fork → Update branch → Vercel deploys by itself in ~2 min → "Expected result: the newest deployment shows Ready." Step 7 links GOOGLE-SETUP.md + the NOTE on daylight-saving states (Bus times 1 h off in summer outside Queensland). Cost line: "Vercel Hobby is for non-commercial use" + a `NOTE:` that the owner confirms the plan before publishing (leave as an owner TODO in the Task 10 checklist, not in the guide text).

- [ ] **Step 3: Write `docs/GOOGLE-SETUP.md`** (≤ 120 lines) following spec §6.2 steps 0–10, same rules; screenshot placeholders 14–19; the paste line uses the pinned form `bash <(curl -sL https://raw.githubusercontent.com/citipointe-youth/ys-connection/<sha>/scripts/google-setup.sh)` with `<sha>` left literally as `COMMIT_SHA` — Task 9 replaces it with the real pushed commit. Step 5 is a table of every stop message the script can print (copy them from `scripts/google-setup.sh`) → fix. Step 8 budget: **Billing** > **Budgets & alerts** > **Create budget**, AUD 20. Step 10 "Remove the access": delete old service-account keys (**IAM & Admin** > **Service Accounts** > `ys-bus` > **Keys**).

- [ ] **Step 4: Other files**
  - `.env.example`: add commented lines `# SETUP_CODE=<16+ characters — first-run admin creation>`, `# FIELD_ENCRYPTION_KEY=<base64 of 32 random bytes>`, `# GOOGLE_SA_JSON=<the service-account key file, one line>`, `# GOOGLE_MAPS_API_KEY=<API key>`; fix the old `DATABASE_URL` example to the Session pooler form (`postgresql://postgres.<ref>:<password>@aws-1-<region>.pooler.supabase.com:5432/postgres`); add `# Do NOT set NODE_ENV in Vercel.` next to `NODE_ENV`.
  - `README.md`: label the seed account table "local demo only (`PERSISTENCE=memory`)"; link `docs/DEPLOYING.md` as the way to deploy.
  - `CLAUDE.md`:
    - "Migrations" section: migrations now apply automatically in the Vercel production build (`scripts/migrate.ts`, `schema_migrations` table, baseline ≤ 0014, advisory lock, summary line); rules: additive only, no `create index concurrently`, never edit a shipped file (0003 was the one exception); next migration is `0016`; bump `LATEST_MIGRATION` with every new file (a test enforces it).
    - "Environment variables": add `SETUP_CODE`, `GOOGLE_SA_JSON` (or the old three), and "do not set NODE_ENV in Vercel" (it makes Vercel skip devDependencies, so `tsx` is missing in the build). Note that the 0015 file now carries the statement timeout.
    - "Seed demo accounts": `0003` is now empty; new databases create `admin` via the setup screen; the table describes memory mode only.
    - Bus "Deploying" bullet: replace "Apply any migration to prod (Supabase MCP `apply_migration`) **before** they promote" with "Migrations apply in the build. After a push, read the build-log line `Database up to date — …` and tell the owner before they promote. Never apply migrations with the Supabase MCP."
    - Add a short dated section `### Multi-location rollout (2026-10-10)` (≤ 15 lines): setup checklist + `/setup/*` routes, System check tab, `GOOGLE_SA_JSON`, `/bus/google-check`, `/health` db/schema, settings file replaces the deploy-guide card, the 403-text change.
    - Update the "Key API routes" table with a `Setup` row.

- [ ] **Step 5: Run** `node scripts/check-guide-style.js` → `Guide style: OK`. `wc -l docs/DEPLOYING.md docs/GOOGLE-SETUP.md` → ≤ 250 and ≤ 120. Gate: `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js` → PASS.

---

### Task 7: Guide review — separate Sonnet subagent (spec §6.4)

**Files:** read-only review; the controller applies fixes to `docs/DEPLOYING.md`, `docs/GOOGLE-SETUP.md`, `scripts/google-setup.sh`, `public/index.html` (new text only), `src/services/setup.service.ts` / `google-check.ts` / `google-config.ts` (message strings only).

- [ ] **Step 1: Dispatch** a fresh Sonnet subagent (`general-purpose`, model `sonnet`) with this brief:

> Review the user-facing text of a deployment feature against ASD-STE100-style rules. Read spec `docs/superpowers/specs/2026-10-10-multi-location-rollout-design.md` §6.3 (the rules) and §6.1/§6.2 (what each guide must contain). Review: `docs/DEPLOYING.md`, `docs/GOOGLE-SETUP.md`, every `say`/`stop` message in `scripts/google-setup.sh`, every string in `src/services/setup.service.ts`, `src/services/routing/google-check.ts`, `src/services/routing/google-config.ts`, the SETUP MODULE block, `busGoogleCheck`, the Bus banner and the "Use this setup at another location" card in `public/index.html`. Check: one instruction per sentence; procedural ≤ 20 words, descriptive ≤ 25; active voice, imperative; banned words; dashboard terms bold and exact; values in code; notices start WARNING:/CAUTION:/NOTE:; "Expected result:" after every Deploy/Redeploy/Create; time tags; "You can stop here."; every §6.1/§6.2 step present; glossary ≤ 15 lines; troubleshooting ≤ 25 rows; no "env var", "pooler", "JSON", "build log" in app text; a reader with no technical background could follow every step. Do NOT edit files. Return a numbered list: file:line — problem — exact replacement text. Mark any item that changes meaning (not only wording) as [MEANING]. Exempt: the spec-fixed strings (spec §3 errors, the §4.2 fix-text table, the §5.2 fix texts — they use the dashboard terms "Session pooler"/"Transaction pooler" on purpose) and environment-variable names such as `GOOGLE_SA_JSON`; report a rule break in those only if it is not a dashboard term or variable name.

- [ ] **Step 2: Apply** every wording fix; for `[MEANING]` items, check against the spec and apply only if the spec agrees. Spec-fixed texts (the §4.2 table, §3 errors, §5.2 fix texts) are not reworded unless the reviewer finds a rule break — then note the change in the commit message.
- [ ] **Step 3: Verify** `node scripts/check-guide-style.js` → OK; full gate → PASS; commit (batch E message).

---

### Task 8: Whole-branch review + local end-to-end (controller)

- [ ] **Step 1:** `superpowers:requesting-code-review` on the diff since `0203c7b` (one reviewer, most capable model). Fix confirmed findings; re-run the gate; commit `fix: review findings for multi-location rollout`.
- [ ] **Step 2: Local runner against a throwaway database (required — the baseline path is the only prod-touching code with no other integration run).** Ask the owner for a session-pooler string of a **throwaway** Supabase project (never `ltcblcudlzlzfcyzlhpc`). Paste it explicitly: `$env:DATABASE_URL='<throwaway string>'; npm run migrate -- --force`. Confirm the printed `connecting to <host>` with the owner before trusting the result. Expected: `Database up to date — 15 of 15 changes applied (15 new).` Run again → `(0 new)`. Then the owner runs `drop table schema_migrations;` in that project's SQL editor; run again → `Baseline: marked 14 existing changes as applied.`, `Applied 0015_statement_timeout.sql`, `(1 new)`. Finish with `Remove-Item Env:DATABASE_URL`. Keep the project for Task 10 or let the owner delete it.
- [ ] **Step 3: Spec coverage walk:** tick every bullet of spec §2–§7 against a commit. List anything not done in the hand-off message.

---

### Task 9: Citipointe rollout check — one time (spec §2.3) — OWNER-GATED

- [ ] **Step 1: Pre-checks (ask the owner):**
  - In Vercel (ys-connection project, Production env): `SESSION_SECRET` length ≥ 32 (else see Task 3 Step 3 note); `DATABASE_URL` is ticked for **Production** and uses port 5432; `NODE_ENV` is **not** set as a project env var (CLAUDE.md lists `NODE_ENV=production`; if it is set in Vercel, the owner removes it before the push — otherwise npm skips devDependencies, `tsx` is missing and the build fails; the old deployment keeps serving).
  - "OK to push `master`? It builds a production deployment, which runs the database update (baseline 0001–0014, apply 0015) against the live database before you promote. The live site does not change until you promote."
- [ ] **Step 2:** On a yes: `git push origin master`.
- [ ] **Step 3:** Find the new deployment (Vercel MCP `list_deployments` for project `ys-connection`, team `citipointe-youth`) and read its build output (`get_deployment` / `list_deployment_events`). Expected lines: `Baseline: marked 14 existing changes as applied.`, `Applied 0015_statement_timeout.sql`, `Database up to date — 15 of 15 changes applied (1 new).` If the build failed: read the error, do not retry blindly, report to the owner (the live deployment keeps serving).
- [ ] **Step 4:** Supabase MCP `execute_sql` (read-only) on project `ltcblcudlzlzfcyzlhpc`: `select * from schema_migrations order by version` → 15 rows, `0001`…`0015`.
- [ ] **Step 5:** Tell the owner the commit to promote. After they promote: `curl -s https://ys-connection.vercel.app/health` → `db:'ok'`, `schema.current:'0015'`; `curl -s -o /dev/null -w '%{http_code}' https://ys-connection.vercel.app/setup/status` → `401`; `curl -s https://ys-connection.vercel.app/settings | grep -o '"needsAdmin":false'`; owner logs in normally and opens Bus once (Google still "connected" via the old three vars).
- [ ] **Step 6:** (Pinning `COMMIT_SHA` in `docs/GOOGLE-SETUP.md` happens in Task 10 Step 3 — it doubles as the "update" the test fork syncs.)
- [ ] **Step 7:** Update memory: `project-bus-ministry.md` / `active-project.md` (or a new `ys-connection-auto-migrations.md`) — "migrations apply in the Vercel build since 2026-10-xx; check the `Database up to date` line before the owner promotes; never Supabase MCP `apply_migration`". Add the pointer line to `MEMORY.md`.

---

### Task 10: Acceptance run = cold walk-through + screenshots (spec §7) — OWNER + controller

Needs the owner at the keyboard for account sign-ins. Uses throwaway accounts/projects; nothing touches Citipointe.

- [ ] **Step 1: Setup.** Owner opens a fresh GitHub fork (personal account or a test org), a throwaway Supabase project, a new Vercel project, and a throwaway Google Cloud project with billing. Controller follows `docs/DEPLOYING.md` **literally**, step by step, with the owner, and keeps a list: every step where the text was unclear, wrong, or the screen differed.
- [ ] **Step 2: First deploy before secrets** — confirm: the build log shows `Database up to date — 15 of 15 changes applied (15 new).`; the app opens on the setup checklist (not a broken login); `/setup/status` body has no env values. Then add the three generated values, Redeploy, Check again → all required rows green; create the admin with the setup code copied from Vercel; log in works; Admin → System check all green; Setup wizard → Load settings file (a file exported from Citipointe) → Save → Apply account layout.
- [ ] **Step 3: Update path + pin the script** — replace `COMMIT_SHA` in `docs/GOOGLE-SETUP.md` with the SHA of the pushed commit that contains `scripts/google-setup.sh` (from Task 9); commit `docs: pin Google setup script commit`; push with the owner's OK (docs-only, no migration). The test fork is now one commit behind: on the fork page select **Sync fork** → **Update branch** → Vercel deploys by itself → build log ends `(0 new)` and the app still works.
- [ ] **Step 4: Google** — follow `docs/GOOGLE-SETUP.md` in the throwaway Google project: Cloud Shell line → two values → Vercel → Redeploy → Bus settings shows "Google: connected." → **Test Google connection** → 5 rows OK. If the owner's Google Workspace org blocks key files, verify the stop message and the Technical line, then repeat under a personal Gmail project.
- [ ] **Step 5: Screenshots** (§6.3 list 01–19): in-app screens (10 app-setup-checklist, 11 app-create-admin, 19 bus-test-google) captured by the controller from the throwaway deployment (Playwright or Chrome; values blurred); dashboard screens captured by the owner (Snipping Tool) into the scratchpad. Controller annotates each with a Python/PIL script in the scratchpad (red box on the target, resize ≤ 1200 px wide, blur project refs/IDs/emails/keys), saves to `docs/img/deploy/NN-name.png`, replaces each `[Screenshot: …]` line with `![…](img/deploy/NN-name.png)`. **Check every image by eye for real secrets, emails, billing IDs, names or student data before committing.**
- [ ] **Step 6: Fix the guides** for every unclear step from Step 1; re-run `node scripts/check-guide-style.js`; owner confirms the Vercel plan wording (Hobby vs Pro) for churches; commit `docs: acceptance-run fixes + screenshots`.
- [ ] **Step 7: Clean up** — owner deletes the test Vercel project, Supabase project, fork, and the Google project (or at least its service-account keys and API key). Controller confirms the list with the owner.
- [ ] **Step 8:** Push the docs commit with the owner's OK (docs-only; owner promotes or not — no runtime change).
- [ ] **Contingency — code fixes found in the acceptance run:** run them as a new Sonnet batch (same brief rules), review, gate, commit; push only with the owner's OK; tell the owner which commit to promote and check the build's `Database up to date` line first.
