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

/** One method's source, from its `async name(` to the next method (L1: each check looks inside its own slice). */
function method(name: string): string {
  const start = src.indexOf(`  async ${name}(`);
  if (start < 0) throw new Error(`no method ${name}`);
  const next = src.slice(start + 1).search(/\n  (async )?[a-zA-Z_]+\(/);
  return next < 0 ? src.slice(start) : src.slice(start, start + 1 + next);
}
const flat = (s: string) => s.replace(/\s+/g, ' ');

describe('SupabaseLinkRepository SQL text', () => {
  it('claim: one transaction; console heartbeat on the DB clock', () => {
    const c = flat(method('claim'));
    expect(c).toContain('.begin(');
    expect(c).toContain('last_seen_at = now()');
  });
  it('claim sweep: too-old on created_at, lease-lost on lease_until, both on the DB clock, in id order with skip locked', () => {
    const c = flat(method('claim'));
    expect(c).toMatch(/set status = 'refused', reason = 'too-old'.*where id in \( select id from link_outbox where status = 'pending' and created_at < now\(\) - make_interval\(days => \$\{[^}]+\}\) order by id for update skip locked\)/);
    expect(c).toMatch(/set status = 'unclear', reason = 'lease-lost'.*where id in \( select id from link_outbox where status = 'claimed' and lease_until < now\(\) - make_interval\(secs => \$\{[^}]+\}\) order by id for update skip locked\)/);
  });
  it('claim purge: roster after 90 days on updated_at, notes after 30 days on created_at, log after 400 days on at', () => {
    const c = flat(method('claim'));
    expect(c).toMatch(/delete from link_roster where active = false and match in \('none','ignored'\) and updated_at < now\(\) - interval '90 days'/);
    expect(c).toMatch(/update link_outbox set note = null where status in \('sent','refused','shadowed','cancelled'\) and note is not null and created_at < now\(\) - interval '30 days'/);
    expect(c).toContain("delete from link_log where at < now() - interval '400 days'");
  });
  it('claim lease: due rows on the DB clock, reclaim same console only, oldest first, skip locked', () => {
    const c = flat(method('claim'));
    expect(c).toContain('retry_at is null or retry_at <= now()');
    expect(c).toMatch(/status = 'claimed' and lease_until < now\(\) and lease_owner = \$\{c\.consoleId\}/);
    expect(c).toMatch(/order by created_at, id limit \$\{a\.max\} for update skip locked/);
    expect(c).toContain('lease_until = now() + make_interval(secs => ');
  });
  it('insertAction: on conflict (id) do nothing, the open-row predicate exactly as the link_outbox_open_uq index', () => {
    const pred = "status in ('pending','claimed','unclear')";
    expect(migration).toContain(`link_outbox_open_uq on link_outbox(dedupe_key)\n  where ${pred}`);
    const ins = flat(method('insertAction'));
    expect(ins).toContain('on conflict (id) do nothing returning *');
    expect(ins).toContain(pred);
    expect(ins).toContain('link_outbox_open_uq');
    expect(ins).not.toMatch(/new Date\(|Date\.now\(/); // the DB sets created_at
  });
  it('insertAction encrypts the note with the outbox AAD and the row id', () => {
    expect(flat(method('insertAction'))).toContain('maybeEncrypt(n.note, noteAad(n.id))');
    expect(src).toContain("const noteAad = (id: string) => 'link_outbox.note:' + id;");
  });
  it('listActions: newest first', () => expect(flat(method('listActions'))).toContain('order by created_at desc, id desc'));
  it('addLog: on conflict (id) do nothing', () => expect(flat(method('addLog'))).toContain('on conflict (id) do nothing'));
  it('writes jsonb only via sql.json()', () => {
    expect(src).toContain('sql.json(');
    expect(src).not.toContain('::jsonb');
    expect(src).not.toContain('JSON.stringify(');
  });
  it('never logs', () => expect(src).not.toMatch(/console\.|logger\./));
  it('applyResults: one transaction, row locked, applyOutcome, guarded update', () => {
    const body = flat(method('applyResults'));
    expect(body).toContain('.begin(');
    expect(body).toMatch(/select \* from link_outbox where id = \$\{[^}]+\} for update/);
    expect(body).toContain('applyOutcome(');
    expect(body).toMatch(/where id = \$\{[^}]+\} and status = \$\{/);
    expect(body).toMatch(/and lease_owner = \$\{consoleId\}/);
  });
  it('applyResults writes only the result columns (an unexpected column throws)', () => {
    expect(src).toContain('throw new Error(`applyResults: unexpected column ${k}`)');
    expect(flat(method('applyResults'))).toContain('RESULT_COLS[k as keyof OutboxRow] ?? fail(k)');
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
