import { join } from 'node:path';
import { runMigrations, listMigrationFiles, shouldRun, MigrationAbort, type MigrationDb } from '../src/migrate/runner';
import { postgresMigrationDb } from '../src/migrate/postgres-db';
import { checkDatabaseUrl } from '../src/migrate/url-check';
import { redactSecrets } from '../src/utils/redact';

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
  const check = checkDatabaseUrl(url);
  if (!check.ok) { console.error(check.message); return 1; }
  console.log(`Database update: connecting to ${check.host}`); // host only - never the password
  let db: MigrationDb | undefined;
  try {
    db = postgresMigrationDb(url); // inside the try: a bad URL must not print the raw error
    await runMigrations(db, listMigrationFiles(join(__dirname, '..', 'supabase', 'migrations')), (l) => console.log(l));
    return 0;
  } catch (err) {
    console.error(redactSecrets(err instanceof MigrationAbort ? err.message : `Database update failed: ${err instanceof Error ? err.message : String(err)}`));
    return 1;
  } finally {
    await db?.close().catch(() => {});
  }
}

// Never print the caught value: it can carry the connection string.
main().catch(() => {
  console.error('Database update failed. Copy the last 20 lines of the Build Logs to the developer.');
  return 1;
}).then((code) => process.exit(code));
