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
