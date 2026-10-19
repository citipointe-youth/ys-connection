// LINK_REV 6 (run 2026-10-15 lane A; ux-run-2026-10-15/CONTRACT-REV6.md): flow-row consent / DNC, the consent-step guard
// (review C1), removeFromFlowStep, consentLookup (+ its push and GET), consentFix, and the claim's handling of them.
import { describe, it, expect } from 'vitest';
import { makeLinkService, LINK_RATE_MAX, LINK_RATE_WINDOW_MS } from '../services/link.service';
import { makeSyncService } from '../services/sync.service';
import { InMemoryLinkRepository } from '../repositories/in-memory/link.repository';
import { consentFriday, consentFridayPassed, consentStepAllowed } from '../services/link-rules';
import { InMemoryLinkIntakeRepository } from '../repositories/in-memory/link-intake.repository';
import {
  InMemorySettingsRepository, InMemoryStudentRepository, InMemoryLeaderRepository, InMemoryUserRepository,
  InMemoryServiceSessionRepository, InMemoryServiceAttendanceRepository,
} from '../repositories/in-memory';
import { MINISTRY_CONFIG_DEFAULTS } from '../core/ministry-config';
import { RateLimiter } from '../utils/rate-limiter';
import type { Actor } from '../core/entities/user';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-10-16T09:00:00.000Z');
const T0 = '2026-10-01T00:00:00.000Z';
const ADMIN_ID = u(1), DIR_ID = u(2), QUAD_ID = u(3), L_DANA = u(301), CONSOLE = u(601);
const P_DNC = u(101), P_OK = u(102), P_UNK = u(103), P_OK2 = u(104);
const FLOW = u(511), NP = u(512), STEP1 = u(521), STEP0 = u(522);
const FR_DNC = u(501), FR_OK = u(502), FR_C_OK = u(503), FR_C_UNK = u(504), FR_C_OK2 = u(505);
const actor = (id: string, role: string, o: Partial<Actor> = {}): Actor =>
  ({ id, role: role as Actor['role'], displayName: `${role} login`, grade: null, quad: null, gender: null, leaderId: null, ...o });
const ADMIN = actor(ADMIN_ID, 'admin'), DIRECTOR = actor(DIR_ID, 'director'), QUAD = actor(QUAD_ID, 'quad', { quad: 'g79' });
const DEV = { id: 'dev-1', label: 'test' };
let idn = 9000;
const nid = () => u(++idn);
const ALL = { checkIn: 'live', checkOut: 'live', submitReport: 'live', editReport: 'live', completeStep: 'live', firstTimerCheckIn: 'live',
  removeFromFlowStep: 'live', consentLookup: 'live', consentFix: 'live', consentLink: 'live' } as const;

async function setup(o: { intakeAdmin?: 'on' | 'off' } = {}) {
  const link = new InMemoryLinkRepository({ now: () => NOW });
  const intake = new InMemoryLinkIntakeRepository(() => NOW);
  const settings = new InMemorySettingsRepository(), students = new InMemoryStudentRepository(), leaders = new InMemoryLeaderRepository();
  const users = new InMemoryUserRepository(), sessions = new InMemoryServiceSessionRepository(), attendance = new InMemoryServiceAttendanceRepository();
  for (const r of [settings, students, leaders, users, sessions, attendance]) await r.init();
  await settings.updateSettings({ ministryConfig: { ...MINISTRY_CONFIG_DEFAULTS,
    modules: { ...MINISTRY_CONFIG_DEFAULTS.modules, flows: 'on', intakeAdmin: o.intakeAdmin ?? 'on' } } } as never);
  for (const [id, email, role] of [[ADMIN_ID, 'admin', 'admin'], [DIR_ID, 'director', 'director'], [QUAD_ID, 'g79', 'quad']] as const) {
    await users.save({ id, email, displayName: `${email} name`, role, status: 'active', createdAt: T0, updatedAt: T0 } as never);
  }
  await leaders.save({ id: L_DANA, fullName: 'Dana Day', gender: 'female', grades: [8, 9], active: true, createdByGrade: null,
    smsTemplate: null, createdAt: T0, updatedAt: T0 } as never);
  const row = (rowId: string, flowId: string, flowName: string, stepId: string, stepName: string, personId: string, consent: string) => ({
    rowId, flowId, flowName, stepId, stepName, stepOrder: 2, personId, name: 'Sample Kid', due: null, assignedTo: '',
    grade: 8, gender: 'female', mobile: '0400000001', mobileIsParent: false, consent });
  const NPN = 'Brisbane - Youth - New People 2026';
  await link.replaceMirror('flows', [
    row(FR_DNC, FLOW, 'Follow up', STEP1, 'Call', P_DNC, 'contact'),
    row(FR_OK, FLOW, 'Follow up', STEP1, 'Call', P_OK, 'ok'),
    row(FR_C_OK, NP, NPN, STEP0, 'Step 0 - wait', P_OK, 'ok'),
    row(FR_C_UNK, NP, NPN, STEP0, 'Step 0 - wait', P_UNK, 'unknown'),
    row(FR_C_OK2, NP, NPN, STEP0, 'Step 0 - wait', P_OK2, 'ok'),
  ], { takenAt: '2026-10-16T08:00:00.000Z', consoleId: CONSOLE });
  const svc = makeLinkService({ link, settings, students, leaders, users, serviceSessions: sessions, serviceAttendance: attendance,
    limiter: new RateLimiter(LINK_RATE_MAX, LINK_RATE_WINDOW_MS), now: () => NOW, intake });
  const sync = makeSyncService({ link, settings, students, users, now: () => NOW });
  const claim = (max = 20, caps: Record<string, string> = ALL) => sync.claim({ contractVersion: 1, consoleId: CONSOLE, consoleLabel: 'PC',
    consoleVersion: '1', inWindow: false, pollSeconds: 60, capabilities: caps, max, leaseSeconds: 300, linkRev: 12 });
  await claim(0);
  const one = async (a: Actor, item: object) => (await svc.batch(a, { device: DEV, items: [item] })).results[0]!;
  const oc = (r: { outcome: string; code?: string }) => (r.outcome === 'refused' ? r.code : r.outcome);
  return { link, intake, svc, sync, claim, one, oc };
}
const complete = (rowId: string, flowId: string, stepId: string, personId: string) => ({ kind: 'action', id: nid(), type: 'completeStep',
  payload: { rowId, flowId, stepId, personId, notePrivate: false }, note: null, leaderId: L_DANA });
