import { describe, it, expect } from 'vitest';
import { busFixture } from './helpers/bus-fixtures';
import { generateId } from '../utils/id';
import type { BusConsentForm } from '../core/entities/bus';

const form = (over: Partial<BusConsentForm>): BusConsentForm => ({ id: 'f-' + (over.studentId ?? 'x'), submissionId: 'b5c10000-0000-4000-8000-000000000001', childIndex: 0,
  submittedAt: '2026-10-05T01:00:00.000Z', year: 2026, studentId: 's1', guestId: null, first: 'Jess', last: 'Tran', source: 'public', createdAt: '2026-10-05T01:05:00.000Z',
  data: { grade: 9, gender: 'female', mobile: '0400000001', school: 'Example High', address: { line1: '1 Test St', line2: '-', postcode: '4000', city: 'Brisbane City', state: 'QLD' },
    parentName: 'Alex Tran', parentPhone: '0400000003', pickup: true, pickupBy: '', filedBy: null }, ...over });

// Owner request 2026-10-06: Tonight tab lists past riders with a saved address for one-tap re-adding.
describe('past riders', () => {
  it('lists people with a saved address who are not on tonight, newest first, suburb only', async () => {
    const f = await busFixture();
    const jess = await f.rider('s1'); await f.rider('s2');
    await f.svc.removeRider(f.admin, jess.id);
    const v = await f.svc.getRun(f.admin);
    expect(v.pastRiders.map((p) => p.studentId)).toEqual(['s1']); // s2 is on tonight; s3/s4 have no address
    expect(v.pastRiders[0]).toMatchObject({ name: 'Jess Tran', suburb: 'Testville' });
    expect(JSON.stringify(v.pastRiders)).not.toContain('Test St');
  });
  it('operator 2026-10-23: past riders sort by first name (any case), then last name', async () => {
    const f = await busFixture();
    const s3 = (await f.students.findById('s3'))!;
    await f.students.save({ ...s3, firstName: 'mia', lastName: 'Abbot' }); // lower case, same first name as Mia Lee
    const rs = [await f.rider('s3'), await f.rider('s2'), await f.rider('s4'), await f.rider('s1')];
    for (const r of rs) await f.svc.removeRider(f.admin, r.id);
    const v = await f.svc.getRun(f.admin);
    expect(v.pastRiders.map((p) => p.name)).toEqual(['Jess Tran', 'mia Abbot', 'Mia Lee', 'Sam Ode']);
    expect(v.pastRiders.map((p) => p.gender)).toEqual(['female', 'male', 'female', 'male']); // the SPA colours the grade chip from this
  });
  it('one tap re-adds them with their saved address', async () => {
    const f = await busFixture();
    const jess = await f.rider('s1');
    await f.svc.removeRider(f.admin, jess.id);
    const p = (await f.svc.getRun(f.admin)).pastRiders[0]!;
    await f.svc.addRider(f.admin, { studentId: p.studentId!, addressId: p.addressId });
    const v = await f.svc.getRun(f.admin);
    expect(v.riders.map((r) => r.name)).toEqual(['Jess Tran']);
    expect(v.pastRiders).toEqual([]);
  });
  it('is empty for logins that cannot edit the roster', async () => {
    const f = await busFixture();
    const jess = await f.rider('s1');
    await f.svc.removeRider(f.admin, jess.id);
    expect((await f.svc.getRun(f.ctx('leader', 'L1'))).pastRiders).toEqual([]);
  });
  describe('operator 2026-10-23: consented riders and the cap of 100', () => {
    it('a matched current-year consent with no saved address is listed (suburb from the form, no addressId); last year is not', async () => {
      const f = await busFixture();
      await f.bus.upsertConsentForms([form({ studentId: 's3', first: 'Riley', last: 'Kim' }),
        form({ studentId: 's4', first: 'Mia', last: 'Lee', year: 2025, submittedAt: '2025-12-20T01:00:00.000Z' }),
        form({ studentId: null, first: 'Nobody', last: 'Known' })]);
      const v = await f.svc.getRun(f.admin);
      expect(v.pastRiders.map((p) => p.studentId)).toEqual(['s3']);
      expect(v.pastRiders[0]).toMatchObject({ name: 'Riley Kim', addressId: null, suburb: 'Brisbane City', consent: { current: true } });
    });
    it('no duplicates: a consented past rider with a saved address appears once, with that address; tonight riders are skipped', async () => {
      const f = await busFixture();
      const jess = await f.rider('s1'); await f.rider('s2');
      await f.svc.removeRider(f.admin, jess.id);
      await f.bus.upsertConsentForms([form({ studentId: 's1' }), form({ studentId: 's2', first: 'Sam', last: 'Ode' })]);
      const v = await f.svc.getRun(f.admin);
      expect(v.pastRiders.map((p) => p.studentId)).toEqual(['s1']);
      expect(v.pastRiders[0]!.addressId).toBeTruthy();
      expect(v.pastRiders[0]!.suburb).toBe('Testville');
    });
    it('the cap is 100, by max(address last used, consent submitted)', async () => {
      const f = await busFixture();
      const s1 = (await f.students.findById('s1'))!;
      for (let i = 0; i < 101; i++) {
        const id = 'c' + String(i).padStart(3, '0');
        await f.students.save({ ...s1, id, firstName: 'P' + id, lastName: 'X' });
        await f.bus.saveAddress({ id: generateId(), studentId: id, guestId: null, label: 'Home', address: `${i} Test St, Testville`, placeId: `fake:${id}`,
          lastUsedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' });
      }
      // All addresses tie, so the name breaks it and c100 would drop; its consent this year makes it the most recent, so c099 drops instead.
      await f.bus.upsertConsentForms([form({ studentId: 'c100', submittedAt: '2026-10-01T00:00:00.000Z' })]);
      const v = await f.svc.getRun(f.admin);
      expect(v.pastRiders).toHaveLength(100);
      expect(v.pastRiders.map((p) => p.studentId)).toContain('c100');
      expect(v.pastRiders.map((p) => p.studentId)).not.toContain('c099');
    });
    it('adding a consent-only past rider works through the consent form address', async () => {
      const f = await busFixture();
      await f.bus.upsertConsentForms([form({ studentId: 's3', first: 'Riley', last: 'Kim' })]);
      const p = (await f.svc.getRun(f.admin)).pastRiders[0]!;
      await f.svc.addRider(f.admin, { studentId: p.studentId!, consentFormId: p.consent.details!.formId });
      const v = await f.svc.getRun(f.admin);
      expect(v.riders.map((r) => r.name)).toEqual(['Riley Kim']);
      expect(v.riders[0]!.addressId).toBeTruthy();
      expect(v.pastRiders).toEqual([]);
    });
  });
});
