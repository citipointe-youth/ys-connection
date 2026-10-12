import { describe, it, expect, vi } from 'vitest';
import { busFixture, FRI_7PM } from './helpers/bus-fixtures';
import { streetOf } from '../services/bus-logic';
import { generateId } from '../utils/id';
import type { BusCtx } from '../services/bus.service';
import type { Actor } from '../core/entities/user';
import type { NewYouthMode } from '../core/ministry-config';

const T = '2026-01-01T00:00:00.000Z';
const ADDR = {
  s1: 'Unit 3, 24 Wynnum Rd, Carina QLD 4152, Australia',
  s2: '24 Wynnum Rd Carina QLD 4152',
  s3: '24 Wynnum Rd',
  // No postcode: the Places autocomplete text the app actually stores.
  s4: '8 Smith St, Mount Gravatt East QLD, Australia',
  s5: '5 Caxton St, Petrie Terrace QLD, Australia',
} as const;
// A test-local copy (bus-logic keeps its own private): no street word may reach a suburb,
// except the named suburbs that hold one.
const STREET = /\b(st|street|rd|road|ave|avenue|ct|court|dr|drive|pde|parade|pl|place|cres|crescent|tce|terrace|hwy|highway|ln|lane|way|cl|close|cct|circuit|bvd|boulevard|esp|esplanade|unit|lot)\b/i;
const PHONES = ['0412345678', '0499888777', '412345678', '499888777'];
const ALLOWED_KEYS = new Set(['cars', 'name', 'colourIndex', 'leaderNames',
  'stops', 'stop', 'grade', 'suburb', 'dropped', 'unassigned']);
const ROLES = ['admin', 'director', 'quad', 'grade', 'leader'] as const;

async function world(mode: NewYouthMode) {
  const f = await busFixture();
  const cur = (await f.settings.getSettings()).ministryConfig;
  await f.settings.updateSettings({ ministryConfig: { ...cur,
    modules: { ...cur.modules, newYouthForms: mode },
    busMinistry: { ...cur.busMinistry, coordinatorLeaderIds: ['L1'] } } });
  const s4 = (await f.students.findById('s4'))!;
  await f.students.save({ ...s4, id: 's5', firstName: 'Zoe', lastName: 'Park', grade: 11 });
  const rv = await f.car('Big Bus', 8, ['L1', 'L2']);
  const rv2 = await f.car('Little Car', 4, ['L3']);
  const ids: Record<string, string> = {};
  for (const sid of ['s1', 's2', 's3', 's4', 's5'] as const) {
    const addr = await f.bus.saveAddress({ id: generateId(), studentId: sid, guestId: null, label: '',
      address: ADDR[sid], placeId: `fake:${sid}`, lastUsedAt: T, createdAt: T });
    ids[sid] = (await f.svc.addRider(f.admin, { studentId: sid, addressId: addr.id })).id;
  }
  // s3, s1, s2 on Big Bus in that order; s5 on Little Car; s4 left unassigned.
  for (const sid of ['s3', 's1', 's2']) await f.svc.moveRider(f.admin, ids[sid]!, { runVehicleId: rv });
  await f.svc.moveRider(f.admin, ids['s5']!, { runVehicleId: rv2 });
  // Move re-optimises the car, so pin a known stop order directly (saved out of order on purpose).
  for (const [sid, stop] of [['s2', 3], ['s3', 1], ['s1', 2]] as const) {
    const r = (await f.bus.getRunRider(ids[sid]!))!;
    await f.bus.saveRunRider({ ...r, stopOrder: stop });
  }
  await f.svc.setDropped(f.admin, ids['s1']!, { dropped: true });
  return { ...f, rv, rv2, ids };
}
const roleCtx = (role: string, asLeaderId: string | null = null): BusCtx => ({
  actor: { id: 'u-' + role, role, displayName: role.toUpperCase(), grade: null, quad: null,
    leaderId: role === 'leader' ? 'L3' : null } as unknown as Actor,
  asLeaderId, localNow: FRI_7PM });

function walk(v: unknown, onKey: (k: string) => void, onString: (s: string) => void): void {
  if (typeof v === 'string') onString(v);
  else if (Array.isArray(v)) v.forEach((x) => walk(x, onKey, onString));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { onKey(k); walk(x, onKey, onString); }
}
function assertSafeSuburb(s: string) {
  expect(s).not.toMatch(/\d/);
  if (s !== 'Petrie Terrace') expect(STREET.test(s), s).toBe(false);
}