const remove = (rowId: string, personId: string, extra: Record<string, unknown> = {}) => ({ kind: 'action', id: nid(), type: 'removeFromFlowStep',
  payload: { rowId, flowId: FLOW, stepId: STEP1, personId }, note: null, leaderId: null, ...extra });
const consentRow = (key: string, status: 'needs-you' | 'ready' | 'done') => ({ key, status, title: 'Sample Kid', reason: '',
  fromApp: false, hasText: false, outcome: '', detail: status === 'done' ? null : { key } });

describe('rev 6: flow rows carry consent; DNC strips the number for non-admins (R1)', () => {
  it('quad gets no number on a DNC row, admin/director keep it; flags on every row', async () => {
    const h = await setup();
    const byQuad = (await h.svc.flows(QUAD)).rows.find((r) => r.rowId === FR_DNC)!;
    expect(byQuad).toMatchObject({ consent: 'contact', dnc: true, mobile: null, consentStep: false });
    for (const a of [ADMIN, DIRECTOR]) expect((await h.svc.flows(a)).rows.find((r) => r.rowId === FR_DNC)!.mobile).toBe('0400000001');
    expect((await h.svc.flows(QUAD)).rows.find((r) => r.rowId === FR_OK)).toMatchObject({ dnc: false, mobile: '0400000001' });
    expect((await h.svc.flows(ADMIN)).rows.find((r) => r.rowId === FR_C_OK)!.consentStep).toBe(true);
  });
});

describe('rev 6: completeStep guards (R4 DNC, review C1 consent step)', () => {
  it('a DNC row cannot be completed (LINK_DNC); an ok row can', async () => {
    const h = await setup();
    expect(h.oc(await h.one(ADMIN, complete(FR_DNC, FLOW, STEP1, P_DNC)))).toBe('LINK_DNC');
    expect(h.oc(await h.one(ADMIN, complete(FR_OK, FLOW, STEP1, P_OK)))).toBe('saved');
  });
  it('consent step: unknown with no done consent row -> CONSENT_CHECK_FIRST; a done row lets it through', async () => {
    const h = await setup();
    expect(h.oc(await h.one(ADMIN, complete(FR_C_UNK, NP, STEP0, P_UNK)))).toBe('CONSENT_CHECK_FIRST');
    await h.intake.replace('consent', { date: '2026-10-16', takenAt: NOW.toISOString(), consoleId: CONSOLE, cut: false, inputs: null },
      [consentRow(P_UNK, 'done'), consentRow(P_OK2, 'needs-you')] as never);
    expect(h.oc(await h.one(ADMIN, complete(FR_C_UNK, NP, STEP0, P_UNK)))).toBe('saved');
    // 'ok' but an open consent row (a newer reply may say no contact) -> refused; 'ok' with no open row -> allowed
    expect(h.oc(await h.one(ADMIN, complete(FR_C_OK2, NP, STEP0, P_OK2)))).toBe('CONSENT_CHECK_FIRST');
    expect(h.oc(await h.one(ADMIN, complete(FR_C_OK, NP, STEP0, P_OK)))).toBe('saved');
  });
});

describe('CY-B1: the batch decides DO NOT CONTACT as GET /link/flows does (roster sticky flag)', () => {
  const dncRoster = (personId: string, consent: string) => [{ personId, firstName: 'Sample', lastName: 'Kid', gender: 'female', grade: 8,
    kind: 'student', consent }] as never;
  it('a queued Complete on a step after 0 is refused LINK_DNC when only the roster says DNC (flow row unknown)', async () => {
    const h = await setup();
    const FR_U = u(506);
    await h.link.replaceMirror('flows', [{ rowId: FR_U, flowId: FLOW, flowName: 'Follow up', stepId: STEP1, stepName: 'Call', stepOrder: 2,
      personId: P_UNK, name: 'Sample Kid', due: null, assignedTo: '', grade: 8, gender: 'female', mobile: '0400000001',
      mobileIsParent: false, consent: 'unknown' }] as never, { takenAt: '2026-10-16T08:10:00.000Z', consoleId: CONSOLE });
    const queued = complete(FR_U, FLOW, STEP1, P_UNK); // tapped on a phone before the roster said DNC
    await h.link.replaceMirror('roster', dncRoster(P_UNK, 'contact'), { takenAt: '2026-10-16T08:20:00.000Z', consoleId: CONSOLE });
    expect((await h.svc.flows(ADMIN)).rows.find((r) => r.rowId === FR_U)).toMatchObject({ dnc: true });
    expect(h.oc(await h.one(ADMIN, queued))).toBe('LINK_DNC');
    expect(h.oc(await h.one(ADMIN, queued))).toBe('LINK_DNC'); // replayed: still refused, nothing stored
  });
  it('step 0: a done consent row does not let a DNC youth through', async () => {
    const h = await setup();
    await h.intake.replace('consent', { date: '2026-10-16', takenAt: NOW.toISOString(), consoleId: CONSOLE, cut: false, inputs: null },
      [consentRow(P_UNK, 'done')] as never);
    await h.link.replaceMirror('roster', dncRoster(P_UNK, 'all'), { takenAt: '2026-10-16T08:20:00.000Z', consoleId: CONSOLE });
    expect(h.oc(await h.one(ADMIN, complete(FR_C_UNK, NP, STEP0, P_UNK)))).toBe('LINK_DNC');
    expect(consentStepAllowed({ personId: P_UNK, consent: 'all', due: null }, [{ key: P_UNK, status: 'done' }], NOW)).toBeNull();
  });
});

