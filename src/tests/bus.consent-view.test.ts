// Bus consent (spec 2026-10-22 §5.4, R7/R11): the chip + details on Bus views; status, check and prefill.
import { describe, it, expect, vi } from 'vitest';
import { makeBusService } from '../services/bus.service';
import { InMemoryLinkRepository } from '../repositories/in-memory/link.repository';
import { setup } from './helpers/bus-setup';
import type { BusConsentForm } from '../core/entities/bus';

const form = (over: Partial<BusConsentForm>): BusConsentForm => ({ id: 'f1', submissionId: 'b5c10000-0000-4000-8000-000000000001', childIndex: 0,
  submittedAt: '2026-10-05T01:00:00.000Z', year: 2026, studentId: 's1', guestId: null, first: 'Jess', last: 'Tran', source: 'public', createdAt: '2026-10-05T01:05:00.000Z',
  data: { grade: 9, gender: 'female', mobile: '0400000001', school: 'Example High', address: { line1: '1 Test St', line2: '-', postcode: '4000', city: 'Brisbane City', state: 'QLD' },
    parentName: 'Alex Tran', parentPhone: '0400000003', pickup: true, pickupBy: '', filedBy: null }, ...over });

async function withLink() {
  const t = await setup();
  const link = new InMemoryLinkRepository();
  const svc = makeBusService(t.bus, t.students, t.leaders, t.settings, undefined, undefined, undefined, { link });
  return { ...t, svc, link };
}
const juniorOf = (t: Awaited<ReturnType<typeof withLink>>) => ({ ...t.ctx('leader'), actor: { ...t.ctx('leader').actor, leaderId: 'L1' } });
const claimWith = (link: InMemoryLinkRepository, caps: Record<string, string>) => link.claim({ console: { consoleId: '8f5a1c2e-0000-4000-8000-000000000001',
  label: 'PC', contractVersion: 1, consoleVersion: 'x', inWindow: false, pollSeconds: 60,
  capabilities: { checkIn: 'live', checkOut: 'live', submitReport: 'live', editReport: 'live', completeStep: 'live', firstTimerCheckIn: 'live', ...caps } as any, linkRev: 18 },
  max: 0, leaseSeconds: 300, cutoffDays: 3, leaseLostMs: 3_600_000, swept: [] });

describe('consent status on Bus views (R7, R11)', () => {
  it('a rider with a current form is green with details for admin; a junior leader gets {year, current} only', async () => {
    const t = await withLink();
    await t.bus.upsertConsentForms([form({})]);
    await t.svc.addRider(t.ctx('admin'), { studentId: 's1', newAddress: { label: 'Home', address: '9 Other Rd, Carina', placeId: 'fake:1' } });
    const admin = (await t.svc.getRun(t.ctx('admin'))).riders[0]!.consent;
    expect(admin).toMatchObject({ year: 2026, current: true, details: { parentName: 'Alex Tran', parentPhone: '0400000003' } });
    const junior = (await t.svc.getRun(juniorOf(t))).riders[0]!.consent;
    expect(junior).toEqual({ year: 2026, current: true });
  });
  it('only last year on file reads No consent this year; consent never blocks Generate or Move', async () => {
    const t = await withLink();
    await t.bus.upsertConsentForms([form({ year: 2025, submittedAt: '2025-12-20T01:00:00.000Z' })]);
    const r = await t.svc.addRider(t.ctx('admin'), { studentId: 's1', newAddress: { label: 'Home', address: '1 Test St, Brisbane City', placeId: 'fake:1' } });
    expect(r.consent).toEqual({ year: 2026, current: false });
  });
  it('coordinators get differs when the consent address is not the rider address', async () => {
    const t = await withLink();
    await t.bus.upsertConsentForms([form({})]);
    await t.svc.addRider(t.ctx('admin'), { studentId: 's1', newAddress: { label: 'Home', address: '9 Other Rd, Carina QLD 4152, Australia', placeId: 'fake:1' } });
    expect((await t.svc.getRun(t.ctx('admin'))).riders[0]!.consent.differs).toBe(true);
  });
  it('same address: differs false; a non-coordinator grade login never gets differs', async () => {
    const t = await withLink();
    await t.bus.upsertConsentForms([form({})]);
    await t.svc.addRider(t.ctx('admin'), { studentId: 's1', newAddress: { label: 'Home', address: '1 Test St, Brisbane City QLD 4000, Australia', placeId: 'fake:1' } });
    expect((await t.svc.getRun(t.ctx('admin'))).riders[0]!.consent.differs).toBe(false);
    expect((await t.svc.getRun(t.ctx('grade'))).riders[0]!.consent).not.toHaveProperty('differs');
  });
  it('F16: a rider on a running bus (drop-off address) gets no differs hint', async () => {
    const t = await withLink();
    const v = await t.svc.saveVehicle(t.ctx('admin'), { name: 'Charter', seats: 40, kind: 'bus', endsAt: 'address', endsAddress: '5 Depot Rd, Carindale QLD', endsPlaceId: 'fake:depot' });
    const rv = (await t.svc.getRun(t.ctx('admin'))).vehicles.find((x) => x.vehicleId === v.id)!;
    await t.svc.updateRunVehicle(t.ctx('admin'), rv.id, { leaderIds: ['L1'] });
    await t.bus.upsertConsentForms([form({})]);
    await t.svc.addRider(t.ctx('admin'), { studentId: 's1', busRunVehicleId: rv.id });
    const r = (await t.svc.getRun(t.ctx('admin'))).riders[0]!;
    expect(r.runVehicleId).toBe(rv.id);
    expect(r.consent.current).toBe(true);
    expect(r.consent).not.toHaveProperty('differs');
  });
  it('search hits carry the chip too (students not on the bus)', async () => {
    const t = await withLink();
    await t.bus.upsertConsentForms([form({})]);
    expect((await t.svc.search(t.ctx('admin'), 'Jess'))[0]!.consent).toMatchObject({ current: true });
  });
});

