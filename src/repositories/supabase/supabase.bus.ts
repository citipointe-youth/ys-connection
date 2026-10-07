import type { SqlClient } from './client';
import { toIso } from './client';
import { isEncrypted, decryptField, maybeEncrypt } from '../../utils/field-crypto';
import type { IBusRepository } from '../interfaces/entity-repositories';
import type { BusVehicle, BusLeaderPrefs, BusGuest, BusAddress, BusRun, BusRunVehicle, BusRunRider,
  BusOwnCar, EndsAt, BusGender, BusConsent, BusUndoEntry } from '../../core/entities/bus';

export const busCrypt = {
  enc: (v: string | null | undefined, aad: string): string | null => maybeEncrypt(v, aad),
  dec: (v: unknown, aad: string): string | null => (v == null ? null : isEncrypted(v) ? decryptField(v, aad) : String(v)),
};
const iso = (v: unknown) => (v == null ? null : toIso(v));

function toVehicle(r: Record<string, any>): BusVehicle {
  return { id: r.id, name: r.name, plate: r.plate ?? null, seats: r.seats, prefGrades: r.pref_grades ?? [],
    endsAt: r.ends_at as EndsAt,
    endsAddress: busCrypt.dec(r.ends_address, `bus_vehicles:ends_address:${r.id}`),
    endsPlaceId: busCrypt.dec(r.ends_place_id, `bus_vehicles:ends_place_id:${r.id}`),
    sort: r.sort, archived: r.archived, createdAt: toIso(r.created_at), updatedAt: toIso(r.updated_at) };
}
function ownCarOut(o: BusOwnCar | null, leaderId: string): unknown {
  if (!o) return null;
  return { ...o, endsAddress: busCrypt.enc(o.endsAddress, `bus_leader_prefs:own_car_address:${leaderId}`),
    endsPlaceId: busCrypt.enc(o.endsPlaceId, `bus_leader_prefs:own_car_place:${leaderId}`) };
}
function ownCarIn(o: any, leaderId: string): BusOwnCar | null {
  if (!o) return null;
  return { ...o, endsAddress: busCrypt.dec(o.endsAddress, `bus_leader_prefs:own_car_address:${leaderId}`),
    endsPlaceId: busCrypt.dec(o.endsPlaceId, `bus_leader_prefs:own_car_place:${leaderId}`) };
}
export function toPrefs(r: Record<string, any>): BusLeaderPrefs {
  return { id: r.leader_id, inPool: r.in_pool, fixedVehicleId: r.fixed_vehicle_id ?? null,
    ownCar: ownCarIn(r.own_car, r.leader_id), lastOwnRiderKeys: r.last_own_rider_keys ?? [], prefGrades: r.pref_grades ?? [] };
}
function toGuest(r: Record<string, any>): BusGuest {
  return { id: r.id, firstName: r.first_name, lastName: r.last_name, grade: r.grade ?? null, gender: (r.gender ?? null) as BusGender,
    phone: busCrypt.dec(r.phone, `bus_guests:phone:${r.id}`), linkedStudentId: r.linked_student_id ?? null,
    dismissed: r.dismissed, createdAt: toIso(r.created_at), lastRiddenAt: iso(r.last_ridden_at) };
}
function toAddress(r: Record<string, any>): BusAddress {
  return { id: r.id, studentId: r.student_id ?? null, guestId: r.guest_id ?? null, label: r.label,
    address: busCrypt.dec(r.address, `bus_addresses:address:${r.id}`)!,
    placeId: busCrypt.dec(r.place_id, `bus_addresses:place_id:${r.id}`),
    lastUsedAt: toIso(r.last_used_at), createdAt: toIso(r.created_at) };
}
function toRun(r: Record<string, any>): BusRun {
  return { id: r.id, serviceDate: typeof r.service_date === 'string' ? r.service_date.slice(0, 10) : toIso(r.service_date).slice(0, 10),
    version: r.version, availablePoolLeaderIds: r.available_pool_leader_ids ?? [],
    lockBy: r.lock_by ?? null, lockUntil: iso(r.lock_until), lastChangeBy: r.last_change_by ?? null,
    lastChangeAt: iso(r.last_change_at), undoSnapshot: r.undo_snapshot ?? null, undoUntil: iso(r.undo_until),
    createdAt: toIso(r.created_at) };
}
function toRunVehicle(r: Record<string, any>): BusRunVehicle {
  return { id: r.id, runId: r.run_id, vehicleId: r.vehicle_id ?? null, ownerLeaderId: r.owner_leader_id ?? null,
    name: r.name, seats: r.seats, plate: r.plate ?? null, running: r.running, leaderIds: r.leader_ids ?? [],
    endsAt: r.ends_at as EndsAt,
    endsAddress: busCrypt.dec(r.ends_address, `bus_run_vehicles:ends_address:${r.id}`),
    endsPlaceId: busCrypt.dec(r.ends_place_id, `bus_run_vehicles:ends_place_id:${r.id}`),
    colourIndex: r.colour_index };
}
function toRider(r: Record<string, any>): BusRunRider {
  return { id: r.id, runId: r.run_id, studentId: r.student_id ?? null, guestId: r.guest_id ?? null,
    addressId: r.address_id ?? null, runVehicleId: r.run_vehicle_id ?? null, stopOrder: r.stop_order ?? null,
    pinned: r.pinned, addedBy: r.added_by, addedAt: toIso(r.added_at),
    snapName: busCrypt.dec(r.snap_name, `bus_run_riders:snap_name:${r.id}`)!,
    snapGrade: r.snap_grade ?? null, snapGender: (r.snap_gender ?? null) as BusGender,
    snapAddress: busCrypt.dec(r.snap_address, `bus_run_riders:snap_address:${r.id}`)!,
    snapPlaceId: busCrypt.dec(r.snap_place_id, `bus_run_riders:snap_place_id:${r.id}`),
    droppedAt: iso(r.dropped_at), droppedBy: r.dropped_by ?? null };
}
function toConsent(r: Record<string, any>): BusConsent {
  return { id: r.id, studentId: r.student_id ?? null, guestId: r.guest_id ?? null, given: r.given,
    note: busCrypt.dec(r.note, `bus_consents:note:${r.id}`) ?? '', recordedBy: r.recorded_by, recordedAt: toIso(r.recorded_at) };
}

