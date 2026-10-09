import postgres from 'postgres';
import type { MigrationDb } from './runner';

const LOCK_KEY = 7201010001; // fixed bigint: only one build migrates at a time

export function postgresMigrationDb(url: string): MigrationDb {
  // Session pooler (port 5432) is required for the session-level advisory lock.
  // statement_timeout 0 / lock_timeout 60s are set as session statements in lock() (startup params are unreliable through the pooler).
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  return {
    async lock() {
      await sql`set statement_timeout = 0`; // the role default (15 s) must not cut a long data migration
      await sql`set lock_timeout = '60s'`; // bounded wait for the advisory lock and table locks
      await sql`select pg_advisory_lock(${LOCK_KEY})`;
    },
    async unlock() { await sql`select pg_advisory_unlock(${LOCK_KEY})`.catch(() => {}); },
    async ensureTable() {
      await sql`create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())`;
      // Supabase grants the Data API roles access to new public tables: lock this one down (no policies needed, the runner is the owner).
      await sql`alter table schema_migrations enable row level security`;
    },
    async appliedVersions() {
      return (await sql<{ version: string }[]>`select version from schema_migrations`).map((r) => r.version);
    },
    async tableExists(name) {
      const [r] = await sql<{ t: string | null }[]>`select to_regclass(${name})::text as t`;
      return !!r?.t;
    },
    async markApplied(versions) {
      if (versions.length === 0) return;
      // One statement = atomic: a dropped connection never leaves a part-recorded baseline.
      await sql`insert into schema_migrations ${sql(versions.map((version) => ({ version })))} on conflict do nothing`;
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
