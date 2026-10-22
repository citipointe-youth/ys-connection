// Consent hub cache (LINK_REV 19, 2026-10-23): the console pushes each consent list whole (consentSnapshot); the app keeps the latest
// copy per kind, serves it at once, and asks for a re-read through the claim reply (consentSnap.ask) only to a rev 19 console.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeLinkService } from '../services/link.service';
import { makeIntakeService } from '../services/link-intake.service';
import { makeSyncService } from '../services/sync.service';
import { InMemoryLinkRepository } from '../repositories/in-memory/link.repository';
import { InMemoryLinkIntakeRepository } from '../repositories/in-memory/link-intake.repository';
import { InMemorySettingsRepository, InMemoryStudentRepository, InMemoryLeaderRepository, InMemoryUserRepository,
  InMemoryServiceSessionRepository, InMemoryServiceAttendanceRepository } from '../repositories/in-memory';
import { MINISTRY_CONFIG_DEFAULTS } from '../core/ministry-config';
import { LINK_REV, PUSH_SCHEMAS } from '../core/link-contract';
import type { Actor } from '../core/entities/user';

const fx = (f: string): any => JSON.parse(readFileSync(join(__dirname, 'fixtures', 'elvanto-link', f), 'utf8'));
const SNAP = () => fx('push-consent-snapshot-rev19.json');
const NOW = new Date('2026-10-23T01:00:00.000Z');
const ADMIN = { id: '00000000-0000-4000-8000-000000000001', role: 'admin', displayName: 'admin', grade: null, quad: null, gender: null, leaderId: null } as Actor;

async function setup(o: { intake?: 'on' | 'off'; rev?: number } = {}) {
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
  const errorLog = { record: vi.fn(async () => {}) };
  const svc = makeLinkService({ link, settings, students, leaders, users, serviceSessions: sessions, serviceAttendance: attendance,
    limiter: { isBlocked: () => false }, now, errorLog, intake: intakeRepo });
  const intake = makeIntakeService({ intake: intakeRepo, link, settings, status: (a) => svc.status(a), now, errorLog });
  const sync = makeSyncService({ link, settings, students, users, now, errorLog, intake });
  await link.claim({ console: { consoleId: SNAP().consoleId, label: 'Desk', contractVersion: 1, consoleVersion: 't', inWindow: false,
    pollSeconds: 60, capabilities: { consentLookup: 'live' } as never, linkRev: o.rev ?? 19 }, max: 0, leaseSeconds: 180, cutoffDays: 3,
    leaseLostMs: 3_600_000 });
  return { clock, link, svc, intake, sync };
}
const claim = (h: Awaited<ReturnType<typeof setup>>, rev: number) => h.sync.claim({ ...fx('claim-request.json'), linkRev: rev });

describe('consentSnapshot contract (rev 19)', () => {
  it('LINK_REV is 19 and the fixture parses; a row of the wrong kind is refused', () => {
    expect(LINK_REV).toBe(19);
    expect(() => PUSH_SCHEMAS.consentSnapshot.parse(SNAP())).not.toThrow();
    expect(() => PUSH_SCHEMAS.consentSnapshot.parse({ ...SNAP(), kind: 'mismatches' })).toThrow();
  });
});

describe('the app keeps the latest copy per kind', () => {
  it('a push is stored and GET /link/consents/snapshot serves it at once, live for a rev 19 console', async () => {
    const h = await setup();
    expect(await h.sync.push('consentSnapshot', SNAP())).toEqual({ applied: true, rows: 1 });
    const r = await h.svc.consentSnapshot(ADMIN) as any;
    expect(r.live).toBe(true);
    expect(r.kinds.unlinked).toMatchObject({ total: 1, takenAt: SNAP().takenAt });
    expect(r.kinds.unlinked.rows[0].formName).toBe('Jo Sample, Bo Sample');
    expect(r.kinds.forms).toBeNull();
  });
  it('stale and off: an older takenAt is ignored; module Off stores nothing, and turning it Off clears the copy', async () => {
    const h = await setup();
    await h.sync.push('consentSnapshot', SNAP());
    expect(await h.sync.push('consentSnapshot', { ...SNAP(), takenAt: '2026-10-23T00:10:00.000Z', total: 0, rows: [] })).toEqual({ applied: false });
    expect(((await h.svc.consentSnapshot(ADMIN)) as any).kinds.unlinked.total).toBe(1);
    await h.intake.off();
    expect(((await h.svc.consentSnapshot(ADMIN)) as any).kinds.unlinked).toBeNull();
    const off = await setup({ intake: 'off' });
    expect(await off.sync.push('consentSnapshot', SNAP())).toEqual({ applied: false });
  });
  it('a rev 18 console reads live: false (the hub falls back to the on-demand lookups)', async () => {
    const h = await setup({ rev: 18 });
    expect(((await h.svc.consentSnapshot(ADMIN)) as any).live).toBe(false);
  });
});

describe('Refresh asks a rev 19 console through the claim reply', () => {
  it('ask is true after Refresh until a newer copy of every kind lands; a rev 18 claim gets no key', async () => {
    const h = await setup();
    expect((await claim(h, 19)).consentSnap).toEqual({ ask: false });
    expect(await h.svc.consentSnapshotRefresh(ADMIN)).toEqual({ asked: true });
    expect(await h.svc.consentSnapshotRefresh(ADMIN)).toEqual({ asked: false }); // once a minute
    expect((await claim(h, 19)).consentSnap).toEqual({ ask: true });
    expect((await claim(h, 18)).consentSnap).toBeUndefined();
    h.clock.now = new Date(NOW.getTime() + 60_000);
    for (const kind of ['forms', 'mismatches', 'unlinked', 'other'] as const) {
      await h.sync.push('consentSnapshot', { ...SNAP(), kind, takenAt: h.clock.now.toISOString(), total: 0, rows: [] });
    }
    expect((await claim(h, 19)).consentSnap).toEqual({ ask: false });
  });
});
