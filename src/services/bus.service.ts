import { z } from 'zod';
import { generateId } from '../utils/id';
import { can, type Action } from './access-control';
import { BadRequestError, ForbiddenError, ModuleDisabledError, NotFoundError } from '../core/errors/app-error';
import { currentRunDate, eligibilityOf, capacityOf, nameMatches, normName, riderKey, suburbOf, PURGE_DAYS } from './bus-logic';
import type { IBusRepository, IStudentRepository, ILeaderRepository, ISettingsRepository } from '../repositories/interfaces/entity-repositories';
import type { Actor } from '../core/entities/user';
import type { MinistryConfig } from '../core/ministry-config';
import type { BusRun, BusRunRider, BusRunVehicle, BusRunVehicleView, BusRiderView, BusSearchHit, BusGender,
  BusLeaderView, BusAddress, BusRunView, MyCarView, PendingGuestView, BusOwnCar, BusVehicle, BusConsent } from '../core/entities/bus';

export interface BusCtx { actor: Actor; asLeaderId: string | null; localNow: string }

export interface BusService {
  getRun(ctx: BusCtx): Promise<BusRunView>;
  getVersion(ctx: BusCtx): Promise<{ runId: string; version: number }>;
  search(ctx: BusCtx, q: string): Promise<BusSearchHit[]>;
  addRider(ctx: BusCtx, input: unknown): Promise<BusRiderView>;
  updateRider(ctx: BusCtx, riderId: string, input: unknown): Promise<BusRiderView>;
  removeRider(ctx: BusCtx, riderId: string): Promise<void>;
  createGuest(ctx: BusCtx, input: unknown): Promise<BusSearchHit>;
  saveVehicle(ctx: BusCtx, input: unknown): Promise<BusVehicle>;
  updateRunVehicle(ctx: BusCtx, runVehicleId: string, input: unknown): Promise<BusRunVehicleView>;
  setPool(ctx: BusCtx, input: unknown): Promise<void>;
  setLeaderPrefs(ctx: BusCtx, leaderId: string, input: unknown): Promise<void>;
  saveOwnCar(ctx: BusCtx, input: unknown): Promise<BusRunVehicleView>;
  removeOwnCar(ctx: BusCtx): Promise<void>;
  moveRider(ctx: BusCtx, riderId: string, input: unknown): Promise<BusRiderView>;
  setConsent(ctx: BusCtx, riderId: string, input: unknown): Promise<BusRiderView>;
  setDropped(ctx: BusCtx, riderId: string, input: unknown): Promise<BusRiderView>;
  myCar(ctx: BusCtx): Promise<MyCarView>;
  pendingGuests(ctx: BusCtx): Promise<PendingGuestView[]>;
  linkGuest(ctx: BusCtx, guestId: string, input: unknown): Promise<void>;
  dismissGuest(ctx: BusCtx, guestId: string): Promise<void>;
  linkGuestsAfterImport(): Promise<{ linked: number }>;
  listRuns(ctx: BusCtx): Promise<{ id: string; serviceDate: string; riders: number; cars: number }[]>;
  getPastRun(ctx: BusCtx, runId: string): Promise<BusRunView>;
}

const NewAddress = z.object({ label: z.string().max(40).default(''), address: z.string().min(3).max(200), placeId: z.string().max(300).nullable().default(null) });
const AddRider = z.object({
  studentId: z.string().min(1).optional(), guestId: z.string().min(1).optional(),
  addressId: z.string().min(1).optional(), newAddress: NewAddress.optional(),
}).refine((v) => !!v.studentId !== !!v.guestId, 'Choose a student or a new person')
  .refine((v) => !!v.addressId !== !!v.newAddress, 'Choose an address');
const UpdateRider = z.object({ addressId: z.string().min(1).optional(), newAddress: NewAddress.optional() })
  .refine((v) => !!v.addressId !== !!v.newAddress, 'Choose an address');
