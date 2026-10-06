import { describe, it, expect } from 'vitest';
import { autoFillPool, riderCost, endPlaceOf, leaveIso, buildFleetProblem, buildSingleProblem, placementsFrom, skipPairs, detours, type FleetCar } from '../services/bus-plan';

const W = { targetRouteMin: 45, genderWeightMin: 120, prefWeightMin: 10 };
const mixed = { female: true, male: true, unknown: false };
const boysOnly = { female: false, male: true, unknown: false };
const unknown = { female: false, male: false, unknown: true };

describe('autoFillPool', () => {
  const g: Record<string, 'male' | 'female'> = { M1: 'male', F1: 'female', F3: 'female', M2: 'male' };
  it('keeps fixed leaders and picks pool leaders so girl/boy seats match the roster', () => {
    const out = autoFillPool(
      [{ id: 'A', seats: 10, leaderIds: ['M1'] }, { id: 'B', seats: 8, leaderIds: [] }],
      [{ id: 'F1', gender: 'female' }, { id: 'M2', gender: 'male' }, { id: 'F3', gender: 'female' }],
      (id) => g[id] ?? null, { female: 8, male: 4 });
    expect(out.get('A')).toEqual(['M1', 'F1']);
    expect(out.get('B')).toEqual(['F3', 'M2']);
  });
  it('leaves cars with 2 leaders alone and does nothing with an empty pool', () => {
    expect(autoFillPool([{ id: 'A', seats: 8, leaderIds: ['M1', 'F1'] }], [{ id: 'F3', gender: 'female' }], (id) => g[id] ?? null, { female: 1, male: 1 }).size).toBe(0);
    expect(autoFillPool([{ id: 'A', seats: 8, leaderIds: [] }], [], () => null, { female: 1, male: 1 }).size).toBe(0);
  });
  // Known follow-up (2026-10-06): a 2nd leader must not bump a rider already fixed to the car.
  it('does not add a 2nd leader if it would drop capacity below the riders already fixed to the car', () => {
    const blocked = autoFillPool([{ id: 'A', seats: 4, leaderIds: ['M1'], fixedRiders: 3 }],
      [{ id: 'F1', gender: 'female' }], (id) => g[id] ?? null, { female: 1, male: 0 });
    expect(blocked.size).toBe(0);
    const ok = autoFillPool([{ id: 'A', seats: 4, leaderIds: ['M1'], fixedRiders: 2 }],
      [{ id: 'F1', gender: 'female' }], (id) => g[id] ?? null, { female: 1, male: 0 });
    expect(ok.get('A')).toEqual(['M1', 'F1']);
  });
  // Task 9 (owner): a car ending at a drop-off address sends its driver home — a pool leader
  // added there would be stranded. Leaders already fixed to it (hand-assigned) are untouched.
  it('never adds a pool leader to a car ending at an address; a church/last_drop car still fills', () => {
    const endsAtAddress = autoFillPool(
      [{ id: 'A', seats: 8, leaderIds: ['M1'], endsAt: 'address' }],
      [{ id: 'F1', gender: 'female' }], (id) => g[id] ?? null, { female: 1, male: 0 });
    expect(endsAtAddress.size).toBe(0);
    const endsAtChurch = autoFillPool(
      [{ id: 'A', seats: 8, leaderIds: ['M1'], endsAt: 'church' }],
      [{ id: 'F1', gender: 'female' }], (id) => g[id] ?? null, { female: 1, male: 0 });
    expect(endsAtChurch.get('A')).toEqual(['M1', 'F1']);
    // endsAt omitted entirely (older callers) behaves like 'church'/'last_drop' — still fills.
    const noEndsAt = autoFillPool([{ id: 'A', seats: 8, leaderIds: ['M1'] }],
      [{ id: 'F1', gender: 'female' }], (id) => g[id] ?? null, { female: 1, male: 0 });
    expect(noEndsAt.get('A')).toEqual(['M1', 'F1']);
  });
});

describe('riderCost', () => {
  it('gender penalty when leaders do not cover the rider; unknown-gender leaders cover neither', () => {
    expect(riderCost({ gender: 'female', grade: null }, boysOnly, [], W)).toBe(120);
    expect(riderCost({ gender: 'male', grade: null }, boysOnly, [], W)).toBe(0);
    expect(riderCost({ gender: 'male', grade: null }, unknown, [], W)).toBe(120);
    expect(riderCost({ gender: null, grade: null }, unknown, [], W)).toBe(0);
  });
  it('grade penalty only when the car has preferred grades', () => {
    expect(riderCost({ gender: null, grade: 9 }, mixed, [10, 11], W)).toBe(10);
    expect(riderCost({ gender: null, grade: 9 }, mixed, [], W)).toBe(0);
    expect(riderCost({ gender: 'female', grade: 9 }, boysOnly, [10], W)).toBe(130);
  });
});

