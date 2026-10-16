// Nav/save fix round 2026-10-16, lane n6 (YS link server): S-1, S-2/D6, S-4/D5, S-6/D8, B03, B13, B18.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeLinkService, type LinkService } from '../services/link.service';
import { makeIntakeService } from '../services/link-intake.service';
import { makeSyncService } from '../services/sync.service';
import { InMemoryLinkRepository } from '../repositories/in-memory/link.repository';
import { InMemoryLinkIntakeRepository } from '../repositories/in-memory/link-intake.repository';
import { SupabaseLinkRepository } from '../repositories/supabase/supabase.link';
import {
  InMemorySettingsRepository, InMemoryStudentRepository, InMemoryLeaderRepository, InMemoryUserRepository,
  InMemoryServiceSessionRepository, InMemoryServiceAttendanceRepository,
} from '../repositories/in-memory';
import { MINISTRY_CONFIG_DEFAULTS } from '../core/ministry-config';
import type { Actor } from '../core/entities/user';
import type { Capabilities, NewOutboxRow } from '../core/link-types';
import { LinkIdExists } from '../core/errors/link-errors';

const DIR = join(__dirname, 'fixtures', 'elvanto-link');
const fx = (f: string): any => JSON.parse(readFileSync(join(DIR, f), 'utf8'));
const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = '2026-10-01T00:00:00.000Z';
const NOW = new Date('2026-10-16T09:50:00.000Z');
const DATE = '2026-10-16';
const CONSOLE = fx('push-intake.json').consoleId as string;
const ADMIN_ID = u(1), DIR_ID = u(2);
const actor = (id: string, role: string): Actor =>
  ({ id, role: role as Actor['role'], displayName: `${role} login`, grade: null, quad: null, gender: null, leaderId: null });
const ADMIN = actor(ADMIN_ID, 'admin');
const DIRECTOR = actor(DIR_ID, 'director');
const DEV = { id: 'dev-1', label: 'iPhone' };
const CAPS: Capabilities = { checkIn: 'live', checkOut: 'live', submitReport: 'live', editReport: 'live', completeStep: 'live',
  firstTimerCheckIn: 'live', intakeAnswer: 'live', intakeSave: 'live', consentSave: 'live', intakeText: 'locked',
  consentLookup: 'live', consentFix: 'live', consentLink: 'live', removeFromFlowStep: 'live' };
const SUB_S = '5b000000-0000-4000-8000-000000000001', SUB_P = '5b000000-0000-4000-8000-000000000002';
let idn = 7000;
const nid = () => u(++idn);

async function setup() {
  const clock = { now: NOW };
  const now = () => clock.now;
  const link = new InMemoryLinkRepository({ now });
  const intakeRepo = new InMemoryLinkIntakeRepository(now);
  const settings = new InMemorySettingsRepository();
  const users = new InMemoryUserRepository();
  const students = new InMemoryStudentRepository();
  const leaders = new InMemoryLeaderRepository();
  const sessions = new InMemoryServiceSessionRepository();
  const attendance = new InMemoryServiceAttendanceRepository();
  for (const r of [settings, users, students, leaders, sessions, attendance]) await r.init();
  await settings.updateSettings({ ministryConfig: { ...MINISTRY_CONFIG_DEFAULTS,
    modules: { ...MINISTRY_CONFIG_DEFAULTS.modules, intakeAdmin: 'on', checkin: 'on', lifegroupReport: 'on', flows: 'on' } } } as never);
  for (const [id, email, role] of [[ADMIN_ID, 'admin', 'admin'], [DIR_ID, 'director', 'director']] as const) {
    await users.save({ id, email, displayName: `${email} name`, role, status: 'active', createdAt: T0, updatedAt: T0 } as never);
  }
  const errorLog = { record: vi.fn(async () => {}) };
  const svc: LinkService = makeLinkService({ link, settings, students, leaders, users, serviceSessions: sessions,
    serviceAttendance: attendance, limiter: { isBlocked: () => false }, now, errorLog, intake: intakeRepo });
  const intake = makeIntakeService({ intake: intakeRepo, link, settings, status: (a) => svc.status(a), now, errorLog });
  const sync = makeSyncService({ link, settings, students, users, now, errorLog, intake });
  await link.claim({ console: { consoleId: CONSOLE, label: 'Desk', contractVersion: 1, consoleVersion: 't', inWindow: true,
    pollSeconds: 60, capabilities: CAPS, linkRev: 7 }, max: 0, leaseSeconds: 180, cutoffDays: 3, leaseLostMs: 3_600_000 });
  await sync.push('intakePlan', fx('push-intake.json'));
  await sync.push('consentPlan', fx('push-consent.json'));
  return { clock, link, intakeRepo, settings, svc, intake, sync, errorLog };
}
type Hx = Awaited<ReturnType<typeof setup>>;
const act = (type: string, payload: unknown, note: string | null = null, id = nid()) =>
  ({ kind: 'action', id, type, payload, note, leaderId: null });