const NAME_RE = /^[^<>"]+$/; // C2: no raw <, > or " — prevents stored XSS via phoneLink()'s onclick attribute
const PHONE_RE = /^[0-9 +()-]{6,20}$/;
const NewGuest = z.object({
  firstName: z.string().trim().min(1).max(60).regex(NAME_RE, 'Invalid name'),
  lastName: z.string().trim().min(1).max(60).regex(NAME_RE, 'Invalid name'),
  grade: z.number().int().nullable(), gender: z.enum(['male', 'female']),
  phone: z.string().trim().min(6).max(20).regex(PHONE_RE, 'Invalid phone number'),
});
const EndsFields = { endsAt: z.enum(['church', 'last_drop', 'address']), endsAddress: z.string().max(200).nullable().default(null), endsPlaceId: z.string().max(300).nullable().default(null) };
const SaveVehicle = z.object({ id: z.string().optional(), name: z.string().trim().min(1).max(40), plate: z.string().max(12).nullable().default(null),
  seats: z.number().int().min(1).max(60), prefGrades: z.array(z.number().int()).default([]), ...EndsFields,
  sort: z.number().int().default(0), archived: z.boolean().default(false) });
const UpdateRunVehicle = z.object({ running: z.boolean().optional(), leaderIds: z.array(z.string()).optional(),
  endsAt: EndsFields.endsAt.optional(), endsAddress: z.string().max(200).nullable().optional(), endsPlaceId: z.string().max(300).nullable().optional() });
const SetPool = z.object({ availableLeaderIds: z.array(z.string()) });
const LeaderPrefsIn = z.object({ inPool: z.boolean().optional(), fixedVehicleId: z.string().nullable().optional() });
const OwnCarIn = z.object({ car: z.object({ name: z.string().trim().min(1).max(40), seats: z.number().int().min(2).max(15),
  plate: z.string().max(12).nullable().default(null), ...EndsFields }), riderIds: z.array(z.string()) });
const MoveIn = z.object({ runVehicleId: z.string().nullable() });
const LinkIn = z.object({ studentId: z.string().min(1) });
const ConsentIn = z.object({ given: z.boolean(), note: z.string().trim().max(300) })
  .refine((v) => !v.given || v.note.length > 0, 'Add a short note: when, who, call or text');
const DroppedIn = z.object({ dropped: z.boolean(), at: z.string().datetime().optional() });

const nowIso = () => new Date().toISOString();
const genderOf = (g: string | null | undefined): BusGender => (g === 'male' || g === 'female' ? g : null);

// M1: a bare schema.parse(input) throws ZodError, which the global error middleware maps to the
// generic "Validation failed" — unhelpful for a refine() message like "Choose a student or a new
// person". Bus routes parse through this instead so the caller sees the first real issue.
function parseIn<T>(schema: { parse: (v: unknown) => T }, input: unknown): T {
  try {
    return schema.parse(input);
  } catch (err) {
    if (err instanceof z.ZodError) throw new BadRequestError(err.issues[0]?.message ?? 'Invalid input');
    throw err;
  }
}

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

  function riderView(r: BusRunRider, consent?: BusConsent | null): BusRiderView {
    return { id: r.id, studentId: r.studentId, guestId: r.guestId, addressId: r.addressId, runVehicleId: r.runVehicleId,
      stopOrder: r.stopOrder, pinned: r.pinned, name: r.snapName, grade: r.snapGrade, gender: r.snapGender,
      address: r.snapAddress, placeId: r.snapPlaceId,
      consent: consent ? { given: consent.given, note: consent.note, recordedBy: consent.recordedBy, recordedAt: consent.recordedAt } : null,
      droppedAt: r.droppedAt, droppedBy: r.droppedBy };
  }
  function consentFor(consents: BusConsent[], r: BusRunRider): BusConsent | null {
    return consents.find((k) => (r.studentId ? k.studentId === r.studentId : k.guestId === r.guestId)) ?? null;
  }
  // One-off consent lookup for a single write's response (vs. consentFor's in-memory lookup
  // against a batch already loaded by buildView/myCar).
  async function consentOf(r: { studentId: string | null; guestId: string | null }): Promise<BusConsent | null> {
    return bus.getConsent(r.studentId ? { studentId: r.studentId } : { guestId: r.guestId! });
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
    const [vehicles, riders, active, prefs, fleet, consents] = await Promise.all([
      vehicleViews(run.id), bus.listRunRiders(run.id), leaders.findActive(), bus.listLeaderPrefs(), bus.listVehicles(), bus.listConsents(),
    ]);
    const prefBy = new Map(prefs.map((p) => [p.id, p]));
    const leaderViews: BusLeaderView[] = active.map((l) => ({ id: l.id, name: l.fullName, gender: genderOf(l.gender),
      inPool: prefBy.get(l.id)?.inPool ?? false, fixedVehicleId: prefBy.get(l.id)?.fixedVehicleId ?? null }));
    const seesPending = can(ctx.actor, 'bus:analysis');
    const canCoordinate = allowed(ctx, c, 'bus:coordinate');
    const riderViews = riders.map((r) => riderView(r, consentFor(consents, r)));
    // I1: a 'leader' login who isn't a self-identified coordinator gets "My car only" per
    // spec §4 — strip every other rider's full address/consent note/who-recorded-it, and
    // the leaders/fleet lists, instead of handing out the whole night's roster.
    const isRedactedLeader = ctx.actor.role === 'leader' && !canCoordinate;
    return {
      run: { id: run.id, serviceDate: run.serviceDate, version: run.version, readOnly: isPast(run, ctx, c),
        lastChangeBy: run.lastChangeBy, lastChangeAt: run.lastChangeAt, lockBy: run.lockBy, lockUntil: run.lockUntil, undoUntil: run.undoUntil },
      vehicles,
      riders: isRedactedLeader ? riderViews.map((r) => ({
        id: r.id, studentId: null, guestId: null, addressId: null,
        runVehicleId: r.runVehicleId, stopOrder: r.stopOrder, pinned: r.pinned,
        name: r.name, grade: r.grade, gender: r.gender, address: suburbOf(r.address), placeId: null,
        consent: r.consent ? { given: r.consent.given } : null,
        droppedAt: r.droppedAt, droppedBy: r.droppedBy,
      })) : riderViews,
      leaders: isRedactedLeader ? [] : leaderViews, availablePoolLeaderIds: run.availablePoolLeaderIds,
      fleet: isRedactedLeader ? [] : fleet.filter((v) => !v.archived), canCoordinate,
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

  async function linkOne(guestId: string, studentId: string): Promise<void> {
    const g = await bus.getGuest(guestId);
    if (!g) throw new NotFoundError('Person not found');
    if (!(await students.findById(studentId))) throw new NotFoundError('Student not found');
    await bus.reassignGuestAddresses(guestId, studentId);
    await bus.reassignGuestConsent(guestId, studentId);
    await bus.saveGuest({ ...g, linkedStudentId: studentId });
    // Rider rows in every run (past and present) move to the student so phones/addresses resolve.
    for (const run of await bus.listRuns()) {
      for (const r of (await bus.listRunRiders(run.id)).filter((r) => r.guestId === guestId))
        await bus.saveRunRider({ ...r, studentId, guestId: null });
    }
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
          addresses: addrs.map((a) => ({ id: a.id, label: a.label, suburb: suburbOf(a.address) })) });
      }
      for (const g of (await bus.listGuests()).filter((g) => !g.linkedStudentId && nameMatches(q, g.firstName, g.lastName)).slice(0, 5)) {
        const addrs = await bus.listAddresses({ guestId: g.id });
        hits.push({ kind: 'guest', id: g.id, name: `${g.firstName} ${g.lastName}`, grade: g.grade, gender: g.gender,
          addresses: addrs.map((a) => ({ id: a.id, label: a.label, suburb: suburbOf(a.address) })) });
      }
      return hits;
    },
    async addRider(ctx, input) {
      const c = await gate(ctx, 'bus:roster');
      const v = parseIn(AddRider, input);
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
      const patch = { studentId: v.studentId ?? null, guestId: v.guestId ?? null, addressId: addr.id,
        snapName: name, snapGrade: grade, snapGender: gender, snapAddress: addr.address, snapPlaceId: addr.placeId };
      let rider: BusRunRider;
      if (existing) {
        rider = await bus.saveRunRider({ ...existing, ...patch });
      } else {
        try {
          rider = await bus.saveRunRider({ id: generateId(), runId: run.id, runVehicleId: null, stopOrder: null,
            pinned: false, addedBy: await whoLabel(ctx), addedAt: nowIso(), droppedAt: null, droppedBy: null, ...patch });
        } catch (err) {
          // Two leaders adding the same student/guest at once: the DB's unique
          // (run_id, student_id)/(run_id, guest_id) index (migration 0011) rejects
          // the loser's insert with a Postgres unique-violation. Re-read and merge
          // onto the winner's row instead of surfacing a raw 500 — same outcome as
          // the sequential "adding the same student twice" path above.
          if ((err as { code?: string }).code !== '23505') throw err;
          const again = (await bus.listRunRiders(run.id)).find((r) => (v.studentId ? r.studentId === v.studentId : r.guestId === v.guestId));
          if (!again) throw err;
          rider = await bus.saveRunRider({ ...again, ...patch });
        }
      }
      await touch(ctx, run);
      return riderView(rider, await consentOf(rider));
    },
    async updateRider(ctx, riderId, input) {
      const c = await gate(ctx, 'bus:roster');
      const v = parseIn(UpdateRider, input);
      const run = await writableRun(ctx, c);
      const r = await bus.getRunRider(riderId);
      if (!r || r.runId !== run.id) throw new NotFoundError('Rider not found');
      const addr = await resolveAddress(r.studentId ? { studentId: r.studentId } : { guestId: r.guestId! }, v);
      const saved = await bus.saveRunRider({ ...r, addressId: addr.id, snapAddress: addr.address, snapPlaceId: addr.placeId });
      await touch(ctx, run);
      return riderView(saved, await consentOf(saved));
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
      const v = parseIn(NewGuest, input);
      const g = await bus.saveGuest({ id: generateId(), firstName: v.firstName, lastName: v.lastName, grade: v.grade,
        gender: v.gender, phone: v.phone, linkedStudentId: null, dismissed: false, createdAt: nowIso(), lastRiddenAt: null });
      return { kind: 'guest', id: g.id, name: `${g.firstName} ${g.lastName}`, grade: g.grade, gender: g.gender, addresses: [] };
    },
    async saveVehicle(ctx, input) {
      const c = await gate(ctx, 'bus:coordinate');
      const v = parseIn(SaveVehicle, input);
      const prior = v.id ? await bus.getVehicle(v.id) : null;
      if (v.id && !prior) throw new NotFoundError('Vehicle not found');
      const saved = await bus.saveVehicle({ id: v.id ?? generateId(), name: v.name, plate: v.plate, seats: v.seats,
        prefGrades: v.prefGrades, endsAt: v.endsAt, endsAddress: v.endsAddress, endsPlaceId: v.endsPlaceId,
        sort: v.sort, archived: v.archived, createdAt: prior?.createdAt ?? nowIso(), updatedAt: nowIso() });
      // Keep tonight's run in step with the fleet (not past runs).
      const run = await ensureRun(ctx, c);
      if (!isPast(run, ctx, c)) {
        const rvs = await bus.listRunVehicles(run.id);
        const rv = rvs.find((x) => x.vehicleId === saved.id);
        if (rv && saved.archived) await bus.deleteRunVehicle(rv.id);
        else if (rv) await bus.saveRunVehicle({ ...rv, name: saved.name, seats: saved.seats, plate: saved.plate });
        else if (!saved.archived) await bus.saveRunVehicle({ id: generateId(), runId: run.id, vehicleId: saved.id, ownerLeaderId: null,
          name: saved.name, seats: saved.seats, plate: saved.plate, running: true, leaderIds: [], endsAt: saved.endsAt,
          endsAddress: saved.endsAddress, endsPlaceId: saved.endsPlaceId, colourIndex: rvs.length });
        await touch(ctx, run);
      }
      return saved;
    },
    async updateRunVehicle(ctx, id, input) {
      const c = await gate(ctx, 'bus:coordinate');
      const v = parseIn(UpdateRunVehicle, input);
      const run = await writableRun(ctx, c);
      const rv = (await bus.listRunVehicles(run.id)).find((x) => x.id === id);
      if (!rv) throw new NotFoundError('Car not found');
      await bus.saveRunVehicle({ ...rv, ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) } as BusRunVehicle);
      if (v.running === false) {
        for (const r of (await bus.listRunRiders(run.id)).filter((r) => r.runVehicleId === id))
          await bus.saveRunRider({ ...r, runVehicleId: null, stopOrder: null, pinned: false });
      }
      await touch(ctx, run);
      return (await vehicleViews(run.id)).find((x) => x.id === id)!;
    },
    async setPool(ctx, input) {
      const c = await gate(ctx, 'bus:coordinate');
      const v = parseIn(SetPool, input);
      const run = await writableRun(ctx, c);
      await bus.saveRun({ ...run, availablePoolLeaderIds: v.availableLeaderIds });
      await touch(ctx, run);
    },
    async setLeaderPrefs(ctx, leaderId, input) {
      const c = await gate(ctx, 'bus:coordinate');
      const v = parseIn(LeaderPrefsIn, input);
      if (!(await leaders.findById(leaderId))) throw new NotFoundError('Leader not found');
      const p = (await bus.getLeaderPrefs(leaderId)) ?? { id: leaderId, inPool: false, fixedVehicleId: null, ownCar: null, lastOwnRiderKeys: [] };
      await bus.saveLeaderPrefs({ ...p, ...(v.inPool !== undefined ? { inPool: v.inPool } : {}),
        ...(v.fixedVehicleId !== undefined ? { fixedVehicleId: v.fixedVehicleId } : {}) });
      await touch(ctx, await ensureRun(ctx, c));
    },
    async saveOwnCar(ctx, input) {
      const c = await gate(ctx, 'bus:use');
      const me = selfLeaderId(ctx);
      if (!me) throw new BadRequestError('Choose who you are first');
      const v = parseIn(OwnCarIn, input);
      const run = await writableRun(ctx, c);
      const rvs = await bus.listRunVehicles(run.id);
      const prior = rvs.find((x) => x.ownerLeaderId === me);
      const leader = await leaders.findById(me);
      const rv = await bus.saveRunVehicle({ id: prior?.id ?? generateId(), runId: run.id, vehicleId: null, ownerLeaderId: me,
        name: v.car.name, seats: v.car.seats, plate: v.car.plate, running: true, leaderIds: [me],
        endsAt: v.car.endsAt, endsAddress: v.car.endsAddress, endsPlaceId: v.car.endsPlaceId,
        colourIndex: prior?.colourIndex ?? rvs.length });
      if (v.riderIds.length > capacityOf(rv.seats, 1)) throw new BadRequestError(`${rv.name} only has ${capacityOf(rv.seats, 1)} seats`);
      const riders = await bus.listRunRiders(run.id);
      for (const r of riders.filter((r) => r.runVehicleId === rv.id && !v.riderIds.includes(r.id)))
        await bus.saveRunRider({ ...r, runVehicleId: null, stopOrder: null, pinned: false });
      for (const [i, id] of v.riderIds.entries()) {
        const r = riders.find((x) => x.id === id);
        if (!r) throw new NotFoundError('Rider not found');
        await bus.saveRunRider({ ...r, runVehicleId: rv.id, stopOrder: i + 1, pinned: true });
      }
      const prefs = (await bus.getLeaderPrefs(me)) ?? { id: me, inPool: false, fixedVehicleId: null, ownCar: null, lastOwnRiderKeys: [] };
      if (leader) await bus.saveLeaderPrefs({ ...prefs, ownCar: v.car as BusOwnCar,
        lastOwnRiderKeys: riders.filter((r) => v.riderIds.includes(r.id)).map(riderKey) });
      await touch(ctx, run);
      return (await vehicleViews(run.id)).find((x) => x.id === rv.id)!;
    },
    async removeOwnCar(ctx) {
      const c = await gate(ctx, 'bus:use');
      const me = selfLeaderId(ctx);
      const run = await writableRun(ctx, c);
      const rv = (await bus.listRunVehicles(run.id)).find((x) => x.ownerLeaderId === me);
      if (!rv) return;
      for (const r of (await bus.listRunRiders(run.id)).filter((r) => r.runVehicleId === rv.id))
        await bus.saveRunRider({ ...r, runVehicleId: null, stopOrder: null, pinned: false });
      await bus.deleteRunVehicle(rv.id);
      await touch(ctx, run);
    },
    async moveRider(ctx, riderId, input) {
      const c = await gate(ctx, 'bus:coordinate');
      const v = parseIn(MoveIn, input);
      const run = await writableRun(ctx, c);
      const r = await bus.getRunRider(riderId);
      if (!r || r.runId !== run.id) throw new NotFoundError('Rider not found');
      if (v.runVehicleId === null) {
        const saved = await bus.saveRunRider({ ...r, runVehicleId: null, stopOrder: null, pinned: true });
        await touch(ctx, run);
        return riderView(saved, await consentOf(saved));
      }
      const rv = (await bus.listRunVehicles(run.id)).find((x) => x.id === v.runVehicleId && x.running);
      if (!rv) throw new NotFoundError('Car not found');
      const inCar = (await bus.listRunRiders(run.id)).filter((x) => x.runVehicleId === rv.id && x.id !== r.id);
      if (inCar.length >= capacityOf(rv.seats, rv.leaderIds.length)) throw new BadRequestError(`${rv.name} is full`);
      const maxStop = Math.max(0, ...inCar.map((x) => x.stopOrder ?? 0));
      const saved = await bus.saveRunRider({ ...r, runVehicleId: rv.id, stopOrder: maxStop + 1, pinned: true });
      await touch(ctx, run);
      return riderView(saved, await consentOf(saved));
    },
    async setConsent(ctx, riderId, input) {
      const c = await gate(ctx, 'bus:roster');
      const v = parseIn(ConsentIn, input);
      const run = await writableRun(ctx, c);
      const r = await bus.getRunRider(riderId);
      if (!r || r.runId !== run.id) throw new NotFoundError('Rider not found');
      const owner = r.studentId ? { studentId: r.studentId } : { guestId: r.guestId! };
      const prior = await bus.getConsent(owner);
      const who = await whoLabel(ctx);
      let saved: BusConsent;
      try {
        saved = await bus.saveConsent({ id: prior?.id ?? generateId(), studentId: r.studentId, guestId: r.studentId ? null : r.guestId,
          given: v.given, note: v.note, recordedBy: who, recordedAt: nowIso() });
      } catch (err) {
        // First-time consent for the same person, ticked by two leaders at once: the DB's
        // unique student_id/guest_id index on bus_consents rejects the loser's fresh-id
        // insert with a Postgres unique-violation. Re-read and save onto the winner's row
        // instead of surfacing a raw 500 — same pattern addRider uses for the rider race.
        if ((err as { code?: string }).code !== '23505') throw err;
        const again = await bus.getConsent(owner);
        if (!again) throw err;
        saved = await bus.saveConsent({ ...again, given: v.given, note: v.note, recordedBy: who, recordedAt: nowIso() });
      }
      await touch(ctx, run);
      return riderView(r, saved);
    },
    async setDropped(ctx, riderId, input) {
      const c = await gate(ctx, 'bus:use');
      const v = parseIn(DroppedIn, input);
      const run = await writableRun(ctx, c);
      const r = await bus.getRunRider(riderId);
      if (!r || r.runId !== run.id) throw new NotFoundError('Rider not found');
      const rv = (await bus.listRunVehicles(run.id)).find((x) => x.id === r.runVehicleId);
      const me = selfLeaderId(ctx);
      const inMyCar = !!rv && !!me && (rv.ownerLeaderId === me || rv.leaderIds.includes(me));
      if (!inMyCar && !allowed(ctx, c, 'bus:coordinate')) throw new ForbiddenError("Only this car's leaders can mark drop-offs");
      const saved = await bus.saveRunRider({ ...r, droppedAt: v.dropped ? (v.at ?? nowIso()) : null,
        droppedBy: v.dropped ? await whoLabel(ctx) : null });
      await touch(ctx, run);
      return riderView(saved, await consentOf(saved));
    },
    async myCar(ctx) {
      const c = await gate(ctx, 'bus:use');
      const me = selfLeaderId(ctx);
      const run = await ensureRun(ctx, c);
      const views = await vehicleViews(run.id);
      const vehicle = me ? views.find((v) => v.running && (v.ownerLeaderId === me || v.leaderIds.includes(me))) ?? null : null;
      const stops: MyCarView['stops'] = [];
      if (vehicle) {
        const mine = (await bus.listRunRiders(run.id)).filter((r) => r.runVehicleId === vehicle.id)
          .sort((a, b) => (a.stopOrder ?? 999) - (b.stopOrder ?? 999));
        const consents = await bus.listConsents();
        for (const r of mine) {
          const mobile = r.studentId ? (await students.findById(r.studentId))?.mobile ?? null
            : r.guestId ? (await bus.getGuest(r.guestId))?.phone ?? null : null;
          stops.push({ ...riderView(r, consentFor(consents, r)), mobile });
        }
      }
      let ownCarDraft: MyCarView['ownCarDraft'] = null;
      if (me && !vehicle) {
        const p = await bus.getLeaderPrefs(me);
        const tonight = await bus.listRunRiders(run.id);
        ownCarDraft = { car: p?.ownCar ?? null,
          riderIds: tonight.filter((r) => p?.lastOwnRiderKeys.includes(riderKey(r))).map((r) => r.id) };
      }
      return { vehicle, stops, churchAddress: c.busMinistry.churchAddress, ownCarDraft };
    },
    async pendingGuests(ctx) {
      await gate(ctx, 'bus:analysis');
      return pendingGuestList();
    },
    async linkGuest(ctx, guestId, input) {
      await gate(ctx, 'bus:analysis');
      const { studentId } = parseIn(LinkIn, input);
      await linkOne(guestId, studentId);
    },
    async dismissGuest(ctx, guestId) {
      await gate(ctx, 'bus:analysis');
      const g = await bus.getGuest(guestId);
      if (!g) throw new NotFoundError('Person not found');
      await bus.saveGuest({ ...g, dismissed: true });
    },
    async linkGuestsAfterImport() {
      const c = await cfg();
      if (!c.modules.busMinistry) return { linked: 0 };
      const all = await students.findAll();
      let linked = 0;
      for (const g of (await bus.listGuests()).filter((g) => !g.linkedStudentId)) {
        const matches = all.filter((s) => normName(s.firstName) === normName(g.firstName) && normName(s.lastName) === normName(g.lastName));
        if (matches.length === 1) { await linkOne(g.id, matches[0]!.id); linked++; }
      }
      return { linked };
    },
    async listRuns(ctx) {
      await gate(ctx, 'bus:analysis');
      const out = [];
      for (const r of await bus.listRuns()) {
        const [riders, cars] = await Promise.all([bus.listRunRiders(r.id), bus.listRunVehicles(r.id)]);
        out.push({ id: r.id, serviceDate: r.serviceDate, riders: riders.length, cars: cars.filter((v) => v.running).length });
      }
      return out;
    },
    async getPastRun(ctx, runId) {
      const c = await gate(ctx, 'bus:analysis');
      const run = await bus.getRun(runId);
      if (!run) throw new NotFoundError('Night not found');
      return buildView(ctx, c, run);
    },
  };
  return svc;
}
