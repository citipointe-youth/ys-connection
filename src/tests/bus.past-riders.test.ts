import { describe, it, expect } from 'vitest';
import { busFixture } from './helpers/bus-fixtures';

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
});