describe('GET /bus/run/cars follows the Bus module only (T10), not newYouthForms', () => {
  it('every bus:use login, in every newYouthForms mode; canSeeCars agrees', async () => {
    for (const mode of ['off', 'shadow', 'on'] as const) {
      const w = await world(mode);
      for (const role of ROLES) {
        await expect(w.svc.carsView(roleCtx(role)), `${mode}/${role}`).resolves.toBeTruthy();
        expect((await w.svc.getRun(roleCtx(role))).canSeeCars, `${mode}/${role}`).toBe(true);
      }
    }
  });
  it('Bus off → 404', async () => {
    const w = await world('on');
    const cur = (await w.settings.getSettings()).ministryConfig;
    await w.settings.updateSettings({ ministryConfig: { ...cur, modules: { ...cur.modules, busMinistry: false } } });
    await expect(w.svc.carsView(roleCtx('admin'))).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('carsView contents', () => {
  it('ignores as=: a login naming L1 (on Big Bus) still sees both cars', async () => {
    const w = await world('on');
    const mine = await w.svc.carsView(roleCtx('quad', 'L1'));
    expect(mine.cars.map((c) => c.name).sort()).toEqual(['Big Bus', 'Little Car']);
    expect(mine).toEqual(await w.svc.carsView(roleCtx('quad')));
    expect(await w.svc.carsView(roleCtx('quad', 'L3'))).toEqual(mine);
  });
  it('cars carry leader names and stops in stop order; unassigned counts riders with no car', async () => {
    const w = await world('on');
    const v = await w.svc.carsView(roleCtx('grade'));
    expect(Object.keys(v).sort()).toEqual(['cars', 'unassigned']);
    expect(v.unassigned).toBe(1);
    const car = v.cars.find((c) => c.name === 'Big Bus')!;
    expect(car.leaderNames).toEqual(['Tom', 'Sarah']);
    expect(car.stops.map((s) => s.stop)).toEqual([1, 2, 3]);
    expect(car.stops.map((s) => s.name)).toEqual(['Riley Kim', 'Jess Tran', 'Sam Ode']);
    expect(car.stops.map((s) => s.grade)).toEqual([10, 9, 8]);
    expect(car.stops.map((s) => s.dropped)).toEqual([false, true, false]);
    expect(car.stops.map((s) => s.suburb)).toEqual(['', 'Carina', '']);
    expect(v.cars.find((c) => c.name === 'Little Car')!.stops.map((s) => s.suburb)).toEqual(['Petrie Terrace']);
  });
  it('a placed rider with no stopOrder sorts last with no stop number; the rest number 1..n', async () => {
    const w = await world('on');
    const r = (await w.bus.getRunRider(w.ids['s3']!))!;
    await w.bus.saveRunRider({ ...r, stopOrder: null });
    const car = (await w.svc.carsView(roleCtx('admin'))).cars.find((c) => c.name === 'Big Bus')!;
    expect(car.stops.map((s) => s.name)).toEqual(['Jess Tran', 'Sam Ode', 'Riley Kim']);
    expect(car.stops.map((s) => s.stop)).toEqual([1, 2, null]);
  });
  it('reads the run riders once per request (T6)', async () => {
    const w = await world('on');
    const spy = vi.spyOn(w.bus, 'listRunRiders');
    await w.svc.carsView(roleCtx('admin'));
    expect(spy).toHaveBeenCalledTimes(1);
  });
  const VIEWERS: [string, BusCtx][] = [...ROLES.map((r) => [r, roleCtx(r)] as [string, BusCtx]), ['as= coordinator', roleCtx('grade', 'L1')]];
  it.each(VIEWERS)('key allow-list + no street, full address or phone anywhere (%s)', async (_n, ctx) => {
    const w = await world('on');
    const v = await w.svc.carsView(ctx);
    expect(v).toEqual(await w.svc.carsView(roleCtx('admin')));
    const strings: string[] = [];
    walk(v, (k) => expect(ALLOWED_KEYS.has(k), `unexpected key ${k}`).toBe(true), (s) => strings.push(s));
    for (const c of v.cars) for (const s of c.stops) assertSafeSuburb(s.suburb);
    for (const s of strings) {
      for (const a of Object.values(ADDR)) {
        expect(s).not.toContain(a);
        expect(s).not.toContain(streetOf(a));
      }
      for (const p of PHONES) expect(s).not.toContain(p);
    }
  });
});

describe('junior-leader redacted run view uses the strict suburb', () => {
  it('no digit or street word in any rider address', async () => {
    const w = await world('on');
    const v = await w.svc.getRun({ actor: { id: 'u-l', role: 'leader', displayName: 'L', grade: null, quad: null, leaderId: 'L3' } as unknown as Actor,
      asLeaderId: null, localNow: FRI_7PM });
    expect(v.riders.length).toBe(5);
    for (const r of v.riders) {
      assertSafeSuburb(r.address);
      for (const a of Object.values(ADDR)) expect(r.address).not.toContain(streetOf(a));
    }
    expect(v.riders.map((r) => r.address).sort()).toEqual(['', '', 'Carina', 'Mount Gravatt East', 'Petrie Terrace']);
  });
});
