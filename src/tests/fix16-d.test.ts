// Fix round 16 Oct 2026, lane D: contract C-1 (LINK_REV 7), link-errors wording, the hurry hint.
import { describe, it, expect } from 'vitest';
import * as C from '../core/link-contract';
import { applyOutcome } from '../services/link-rules';
import { makeLinkService, LINK_RATE_MAX, LINK_RATE_WINDOW_MS } from '../services/link.service';
import { makeSyncService } from '../services/sync.service';
import { InMemoryLinkRepository } from '../repositories/in-memory/link.repository';
import {
  InMemorySettingsRepository, InMemoryStudentRepository, InMemoryLeaderRepository, InMemoryUserRepository,
  InMemoryServiceSessionRepository, InMemoryServiceAttendanceRepository,
} from '../repositories/in-memory';
import { MINISTRY_CONFIG_DEFAULTS } from '../core/ministry-config';
import { makeIntakeService } from '../services/link-intake.service';
import { RateLimiter } from '../utils/rate-limiter';
import type { Actor } from '../core/entities/user';

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('C-1: LINK_REV 7, optional linked + note', () => {
  it('LINK_REV is 7; the contract version stays 1', () => {
    expect(C.LINK_REV).toBe(7);
    expect(C.LINK_CONTRACT_VERSION).toBe(1);
  });
  it('a sent result may carry note sent|failed; anything else is refused; missing still parses', () => {
    const base = { id: u(1), outcome: 'sent', sentLogKey: 'k' };
    expect(C.ResultItem.parse(base)).not.toHaveProperty('note');
    expect((C.ResultItem.parse({ ...base, note: 'failed' }) as any).note).toBe('failed');
    expect(C.ResultItem.safeParse({ ...base, note: 'maybe' }).success).toBe(false);
  });
  it('a mismatch row may carry linked', () => {
    const side = { consentDate: '1/1/2026', total: '', optOuts: [] };
    const row = { subId: u(2), personId: u(3), name: 'A B', submitted: '2026-10-01', diffs: ['opt-outs'], form: side, profile: side };
    expect(C.ConsentMismatchRow.parse(row)).not.toHaveProperty('linked');
    expect(C.ConsentMismatchRow.parse({ ...row, linked: true }).linked).toBe(true);
  });
  it('note failed is kept on the row as NOTE_FAILED_DETAIL; note sent / none keeps detail null', () => {
    const row = { id: u(1), status: 'claimed', leaseOwner: u(9), reportId: null, personId: null } as any;
    const now = new Date('2026-10-16T09:00:00Z');
    const r1 = applyOutcome(row, { id: u(1), outcome: 'sent', sentLogKey: 'k', note: 'failed' } as any, u(9), now) as any;
    expect(r1.next.status).toBe('sent');
    expect(r1.next.detail).toBe(C.NOTE_FAILED_DETAIL);
    const r2 = applyOutcome(row, { id: u(1), outcome: 'sent', sentLogKey: 'k', note: 'sent' } as any, u(9), now) as any;
    expect(r2.next.detail).toBeNull();
  });
});

