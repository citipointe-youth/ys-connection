import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
  it('claim sweep: too-old on created_at, lease-lost on lease_until (not the claiming console), both on the DB clock, in id order with skip locked', () => {
    const c = flat(method('claim'));
    expect(c).toMatch(/set status = 'refused', reason = 'too-old'.*where id in \( select id from link_outbox where status = 'pending' and created_at < now\(\) - make_interval\(days => \$\{[^}]+\}\) order by id for update skip locked\)/);
    expect(c).toMatch(/set status = 'unclear', reason = 'lease-lost'.*where id in \( select id from link_outbox where status = 'claimed' and lease_until < now\(\) - make_interval\(secs => \$\{[^}]+\}\) and lease_owner <> \$\{c\.consoleId\} order by id for update skip locked\)/);
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
  it('B4 / APP-3: claim does not lease a checkOut while an older checkIn for the same person and service is open', () => {
    expect(flat(method('claim'))).toMatch(/and not \(o\.type = 'checkOut' and exists \( select 1 from link_outbox i where i\.type = 'checkIn' and i\.person_id = o\.person_id and i\.payload->>'serviceTimeId' = o\.payload->>'serviceTimeId' and i\.status in \('pending','claimed'\) and \(i\.created_at, i\.id\) < \(o\.created_at, o\.id\)\)\)/);
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
  it('T4: a flow mobile is encrypted on write and decrypted on read, bound to its row', () => {
    expect(src).toContain("const mobileAad = (rowId: string) => 'link_flow_people.mobile:' + rowId;");
    expect(flat(method('replaceMirror'))).toContain('mobile: maybeEncrypt(f.mobile ?? null, mobileAad(f.rowId))');
    expect(flat(method('flows'))).toContain('mobile: maybeDecrypt(r.mobile, mobileAad(r.row_id))');
  });
  it('T6: the flows push drops assignments whose (flow, person) it no longer carries, in the same transaction', () => {
    expect(flat(method('replaceMirror'))).toMatch(/delete from link_flow_assign a where not exists \( select 1 from link_flow_people f where f\.flow_id = a\.flow_id and f\.person_id = a\.person_id\)/);
  });
  it('0018 is additive and turns RLS on for link_flow_assign', () => {
    const m = readFileSync(join(ROOT, 'supabase', 'migrations', '0018_link_ux_batch.sql'), 'utf8');
    expect(m).not.toMatch(/\b(drop|rename|alter column)\b/i);
    expect(m).toMatch(/alter table link_flow_assign enable row level security/);
  });
});

// DB block (ledger 24, V2): run ONCE by the operator on the real database, only in the window after the prod build
// has applied 0017 and before the New person switch leaves Off (the link tables are empty until the practice Friday).
// Skipped unless LINK_TEST_DATABASE_URL is set. It never runs a migration, refuses production unless
// LINK_TEST_ALLOW_PROD=1, refuses unless all 8 link tables are empty, truncates only those 8 tables (before each test
// and once more at the end), and holds at most 2 connections. No other table is read or written.
const URL = process.env['LINK_TEST_DATABASE_URL'];
const PROD_REF = 'ltcblcudlzlzfcyzlhpc';
if (URL && URL.includes(PROD_REF) && process.env['LINK_TEST_ALLOW_PROD'] !== '1') {
  throw new Error('LINK_TEST_DATABASE_URL points at production. Set LINK_TEST_ALLOW_PROD=1 to run V2 there (ledger 24: only '
    + 'after 0017 has landed and before the switch leaves Off).');
}
const TABLES = ['link_outbox', 'link_roster', 'link_services', 'link_groups', 'link_flow_people', 'link_console',
  'link_mirror_state', 'link_log'] as const;
const KEY: Record<string, string> = { link_outbox: 'id', link_roster: 'person_id', link_log: 'id' };

if (URL) {
  process.env['FIELD_ENCRYPTION_KEY'] ??= randomBytes(32).toString('base64');
  // One client for the whole run (max 2 connections), shared by every harness.
  const sql = postgres(URL, { max: 2, prepare: false, onnotice: () => {} });
  const truncate = () => sql.unsafe(`truncate ${TABLES.join(', ')}`);
  let ready = false; // set only once every check passed: nothing is ever truncated before that

  describe('ILinkRepository on a real database (V2)', () => {
    beforeAll(async () => {
      for (const t of TABLES) {
        const [r] = await sql`select to_regclass(${'public.' + t}) is not null as ok`;
        if (!r?.ok) throw new Error(`0017 not applied: table ${t} is missing. Push so the prod build applies 0017, then run again.`);
      }
      for (const t of TABLES) {
        const [r] = await sql`select exists (select 1 from ${sql(t)}) as used`;
        if (r?.used) {
          throw new Error(`${t} is not empty. Refusing to run: this run is only for the empty window after 0017 lands and `
            + 'before the practice Friday (the switch still Off). Nothing was changed.');
        }
      }
      ready = true;
    }, 30_000);
    afterAll(async () => {
      try { if (ready) await truncate(); } finally { await sql.end({ timeout: 5 }); }
    }, 30_000);

    describeLinkRepo('supabase', async (opts) => {
      if (!ready) throw new Error('V2 checks did not pass; not touching the database.');
      await truncate();
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
        cleanup: async () => {}, // the shared client is ended once, after the last test
      };
    });
  });
} else {
  describe.skip('ILinkRepository (supabase) - set LINK_TEST_DATABASE_URL to run V2 (ledger 24)', () => { it('skipped', () => {}); });
}
