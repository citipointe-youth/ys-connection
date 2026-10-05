import { z } from 'zod';
import { generateId } from '../utils/id';
import { can, type Action } from './access-control';
import { BadRequestError, ForbiddenError, ModuleDisabledError, NotFoundError } from '../core/errors/app-error';
import { currentRunDate, eligibilityOf, capacityOf, nameMatches, normName, PURGE_DAYS } from './bus-logic';
import type { IBusRepository, IStudentRepository, ILeaderRepository, ISettingsRepository } from '../repositories/interfaces/entity-repositories';
import type { Actor } from '../core/entities/user';
import type { MinistryConfig } from '../core/ministry-config';
import type { BusRun, BusRunRider, BusRunVehicleView, BusRiderView, BusSearchHit, BusGender,
  BusLeaderView, BusAddress, BusRunView, PendingGuestView } from '../core/entities/bus';

export interface BusCtx { actor: Actor; asLeaderId: string | null; localNow: string }

export interface BusService {
  getRun(ctx: BusCtx): Promise<BusRunView>;
  getVersion(ctx: BusCtx): Promise<{ runId: string; version: number }>;
  search(ctx: BusCtx, q: string): Promise<BusSearchHit[]>;
  addRider(ctx: BusCtx, input: unknown): Promise<BusRiderView>;
  updateRider(ctx: BusCtx, riderId: string, input: unknown): Promise<BusRiderView>;
  removeRider(ctx: BusCtx, riderId: string): Promise<void>;
  createGuest(ctx: BusCtx, input: unknown): Promise<BusSearchHit>;
}

const NewAddress = z.object({ label: z.string().max(40).default(''), address: z.string().min(3).max(200), placeId: z.string().max(300).nullable().default(null) });
const AddRider = z.object({
  studentId: z.string().min(1).optional(), guestId: z.string().min(1).optional(),
  addressId: z.string().min(1).optional(), newAddress: NewAddress.optional(),
}).refine((v) => !!v.studentId !== !!v.guestId, 'Choose a student or a new person')
  .refine((v) => !!v.addressId !== !!v.newAddress, 'Choose an address');
const UpdateRider = z.object({ addressId: z.string().min(1).optional(), newAddress: NewAddress.optional() })
  .refine((v) => !!v.addressId !== !!v.newAddress, 'Choose an address');
const NewGuest = z.object({
  firstName: z.string().trim().min(1).max(60), lastName: z.string().trim().min(1).max(60),
  grade: z.number().int().nullable(), gender: z.enum(['male', 'female']), phone: z.string().trim().min(6).max(20),
});

const nowIso = () => new Date().toISOString();
const genderOf = (g: string | null | undefined): BusGender => (g === 'male' || g === 'female' ? g : null);

