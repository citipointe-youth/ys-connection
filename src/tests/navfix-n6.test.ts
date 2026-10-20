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
import { PUSH_SCHEMAS, ResultRequest } from '../core/link-contract';
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
  firstTimerCheckIn: 'live', intakeAnswer: 'live', intakeSave: 'live', consentSave: 'live', intakeText: 'live',
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

// ---------------------------------------------------------------- S-2 / D6

describe('S-2 / D6: the too-old sweep also runs on link reads (gate), at most every 5 min per instance', () => {
  it('a 4-day pending check-in: GET /link/status refuses it too-old and logs it, with no console claim', async () => {
    const h = await setup();
    const r = await h.link.insertAction(newRow());
    const intake = await h.link.insertAction(newRow({ type: 'intakeSave', dedupeKey: 'is' }));
    h.clock.now = new Date(NOW.getTime() + 4 * 86_400_000);
    await h.svc.status(ADMIN);
    expect(await h.link.getAction(r.id)).toMatchObject({ status: 'refused', reason: 'too-old' });
    expect(await h.link.getAction(intake.id)).toMatchObject({ status: 'refused', reason: 'too-old' });
    expect(h.errorLog.record).toHaveBeenCalledWith({ category: 'link', code: 'too-old', route: 'checkIn', role: 'console', count: 1 });
  });
  it('thresholds unchanged: a 2-day check-in stays pending; a 25 h intake row is swept', async () => {
    const h = await setup();
    const r = await h.link.insertAction(newRow());
    const intake = await h.link.insertAction(newRow({ type: 'intakeSave', dedupeKey: 'is' }));
    h.clock.now = new Date(NOW.getTime() + 25 * 3_600_000);
    await h.svc.status(ADMIN);
    expect(await h.link.getAction(r.id)).toMatchObject({ status: 'pending' });
    expect(await h.link.getAction(intake.id)).toMatchObject({ status: 'refused', reason: 'too-old' });
  });
  it('throttled: one sweep per 5 min; a sweep failure never fails the read', async () => {
    const h = await setup();
    const spy = vi.spyOn(h.link, 'sweepTooOld');
    await h.svc.status(ADMIN); await h.svc.status(ADMIN);
    expect(spy).toHaveBeenCalledTimes(1);
    h.clock.now = new Date(NOW.getTime() + 5 * 60_000);
    spy.mockRejectedValueOnce(new Error('db down'));
    await expect(h.svc.status(ADMIN)).resolves.toBeTruthy();
    expect(spy).toHaveBeenCalledTimes(2);
  });
  it('Supabase: claim and the read path share sweepTooOld (same too-old SQL, skip locked)', () => {
    const src = readFileSync(join(__dirname, '..', 'repositories', 'supabase', 'supabase.link.ts'), 'utf8').replace(/\s+/g, ' ');
    expect(src).toContain('await this.sweepTooOld(a.cutoffDays, tx as unknown as SqlClient)');
    expect(src).toMatch(/async sweepTooOld\(cutoffDays: number, q: SqlClient = this\.sql\)/);
    expect(src).toMatch(/set status = 'refused', reason = 'too-old'.*created_at < now\(\) - make_interval\(days => \$\{cutoffDays\}\) order by id for update skip locked/);
  });
});

// ---------------------------------------------------------------- S-1 / D7

