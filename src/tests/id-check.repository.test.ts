// ID Checks repositories (Task 8, spec 2026-10-30 §7.1-7.2). Memory repo + the Supabase row codec always; the real-DB
// block runs where LINK_TEST_DATABASE_URL is set (CI's throwaway Postgres) inside a rolled-back transaction.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { InMemoryIdCheckRepository } from '../repositories/in-memory/id-checks.repository';
import { SupabaseIdCheckRepository, toRow, fromRow } from '../repositories/supabase/supabase.id-checks';
import { SupabaseLeaderRepository } from '../repositories/supabase/supabase.leaders';
import type { IIdCheckRepository } from '../repositories/interfaces/entity-repositories';
import type { SqlClient } from '../repositories/supabase/client';
import type { IdCheckEntry } from '../core/entities/id-check';
import { LATEST_MIGRATION } from '../core/schema-version';

const SECRET = 'Sample secret about Dummyton family';
function entry(over: Partial<IdCheckEntry> = {}): IdCheckEntry {
  return {
    id: randomUUID(), leaderId: null, leaderName: 'Sample Dummyton', kind: 'check', heldOn: '2026-10-20', finished: false,
    authorId: randomUUID(), authorName: 'Ovie Codeman',
    content: { answers: { faith01: { asked: true, note: SECRET } }, nextTime: 'Ask about camp' },
    createdAt: '2026-10-20T01:00:00.000Z', updatedAt: '2026-10-20T01:00:00.000Z', ...over,
  };
}

type Harness = { repo: IIdCheckRepository; leader: () => Promise<string>; dropLeader: (id: string) => Promise<void>;
  dropAllLeaders: () => Promise<void>; user: () => Promise<string> };
type Case = (name: string, body: () => Promise<void>) => void;
/** Shared behaviour; `dropLeader` deletes the leader the way that backend does. `it` is injectable so the real-DB
 *  block can wrap every case in a rolled-back transaction. */
