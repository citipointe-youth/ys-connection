import { z } from 'zod';
import { generateId } from '../utils/id';
import { can, type Action } from './access-control';
import { AppError, BadRequestError, ConflictError, ForbiddenError, ModuleDisabledError, NotFoundError } from '../core/errors/app-error';
import { currentRunDate, eligibilityOf, capacityOf, nameMatches, normName, riderKey, suburbOf, PURGE_DAYS, BUS_CAR_COLOURS } from './bus-logic';
import { autoFillPool, buildFleetProblem, buildSingleProblem, endPlaceOf, leaveIso, placementsFrom, skipPairs, detours, loneGirls, type FleetCar } from './bus-plan';
import { FakeRoutingProvider } from './routing/fake-routing-provider';
import { routingDeadline, type RoutingProvider, type PlaceSuggestion, type SolveProblem, type SolveResult, type SolveStop,
  type MapImage, type MapMarker, type MapPath } from './routing/routing-provider';
import { decodePolyline, thinPolyline } from './routing/polyline';
import { markerLabel } from './routing/google-requests';
import type { IBusRepository, IStudentRepository, ILeaderRepository, ISettingsRepository } from '../repositories/interfaces/entity-repositories';
import type { Actor } from '../core/entities/user';
import type { MinistryConfig } from '../core/ministry-config';
import type { BusRun, BusRunRider, BusRunVehicle, BusRunVehicleView, BusRiderView, BusSearchHit, BusGender,
  BusLeaderView, BusAddress, BusRunView, MyCarView, PendingGuestView, BusOwnCar, BusVehicle, BusConsent, BusGenerateResult,
  BusAnalysisView, BusExtraCarsView } from '../core/entities/bus';

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
  autocomplete(ctx: BusCtx, q: string, session: string): Promise<PlaceSuggestion[]>;
  generate(ctx: BusCtx, input: unknown): Promise<BusGenerateResult>;
  undo(ctx: BusCtx): Promise<void>;
  analysis(ctx: BusCtx): Promise<BusAnalysisView>;
  extraCars(ctx: BusCtx, input: unknown): Promise<BusExtraCarsView>;
  analysisMap(ctx: BusCtx): Promise<MapImage>;
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
// prefGrades matches the vehicle's own SaveVehicle.prefGrades shape above — plain ints, no
// min/max (the grade range itself is ministry-config-driven, not a fixed Zod bound).
const LeaderPrefsIn = z.object({ inPool: z.boolean().optional(), fixedVehicleId: z.string().nullable().optional(),
  prefGrades: z.array(z.number().int()).optional() });
const OwnCarIn = z.object({ car: z.object({ name: z.string().trim().min(1).max(40), seats: z.number().int().min(2).max(15),
  plate: z.string().max(12).nullable().default(null), ...EndsFields }), riderIds: z.array(z.string()) });
const MoveIn = z.object({ runVehicleId: z.string().nullable().optional(), unpin: z.boolean().optional() })
  .refine((v) => v.unpin === true || v.runVehicleId !== undefined, 'runVehicleId required');
const LinkIn = z.object({ studentId: z.string().min(1) });
const ConsentIn = z.object({ given: z.boolean(), note: z.string().trim().max(300) })
  .refine((v) => !v.given || v.note.length > 0, 'Add a short note: when, who, call or text');
const DroppedIn = z.object({ dropped: z.boolean(), at: z.string().datetime().optional() });
const GenerateIn = z.object({ mode: z.enum(['all', 'fit']) });
const ExtraCarsIn = z.object({ count: z.number().int().min(1).max(2), seats: z.number().int().min(3).max(15) });
// Task 1: generate() can make up to two Google solves (the main solve + a lone-girl re-solve) plus
// per-rider writes between/after them. GENERATE_SOLVE_BUDGET_MS is ONE shared deadline for every
// solve a single generate() call makes (previously each got its own fresh 15s routingDeadline(),
// so the two solves together could outlast LOCK_MS). LOCK_MS sits comfortably above that budget
// plus the writes — the Vercel function's own maxDuration (vercel.json) is 60s.
const GENERATE_SOLVE_BUDGET_MS = 30_000;
const LOCK_MS = 55_000;
const UNDO_MS = 120_000;
const SESSION_RE = /^[A-Za-z0-9-]{8,36}$/;
const NO_CHURCH = 'Set the church address in Bus settings first';
const GENERATE_FAILED = "Couldn't reach Google Maps — nothing changed. Try again, or move riders by hand.";
const SEARCH_FAILED = 'Address search is unavailable right now. Type the full address instead.';
const ANALYSIS_FAILED = "Couldn't reach Google Maps — try again in a minute.";
const MAP_MAX_POINTS = 120; // per route, keeps the Static Maps URL far under its 16k limit

