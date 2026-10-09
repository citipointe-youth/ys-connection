import { describe, it, expect } from 'vitest';
import { busFixture } from './helpers/bus-fixtures';

// Past history (spec 2026-10-09-bus-past-history): "not riding" soft-remove, leaderSnap, wasGuest,
// GET /bus/history and the director/admin past-night edit.
const WK1 = '2026-10-09T19:00', WK2 = '2026-10-16T19:00', WK3 = '2026-10-23T19:00';

async function fixture() {
  const f = await busFixture();
  const at = (role: string, localNow: string, as: string | null = null) => ({ ...f.ctx(role, as), localNow });
  const add = (localNow: string, studentId: string) =>
    f.svc.addRider(at('admin', localNow), { studentId, newAddress: { label: 'Home', address: `${studentId} Test St, Testville`, placeId: `fake:${studentId}` } });
  return { ...f, at, add };
}

describe('not riding (soft remove)', () => {
  it('is hidden from every tonight read but kept for history; Generate ignores it', async () => {
    const f = await fixture();
    const rv = await f.car('Bus', 8, ['L1']);
    const a = await f.rider('s1'), b = await f.rider('s2');
    await f.svc.removeRider(f.admin, a.id);
    const v = await f.svc.getRun(f.admin);
    expect(v.riders.map((r) => r.id)).toEqual([b.id]);
    expect(v.pastRiders.map((p) => p.studentId)).toContain('s1'); // not on tonight → offered again
    const row = (await f.bus.getRunRider(a.id))!;
    expect(row).toMatchObject({ notRiding: true, runVehicleId: null, stopOrder: null, pinned: false });
    const g = await f.svc.generate(f.admin, { mode: 'all' });
    expect(g.placed).toBe(1);
    expect((await f.bus.getRunRider(a.id))!.runVehicleId).toBeNull();
    await expect(f.svc.moveRider(f.admin, a.id, { runVehicleId: rv })).rejects.toMatchObject({ statusCode: 404 });
    await expect(f.svc.removeRider(f.admin, a.id)).rejects.toMatchObject({ statusCode: 404 });
    // history (viewed a week later) still shows them, flagged
    const h = await f.svc.history(f.at('admin', WK2));
    expect(h.nights[0]).toMatchObject({ riders: 1, notRiding: 1 });
    expect(h.rides.find((r) => r.studentId === 's1')).toMatchObject({ notRiding: true, car: null });
    expect((await f.svc.listRuns(f.at('admin', WK2)))[0]!.riders).toBe(1);
  });

  it('removing from My car keeps the row as not riding', async () => {
    const f = await fixture();
    const rv = await f.car('Bus', 8, ['L1']);
    const a = await f.rider('s1');
    await f.svc.moveRider(f.admin, a.id, { runVehicleId: rv });
    await f.svc.saveMyCarStops(f.ctx('admin', 'L1'), { riderIds: [], removeIds: [a.id] });
    expect((await f.svc.getRun(f.admin)).riders).toHaveLength(0);
    expect((await f.bus.getRunRider(a.id))!.notRiding).toBe(true);
  });

  it('re-adding someone revives their row with the new address (no second row)', async () => {
    const f = await fixture();
    const a = await f.rider('s1');
    await f.svc.removeRider(f.admin, a.id);
    const again = await f.svc.addRider(f.admin, { studentId: 's1', newAddress: { label: 'Dad', address: '9 New St, Newtown', placeId: 'fake:new' } });
    expect(again.id).toBe(a.id);
    const rows = (await f.bus.listRunRiders((await f.svc.getRun(f.admin)).run.id)).filter((r) => r.studentId === 's1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ notRiding: false, snapAddress: '9 New St, Newtown', runVehicleId: null });
    expect((await f.svc.getRun(f.admin)).riders.map((r) => r.id)).toEqual([a.id]);
  });

  it('keeps the exception: an unlinked guest with no other run rows is hard-deleted', async () => {
    const f = await fixture();
    const g = await f.svc.createGuest(f.admin, { firstName: 'Harper', lastName: 'Ng', grade: 8, gender: 'female', phone: null });
    const r = await f.svc.addRider(f.admin, { guestId: g.id, newAddress: { address: '3 C St, Wynnum', placeId: 'fake:3-c-st' } });
    await f.svc.removeRider(f.admin, r.id);
    expect(await f.bus.getGuest(g.id)).toBeNull();
    expect(await f.bus.getRunRider(r.id)).toBeNull();
  });
  it('a guest who rode another night is only soft-removed', async () => {
    const f = await fixture();
    const g = await f.svc.createGuest(f.admin, { firstName: 'Harper', lastName: 'Ng', grade: 8, gender: 'female', phone: null });
    await f.svc.addRider(f.at('admin', WK1), { guestId: g.id, newAddress: { address: '3 C St, Wynnum', placeId: 'fake:3-c-st' } });
    const wk2 = await f.svc.addRider(f.at('admin', WK2), { guestId: g.id, addressId: (await f.bus.listAddresses({ guestId: g.id }))[0]!.id });
    await f.svc.removeRider(f.at('admin', WK2), wk2.id);
    expect(await f.bus.getGuest(g.id)).not.toBeNull();
    expect((await f.bus.getRunRider(wk2.id))!.notRiding).toBe(true);
  });
});

describe('leaderSnap + wasGuest', () => {
  it('who drove survives the leader being deleted', async () => {
    const f = await fixture();
    await f.car('Bus', 8, ['L1', 'L2']);
    await f.rider('s1');
    const rvs = await f.bus.listRunVehicles((await f.svc.getRun(f.admin)).run.id);
    expect(rvs[0]!.leaderSnap.map((l) => l.name).sort()).toEqual(['Sarah', 'Tom']);
    await f.leaders.delete('L1');
    const h = await f.svc.history(f.at('admin', WK2));
    expect(h.nights[0]!.leaders.sort()).toEqual(['Sarah', 'Tom']);
    expect(h.rides[0]!.leaders).toBeDefined();
    const past = await f.svc.getPastRun(f.at('admin', WK2), h.nights[0]!.id);
    expect(past.vehicles[0]!.leaderNames.sort()).toEqual(['Sarah', 'Tom']);
  });

  it('a guest linked to a student keeps wasGuest on their past rides', async () => {
    const f = await fixture();
    const g = await f.svc.createGuest(f.admin, { firstName: 'Riley', lastName: 'Kim', grade: 10, gender: 'male', phone: null });
    await f.svc.addRider(f.admin, { guestId: g.id, newAddress: { address: '3 C St, Wynnum', placeId: 'fake:3-c-st' } });
    await f.svc.linkGuest(f.admin, g.id, { studentId: 's3' });
    const h = await f.svc.history(f.at('admin', WK2));
    expect(h.rides[0]).toMatchObject({ studentId: 's3', guestId: null, kind: 'student', wasGuest: true });
  });
});

describe('history', () => {
  it('returns nights (strictly before tonight) with counts, firstTime over ALL history, and rides', async () => {
    const f = await fixture();
    const rv = await f.car('Bus', 8, ['L1']);
    const a = await f.rider('s1'), b = await f.rider('s2'), c = await f.rider('s3');
    await f.svc.moveRider(f.admin, a.id, { runVehicleId: rv });
    await f.svc.moveRider(f.admin, b.id, { runVehicleId: rv });
    await f.svc.setDropped(f.admin, a.id, { dropped: true });
    await f.svc.removeRider(f.admin, c.id);
    await f.add(WK2, 's1'); await f.add(WK2, 's4'); // week 2: s1 returns, s4 is new

    const h = await f.svc.history(f.at('admin', WK3), '2026-10-12'); // window starts after week 1
    expect(h.canEdit).toBe(true);
    expect(h.nights.map((n) => n.date)).toEqual(['2026-10-16']); // wk1 is before `from`
    expect(h.nights[0]).toMatchObject({ riders: 2, placed: 0, unassigned: 2, firstTime: 1, notRiding: 0, guests: 0, edits: [] });

    const all = await f.svc.history(f.at('admin', WK3));
    expect(all.nights.map((n) => n.date)).toEqual(['2026-10-16', '2026-10-09']); // newest first
    const w1 = all.nights[1]!;
    expect(w1).toMatchObject({ riders: 2, placed: 2, unassigned: 0, dropped: 1, notRiding: 1, noShow: 0, cars: 1, seats: 8, leaders: ['Tom'], firstTime: 2 });
    const ride = all.rides.find((r) => r.runId === w1.id && r.studentId === 's1')!;
    expect(ride).toMatchObject({ kind: 'student', wasGuest: false, name: 'Jess Tran', car: 'Bus', leaders: ['Tom'], stop: 1,
      address: 's1 Test St, Testville', suburb: 'Testville', notRiding: false, noShow: false, note: null });
    expect(ride.droppedAt).not.toBeNull();
    expect(all.rides.filter((r) => r.runId === w1.id)).toHaveLength(3); // incl. the not-riding row
  });

  it('is open to coordinators (read-only, no edit log) but not to grade logins', async () => {
    const f = await fixture();
    await f.rider('s1');
    const q = await f.svc.history(f.at('quad', WK2));
    expect(q.canEdit).toBe(false);
    expect(q.nights[0]!.edits).toBeUndefined();
    await expect(f.svc.history(f.at('grade', WK2))).rejects.toMatchObject({ statusCode: 403 });
    await expect(f.svc.history(f.at('admin', WK2), 'yesterday')).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('editPastRider', () => {
  it('moves a rider, logs one edit row, bumps the run', async () => {
    const f = await fixture();
    const rv = await f.car('Bus', 8, ['L1']);
    const a = await f.rider('s1');
    await f.svc.moveRider(f.admin, a.id, { runVehicleId: rv });
    const runId = (await f.svc.getRun(f.admin)).run.id;
    const v0 = (await f.bus.getRun(runId))!.version;
    const dropped = '2026-10-09T11:41:00.000Z'; // 9:41 pm Brisbane
    await f.svc.editPastRider(f.at('admin', WK2), runId, a.id, { runVehicleId: null, droppedAt: dropped, noShow: true, note: 'Mum collected', reason: 'logged late' });
    expect(await f.bus.getRunRider(a.id)).toMatchObject({ runVehicleId: null, stopOrder: null, droppedAt: dropped, noShow: true, note: 'Mum collected' });
    expect((await f.bus.getRun(runId))!.version).toBeGreaterThan(v0);
    const night = (await f.svc.history(f.at('admin', WK2))).nights[0]!;
    expect(night.edits).toHaveLength(1);
    expect(night.edits![0]!.detail).toBe('Jess Tran: car Bus → Unassigned; dropped none → 9:41 pm; no-show: no → yes; note edited (logged late)');
    expect(night.edits![0]!.by).toBe('ADMIN');
    // an unchanged resubmit logs nothing
    await f.svc.editPastRider(f.at('admin', WK2), runId, a.id, { noShow: true });
    expect((await f.svc.history(f.at('admin', WK2))).nights[0]!.edits).toHaveLength(1);
  });

  it('is director/admin only, past nights only, and the car must belong to that night', async () => {
    const f = await fixture();
    const rv = await f.car('Bus', 8, ['L1']);
    const a = await f.rider('s1');
    const runId = (await f.svc.getRun(f.admin)).run.id;
    const past = f.at('admin', WK2);
    await expect(f.svc.editPastRider(f.at('quad', WK2), runId, a.id, { noShow: true })).rejects.toMatchObject({ statusCode: 403 });
    await expect(f.svc.editPastRider(f.at('admin', WK1), runId, a.id, { noShow: true })).rejects.toMatchObject({ statusCode: 400 }); // tonight
    const next = (await f.svc.getRun(past)).run.id; // week-2 run, viewed from week 1 = a future night
    const nextRider = await f.svc.addRider(past, { studentId: 's2', newAddress: { address: '2 Test St, Testville', placeId: 'fake:s2' } });
    await expect(f.svc.editPastRider(f.at('admin', WK1), next, nextRider.id, { noShow: true })).rejects.toMatchObject({ statusCode: 400 });
    await expect(f.svc.editPastRider(past, runId, a.id, { runVehicleId: 'nope' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(f.svc.editPastRider(past, runId, a.id, { note: 'x'.repeat(301) })).rejects.toMatchObject({ statusCode: 400 });
    await expect(f.svc.editPastRider(past, runId, 'missing', { noShow: true })).rejects.toMatchObject({ statusCode: 404 });
    await f.svc.editPastRider(past, runId, a.id, { runVehicleId: rv }); // valid car of that night
    expect((await f.bus.getRunRider(a.id))!.runVehicleId).toBe(rv);
  });

  it('can mark someone not riding on a past night (leaves their car)', async () => {
    const f = await fixture();
    const rv = await f.car('Bus', 8, ['L1']);
    const a = await f.rider('s1');
    await f.svc.moveRider(f.admin, a.id, { runVehicleId: rv });
    const runId = (await f.svc.getRun(f.admin)).run.id;
    await f.svc.editPastRider(f.at('admin', WK2), runId, a.id, { notRiding: true });
    expect(await f.bus.getRunRider(a.id)).toMatchObject({ notRiding: true, runVehicleId: null });
    expect((await f.svc.history(f.at('admin', WK2))).nights[0]).toMatchObject({ riders: 0, notRiding: 1 });
  });
});
