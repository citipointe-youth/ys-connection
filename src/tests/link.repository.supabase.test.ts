import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { SupabaseLinkRepository } from '../repositories/supabase/supabase.link';
import { maybeDecrypt } from '../utils/field-crypto';
import { describeLinkRepo } from './helpers/link-repo-suite';

const ROOT = join(__dirname, '..', '..');
const src = readFileSync(join(ROOT, 'src', 'repositories', 'supabase', 'supabase.link.ts'), 'utf8');
const migration = readFileSync(join(ROOT, 'supabase', 'migrations', '0017_elvanto_link.sql'), 'utf8').replace(/\r\n/g, '\n');

describe('SupabaseLinkRepository SQL text', () => {
  it('leases with skip locked', () => expect(src).toMatch(/for update skip locked/i));
  it('uses the DB clock for the sweep, purge and lease compares', () => {
    for (const s of ['retry_at <= now()', 'created_at < now() - ', 'lease_until < now() - ', 'updated_at < now() - ',
      'at < now() - ', 'last_seen_at = now()']) expect(src, s).toContain(s);
  });
  it('checks lease_owner in the reclaim', () => expect(src).toMatch(/lease_until < now\(\) and lease_owner = /));
  it('uses the open-row predicate exactly as the link_outbox_open_uq index', () => {
    const pred = "status in ('pending','claimed','unclear')";
    expect(migration).toContain(`link_outbox_open_uq on link_outbox(dedupe_key)\n  where ${pred}`);
    expect(src).toContain(pred);
  });
  it('writes jsonb only via sql.json()', () => {
    expect(src).toContain('sql.json(');
    expect(src).not.toContain('::jsonb');
    expect(src).not.toContain('JSON.stringify(');
  });
  it('never logs', () => expect(src).not.toMatch(/console\.|logger\./));
  it('encrypts the note with the outbox AAD', () => {
    expect(src).toContain("maybeEncrypt(");
    expect(src).toContain("'link_outbox.note:' + ");
  });
});

// DB block: a scratch database only (never prod). Skipped unless LINK_TEST_DATABASE_URL is set.
const URL = process.env['LINK_TEST_DATABASE_URL'];
const PROD_REF = 'ltcblcudlzlzfcyzlhpc';
if (URL && URL.includes(PROD_REF)) throw new Error('LINK_TEST_DATABASE_URL points at production. Refusing to run.');
const TABLES = ['link_outbox', 'link_roster', 'link_services', 'link_groups', 'link_flow_people', 'link_console',
  'link_mirror_state', 'link_log'];
const KEY: Record<string, string> = { link_outbox: 'id', link_roster: 'person_id', link_log: 'id' };

if (URL) {
  process.env['FIELD_ENCRYPTION_KEY'] ??= randomBytes(32).toString('base64');
  let migrated = false;
  describeLinkRepo('supabase', async (opts) => {
    const sql = postgres(URL, { max: 2, prepare: false, onnotice: () => {} });
    if (!migrated) { await sql.unsafe(migration); migrated = true; }
    await sql.unsafe(`truncate ${TABLES.join(', ')}`);
    const base = (n: string, id: string) => maybeDecrypt(n, 'link_outbox.note:' + id)!;
    const repo = new SupabaseLinkRepository(sql, opts?.decrypt
      ? { decrypt: (n, id) => opts.decrypt!(base(n, id), id) } : {});
    return {
      repo,
      backdate: async (table, id, column, iso) => {
        await sql`update ${sql(table)} set ${sql(column)} = ${iso} where ${sql(KEY[table]!)} = ${id}`;
      },
      peekNote: async (id) => {
        const [r] = await sql`select note from link_outbox where id = ${id}`;
        return r?.note == null ? null : base(r.note as string, id);
      },
      cleanup: async () => { await sql.end({ timeout: 5 }); },
    };
  });
} else {
  describe.skip('ILinkRepository (supabase) — set LINK_TEST_DATABASE_URL to a scratch database', () => { it('skipped', () => {}); });
}