describe('F-37: GET /link/actions carries note failed', () => {
  const NOW = new Date('2026-10-16T09:00:00.000Z'), T0 = '2026-10-01T00:00:00.000Z';
  const ADMIN_ID = u(1), CONSOLE = u(601), FLOW = u(511), STEP = u(521), ROW = u(501), PER = u(101);
  const ADMIN = { id: ADMIN_ID, role: 'admin', displayName: 'admin', grade: null, quad: null, gender: null, leaderId: null } as unknown as Actor;
  async function setup() {
    const link = new InMemoryLinkRepository({ now: () => NOW });
    const settings = new InMemorySettingsRepository(), students = new InMemoryStudentRepository(), leaders = new InMemoryLeaderRepository();
    const users = new InMemoryUserRepository(), sessions = new InMemoryServiceSessionRepository(), attendance = new InMemoryServiceAttendanceRepository();
    for (const r of [settings, students, leaders, users, sessions, attendance]) await r.init();
    await settings.updateSettings({ ministryConfig: { ...MINISTRY_CONFIG_DEFAULTS, modules: { ...MINISTRY_CONFIG_DEFAULTS.modules, flows: 'on' } } } as never);
    await users.save({ id: ADMIN_ID, email: 'admin', displayName: 'admin', role: 'admin', status: 'active', createdAt: T0, updatedAt: T0 } as never);
    await link.replaceMirror('flows', [{ rowId: ROW, flowId: FLOW, flowName: 'Follow up', stepId: STEP, stepName: 'Call', stepOrder: 2,
      personId: PER, name: 'Sample Kid', due: null, assignedTo: '', grade: 8, gender: 'female', mobile: null, mobileIsParent: false, consent: 'ok' }] as never,
      { takenAt: '2026-10-16T08:00:00.000Z', consoleId: CONSOLE });
    const svc = makeLinkService({ link, settings, students, leaders, users, serviceSessions: sessions, serviceAttendance: attendance,
      limiter: new RateLimiter(LINK_RATE_MAX, LINK_RATE_WINDOW_MS), now: () => NOW } as never);
    const sync = makeSyncService({ link, settings, students, users, now: () => NOW } as never);
    const claim = (max: number) => sync.claim({ contractVersion: 1, consoleId: CONSOLE, consoleLabel: 'PC', consoleVersion: '1', inWindow: false,
      pollSeconds: 60, capabilities: { checkIn: 'live', checkOut: 'live', submitReport: 'live', editReport: 'live', completeStep: 'live', firstTimerCheckIn: 'live', removeFromFlowStep: 'live' } as never, max, leaseSeconds: 300, linkRev: 7 });
    await claim(0);
    return { svc, sync, claim };
  }
  for (const [note, want] of [['failed', 'failed'], ['sent', undefined], [undefined, undefined]] as const) {
    it(`a sent remove with note ${note} lists note ${want}`, async () => {
      const h = await setup();
      const id = u(9001);
      const r = (await h.svc.batch(ADMIN, { device: { id: 'd', label: 't' }, items: [{ kind: 'action', id, type: 'removeFromFlowStep',
        payload: { rowId: ROW, flowId: FLOW, stepId: STEP, personId: PER }, note: null, leaderId: null }] })).results[0]!;
      expect(r.outcome).toBe('saved');
      expect((await h.claim(5)).rows.map((x: any) => x.id)).toContain(id);
      await h.sync.result({ contractVersion: 1, consoleId: CONSOLE, results: [{ id, outcome: 'sent', sentLogKey: 'k', ...(note ? { note } : {}) }] } as never);
      const rows = await h.svc.listActions(ADMIN, { ids: id });
      expect(rows[0]!.status).toBe('sent');
      expect(rows[0]!.note).toBe(want);
      expect('note' in rows[0]!).toBe(want !== undefined);
    });
  }
});

describe('GAP-3: any pending link row asks the console to hurry', () => {
  const svc = (pending: { type: string }[]) => makeIntakeService({
    link: { listActions: async (f: any) => pending.filter((r) => !f.types || f.types.includes(r.type)) } as never,
    intake: { purge: async () => undefined, viewedAt: async () => null, dates: async () => [] } as never,
    settings: {} as never, status: async () => ({}) as never, now: () => new Date('2026-10-16T08:00:00Z') });
  const S = (intakeAdmin: string) => ({ ministryConfig: { modules: { intakeAdmin } } }) as never;
  it('a pending checkIn gives hurry true, intake on or off', async () => {
    expect((await svc([{ type: 'checkIn' }]).hint(S('on'))).hurry).toBe(true);
    expect((await svc([{ type: 'checkIn' }]).hint(S('off')))).toEqual({ mode: 'off', hurry: true, refresh: [] });
  });
  it('nothing pending: no hurry', async () => {
    expect((await svc([]).hint(S('on'))).hurry).toBe(false);
    expect((await svc([]).hint(S('off'))).hurry).toBe(false);
  });
});