describe('CY-A1: the admin settles an unclear row (POST /link/admin/unclear/:id)', () => {
  async function unclearRow() {
    const h = await setup();
    const a = complete(FR_OK, FLOW, STEP1, P_OK);
    expect(h.oc(await h.one(ADMIN, a))).toBe('saved');
    expect((await h.claim()).rows.map((r) => r.id)).toContain(a.id);
    await h.sync.result({ contractVersion: 1, consoleId: CONSOLE, results: [{ id: a.id, outcome: 'unclear', sentLogKey: 'k' }] });
    return { h, a };
  }
  it('not landed: refused not-landed, logged, and the dedupe key is free again', async () => {
    const { h, a } = await unclearRow();
    expect(h.oc(await h.one(ADMIN, complete(FR_OK, FLOW, STEP1, P_OK)))).toBe('duplicate'); // unclear holds the key
    expect(await h.svc.resolveUnclear(ADMIN, a.id, { landed: false })).toEqual({ ok: true, status: 'refused' });
    expect(await h.link.getAction(a.id)).toMatchObject({ status: 'refused', reason: 'not-landed' });
    const log = await h.link.listLog({ from: '2026-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z', outboxId: a.id, limit: 10 });
    expect(log.find((l) => l.event === 'resolve')).toMatchObject({ userId: ADMIN_ID, outcome: 'refused:not-landed', targetKind: 'action', targetId: a.id });
    expect(h.oc(await h.one(ADMIN, complete(FR_OK, FLOW, STEP1, P_OK)))).toBe('saved');
  });
  it('landed: sent; 404 unknown id, 409 once it is no longer unclear, 403 for anyone but the admin, 400 without landed', async () => {
    const { h, a } = await unclearRow();
    await expect(h.svc.resolveUnclear(DIRECTOR, a.id, { landed: true })).rejects.toMatchObject({ statusCode: 403 });
    await expect(h.svc.resolveUnclear(ADMIN, a.id, {})).rejects.toMatchObject({ statusCode: 400 });
    expect(await h.svc.resolveUnclear(ADMIN, a.id, { landed: true })).toEqual({ ok: true, status: 'sent' });
    expect(await h.link.getAction(a.id)).toMatchObject({ status: 'sent', reason: null });
    await expect(h.svc.resolveUnclear(ADMIN, a.id, { landed: false })).rejects.toMatchObject({ statusCode: 409 });
    await expect(h.svc.resolveUnclear(ADMIN, u(8999), { landed: true })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("E3: the consent step is step 0 of this year's New People flow", () => {
  it('2025 and 2026 pushed: only 2026 is the consent step; 2025 alone (January fallback) still is', async () => {
    const h = await setup();
    const N = (y: number) => `Brisbane - Youth - New People ${y}`;
    const row = (rowId: string, flowName: string) => ({ rowId, flowId: rowId, flowName, stepId: STEP0, stepName: 'Step 0 - wait', stepOrder: 1,
      personId: P_UNK, name: 'Sample Kid', due: null, assignedTo: '', grade: 8, gender: 'female', mobile: '0400000001', mobileIsParent: false, consent: 'unknown' });
    const OLD = u(507), CUR = u(508);
    await h.link.replaceMirror('flows', [row(OLD, N(2025)), row(CUR, N(2026))] as never, { takenAt: '2026-10-16T08:10:00.000Z', consoleId: CONSOLE });
    const step = async (id: string) => (await h.svc.flows(ADMIN)).rows.find((r) => r.rowId === id)!.consentStep;
    expect([await step(OLD), await step(CUR)]).toEqual([false, true]);
    expect(h.oc(await h.one(ADMIN, complete(CUR, CUR, STEP0, P_UNK)))).toBe('CONSENT_CHECK_FIRST');
    expect(h.oc(await h.one(ADMIN, complete(OLD, OLD, STEP0, P_UNK)))).toBe('saved'); // last year's flow: an ordinary step
    await h.link.replaceMirror('flows', [row(OLD, N(2025))] as never, { takenAt: '2026-10-16T08:20:00.000Z', consoleId: CONSOLE });
    expect(await step(OLD)).toBe(true);
  });
});

describe('rev 6: removeFromFlowStep (R4)', () => {
  it('admin/director only; I am needed only with a note; allowed on a DNC row; blocks a Complete of the same row', async () => {
    const h = await setup();
    expect(h.oc(await h.one(QUAD, remove(FR_OK, P_OK)))).toBe('FORBIDDEN');
    expect(h.oc(await h.one(ADMIN, remove(FR_OK, P_OK, { note: 'Asked not to be contacted.' })))).toBe('BAD_REQUEST');
    expect(h.oc(await h.one(DIRECTOR, remove(FR_DNC, P_DNC)))).toBe('saved');
    expect(h.oc(await h.one(ADMIN, remove(FR_OK, P_OK, { note: 'Moved away.', leaderId: L_DANA })))).toBe('saved');
    expect(h.oc(await h.one(ADMIN, complete(FR_OK, FLOW, STEP1, P_OK)))).toBe('LINK_BUSY_ROW');
    expect((await h.svc.flows(ADMIN)).rows.find((r) => r.rowId === FR_OK)!.openAction).toMatchObject({ type: 'removeFromFlowStep' });
  });
  it('the claim note: null for a removal without a note, signed when there is one', async () => {
    const h = await setup();
    const a = remove(FR_DNC, P_DNC), b = remove(FR_OK, P_OK, { note: 'Moved away.', leaderId: L_DANA });
    await h.one(ADMIN, a); await h.one(ADMIN, b);
    const rows = (await h.claim()).rows;
    expect(rows.find((r) => r.id === a.id)!.note).toBeNull();
    expect(rows.find((r) => r.id === b.id)!.note).toBe('Self identified leader: Dana Day — Moved away.');
  });
});

describe('rev 6: consentLookup + push + GET, consentFix (R2 b/c)', () => {
  const fixtures = join(__dirname, 'fixtures', 'elvanto-link');
  const formsPush = () => JSON.parse(readFileSync(join(fixtures, 'push-consent-lookup-forms.json'), 'utf8'));
  const lookup = (id: string, note: string | null = 'sample', page = 1) =>
    ({ kind: 'action', id, type: 'consentLookup', payload: { kind: 'forms', page, ref: id }, note, leaderId: null });

  it('admin only, intakeAdmin on, ref = its own id, search up to 60 characters', async () => {
    const h = await setup();
    const id = nid();
    expect(h.oc(await h.one(DIRECTOR, lookup(id)))).toBe('FORBIDDEN');
    expect(h.oc(await h.one(ADMIN, { ...lookup(id), payload: { kind: 'forms', page: 1, ref: nid() } }))).toBe('BAD_REQUEST');
    expect(h.oc(await h.one(ADMIN, lookup(id, 'x'.repeat(61))))).toBe('BAD_REQUEST');
    expect(h.oc(await h.one(ADMIN, lookup(id)))).toBe('saved');
    const off = await setup({ intakeAdmin: 'off' });
    expect(off.oc(await off.one(ADMIN, lookup(nid())))).toBe('MODULE_DISABLED');
  });
  it('waiting -> working -> ready with the pushed rows; a push for another page, or a row not leased, is not applied', async () => {
    const h = await setup();
    const p = formsPush(), id = p.requestId as string;
    await h.one(ADMIN, lookup(id));
    expect((await h.svc.consentLookup(ADMIN, { id })).status).toBe('waiting');
    await expect(h.svc.consentLookup(DIRECTOR, { id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await h.sync.push('consentLookup', { ...p, consoleId: CONSOLE })).toEqual({ applied: false }); // not leased yet
    const claimed = (await h.claim()).rows.find((r) => r.id === id)!;
    expect(claimed.note).toBe('sample'); // the search text, never signed
    expect((await h.svc.consentLookup(ADMIN, { id })).status).toBe('working');
    expect(await h.sync.push('consentLookup', { ...p, consoleId: CONSOLE, page: 2 })).toEqual({ applied: false });
    expect(await h.sync.push('consentLookup', { ...p, consoleId: CONSOLE })).toEqual({ applied: true, rows: 3 });
    await h.sync.result({ contractVersion: 1, consoleId: CONSOLE, results: [{ id, outcome: 'planned' }] });
    const got = await h.svc.consentLookup(ADMIN, { id });
    expect(got).toMatchObject({ status: 'ready', kind: 'forms', page: 1, pageSize: 25, total: 3 });
    expect(got.rows).toEqual(p.rows);
    await expect(h.svc.consentLookup(ADMIN, { id: nid() })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('a refused lookup reads failed with its reason; consentFix queues for admin only', async () => {
    const h = await setup();
    const id = nid();
    await h.one(ADMIN, lookup(id));
    await h.claim();
    await h.sync.result({ contractVersion: 1, consoleId: CONSOLE, results: [{ id, outcome: 'refused', reason: 'too-old' }] });
    expect(await h.svc.consentLookup(ADMIN, { id })).toMatchObject({ status: 'failed', reason: 'too-old', rows: [] });
    const fix = { kind: 'action', id: nid(), type: 'consentFix', payload: { personId: P_OK, subId: u(801) }, note: null, leaderId: null };
    expect(h.oc(await h.one(DIRECTOR, fix))).toBe('FORBIDDEN');
    expect(h.oc(await h.one(ADMIN, fix))).toBe('saved');
    expect(h.oc(await h.one(ADMIN, { ...fix, id: nid() }))).toBe('duplicate'); // one open fix per person
  });
  it('L6: consentLink queues for admin only, one open per form, link and unlink; the unlinked lookup is stored and read back', async () => {
    const h = await setup();
    const sub = u(802), link = { kind: 'action', id: nid(), type: 'consentLink', payload: { subId: sub, personId: P_OK }, note: null, leaderId: null };
    expect(h.oc(await h.one(DIRECTOR, link))).toBe('FORBIDDEN');
    expect(h.oc(await h.one(ADMIN, { ...link, payload: { subId: sub } }))).toBe('VALIDATION_ERROR');
    expect(h.oc(await h.one(ADMIN, link))).toBe('saved');
    expect(h.oc(await h.one(ADMIN, { ...link, id: nid(), payload: { subId: sub, personId: null } }))).toBe('duplicate'); // one open per form
    const got = (await h.claim()).rows.find((r) => r.id === link.id)!;
    expect(got.type).toBe('consentLink');
    expect(got.payload).toEqual({ subId: sub, personId: P_OK });
    await h.sync.result({ contractVersion: 1, consoleId: CONSOLE, results: [{ id: link.id, outcome: 'planned' }] });
    const un = { ...link, id: nid(), payload: { subId: sub, personId: null } };
    expect(h.oc(await h.one(ADMIN, un))).toBe('saved'); // closed, so unlinking is a new request
    const p = JSON.parse(readFileSync(join(fixtures, 'push-consent-lookup-unlinked.json'), 'utf8')), id = p.requestId as string;
    await h.one(ADMIN, { ...lookup(id, null), payload: { kind: 'unlinked', page: 1, ref: id } });
    await h.claim();
    expect(await h.sync.push('consentLookup', { ...p, consoleId: CONSOLE })).toEqual({ applied: true, rows: 2 });
    await h.sync.result({ contractVersion: 1, consoleId: CONSOLE, results: [{ id, outcome: 'planned' }] });
    expect(await h.svc.consentLookup(ADMIN, { id })).toMatchObject({ status: 'ready', kind: 'unlinked', total: 2, rows: p.rows });
  });
  it('Consents Other (rev 8): an other lookup queues, is claimed, stored and read back (display only: no person, no dedupe on a person)', async () => {
    const h = await setup();
    const p = JSON.parse(readFileSync(join(fixtures, 'push-consent-lookup-other.json'), 'utf8')), id = p.requestId as string;
    expect(h.oc(await h.one(ADMIN, { ...lookup(id, null), payload: { kind: 'other', page: 1, ref: id } }))).toBe('saved');
    const got = (await h.claim()).rows.find((r) => r.id === id)!;
    expect(got.payload).toEqual({ kind: 'other', page: 1, ref: id });
    expect(await h.svc.consentLookup(ADMIN, { id })).toMatchObject({ status: 'working', kind: 'other' });
    expect(await h.sync.push('consentLookup', { ...p, consoleId: CONSOLE, kind: 'forms', rows: [] })).toEqual({ applied: false }); // kind must match the request
    expect(await h.sync.push('consentLookup', { ...p, consoleId: CONSOLE })).toEqual({ applied: true, rows: 2 });
    await h.sync.result({ contractVersion: 1, consoleId: CONSOLE, results: [{ id, outcome: 'planned' }] });
    expect(await h.svc.consentLookup(ADMIN, { id })).toMatchObject({ status: 'ready', kind: 'other', total: 2, rows: p.rows });
    await expect(h.svc.consentLookup(DIRECTOR, { id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('L6: the consents person search needs the intake gate; the lifegroup one is unchanged', async () => {
    const h = await setup();
    await expect(h.svc.youth(DIRECTOR, { scope: 'consents' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await h.svc.youth(ADMIN, { scope: 'consents' })).toEqual({ rows: [] });
    const off = await setup({ intakeAdmin: 'off' });
    await expect(off.svc.youth(ADMIN, { scope: 'consents' })).rejects.toMatchObject({ code: 'MODULE_DISABLED' });
  });
  it('intakeAdmin off: the claim strips consentLookup/consentFix (never leased)', async () => {
    const h = await setup();
    const id = nid();
    await h.one(ADMIN, lookup(id));
    const off = await setup({ intakeAdmin: 'off' });
    expect((await off.link.listConsoles())[0]!.capabilities.consentLookup).toBeUndefined();
    expect((await off.link.listConsoles())[0]!.capabilities.removeFromFlowStep).toBe('live');
    expect((await h.claim()).rows.map((r) => r.id)).toContain(id);
  });
});

// Consents run 2026-10-17 (R4/R6, LINK_REV 9): step 0 past the student's consent Friday with no reply.
describe('rev 9: step-0 Complete past the consent Friday records consent not received (R4)', () => {
  const NPN = 'Brisbane - Youth - New People 2026';
  const P_A = u(111), P_B = u(112), P_C = u(113), P_D = u(114), P_E = u(115);
  const FA = u(531), FB = u(532), FC = u(533), FD = u(534), FE = u(535);
  const step0 = (rowId: string, personId: string, due: string | null, consent: string) => ({ rowId, flowId: NP, flowName: NPN, stepId: STEP0,
    stepName: 'Step 0 - wait', stepOrder: 1, personId, name: 'Sample Kid', due, assignedTo: '', grade: 8, gender: 'female', mobile: '0400000001', mobileIsParent: false, consent });
  async function rev9() {
    const h = await setup();
    await h.link.replaceMirror('flows', [
      step0(FA, P_A, '2026-10-08', 'unknown'), // consent Fri 9 Oct 9:00: passed (NOW = Fri 16 Oct 19:00 Brisbane)
      step0(FB, P_B, '2026-10-16', 'unknown'), // due Fri 16 Oct -> consent Fri 23 Oct: not yet
      step0(FC, P_C, '2026-10-02', 'unknown'), // passed, but a consent row is open for them
      step0(FD, P_D, '2026-10-02', 'ok'), // consent on the profile: the ordinary Complete, nothing recorded
      step0(FE, P_E, null, 'unknown'), // no due date: no consent Friday
    ] as never, { takenAt: '2026-10-16T08:30:00.000Z', consoleId: CONSOLE });
    await h.intake.replace('consent', { date: '2026-10-09', takenAt: NOW.toISOString(), consoleId: CONSOLE, cut: false, inputs: null },
      [consentRow(P_C, 'needs-you')] as never);
    await h.sync.claim({ contractVersion: 1, consoleId: CONSOLE, consoleLabel: 'PC', consoleVersion: '1', inWindow: false, pollSeconds: 60,
      capabilities: ALL, max: 0, leaseSeconds: 300, linkRev: 12 });
    return h;
  }
  const done = (rowId: string, personId: string, extra: Record<string, unknown> = {}) =>
    ({ ...complete(rowId, NP, STEP0, personId), payload: { rowId, flowId: NP, stepId: STEP0, personId, notePrivate: false, ...extra } });

  it('the rules: consent Friday = the first Friday after the due date; passed at 9:00 Brisbane; the verdicts', () => {
    expect(consentFriday('2026-10-16')).toBe('2026-10-23'); // a Friday -> the next one
    expect(consentFriday('2026-10-15')).toBe('2026-10-16');
    expect(consentFriday('2026-10-17')).toBe('2026-10-23');
    expect(consentFriday(null)).toBeNull();
    expect(consentFridayPassed('2026-10-23', new Date('2026-10-22T22:59:00Z'))).toBe(false); // 8:59 Brisbane
    expect(consentFridayPassed('2026-10-23', new Date('2026-10-22T23:00:00Z'))).toBe(true); // 9:00
    const r = (due: string | null, consent: string) => ({ personId: P_A, due, consent });
    expect(consentStepAllowed(r('2026-10-08', 'unknown'), [], NOW)).toBe('notReceived');
    expect(consentStepAllowed(r('2026-10-16', 'unknown'), [], NOW)).toBeNull(); // before the Friday
    expect(consentStepAllowed(r('2026-10-08', 'contact'), [], NOW)).toBeNull(); // DO NOT CONTACT
    expect(consentStepAllowed(r('2026-10-08', 'unknown'), [{ key: P_A, status: 'ready' }], NOW)).toBeNull(); // open consent row
    expect(consentStepAllowed(r('2026-10-08', 'unknown'), [{ key: P_A, status: 'done' }], NOW)).toBe('done');
    expect(consentStepAllowed(r(null, 'ok'), [], NOW)).toBe('done');
  });
  it('allowed and stored with notReceived (set by the server); the claim carries it to the console', async () => {
    const h = await rev9();
    const a = done(FA, P_A);
    expect(h.oc(await h.one(ADMIN, a))).toBe('saved');
    const row = (await h.claim()).rows.find((x) => x.id === a.id)!;
    expect(row.payload).toMatchObject({ rowId: FA, personId: P_A, notReceived: true });
    expect(h.oc(await h.one(ADMIN, a))).toBe('replay'); // the phone resends what it sent: a replay, never LINK_ID_REUSED
  });
  it('refused CONSENT_CHECK_FIRST before the Friday, with an open consent row, or with no due date', async () => {
    const h = await rev9();
    expect(h.oc(await h.one(ADMIN, done(FB, P_B)))).toBe('CONSENT_CHECK_FIRST');
    expect(h.oc(await h.one(ADMIN, done(FC, P_C)))).toBe('CONSENT_CHECK_FIRST');
    expect(h.oc(await h.one(ADMIN, done(FE, P_E)))).toBe('CONSENT_CHECK_FIRST');
  });
  it('a sticky roster DO NOT CONTACT (flow row read as unknown) never records consent not received', async () => {
    const h = await rev9();
    await h.link.replaceMirror('roster', [{ personId: P_A, firstName: 'Sample', lastName: 'Kid', gender: 'female', grade: 8, kind: 'student', consent: 'contact' }] as never,
      { takenAt: '2026-10-16T08:40:00.000Z', consoleId: CONSOLE });
    expect(h.oc(await h.one(ADMIN, done(FA, P_A)))).toBe('LINK_DNC'); // CY-B1: as the step list shows it
    expect((await h.svc.flows(ADMIN)).rows.find((x) => x.rowId === FA)).toMatchObject({ dnc: true, notReceivedOk: false });
  });
  it('a phone-sent notReceived is never trusted: dropped on an ordinary Complete', async () => {
    const h = await rev9();
    const d = done(FD, P_D, { notReceived: true });
    expect(h.oc(await h.one(ADMIN, d))).toBe('saved');
    const row = (await h.claim()).rows.find((x) => x.id === d.id)!;
    expect(row.payload).not.toHaveProperty('notReceived');
  });
  it('GET /link/flows: consentFriday on step-0 rows, notReceivedOk only once the Friday passed (R6 waiting label)', async () => {
    const h = await rev9();
    const rows = (await h.svc.flows(ADMIN)).rows;
    const by = (id: string) => rows.find((x) => x.rowId === id)!;
    expect(by(FA)).toMatchObject({ consentFriday: '2026-10-09', notReceivedOk: true });
    expect(by(FB)).toMatchObject({ consentFriday: '2026-10-23', notReceivedOk: false });
    expect(by(FC)).toMatchObject({ consentFriday: '2026-10-09', notReceivedOk: false }); // an open consent row: the batch would refuse it
    expect(by(FD)).toMatchObject({ notReceivedOk: false }); // consent ok: the ordinary Complete
    expect(by(FE)).toMatchObject({ consentFriday: null, notReceivedOk: false });
  });
});

describe('rev 10: the consent Friday counts from the parent-texted date (R8); Mark not received on Consents Other (R9)', () => {
  const NPN = 'Brisbane - Youth - New People 2026';
  const P_A = u(121), P_B = u(122), P_C = u(123), P_D = u(124), P_E = u(125);
  const FA = u(541), FB = u(542), FC = u(543), FD = u(544), FE = u(545), GONE = u(549);
  const step0 = (rowId: string, personId: string, due: string | null, textedOn: string | null, consent = 'unknown') => ({ rowId, flowId: NP,
    flowName: NPN, stepId: STEP0, stepName: 'Step 0 - wait', stepOrder: 1, personId, name: 'Sample Kid', due, assignedTo: '', grade: 8,
    gender: 'female', mobile: '0400000001', mobileIsParent: false, consent, textedOn });
  // NOW = Fri 16 Oct 19:00 Brisbane.
  async function rev10() {
    const h = await setup();
    await h.link.replaceMirror('flows', [
      step0(FA, P_A, '2026-10-01', '2026-10-16'), // due says Fri 2 Oct (passed); texted Fri 16 Oct -> Fri 23 Oct: the text wins, waiting
      step0(FB, P_B, '2026-10-16', '2026-10-05'), // due says Fri 23 Oct; texted Mon 5 Oct -> Fri 9 Oct: passed
      step0(FC, P_C, '2026-10-08', null), // no texted date: the due date, Fri 9 Oct: passed
      step0(FE, P_E, null, '2026-10-07'), // no due date, texted Wed 7 Oct -> Fri 9 Oct: passed (eligible since R8)
      step0(FD, P_D, null, '2026-10-07', 'contact'), // DO NOT CONTACT: never
    ] as never, { takenAt: '2026-10-16T08:30:00.000Z', consoleId: CONSOLE });
    const claim = (max = 20) => h.sync.claim({ contractVersion: 1, consoleId: CONSOLE, consoleLabel: 'PC', consoleVersion: '1', inWindow: false,
      pollSeconds: 60, capabilities: ALL, max, leaseSeconds: 300, linkRev: 12 });
    await claim(0);
    return { ...h, claim };
  }
  const done = (rowId: string, personId: string) =>
    ({ ...complete(rowId, NP, STEP0, personId), payload: { rowId, flowId: NP, stepId: STEP0, personId, notePrivate: false } });
  const otherRow = (personId: string, rowId: string) => ({ personId, rowId, name: 'Kid, Sample', date: '2026-10-07', source: 'parent note', why: '', link: null });
  async function otherLookup(h: Awaited<ReturnType<typeof rev10>>) {
    const id = nid();
    expect(h.oc(await h.one(ADMIN, { kind: 'action', id, type: 'consentLookup', payload: { kind: 'other', page: 1, ref: id }, note: null, leaderId: null }))).toBe('saved');
    await h.claim();
    const rows = [otherRow(P_A, FA), otherRow(P_B, FB), otherRow(P_C, FC), otherRow(P_E, FE), otherRow(P_D, FD), otherRow(u(129), GONE)];
    expect(await h.sync.push('consentLookup', { contractVersion: 1, consoleId: CONSOLE, takenAt: NOW.toISOString(), requestId: id, page: 1,
      pageSize: 25, kind: 'other', total: rows.length, rows })).toMatchObject({ applied: true });
    await h.sync.result({ contractVersion: 1, consoleId: CONSOLE, results: [{ id, outcome: 'planned' }] });
    const got = await h.svc.consentLookup(ADMIN, { id });
    expect(got.status).toBe('ready');
    return { id, by: (rowId: string) => (got.rows as Record<string, unknown>[]).find((r) => r.rowId === rowId)! };
  }

  it('the rules: the texted date is preferred over the due date, the due date is the fallback, a texted date alone is enough', () => {
    expect(consentFriday('2026-10-01', '2026-10-16')).toBe('2026-10-23'); // texted wins over an earlier due
    expect(consentFriday('2026-10-16', '2026-10-05')).toBe('2026-10-09'); // and over a later one
    expect(consentFriday('2026-10-08', null)).toBe('2026-10-09'); // no texted date: the due date
    expect(consentFriday('2026-10-08', 'not-a-date')).toBe('2026-10-09');
    expect(consentFriday(null, '2026-10-07')).toBe('2026-10-09'); // no due date
    expect(consentFriday(null, null)).toBeNull();
    const r = (due: string | null, textedOn: string | null) => ({ personId: P_A, consent: 'unknown', due, textedOn });
    expect(consentStepAllowed(r('2026-10-01', '2026-10-16'), [], NOW)).toBeNull(); // the text says wait
    expect(consentStepAllowed(r('2026-10-16', '2026-10-05'), [], NOW)).toBe('notReceived');
    expect(consentStepAllowed(r('2026-10-08', null), [], NOW)).toBe('notReceived');
    expect(consentStepAllowed(r(null, '2026-10-07'), [], NOW)).toBe('notReceived');
    expect(consentStepAllowed(r(null, null), [], NOW)).toBeNull();
  });
  it('the flows push stores textedOn (rev 10 fixture); a row without it (an older console) reads null', async () => {
    const h = await rev10();
    const fx = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'elvanto-link', 'push-flows-rev10.json'), 'utf8'));
    expect(await h.sync.push('flows', { ...fx, consoleId: CONSOLE, takenAt: '2026-10-16T08:50:00.000Z' })).toMatchObject({ applied: true });
    const t = async (id: string) => (await h.link.flows()).find((f) => f.rowId === id)!.textedOn;
    expect([await t(fx.rows[0].rowId), await t(fx.rows[1].rowId)]).toEqual(['2026-10-12', null]);
    const { textedOn: _t, ...old } = fx.rows[0];
    expect(await h.sync.push('flows', { ...fx, consoleId: CONSOLE, takenAt: '2026-10-16T08:55:00.000Z', rows: [old] })).toMatchObject({ applied: true });
    expect((await h.link.flows())[0]!.textedOn).toBeNull();
  });
  it('GET /link/flows and the batch use the same date: waiting by the text, eligible by the text, by the due date, with no due date', async () => {
    const h = await rev10();
    const by = async (id: string) => (await h.svc.flows(ADMIN)).rows.find((x) => x.rowId === id)!;
    expect(await by(FA)).toMatchObject({ consentFriday: '2026-10-23', notReceivedOk: false });
    expect(await by(FB)).toMatchObject({ consentFriday: '2026-10-09', notReceivedOk: true });
    expect(await by(FC)).toMatchObject({ consentFriday: '2026-10-09', notReceivedOk: true });
    expect(await by(FE)).toMatchObject({ consentFriday: '2026-10-09', notReceivedOk: true });
    expect(await by(FD)).toMatchObject({ dnc: true, notReceivedOk: false });
    expect(h.oc(await h.one(ADMIN, done(FA, P_A)))).toBe('CONSENT_CHECK_FIRST');
    const e = done(FE, P_E);
    expect(h.oc(await h.one(ADMIN, e))).toBe('saved');
    expect((await h.claim()).rows.find((x) => x.id === e.id)!.payload).toMatchObject({ rowId: FE, notReceived: true });
  });
  it('R9: Other rows carry the step-0 wait (one date with the step list); DO NOT CONTACT and gone rows get no button', async () => {
    const h = await rev10();
    const { by } = await otherLookup(h);
    expect(by(FA)).toMatchObject({ flowId: NP, stepId: STEP0, consentFriday: '2026-10-23', notReceivedOk: false, dnc: false, marking: false });
    for (const f of [FB, FC, FE]) expect(by(f)).toMatchObject({ flowId: NP, stepId: STEP0, consentFriday: '2026-10-09', notReceivedOk: true, marking: false });
    expect(by(FD)).toMatchObject({ dnc: true, notReceivedOk: false });
    expect(by(GONE)).toMatchObject({ flowId: null, notReceivedOk: false });
    expect(by(FB)).toMatchObject({ name: 'Kid, Sample', date: '2026-10-07', source: 'parent note' }); // the console's row is kept
  });
  it('R9: a sticky roster DO NOT CONTACT shows on the Other row and the batch refuses it', async () => {
    const h = await rev10();
    await h.link.replaceMirror('roster', [{ personId: P_C, firstName: 'Sample', lastName: 'Kid', gender: 'female', grade: 8, kind: 'student', consent: 'all' }] as never,
      { takenAt: '2026-10-16T08:40:00.000Z', consoleId: CONSOLE });
    const { by } = await otherLookup(h);
    expect(by(FC)).toMatchObject({ dnc: true, notReceivedOk: false });
    expect(h.oc(await h.one(ADMIN, done(FC, P_C)))).toBe('LINK_DNC'); // CY-B1: the sticky roster flag, as the row shows it
    expect(h.oc(await h.one(ADMIN, done(FD, P_D)))).toBe('LINK_DNC');
  });
  it('R9: per-row and Mark all: one batch, each row its own answer (only rows past their Friday), then marking; a repeat is a duplicate', async () => {
    const h = await rev10();
    const one = done(FB, P_B);
    expect(h.oc(await h.one(ADMIN, one))).toBe('saved'); // per-row
    const all = [done(FC, P_C), done(FE, P_E), done(FA, P_A)]; // Mark all (a stale page may still hold FA)
    const res = (await h.svc.batch(ADMIN, { device: DEV, items: all })).results;
    expect(res.map(h.oc)).toEqual(['saved', 'saved', 'CONSENT_CHECK_FIRST']); // per-row failures, the rest go on
    const claimed = (await h.claim()).rows;
    for (const x of [one, all[0]!, all[1]!]) expect(claimed.find((r) => r.id === x.id)!.payload).toMatchObject({ notReceived: true });
    const { by } = await otherLookup(h);
    for (const f of [FB, FC, FE]) expect(by(f)).toMatchObject({ marking: true });
    expect(by(FA)).toMatchObject({ marking: false });
    expect(h.oc(await h.one(ADMIN, done(FB, P_B)))).toBe('duplicate'); // a second tap with a new id never queues twice
  });
});