describe('S-1 / D7: the last refused result comes back from the server after you leave the screen', () => {
  const G1 = '6a000000-0000-4000-8000-000000000001', G2 = '6a000000-0000-4000-8000-000000000002';
  const ROW1 = fx('push-flows-rev6.json').rows[0], ROW3 = fx('push-flows-rev6.json').rows[2];
  const rep = (groupId: string, date = DATE) => newRow({ type: 'submitReport', dedupeKey: `report:${groupId}:${date}:${nid()}`, serviceDate: date,
    payload: { groupId, date, didNotMeet: false, attendees: [], guests: 0, serviceTimeId: null } });
  const step = (r: any) => newRow({ type: 'completeStep', dedupeKey: `complete:${r.rowId}:${nid()}`,
    payload: { rowId: r.rowId, flowId: r.flowId, stepId: r.stepId, personId: r.personId } });
  async function finish(h: Hx, id: string, outcome: 'refused' | 'sent') {
    await claimAll(h);
    const item = outcome === 'refused' ? { id, outcome, reason: 'report-exists', detail: 'x' } : { id, outcome, sentLogKey: `k:${id}` };
    const res = await h.link.applyResults(CONSOLE, [item as never], h.clock.now);
    expect(res.applied).toEqual([id]);
  }
  async function pushed(h: Hx) {
    await h.sync.push('groups', fx('push-groups.json'));
    await h.sync.push('flows', fx('push-flows-rev6.json'));
  }
  const grp = async (h: Hx, id: string) => (await h.svc.lifegroups(ADMIN)).groups.find((g) => g.groupId === id)!;
  const flow = async (h: Hx, rowId: string) => (await h.svc.flows(ADMIN)).rows.find((r) => r.rowId === rowId)!;

  it('lifegroups: a refused report -> lastRefused (reason only); a later sent report -> null; an open row -> null', async () => {
    const h = await setup(); await pushed(h);
    const a = await h.link.insertAction(rep(G1));
    await finish(h, a.id, 'refused');
    expect((await grp(h, G1)).lastRefused).toEqual({ id: a.id, type: 'submitReport', status: 'refused', reason: 'report-exists' });
    expect((await grp(h, G2)).lastRefused).toBeUndefined();
    const b = await h.link.insertAction(rep(G1, '2026-10-15'));
    await finish(h, b.id, 'sent');
    expect((await grp(h, G1)).lastRefused).toBeUndefined();
    const c = await h.link.insertAction(rep(G2));
    await finish(h, c.id, 'refused');
    await h.link.insertAction(rep(G2, '2026-10-14'));
    const g2 = await grp(h, G2);
    expect(g2.openAction).not.toBeNull();
    expect(g2.lastRefused).toBeUndefined();
  });
  it('RV-S-m3: a later row that was cancelled clears the refused line (it is the newest final row)', async () => {
    const h = await setup(); await pushed(h);
    const a = await h.link.insertAction(rep(G1));
    await finish(h, a.id, 'refused');
    h.clock.now = new Date(NOW.getTime() + 1000);
    const b = await h.link.insertAction(rep(G1, '2026-10-15'));
    expect(await h.link.cancelPending(b.id)).toBe(true);
    expect((await grp(h, G1)).lastRefused).toBeUndefined();
  });
  it('lifegroups: a refusal older than the 8-week submit window is not shown (T3, 2026-10-21)', async () => {
    const h = await setup(); await pushed(h);
    const a = await h.link.insertAction(rep(G1, '2026-08-20'));
    await finish(h, a.id, 'refused');
    expect((await grp(h, G1)).lastRefused).toBeUndefined();
  });
  it('lifegroups: a refused submit 30 days back still shows (T3, 2026-10-21)', async () => {
    const h = await setup(); await pushed(h);
    const a = await h.link.insertAction(rep(G1, '2026-09-16'));
    await finish(h, a.id, 'refused');
    expect((await grp(h, G1)).lastRefused).toMatchObject({ id: a.id, status: 'refused' });
  });
  it('flows: a refused Complete -> lastRefused on that row; a later sent one -> null', async () => {
    const h = await setup(); await pushed(h);
    const a = await h.link.insertAction(step(ROW1));
    await finish(h, a.id, 'refused');
    expect((await flow(h, ROW1.rowId)).lastRefused).toMatchObject({ id: a.id, status: 'refused', reason: 'report-exists' });
    expect((await flow(h, ROW3.rowId)).lastRefused).toBeUndefined();
    const b = await h.link.insertAction(step(ROW1));
    await finish(h, b.id, 'sent');
    expect((await flow(h, ROW1.rowId)).lastRefused).toBeUndefined();
  });
  it('listActions: fixKey (consentFix = personId, consentLink = cn:<subId>) for the admin only; type-only capped at 100', async () => {
    const h = await setup();
    const P = u(900), S = u(901);
    const fix = await h.link.insertAction(newRow({ type: 'consentFix', dedupeKey: `cf:${P}`, personId: P, payload: { personId: P } }));
    const ln = await h.link.insertAction(newRow({ type: 'consentLink', dedupeKey: `cn:${S}`, payload: { subId: S, personId: P } }));
    expect((await h.svc.listActions(ADMIN, { type: 'consentFix' })).map((r) => [r.id, r.fixKey])).toEqual([[fix.id, P]]);
    expect((await h.svc.listActions(ADMIN, { type: 'consentLink' })).map((r) => [r.id, r.fixKey])).toEqual([[ln.id, `cn:${S}`]]);
    await h.link.insertAction(newRow({ type: 'consentFix', dedupeKey: 'cf:d', createdBy: DIR_ID, payload: { personId: P } }));
    const dir = await h.svc.listActions(DIRECTOR, { type: 'consentFix' });
    expect(dir).toHaveLength(1);
    expect(dir[0]).not.toHaveProperty('fixKey');
    for (let i = 0; i < 105; i++) await h.link.insertAction(newRow({ type: 'consentFix', dedupeKey: `cf:${i}`, payload: { personId: P } }));
    const many = await h.svc.listActions(ADMIN, { type: 'consentFix' });
    expect(many).toHaveLength(100);
    expect(many.some((r) => r.id === fix.id)).toBe(false); // newest first: the oldest fell off
  });
});

