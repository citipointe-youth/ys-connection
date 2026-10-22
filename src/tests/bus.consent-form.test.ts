// Bus consent (spec 2026-10-22 §5.5/§5.7, R2/R8): POST /bus/consent-form and the consent address Where option.
import { describe, it, expect, vi } from 'vitest';
import { makeBusService } from '../services/bus.service';
import { InMemoryLinkRepository } from '../repositories/in-memory/link.repository';
import { FakeRoutingProvider } from '../services/routing/fake-routing-provider';
import { UNTIMED_ROUTES } from '../api/http/express-adapter';
import { setup } from './helpers/bus-setup';
import type { BusConsentForm } from '../core/entities/bus';

const body = { studentId: 's1', requestId: '0d7f5f0e-0000-4000-8000-000000000001', readOut: true, first: 'Jess', last: 'Tran', grade: '9', gender: 'f',
  mobile: '0400000001', school: 'Example High', address: { line1: '1 Test St', line2: '', postcode: '4000', city: 'Brisbane City', state: 'QLD' },
  parentName: 'Alex Tran', parentPhone: '0400000003', pickup: true, pickupBy: '' };
const claimWith = (link: InMemoryLinkRepository) => link.claim({ console: { consoleId: '8f5a1c2e-0000-4000-8000-000000000001',
  label: 'PC', contractVersion: 1, consoleVersion: 'x', inWindow: false, pollSeconds: 60,
  capabilities: { checkIn: 'live', checkOut: 'live', submitReport: 'live', editReport: 'live', completeStep: 'live', firstTimerCheckIn: 'live', busConsentCheck: 'live' } as any,
  linkRev: 18 }, max: 0, leaseSeconds: 300, cutoffDays: 3, leaseLostMs: 3_600_000, swept: [] });

async function mk(result: 'sent' | 'failed' | 'unconfirmed', opts: { repeat?: boolean; routing?: FakeRoutingProvider } = {}) {
  const t = await setup({ routing: opts.routing });
  const link = new InMemoryLinkRepository();
  const sent: unknown[] = [];
  const newYouth = { sendBusConsent: async (_a: unknown, i: unknown) => { sent.push(i);
    return { result, dropoff: result === 'sent' ? 'Carindale bus stop' : null, ...(opts.repeat ? { repeat: true } : {}) }; } };
  const svc = makeBusService(t.bus, t.students, t.leaders, t.settings, opts.routing, undefined, undefined, { link, newYouth });
  return { ...t, svc, link, sent };
}
const consentForm = (over: Partial<BusConsentForm> = {}): BusConsentForm => ({ id: 'f1', submissionId: 'b5c10000-0000-4000-8000-000000000001', childIndex: 0,
  submittedAt: '2026-10-05T01:00:00.000Z', year: 2026, studentId: 's1', guestId: null, first: 'Jess', last: 'Tran', source: 'public', createdAt: '2026-10-05T01:05:00.000Z',
  data: { grade: 9, gender: 'female', mobile: '', school: '', address: { line1: '1 Test St', line2: '-', postcode: '4000', city: 'Brisbane City', state: 'QLD' },
    parentName: '', parentPhone: '', pickup: true, pickupBy: '', filedBy: null }, ...over });

