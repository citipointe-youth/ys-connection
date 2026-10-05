import type { BusEligibility, BusGender, EndsAt } from '../core/entities/bus';
import type { SolveProblem, SolveResult, SolveStop } from './routing/routing-provider';

export interface Weights { targetRouteMin: number; genderWeightMin: number; prefWeightMin: number }

/**
 * Pool auto-fill (spec §7): fixed/tonight leaders stay; each car under 2 leaders takes available
 * pool leaders, picking the gender that is shortest of seats for tonight's roster split. Returns
 * new leaderIds only for cars that changed. Pure — the caller decides whether to save.
 */
export function autoFillPool(cars: { id: string; seats: number; leaderIds: string[] }[], pool: { id: string; gender: BusGender }[],
  genderOf: (leaderId: string) => BusGender, need: { female: number; male: number }): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const left = [...pool];
  const lead = new Map(cars.map((c) => [c.id, [...c.leaderIds]]));
  const seatsFor = (g: 'female' | 'male') => cars.reduce((n, c) => {
    const ids = lead.get(c.id)!;
    return ids.some((id) => genderOf(id) === g) ? n + Math.max(0, c.seats - ids.length) : n;
  }, 0);
  for (const c of cars) {
    const ids = lead.get(c.id)!;
    while (ids.length < 2 && left.length) {
      const gapF = need.female - seatsFor('female'), gapM = need.male - seatsFor('male');
      const hasF = ids.some((id) => genderOf(id) === 'female');
      const want: BusGender = gapF > gapM ? 'female' : gapM > gapF ? 'male' : !hasF ? 'female' : 'male';
      const i = Math.max(0, left.findIndex((l) => l.gender === want));
      ids.push(left.splice(i, 1)[0]!.id);
      out.set(c.id, ids);
    }
  }
  return out;
}

/** Penalty minutes for a rider in a car (spec §7). A leader with no gender covers neither. */
export function riderCost(r: { gender: BusGender; grade: number | null }, elig: BusEligibility, prefGrades: number[],
  w: Pick<Weights, 'genderWeightMin' | 'prefWeightMin'>): number {
  let cost = 0;
  if (r.gender && !elig[r.gender]) cost += w.genderWeightMin;
  if (r.grade != null && prefGrades.length && !prefGrades.includes(r.grade)) cost += w.prefWeightMin;
  return cost;
}

export function endPlaceOf(endsAt: EndsAt, endsPlaceId: string | null, churchPlaceId: string): string | null {
  return endsAt === 'church' ? churchPlaceId : endsAt === 'address' ? endsPlaceId : null;
}

/** Nominal leave time. Traffic is off, so labelling local time as UTC changes no drive times. */
export function leaveIso(serviceDate: string, leaveTime: string): string { return `${serviceDate}T${leaveTime}:00.000Z`; }

export interface FleetCar { id: string; capacity: number; eligibility: BusEligibility; prefGrades: number[]; endPlaceId: string | null }
export interface FleetRider { id: string; placeId: string; gender: BusGender; grade: number | null; runVehicleId: string | null; pinned: boolean }

/** 'all' = everyone except pinned is free; 'fit' = already-placed riders are fixed to their car. */
export function buildFleetProblem(mode: 'all' | 'fit', cars: FleetCar[], riders: FleetRider[], churchPlaceId: string, startIso: string,
  w: Weights): { problem: SolveProblem; stopRiderIds: string[] } {
  const idx = new Map(cars.map((c, i) => [c.id, i]));
  const stops: SolveStop[] = riders.map((r) => {
    const own = r.runVehicleId != null ? idx.get(r.runVehicleId) : undefined;
    const fixed = own !== undefined && (r.pinned || mode === 'fit');
    return { point: { placeId: r.placeId }, allowedVehicles: fixed ? [own] : null, optional: true,
      costs: cars.map((c, k) => ({ vehicle: k, cost: riderCost(r, c.eligibility, c.prefGrades, w) })).filter((c) => c.cost > 0) };
  });
  return {
    problem: { startIso, targetRouteMin: w.targetRouteMin, polylines: false, stops,
      vehicles: cars.map((c) => ({ start: { placeId: churchPlaceId }, end: c.endPlaceId ? { placeId: c.endPlaceId } : null, capacity: c.capacity })) },
    stopRiderIds: riders.map((r) => r.id),
  };
}

export function buildSingleProblem(placeIds: string[], churchPlaceId: string, endPlaceId: string | null, startIso: string,
  targetRouteMin: number): SolveProblem {
  return { startIso, targetRouteMin, polylines: false,
    vehicles: [{ start: { placeId: churchPlaceId }, end: endPlaceId ? { placeId: endPlaceId } : null, capacity: placeIds.length }],
    stops: placeIds.map((p) => ({ point: { placeId: p }, allowedVehicles: null, costs: [], optional: false })) };
}

export function placementsFrom(result: SolveResult, stopRiderIds: string[], carIds: string[]):
  Map<string, { runVehicleId: string | null; stopOrder: number | null }> {
  const out = new Map<string, { runVehicleId: string | null; stopOrder: number | null }>();
  for (const id of stopRiderIds) out.set(id, { runVehicleId: null, stopOrder: null });
  for (const r of result.routes) r.stops.forEach((s, i) => out.set(stopRiderIds[s]!, { runVehicleId: carIds[r.vehicle]!, stopOrder: i + 1 }));
  return out;
}