describe('status, check and prefill', () => {
  it('check queues one row; a second tap reuses it; checking shows; a 10-minute-old pending row is replaced', async () => {
    const t = await withLink();
    await claimWith(t.link, { busConsentCheck: 'live' });
    const a = await t.svc.consentCheck(t.ctx('admin'));
    expect((await t.svc.consentCheck(t.ctx('admin'))).id).toBe(a.id);
    expect((await t.svc.consentStatus(t.ctx('admin'))).checking).toBe(true);
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 11 * 60_000); // the stale rule is wall-clock (createdAt), not the phone's localNow
    try { expect((await t.svc.consentCheck(t.ctx('admin'))).id).not.toBe(a.id); } finally { vi.useRealTimers(); }
    expect((await t.link.listActions({ types: ['busConsentCheck'], statuses: ['pending'] }))).toHaveLength(1);
  });
  it('check refuses LINK_UNAVAILABLE when no console lists busConsentCheck; a non-coordinator leader is FORBIDDEN', async () => {
    const t = await withLink();
    await expect(t.svc.consentCheck(t.ctx('admin'))).rejects.toMatchObject({ code: 'LINK_UNAVAILABLE' });
    await claimWith(t.link, {});
    await expect(t.svc.consentCheck(t.ctx('admin'))).rejects.toMatchObject({ code: 'LINK_UNAVAILABLE' });
    await expect(t.svc.consentCheck(juniorOf(t))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('status lists unmatched forms for coordinators only', async () => {
    const t = await withLink();
    await t.bus.upsertConsentForms([form({ studentId: null, first: 'Nobody', last: 'Known' })]);
    const s = await t.svc.consentStatus(t.ctx('admin'));
    expect(s).toMatchObject({ year: 2026, lastChecked: '', lastNew: 0, checking: false, canCheck: true });
    expect(s.unmatched).toEqual([{ name: 'Nobody Known', submittedAt: '2026-10-05T01:00:00.000Z' }]);
    const j = await t.svc.consentStatus(juniorOf(t));
    expect([j.unmatched, j.canCheck]).toEqual([null, false]);
  });
  it('prefill: app data + the latest form (any year); a junior leader gets name, grade, gender only', async () => {
    const t = await withLink();
    await t.bus.upsertConsentForms([form({ year: 2025, submittedAt: '2025-12-20T01:00:00.000Z' })]);
    const p = await t.svc.consentPrefill(t.ctx('admin'), { studentId: 's1' });
    expect(p).toMatchObject({ first: 'Jess', last: 'Tran', grade: 9, gender: 'f', mobile: '0412345678', school: 'Example High', parentName: 'Alex Tran', pickup: true,
      parentPhone: '0400000003', address: { line1: '1 Test St', city: 'Brisbane City' } });
    expect((p as { declaration: string }).declaration).toMatch(/^Do you give permission/);
    const j = await t.svc.consentPrefill(juniorOf(t), { studentId: 's1' });
    expect(Object.keys(j).sort()).toEqual(['declaration', 'first', 'gender', 'grade', 'last']);
  });
  it('F6: prefill by riderId resolves the person on the server (a redacted junior has no studentId)', async () => {
    const t = await withLink();
    const r = await t.svc.addRider(t.ctx('admin'), { studentId: 's1', newAddress: { label: 'Home', address: '1 Test St, Brisbane City', placeId: 'fake:1' } });
    expect(await t.svc.consentPrefill(juniorOf(t), { riderId: r.id })).toMatchObject({ first: 'Jess', last: 'Tran' });
    const p = await t.svc.consentPrefill(t.ctx('admin'), { riderId: r.id });
    expect(p).toMatchObject({ address: { line1: '1 Test St', city: 'Brisbane City' } }); // no form: the saved home address
    await expect(t.svc.consentPrefill(t.ctx('admin'), { riderId: 'nope' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('DNC on consent details', () => {
  it('a DNC student: the parent phone in the details goes through the DNC mark', async () => {
    const t = await setup();
    const dnc = { forActor: async () => <T extends object>(o: T, id: string | null | undefined) =>
      ({ ...o, dnc: id === 's1', ...(id === 's1' && 'parentPhone' in o ? { parentPhone: null } : {}) }) as T & { dnc: boolean } };
    const svc = makeBusService(t.bus, t.students, t.leaders, t.settings, undefined, undefined, dnc, { link: new InMemoryLinkRepository() });
    await t.bus.upsertConsentForms([form({})]);
    await svc.addRider(t.ctx('admin'), { studentId: 's1', newAddress: { label: 'Home', address: '1 Test St, Brisbane City', placeId: 'fake:1' } });
    const d = (await svc.getRun(t.ctx('grade'))).riders[0]!.consent.details!;
    expect([d.parentName, d.parentPhone]).toEqual(['Alex Tran', null]);
  });
});
