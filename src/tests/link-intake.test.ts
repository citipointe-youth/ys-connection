// T4 (contract X19): admin Intakes + Consents, server side. Repo (memory + Supabase SQL text + encryption), purge and
// 24 h expiry, service (RBAC, module, stale, keys in plan, note), sync (pushes, hint, results with steps/stop, error log).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { makeLinkService, type LinkService } from '../services/link.service';
import { makeIntakeService, checkIntakeItem, INTAKE_STALE_MS } from '../services/link-intake.service';
import { makeSyncService } from '../services/sync.service';
import { makeSettingsService } from '../services/settings.service';
import { InMemoryLinkRepository } from '../repositories/in-memory/link.repository';
import { InMemoryLinkIntakeRepository } from '../repositories/in-memory/link-intake.repository';
import { detailAad } from '../repositories/supabase/supabase.link-intake';
import {
  InMemoryAuditRepository, InMemorySettingsRepository, InMemoryStudentRepository, InMemoryLeaderRepository, InMemoryUserRepository,
  InMemoryServiceSessionRepository, InMemoryServiceAttendanceRepository,
} from '../repositories/in-memory';
import { MINISTRY_CONFIG_DEFAULTS } from '../core/ministry-config';
import { ClaimResponse, INTAKE_TYPES, PUSH_SCHEMAS } from '../core/link-contract';
import { dedupeKey } from '../services/link-rules';
import { decryptField, maybeEncrypt } from '../utils/field-crypto';
import type { Actor } from '../core/entities/user';
import type { Capabilities } from '../core/link-types';

const DIR = join(__dirname, 'fixtures', 'elvanto-link');
const fx = (f: string): any => JSON.parse(readFileSync(join(DIR, f), 'utf8'));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = '2026-10-01T00:00:00.000Z';
const NOW = new Date('2026-10-16T09:50:00.000Z'); // Fri 19:50 Brisbane; the fixture plans were taken at 09:41
const DATE = '2026-10-16';
const CONSOLE = fx('push-intake.json').consoleId as string;
const ADMIN_ID = u(1), DIR_ID = u(2);
const actor = (id: string, role: string): Actor =>
  ({ id, role: role as Actor['role'], displayName: `${role} login`, grade: null, quad: null, gender: null, leaderId: null });
const ADMIN = actor(ADMIN_ID, 'admin');
const DIRECTOR = actor(DIR_ID, 'director');
const DEV = { id: 'dev-1', label: 'iPhone' };
const BASE_CAPS: Capabilities = { checkIn: 'live', checkOut: 'live', submitReport: 'live', editReport: 'live', completeStep: 'live',
  firstTimerCheckIn: 'live' };
const INTAKE_CAPS: Capabilities = { ...BASE_CAPS, intakeAnswer: 'live', intakeSave: 'live', consentSave: 'live', intakeText: 'live' };
const SUB_S = '5b000000-0000-4000-8000-000000000001', SUB_P = '5b000000-0000-4000-8000-000000000002';
const P_STU = '9e000000-0000-4000-8000-000000000011';
const row1 = () => fx('push-intake.json').rows[0];
/** A rev-4 console's claim (the same console id as the setup's, so it keeps its intake capabilities). */
const CLAIM4 = (o: Record<string, unknown> = {}) => ({ ...fx('claim-request.json'), linkRev: 12,
  capabilities: { ...fx('claim-request.json').capabilities, intakeAnswer: 'live', intakeSave: 'live', consentSave: 'live', intakeText: 'live' }, ...o });
const keysOf = (r: any) => r.steps.map((s: any) => s.key) as string[];
let idn = 5000;
const nid = () => u(++idn);