function suite(it: Case, make: () => Promise<Harness>) {
  it('upsert is idempotent; finished never goes back; kind and author never change', async () => {
    const { repo, leader } = await make();
    const L = await leader();
    const e = entry({ leaderId: L });
    await repo.upsert({ ...e, finished: true });
    const second = await repo.upsert({ ...e, finished: false, kind: 'note', authorId: randomUUID(), heldOn: '2026-10-21' });
    expect(second.finished).toBe(true);
    expect(second.kind).toBe('check');
    expect(second.authorId).toBe(e.authorId);
    expect(second.heldOn).toBe('2026-10-21');
    expect(await repo.listByLeader(L)).toHaveLength(1);
  });

  it('lastFinished ignores unfinished checks and notes; inProgress is the newest unfinished check', async () => {
    const { repo, leader } = await make();
    const L = await leader();
    await repo.upsert(entry({ leaderId: L, heldOn: '2026-09-01', finished: true }));
    await repo.upsert(entry({ leaderId: L, heldOn: '2026-10-01', kind: 'note', content: { text: 'n' } }));
    await repo.upsert(entry({ leaderId: L, heldOn: '2026-10-05' }));
    const newest = entry({ leaderId: L, heldOn: '2026-10-09', authorName: 'Ree Codeman' });
    await repo.upsert(newest);
    expect((await repo.lastFinished([L])).get(L)).toBe('2026-09-01');
    expect((await repo.inProgress([L])).get(L)).toEqual({ id: newest.id, authorId: newest.authorId, authorName: 'Ree Codeman' });
    expect((await repo.listByLeader(L)).map((e) => e.heldOn)).toEqual(['2026-10-09', '2026-10-05', '2026-10-01', '2026-09-01']);
  });

  it('a deleted leader archives the entries by name and drops the ticks; delete and attach', async () => {
    const { repo, leader, dropLeader, user } = await make();
    const L = await leader();
    const U = await user();
    await repo.setTicks(U, [L], true);
    expect(await repo.ticksForLeader(L)).toEqual([{ leaderId: L, userId: U }]);
    await repo.upsert(entry({ leaderId: L, heldOn: '2026-10-01', finished: true }));
    await repo.upsert(entry({ leaderId: L, heldOn: '2026-10-20', kind: 'note', content: { text: SECRET } }));
    await dropLeader(L);
    expect(await repo.listByLeader(L)).toEqual([]);
    expect(await repo.ticksForLeader(L)).toEqual([]);
    expect((await repo.ticks()).filter((t) => t.leaderId === L)).toEqual([]);
    const groups = (await repo.archivedGroups()).filter((g) => g.name === 'Sample Dummyton');
    expect(groups).toEqual([{ name: 'Sample Dummyton', count: 2, lastOn: '2026-10-20' }]);
    expect(JSON.stringify(groups)).not.toContain(SECRET);
    const L2 = await leader();
    expect(await repo.attachArchived('Sample Dummyton', L2, 'Sample Dummyton-Two')).toBe(2);
    const moved = await repo.listByLeader(L2);
    expect(moved.map((e) => e.leaderName)).toEqual(['Sample Dummyton-Two', 'Sample Dummyton-Two']);
    await dropLeader(L2);
    expect(await repo.deleteArchived('Sample Dummyton-Two')).toBe(2);
    expect((await repo.archivedGroups()).filter((g) => g.name.startsWith('Sample Dummyton'))).toEqual([]);
  });

  it('deleting every leader (Full Reset) keeps the entries archived with their names; ticks go', async () => {
    const { repo, leader, dropAllLeaders, user } = await make();
    const [L, U] = [await leader(), await user()];
    await repo.setTicks(U, [L], true);
    await repo.upsert(entry({ leaderId: L, leaderName: 'Ree Dummyton', heldOn: '2026-10-02', finished: true }));
    await repo.upsert(entry({ leaderId: L, leaderName: 'Ree Dummyton', heldOn: '2026-10-09' }));
    await dropAllLeaders();
    expect(await repo.ticks()).toEqual([]);
    expect((await repo.archivedGroups()).filter((g) => g.name === 'Ree Dummyton'))
      .toEqual([{ name: 'Ree Dummyton', count: 2, lastOn: '2026-10-09' }]);
  });

  it('setTicks on and off for a whole column; deleteEntry', async () => {
    const { repo, leader, user } = await make();
    const [A, B, U] = [await leader(), await leader(), await user()];
    await repo.setTicks(U, [A, B], true);
    await repo.setTicks(U, [A, B], true); // twice = no duplicate
    expect((await repo.ticks()).filter((t) => t.userId === U)).toHaveLength(2);
    await repo.setTicks(U, [A], false);
    expect((await repo.ticks()).filter((t) => t.userId === U)).toEqual([{ leaderId: B, userId: U }]);
    const e = await repo.upsert(entry({ leaderId: A }));
    await repo.deleteEntry(e.id);
    expect(await repo.findEntry(e.id)).toBeNull();
  });
}

describe('IIdCheckRepository (memory)', () => {
  suite(it, async () => {
    const leaders = new Set<string>();
    const repo = new InMemoryIdCheckRepository(async (id) => leaders.has(id));
    return {
      repo,
      leader: async () => { const id = randomUUID(); leaders.add(id); return id; },
      dropLeader: async (id) => { leaders.delete(id); },
      dropAllLeaders: async () => { leaders.clear(); },
      user: async () => randomUUID(),
    };
  });
});

describe('Supabase row codec', () => {
  beforeAll(() => { process.env['FIELD_ENCRYPTION_KEY'] ??= randomBytes(32).toString('base64'); });
  it('encrypts content; fromRow(toRow(e)) round-trips', () => {
    const e = entry({ leaderId: randomUUID(), finished: true });
    const row = toRow(e);
    expect(row.content.startsWith('v1.')).toBe(true);
    expect(row.content).not.toContain('Sample secret');
    expect(row.content).not.toContain('camp');
    expect(fromRow(row)).toEqual(e);
    expect(fromRow({ ...row, held_on: new Date('2026-10-20T00:00:00Z') }).heldOn).toBe('2026-10-20');
  });
  it('content is bound to its own id (a copied value does not decrypt)', () => {
    const a = entry(), b = entry();
    expect(() => fromRow({ ...toRow(b), content: toRow(a).content })).toThrow();
  });
});