export function makeBusService(bus: IBusRepository, students: IStudentRepository,
  leaders: ILeaderRepository, settingsRepo: ISettingsRepository): BusService {

  async function cfg(): Promise<MinistryConfig> { return (await settingsRepo.getSettings()).ministryConfig; }

  /** Module/visibility gate + coordinator elevation. Returns the effective permission check. */
  async function gate(ctx: BusCtx, action: Action): Promise<MinistryConfig> {
    const c = await cfg();
    if (!c.modules.busMinistry) throw new ModuleDisabledError('Bus Ministry');
    if (c.busMinistry.visibility === 'admin' && ctx.actor.role !== 'admin') throw new ModuleDisabledError('Bus Ministry');
    if (!allowed(ctx, c, action)) throw new ForbiddenError(`Role '${ctx.actor.role}' cannot perform '${action}'`);
    return c;
  }
  function selfLeaderId(ctx: BusCtx): string | null {
    // A junior-leader login is locked to its own record; everyone else self-identifies (spoofable by design — spec §4).
    return ctx.actor.role === 'leader' ? ctx.actor.leaderId ?? null : ctx.asLeaderId;
  }
  function allowed(ctx: BusCtx, c: MinistryConfig, action: Action): boolean {
    if (can(ctx.actor, action)) return true;
    const me = selfLeaderId(ctx);
    const coordinator = !!me && c.busMinistry.coordinatorLeaderIds.includes(me);
    return coordinator && (action === 'bus:use' || action === 'bus:roster' || action === 'bus:coordinate');
  }

  async function whoLabel(ctx: BusCtx): Promise<string> {
    const me = selfLeaderId(ctx);
    if (me) { const l = await leaders.findById(me); if (l) return l.fullName; }
    return ctx.actor.displayName;
  }

  async function purgeGuests(): Promise<void> {
    const cutoff = Date.now() - PURGE_DAYS * 86_400_000;
    for (const g of await bus.listGuests()) {
      if (g.linkedStudentId) continue;
      const last = Date.parse(g.lastRiddenAt ?? g.createdAt);
      if (last < cutoff) await bus.deleteGuest(g.id);
    }
  }

  /** Get (or create) the run for ctx.localNow. New runs copy the previous run's fleet setup. */
  async function ensureRun(ctx: BusCtx, c: MinistryConfig): Promise<BusRun> {
    const date = currentRunDate(ctx.localNow, c.structure.serviceDayOfWeek);
    const existing = await bus.getRunByDate(date);
    if (existing) return existing;
    const prev = (await bus.listRuns()).find((r) => r.serviceDate < date) ?? null;
    const { run, created } = await bus.insertRunIfAbsent({
      id: generateId(), serviceDate: date, version: 0, availablePoolLeaderIds: prev?.availablePoolLeaderIds ?? [],
      lockBy: null, lockUntil: null, lastChangeBy: null, lastChangeAt: null, undoSnapshot: null, undoUntil: null, createdAt: nowIso(),
    });
    if (!created) return run;
    const prevVehicles = prev ? await bus.listRunVehicles(prev.id) : [];
    const prefs = await bus.listLeaderPrefs();
    const fleet = (await bus.listVehicles()).filter((v) => !v.archived);
    for (const [i, v] of fleet.entries()) {
      const before = prevVehicles.find((p) => p.vehicleId === v.id);
      await bus.saveRunVehicle({
        id: generateId(), runId: run.id, vehicleId: v.id, ownerLeaderId: null, name: v.name, seats: v.seats, plate: v.plate,
        running: before ? before.running : true,
        leaderIds: before ? before.leaderIds : prefs.filter((p) => p.fixedVehicleId === v.id).map((p) => p.id),
        endsAt: v.endsAt, endsAddress: v.endsAddress, endsPlaceId: v.endsPlaceId, colourIndex: i,
      });
    }
    return run;
  }

  function isPast(run: BusRun, ctx: BusCtx, c: MinistryConfig): boolean {
    return run.serviceDate < currentRunDate(ctx.localNow, c.structure.serviceDayOfWeek);
  }
  // Writes always target the current night (ensureRun never returns a past run);
  // a rider/car id from a finished night therefore fails its runId check → 404.
  const writableRun = ensureRun;
  async function touch(ctx: BusCtx, run: BusRun): Promise<void> {
    await bus.bumpRun(run.id, await whoLabel(ctx), nowIso());
  }

  function riderView(r: BusRunRider): BusRiderView {
    return { id: r.id, studentId: r.studentId, guestId: r.guestId, addressId: r.addressId, runVehicleId: r.runVehicleId,
      stopOrder: r.stopOrder, pinned: r.pinned, name: r.snapName, grade: r.snapGrade, gender: r.snapGender,
      address: r.snapAddress, placeId: r.snapPlaceId };
  }

  async function vehicleViews(runId: string): Promise<BusRunVehicleView[]> {
    const all = await leaders.findAll();
    const byId = new Map(all.map((l) => [l.id, l]));
    return (await bus.listRunVehicles(runId)).map((v) => ({
      ...v,
      capacity: capacityOf(v.seats, v.leaderIds.length),
      eligibility: eligibilityOf(v.leaderIds.map((id) => genderOf(byId.get(id)?.gender ?? null))),
      leaderNames: v.leaderIds.map((id) => byId.get(id)?.fullName ?? 'Leader'),
    }));
  }

  async function buildView(ctx: BusCtx, c: MinistryConfig, run: BusRun): Promise<BusRunView> {
    const [vehicles, riders, active, prefs, fleet] = await Promise.all([
      vehicleViews(run.id), bus.listRunRiders(run.id), leaders.findActive(), bus.listLeaderPrefs(), bus.listVehicles(),
    ]);
    const prefBy = new Map(prefs.map((p) => [p.id, p]));
    const leaderViews: BusLeaderView[] = active.map((l) => ({ id: l.id, name: l.fullName, gender: genderOf(l.gender),
      inPool: prefBy.get(l.id)?.inPool ?? false, fixedVehicleId: prefBy.get(l.id)?.fixedVehicleId ?? null }));
    const seesPending = can(ctx.actor, 'bus:analysis');
    return {
      run: { id: run.id, serviceDate: run.serviceDate, version: run.version, readOnly: isPast(run, ctx, c),
        lastChangeBy: run.lastChangeBy, lastChangeAt: run.lastChangeAt, lockBy: run.lockBy, lockUntil: run.lockUntil, undoUntil: run.undoUntil },
      vehicles, riders: riders.map(riderView), leaders: leaderViews, availablePoolLeaderIds: run.availablePoolLeaderIds,
      fleet: fleet.filter((v) => !v.archived), canCoordinate: allowed(ctx, c, 'bus:coordinate'),
      pendingNewPeople: seesPending ? (await pendingGuestList()).length : null,
    };
  }

  async function resolveAddress(owner: { studentId?: string; guestId?: string },
    input: { addressId?: string; newAddress?: { label: string; address: string; placeId: string | null } }): Promise<BusAddress> {
    if (input.addressId) {
      const a = await bus.getAddress(input.addressId);
      const mine = a && (owner.studentId ? a.studentId === owner.studentId : a.guestId === owner.guestId);
      if (!a || !mine) throw new NotFoundError('Address not found');
      return bus.saveAddress({ ...a, lastUsedAt: nowIso() });
    }
    const n = input.newAddress!;
    return bus.saveAddress({ id: generateId(), studentId: owner.studentId ?? null, guestId: owner.guestId ?? null,
      label: n.label, address: n.address, placeId: n.placeId, lastUsedAt: nowIso(), createdAt: nowIso() });
  }

  async function pendingGuestList(): Promise<PendingGuestView[]> {
    const all = await students.findAll();
    return (await bus.listGuests()).filter((g) => !g.linkedStudentId && !g.dismissed).map((g) => ({
      id: g.id, name: `${g.firstName} ${g.lastName}`, grade: g.grade, phone: g.phone, createdAt: g.createdAt,
      suggestions: all.filter((s) => normName(s.lastName) === normName(g.lastName)
          && (normName(s.firstName).startsWith(normName(g.firstName)) || normName(g.firstName).startsWith(normName(s.firstName))))
        .map((s) => ({ studentId: s.id, name: `${s.firstName} ${s.lastName}`, grade: s.grade })),
    }));
  }

  const svc: BusService = {
    async getRun(ctx) {
      const c = await gate(ctx, 'bus:use');
      await purgeGuests();
      return buildView(ctx, c, await ensureRun(ctx, c));
    },
    async getVersion(ctx) {
      const c = await gate(ctx, 'bus:use');
      const run = await ensureRun(ctx, c);
      return { runId: run.id, version: run.version };
    },
    async search(ctx, q) {
      await gate(ctx, 'bus:roster');
      if (q.trim().length < 2) return [];
      const hits: BusSearchHit[] = [];
      for (const s of (await students.findAll()).filter((s) => nameMatches(q, s.firstName, s.lastName)).slice(0, 15)) {
        const addrs = await bus.listAddresses({ studentId: s.id });
        hits.push({ kind: 'student', id: s.id, name: `${s.firstName} ${s.lastName}`, grade: s.grade, gender: genderOf(s.gender),
          addresses: addrs.map((a) => ({ id: a.id, label: a.label, address: a.address })) });
      }
      for (const g of (await bus.listGuests()).filter((g) => !g.linkedStudentId && nameMatches(q, g.firstName, g.lastName)).slice(0, 5)) {
        const addrs = await bus.listAddresses({ guestId: g.id });
        hits.push({ kind: 'guest', id: g.id, name: `${g.firstName} ${g.lastName}`, grade: g.grade, gender: g.gender,
          addresses: addrs.map((a) => ({ id: a.id, label: a.label, address: a.address })) });
      }
      return hits;
    },
    async addRider(ctx, input) {
      const c = await gate(ctx, 'bus:roster');
      const v = AddRider.parse(input);
      const run = await writableRun(ctx, c);
      let name: string, grade: number | null, gender: BusGender;
      if (v.studentId) {
        const s = await students.findById(v.studentId);
        if (!s) throw new NotFoundError('Student not found');
        name = `${s.firstName} ${s.lastName}`; grade = s.grade; gender = genderOf(s.gender);
      } else {
        const g = await bus.getGuest(v.guestId!);
        if (!g) throw new NotFoundError('Person not found');
        name = `${g.firstName} ${g.lastName}`; grade = g.grade; gender = g.gender;
        await bus.saveGuest({ ...g, lastRiddenAt: nowIso() });
      }
      const addr = await resolveAddress(v.studentId ? { studentId: v.studentId } : { guestId: v.guestId! }, v);
      const existing = (await bus.listRunRiders(run.id)).find((r) => (v.studentId ? r.studentId === v.studentId : r.guestId === v.guestId));
      const rider = await bus.saveRunRider({
        ...(existing ?? { id: generateId(), runId: run.id, runVehicleId: null, stopOrder: null, pinned: false,
          addedBy: await whoLabel(ctx), addedAt: nowIso() }),
        studentId: v.studentId ?? null, guestId: v.guestId ?? null, addressId: addr.id,
        snapName: name, snapGrade: grade, snapGender: gender, snapAddress: addr.address, snapPlaceId: addr.placeId,
      });
      await touch(ctx, run);
      return riderView(rider);
    },
    async updateRider(ctx, riderId, input) {
      const c = await gate(ctx, 'bus:roster');
      const v = UpdateRider.parse(input);
      const run = await writableRun(ctx, c);
      const r = await bus.getRunRider(riderId);
      if (!r || r.runId !== run.id) throw new NotFoundError('Rider not found');
      const addr = await resolveAddress(r.studentId ? { studentId: r.studentId } : { guestId: r.guestId! }, v);
      const saved = await bus.saveRunRider({ ...r, addressId: addr.id, snapAddress: addr.address, snapPlaceId: addr.placeId });
      await touch(ctx, run);
      return riderView(saved);
    },
    async removeRider(ctx, riderId) {
      const c = await gate(ctx, 'bus:roster');
      const run = await writableRun(ctx, c);
      const r = await bus.getRunRider(riderId);
      if (!r || r.runId !== run.id) throw new NotFoundError('Rider not found');
      await bus.deleteRunRider(riderId);
      await touch(ctx, run);
    },
    async createGuest(ctx, input) {
      await gate(ctx, 'bus:roster');
      const v = NewGuest.parse(input);
      const g = await bus.saveGuest({ id: generateId(), firstName: v.firstName, lastName: v.lastName, grade: v.grade,
        gender: v.gender, phone: v.phone, linkedStudentId: null, dismissed: false, createdAt: nowIso(), lastRiddenAt: null });
      return { kind: 'guest', id: g.id, name: `${g.firstName} ${g.lastName}`, grade: g.grade, gender: g.gender, addresses: [] };
    },
  };
  return svc;
}