async function setup(o: { intake?: 'off' | 'on'; push?: boolean; rev?: number; caps?: Capabilities } = {}) {
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
    modules: { ...MINISTRY_CONFIG_DEFAULTS.modules, intakeAdmin: o.intake ?? 'on' } } } as never);
  for (const [id, email, role] of [[ADMIN_ID, 'admin', 'admin'], [DIR_ID, 'director', 'director']] as const) {
    await users.save({ id, email, displayName: `${email} name`, role, status: 'active', createdAt: T0, updatedAt: T0 } as never);
  }
  const errorLog = { record: vi.fn(async () => {}) };
  const svc: LinkService = makeLinkService({ link, settings, students, leaders, users, serviceSessions: sessions,
    serviceAttendance: attendance, limiter: { isBlocked: () => false }, now, errorLog, intake: intakeRepo });
  const intake = makeIntakeService({ intake: intakeRepo, link, settings, status: (a) => svc.status(a), now, errorLog });
  const sync = makeSyncService({ link, settings, students, users, now, errorLog, intake });
  // The console: rev 4 with the intake capabilities (unless the test says otherwise).
  await link.claim({ console: { consoleId: CONSOLE, label: 'Desk', contractVersion: 1, consoleVersion: 't', inWindow: true,
    pollSeconds: 60, capabilities: o.caps ?? INTAKE_CAPS, linkRev: o.rev ?? 4 }, max: 0, leaseSeconds: 180, cutoffDays: 3,
    leaseLostMs: 3_600_000 });
  if (o.push !== false && (o.intake ?? 'on') === 'on') {
    await sync.push('intakePlan', fx('push-intake.json'));
    await sync.push('consentPlan', fx('push-consent.json'));
  }
  return { clock, link, intakeRepo, settings, users, svc, intake, sync, errorLog };
}
type Hx = Awaited<ReturnType<typeof setup>>;
const batch = (h: Hx, items: unknown[], who: Actor = ADMIN) =>
  h.svc.batch(who, { device: DEV, sentAt: h.clock.now.toISOString(), items });
const act = (type: string, payload: unknown, note: string | null = null, id = nid()) =>
  ({ kind: 'action', id, type, payload, note, leaderId: null });
const one = async (h: Hx, item: unknown, who: Actor = ADMIN) => (await batch(h, [item], who)).results[0]!;
const saveP = (over: Record<string, unknown> = {}) => ({ date: DATE, row: SUB_S, confirmed: keysOf(row1()).slice(0, 2), one: false, ...over });
const answerP = (over: Record<string, unknown> = {}) => ({ date: DATE, family: [SUB_S, SUB_P], choices: { [SUB_S]: 'new' },
  pairs: { [SUB_S]: SUB_P }, undo: false, ...over });
const NOTE = JSON.stringify({ fixes: { [SUB_S]: { last: 'Sample' } }, keeps: {} });

// ---------------------------------------------------------------- repository

describe('intake repo (memory)', () => {
  it('a push replaces its (mode, date) only; an older or equal takenAt is ignored; done rows keep no detail', async () => {
    const h = await setup();
    const rows = await h.intakeRepo.rows('intake', DATE);
    expect(rows.map((r) => [r.key, r.status, r.fromApp, r.reason])).toEqual([
      [SUB_S, 'needs-you', true, 'Check the match'], ['5b000000-0000-4000-8000-000000000003', 'done', false, '']]);
    expect((await h.intakeRepo.detail('intake', DATE, '5b000000-0000-4000-8000-000000000003'))!.detail).toBeNull();
    expect(((await h.intakeRepo.detail('intake', DATE, SUB_S))!.detail as any).forms.student.values.mobile).toBe('0400000001');
    expect(rows[0]!.hasText).toBe(false); // the text step is 'wait', not 'todo'
    const same = await h.sync.push('intakePlan', fx('push-intake.json'));
    expect(same).toEqual({ applied: false });
    const later = { ...fx('push-intake.json'), takenAt: '2026-10-16T09:45:00.000Z', rows: [] };
    expect(await h.sync.push('intakePlan', later)).toEqual({ applied: true, rows: 0 });
    expect(await h.intakeRepo.rows('intake', DATE)).toEqual([]);
    expect((await h.intakeRepo.rows('consent', DATE)).map((r) => r.outcome)).toEqual(['No contact', '']); // other mode untouched; outcome kept for the chip
  });
  it('hasText: a todo parent-text step in the plan', async () => {
    const h = await setup({ push: false });
    const p = fx('push-intake.json'); p.rows[0].steps[4].state = 'todo';
    await h.sync.push('intakePlan', p);
    expect((await h.intakeRepo.rows('intake', DATE))[0]!.hasText).toBe(true);
  });
  it('refresh asks: once per (mode, date) per 60 s; a landing push clears it', async () => {
    const h = await setup();
    expect(await h.intakeRepo.askRefresh('intake', DATE)).toBe(true);
    expect(await h.intakeRepo.askRefresh('intake', DATE)).toBe(false);
    expect(await h.intakeRepo.askRefresh('consent', DATE)).toBe(true);
    h.clock.now = new Date(NOW.getTime() + 61_000);
    expect(await h.intakeRepo.askRefresh('intake', DATE)).toBe(true);
    await h.sync.push('intakePlan', { ...fx('push-intake.json'), takenAt: '2026-10-16T09:51:00.000Z' });
    expect((await h.intakeRepo.dates('intake'))[0]!.refreshAskedAt).toBeNull();
  });
  it('purge drops dates and rows older than the cut-off; clear drops everything', async () => {
    const h = await setup();
    await h.intakeRepo.purge('2026-10-16');
    expect(await h.intakeRepo.rows('intake')).toHaveLength(2);
    await h.intakeRepo.purge('2026-10-17');
    expect(await h.intakeRepo.rows('intake')).toEqual([]);
    expect(await h.intakeRepo.dates()).toEqual([]);
    const h2 = await setup(); await h2.intakeRepo.markViewed(); await h2.intakeRepo.clear();
    expect([await h2.intakeRepo.dates(), await h2.intakeRepo.viewedAt()]).toEqual([[], null]);
  });
});