export class SupabaseBusRepository implements IBusRepository {
  constructor(private sql: SqlClient) {}
  private j(v: unknown) { return this.sql.json(v as Parameters<typeof this.sql.json>[0]); }

  async init(): Promise<void> {}

  async listVehicles() { return (await this.sql`select * from bus_vehicles order by sort, name`).map(toVehicle); }
  async getVehicle(id: string) { const r = await this.sql`select * from bus_vehicles where id = ${id}`; return r[0] ? toVehicle(r[0]) : null; }
  async saveVehicle(v: BusVehicle) {
    const r = await this.sql`
      insert into bus_vehicles (id, name, plate, seats, pref_grades, ends_at, ends_address, ends_place_id, sort, archived, created_at, updated_at)
      values (${v.id}, ${v.name}, ${v.plate}, ${v.seats}, ${this.j(v.prefGrades)}, ${v.endsAt},
        ${busCrypt.enc(v.endsAddress, `bus_vehicles:ends_address:${v.id}`)}, ${busCrypt.enc(v.endsPlaceId, `bus_vehicles:ends_place_id:${v.id}`)},
        ${v.sort}, ${v.archived}, ${v.createdAt}, ${v.updatedAt})
      on conflict (id) do update set name = excluded.name, plate = excluded.plate, seats = excluded.seats,
        pref_grades = excluded.pref_grades, ends_at = excluded.ends_at, ends_address = excluded.ends_address,
        ends_place_id = excluded.ends_place_id, sort = excluded.sort, archived = excluded.archived, updated_at = excluded.updated_at
      returning *`;
    return toVehicle(r[0]!);
  }

  async listLeaderPrefs() { return (await this.sql`select * from bus_leader_prefs`).map(toPrefs); }
  async getLeaderPrefs(id: string) { const r = await this.sql`select * from bus_leader_prefs where leader_id = ${id}`; return r[0] ? toPrefs(r[0]) : null; }
  async saveLeaderPrefs(p: BusLeaderPrefs) {
    const r = await this.sql`
      insert into bus_leader_prefs (leader_id, in_pool, fixed_vehicle_id, own_car, last_own_rider_keys, pref_grades)
      values (${p.id}, ${p.inPool}, ${p.fixedVehicleId}, ${p.ownCar ? this.j(ownCarOut(p.ownCar, p.id)) : null}, ${this.j(p.lastOwnRiderKeys)}, ${p.prefGrades})
      on conflict (leader_id) do update set in_pool = excluded.in_pool, fixed_vehicle_id = excluded.fixed_vehicle_id,
        own_car = excluded.own_car, last_own_rider_keys = excluded.last_own_rider_keys, pref_grades = excluded.pref_grades
      returning *`;
    return toPrefs(r[0]!);
  }