// ---------------------------------------------------------------- B03

describe('B03: the claim hint hurries only for rows the console can lease now', () => {
  const T = new Date('2026-10-16T08:00:00Z');
  const svc = (pending: Record<string, unknown>[]) => makeIntakeService({
    link: { listActions: async () => pending } as never,
    intake: { purge: async () => undefined, viewedAt: async () => null, dates: async () => [] } as never,
    settings: {} as never, status: async () => ({}) as never, now: () => T });
  const S = (intakeAdmin: string) => ({ ministryConfig: { modules: { intakeAdmin } } }) as never;
  const later = new Date(T.getTime() + 300_000).toISOString(), before = new Date(T.getTime() - 1000).toISOString();
  it('only a future-retryAt row -> hurry false (on and off); a due retry -> true', async () => {
    for (const m of ['on', 'off']) {
      expect((await svc([{ type: 'consentLookup', reason: 'console-busy', retryAt: later }]).hint(S(m))).hurry).toBe(false);
      expect((await svc([{ type: 'consentLookup', reason: 'console-busy', retryAt: before }]).hint(S(m))).hurry).toBe(true);
    }
  });
  it('a type the console does not lease (capability off or missing) -> no hurry; no caps given -> as before', async () => {
    const rows = [{ type: 'intakeText', reason: null, retryAt: null }];
    expect((await svc(rows).hint(S('on'), { checkIn: 'live', intakeText: 'off' } as Capabilities)).hurry).toBe(false);
    expect((await svc(rows).hint(S('on'), { checkIn: 'live' } as Capabilities)).hurry).toBe(false);
    expect((await svc(rows).hint(S('on'), { intakeText: 'live' } as Capabilities)).hurry).toBe(true);
    expect((await svc(rows).hint(S('on'))).hurry).toBe(true);
  });
  it('the claim passes its own (intake-stripped) capabilities to the hint', async () => {
    const h = await setup();
    const spy = vi.spyOn(h.intake, 'hint');
    await h.sync.claim({ ...fx('claim-request.json'), linkRev: 12, max: 0 });
    expect(spy.mock.calls[0]![1]).toEqual(expect.objectContaining({ checkIn: expect.any(String) }));
  });
});

// ---------------------------------------------------------------- B18

describe('B18: GET /link/intake marks the view only on page entry (view=1), not on every quiet reload', () => {
  it('no view param -> viewed_at unchanged; view=1 -> marked (dates list or one date)', async () => {
    const h = await setup();
    await h.intake.list(ADMIN, { mode: 'intake' });
    await h.intake.list(ADMIN, { mode: 'intake', date: DATE });
    expect(await h.intakeRepo.viewedAt()).toBeNull();
    await h.intake.list(ADMIN, { mode: 'intake', date: DATE, view: '1' });
    expect(await h.intakeRepo.viewedAt()).toBe(NOW.toISOString());
    h.clock.now = new Date(NOW.getTime() + 60_000);
    await h.intake.list(ADMIN, { mode: 'intake', view: '0' });
    expect(await h.intakeRepo.viewedAt()).toBe(NOW.toISOString());
    await h.intake.list(ADMIN, { mode: 'intake', view: '1' });
    expect(await h.intakeRepo.viewedAt()).toBe(h.clock.now.toISOString());
  });
});

// ---------------------------------------------------------------- B13 (YS half)

describe('B13: the shared rev-7 fixtures parse with the link-contract schemas (11.1 keeps byte-identical copies)', () => {
  const raw = (f: string) => readFileSync(join(DIR, f));
  it('result-request-rev7.json: a sent removeFromFlowStep with note failed (C-1, F-37)', () => {
    const r = ResultRequest.parse(fx('result-request-rev7.json'));
    expect(r.results[0]).toMatchObject({ outcome: 'sent', note: 'failed' });
  });
  it('push-consent-lookup-mismatches-rev7.json: a mismatch row with linked true (C-1, F-36)', () => {
    const p = PUSH_SCHEMAS.consentLookup.parse(fx('push-consent-lookup-mismatches-rev7.json'));
    expect(p.kind).toBe('mismatches');
    expect((p.rows[0] as { linked?: boolean }).linked).toBe(true);
  });
  it('both are LF only and listed in the manifest', () => {
    const m = fx('manifest.json').files;
    for (const f of ['result-request-rev7.json', 'push-consent-lookup-mismatches-rev7.json']) {
      expect(raw(f).includes(0x0d)).toBe(false);
      expect(m[f]).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