describe('intake repo (Supabase): SQL text + encryption at rest', () => {
  const src = readFileSync(join(__dirname, '..', 'repositories', 'supabase', 'supabase.link-intake.ts'), 'utf8').replace(/\s+/g, ' ');
  const KEY = { FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'), FIELD_ENCRYPTION_KEY_ID: 't1' };
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => { for (const [k, v] of Object.entries(KEY)) { saved[k] = process.env[k]; process.env[k] = v; } });
  afterEach(() => { for (const k of Object.keys(KEY)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
  it('detail is encrypted with the row-bound AAD; done rows store none; jsonb is never cast from a string', () => {
    expect(src).toContain('detail: done ? null : maybeEncrypt(JSON.stringify(x.detail), detailAad(mode, m.date, x.key))');
    expect(src).not.toContain('::jsonb');
    expect(src).toMatch(/select \$\{m\.takenAt\}::timestamptz <= taken_at as stale/);
    expect(src).toContain('pg_advisory_xact_lock');
  });
  it('the envelope is v1. ciphertext, readable only under the same (mode, date, key)', () => {
    const blob = maybeEncrypt(JSON.stringify(row1()), detailAad('intake', DATE, SUB_S))!;
    expect(blob.startsWith('v1.')).toBe(true);
    expect(blob).not.toContain('0400000001');
    expect(JSON.parse(decryptField(blob, detailAad('intake', DATE, SUB_S))).title).toBe('Ava Sample');
    expect(() => decryptField(blob, detailAad('intake', DATE, SUB_P))).toThrow();
  });
  it('a detail that will not decrypt reads as unreadable, never failing the read', () => {
    expect(src).toMatch(/catch \{ return \{ row: toLite\(r\), detail: null, unreadable: true \}; \}/);
  });
  it('the refresh rate limit and the module-Off clear are in SQL', () => {
    expect(src).toContain("link_intake_dates.refresh_asked_at < now() - interval '60 seconds'");
    expect(src).toMatch(/delete from link_intake_rows`; await tx`delete from link_intake_dates`; await tx`delete from link_intake_view`/);
  });
});

describe('link_outbox: intake expiry and purge', () => {
  const link = readFileSync(join(__dirname, '..', 'repositories', 'supabase', 'supabase.link.ts'), 'utf8').replace(/\s+/g, ' ');
  const LIST = "('intakeAnswer','intakeSave','consentSave','intakeText')";
  it('Supabase: a 24 h sweep for the intake types (too-old), notes nulled when final, rows deleted after 14 days', () => {
    expect(LIST).toBe(`(${INTAKE_TYPES.map((t) => `'${t}'`).join(',')})`);
    expect(link).toContain(`select id from link_outbox where status = 'pending' and created_at < now() - interval '24 hours' and type in ${LIST}`);
    expect(link).toContain(`update link_outbox set note = null where type in ${LIST} and note is not null`);
    expect(link).toContain(`delete from link_outbox where type in ${LIST} and created_at < now() - interval '14 days'`);
    expect(link).toContain('JSONB_COLS.has(k) && v != null ? this.j(v) : v');
  });
  it('memory: an intake row unclaimed for 24 h is refused too-old (swept, for the error log); a check-in is not', async () => {
    const h = await setup();
    const r = await one(h, act('intakeAnswer', answerP(), NOTE));
    expect(r.outcome).toBe('saved');
    const other = nid();
    await h.link.insertAction({ id: other, type: 'checkIn', payload: {}, note: null, dedupeKey: 'x', serviceDate: DATE, studentId: null,
      personId: null, createdBy: ADMIN_ID, leaderId: null, leaderName: 'A' });
    h.clock.now = new Date(NOW.getTime() + 25 * 3_600_000);
    await h.sync.claim({ ...fx('claim-request.json'), max: 0 });
    expect((await h.link.getAction(r.id))!).toMatchObject({ status: 'refused', reason: 'too-old', hasNote: false });
    expect((await h.link.getAction(other))!.status).toBe('pending');
    expect(h.errorLog.record).toHaveBeenCalledWith({ category: 'link', code: 'too-old', route: 'intakeAnswer', role: 'console', count: 1 });
    h.clock.now = new Date(NOW.getTime() + 15 * 86_400_000);
    await h.sync.claim({ ...fx('claim-request.json'), max: 0 });
    expect(await h.link.getAction(r.id)).toBeNull();
  });
});

// ---------------------------------------------------------------- service: routes

describe('GET /link/intake*, POST /link/intake/refresh', () => {
  it('module Off: 404 for everyone; On: admin only (director 403)', async () => {
    const off = await setup({ intake: 'off' });
    await expect(off.intake.list(ADMIN, { mode: 'intake' })).rejects.toMatchObject({ statusCode: 404, code: 'MODULE_DISABLED' });
    const h = await setup();
    await expect(h.intake.list(DIRECTOR, { mode: 'intake' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(h.intake.row(DIRECTOR, { mode: 'intake', date: DATE, key: SUB_S })).rejects.toMatchObject({ statusCode: 403 });
    await expect(h.intake.refresh(DIRECTOR, { mode: 'intake', date: DATE })).rejects.toMatchObject({ statusCode: 403 });
  });
  it('the dates list: counts, stale flag, inputs, the console; opening it marks the view (hurry hint)', async () => {
    const h = await setup();
    const r = await h.intake.list(ADMIN, { mode: 'intake', view: '1' });
    expect(r.consoleLinkRev).toBe(4);
    expect(r.console.online).toBe(true);
    expect((r as any).dates).toEqual([{ date: DATE, takenAt: '2026-10-16T09:41:00.000Z', stale: false, cut: false,
      inputs: { from: 'app', at: '2026-10-16T09:40:12.000Z' }, refreshAskedAt: null, counts: { needsYou: 1, ready: 0, done: 1 } }]);
    expect(await h.intakeRepo.viewedAt()).toBe(NOW.toISOString());
    h.clock.now = new Date(Date.parse('2026-10-16T09:41:00.000Z') + INTAKE_STALE_MS + 1000);
    expect(((await h.intake.list(ADMIN, { mode: 'intake' })) as any).dates[0].stale).toBe(true);
  });
  it('one date: rows with their latest actions (no cancelled), newest first; row detail + history', async () => {
    const h = await setup();
    const a = await one(h, act('intakeAnswer', answerP(), NOTE));
    const r = await h.intake.list(ADMIN, { mode: 'intake', date: DATE }) as any;
    expect(r.rows.map((x: any) => [x.title, x.actions.map((y: any) => [y.type, y.status])])).toEqual([
      ['Ava Sample', [['intakeAnswer', 'pending']]], ['Liam Example', []]]);
    const d = await h.intake.row(ADMIN, { mode: 'intake', date: DATE, key: SUB_S });
    expect(d.unreadable).toBe(false);
    expect((d.detail as any).match.kind).toBe('app');
    expect(d.actions.map((x) => x.id)).toEqual([a.id]);
    await expect(h.intake.list(ADMIN, { mode: 'bogus' })).rejects.toBeTruthy();
  });
  it('refresh: within 8 weeks only; asked once per minute; the claim hint carries it', async () => {
    const h = await setup();
    await expect(h.intake.refresh(ADMIN, { mode: 'intake', date: '2026-10-17' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(h.intake.refresh(ADMIN, { mode: 'intake', date: '2026-08-01' })).rejects.toMatchObject({ statusCode: 400 });
    // T14: a consent date may be up to a week ahead (its repliers are pushed early)
    await expect(h.intake.refresh(ADMIN, { mode: 'consent', date: '2026-10-31' })).rejects.toMatchObject({ statusCode: 400 });
    expect(await h.intake.refresh(ADMIN, { mode: 'consent', date: '2026-10-09' })).toEqual({ asked: true });
    expect(await h.intake.refresh(ADMIN, { mode: 'consent', date: '2026-10-09' })).toEqual({ asked: false });
    const reply = await h.sync.claim({ ...fx('claim-request.json'), linkRev: 12 });
    expect(reply.intake!.refresh).toEqual([{ mode: 'consent', date: '2026-10-09' }]);
    expect(await h.intake.refresh(ADMIN, { mode: 'consent', date: '2026-10-23' })).toEqual({ asked: true });
    expect((await h.intake.hint(await h.settings.getSettings())).refresh).toContainEqual({ mode: 'consent', date: '2026-10-23' });
  });
  it('R2: a refresh ask is offered for 10 min only', async () => {
    const h = await setup();
    await h.intake.refresh(ADMIN, { mode: 'consent', date: '2026-10-09' });
    h.clock.now = new Date(NOW.getTime() + 60_000);
    expect((await h.intake.hint(await h.settings.getSettings())).refresh).toHaveLength(1);
    h.clock.now = new Date(NOW.getTime() + 11 * 60_000);
    expect((await h.intake.hint(await h.settings.getSettings())).refresh).toEqual([]);
  });
  it('R6: list purges at most hourly, and only the dates list marks the view', async () => {
    const h = await setup();
    const purge = vi.spyOn(h.intakeRepo, 'purge'); const viewed = vi.spyOn(h.intakeRepo, 'markViewed');
    await h.intake.list(ADMIN, { mode: 'intake', view: '1' }); await h.intake.list(ADMIN, { mode: 'intake', view: '1' }); // B18: view=1 on page entry
    expect(purge).toHaveBeenCalledTimes(1);
    expect(viewed).toHaveBeenCalledTimes(2);
    await h.intake.list(ADMIN, { mode: 'intake', date: DATE });
    expect(viewed).toHaveBeenCalledTimes(2);
    await h.sync.claim(CLAIM4());
    expect(purge).toHaveBeenCalledTimes(1);
  });
  it('an unreadable detail goes to the error log by code only', async () => {
    const h = await setup();
    vi.spyOn(h.intakeRepo, 'detail').mockResolvedValueOnce({ row: (await h.intakeRepo.rows('intake', DATE))[0]!, detail: null, unreadable: true });
    expect((await h.intake.row(ADMIN, { mode: 'intake', date: DATE, key: SUB_S })).unreadable).toBe(true);
    expect(h.errorLog.record).toHaveBeenCalledWith({ category: 'link', code: 'intake-unreadable', route: 'GET /link/intake/row', role: 'admin' });
  });
});

// ---------------------------------------------------------------- service: batch items

describe('/link/batch intake items', () => {
  it('admin + module on: an answer, a save, a consent save and the text are queued with their dedupe keys', async () => {
    const h = await setup();
    const text = row1().steps[4].key;
    const res = (await batch(h, [act('intakeAnswer', answerP(), NOTE), act('intakeSave', saveP()),
      act('consentSave', { date: DATE, row: P_STU, confirmed: keysOf(fx('push-consent.json').rows[0]) }),
      act('intakeText', { date: DATE, row: SUB_S, key: text })])).results;
    expect(res.map((r) => r.outcome)).toEqual(['saved', 'saved', 'saved', 'saved']);
    const rows = await h.link.listActions({ types: [...INTAKE_TYPES] });
    expect(rows.map((r) => r.dedupeKey).sort()).toEqual([`cs:${DATE}:${P_STU}`, `ia:${DATE}:${SUB_S}`, `is:${DATE}:${SUB_S}`, `it:${DATE}:${SUB_S}`]);
    expect(rows.every((r) => r.serviceDate === DATE && r.personId === null)).toBe(true);
    expect(h.link._peekNote(res[0]!.id)).toBe(NOTE);
    expect(dedupeKey('intakeAnswer', answerP())).toBe(`ia:${DATE}:${SUB_S}`);
    // one open row per family: a second save is a duplicate of the first
    expect((await one(h, act('intakeSave', saveP()))).outcome).toBe('duplicate');
  });
  it('RBAC and module: a director is refused 403 (even with a link screen on); module off 404', async () => {
    const h = await setup();
    await h.settings.updateSettings({ ministryConfig: { ...MINISTRY_CONFIG_DEFAULTS,
      modules: { ...MINISTRY_CONFIG_DEFAULTS.modules, intakeAdmin: 'on', checkin: 'on' } } } as never);
    expect(await one(h, act('intakeSave', saveP()), DIRECTOR)).toMatchObject({ outcome: 'refused', code: 'FORBIDDEN' });
    const off = await setup({ intake: 'off' });
    expect(await one(off, act('intakeSave', saveP()))).toMatchObject({ outcome: 'refused', code: 'MODULE_DISABLED' });
  });
  it('a console that does not list the intake types (rev 3): LINK_UNAVAILABLE', async () => {
    const h = await setup({ rev: 3, caps: BASE_CAPS });
    expect(await one(h, act('intakeSave', saveP()))).toMatchObject({ outcome: 'refused', code: 'LINK_UNAVAILABLE' });
  });
  it('a plan over 2 h old: Save / Text / consent Save refuse INTAKE_STALE (409); an answer is still queued', async () => {
    const h = await setup();
    h.clock.now = new Date(Date.parse('2026-10-16T09:41:00.000Z') + INTAKE_STALE_MS + 60_000);
    expect(await one(h, act('intakeSave', saveP()))).toMatchObject({ outcome: 'refused', code: 'INTAKE_STALE' });
    expect(await one(h, act('intakeText', { date: DATE, row: SUB_S, key: row1().steps[4].key }))).toMatchObject({ code: 'INTAKE_STALE' });
    expect((await one(h, act('intakeAnswer', answerP(), NOTE))).outcome).toBe('saved');
  });
  it('keys must be in the stored plan of that row (400); the text never rides a Save; one = an alone step or an extra', async () => {
    const h = await setup();
    expect(await one(h, act('intakeSave', saveP({ confirmed: ['approve:student:forged'] })))).toMatchObject({ code: 'BAD_REQUEST' });
    expect(await one(h, act('intakeSave', saveP({ confirmed: [row1().steps[4].key] })))).toMatchObject({ code: 'BAD_REQUEST' });
    expect(await one(h, act('intakeSave', saveP({ one: true, confirmed: [row1().steps[0].key] })))).toMatchObject({ code: 'BAD_REQUEST' });
    expect((await one(h, act('intakeSave', saveP({ one: true, confirmed: [row1().steps[3].key] })))).outcome).toBe('saved'); // alone
    const h2 = await setup();
    expect((await one(h2, act('intakeSave', saveP({ one: true, confirmed: [row1().extras[0].key] })))).outcome).toBe('saved'); // extra
    expect(await one(h2, act('consentSave', { date: DATE, row: P_STU, confirmed: [row1().steps[0].key] }))).toMatchObject({ code: 'BAD_REQUEST' });
  });
  it('the date must be pushed and the row in it; a done row (no detail) cannot be saved', async () => {
    const h = await setup();
    expect(await one(h, act('intakeSave', saveP({ date: '2026-10-09' })))).toMatchObject({ code: 'BAD_REQUEST' });
    expect(await one(h, act('intakeAnswer', answerP({ family: [SUB_P] }), NOTE))).toMatchObject({ code: 'BAD_REQUEST' });
    expect(await one(h, act('intakeSave', saveP({ row: '5b000000-0000-4000-8000-000000000003',
      confirmed: ['approve:student:5b000000-0000-4000-8000-000000000003:h0'] })))).toMatchObject({ code: 'BAD_REQUEST' });
  });
  it('the answer note: an IntakeNote within 1,900 characters; no note on the other types', async () => {
    const h = await setup();
    const long = JSON.stringify({ fixes: { [SUB_S]: Object.fromEntries(['first', 'last', 'birthday', 'mobile', 'parentName', 'parentPhone']
      .map((k) => [k, 'x'.repeat(80)])) }, keeps: { [SUB_S]: { parentName: 'y'.repeat(200), parentPhone: 'z'.repeat(200) },
      [SUB_P]: { parentName: 'y'.repeat(200), parentPhone: 'z'.repeat(200) }, [u(77)]: { parentName: 'y'.repeat(200), parentPhone: 'z'.repeat(200) } } });
    expect(long.length).toBeGreaterThan(1900);
    expect(await one(h, act('intakeAnswer', answerP(), long))).toMatchObject({ code: 'BAD_REQUEST' });
    expect(await one(h, act('intakeAnswer', answerP(), '{"fixes":{"x":{}}}'))).toMatchObject({ code: 'BAD_REQUEST' });
    expect(await one(h, act('intakeAnswer', answerP(), 'not json'))).toMatchObject({ code: 'BAD_REQUEST' });
    expect(await one(h, act('intakeSave', saveP(), 'a note'))).toMatchObject({ code: 'BAD_REQUEST' });
  });
  it('checkIntakeItem without a repo detail: refused, never thrown as a 500', async () => {
    const repo = new InMemoryLinkIntakeRepository(() => NOW);
    await expect(checkIntakeItem(repo, 'intakeSave', saveP(), null, NOW)).rejects.toMatchObject({ statusCode: 400 });
  });
});

// ---------------------------------------------------------------- sync: claim hint, pushes, results

describe('sync: intake hint, pushes, results', () => {
  it('the hint: mode, hurry (pending row or a recent view), and it parses', async () => {
    const h = await setup();
    let reply = await h.sync.claim(CLAIM4());
    expect(ClaimResponse.parse(reply).intake).toEqual({ mode: 'on', hurry: false, refresh: [] });
    await h.intake.list(ADMIN, { mode: 'intake', view: '1' }); // viewed now
    expect((await h.sync.claim(CLAIM4())).intake!.hurry).toBe(true);
    h.clock.now = new Date(NOW.getTime() + 31 * 60_000);
    expect((await h.sync.claim(CLAIM4())).intake!.hurry).toBe(false);
    expect((await one(h, act('intakeAnswer', answerP(), NOTE))).outcome).toBe('saved');
    reply = await h.sync.claim(CLAIM4({ max: 0 }));
    expect(reply.intake!.hurry).toBe(true);
  });
  it('L8 (2026-10-21): a consentLookup made in the last 5 min keeps hurry on, also after its own claim leased and answered it', async () => {
    const h = await setup();
    const C = (o: Record<string, unknown> = {}) => CLAIM4({ capabilities: { ...CLAIM4().capabilities, consentLookup: 'live' }, ...o });
    expect((await h.sync.claim(C())).intake!.hurry).toBe(false);
    const id = nid();
    expect((await one(h, act('consentLookup', { kind: 'forms', page: 1, ref: id }, null, id))).outcome).toBe('saved');
    const r = await h.sync.claim(C());
    expect(r.rows.map((x) => x.id)).toContain(id); // leased in this claim, so it is no longer pending
    expect(r.intake!.hurry).toBe(true);
    await h.sync.result({ contractVersion: 1, consoleId: C().consoleId, results: [{ id, outcome: 'planned' }] });
    h.clock.now = new Date(NOW.getTime() + 4 * 60_000);
    expect((await h.sync.claim(C())).intake!.hurry).toBe(true);
    expect((await h.sync.claim(C({ capabilities: { ...CLAIM4().capabilities, consentLookup: 'off' } }))).intake!.hurry).toBe(false); // a console with lookups off is not hurried
    h.clock.now = new Date(NOW.getTime() + 6 * 60_000);
    expect((await h.sync.claim(C())).intake!.hurry).toBe(false);
  });
  it('module Off: hint mode off, the Off save clears the intake tables, a push not stored, nothing leased by the intake switch alone', async () => {
    const h = await setup();
    const users = new InMemoryUserRepository(); const audit = new InMemoryAuditRepository();
    for (const r of [users, audit]) await r.init();
    await makeSettingsService(h.settings, audit, users, () => h.intake.off()).update(ADMIN, { ministryConfig: { modules: { intakeAdmin: 'off' } } });
    await h.settings.updateSettings({ ministryConfig: { ...MINISTRY_CONFIG_DEFAULTS,
      modules: { ...MINISTRY_CONFIG_DEFAULTS.modules, intakeAdmin: 'off', checkin: 'off', lifegroupReport: 'off', flows: 'off' } } } as never);
    expect((await h.sync.claim({ ...fx('claim-request.json'), linkRev: 12 })).intake).toEqual({ mode: 'off', hurry: false, refresh: [] });
    expect(await h.intakeRepo.dates()).toEqual([]);
    expect(await h.sync.push('intakePlan', { ...fx('push-intake.json'), takenAt: '2026-10-16T09:49:00.000Z' })).toEqual({ applied: false });
  });
  it('review fix: intake Off with other link screens on never leases a queued intake row (an intakeText SMS is irreversible)', async () => {
    const h = await setup();
    const r = await one(h, act('intakeAnswer', answerP(), NOTE));
    expect(r.outcome).toBe('saved');
    await h.settings.updateSettings({ ministryConfig: { ...MINISTRY_CONFIG_DEFAULTS,
      modules: { ...MINISTRY_CONFIG_DEFAULTS.modules, intakeAdmin: 'off', checkin: 'on' } } } as never);
    expect((await h.sync.claim(CLAIM4({ max: 10 }))).rows).toEqual([]);
    expect((await h.link.getAction(r.id))!.status).toBe('pending');
  });
  it('review fix: the Off save cancels intake rows nobody has leased yet, and only those', async () => {
    const h = await setup();
    const r = await one(h, act('intakeAnswer', answerP(), NOTE));
    const users = new InMemoryUserRepository(); const audit = new InMemoryAuditRepository();
    for (const x of [users, audit]) await x.init();
    await makeSettingsService(h.settings, audit, users, () => h.intake.off()).update(ADMIN, { ministryConfig: { modules: { intakeAdmin: 'off' } } });
    expect((await h.link.getAction(r.id))!.status).toBe('cancelled');
  });
  it('review fix: the claim hint clears nothing while Off and purges at most hourly while On', async () => {
    const h = await setup();
    const purge = vi.spyOn(h.intakeRepo, 'purge'); const clear = vi.spyOn(h.intakeRepo, 'clear');
    await h.sync.claim(CLAIM4()); await h.sync.claim(CLAIM4());
    expect(purge).toHaveBeenCalledTimes(1);
    h.clock.now = new Date(NOW.getTime() + 61 * 60_000);
    await h.sync.claim(CLAIM4());
    expect(purge).toHaveBeenCalledTimes(2);
    await h.settings.updateSettings({ ministryConfig: { ...MINISTRY_CONFIG_DEFAULTS,
      modules: { ...MINISTRY_CONFIG_DEFAULTS.modules, intakeAdmin: 'off' } } } as never);
    await h.sync.claim(CLAIM4()); await h.sync.claim(CLAIM4());
    expect(clear).not.toHaveBeenCalled();
    expect(await h.intakeRepo.dates()).not.toEqual([]);
  });
  it('a push with a bad row is a 400 for the whole push (strict whitelist)', async () => {
    const h = await setup({ push: false });
    const p = fx('push-intake.json'); p.rows[0].forms.student.values.suburb = 'Carindale';
    await expect(h.sync.push('intakePlan', p)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(PUSH_SCHEMAS.intakePlan.safeParse(fx('push-intake.json')).success).toBe(true);
  });
  it('results: planned -> sent/planned; steps + stop kept; refused/unclear to the error log (type + reason only)', async () => {
    const h = await setup();
    const ids = (await batch(h, [act('intakeAnswer', answerP(), NOTE), act('intakeSave', saveP()),
      act('consentSave', { date: DATE, row: P_STU, confirmed: keysOf(fx('push-consent.json').rows[0]) })])).results.map((r) => r.id);
    const claim = await h.sync.claim(CLAIM4());
    expect(claim.rows.map((r) => r.type).sort()).toEqual(['consentSave', 'intakeAnswer', 'intakeSave']);
    expect(claim.rows.find((r) => r.type === 'intakeAnswer')!.note).toBe(NOTE); // not attributed: the raw IntakeNote
    const tpl = fx('result-request-intake.json').results;
    const reply = await h.sync.result({ contractVersion: 1, consoleId: CONSOLE, results: [
      { ...tpl[0], id: ids[0] }, { ...tpl[1], id: ids[1] }, { ...tpl[3], id: ids[2] }] });
    expect(reply.applied).toHaveLength(3);
    expect(await h.link.getAction(ids[0]!)).toMatchObject({ status: 'sent', reason: 'planned' });
    expect(await h.link.getAction(ids[1]!)).toMatchObject({ status: 'sent', steps: tpl[1].steps, stop: tpl[1].stop });
    expect(await h.link.getAction(ids[2]!)).toMatchObject({ status: 'refused', reason: 'plan-changed', stop: tpl[3].stop });
    expect(h.errorLog.record).toHaveBeenCalledWith({ category: 'link', code: 'plan-changed', route: 'consentSave', role: 'console', count: 1 });
    for (const call of h.errorLog.record.mock.calls) expect(JSON.stringify(call)).not.toMatch(/Sample|0400|approve:|complete:/);
    // the final intake rows lose their notes at the next sweep
    await h.sync.claim({ ...fx('claim-request.json'), max: 0 });
    expect((await h.link.getAction(ids[0]!))!.hasNote).toBe(false);
  });
});

describe('settings: turning Intake Off deletes every intake row at once', () => {
  it('calls the hook only on an on -> off save', async () => {
    const repo = new InMemorySettingsRepository(); const audit = new InMemoryAuditRepository(); const users = new InMemoryUserRepository();
    for (const r of [repo, audit, users]) await r.init();
    const hook = vi.fn(async () => {});
    const s = makeSettingsService(repo, audit, users, hook);
    await s.update(ADMIN, { ministryConfig: { modules: { intakeAdmin: 'on' } } });
    expect(hook).not.toHaveBeenCalled();
    await s.update(ADMIN, { ministryConfig: { modules: { intakeAdmin: 'off' } } });
    expect(hook).toHaveBeenCalledTimes(1);
    await s.update(ADMIN, { ministryConfig: { modules: { intakeAdmin: 'off' } } });
    expect(hook).toHaveBeenCalledTimes(1);
    expect((await repo.getSettings()).ministryConfig.modules.intakeAdmin).toBe('off');
    await expect(s.update(ADMIN, { ministryConfig: { modules: { intakeAdmin: 'shadow' } } })).rejects.toBeTruthy();
  });
});

void clone;