describe('0053 migration', () => {
  const SQL = readFileSync(join(__dirname, '..', '..', 'supabase', 'migrations', '0053_id_checks.sql'), 'utf8');
  it('is additive, keeps history on leader delete and turns RLS on', () => {
    expect(SQL).toMatch(/create table if not exists id_check_access/);
    expect(SQL).toMatch(/create table if not exists id_check_entries/);
    expect(SQL).toMatch(/references leaders\(id\) on delete set null/);
    expect(SQL).toMatch(/references leaders\(id\) on delete cascade/);
    expect(SQL).toMatch(/alter table id_check_entries enable row level security/);
    expect(SQL).toMatch(/alter table id_check_access enable row level security/);
    const body = SQL.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
    expect(body).not.toMatch(/\b(drop|delete from|update|truncate|rename)\b/i);
  });
  it('LATEST_MIGRATION is 0053', () => { expect(LATEST_MIGRATION).toBe('0053'); });
  it('leaders.deleteAll never truncates (TRUNCATE CASCADE ignores SET NULL and would empty id_check_entries)', () => {
    const src = readFileSync(join(__dirname, '..', 'repositories', 'supabase', 'supabase.leaders.ts'), 'utf8');
    expect(src).not.toMatch(/sql`\s*truncate/i);
  });
  it('every other FK to leaders is ON DELETE CASCADE, so a plain DELETE clears what TRUNCATE CASCADE did', () => {
    const dir = join(__dirname, '..', '..', 'supabase', 'migrations');
    const fks = readdirSync(dir).flatMap((f) => readFileSync(join(dir, f), 'utf8').split(/\r?\n/)
      .filter((l) => /references\s+(public\.)?leaders\b/i.test(l)).map((l) => l.replace(/--.*/, '').trim()));
    expect(fks.length).toBeGreaterThan(0);
    for (const l of fks) expect(l, l).toMatch(/on delete (cascade|set null)/i);
    expect(fks.filter((l) => /set null/i.test(l))).toEqual([expect.stringMatching(/^leader_id uuid references leaders\(id\) on delete set null/)]);
  });
});

const URL = process.env['LINK_TEST_DATABASE_URL'];
const PROD_REF = 'ltcblcudlzlzfcyzlhpc';
class Rollback extends Error {}
describe.skipIf(!URL || URL.includes(PROD_REF))('IIdCheckRepository (supabase, real DB, rolled back)', () => {
  const sql = URL && !URL.includes(PROD_REF) ? postgres(URL, { max: 1, onnotice: () => {} }) : null;
  let tx: SqlClient | null = null;
  beforeAll(() => { process.env['FIELD_ENCRYPTION_KEY'] ??= randomBytes(32).toString('base64'); });
  afterAll(async () => { await sql?.end({ timeout: 5 }); });
  const inTx: Case = (name, body) => it(name, async () => {
    try {
      await sql!.begin(async (t) => { tx = t as unknown as SqlClient; await body(); throw new Rollback(); });
    } catch (e) { if (!(e instanceof Rollback)) throw e; } finally { tx = null; }
  });
  suite(inTx, async () => {
    const q = tx!;
    return {
      repo: new SupabaseIdCheckRepository(q),
      leader: async () => (await q`insert into leaders (full_name) values ('Sample Dummyton') returning id`)[0]!['id'] as string,
      dropLeader: async (id) => { await q`delete from leaders where id = ${id}`; },
      dropAllLeaders: () => new SupabaseLeaderRepository(q).deleteAll(), // the Full Reset path
      user: async () => (await q`insert into users (display_name, email, role)
        values ('Ovie Codeman', ${'idc-' + randomUUID()}, 'oversight') returning id`)[0]!['id'] as string,
    };
  });
});