function routingFailed(err: unknown, message = GENERATE_FAILED): AppError {
  console.error('[bus] routing failed:', err instanceof Error ? err.message : err);
  return new AppError('ROUTING_FAILED', message, 502);
}
const lockActive = (run: BusRun) => !!run.lockUntil && Date.parse(run.lockUntil) > Date.now();
// Task 2: lock_by stores "<display name>#<random token>" per generate() call, not the bare
// display name — so a stale generate's `finally` can only ever release the lock IT took, never a
// later generate held under the SAME display name (same account, two devices). Both repos already
// match `by` as an opaque string, so this needs no repo change and no migration — just mint a
// token here and strip it everywhere the name is shown.
const lockToken = (name: string) => `${name}#${generateId()}`;
const lockName = (by: string | null): string | null => (by ? by.split('#')[0]! : null);
const lockConflict = (run: BusRun) => new ConflictError(`${lockName(run.lockBy) ?? 'Someone'} is generating routes…`);

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
  leaders: ILeaderRepository, settingsRepo: ISettingsRepository,
  routing: RoutingProvider = new FakeRoutingProvider()): BusService {

  async function cfg(): Promise<MinistryConfig> { return (await settingsRepo.getSettings()).ministryConfig; }

  // I4: once the real Google provider is live, a "fake:" place ID (only ever produced by the
  // dev/test fallback provider) must never be persisted — Google 400s on it with no clue why.
  function assertRealPlaceId(placeId: string | null | undefined): void {
    if (routing.name === 'google' && placeId?.startsWith('fake:'))
      throw new BadRequestError('That address needs to be re-picked from the search results');
  }

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
    // I7: a prev run's leaderIds/availablePoolLeaderIds can name a leader who's since been
    // deactivated (e.g. a New Year reset) — only carry forward leaders still active, or the
    // new run opens with stale "Leader" chips, wrong capacity and unknown gender.
    const activeIds = new Set((await leaders.findActive()).map((l) => l.id));
    const { run, created } = await bus.insertRunIfAbsent({
      id: generateId(), serviceDate: date, version: 0,
      availablePoolLeaderIds: (prev?.availablePoolLeaderIds ?? []).filter((id) => activeIds.has(id)),
      lockBy: null, lockUntil: null, lastChangeBy: null, lastChangeAt: null, undoSnapshot: null, undoUntil: null, createdAt: nowIso(),
    });
    if (!created) return run;
    const prevVehicles = prev ? await bus.listRunVehicles(prev.id) : [];
    const prefs = await bus.listLeaderPrefs();
    const fleet = (await bus.listVehicles()).filter((v) => !v.archived);
    for (const [i, v] of fleet.entries()) {
      const before = prevVehicles.find((p) => p.vehicleId === v.id);
      const leaderIds = (before ? before.leaderIds : prefs.filter((p) => p.fixedVehicleId === v.id).map((p) => p.id))
        .filter((id) => activeIds.has(id));
      await bus.saveRunVehicle({
        id: generateId(), runId: run.id, vehicleId: v.id, ownerLeaderId: null, name: v.name, seats: v.seats, plate: v.plate,
        running: before ? before.running : true, leaderIds,
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
    // I7: count/name only leaders that still exist — a leader deleted mid-run must not show
    // as a "Leader" placeholder chip with an unknown-gender eligibility, or be deducted from
    // capacity at all.
    return (await bus.listRunVehicles(runId)).map((v) => {
      const leaderIds = v.leaderIds.filter((id) => byId.has(id));
      return {
        ...v, leaderIds,
        capacity: capacityOf(v.seats, leaderIds.length),
        eligibility: eligibilityOf(leaderIds.map((id) => genderOf(byId.get(id)?.gender ?? null))),
        leaderNames: leaderIds.map((id) => byId.get(id)!.fullName),
      };
    });
  }

  async function buildView(ctx: BusCtx, c: MinistryConfig, run: BusRun): Promise<BusRunView> {
    const [vehicles, riders, active, prefs, fleet, consents] = await Promise.all([
      vehicleViews(run.id), bus.listRunRiders(run.id), leaders.findActive(), bus.listLeaderPrefs(), bus.listVehicles(), bus.listConsents(),
    ]);
    const prefBy = new Map(prefs.map((p) => [p.id, p]));
    const leaderViews: BusLeaderView[] = active.map((l) => ({ id: l.id, name: l.fullName, gender: genderOf(l.gender),
      inPool: prefBy.get(l.id)?.inPool ?? false, fixedVehicleId: prefBy.get(l.id)?.fixedVehicleId ?? null,
      prefGrades: prefBy.get(l.id)?.prefGrades ?? [] }));
    const seesPending = can(ctx.actor, 'bus:analysis');
    const canCoordinate = allowed(ctx, c, 'bus:coordinate');
    const riderViews = riders.map((r) => riderView(r, consentFor(consents, r)));
    // I1: a 'leader' login who isn't a self-identified coordinator gets "My car only" per
    // spec §4 — strip every other rider's full address/consent note/who-recorded-it, and
    // the leaders/fleet lists, instead of handing out the whole night's roster.
    const isRedactedLeader = ctx.actor.role === 'leader' && !canCoordinate;
    return {
      run: { id: run.id, serviceDate: run.serviceDate, version: run.version, readOnly: isPast(run, ctx, c),
        lastChangeBy: run.lastChangeBy, lastChangeAt: run.lastChangeAt, lockBy: lockName(run.lockBy), lockUntil: run.lockUntil, undoUntil: run.undoUntil },
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
    assertRealPlaceId(n.placeId);
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
    // Rider rows in every run (past and present) move to the student so phones/addresses
    // resolve. I4: if the student already has a rider in that SAME run (two separate people
    // ended up added once as the walk-in, once as the real student), repointing the guest's
    // row to the same studentId would collide with the run's unique (run_id, student_id)
    // index — drop the now-redundant guest row instead of throwing a raw 500, and keep going
    // for every other run rather than aborting the whole link.
    for (const run of await bus.listRuns()) {
      const runRiders = await bus.listRunRiders(run.id);
      const existing = runRiders.find((r) => r.studentId === studentId);
      for (const r of runRiders.filter((r) => r.guestId === guestId)) {
        if (existing) await bus.deleteRunRider(r.id);
        else await bus.saveRunRider({ ...r, studentId, guestId: null });
      }
    }
    // I3 (controller ruling): run history (incl. encrypted addresses) is kept across Full
    // Reset as a safeguarding record, but a linked walk-in's phone number must not linger —
    // delete the guest row itself now that its addresses/consent/rider rows have all moved.
    await bus.deleteGuest(guestId);
  }

  interface FleetPrep {
    problem: SolveProblem; stopRiderIds: string[];
    cars: BusRunVehicle[];               // running fleet cars, same order as problem.vehicles
    filled: Map<string, string[]>;       // pool auto-fill: run vehicle id → new leaderIds (not yet saved)
    riders: BusRunRider[];               // every rider on the run when prepared
    untouched: BusRunRider[];            // fleet riders with no place ID — never sent to Google
  }
  /** Builds the fleet solve for Generate / Fit in (and R3's "Try +N cars"). Reads only. */
  async function prepareFleet(c: MinistryConfig, run: BusRun, mode: 'all' | 'fit'): Promise<FleetPrep> {
    const b = c.busMinistry;
    const [rvs, riders, all, fleet, prefs] = await Promise.all([bus.listRunVehicles(run.id), bus.listRunRiders(run.id), leaders.findAll(), bus.listVehicles(), bus.listLeaderPrefs()]);
    const genderBy = new Map(all.map((l) => [l.id, genderOf(l.gender)]));
    const prefGradesBy = new Map(prefs.map((p) => [p.id, p.prefGrades]));
    const known = (ids: string[]) => ids.filter((id) => genderBy.has(id));
    const cars = rvs.filter((v) => v.running && v.vehicleId);
    const ownCarIds = new Set(rvs.filter((v) => v.ownerLeaderId).map((v) => v.id));
    const fleetRiders = riders.filter((r) => !(r.runVehicleId && ownCarIds.has(r.runVehicleId)));
    const busy = new Set(rvs.filter((v) => v.running).flatMap((v) => [...v.leaderIds, ...(v.ownerLeaderId ? [v.ownerLeaderId] : [])]));
    const pool = run.availablePoolLeaderIds.filter((id) => genderBy.has(id) && !busy.has(id)).map((id) => ({ id, gender: genderBy.get(id) ?? null }));
    const need = { female: fleetRiders.filter((r) => r.snapGender === 'female').length, male: fleetRiders.filter((r) => r.snapGender === 'male').length };
    // Known follow-up (2026-10-06): riders already fixed to a car (pinned, under Fit in, or with
    // no map pin at all — none of those are ever moved by this solve) must keep their seats —
    // auto-fill must not add a 2nd leader if that would drop capacity below how many of them there are.
    const fixedCount = new Map<string, number>();
    for (const r of fleetRiders) {
      if (r.runVehicleId && (r.pinned || mode === 'fit' || !r.snapPlaceId))
        fixedCount.set(r.runVehicleId, (fixedCount.get(r.runVehicleId) ?? 0) + 1);
    }
    const filled = autoFillPool(cars.map((v) => ({ id: v.id, seats: v.seats, leaderIds: known(v.leaderIds), fixedRiders: fixedCount.get(v.id) ?? 0 })),
      pool, (id) => genderBy.get(id) ?? null, need);
    const untouched = fleetRiders.filter((r) => !r.snapPlaceId);
    // A rider moved to Unassigned by hand (pinned, no car) stays unassigned under Fit in; Generate all re-places them.
    const solvable = fleetRiders.filter((r) => r.snapPlaceId && !(mode === 'fit' && r.pinned && !r.runVehicleId));
    const fleetCars: FleetCar[] = cars.map((v) => {
      const ids = filled.get(v.id) ?? known(v.leaderIds);
      // Task: a car's effective prefGrades is its vehicle's own ∪ the prefGrades of whichever
      // leaders end up in it tonight (fixed + pool auto-fill — `ids` already reflects both).
      const vehiclePrefGrades = fleet.find((f) => f.id === v.vehicleId)?.prefGrades ?? [];
      const leaderPrefGrades = ids.flatMap((id) => prefGradesBy.get(id) ?? []);
      return { id: v.id,
        capacity: Math.max(0, capacityOf(v.seats, ids.length) - untouched.filter((r) => r.runVehicleId === v.id).length),
        eligibility: eligibilityOf(ids.map((id) => genderBy.get(id) ?? null)),
        prefGrades: [...new Set([...vehiclePrefGrades, ...leaderPrefGrades])],
        endPlaceId: endPlaceOf(v.endsAt, v.endsPlaceId, b.churchPlaceId) };
    });
    const { problem, stopRiderIds } = buildFleetProblem(mode, fleetCars,
      solvable.map((r) => ({ id: r.id, placeId: r.snapPlaceId!, gender: r.snapGender, grade: r.snapGrade, runVehicleId: r.runVehicleId, pinned: r.pinned })),
      b.churchPlaceId, leaveIso(run.serviceDate, b.leaveTime), b);
    return { problem, stopRiderIds, cars, filled, riders, untouched };
  }

  /** Single-car solve for one car's stop order (Move, own car). No church pin / Google down → keep the current order. */
  async function reorderCar(c: MinistryConfig, run: BusRun, rv: BusRunVehicle): Promise<void> {
    const b = c.busMinistry;
    const inCar = (await bus.listRunRiders(run.id)).filter((x) => x.runVehicleId === rv.id)
      .sort((x, y) => (x.stopOrder ?? 999) - (y.stopOrder ?? 999));
    const mapped = inCar.filter((x) => x.snapPlaceId);
    if (!b.churchPlaceId || mapped.length < 2) return;
    try {
      const res = await routing.solve(buildSingleProblem(mapped.map((x) => x.snapPlaceId!), b.churchPlaceId,
        endPlaceOf(rv.endsAt, rv.endsPlaceId, b.churchPlaceId), leaveIso(run.serviceDate, b.leaveTime), b.targetRouteMin), routingDeadline());
      const order = res.routes[0]?.stops ?? [];
      if (order.length !== mapped.length) return;
      const next = [...order.map((i) => mapped[i]!), ...inCar.filter((x) => !x.snapPlaceId)];
      for (const [i, x] of next.entries()) if (x.stopOrder !== i + 1) await bus.saveRunRider({ ...x, stopOrder: i + 1 });
    } catch (err) {
      console.error('[bus] reorder skipped:', err instanceof Error ? err.message : err);
    }
  }

  // R3 re-solves tonight's placements (every rider fixed to their car) to get legs + polylines —
  // nothing is stored (Google terms), so this is cached per run version for the map call that follows.
  interface AnalysisSolve { key: string; cars: BusRunVehicle[]; riders: BusRunRider[]; problem: SolveProblem; result: SolveResult;
    secsByRoute?: number[][] } // I5: the per-car skip-leg matrix, cached alongside the solve itself (same run version)
  let lastAnalysis: AnalysisSolve | null = null;
  async function analysisSolve(c: MinistryConfig, run: BusRun, signal: AbortSignal): Promise<AnalysisSolve> {
    const b = c.busMinistry;
    // M6: a Bus-settings change (church, leave time, target route length) doesn't bump the run
    // version, so without these in the key a warm instance would keep serving the old solve/map.
    const key = `${run.id}:${run.version}:${b.churchPlaceId}:${b.leaveTime}:${b.targetRouteMin}`;
    if (lastAnalysis?.key === key) return lastAnalysis;
    if (!b.churchPlaceId) throw new BadRequestError(NO_CHURCH);
    const cars = (await bus.listRunVehicles(run.id)).filter((v) => v.running);
    const riders = (await bus.listRunRiders(run.id)).filter((r) => r.snapPlaceId && r.runVehicleId && cars.some((v) => v.id === r.runVehicleId));
    const problem: SolveProblem = { startIso: leaveIso(run.serviceDate, b.leaveTime), targetRouteMin: b.targetRouteMin, polylines: true,
      vehicles: cars.map((v) => {
        const end = endPlaceOf(v.endsAt, v.endsPlaceId, b.churchPlaceId);
        return { start: { placeId: b.churchPlaceId }, end: end ? { placeId: end } : null, capacity: riders.filter((r) => r.runVehicleId === v.id).length };
      }),
      stops: riders.map((r) => ({ point: { placeId: r.snapPlaceId! }, allowedVehicles: [cars.findIndex((v) => v.id === r.runVehicleId)], costs: [], optional: false })) };
    let result: SolveResult;
    try { result = problem.stops.length ? await routing.solve(problem, signal) : { routes: [], skipped: [] }; }
    catch (err) { throw routingFailed(err, ANALYSIS_FAILED); }
    return (lastAnalysis = { key, cars, riders, problem, result });
  }
  const minutes = (r: SolveResult, keep: (vehicle: number) => boolean = () => true) =>
    r.routes.filter((x) => keep(x.vehicle)).map((x) => Math.round(x.totalSec / 60));
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

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
      if (lockActive(run)) throw lockConflict(run); // a solve in flight is working off this run's current roster
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
      if (lockActive(run)) throw lockConflict(run); // a solve in flight is using this rider's current address/pin
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
      if (lockActive(run)) throw lockConflict(run); // a solve in flight is working off this run's current roster
      const r = await bus.getRunRider(riderId);
      if (!r || r.runId !== run.id) throw new NotFoundError('Rider not found');
      await bus.deleteRunRider(riderId);
      await bus.setUndo(run.id, null, null); // I2: a since-removed rider makes the pre-generate snapshot stale
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
      assertRealPlaceId(v.endsPlaceId);
      const prior = v.id ? await bus.getVehicle(v.id) : null;
      if (v.id && !prior) throw new NotFoundError('Vehicle not found');
      const saved = await bus.saveVehicle({ id: v.id ?? generateId(), name: v.name, plate: v.plate, seats: v.seats,
        prefGrades: v.prefGrades, endsAt: v.endsAt, endsAddress: v.endsAddress, endsPlaceId: v.endsPlaceId,
        sort: v.sort, archived: v.archived, createdAt: prior?.createdAt ?? nowIso(), updatedAt: nowIso() });
      // Keep tonight's run in step with the fleet (not past runs).
      const run = await ensureRun(ctx, c);
      if (!isPast(run, ctx, c)) {
        // I1: a solve in flight is working off this run's cars/capacities — a mid-solve
        // archive/seats/leader edit would write riders into a stale or now-gone car.
        if (lockActive(run)) throw lockConflict(run);
        const rvs = await bus.listRunVehicles(run.id);
        const rv = rvs.find((x) => x.vehicleId === saved.id);
        if (rv && saved.archived) {
          // M2: unassign the car's riders explicitly rather than relying on the DB's FK
          // ON DELETE SET NULL on run_vehicle_id alone — that only nulls run_vehicle_id,
          // leaving stop_order/pinned stale (same pattern removeOwnCar already uses).
          for (const r of (await bus.listRunRiders(run.id)).filter((x) => x.runVehicleId === rv.id))
            await bus.saveRunRider({ ...r, runVehicleId: null, stopOrder: null, pinned: false });
          await bus.deleteRunVehicle(rv.id);
        }
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
      assertRealPlaceId(v.endsPlaceId);
      const run = await writableRun(ctx, c);
      if (lockActive(run)) throw lockConflict(run); // I1: a solve in flight is using this car's current seats/running state
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
      if (lockActive(run)) throw lockConflict(run); // I1: the pool feeds the solve's auto-fill — don't change it mid-solve
      await bus.setPoolIds(run.id, v.availableLeaderIds);
      await touch(ctx, run);
    },
    async setLeaderPrefs(ctx, leaderId, input) {
      const c = await gate(ctx, 'bus:coordinate');
      const v = parseIn(LeaderPrefsIn, input);
      if (!(await leaders.findById(leaderId))) throw new NotFoundError('Leader not found');
      const run = await ensureRun(ctx, c);
      if (lockActive(run)) throw lockConflict(run); // I1: fixedVehicleId/inPool feed the solve's auto-fill
      const p = (await bus.getLeaderPrefs(leaderId)) ?? { id: leaderId, inPool: false, fixedVehicleId: null, ownCar: null, lastOwnRiderKeys: [], prefGrades: [] };
      await bus.saveLeaderPrefs({ ...p, ...(v.inPool !== undefined ? { inPool: v.inPool } : {}),
        ...(v.fixedVehicleId !== undefined ? { fixedVehicleId: v.fixedVehicleId } : {}),
        ...(v.prefGrades !== undefined ? { prefGrades: v.prefGrades } : {}) });
      await touch(ctx, run);
    },
    async saveOwnCar(ctx, input) {
      const c = await gate(ctx, 'bus:use');
      const me = selfLeaderId(ctx);
      if (!me) throw new BadRequestError('Choose who you are first');
      const v = parseIn(OwnCarIn, input);
      assertRealPlaceId(v.car.endsPlaceId);
      const run = await writableRun(ctx, c);
      if (lockActive(run)) throw lockConflict(run); // a solve in flight is working off this run's current roster
      // I6: validate BEFORE writing anything — the old order saved the car first and only
      // then checked capacity/rider ids, leaving a created-or-resized car behind on a 400/404.
      const riders = await bus.listRunRiders(run.id);
      const byId = new Map(riders.map((r) => [r.id, r]));
      for (const id of v.riderIds) if (!byId.has(id)) throw new NotFoundError('Rider not found');
      if (v.riderIds.length > capacityOf(v.car.seats, 1)) throw new BadRequestError(`${v.car.name} only has ${capacityOf(v.car.seats, 1)} seats`);
      const rvs = await bus.listRunVehicles(run.id);
      const prior = rvs.find((x) => x.ownerLeaderId === me);
      const leader = await leaders.findById(me);
      const rv = await bus.saveRunVehicle({ id: prior?.id ?? generateId(), runId: run.id, vehicleId: null, ownerLeaderId: me,
        name: v.car.name, seats: v.car.seats, plate: v.car.plate, running: true, leaderIds: [me],
        endsAt: v.car.endsAt, endsAddress: v.car.endsAddress, endsPlaceId: v.car.endsPlaceId,
        colourIndex: prior?.colourIndex ?? rvs.length });
      for (const r of riders.filter((r) => r.runVehicleId === rv.id && !v.riderIds.includes(r.id)))
        await bus.saveRunRider({ ...r, runVehicleId: null, stopOrder: null, pinned: false });
      for (const [i, id] of v.riderIds.entries()) {
        await bus.saveRunRider({ ...byId.get(id)!, runVehicleId: rv.id, stopOrder: i + 1, pinned: true });
      }
      await reorderCar(c, run, rv);
      const prefs = (await bus.getLeaderPrefs(me)) ?? { id: me, inPool: false, fixedVehicleId: null, ownCar: null, lastOwnRiderKeys: [], prefGrades: [] };
      if (leader) await bus.saveLeaderPrefs({ ...prefs, ownCar: v.car as BusOwnCar,
        lastOwnRiderKeys: riders.filter((r) => v.riderIds.includes(r.id)).map(riderKey) });
      await bus.setUndo(run.id, null, null); // I2: these riders just moved into an own car — a later Undo must not pull them back out
      await touch(ctx, run);
      return (await vehicleViews(run.id)).find((x) => x.id === rv.id)!;
    },
    async removeOwnCar(ctx) {
      const c = await gate(ctx, 'bus:use');
      const me = selfLeaderId(ctx);
      const run = await writableRun(ctx, c);
      if (lockActive(run)) throw lockConflict(run); // a solve in flight is working off this run's current roster
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
      if (lockActive(run)) throw lockConflict(run);
      const r = await bus.getRunRider(riderId);
      if (!r || r.runId !== run.id) throw new NotFoundError('Rider not found');
      if (v.unpin) { // keeps the rider's current car/stop — works pinned-in-a-car or pinned-in-Unassigned
        const saved = await bus.saveRunRider({ ...r, pinned: false });
        await bus.setUndo(run.id, null, null); // I2: survive Undo like moveRider's other writes
        await touch(ctx, run);
        return riderView(saved, await consentOf(saved));
      }
      if (v.runVehicleId === null) {
        // Owner 2026-10-06: Unassigned is never pinned — the next Generate / Fit in places them again.
        const saved = await bus.saveRunRider({ ...r, runVehicleId: null, stopOrder: null, pinned: false });
        await bus.setUndo(run.id, null, null); // I2: a hand-moved rider must survive a later Undo, not be reverted by it
        await touch(ctx, run);
        return riderView(saved, await consentOf(saved));
      }
      const rv = (await bus.listRunVehicles(run.id)).find((x) => x.id === v.runVehicleId && x.running);
      if (!rv) throw new NotFoundError('Car not found');
      const inCar = (await bus.listRunRiders(run.id)).filter((x) => x.runVehicleId === rv.id && x.id !== r.id);
      // I7: a leader removed from the roster can still be named in this car's raw leaderIds —
      // vehicleViews/prepareFleet already filter them out of capacity/eligibility; Move must too,
      // or a free seat behind a now-deleted leader gets rejected as "full".
      const knownLeaders = new Set((await leaders.findAll()).map((l) => l.id));
      const activeLeaderCount = rv.leaderIds.filter((id) => knownLeaders.has(id)).length;
      if (inCar.length >= capacityOf(rv.seats, activeLeaderCount)) throw new BadRequestError(`${rv.name} is full`);
      const maxStop = Math.max(0, ...inCar.map((x) => x.stopOrder ?? 0));
      const saved = await bus.saveRunRider({ ...r, runVehicleId: rv.id, stopOrder: maxStop + 1, pinned: true });
      await reorderCar(c, run, rv); // R1 appended last; R2 re-orders with a single-car solve (falls back to appended)
      await bus.setUndo(run.id, null, null); // I2: see above
      await touch(ctx, run);
      const fresh = (await bus.getRunRider(saved.id)) ?? saved;
      return riderView(fresh, await consentOf(fresh));
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
      return { vehicle, stops, churchAddress: c.busMinistry.churchAddress, churchPlaceId: c.busMinistry.churchPlaceId, ownCarDraft };
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
        if (matches.length !== 1) continue;
        // I4: one guest's link failing (unexpected error) must not abort every other
        // guest's link for the rest of this import.
        try { await linkOne(g.id, matches[0]!.id); linked++; }
        catch (err) { console.error(`linkGuestsAfterImport: failed to link guest ${g.id}`, err); }
      }
      return { linked };
    },
    async listRuns(ctx) {
      const c = await gate(ctx, 'bus:analysis');
      // M5: "Past nights" means strictly before tonight — without this, listRuns also
      // returned tonight's (and, if one somehow existed, a future) run.
      const today = currentRunDate(ctx.localNow, c.structure.serviceDayOfWeek);
      const out = [];
      for (const r of await bus.listRuns()) {
        if (r.serviceDate >= today) continue;
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
    async autocomplete(ctx, q, session) {
      const c = await gate(ctx, 'bus:use');
      const input = q.trim();
      if (input.length < 3 || input.length > 120) return [];
      const token = SESSION_RE.test(session) ? session : generateId();
      try { return await routing.autocomplete(input, token, c.busMinistry.regionCode, routingDeadline()); }
      catch (err) { throw routingFailed(err, SEARCH_FAILED); }
    },
    async generate(ctx, input) {
      const c = await gate(ctx, 'bus:coordinate');
      const { mode } = parseIn(GenerateIn, input);
      if (!c.busMinistry.churchPlaceId) throw new BadRequestError(NO_CHURCH);
      const run = await writableRun(ctx, c);
      const t0 = Date.now();
      const who = await whoLabel(ctx);
      const lockBy = lockToken(who); // Task 2: unique per call, even under the same display name
      if (!(await bus.tryLock(run.id, lockBy, new Date(t0).toISOString(), new Date(t0 + LOCK_MS).toISOString())))
        throw lockConflict((await bus.getRun(run.id)) ?? run);
      // Task 1: one shared deadline for every Google solve this generate() call makes (the main
      // solve + the lone-girl re-solve below) — if the re-solve has no time left it throws and is
      // skipped (the existing catch path already falls back to unassigning the violator).
      const signal = routingDeadline(GENERATE_SOLVE_BUDGET_MS);
      try {
        const prep = await prepareFleet(c, run, mode);
        if (!prep.problem.vehicles.length) throw new BadRequestError('Turn on at least one car in Car setup');
        let result: SolveResult;
        try { result = prep.problem.stops.length ? await routing.solve(prep.problem, signal) : { routes: [], skipped: [] }; }
        catch (err) { throw routingFailed(err); }
        const carIds = prep.cars.map((v) => v.id);
        const placed = placementsFrom(result, prep.stopRiderIds, carIds);
        const before = new Map(prep.riders.map((r) => [r.id, r]));
        // saveRunRider is an upsert: only write riders that still exist and weren't moved while Google was solving.
        const unchanged = (r: BusRunRider) => { const b0 = before.get(r.id); return !!b0 && b0.runVehicleId === r.runVehicleId && b0.pinned === r.pinned; };
        const current = await bus.listRunRiders(run.id);
        await bus.setUndo(run.id, prep.riders.map((r) => ({ riderId: r.id, runVehicleId: r.runVehicleId, stopOrder: r.stopOrder, pinned: r.pinned })),
          new Date(Date.now() + UNDO_MS).toISOString());
        for (const r of current) {
          const p = placed.get(r.id);
          if (!p || !unchanged(r)) continue;
          await bus.saveRunRider({ ...r, runVehicleId: p.runVehicleId, stopOrder: p.stopOrder, pinned: p.runVehicleId && r.runVehicleId ? r.pinned : false });
        }
        // Riders with no map pin keep their seat, after the solved stops.
        for (const id of carIds) {
          let n = [...placed.values()].filter((p) => p.runVehicleId === id).length;
          for (const r of current.filter((x) => x.runVehicleId === id && !x.snapPlaceId && unchanged(x))) await bus.saveRunRider({ ...r, stopOrder: ++n });
        }
        const live = new Map((await bus.listRunVehicles(run.id)).map((v) => [v.id, v]));
        for (const [id, leaderIds] of prep.filled) { const v = live.get(id); if (v) await bus.saveRunVehicle({ ...v, leaderIds }); }

        // Task 4: never leave exactly one girl among a fleet car's riders (siblings at the same
        // address excepted). Try once to re-solve movable (non-pinned, non fit-fixed) violators
        // into a car where they're not the odd one out; anyone still violating after that —
        // including one Google couldn't be asked about — goes to Unassigned.
        const carsOf = async () => {
          const rs = await bus.listRunRiders(run.id);
          const byCar = new Map<string, { id: string; gender: BusGender; placeId: string | null }[]>();
          for (const r of rs) {
            if (!r.runVehicleId || !carIds.includes(r.runVehicleId)) continue;
            (byCar.get(r.runVehicleId) ?? byCar.set(r.runVehicleId, []).get(r.runVehicleId)!)
              .push({ id: r.id, gender: r.snapGender, placeId: r.snapPlaceId });
          }
          return { rs, violators: loneGirls([...byCar.values()]) };
        };
        const stopIdx = new Map(prep.stopRiderIds.map((id, i) => [id, i]));
        const isFixed = (r: BusRunRider) => r.pinned || (stopIdx.has(r.id) && prep.problem.stops[stopIdx.get(r.id)!]!.allowedVehicles !== null);

        let { rs: lgRiders, violators: lgViolators } = await carsOf();
        let lgById = new Map(lgRiders.map((r) => [r.id, r]));
        const nonFixedViolators = lgViolators.filter((id) => !isFixed(lgById.get(id)!));
        const reSolvable = nonFixedViolators.filter((id) => stopIdx.has(id));
        let lgResult: SolveResult | null = null; // the re-solve's routes, when it ran — routeMin must match what was saved
        if (reSolvable.length) {
          const carIdx = new Map(carIds.map((id, i) => [id, i]));
          const stops2: SolveStop[] = prep.problem.stops.map((s, i) => {
            const rid = prep.stopRiderIds[i]!;
            if (!reSolvable.includes(rid)) return s;
            const exclude = carIdx.get(lgById.get(rid)!.runVehicleId!)!;
            return { ...s, allowedVehicles: carIds.map((_, k) => k).filter((k) => k !== exclude) };
          });
          let result2: SolveResult | null = null;
          try { result2 = await routing.solve({ ...prep.problem, stops: stops2 }, signal); }
          catch (err) { console.error('[bus] lone-girl re-solve skipped:', err instanceof Error ? err.message : err); }
          if (result2) {
            lgResult = result2;
            const placed2 = placementsFrom(result2, prep.stopRiderIds, carIds);
            const before2 = lgById;
            const unchanged2 = (r: BusRunRider) => { const b0 = before2.get(r.id); return !!b0 && b0.runVehicleId === r.runVehicleId && b0.pinned === r.pinned; };
            for (const r of await bus.listRunRiders(run.id)) {
              const p = placed2.get(r.id);
              if (!p || !unchanged2(r)) continue;
              await bus.saveRunRider({ ...r, runVehicleId: p.runVehicleId, stopOrder: p.stopOrder, pinned: p.runVehicleId && r.runVehicleId ? r.pinned : false });
            }
          }
        }
        ({ rs: lgRiders, violators: lgViolators } = await carsOf());
        lgById = new Map(lgRiders.map((r) => [r.id, r]));
        const touchedCars = new Set<string>();
        for (const id of lgViolators) {
          const r = lgById.get(id);
          if (!r || isFixed(r)) continue;
          if (r.runVehicleId) touchedCars.add(r.runVehicleId);
          await bus.saveRunRider({ ...r, runVehicleId: null, stopOrder: null, pinned: false });
        }
        for (const carId of touchedCars) {
          const left = (await bus.listRunRiders(run.id)).filter((x) => x.runVehicleId === carId).sort((a, b) => (a.stopOrder ?? 0) - (b.stopOrder ?? 0));
          for (const [i, r] of left.entries()) if (r.stopOrder !== i + 1) await bus.saveRunRider({ ...r, stopOrder: i + 1 });
        }
        const afterLoneGirl = new Map((await bus.listRunRiders(run.id)).map((r) => [r.id, r]));
        const loneGirl = nonFixedViolators.filter((id) => !afterLoneGirl.get(id)?.runVehicleId).length;

        await touch(ctx, run);
        // Task 1: count what was actually written, not the solver's optimistic plan — a rider
        // removed mid-solve (or bumped Unassigned by the lone-girl rule above) must not count as placed.
        const finalRiders = await bus.listRunRiders(run.id);
        const stopIdSet = new Set(prep.stopRiderIds);
        return {
          placed: finalRiders.filter((r) => stopIdSet.has(r.id) && r.runVehicleId).length,
          unassigned: finalRiders.filter((r) => !r.runVehicleId).length,
          noAddressPin: prep.untouched.length,
          routeMin: Object.fromEntries((lgResult ?? result).routes.map((rt) => [carIds[rt.vehicle]!, Math.round(rt.totalSec / 60)])
            .filter(([id]) => !touchedCars.has(String(id)))),
          loneGirl,
        };
      } finally {
        await bus.releaseLock(run.id, lockBy); // M1: only clears the lock if this generate still holds it
      }
    },
    async undo(ctx) {
      const c = await gate(ctx, 'bus:coordinate');
      const run = await writableRun(ctx, c);
      if (lockActive(run)) throw lockConflict(run);
      if (!run.undoSnapshot || !run.undoUntil || Date.parse(run.undoUntil) < Date.now()) throw new BadRequestError('Nothing to undo');
      const snap = new Map(run.undoSnapshot.map((e) => [e.riderId, e]));
      const rvs = await bus.listRunVehicles(run.id);
      const running = new Set(rvs.filter((v) => v.running).map((v) => v.id));
      const ownCarIds = new Set(rvs.filter((v) => v.ownerLeaderId).map((v) => v.id));
      for (const r of await bus.listRunRiders(run.id)) {
        const e = snap.get(r.id);
        if (!e) continue; // added after the generate — leave alone
        if (r.runVehicleId && ownCarIds.has(r.runVehicleId)) continue; // I2: never pull a rider out of someone's own car
        const car = e.runVehicleId && running.has(e.runVehicleId) ? e.runVehicleId : null;
        await bus.saveRunRider({ ...r, runVehicleId: car, stopOrder: car ? e.stopOrder : null, pinned: e.pinned });
      }
      await bus.setUndo(run.id, null, null);
      await touch(ctx, run);
    },
    async analysis(ctx) {
      const c = await gate(ctx, 'bus:analysis');
      const b = c.busMinistry;
      const run = await ensureRun(ctx, c);
      const signal = routingDeadline();
      const a = await analysisSolve(c, run, signal);
      // I5: one small matrix per car (its own distinct skip-leg origins/destinations), not
      // every car's legs mixed into shared 25-pair chunks — and cached on the solve itself,
      // so re-opening analysis for the same run version doesn't pay Google again.
      if (!a.secsByRoute) {
        const routeSkips = a.result.routes.map((route) =>
          skipPairs(route.stops.map((s) => a.problem.stops[s]!.point.placeId), b.churchPlaceId, a.problem.vehicles[route.vehicle]!.end?.placeId ?? null));
        try {
          a.secsByRoute = await Promise.all(routeSkips.map(async (skips) => {
            const real = skips.filter((p): p is { from: string; to: string } => !!p);
            if (!real.length) return skips.map(() => 0);
            const pairs = real.map((p) => ({ from: { placeId: p.from }, to: { placeId: p.to } }));
            const secs = await routing.matrix(pairs, signal);
            let i = 0;
            return skips.map((p) => (p ? secs[i++]! : 0));
          }));
        } catch (err) { throw routingFailed(err, ANALYSIS_FAILED); }
      }
      const cars = a.result.routes.map((route, k) => {
        const v = a.cars[route.vehicle]!;
        const d = detours(route.legsSec, a.secsByRoute![k]!);
        const riders = route.stops.map((s, i) => {
          const detourMin = Math.round(d[i]! / 60), detourPct = route.totalSec ? Math.round((d[i]! / route.totalSec) * 100) : 0;
          return { riderId: a.riders[s]!.id, name: a.riders[s]!.snapName, stop: i + 1, detourMin, detourPct,
            flagged: detourMin >= b.detourMin || detourPct >= b.detourPct };
        }).sort((x, y) => y.detourMin - x.detourMin || y.detourPct - x.detourPct);
        return { runVehicleId: v.id, name: v.name, colourIndex: v.colourIndex, routeMin: Math.round(route.totalSec / 60), riders };
      });
      return { version: run.version, detourMin: b.detourMin, detourPct: b.detourPct, cars,
        unassigned: (await bus.listRunRiders(run.id)).filter((r) => !r.runVehicleId).length,
        longestMin: Math.max(0, ...cars.map((x) => x.routeMin)), totalMin: sum(cars.map((x) => x.routeMin)) };
    },
    async extraCars(ctx, input) {
      const c = await gate(ctx, 'bus:analysis');
      const v = parseIn(ExtraCarsIn, input);
      if (!c.busMinistry.churchPlaceId) throw new BadRequestError(NO_CHURCH);
      const run = await ensureRun(ctx, c);
      const signal = routingDeadline();
      const prep = await prepareFleet(c, run, 'all');
      const church = { placeId: c.busMinistry.churchPlaceId };
      // Virtual cars: two leaders each (mixed, so no gender penalty), back to church. Nothing is saved.
      const problem: SolveProblem = { ...prep.problem, vehicles: [...prep.problem.vehicles,
        ...Array.from({ length: v.count }, () => ({ start: church, end: church, capacity: capacityOf(v.seats, 2) }))] };
      let now: AnalysisSolve, extra: SolveResult;
      try {
        [now, extra] = await Promise.all([analysisSolve(c, run, signal),
          problem.stops.length ? routing.solve(problem, signal) : Promise.resolve<SolveResult>({ routes: [], skipped: [] })]);
      } catch (err) { if (err instanceof AppError) throw err; throw routingFailed(err, ANALYSIS_FAILED); }
      const fleetNow = minutes(now.result, (k) => !!now.cars[k]!.vehicleId);
      const notSent = prep.riders.filter((r) => !r.runVehicleId && !r.snapPlaceId).length;
      return { count: v.count, seats: v.seats,
        before: { longestMin: Math.max(0, ...fleetNow), totalMin: sum(fleetNow), unassigned: prep.riders.filter((r) => !r.runVehicleId).length },
        after: { longestMin: Math.max(0, ...minutes(extra)), totalMin: sum(minutes(extra)), unassigned: extra.skipped.length + notSent } };
    },
    async analysisMap(ctx) {
      const c = await gate(ctx, 'bus:analysis');
      const run = await ensureRun(ctx, c);
      const signal = routingDeadline();
      const a = await analysisSolve(c, run, signal);
      const paths: MapPath[] = [], markers: MapMarker[] = [];
      for (const route of a.result.routes) {
        const colour = BUS_CAR_COLOURS[a.cars[route.vehicle]!.colourIndex % BUS_CAR_COLOURS.length]!;
        if (route.polyline) paths.push({ colour, polyline: thinPolyline(route.polyline, MAP_MAX_POINTS) });
        route.stops.forEach((_, i) => { // stop i sits at the end of the leg into it
          const pts = decodePolyline(route.legPolylines[i] ?? '');
          const at = pts[pts.length - 1];
          if (at) markers.push({ colour, label: markerLabel(i), lat: at.lat, lng: at.lng });
        });
      }
      // M5: an empty map (no riders placed yet) always 400s against the real Static Maps API —
      // fail fast with a clear message instead of paying for a guaranteed-failing Google call
      // and logging a [routing] map 400 on every open.
      if (!paths.length && !markers.length) throw new BadRequestError('No routes to show yet');
      try { return await routing.staticMap(paths, markers, signal); }
      catch (err) { throw routingFailed(err, ANALYSIS_FAILED); }
    },
  };
  return svc;
}
