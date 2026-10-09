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
