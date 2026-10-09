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
