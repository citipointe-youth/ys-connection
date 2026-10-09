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