const one = async (h: Hx, item: unknown, who: Actor = ADMIN) =>
  (await h.svc.batch(who, { device: DEV, sentAt: h.clock.now.toISOString(), items: [item] })).results[0]!;
const answerP = () => ({ date: DATE, family: [SUB_S, SUB_P], choices: { [SUB_S]: 'new' }, pairs: { [SUB_S]: SUB_P }, undo: false });
const NOTE = JSON.stringify({ fixes: { [SUB_S]: { last: 'Sample' } }, keeps: {} });
const claimAll = (h: Hx) => h.link.claim({ console: { consoleId: CONSOLE, label: 'Desk', contractVersion: 1, consoleVersion: 't',
  inWindow: true, pollSeconds: 60, capabilities: CAPS, linkRev: 7 }, max: 20, leaseSeconds: 180, cutoffDays: 3, leaseLostMs: 3_600_000 });

/** A fake postgres tag: records each template's strings; `begin` runs the callback with the same tag. */
function fakeSql(row: Record<string, unknown> | null) {
  const calls: string[][] = []; let began = 0;
  const tag: any = (s: TemplateStringsArray) => { calls.push([...s]); return Promise.resolve(row ? [row] : []); };
  tag.json = (v: unknown) => v;
  tag.begin = async (cb: (tx: unknown) => unknown) => { began++; return cb(tag); };
  return { tag, calls, began: () => began };
}
const dbRow = (n: NewOutboxRow) => ({ id: n.id, type: n.type, payload: n.payload, note: null, dedupe_key: n.dedupeKey,
  service_date: n.serviceDate, student_id: null, person_id: null, created_by: n.createdBy, leader_id: null, leader_name: n.leaderName,
  status: 'pending', reason: null, detail: null, attempts: 0, retry_at: null, lease_owner: null, lease_until: null, result_at: null,
  sent_log_key: null, report_id: null, created_at: NOW.toISOString(), updated_at: NOW.toISOString(), steps: null, stop: null });
const newRow = (o: Partial<NewOutboxRow> = {}): NewOutboxRow => ({ id: nid(), type: 'checkIn', payload: { personId: u(1) }, note: null,
  dedupeKey: 'k', serviceDate: DATE, studentId: null, personId: null, createdBy: ADMIN_ID, leaderId: null, leaderName: 'x', ...o });
/** The insert statement exactly as at ad0ce91 (template strings, LF). */
const INSERT_AD0CE91 = ['\n        insert into link_outbox (id, type, payload, note, dedupe_key, service_date, student_id, person_id, created_by,\n                                 leader_id, leader_name)\n        values (', ', ', ', ', ', ', ', ', ',\n                ', ', ', ', ', ', ', ', ', ', ', ')\n        on conflict (id) do nothing\n        returning *'];

// ---------------------------------------------------------------- S-4 / D5