  async listGuests() { return (await this.sql`select * from bus_guests order by created_at desc`).map(toGuest); }
  async getGuest(id: string) { const r = await this.sql`select * from bus_guests where id = ${id}`; return r[0] ? toGuest(r[0]) : null; }
  async saveGuest(g: BusGuest) {
    const r = await this.sql`
      insert into bus_guests (id, first_name, last_name, grade, gender, phone, linked_student_id, dismissed, created_at, last_ridden_at)
      values (${g.id}, ${g.firstName}, ${g.lastName}, ${g.grade}, ${g.gender}, ${busCrypt.enc(g.phone, `bus_guests:phone:${g.id}`)},
        ${g.linkedStudentId}, ${g.dismissed}, ${g.createdAt}, ${g.lastRiddenAt})
      on conflict (id) do update set first_name = excluded.first_name, last_name = excluded.last_name, grade = excluded.grade,
        gender = excluded.gender, phone = excluded.phone, linked_student_id = excluded.linked_student_id,
        dismissed = excluded.dismissed, last_ridden_at = excluded.last_ridden_at
      returning *`;
    return toGuest(r[0]!);
  }
  async deleteGuest(id: string) { await this.sql`delete from bus_guests where id = ${id}`; } // addresses cascade

  async listAddresses(o: { studentId?: string; guestId?: string }) {
    const r = o.studentId
      ? await this.sql`select * from bus_addresses where student_id = ${o.studentId} order by last_used_at desc`
      : await this.sql`select * from bus_addresses where guest_id = ${o.guestId ?? null} order by last_used_at desc`;
    return r.map(toAddress);
  }
  async listAllAddresses() { return (await this.sql`select * from bus_addresses`).map(toAddress); }
  async getAddress(id: string) { const r = await this.sql`select * from bus_addresses where id = ${id}`; return r[0] ? toAddress(r[0]) : null; }
  async saveAddress(a: BusAddress) {
    const r = await this.sql`
      insert into bus_addresses (id, student_id, guest_id, label, address, place_id, last_used_at, created_at)
      values (${a.id}, ${a.studentId}, ${a.guestId}, ${a.label}, ${busCrypt.enc(a.address, `bus_addresses:address:${a.id}`)},
        ${busCrypt.enc(a.placeId, `bus_addresses:place_id:${a.id}`)}, ${a.lastUsedAt}, ${a.createdAt})
      on conflict (id) do update set student_id = excluded.student_id, guest_id = excluded.guest_id, label = excluded.label,
        address = excluded.address, place_id = excluded.place_id, last_used_at = excluded.last_used_at
      returning *`;
    return toAddress(r[0]!);
  }
  async deleteAddress(id: string) { await this.sql`delete from bus_addresses where id = ${id}`; }
  async reassignGuestAddresses(guestId: string, studentId: string) {
    await this.sql`update bus_addresses set student_id = ${studentId}, guest_id = null where guest_id = ${guestId}`;
  }

  async getRunByDate(d: string) { const r = await this.sql`select * from bus_runs where service_date = ${d}`; return r[0] ? toRun(r[0]) : null; }
  async getRun(id: string) { const r = await this.sql`select * from bus_runs where id = ${id}`; return r[0] ? toRun(r[0]) : null; }
  async listRuns() { return (await this.sql`select * from bus_runs order by service_date desc`).map(toRun); }
  async insertRunIfAbsent(run: BusRun) {
    const ins = await this.sql`
      insert into bus_runs (id, service_date, version, available_pool_leader_ids, created_at)
      values (${run.id}, ${run.serviceDate}, 0, ${this.j(run.availablePoolLeaderIds)}, ${run.createdAt})
      on conflict (service_date) do nothing returning *`;
    if (ins[0]) return { run: toRun(ins[0]), created: true };
    return { run: (await this.getRunByDate(run.serviceDate))!, created: false };
  }
  async bumpRun(id: string, by: string, at: string) {
    const r = await this.sql`update bus_runs set version = version + 1, last_change_by = ${by}, last_change_at = ${at} where id = ${id} returning *`;
    return toRun(r[0]!);
  }

  async listRunVehicles(runId: string) { return (await this.sql`select * from bus_run_vehicles where run_id = ${runId} order by colour_index`).map(toRunVehicle); }
  async saveRunVehicle(v: BusRunVehicle) {
    const r = await this.sql`
      insert into bus_run_vehicles (id, run_id, vehicle_id, owner_leader_id, name, seats, plate, running, leader_ids, ends_at, ends_address, ends_place_id, colour_index)
      values (${v.id}, ${v.runId}, ${v.vehicleId}, ${v.ownerLeaderId}, ${v.name}, ${v.seats}, ${v.plate}, ${v.running}, ${this.j(v.leaderIds)},
        ${v.endsAt}, ${busCrypt.enc(v.endsAddress, `bus_run_vehicles:ends_address:${v.id}`)},
        ${busCrypt.enc(v.endsPlaceId, `bus_run_vehicles:ends_place_id:${v.id}`)}, ${v.colourIndex})
      on conflict (id) do update set name = excluded.name, seats = excluded.seats, plate = excluded.plate, running = excluded.running,
        leader_ids = excluded.leader_ids, ends_at = excluded.ends_at, ends_address = excluded.ends_address,
        ends_place_id = excluded.ends_place_id, colour_index = excluded.colour_index
      returning *`;
    return toRunVehicle(r[0]!);
  }
  async deleteRunVehicle(id: string) { await this.sql`delete from bus_run_vehicles where id = ${id}`; } // riders' run_vehicle_id → null (FK set null)

