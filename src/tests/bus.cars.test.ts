import { describe, it, expect } from 'vitest';
import { busFixture, FRI_7PM } from './helpers/bus-fixtures';
import { STREET_WORDS, streetOf } from '../services/bus-logic';
import { generateId } from '../utils/id';
import type { BusCtx } from '../services/bus.service';
import type { Actor } from '../core/entities/user';
import type { NewYouthMode } from '../core/ministry-config';

const T = '2026-01-01T00:00:00.000Z';
const ADDR = {
  s1: 'Unit 3, 24 Wynnum Rd, Carina QLD 4152, Australia',
  s2: '24 Wynnum Rd Carina QLD 4152',
  s3: '24 Wynnum Rd',
  s4: '8 Smith St, Mount Gravatt East QLD 4122, Australia',
} as const;
const PHONES = ['0412345678', '0499888777', '412345678', '499888777'];
const ALLOWED_KEYS = new Set(['serviceDate', 'version', 'readOnly', 'cars', 'name', 'colourIndex', 'leaderNames',
  'stops', 'stop', 'grade', 'suburb', 'dropped', 'unassigned']);
const ROLES = ['admin', 'director', 'quad', 'grade', 'leader'] as const;

async function world(mode: NewYouthMode) {
  const f = await busFixture();
  const cur = (await f.settings.getSettings()).ministryConfig;
  await f.settings.updateSettings({ ministryConfig: { ...cur, modules: { ...cur.modules, newYouthForms: mode } } });
  const rv = await f.car('Big Bus', 8, ['L1', 'L2']);
  const ids: Record<string, string> = {};
  for (const sid of ['s1', 's2', 's3', 's4'] as const) {
    const addr = await f.bus.saveAddress({ id: generateId(), studentId: sid, guestId: null, label: '',
      address: ADDR[sid], placeId: `fake:${sid}`, lastUsedAt: T, createdAt: T });
    ids[sid] = (await f.svc.addRider(f.admin, { studentId: sid, addressId: addr.id })).id;
  }
  // s3, s1, s2 on the car in that order; s4 left unassigned.
  for (const sid of ['s3', 's1', 's2']) await f.svc.moveRider(f.admin, ids[sid]!, { runVehicleId: rv });
  // Move re-optimises the car, so pin a known stop order directly (saved out of order on purpose).
  for (const [sid, stop] of [['s2', 3], ['s3', 1], ['s1', 2]] as const) {
    const r = (await f.bus.getRunRider(ids[sid]!))!;
    await f.bus.saveRunRider({ ...r, stopOrder: stop });
  }
  await f.svc.setDropped(f.admin, ids['s1']!, { dropped: true });
  return { ...f, rv, ids };
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
  expect(STREET_WORDS.test(s)).toBe(false);
}

describe('GET /bus/run/cars gating by the newYouthForms mode', () => {
  it("off → 404 for admin", async () => {
    const w = await world('off');
    await expect(w.svc.carsView(roleCtx('admin'))).rejects.toMatchObject({ statusCode: 404 });
  });
  it('shadow → admin only', async () => {
    const w = await world('shadow');
    await expect(w.svc.carsView(roleCtx('admin'))).resolves.toBeTruthy();
    for (const role of ['director', 'quad', 'grade', 'leader'])
      await expect(w.svc.carsView(roleCtx(role))).rejects.toMatchObject({ statusCode: 404 });
  });
  it('on → every bus:use login', async () => {
    const w = await world('on');
    for (const role of ROLES) await expect(w.svc.carsView(roleCtx(role))).resolves.toBeTruthy();
  });
  it('GET /bus/run canSeeCars follows the same table', async () => {
    const want: Record<NewYouthMode, string[]> = { off: [], shadow: ['admin'], on: [...ROLES] };
    for (const mode of ['off', 'shadow', 'on'] as const) {
      const w = await world(mode);
      for (const role of ROLES)
        expect((await w.svc.getRun(roleCtx(role))).canSeeCars, `${mode}/${role}`).toBe(want[mode].includes(role));
    }
  });
});

describe('carsView contents', () => {
  it('ignores as=', async () => {
    const w = await world('on');
    expect(await w.svc.carsView(roleCtx('quad', 'L1'))).toEqual(await w.svc.carsView(roleCtx('quad')));
  });
  it('cars carry leader names and stops in stop order; unassigned counts riders with no car', async () => {
    const w = await world('on');
    const v = await w.svc.carsView(roleCtx('grade'));
    expect(v.readOnly).toBe(true);
    expect(v.unassigned).toBe(1);
    const car = v.cars.find((c) => c.name === 'Big Bus')!;
    expect(car.leaderNames).toEqual(['Tom', 'Sarah']);
    expect(car.stops.map((s) => s.stop)).toEqual([1, 2, 3]);
    expect(car.stops.map((s) => s.name)).toEqual(['Riley Kim', 'Jess Tran', 'Sam Ode']);
    expect(car.stops.map((s) => s.grade)).toEqual([10, 9, 8]);
    expect(car.stops.map((s) => s.dropped)).toEqual([false, true, false]);
    expect(car.stops.map((s) => s.suburb)).toEqual(['', 'Carina', '']);
  });
  it('key allow-list + no street, full address or phone anywhere', async () => {
    const w = await world('on');
    const v = await w.svc.carsView(roleCtx('admin'));
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
    expect(v.riders.length).toBe(4);
    for (const r of v.riders) {
      assertSafeSuburb(r.address);
      for (const a of Object.values(ADDR)) expect(r.address).not.toContain(streetOf(a));
    }
    expect(v.riders.map((r) => r.address).sort()).toEqual(['', '', 'Carina', 'Mount Gravatt East']);
  });
});
