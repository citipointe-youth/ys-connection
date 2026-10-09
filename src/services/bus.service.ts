import { z } from 'zod';
import { generateId } from '../utils/id';
import { can, canAccessStudent, type Action } from './access-control';
import { AppError, BadRequestError, ConflictError, ForbiddenError, ModuleDisabledError, NotFoundError } from '../core/errors/app-error';
import { currentRunDate, eligibilityOf, capacityOf, nameMatches, normName, riderKey, suburbOf, streetOf, phoneMatches, PURGE_DAYS, BUS_CAR_COLOURS } from './bus-logic';
import { autoFillPool, buildFleetProblem, buildSingleProblem, endPlaceOf, leaveIso, placementsFrom, skipPairs, detours, type FleetCar } from './bus-plan';
import { FakeRoutingProvider } from './routing/fake-routing-provider';
import { routingDeadline, RoutingError, type RoutingProvider, type PlaceSuggestion, type SolveProblem, type SolveResult,
  type MapImage, type MapMarker, type MapPath } from './routing/routing-provider';
import { decodePolyline, thinPolyline } from './routing/polyline';
import { markerLabel } from './routing/google-requests';
import type { IBusRepository, IStudentRepository, ILeaderRepository, ISettingsRepository, IConnectionRepository } from '../repositories/interfaces/entity-repositories';
import type { Actor } from '../core/entities/user';
import type { MinistryConfig } from '../core/ministry-config';
import type { BusRun, BusRunRider, BusRunVehicle, BusRunVehicleView, BusRiderView, BusSearchHit, BusGender,
  BusLeaderView, BusAddress, BusRunView, MyCarView, PendingGuestView, BusOwnCar, BusVehicle, BusConsent, BusGenerateResult,
  BusAnalysisView, BusExtraCarsView, BusExtraCarsCar, BusPastRiderView } from '../core/entities/bus';

export interface BusCtx { actor: Actor; asLeaderId: string | null; localNow: string }

