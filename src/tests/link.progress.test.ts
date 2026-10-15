// S5 (run 2026-10-15b): POST /sync/push/progress (additive, no rev bump) and where the screens read it back.
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
import { ClaimResponse, PUSH_SCHEMAS } from '../core/link-contract';
import type { Actor } from '../core/entities/user';

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = '2026-10-01T00:00:00.000Z', ADMIN_ID = u(1), CONSOLE = u(601);
const ADMIN = { id: ADMIN_ID, role: 'admin', displayName: 'admin', grade: null, quad: null, gender: null, leaderId: null } as Actor;

async function setup() {
  const clock = { t: Date.parse('2026-10-16T09:00:00.000Z') }, now = () => new Date(clock.t);
  const link = new InMemoryLinkRepository({ now });
  const settings = new InMemorySettingsRepository(), students = new InMemoryStudentRepository(), leaders = new InMemoryLeaderRepository();
  const users = new InMemoryUserRepository(), sessions = new InMemoryServiceSessionRepository(), attendance = new InMemoryServiceAttendanceRepository();
  for (const r of [settings, students, leaders, users, sessions, attendance]) await r.init();
  await settings.updateSettings({ ministryConfig: { ...MINISTRY_CONFIG_DEFAULTS,
    modules: { ...MINISTRY_CONFIG_DEFAULTS.modules, flows: 'on', intakeAdmin: 'on' } } } as never);
  await users.save({ id: ADMIN_ID, email: 'admin', displayName: 'admin', role: 'admin', status: 'active', createdAt: T0, updatedAt: T0 } as never);
  const svc = makeLinkService({ link, settings, students, leaders, users, serviceSessions: sessions, serviceAttendance: attendance,
    limiter: new RateLimiter(LINK_RATE_MAX, LINK_RATE_WINDOW_MS), now, intake: new InMemoryLinkIntakeRepository(now) });
  const sync = makeSyncService({ link, settings, students, users, now });
  const claim = () => sync.claim({ contractVersion: 1, consoleId: CONSOLE, consoleLabel: 'PC', consoleVersion: '1', inWindow: false,
    pollSeconds: 60, capabilities: { checkIn: 'live', checkOut: 'live', submitReport: 'live', editReport: 'live', completeStep: 'live', firstTimerCheckIn: 'live', consentLookup: 'live' }, max: 20, leaseSeconds: 300, linkRev: 6 });
  const prog = (key: string, done: number | null, total: number | null, stage = 'Reading') =>
    sync.push('progress', { contractVersion: 1, consoleId: CONSOLE, takenAt: now().toISOString(), key, done, total, stage });
  return { clock, link, svc, sync, claim, prog };
}

describe('S5 progress', () => {
  it('the claim reply offers progress (schema-valid); a bad key, an extra field or a name-length stage is handled', async () => {
    const h = await setup();
    const r = await h.claim();
    expect(r.progress).toBe(true);
    expect(ClaimResponse.parse(r).progress).toBe(true);
    const base = { contractVersion: 1, consoleId: CONSOLE, takenAt: T0, done: 1, total: 2, stage: 'x' };
    expect(() => PUSH_SCHEMAS.progress.parse({ ...base, key: 'roster' })).toThrow();
    expect(() => PUSH_SCHEMAS.progress.parse({ ...base, key: 'flows', name: 'Kid' })).toThrow();
    expect(() => PUSH_SCHEMAS.progress.parse({ ...base, key: 'flows', total: 0 })).toThrow();
    expect(PUSH_SCHEMAS.progress.parse({ ...base, key: 'intake:consent:2026-10-16', stage: 'y'.repeat(99) }).stage).toHaveLength(60);
    await expect(h.sync.push('progress', { ...base, key: 'nope' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('status carries fresh entries only; an unknown console stores nothing', async () => {
    const h = await setup();
    expect(await h.prog('intake:intake:2026-10-16', null, null, 'Reading Elvanto')).toEqual({ applied: true }); // no console row yet
    expect((await h.svc.status(ADMIN)).console.progress).toEqual({});
    await h.claim();
    await h.prog('intake:intake:2026-10-16', null, null, 'Reading Elvanto');
    expect((await h.svc.status(ADMIN)).console.progress).toEqual({ 'intake:intake:2026-10-16': { done: null, total: null, stage: 'Reading Elvanto' } });
    h.clock.t += 3 * 60e3; // past the 2 min freshness
    expect((await h.svc.status(ADMIN)).console.progress).toEqual({});
  });

  it('a working lookup shows its own progress; the claim upsert keeps it', async () => {
    const h = await setup();
    const id = u(700);
    await h.svc.batch(ADMIN, { device: { id: 'd', label: 'x' }, items: [{ kind: 'action', id, type: 'consentLookup', payload: { kind: 'forms', page: 1, ref: id }, note: null, leaderId: null }] });
    await h.claim();
    expect((await h.svc.consentLookup(ADMIN, { id })).progress).toBeNull();
    await h.prog(`lookup:${id}`, 3, 40, 'Reading the form list');
    await h.claim(); // a re-claim must not wipe it
    expect((await h.svc.consentLookup(ADMIN, { id })).progress).toEqual({ done: 3, total: 40, stage: 'Reading the form list' });
  });

  it('flows: progress only while newer than the last flows push', async () => {
    const h = await setup();
    await h.claim();
    await h.prog('flows', 2, 9, 'Reading flow steps');
    expect((await h.svc.flows(ADMIN)).progress).toEqual({ done: 2, total: 9, stage: 'Reading flow steps' });
    h.clock.t += 1000;
    await h.link.replaceMirror('flows', [], { takenAt: new Date(h.clock.t).toISOString(), consoleId: CONSOLE });
    expect((await h.svc.flows(ADMIN)).progress).toBeNull();
  });
});