describe('fleet problem', () => {
  const cars: FleetCar[] = [
    { id: 'A', capacity: 5, eligibility: boysOnly, prefGrades: [], endPlaceId: 'C' },
    { id: 'B', capacity: 3, eligibility: mixed, prefGrades: [10], endPlaceId: null },
  ];
  const r = (id: string, extra: object = {}) => ({ id, placeId: 'P' + id, gender: 'female' as const, grade: 9, runVehicleId: null, pinned: false, ...extra });
  it('pins, fit mode, penalties, ends and labels', () => {
    const { problem, stopRiderIds } = buildFleetProblem('all', cars,
      [r('1'), r('2', { runVehicleId: 'B', pinned: true }), r('3', { runVehicleId: 'A' })], 'C', '2026-10-09T21:00:00.000Z', W);
    expect(stopRiderIds).toEqual(['1', '2', '3']);
    expect(problem.vehicles).toEqual([{ start: { placeId: 'C' }, end: { placeId: 'C' }, capacity: 5 }, { start: { placeId: 'C' }, end: null, capacity: 3 }]);
    // Task 7 (owner): all riders here are girls (r()'s default gender) and only car B (mixed)
    // has a female leader, so a non-fixed girl's allowedVehicles is hard-restricted to [1] —
    // not null — even though 'all' mode would otherwise leave her free.
    expect(problem.stops[0]).toEqual({ point: { placeId: 'P1' }, allowedVehicles: [1],
      costs: [{ vehicle: 0, cost: 120 }, { vehicle: 1, cost: 10 }], optional: true });
    expect(problem.stops[1]!.allowedVehicles).toEqual([1]);   // pinned → its car (fixed wins over the gender rule)
    expect(problem.stops[2]!.allowedVehicles).toEqual([1]);   // placed but not pinned → still hard-restricted to female-eligible cars
    const fit = buildFleetProblem('fit', cars, [r('3', { runVehicleId: 'A' })], 'C', '2026-10-09T21:00:00.000Z', W);
    expect(fit.problem.stops[0]!.allowedVehicles).toEqual([0]); // placed → fixed in 'fit' (fixed wins over the gender rule too)
  });
  // Task 7 (owner, replaces the old lone-girl rule): a non-fixed girl may only be placed in a
  // car that currently has >=1 female leader — a hard constraint, not a soft cost.
  describe('female-leader hard constraint', () => {
    it('a free girl is restricted to female-eligible cars; a free boy is unrestricted', () => {
      const girl = buildFleetProblem('all', cars, [r('1', { gender: 'female' })], 'C', '2026-10-09T21:00:00.000Z', W);
      expect(girl.problem.stops[0]!.allowedVehicles).toEqual([1]); // only car B (mixed) has a female leader
      const boy = buildFleetProblem('all', cars, [r('1', { gender: 'male' })], 'C', '2026-10-09T21:00:00.000Z', W);
      expect(boy.problem.stops[0]!.allowedVehicles).toBeNull();
    });
    it('a girl is left unassignable (empty allowedVehicles) when no car has a female leader', () => {
      const allBoysCars: FleetCar[] = [{ id: 'A', capacity: 5, eligibility: boysOnly, prefGrades: [], endPlaceId: 'C' }];
      const { problem } = buildFleetProblem('all', allBoysCars, [r('1', { gender: 'female' })], 'C', '2026-10-09T21:00:00.000Z', W);
      expect(problem.stops[0]!.allowedVehicles).toEqual([]);
      expect(problem.stops[0]!.optional).toBe(true); // Google skips her rather than erroring
    });
    it('a pinned/fixed girl keeps her car even if it has no female leader (hand placement is not enforced)', () => {
      const allBoysCars: FleetCar[] = [{ id: 'A', capacity: 5, eligibility: boysOnly, prefGrades: [], endPlaceId: 'C' }];
      const { problem } = buildFleetProblem('all', allBoysCars, [r('1', { gender: 'female', runVehicleId: 'A', pinned: true })], 'C', '2026-10-09T21:00:00.000Z', W);
      expect(problem.stops[0]!.allowedVehicles).toEqual([0]);
    });
  });
  it('single-car problem must place every stop', () => {
    const p = buildSingleProblem(['a', 'b'], 'C', null, '2026-10-09T21:00:00.000Z', 45);
    expect(p.vehicles).toEqual([{ start: { placeId: 'C' }, end: null, capacity: 2 }]);
    expect(p.stops.every((s) => !s.optional && s.allowedVehicles === null)).toBe(true);
  });
  it('placements: 1-based order per car, skipped riders unassigned', () => {
    const m = placementsFrom({ routes: [{ vehicle: 1, stops: [2, 0], legsSec: [], totalSec: 0, polyline: null, legPolylines: [] }], skipped: [1] },
      ['x', 'y', 'z'], ['A', 'B']);
    expect(Object.fromEntries(m)).toEqual({ x: { runVehicleId: 'B', stopOrder: 2 }, y: { runVehicleId: null, stopOrder: null }, z: { runVehicleId: 'B', stopOrder: 1 } });
  });
  it('ends and leave time', () => {
    expect([endPlaceOf('church', null, 'C'), endPlaceOf('last_drop', 'X', 'C'), endPlaceOf('address', 'X', 'C'), endPlaceOf('address', null, 'C')])
      .toEqual(['C', null, 'X', null]);
    expect(leaveIso('2026-10-09', '21:00')).toBe('2026-10-09T21:00:00.000Z');
  });
});

describe('detours', () => {
  it('skip legs: prev → next, none for the last drop when the route ends there', () => {
    expect(skipPairs(['a', 'b'], 'C', 'C')).toEqual([{ from: 'C', to: 'b' }, { from: 'a', to: 'C' }]);
    expect(skipPairs(['a', 'b'], 'C', null)).toEqual([{ from: 'C', to: 'b' }, null]);
  });
  it('detour = in + out − skip; the last drop with no end costs its inbound leg', () => {
    expect(detours([600, 300, 900], [700, 700])).toEqual([200, 500]);
    expect(detours([600, 300], [700, 0])).toEqual([200, 300]);
  });
});
