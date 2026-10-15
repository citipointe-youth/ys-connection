// LINK_REV 6 (run 2026-10-15 lane A; ux-run-2026-10-15/CONTRACT-REV6.md): flow-row consent / DNC, the consent-step guard
// (review C1), removeFromFlowStep, consentLookup (+ its push and GET), consentFix, and the claim's handling of them.
import { describe, it, expect } from 'vitest';
import { makeLinkService, LINK_RATE_MAX, LINK_RATE_WINDOW_MS } from '../services/link.service';
import { makeSyncService } from '../services/sync.service';
import { InMemoryLinkRepository } from '../repositories/in-memory/link.repository';
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
  removeFromFlowStep: 'live', consentLookup: 'live', consentFix: 'locked', consentLink: 'live' } as const;

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
  await leaders.save({ id: L_DANA, fullName: 'Dana Day', gender: 'female', grades: [], active: true, createdByGrade: null,
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
    consoleVersion: '1', inWindow: false, pollSeconds: 60, capabilities: caps, max, leaseSeconds: 300, linkRev: 6 });
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