export interface BusService {
  getRun(ctx: BusCtx): Promise<BusRunView>;
  getVersion(ctx: BusCtx): Promise<{ runId: string; version: number }>;
  search(ctx: BusCtx, q: string): Promise<BusSearchHit[]>;
  riderAddresses(ctx: BusCtx, riderId: string): Promise<BusSearchHit['addresses']>;
  personAddresses(ctx: BusCtx, who: { studentId?: string; guestId?: string }): Promise<BusSearchHit['addresses']>;
  deleteRiderAddress(ctx: BusCtx, riderId: string, addressId: string): Promise<void>;
  deletePastRider(ctx: BusCtx, who: { studentId?: string; guestId?: string }): Promise<void>;
  saveMyCarStops(ctx: BusCtx, input: unknown): Promise<BusRunVehicleView>;
  optimiseMyCar(ctx: BusCtx): Promise<BusRunVehicleView>;
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
const PHONE_CHARS_RE = /^[0-9 +()-]*$/;
// Task 5 (owner): phone is now optional on a New Person — an omitted/blank value stores as
// null (no phone at all is a real case: a walk-in with no number given). If one IS given, it
// must still look like a phone (digits/space/+/()/- only) and have >=8 digits once those
// separators are stripped, or the add is rejected with "Check the phone number".
const NewGuest = z.object({
  firstName: z.string().trim().min(1).max(60).regex(NAME_RE, 'Invalid name'),
  lastName: z.string().trim().min(1).max(60).regex(NAME_RE, 'Invalid name'),
  grade: z.number().int().nullable(), gender: z.enum(['male', 'female']),
  phone: z.string().trim().max(20).nullable().optional()
    .transform((v) => (v && v.length > 0 ? v : null))
    .refine((v) => v === null || (PHONE_CHARS_RE.test(v) && v.replace(/[\s+()-]/g, '').length >= 8), 'Check the phone number'),
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
// Own-car "add someone" (owner, 2026-10-07): a junior leader without bus:roster can still add a
// brand-new rider into THEIR OWN car — same shapes addRider/createGuest already validate, just
// bundled onto the own-car save so one bus:use-gated call does both (see placeRider below).
const OwnCarNewRider = z.object({
  studentId: z.string().min(1).optional(), guestId: z.string().min(1).optional(), newPerson: NewGuest.optional(),
  addressId: z.string().min(1).optional(), newAddress: NewAddress.optional(),
}).refine((v) => [v.studentId, v.guestId, v.newPerson].filter((x) => x !== undefined).length === 1, 'Choose a student or a new person')
  .refine((v) => !!v.addressId !== !!v.newAddress, 'Choose an address');
const OwnCarIn = z.object({ car: z.object({ name: z.string().trim().min(1).max(40), seats: z.number().int().min(2).max(15),
  plate: z.string().max(12).nullable().default(null), ...EndsFields }), riderIds: z.array(z.string()),
  newRiders: z.array(OwnCarNewRider).default([]) });
const MoveIn = z.object({ runVehicleId: z.string().nullable().optional(), unpin: z.boolean().optional() })
  .refine((v) => v.unpin === true || v.runVehicleId !== undefined, 'runVehicleId required');
// Task A (owner, 2026-10-08): "Edit my car" reorder/remove — riderIds is the NEW order of
// everyone staying, removeIds is who's coming off (their union must equal the car's current
// riders exactly, checked in the handler, not here).
const MyCarStopsIn = z.object({ riderIds: z.array(z.string()), removeIds: z.array(z.string()) });
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
const PAST_RIDERS_CAP = 50;

function routingFailed(err: unknown, message = GENERATE_FAILED): AppError {
  console.error('[bus] routing failed:', err instanceof Error ? err.message : err);
  return new AppError('ROUTING_FAILED', message, 502);
}
// Task 4 (owner): a genuine network/5xx/timeout failure still gets the generic "can't reach
// Google" message above — this only fires when Google named a SPECIFIC placeId it (and Place
// Details) couldn't locate, which is a bad saved address, not an outage. Maps it back to the
// rider/vehicle/church it belongs to for a fixable message. Never logs the decrypted address —
// only the name/label and the opaque placeId.
interface BadPlaceContext { riders: { snapPlaceId: string | null; snapName: string }[]; cars: { name: string; endPlaceId: string | null }[]; churchPlaceId: string | null }
function badPlaceLabel(placeId: string, ctx: BadPlaceContext): string | null {
  if (ctx.churchPlaceId && placeId === ctx.churchPlaceId) return 'the church address';
  const r = ctx.riders.find((x) => x.snapPlaceId === placeId);
  if (r) return `${r.snapName}'s address`;
  const v = ctx.cars.find((c) => c.endPlaceId === placeId);
  if (v) return `${v.name} end address`;
  return null;
}
function routingFailedFor(err: unknown, fallbackMessage: string, ctx: BadPlaceContext): AppError {
  if (err instanceof RoutingError && err.badPlaceId) {
    const label = badPlaceLabel(err.badPlaceId, ctx);
    if (label) {
      console.error('[bus] routing failed: Google cannot locate a saved address (placeId only, never logged)');
      return new AppError('ROUTING_BAD_ADDRESS', `Google can't locate ${label} — re-pick it from the suggestions (Fix address).`, 422);
    }
  }
  return routingFailed(err, fallbackMessage);
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
// Task 8: startIso labels local leave time as literal UTC (see leaveIso in bus-plan.ts) — read
// the clock back the same way (UTC getters), or this would double-shift by the server's TZ.
const hhmmAt = (startIso: string, addSec: number): string => new Date(Date.parse(startIso) + addSec * 1000).toISOString().slice(11, 16);

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
  routing: RoutingProvider = new FakeRoutingProvider(), connections?: IConnectionRepository): BusService {

  async function cfg(): Promise<MinistryConfig> { return (await settingsRepo.getSettings()).ministryConfig; }

  // I4: once the real Google provider is live, a "fake:" place ID (only ever produced by the
  // dev/test fallback provider) must never be persisted — Google 400s on it with no clue why.
  // Task 2 (owner): `required` rejects a null/missing placeId too — a brand-new address (rider,
  // vehicle/own-car end address) must come from a real suggestion, not be typed/left blank. An
  // EXISTING saved address (looked up by addressId) never goes through this check at all.
  function assertRealPlaceId(placeId: string | null | undefined, required = false): void {
    if (routing.name === 'google' && placeId?.startsWith('fake:'))
      throw new BadRequestError('That address needs to be re-picked from the search results');
    if (required && !placeId) throw new BadRequestError('Pick the address from the suggestions list');
  }

  /** Module gate (no visibility setting since 2026-10-09 — every login sees Bus) + coordinator elevation. Returns the effective permission check. */
  async function gate(ctx: BusCtx, action: Action): Promise<MinistryConfig> {
    const c = await cfg();
    if (!c.modules.busMinistry) throw new ModuleDisabledError('Bus Ministry');
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
    const [all, riders] = await Promise.all([leaders.findAll(), bus.listRunRiders(runId)]);
    const byId = new Map(all.map((l) => [l.id, l]));
    // I7: count/name only leaders that still exist — a leader deleted mid-run must not show
    // as a "Leader" placeholder chip with an unknown-gender eligibility, or be deducted from
    // capacity at all.
    return (await bus.listRunVehicles(runId)).map((v) => {
      const leaderIds = v.leaderIds.filter((id) => byId.has(id));
      const eligibility = eligibilityOf(leaderIds.map((id) => genderOf(byId.get(id)?.gender ?? null)));
      // Task 7 (owner): replaces the old "Only 1 girl" chip — flags a car holding >=1 girl
      // rider with no female leader. Hand placement (Move) doesn't enforce the hard rule, so
      // this is purely informational for the run view.
      const hasGirl = riders.some((r) => r.runVehicleId === v.id && r.snapGender === 'female');
      return {
        ...v, leaderIds, capacity: capacityOf(v.seats, leaderIds.length), eligibility,
        leaderNames: leaderIds.map((id) => byId.get(id)!.fullName),
        needsFemaleLeader: hasGirl && !eligibility.female,
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
      pastRiders: isPast(run, ctx, c) ? [] : await pastRidersList(ctx, c, riders),
      onCarLeaders: await onCarLeaderList(run.id),
    };
  }

  // Task 10 (owner): leaders on a car THIS week — any running run-vehicle's leaderIds plus an
  // own-car's ownerLeaderId — names + ids only, deliberately unscoped by grade/quad so the "who
  // are you" picker can offer a leader outside the login's own scope.
  async function onCarLeaderList(runId: string): Promise<{ id: string; name: string }[]> {
    const [rvs, all] = await Promise.all([bus.listRunVehicles(runId), leaders.findAll()]);
    const byId = new Map(all.map((l) => [l.id, l]));
    const ids = new Set<string>();
    for (const v of rvs.filter((v) => v.running)) {
      for (const id of v.leaderIds) if (byId.has(id)) ids.add(id);
      if (v.ownerLeaderId && byId.has(v.ownerLeaderId)) ids.add(v.ownerLeaderId);
    }
    return [...ids].map((id) => ({ id, name: byId.get(id)!.fullName })).sort((a, b) => a.name.localeCompare(b.name));
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
    // Task 2 (owner): a brand-new address must come from a real suggestion, every time.
    assertRealPlaceId(n.placeId, true);
    // Task 3 (owner): default a blank label to the street part, not the suburb, so it's useful
    // when offered back for future selection (e.g. "3 Lindsay Court", not "Carina").
    const label = n.label.trim() || streetOf(n.address);
    return bus.saveAddress({ id: generateId(), studentId: owner.studentId ?? null, guestId: owner.guestId ?? null,
      label, address: n.address, placeId: n.placeId, lastUsedAt: nowIso(), createdAt: nowIso() });
  }

  // Create-or-update a rider row for a student/guest on `run`, exactly as the Students-tab
  // "add a rider" flow does (resolveAddress + the race-safe upsert) — shared by addRider and
  // own-car's newRiders so a junior leader's own-car search adds someone the same way bus:roster
  // does. Caller already gated/locked/parsed; this is pure write logic, no touch() (caller's job).
  async function placeRider(ctx: BusCtx, run: BusRun,
    v: { studentId?: string; guestId?: string; addressId?: string; newAddress?: { label: string; address: string; placeId: string | null } }): Promise<BusRunRider> {
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
    if (existing) return bus.saveRunRider({ ...existing, ...patch });
    try {
      return await bus.saveRunRider({ id: generateId(), runId: run.id, runVehicleId: null, stopOrder: null,
        pinned: false, addedBy: await whoLabel(ctx), addedAt: nowIso(), droppedAt: null, droppedBy: null, ...patch });
    } catch (err) {
      // Two leaders adding the same student/guest at once — see addRider's original comment
      // (same race, same fix): re-read and merge onto the winner's row.
      if ((err as { code?: string }).code !== '23505') throw err;
      const again = (await bus.listRunRiders(run.id)).find((r) => (v.studentId ? r.studentId === v.studentId : r.guestId === v.guestId));
      if (!again) throw err;
      return bus.saveRunRider({ ...again, ...patch });
    }
  }

  async function pendingGuestList(): Promise<PendingGuestView[]> {
    const all = await students.findAll();
    return (await bus.listGuests()).filter((g) => !g.linkedStudentId && !g.dismissed).map((g) => {
      // Task 2 (owner): also suggest a student whose OWN mobile or parent phone matches the
      // guest's phone — ranked first (a phone match is stronger evidence than a name match),
      // deduped against the name-based matches below.
      const byPhone = all.filter((s) => phoneMatches(g.phone, s.mobile) || phoneMatches(g.phone, s.parentPhone));
      const phoneIds = new Set(byPhone.map((s) => s.id));
      const byName = all.filter((s) => !phoneIds.has(s.id) && normName(s.lastName) === normName(g.lastName)
          && (normName(s.firstName).startsWith(normName(g.firstName)) || normName(g.firstName).startsWith(normName(s.firstName))));
      return {
        id: g.id, name: `${g.firstName} ${g.lastName}`, grade: g.grade, phone: g.phone, createdAt: g.createdAt,
        suggestions: [
          ...byPhone.map((s) => ({ studentId: s.id, name: `${s.firstName} ${s.lastName}`, grade: s.grade, byPhone: true })),
          ...byName.map((s) => ({ studentId: s.id, name: `${s.firstName} ${s.lastName}`, grade: s.grade, byPhone: false })),
        ],
      };
    });
  }

  // Owner request: people with a saved address (student or not-yet-purged guest) who are NOT
  // on tonight's roster, most recent rider first. True "latest bus_run_riders.added_at" would
  // mean scanning every past run's riders — not cheap once a few terms of history pile up — so
  // this uses the address's lastUsedAt instead: resolveAddress() already bumps it to "now"
  // every time that address is used to add/update a rider, so in practice it tracks the same
  // moment. Ties (never-ridden-again addresses created at the same time) break on name.
  async function pastRidersList(ctx: BusCtx, c: MinistryConfig, riders: BusRunRider[]): Promise<BusPastRiderView[]> {
    if (!allowed(ctx, c, 'bus:roster')) return [];
    const onRun = new Set(riders.map(riderKey));
    const [addresses, guests, allStudents] = await Promise.all([bus.listAllAddresses(), bus.listGuests(), students.findAll()]);
    const guestById = new Map(guests.map((g) => [g.id, g]));
    const studentById = new Map(allStudents.map((s) => [s.id, s]));
    const latest = new Map<string, BusAddress>(); // owner key → their most-recently-used address
    for (const a of addresses) {
      const key = riderKey(a);
      const cur = latest.get(key);
      if (!cur || a.lastUsedAt > cur.lastUsedAt) latest.set(key, a);
    }
    const out: (BusPastRiderView & { lastUsedAt: string })[] = [];
    for (const [key, addr] of latest) {
      if (onRun.has(key)) continue;
      if (addr.studentId) {
        const s = studentById.get(addr.studentId);
        if (!s) continue;
        out.push({ studentId: s.id, guestId: null, addressId: addr.id, name: `${s.firstName} ${s.lastName}`,
          grade: s.grade, suburb: suburbOf(addr.address), lastUsedAt: addr.lastUsedAt });
      } else if (addr.guestId) {
        const g = guestById.get(addr.guestId);
        if (!g) continue; // purged, or never existed
        out.push({ studentId: null, guestId: g.id, addressId: addr.id, name: `${g.firstName} ${g.lastName}`,
          grade: g.grade, suburb: suburbOf(addr.address), lastUsedAt: addr.lastUsedAt });
      }
    }
    out.sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt) || a.name.localeCompare(b.name));
    return out.slice(0, PAST_RIDERS_CAP).map(({ lastUsedAt, ...rest }) => rest);
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
    const filled = autoFillPool(cars.map((v) => ({ id: v.id, seats: v.seats, leaderIds: known(v.leaderIds),
      fixedRiders: fixedCount.get(v.id) ?? 0, endsAt: v.endsAt })), // Task 9: don't maroon a pool leader in a car that ends at a drop-off address
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
  // Task 4: was a single module-level slot (lastAnalysis), which thrashed when two different
  // runs (or two settings-driven keys for the same run) were analysed concurrently — the second
  // request's cache write clobbered the first's, so re-opening analysis for the first run paid
  // Google again every time. A small capped Map keeps the last few keys instead; same key
  // semantics as before (see M6's comment), just no longer limited to exactly one.
  const ANALYSIS_CACHE_MAX = 5;
  const analysisCache = new Map<string, AnalysisSolve>();
  async function analysisSolve(c: MinistryConfig, run: BusRun, signal: AbortSignal): Promise<AnalysisSolve> {
    const b = c.busMinistry;
    // M6: a Bus-settings change (church, leave time, target route length) doesn't bump the run
    // version, so without these in the key a warm instance would keep serving the old solve/map.
    const key = `${run.id}:${run.version}:${b.churchPlaceId}:${b.leaveTime}:${b.targetRouteMin}`;
    const cached = analysisCache.get(key);
    if (cached) return cached;
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
    const badPlaceCtx: BadPlaceContext = { riders, cars: cars.map((v) => ({ name: v.name, endPlaceId: endPlaceOf(v.endsAt, v.endsPlaceId, b.churchPlaceId) })), churchPlaceId: b.churchPlaceId };
    try { result = problem.stops.length ? await routing.solve(problem, signal) : { routes: [], skipped: [] }; }
    catch (err) { throw routingFailedFor(err, ANALYSIS_FAILED, badPlaceCtx); }
    const entry: AnalysisSolve = { key, cars, riders, problem, result };
    analysisCache.set(key, entry);
    if (analysisCache.size > ANALYSIS_CACHE_MAX) {
      const oldest = analysisCache.keys().next().value;
      if (oldest !== undefined) analysisCache.delete(oldest);
    }
    return entry;
  }
  const minutes = (r: SolveResult, keep: (vehicle: number) => boolean = () => true) =>
    r.routes.filter((x) => keep(x.vehicle)).map((x) => Math.round(x.totalSec / 60));
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  const svc: BusService = {
    async getRun(ctx) {
      const c = await gate(ctx, 'bus:use');
      // Best-effort housekeeping: one failed delete must not fail the whole Bus screen load.
      try { await purgeGuests(); } catch (err) { console.error('purgeGuests: failed', err); }
      return buildView(ctx, c, await ensureRun(ctx, c));
    },
    async getVersion(ctx) {
      const c = await gate(ctx, 'bus:use');
      const run = await ensureRun(ctx, c);
      return { runId: run.id, version: run.version };
    },
    // The edit-rider sheet's saved addresses, by rider — the current one first. (Was a name
    // search, which missed riders past the 5-guest cap or with a common name.)
    async riderAddresses(ctx, riderId) {
      await gate(ctx, 'bus:roster');
      const r = await bus.getRunRider(riderId);
      if (!r) throw new NotFoundError('Rider not found');
      const addrs = await bus.listAddresses(r.studentId ? { studentId: r.studentId } : { guestId: r.guestId! });
      return addrs.sort((a, b) => Number(b.id === r.addressId) - Number(a.id === r.addressId))
        .map((a) => ({ id: a.id, label: a.label, suburb: suburbOf(a.address), street: streetOf(a.address) }));
    },
    // Edit-rider sheet: forget one of the rider's saved addresses (owner, 2026-10-07). Task D
    // (owner, 2026-10-08): the current one can be deleted too — the rider stays on tonight's run
    // but with no place at all: no address, no map pin, taken out of any car (never
    // auto-assigned again — Generate/Fit in/Try +N cars all skip a rider with no snapPlaceId,
    // same as the existing "no map pin" case). A past run's rider has no live state to update.
    async deleteRiderAddress(ctx, riderId, addressId) {
      const c = await gate(ctx, 'bus:roster');
      const r = await bus.getRunRider(riderId);
      if (!r) throw new NotFoundError('Rider not found');
      const a = await bus.getAddress(addressId);
      if (!a || (r.studentId ? a.studentId !== r.studentId : a.guestId !== r.guestId)) throw new NotFoundError('Address not found');
      if (r.addressId !== addressId) { await bus.deleteAddress(addressId); return; }
      const run = await writableRun(ctx, c);
      if (r.runId !== run.id) { await bus.deleteAddress(addressId); return; }
      if (lockActive(run)) throw lockConflict(run); // a solve in flight is using this rider's current pin
      await bus.deleteAddress(addressId);
      await bus.saveRunRider({ ...r, addressId: null, snapPlaceId: null, snapAddress: '', runVehicleId: null, stopOrder: null, pinned: false });
      await bus.setUndo(run.id, null, null); // I2: this rider just left their car — a later Undo must not pull them back
      await touch(ctx, run);
    },
    // Task C (owner, 2026-10-08): trash a "Past riders" row — forgets every saved address for
    // this person (so they drop out of the list) and, if they're an unlinked guest, deletes the
    // guest too (same reasoning removeRider uses for an orphaned walk-in). Refused if they're on
    // tonight's run — that's not what this button is for.
    async deletePastRider(ctx, who) {
      const c = await gate(ctx, 'bus:roster');
      if (!who.studentId === !who.guestId) throw new BadRequestError('Give a studentId or a guestId');
      const run = await ensureRun(ctx, c);
      const onTonight = (await bus.listRunRiders(run.id)).some((r) => (who.studentId ? r.studentId === who.studentId : r.guestId === who.guestId));
      if (onTonight) throw new BadRequestError("They're on tonight's run — remove them from there first");
      await bus.deleteAddressesOf(who);
      if (who.guestId) {
        const g = await bus.getGuest(who.guestId);
        if (g && !g.linkedStudentId) await bus.deleteGuest(who.guestId);
      }
    },
    // Past riders' "confirm address" sheet — a person's saved addresses, most recently used first.
    async personAddresses(ctx, who) {
      await gate(ctx, 'bus:roster');
      if (!who.studentId === !who.guestId) throw new BadRequestError('Give a studentId or a guestId');
      const addrs = await bus.listAddresses(who.studentId ? { studentId: who.studentId } : { guestId: who.guestId! });
      return addrs.sort((a, b) => (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? ''))
        .map((a) => ({ id: a.id, label: a.label, suburb: suburbOf(a.address), street: streetOf(a.address) }));
    },
    // Owner (2026-10-07): "Your car"'s add-someone search must work for any bus:use login,
    // including a junior `leader` who lacks bus:roster — they can only ever place a search hit
    // into their OWN car (saveOwnCar below), never the Students tab (still bus:roster-gated in
    // the SPA), but the lookup itself is the same name/grade/gender + saved-address data either
    // way, so this gate is simply widened rather than duplicating a second search method.
    // Actors without bus:roster (the junior `leader`) only see students they may access — a leader's
    // own connected students — and no street/address info; guests (walk-ins) stay searchable.
    async search(ctx, q) {
      const c = await gate(ctx, 'bus:use');
      if (q.trim().length < 2) return [];
      const full = allowed(ctx, c, 'bus:roster');
      let pool = (await students.findAll()).filter((s) => nameMatches(q, s.firstName, s.lastName));
      if (!full) {
        if (ctx.actor.role === 'leader') {
          const mine = new Set(ctx.actor.leaderId && connections ? (await connections.findByLeader(ctx.actor.leaderId)).map((x) => x.studentId) : []);
          pool = pool.filter((s) => mine.has(s.id));
        } else pool = pool.filter((s) => canAccessStudent(ctx.actor, s.grade, s.gender, c.structure));
      }
      const addrsOf = async (who: { studentId: string } | { guestId: string }) =>
        full ? (await bus.listAddresses(who)).map((a) => ({ id: a.id, label: a.label, suburb: suburbOf(a.address), street: streetOf(a.address) })) : [];
      // Task 3 (owner): `street` is always the decrypted address's street part — a display
      // fallback for an address saved before the default-label fix, when `label` is still blank.
      const studentHits = await Promise.all(pool.slice(0, 15).map(async (s): Promise<BusSearchHit> => ({
        kind: 'student', id: s.id, name: `${s.firstName} ${s.lastName}`, grade: s.grade, gender: genderOf(s.gender), addresses: await addrsOf({ studentId: s.id }) })));
      const guestHits = await Promise.all((await bus.listGuests()).filter((g) => !g.linkedStudentId && nameMatches(q, g.firstName, g.lastName)).slice(0, 5)
        .map(async (g): Promise<BusSearchHit> => ({ kind: 'guest', id: g.id, name: `${g.firstName} ${g.lastName}`, grade: g.grade, gender: g.gender, addresses: await addrsOf({ guestId: g.id }) })));
      return [...studentHits, ...guestHits];
    },
    async addRider(ctx, input) {
      const c = await gate(ctx, 'bus:roster');
      const v = parseIn(AddRider, input);
      const run = await writableRun(ctx, c);
      if (lockActive(run)) throw lockConflict(run); // a solve in flight is working off this run's current roster
      const rider = await placeRider(ctx, run, v);
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
      // Task 5 (owner): "New Person" is a guest, not a platform student. If this was their last
      // bus_run_riders row in ANY run (and they were never linked to a real student), fully
      // delete the guest + their saved addresses so "Pending new people" drops accordingly —
      // students are never deleted here, only guests nobody will ever add back.
      if (r.guestId) {
        const g = await bus.getGuest(r.guestId);
        if (g && !g.linkedStudentId) {
          let stillRides = false;
          for (const other of await bus.listRuns()) {
            if ((await bus.listRunRiders(other.id)).some((x) => x.guestId === r.guestId)) { stillRides = true; break; }
          }
          if (!stillRides) await bus.deleteGuest(r.guestId);
        }
      }
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
      assertRealPlaceId(v.endsPlaceId, v.endsAt === 'address'); // Task 2: required only when this save actually picks "ends at an address"
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
      assertRealPlaceId(v.endsPlaceId, v.endsAt === 'address'); // Task 2: required only when this patch sets "ends at an address"
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
      const leader = await leaders.findById(me);
      if (!leader) throw new NotFoundError('Leader not found');
      const v = parseIn(OwnCarIn, input);
      assertRealPlaceId(v.car.endsPlaceId, v.car.endsAt === 'address'); // Task 2: required only when ending at an address
      const run = await writableRun(ctx, c);
      if (lockActive(run)) throw lockConflict(run); // a solve in flight is working off this run's current roster
      // Owner (2026-10-07): newRiders are created here, inside the SAME bus:use-gated call and
      // under the SAME lock check above — a junior leader with no bus:roster places someone new
      // straight into their own car via placeRider (addRider's shared internals). Anyone already
      // on tonight's run is left alone and just folded into riderIds below, never re-written.
      let riders = await bus.listRunRiders(run.id);
      // Fail fast BEFORE creating any guest/rider, so a rejected save leaves nothing behind.
      for (const id of v.riderIds) if (!riders.some((r) => r.id === id)) throw new NotFoundError('Rider not found');
      if (v.riderIds.length + v.newRiders.length > capacityOf(v.car.seats, 1)) throw new BadRequestError(`${v.car.name} only has ${capacityOf(v.car.seats, 1)} seats`);
      const newRiderIds: string[] = [];
      for (const nr of v.newRiders) {
        let studentId = nr.studentId, guestId = nr.guestId;
        if (nr.newPerson) {
          const g = await bus.saveGuest({ id: generateId(), firstName: nr.newPerson.firstName, lastName: nr.newPerson.lastName,
            grade: nr.newPerson.grade, gender: nr.newPerson.gender, phone: nr.newPerson.phone,
            linkedStudentId: null, dismissed: false, createdAt: nowIso(), lastRiddenAt: null });
          guestId = g.id;
        }
        const already = riders.find((r) => (studentId ? r.studentId === studentId : r.guestId === guestId));
        if (already) { newRiderIds.push(already.id); continue; }
        const rider = await placeRider(ctx, run, { studentId, guestId, addressId: nr.addressId, newAddress: nr.newAddress });
        riders = [...riders, rider];
        newRiderIds.push(rider.id);
      }
      const riderIds = [...v.riderIds, ...newRiderIds];
      // I6: validate BEFORE writing the car — the old order saved the car first and only
      // then checked capacity/rider ids, leaving a created-or-resized car behind on a 400/404.
      const byId = new Map(riders.map((r) => [r.id, r]));
      for (const id of riderIds) if (!byId.has(id)) throw new NotFoundError('Rider not found');
      if (riderIds.length > capacityOf(v.car.seats, 1)) throw new BadRequestError(`${v.car.name} only has ${capacityOf(v.car.seats, 1)} seats`);
      const rvs = await bus.listRunVehicles(run.id);
      const prior = rvs.find((x) => x.ownerLeaderId === me);
      const rv = await bus.saveRunVehicle({ id: prior?.id ?? generateId(), runId: run.id, vehicleId: null, ownerLeaderId: me,
        name: v.car.name, seats: v.car.seats, plate: v.car.plate, running: true, leaderIds: [me],
        endsAt: v.car.endsAt, endsAddress: v.car.endsAddress, endsPlaceId: v.car.endsPlaceId,
        colourIndex: prior?.colourIndex ?? rvs.length });
      for (const r of riders.filter((r) => r.runVehicleId === rv.id && !riderIds.includes(r.id)))
        await bus.saveRunRider({ ...r, runVehicleId: null, stopOrder: null, pinned: false });
      for (const [i, id] of riderIds.entries()) {
        await bus.saveRunRider({ ...byId.get(id)!, runVehicleId: rv.id, stopOrder: i + 1, pinned: true });
      }
      await reorderCar(c, run, rv);
      const prefs = (await bus.getLeaderPrefs(me)) ?? { id: me, inPool: false, fixedVehicleId: null, ownCar: null, lastOwnRiderKeys: [], prefGrades: [] };
      await bus.saveLeaderPrefs({ ...prefs, ownCar: v.car as BusOwnCar,
        lastOwnRiderKeys: riders.filter((r) => riderIds.includes(r.id)).map(riderKey) });
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
    // Task A (owner, 2026-10-08): "Edit my car" on the My car tab — the acting leader (fleet
    // leader or own-car owner) reorders/removes stops on THEIR car by hand. Unlike removeRider,
    // an unlinked guest taken off here is never hard-deleted — they're meant to reappear in the
    // Students tab's Past riders, same as anyone else taken off a car (their saved address is
    // untouched). Order is exactly what's given — no re-solve — so it sticks until the rider's
    // car/pin changes some other way (a later Generate/Fit in can still re-sequence a pinned
    // rider's stop within their fixed car, same as Move already allows).
    async saveMyCarStops(ctx, input) {
      const c = await gate(ctx, 'bus:use');
      const me = selfLeaderId(ctx);
      if (!me) throw new BadRequestError('Choose who you are first');
      const v = parseIn(MyCarStopsIn, input);
      const run = await writableRun(ctx, c);
      if (lockActive(run)) throw lockConflict(run);
      const views = await vehicleViews(run.id);
      const vehicle = views.find((x) => x.running && (x.ownerLeaderId === me || x.leaderIds.includes(me)));
      if (!vehicle) throw new NotFoundError('Car not found');
      const inCar = (await bus.listRunRiders(run.id)).filter((r) => r.runVehicleId === vehicle.id);
      const currentIds = new Set(inCar.map((r) => r.id));
      const given = [...v.riderIds, ...v.removeIds];
      const givenSet = new Set(given);
      if (givenSet.size !== given.length || givenSet.size !== currentIds.size || [...givenSet].some((id) => !currentIds.has(id)))
        throw new ConflictError('Your car changed — refresh');
      const byId = new Map(inCar.map((r) => [r.id, r]));
      for (const [i, id] of v.riderIds.entries()) await bus.saveRunRider({ ...byId.get(id)!, stopOrder: i + 1, pinned: true });
      for (const id of v.removeIds) await bus.deleteRunRider(id); // never hard-deletes a guest — see comment above
      await bus.setUndo(run.id, null, null);
      await touch(ctx, run);
      return (await vehicleViews(run.id)).find((x) => x.id === vehicle.id)!;
    },
    // My car "Reset to optimal order": re-solve the stop order of the acting leader's car.
    async optimiseMyCar(ctx) {
      const c = await gate(ctx, 'bus:use');
      const me = selfLeaderId(ctx);
      if (!me) throw new BadRequestError('Choose who you are first');
      const run = await writableRun(ctx, c);
      if (lockActive(run)) throw lockConflict(run);
      const rv = (await bus.listRunVehicles(run.id)).find((x) => x.running && (x.ownerLeaderId === me || x.leaderIds.includes(me)));
      if (!rv) throw new NotFoundError('Car not found');
      await reorderCar(c, run, rv);
      await touch(ctx, run);
      return (await vehicleViews(run.id)).find((x) => x.id === rv.id)!;
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
      if (lockActive(run)) throw lockConflict(run); // Task 3: same rider-write guard as addRider/updateRider/removeRider
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
      return { vehicle, stops, churchAddress: c.busMinistry.churchAddress, churchPlaceId: c.busMinistry.churchPlaceId, ownCarDraft,
        onCarLeaders: await onCarLeaderList(run.id) };
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
      try { return await routing.autocomplete(input, token, 'au', routingDeadline()); }
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
      // Task 1: one shared deadline for every Google solve this generate() call makes.
      const signal = routingDeadline(GENERATE_SOLVE_BUDGET_MS);
      try {
        const prep = await prepareFleet(c, run, mode);
        if (!prep.problem.vehicles.length) throw new BadRequestError('Turn on at least one car in Car setup');
        let result: SolveResult;
        try { result = prep.problem.stops.length ? await routing.solve(prep.problem, signal) : { routes: [], skipped: [] }; }
        catch (err) {
          throw routingFailedFor(err, GENERATE_FAILED, { riders: prep.riders,
            cars: prep.cars.map((v, i) => ({ name: v.name, endPlaceId: prep.problem.vehicles[i]?.end?.placeId ?? null })),
            churchPlaceId: c.busMinistry.churchPlaceId });
        }
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

        // Task 7 (owner, replaces the old lone-girl rule): buildFleetProblem already made it a
        // HARD constraint that a non-fixed girl can only be placed in a car with >=1 female
        // leader, so the solver itself never places one elsewhere — nothing left to re-solve
        // here. Just count the non-fixed girls who ended up with no car.
        const byId = new Map(prep.riders.map((r) => [r.id, r]));
        const carIdx = new Map(carIds.map((id, i) => [id, i]));
        const nonFixedGirlIds = prep.stopRiderIds.filter((id) => {
          const r = byId.get(id);
          if (!r || r.snapGender !== 'female') return false;
          const own = r.runVehicleId != null ? carIdx.get(r.runVehicleId) : undefined;
          return !(own !== undefined && (r.pinned || mode === 'fit'));
        });

        await touch(ctx, run);
        // Task 1: count what was actually written, not the solver's optimistic plan — a rider
        // removed mid-solve must not count as placed.
        const finalRiders = await bus.listRunRiders(run.id);
        const finalById = new Map(finalRiders.map((r) => [r.id, r]));
        const stopIdSet = new Set(prep.stopRiderIds);
        return {
          placed: finalRiders.filter((r) => stopIdSet.has(r.id) && r.runVehicleId).length,
          unassigned: finalRiders.filter((r) => !r.runVehicleId).length,
          noAddressPin: prep.untouched.length,
          routeMin: Object.fromEntries(result.routes.map((rt) => [carIds[rt.vehicle]!, Math.round(rt.totalSec / 60)])),
          noFemaleLeader: nonFixedGirlIds.filter((id) => !finalById.get(id)?.runVehicleId).length,
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
      const c = await gate(ctx, 'bus:coordinate'); // coordinators run the night, so they get route analysis (Past nights stay bus:analysis)
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
        } catch (err) {
          throw routingFailedFor(err, ANALYSIS_FAILED, { riders: a.riders,
            cars: a.cars.map((car) => ({ name: car.name, endPlaceId: endPlaceOf(car.endsAt, car.endsPlaceId, b.churchPlaceId) })), churchPlaceId: b.churchPlaceId });
        }
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
      const c = await gate(ctx, 'bus:coordinate'); // coordinators run the night, so they get route analysis (Past nights stay bus:analysis)
      const v = parseIn(ExtraCarsIn, input);
      if (!c.busMinistry.churchPlaceId) throw new BadRequestError(NO_CHURCH);
      const run = await ensureRun(ctx, c);
      const signal = routingDeadline();
      const prep = await prepareFleet(c, run, 'all');
      const church = { placeId: c.busMinistry.churchPlaceId };
      // Task 7 follow-up (owner): buildFleetProblem already hard-restricted a non-fixed girl's
      // stop to the real fleet's female-eligible cars — but a virtual "Extra car" doesn't exist
      // yet in that list. Owner ruling: a hypothetical extra car counts as having a female
      // leader (they're unstaffed what-ifs), so splice the new virtual indices into any such
      // restricted stop too. A girl PINNED to a real car (own !== undefined && pinned) stays
      // fixed to that physical car in this hypothetical, same as every other pinned rider.
      const realCarIdx = new Map(prep.cars.map((car, i) => [car.id, i]));
      const riderById0 = new Map(prep.riders.map((r) => [r.id, r]));
      const virtualIndices = Array.from({ length: v.count }, (_, i) => prep.problem.vehicles.length + i);
      const stops = prep.problem.stops.map((s, i) => {
        if (s.allowedVehicles === null) return s; // unrestricted already includes any vehicle, virtual cars too
        const rider = riderById0.get(prep.stopRiderIds[i]!);
        const own = rider?.runVehicleId != null ? realCarIdx.get(rider.runVehicleId) : undefined;
        if (own !== undefined && rider!.pinned) return s; // fixed to her real car — unaffected
        return { ...s, allowedVehicles: [...s.allowedVehicles, ...virtualIndices] };
      });
      // Virtual cars: two leaders each (mixed, so no gender penalty), back to church. Nothing is saved.
      const problem: SolveProblem = { ...prep.problem, stops, vehicles: [...prep.problem.vehicles,
        ...Array.from({ length: v.count }, () => ({ start: church, end: church, capacity: capacityOf(v.seats, 2) }))] };
      let now: AnalysisSolve, extra: SolveResult;
      try {
        [now, extra] = await Promise.all([analysisSolve(c, run, signal),
          problem.stops.length ? routing.solve(problem, signal) : Promise.resolve<SolveResult>({ routes: [], skipped: [] })]);
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw routingFailedFor(err, ANALYSIS_FAILED, { riders: prep.riders,
          cars: prep.cars.map((car, i) => ({ name: car.name, endPlaceId: prep.problem.vehicles[i]?.end?.placeId ?? null })),
          churchPlaceId: c.busMinistry.churchPlaceId });
      }
      const fleetNow = minutes(now.result, (k) => !!now.cars[k]!.vehicleId);
      // Task 1 (bug): mirror fleetNow's own-car exclusion on the "after" side. prep.cars /
      // prep.problem.vehicles only ever hold real fleet vehicles today (prepareFleet filters
      // on vehicleId), so this is currently a no-op — but "after" must never silently start
      // counting an own car's drive time just because a future prepareFleet change stops
      // filtering it out upstream. A virtual "Extra car" (index >= prep.cars.length) always counts.
      const fleetAfter = minutes(extra, (k) => k >= prep.cars.length || !!prep.cars[k]!.vehicleId);
      const notSent = prep.riders.filter((r) => !r.runVehicleId && !r.snapPlaceId).length;
      // Task 8 (owner): per-car breakdown of the "after" (with extra cars) solve — existing cars
      // keep their own name, hypothetical ones are "Extra car N". All from data this solve
      // already returned; no extra Google calls.
      const riderById = new Map(prep.riders.map((r) => [r.id, r]));
      const cars: BusExtraCarsCar[] = extra.routes.map((route) => {
        const isExisting = route.vehicle < prep.cars.length;
        let cum = 0;
        const stops = route.stops.map((s, i) => {
          cum += route.legsSec[i] ?? 0;
          const r = riderById.get(prep.stopRiderIds[s]!);
          return { name: r?.snapName ?? '', suburb: r ? suburbOf(r.snapAddress) : '', arriveAt: hhmmAt(problem.startIso, cum) };
        });
        return { label: isExisting ? prep.cars[route.vehicle]!.name : `Extra car ${route.vehicle - prep.cars.length + 1}`,
          extra: !isExisting, riders: route.stops.length, driveMinutes: Math.round(route.totalSec / 60),
          finishAt: hhmmAt(problem.startIso, route.totalSec), stops };
      });
      return { count: v.count, seats: v.seats,
        before: { longestMin: Math.max(0, ...fleetNow), totalMin: sum(fleetNow), unassigned: prep.riders.filter((r) => !r.runVehicleId).length },
        after: { longestMin: Math.max(0, ...fleetAfter), totalMin: sum(fleetAfter), unassigned: extra.skipped.length + notSent },
        cars };
    },
    async analysisMap(ctx) {
      const c = await gate(ctx, 'bus:coordinate'); // coordinators run the night, so they get route analysis (Past nights stay bus:analysis)
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