describe('S-4 / D5: insertAction supersede (intakeAnswer is one atomic server operation)', () => {
  it('without supersede: one statement, byte-identical to ad0ce91, no transaction', async () => {
    const n = newRow();
    const g = fakeSql(dbRow(n));
    await new SupabaseLinkRepository(g.tag).insertAction(n);
    expect(g.calls).toEqual([INSERT_AD0CE91]);
    expect(g.began()).toBe(0);
  });
  it('with supersede: begin -> cancel the pending matches -> the same insert, in one transaction', async () => {
    const n = newRow({ type: 'intakeAnswer', supersede: { type: 'intakeAnswer', dedupeKey: 'ia:x' } });
    const g = fakeSql(dbRow(n));
    await new SupabaseLinkRepository(g.tag).insertAction(n);
    expect(g.began()).toBe(1);
    const upd = g.calls.findIndex((c) => c[0]!.includes("update link_outbox set status = 'cancelled'"));
    expect(upd).toBeGreaterThanOrEqual(0);
    expect(g.calls[upd]!.join('?').replace(/\s+/g, ' ')).toContain("where status = 'pending' and type = ?");
    expect(g.calls.at(-1)).toEqual(INSERT_AD0CE91);
    expect(upd).toBeLessThan(g.calls.length - 1);
  });
  it('with supersede, an id that already exists rolls the cancel back (LinkIdExists thrown inside the transaction)', async () => {
    const n = newRow({ supersede: { type: 'checkIn' } });
    const g = fakeSql(null);
    let threwInside: unknown = null;
    g.tag.begin = async (cb: (tx: unknown) => unknown) => { try { return await cb(g.tag); } catch (e) { threwInside = e; throw e; } };
    await expect(new SupabaseLinkRepository(g.tag).insertAction(n)).rejects.toBeInstanceOf(LinkIdExists);
    expect(threwInside).toBeInstanceOf(LinkIdExists);
  });
  it('memory: pending answer A, then B (no cancel item) -> A cancelled-by:B, B pending; B again -> replay', async () => {
    const h = await setup();
    const a = await one(h, act('intakeAnswer', answerP(), NOTE));
    expect(a.outcome).toBe('saved');
    const bItem = act('intakeAnswer', answerP(), NOTE);
    const b = await one(h, bItem);
    expect(b.outcome).toBe('saved');
    expect(await h.link.getAction(a.id)).toMatchObject({ status: 'cancelled', detail: `cancelled-by:${b.id}` });
    expect(await h.link.getAction(b.id)).toMatchObject({ status: 'pending' });
    expect((await one(h, bItem)).outcome).toBe('replay');
    expect((await h.link.getAction(b.id)) as any).not.toHaveProperty('supersede');
  });
  it('memory: a claimed old answer still gives duplicate, and nothing is cancelled', async () => {
    const h = await setup();
    const a = await one(h, act('intakeAnswer', answerP(), NOTE));
    await claimAll(h);
    const b = await one(h, act('intakeAnswer', answerP(), NOTE));
    expect(b).toMatchObject({ outcome: 'duplicate', existingId: a.id });
    expect(await h.link.getAction(a.id)).toMatchObject({ status: 'claimed' });
  });
  it('memory repo: a supersede that still hits an open duplicate throws and cancels nothing (atomic)', async () => {
    const link = new InMemoryLinkRepository({ now: () => NOW });
    const caps = { checkIn: 'live' } as Capabilities;
    const claimed = await link.insertAction(newRow({ dedupeKey: 'y', createdBy: 'a' }));
    await link.claim({ console: { consoleId: CONSOLE, label: 'D', contractVersion: 1, consoleVersion: 't', inWindow: true, pollSeconds: 60,
      capabilities: caps, linkRev: 7 }, max: 1, leaseSeconds: 180, cutoffDays: 3, leaseLostMs: 3_600_000 });
    const pending = await link.insertAction(newRow({ dedupeKey: 'x', createdBy: 'a' }));
    await expect(link.insertAction(newRow({ dedupeKey: 'y', supersede: { type: 'checkIn', createdBy: 'a' } })))
      .rejects.toMatchObject({ extra: { existingId: claimed.id } });
    expect(await link.getAction(pending.id)).toMatchObject({ status: 'pending' });
  });
});

// ---------------------------------------------------------------- S-6 / D8

describe('S-6 / D8: a new consentLookup cancels the same login\'s pending lookups of that kind', () => {
  const ADMIN2 = { ...ADMIN, id: u(3) };
  const look = (kind: string, page = 1) => { const id = nid(); return act('consentLookup', { kind, page, ref: id }, null, id); };
  it('same login + kind -> the first is cancelled-by the second; a claimed one still runs; other kind / login untouched', async () => {
    const h = await setup();
    const a = await one(h, look('mismatches'));
    const forms = await one(h, look('forms'));
    const other = await one(h, look('mismatches'), ADMIN2);
    const b = await one(h, look('mismatches', 2));
    expect(b.outcome).toBe('saved');
    expect(await h.link.getAction(a.id)).toMatchObject({ status: 'cancelled', detail: `cancelled-by:${b.id}` });
    expect(await h.link.getAction(forms.id)).toMatchObject({ status: 'pending' });
    expect(await h.link.getAction(other.id)).toMatchObject({ status: 'pending' });
    await claimAll(h);
    const c = await one(h, look('mismatches'));
    expect(c.outcome).toBe('saved');
    expect(await h.link.getAction(b.id)).toMatchObject({ status: 'claimed' });
    expect(await h.svc.consentLookup(ADMIN, { id: a.id })).toMatchObject({ status: 'failed' });
  });
});