describe('consent form submit (R2)', () => {
  it('refuses without the read-out tick; sends nothing', async () => {
    const t = await mk('sent');
    await expect(t.svc.consentSubmit(t.ctx('admin'), { ...body, readOut: false })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(t.sent).toHaveLength(0);
    expect(await t.bus.listConsentSubmits()).toHaveLength(0);
  });
  it('sent: audit row, drop-off returned, one busConsentCheck queued (F20); failed: audit row, no check queued', async () => {
    const ok = await mk('sent');
    await claimWith(ok.link);
    expect(await ok.svc.consentSubmit(ok.ctx('admin'), body)).toMatchObject({ result: 'sent', dropoff: 'Carindale bus stop' });
    expect((await ok.bus.listConsentSubmits())[0]).toMatchObject({ studentId: 's1', elvantoResult: 'sent', first: 'Jess', readOutConfirmed: true });
    expect(await ok.link.listActions({ types: ['busConsentCheck'], statuses: ['pending'] })).toHaveLength(1);
    const bad = await mk('failed');
    await claimWith(bad.link);
    await bad.svc.consentSubmit(bad.ctx('admin'), body);
    expect((await bad.bus.listConsentSubmits())[0]!.elvantoResult).toBe('failed');
    expect(await bad.link.listActions({ types: ['busConsentCheck'] })).toHaveLength(0);
  });
  it('sent with no console listing the type: still answers sent (the check is best effort)', async () => {
    const t = await mk('sent');
    expect(await t.svc.consentSubmit(t.ctx('admin'), body)).toMatchObject({ result: 'sent' });
    expect(await t.link.listActions({ types: ['busConsentCheck'] })).toHaveLength(0);
  });
  it('F20: a double tap (repeat) writes no second audit row', async () => {
    const t = await mk('sent', { repeat: true });
    await t.svc.consentSubmit(t.ctx('admin'), body);
    expect(await t.bus.listConsentSubmits()).toHaveLength(0);
  });
  it('F6: riderId resolves the person on the server', async () => {
    const t = await mk('unconfirmed');
    const r = await t.svc.addRider(t.ctx('admin'), { studentId: 's1', newAddress: { label: 'Home', address: '1 Test St, Brisbane City', placeId: 'fake:1' } });
    const { studentId: _s, ...rest } = body;
    await t.svc.consentSubmit(t.ctx('admin'), { ...rest, riderId: r.id });
    expect((await t.bus.listConsentSubmits())[0]).toMatchObject({ studentId: 's1', guestId: null, elvantoResult: 'unconfirmed' });
  });
  it('fix round 1: after a sent form, an audit-row or queue failure never turns the reply into an error; logged without PII', async () => {
    const t = await mk('sent');
    await claimWith(t.link);
    t.bus.insertConsentSubmit = async () => { throw Object.assign(new Error('db down Jess Tran'), { code: '57P01' }); };
    t.link.insertAction = async () => { throw Object.assign(new Error('boom'), { code: 'XX000' }); };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await t.svc.consentSubmit(t.ctx('admin'), body)).toMatchObject({ result: 'sent', dropoff: 'Carindale bus stop' });
      const lines = err.mock.calls.map((c) => JSON.stringify(c));
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain('57P01');
      expect(lines[1]).toContain('XX000');
      for (const l of lines) for (const pii of ['Jess', 'Tran', '0400000003', 'Alex', 'Test St']) expect(l).not.toContain(pii);
    } finally { err.mockRestore(); }
  });
  it('fix round 1: no console listing the type (LinkUnavailable) is expected and logs nothing', async () => {
    const t = await mk('sent');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await t.svc.consentSubmit(t.ctx('admin'), body);
      expect(err).not.toHaveBeenCalled();
    } finally { err.mockRestore(); }
  });
  it('the route is untimed (a 503 after the POST would invite a duplicate)', () => {
    expect(UNTIMED_ROUTES.has('POST /bus/consent-form')).toBe(true);
  });
});

describe('consent address Where option (R8)', () => {
  it('a current form address is saved as an ordinary "Consent form" address; the rider address never changes by itself', async () => {
    const t = await mk('sent');
    await t.bus.upsertConsentForms([consentForm()]);
    const r = await t.svc.addRider(t.ctx('admin'), { studentId: 's1', consentFormId: 'f1' });
    expect(r.address).toMatch(/1 Test St/i);
    expect((await t.bus.listAddresses({ studentId: 's1' })).map((a) => a.label)).toEqual(['Consent form']);
  });
  it('updateRider takes it too', async () => {
    const t = await mk('sent');
    await t.bus.upsertConsentForms([consentForm()]);
    const r = await t.svc.addRider(t.ctx('admin'), { studentId: 's1', newAddress: { label: 'Home', address: '9 Other Rd, Carina', placeId: 'fake:9' } });
    const u = await t.svc.updateRider(t.ctx('admin'), r.id, { consentFormId: 'f1' });
    expect(u.address).toMatch(/1 Test St/i);
  });
  it("a form that is not this person's refuses 404", async () => {
    const t = await mk('sent');
    await t.bus.upsertConsentForms([consentForm({ studentId: 's2' })]);
    await expect(t.svc.addRider(t.ctx('admin'), { studentId: 's1', consentFormId: 'nope' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(t.svc.addRider(t.ctx('admin'), { studentId: 's1', consentFormId: 'f1' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('a Google miss refuses CONSENT_ADDRESS_UNMATCHED with the address text', async () => {
    const t = await mk('sent', { routing: new FakeRoutingProvider({ suggest: false }) });
    await t.bus.upsertConsentForms([consentForm()]);
    await expect(t.svc.addRider(t.ctx('admin'), { studentId: 's1', consentFormId: 'f1' }))
      .rejects.toMatchObject({ code: 'CONSENT_ADDRESS_UNMATCHED', statusCode: 422, extra: { text: '1 Test St, Brisbane City QLD 4000' } });
  });
});