  async listRunRiders(runId: string) { return (await this.sql`select * from bus_run_riders where run_id = ${runId} order by added_at`).map(toRider); }
  async getRunRider(id: string) { const r = await this.sql`select * from bus_run_riders where id = ${id}`; return r[0] ? toRider(r[0]) : null; }
  async saveRunRider(x: BusRunRider) {
    const r = await this.sql`
      insert into bus_run_riders (id, run_id, student_id, guest_id, address_id, run_vehicle_id, stop_order, pinned, added_by, added_at,
        snap_name, snap_grade, snap_gender, snap_address, snap_place_id, dropped_at, dropped_by)
      values (${x.id}, ${x.runId}, ${x.studentId}, ${x.guestId}, ${x.addressId}, ${x.runVehicleId}, ${x.stopOrder}, ${x.pinned},
        ${x.addedBy}, ${x.addedAt}, ${busCrypt.enc(x.snapName, `bus_run_riders:snap_name:${x.id}`)}, ${x.snapGrade}, ${x.snapGender},
        ${busCrypt.enc(x.snapAddress, `bus_run_riders:snap_address:${x.id}`)}, ${busCrypt.enc(x.snapPlaceId, `bus_run_riders:snap_place_id:${x.id}`)},
        ${x.droppedAt}, ${x.droppedBy})
      on conflict (id) do update set student_id = excluded.student_id, guest_id = excluded.guest_id, address_id = excluded.address_id,
        run_vehicle_id = excluded.run_vehicle_id, stop_order = excluded.stop_order, pinned = excluded.pinned,
        snap_name = excluded.snap_name, snap_grade = excluded.snap_grade, snap_gender = excluded.snap_gender,
        snap_address = excluded.snap_address, snap_place_id = excluded.snap_place_id,
        dropped_at = excluded.dropped_at, dropped_by = excluded.dropped_by
      returning *`;
    return toRider(r[0]!);
  }
  async deleteRunRider(id: string) { await this.sql`delete from bus_run_riders where id = ${id}`; }

  async listConsents() { return (await this.sql`select * from bus_consents`).map(toConsent); }
  async getConsent(o: { studentId?: string; guestId?: string }) {
    const r = o.studentId ? await this.sql`select * from bus_consents where student_id = ${o.studentId}`
      : await this.sql`select * from bus_consents where guest_id = ${o.guestId ?? null}`;
    return r[0] ? toConsent(r[0]) : null;
  }
  async saveConsent(k: BusConsent) {
    const r = await this.sql`
      insert into bus_consents (id, student_id, guest_id, given, note, recorded_by, recorded_at)
      values (${k.id}, ${k.studentId}, ${k.guestId}, ${k.given}, ${busCrypt.enc(k.note, `bus_consents:note:${k.id}`)}, ${k.recordedBy}, ${k.recordedAt})
      on conflict (id) do update set given = excluded.given, note = excluded.note, recorded_by = excluded.recorded_by, recorded_at = excluded.recorded_at
      returning *`;
    return toConsent(r[0]!);
  }
  async reassignGuestConsent(guestId: string, studentId: string) {
    const has = await this.sql`select 1 from bus_consents where student_id = ${studentId}`;
    if (has.length) await this.sql`delete from bus_consents where guest_id = ${guestId}`;
    else await this.sql`update bus_consents set student_id = ${studentId}, guest_id = null where guest_id = ${guestId}`;
  }

  async tryLock(id: string, by: string, nowIso: string, untilIso: string) {
    // I3: bump the version so other phones' 10s version poll notices the lock and shows
    // "<name> is generating routes…" instead of staying on a stale, unlocked-looking view.
    const r = await this.sql`update bus_runs set lock_by = ${by}, lock_until = ${untilIso}, version = version + 1
      where id = ${id} and (lock_until is null or lock_until <= ${nowIso}) returning *`;
    return r[0] ? toRun(r[0]) : null;
  }
  async releaseLock(id: string, by: string) { // I3 (version bump) + M1 (only clear a lock `by` still holds)
    await this.sql`update bus_runs set lock_by = null, lock_until = null, version = version + 1 where id = ${id} and lock_by = ${by}`;
  }
  async setUndo(id: string, snap: BusUndoEntry[] | null, until: string | null) {
    await this.sql`update bus_runs set undo_snapshot = ${snap ? this.j(snap) : null}, undo_until = ${until} where id = ${id}`;
  }
  async setPoolIds(id: string, ids: string[]) {
    await this.sql`update bus_runs set available_pool_leader_ids = ${this.j(ids)} where id = ${id}`;
  }
}
