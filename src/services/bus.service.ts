import { z } from 'zod';
import { generateId } from '../utils/id';
import { can, canWithConfig, canAccessStudent, type Action } from './access-control';
import { AppError, BadRequestError, ConflictError, ForbiddenError, ModuleDisabledError, NotFoundError } from '../core/errors/app-error';
import { currentRunDate, localDay, addDays, isServiceDay, eligibilityOf, capacityOf, nameMatches, normName, tidyName, riderKey, suburbOf, suburbOnly, streetOf, phoneMatches, PURGE_DAYS, BUS_CAR_COLOURS } from './bus-logic';
import { autoFillPool, buildFleetProblem, buildSingleProblem, endPlaceOf, leaveIso, placementsFrom, skipPairs, detours, type FleetCar } from './bus-plan';
import { FakeRoutingProvider } from './routing/fake-routing-provider';
import { routingDeadline, RoutingError, type RoutingProvider, type PlaceSuggestion, type PlaceAddress, type SolveProblem, type SolveResult,
  type MapImage, type MapMarker, type MapPath } from './routing/routing-provider';
import { decodePolyline, thinPolyline } from './routing/polyline';
import { markerLabel, ROUTE_MAX_INTERMEDIATES } from './routing/google-requests';
import type { IBusRepository, IStudentRepository, ILeaderRepository, ISettingsRepository, IConnectionRepository } from '../repositories/interfaces/entity-repositories';
import type { ILinkRepository } from '../repositories/interfaces/link.repository';
import { LinkOpenDuplicate, LinkUnavailable } from '../core/errors/link-errors';
import { consentView, latestForm, sameAddress } from './bus-consent';
import type { Actor } from '../core/entities/user';
import { makeDnc, type Dnc } from './dnc';
import { createLogger } from '../utils/logger';
import type { MinistryConfig } from '../core/ministry-config';
import type { BusRun, BusRunRider, BusRunVehicle, BusRunVehicleView, BusRiderView, BusSearchHit, BusGender, BusConsentForm,
  BusLeaderView, BusAddress, BusRunView, MyCarView, PendingGuestView, BusOwnCar, BusVehicle, BusGenerateResult,
  BusConsentView, BusAnalysisView, BusExtraCarsView, BusExtraCarsCar, BusPastRiderView, BusHistoryView, BusHistoryNight, BusHistoryRide, VehicleKind } from '../core/entities/bus';

// tripDate (BUS-1): optional ?date= for the own-car / my-car endpoints (Trip logging); see tripRunIfAny.
export interface BusCtx { actor: Actor; asLeaderId: string | null; localNow: string; tripDate?: string | null }

/** Read-only All cars view (October rework C). Allow-listed fields only: no ids, streets, phones or consent. */
export interface BusCarsView {
  cars: { name: string; colourIndex: number; leaderNames: string[];
          stops: { stop: number | null; name: string; grade: number | null; suburb: string; dropped: boolean }[] }[];
  unassigned: number;
}

export interface BusService {
  getRun(ctx: BusCtx): Promise<BusRunView>;
  carsView(ctx: BusCtx): Promise<BusCarsView>;
  getVersion(ctx: BusCtx): Promise<{ runId: string | null; version: number }>;
  search(ctx: BusCtx, q: string): Promise<BusSearchHit[]>;
  riderAddresses(ctx: BusCtx, riderId: string): Promise<BusSearchHit['addresses']>;
  personAddresses(ctx: BusCtx, who: { studentId?: string; guestId?: string }): Promise<BusSearchHit['addresses']>;
  deleteRiderAddress(ctx: BusCtx, riderId: string, addressId: string): Promise<void>;
  deletePastRider(ctx: BusCtx, who: { studentId?: string; guestId?: string }): Promise<void>;
  saveMyCarStops(ctx: BusCtx, input: unknown): Promise<BusRunVehicleView>;
  optimiseMyCar(ctx: BusCtx): Promise<BusRunVehicleView & { optimised: boolean }>;
  addRider(ctx: BusCtx, input: unknown): Promise<BusRiderView>;
  updateRider(ctx: BusCtx, riderId: string, input: unknown): Promise<BusRiderView>;
  removeRider(ctx: BusCtx, riderId: string): Promise<void>;
  createGuest(ctx: BusCtx, input: unknown): Promise<BusSearchHit>;
  saveVehicle(ctx: BusCtx, input: unknown): Promise<BusVehicle>;
  updateRunVehicle(ctx: BusCtx, runVehicleId: string, input: unknown): Promise<BusRunVehicleView>;
  setPool(ctx: BusCtx, input: unknown): Promise<void>;
  setLeaderPrefs(ctx: BusCtx, leaderId: string, input: unknown): Promise<void>;
  /** `skipped`: riders already in another car/bus on that night — named back, never moved (review B). */
  saveOwnCar(ctx: BusCtx, input: unknown): Promise<BusRunVehicleView & { skipped: { name: string; car: string }[] }>;
  removeOwnCar(ctx: BusCtx, ownerLeaderId?: string | null): Promise<void>;
  moveRider(ctx: BusCtx, riderId: string, input: unknown): Promise<BusRiderView & { reordered: boolean }>;
  setDropped(ctx: BusCtx, riderId: string, input: unknown): Promise<BusRiderView>;
  myCar(ctx: BusCtx): Promise<MyCarView>;
  pendingGuests(ctx: BusCtx): Promise<PendingGuestView[]>;
  linkGuest(ctx: BusCtx, guestId: string, input: unknown): Promise<void>;
  dismissGuest(ctx: BusCtx, guestId: string): Promise<void>;
  linkGuestsAfterImport(): Promise<{ linked: number }>;
  history(ctx: BusCtx, from?: string): Promise<BusHistoryView>;
  editPastRider(ctx: BusCtx, runId: string, riderId: string, input: unknown): Promise<{ ok: true }>;
  autocomplete(ctx: BusCtx, q: string, session: string): Promise<PlaceSuggestion[]>;
  placeDetails(ctx: BusCtx, placeId: string, session: string): Promise<PlaceAddress>;
  generate(ctx: BusCtx, input: unknown): Promise<BusGenerateResult>;
  undo(ctx: BusCtx): Promise<void>;
  unassignAll(ctx: BusCtx): Promise<{ unassigned: number }>;
  analysis(ctx: BusCtx): Promise<BusAnalysisView>;
  extraCars(ctx: BusCtx, input: unknown): Promise<BusExtraCarsView>;
  analysisMap(ctx: BusCtx): Promise<MapImage>;
  pastRunMap(ctx: BusCtx, runId: string): Promise<MapImage>;
  // Bus consent via the Elvanto form (spec 2026-10-22 §5.4/§5.6).
  consentStatus(ctx: BusCtx): Promise<BusConsentStatus>;
  consentCheck(ctx: BusCtx): Promise<{ id: string }>;
  consentForms(ctx: BusCtx): Promise<{ rows: { name: string; submittedAt: string; year: number; matched: boolean }[] }>;
  /** F6: riderId is resolved to the person on the server (a redacted junior view carries no studentId/guestId). */
  consentPrefill(ctx: BusCtx, q: { riderId?: string; studentId?: string; guestId?: string }): Promise<Record<string, unknown>>;
  /** POST /bus/consent-form: files the Elvanto bus consent form for one child (R2: the read-out tick is required). */
  consentSubmit(ctx: BusCtx, input: unknown): Promise<Awaited<ReturnType<BusConsentSender['sendBusConsent']>>>;
}

export interface BusConsentStatus { year: number; lastChecked: string; lastNew: number; checking: boolean; canCheck: boolean;
  unmatched: { name: string; submittedAt: string }[] | null }
/** F4 (pre-flight): structural, so this lane needs no NewYouthService type; Task 10 wires the real one. */
export type BusConsentSender = { sendBusConsent(actor: Actor, input: unknown): Promise<{ result: 'sent' | 'failed' | 'unconfirmed' | 'skipped';
  dropoff: string | null; queued?: boolean; repeat?: boolean }> };
export interface BusServiceExt { link?: Pick<ILinkRepository, 'insertAction' | 'listActions' | 'cancelPending' | 'listConsoles'>; newYouth?: BusConsentSender }
type ConsentFn = (who: { studentId: string | null; guestId: string | null }, at?: Pick<BusRunRider, 'snapAddress' | 'runVehicleId'>) => BusConsentView;

/** BUS-2: one mapper for the three saved-address lists. A bus row (vehicleId) reads as "Bus drop off" — never a street. */
const addrOut = (a: BusAddress) => ({ id: a.id, label: a.label, suburb: a.vehicleId ? 'Bus drop off' : suburbOf(a.address),
  street: a.vehicleId ? 'Bus drop off' : streetOf(a.address), vehicleId: a.vehicleId ?? null });

const NewAddress = z.object({ label: z.string().max(40).default(''), address: z.string().min(3).max(200), placeId: z.string().max(300).nullable().default(null) });
// BUS-2: where = exactly one of a saved address, a new address, or a running bus ("Bus drop off").
const Where = { addressId: z.string().min(1).optional(), newAddress: NewAddress.optional(), busRunVehicleId: z.string().min(1).optional(),
  consentFormId: z.string().min(1).optional() }; // spec 2026-10-22 bus consent §5.7: the consent form address (resolved to newAddress first)
const oneWhere = (v: { addressId?: string; newAddress?: unknown; busRunVehicleId?: string; consentFormId?: string }) =>
  [v.addressId, v.newAddress, v.busRunVehicleId, v.consentFormId].filter((x) => x !== undefined).length === 1;
const AddRider = z.object({
  studentId: z.string().min(1).optional(), guestId: z.string().min(1).optional(), ...Where,
}).refine((v) => !!v.studentId !== !!v.guestId, 'Choose a student or a new person')
  .refine(oneWhere, 'Choose an address');
const UpdateRider = z.object(Where).refine(oneWhere, 'Choose an address');
const NAME_RE = /^[^<>"]+$/; // C2: no raw <, > or " — prevents stored XSS via phoneLink()'s onclick attribute
const PHONE_CHARS_RE = /^[0-9 +()-]*$/;
// Task 5 (owner): phone is now optional on a New Person — an omitted/blank value stores as
// null (no phone at all is a real case: a walk-in with no number given). If one IS given, it
// must still look like a phone (digits/space/+/()/- only) and have >=8 digits once those
// separators are stripped, or the add is rejected with "Check the phone number".
const NewGuest = z.object({
  firstName: z.string().trim().min(1).max(60).regex(NAME_RE, 'Invalid name').transform(tidyName), // I10: "harper" -> "Harper"
  lastName: z.string().trim().min(1).max(60).regex(NAME_RE, 'Invalid name').transform(tidyName),
  grade: z.number().int().nullable(), gender: z.enum(['male', 'female']),
  phone: z.string().trim().max(20).nullable().optional()
    .transform((v) => (v && v.length > 0 ? v : null))
    .refine((v) => v === null || (PHONE_CHARS_RE.test(v) && v.replace(/[\s+()-]/g, '').length >= 8), 'Check the phone number'),
});
const BUS_NEEDS_DROP = 'A bus needs its drop-off address';
const BUS_NOT_RUNNING = "That bus isn't running tonight";
const NO_BUS_NO_HOME = 'Add a home address first: tap their name on Students'; // simplicity: one message for "no bus, no home"
/** BUS-2: a person's most recently used home (non-bus) address. */
const latestHome = (owned: BusAddress[]) => owned.filter((a) => !a.vehicleId).sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))[0];
/** BUS-2: a charter bus (one drop-off, never solved, no gender rule). Absent kind = car. */
const isBus = (v: { kind?: VehicleKind }) => v.kind === 'bus';
const EndsFields = { endsAt: z.enum(['church', 'last_drop', 'address']), endsAddress: z.string().max(200).nullable().default(null), endsPlaceId: z.string().max(300).nullable().default(null) };
const SaveVehicle = z.object({ id: z.string().optional(), name: z.string().trim().min(1).max(40), plate: z.string().max(12).nullable().default(null),
  seats: z.number().int().min(1).max(60), prefGrades: z.array(z.number().int()).default([]), ...EndsFields,
  // M2: optional, so an old cached SPA (no kind) can't demote a bus; saveVehicle resolves it from the prior row.
  sort: z.number().int().default(0), archived: z.boolean().default(false), kind: z.enum(['car', 'bus']).optional() });
const UpdateRunVehicle = z.object({ running: z.boolean().optional(), leaderIds: z.array(z.string()).optional(), locked: z.boolean().optional(),
  endsAt: EndsFields.endsAt.optional(), endsAddress: z.string().max(200).nullable().optional(), endsPlaceId: z.string().max(300).nullable().optional() });
const SetPool = z.object({ availableLeaderIds: z.array(z.string()) });
// B1 (2026-10-20): prefGrades (here and on SaveVehicle) is still accepted and stored so an old
// cached SPA never gets a 400, but the planner no longer reads it. Plain ints, no
// min/max (the grade range itself is ministry-config-driven, not a fixed Zod bound).
const LeaderPrefsIn = z.object({ inPool: z.boolean().optional(),
  prefGrades: z.array(z.number().int()).optional() });
// Own-car "add someone" (owner, 2026-10-07): a junior leader without bus:roster can still add a
// brand-new rider into THEIR OWN car — same shapes addRider/createGuest already validate, just
// bundled onto the own-car save so one bus:use-gated call does both (see placeRider below).
const OwnCarNewRider = z.object({
  studentId: z.string().min(1).optional(), guestId: z.string().min(1).optional(), newPerson: NewGuest.optional(),
  addressId: z.string().min(1).optional(), newAddress: NewAddress.optional(),
}).refine((v) => [v.studentId, v.guestId, v.newPerson].filter((x) => x !== undefined).length === 1, 'Choose a student or a new person')
  .refine((v) => !(v.addressId && v.newAddress), 'Choose one address'); // BUS-1: none = no address (trip logging)
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
const DroppedIn = z.object({ dropped: z.boolean(), at: z.string().datetime().optional() });
// Past-night correction (director/admin): every field optional; only what actually changes is logged.
const EditPastIn = z.object({
  runVehicleId: z.string().min(1).nullable().optional(), droppedAt: z.string().datetime().nullable().optional(),
  noShow: z.boolean().optional(), notRiding: z.boolean().optional(),
  note: z.string().trim().max(300).nullable().optional(), reason: z.string().trim().max(200).default(''),
});
const GenerateIn = z.object({ mode: z.enum(['all', 'fit']) });
const ExtraCarsIn = z.object({ count: z.number().int().min(1).max(2), seats: z.number().int().min(3).max(15) });
// generate() makes one Google solve plus per-rider writes. GENERATE_SOLVE_BUDGET_MS is that solve's
// deadline; LOCK_MS sits comfortably above it plus the writes (the Vercel function's maxDuration is 60s).
const GENERATE_SOLVE_BUDGET_MS = 30_000;
const LOCK_MS = 55_000;
const UNDO_MS = 120_000;
const SESSION_RE = /^[A-Za-z0-9-]{8,36}$/;
const PLACE_ID_RE = /^[A-Za-z0-9_:-]{1,300}$/; // Google place ids (and the fake provider's)
const NO_CHURCH = 'Set the church address in Bus settings first';
const GENERATE_FAILED = "Couldn't reach Google Maps — nothing changed. Try again, or move riders by hand.";
const MAP_FAILED = 'Could not draw the map';
const SEARCH_FAILED = 'Address search is unavailable right now — try again in a minute.';
const ANALYSIS_FAILED = "Couldn't reach Google Maps — try again in a minute.";
const MAP_MAX_POINTS = 120; // per route, keeps the Static Maps URL far under its 16k limit
const PAST_RIDERS_CAP = 100;

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
// Names of a car's leaders: the snapshot first (survives a deleted leader), live name as fallback.
const leaderNamesOf = (v: BusRunVehicle, live: Map<string, string>): string[] => {
  const snap = new Map(v.leaderSnap.map((l) => [l.id, l.name]));
  return v.leaderIds.map((id) => snap.get(id) ?? live.get(id)).filter((n): n is string => !!n);
};
const clockAt = (iso: string, tz: string) => new Date(iso).toLocaleTimeString('en-AU', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });
// A soft-removed ("not riding") rider keeps the row but loses any car/stop.
const OFF_CAR = { runVehicleId: null, stopOrder: null, pinned: false } as const;
const SEAT_KEYS = ['snapAddress', 'snapPlaceId', 'runVehicleId', 'stopOrder', 'pinned'] as const;
/** BUS-2: a bus rider with nowhere to go: no address, no map pin, Unassigned. */
const NO_SEAT = { snapAddress: '', snapPlaceId: null, ...OFF_CAR };
// Task 8: startIso labels local leave time as literal UTC (see leaveIso in bus-plan.ts) — read
// the clock back the same way (UTC getters), or this would double-shift by the server's TZ.
const hhmmAt = (startIso: string, addSec: number): string => new Date(Date.parse(startIso) + addSec * 1000).toISOString().slice(11, 16);

// M1: a bare schema.parse(input) throws ZodError, which the global error middleware maps to the
// generic "Validation failed" — unhelpful for a refine() message like "Choose a student or a new
// person". Bus routes parse through this instead so the caller sees the first real issue.
const log = createLogger('bus');

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
  routing: RoutingProvider = new FakeRoutingProvider(), connections?: IConnectionRepository,
  dnc: Dnc = makeDnc(), ext: BusServiceExt = {}): BusService { // R1: optional; absent = nobody is DNC

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
  /** Route analysis is read-only for every Bus login except a junior leader on "My car only":
   *  the map pins sit on real home addresses, so that login doesn't get it (2026-10-15). */
  async function gateAnalysisView(ctx: BusCtx): Promise<MinistryConfig> {
    const c = await gate(ctx, 'bus:use');
    if (isRedactedLeader(ctx, c)) throw new ForbiddenError('Route analysis is for coordinators and staff logins');
    return c;
  }
  /** A junior `leader` login that isn't a coordinator: "My car only" (spec §4) — riders reach it suburb-only. */
  function isRedactedLeader(ctx: BusCtx, c: MinistryConfig): boolean {
    return ctx.actor.role === 'leader' && !allowed(ctx, c, 'bus:coordinate');
  }
  /** The junior leader's own connected students (search, own-car save, draft). */
  async function myStudentIds(ctx: BusCtx): Promise<Set<string>> {
    return new Set(ctx.actor.leaderId && connections ? (await connections.findByLeader(ctx.actor.leaderId)).map((x) => x.studentId) : []);
  }
  function selfLeaderId(ctx: BusCtx): string | null {
    // A junior-leader login is locked to its own record; everyone else self-identifies (spoofable by design — spec §4).
    return ctx.actor.role === 'leader' ? ctx.actor.leaderId ?? null : ctx.asLeaderId;
  }
  function allowed(ctx: BusCtx, c: MinistryConfig, action: Action): boolean {
    if (canWithConfig(ctx.actor, action, c)) return true;
    const me = selfLeaderId(ctx);
    const coordinator = !!me && c.busMinistry.coordinatorLeaderIds.includes(me);
    return coordinator && (action === 'bus:use' || action === 'bus:roster' || action === 'bus:coordinate');
  }

  async function whoLabel(ctx: BusCtx): Promise<string> {
    const me = selfLeaderId(ctx);
    if (me) { const l = await leaders.findById(me); if (l) return l.fullName; }
    return ctx.actor.displayName;
  }

  /** Every tonight read goes through this: "not riding" rows are history only, never roster. */
  async function ridingOf(runId: string): Promise<BusRunRider[]> {
    return (await bus.listRunRiders(runId)).filter((r) => !r.notRiding);
  }

  /** Saves a run car and refreshes its leaderSnap (leaders that no longer exist keep their old snapshot entry). */
  async function saveRV(v: Omit<BusRunVehicle, 'leaderSnap'> & { leaderSnap?: BusRunVehicle['leaderSnap'] }, pool?: { id: string; fullName: string; gender: string | null }[]): Promise<BusRunVehicle> {
    const live = new Map((pool ?? await leaders.findAll()).map((l) => [l.id, l]));
    const old = new Map((v.leaderSnap ?? []).map((l) => [l.id, l]));
    const leaderSnap = v.leaderIds.flatMap((id) => {
      const l = live.get(id);
      if (l) return [{ id, name: l.fullName, gender: genderOf(l.gender) }];
      const o = old.get(id);
      return o ? [o] : [];
    });
    return bus.saveRunVehicle({ ...v, leaderSnap });
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
    // BUS-1: a trip-only (bare) run has no fleet cars, so carry over from the last night that did.
    // ponytail: one listRunVehicles per earlier run until a fleet car is found (1-2 reads in practice;
    // a church with no fleet scans every run once a week) — batch it if that ever shows up.
    let prev: BusRun | null = null, prevVehicles: BusRunVehicle[] = [];
    for (const r of (await bus.listRuns()).filter((r) => r.serviceDate < date)) { // newest first
      const vs = await bus.listRunVehicles(r.id);
      if (vs.some((v) => v.vehicleId)) { prev = r; prevVehicles = vs; break; }
    }
    // I7: a prev run's leaderIds/availablePoolLeaderIds can name a leader who's since been
    // deactivated (e.g. a New Year reset) — only carry forward leaders still active, or the
    // new run opens with stale "Leader" chips, wrong capacity and unknown gender.
    const activeList = await leaders.findActive();
    const activeIds = new Set(activeList.map((l) => l.id));
    const { run, created } = await bus.insertRunIfAbsent({
      id: generateId(), serviceDate: date, version: 0,
      availablePoolLeaderIds: (prev?.availablePoolLeaderIds ?? []).filter((id) => activeIds.has(id)),
      lockBy: null, lockUntil: null, lastChangeBy: null, lastChangeAt: null, undoSnapshot: null, undoUntil: null, createdAt: nowIso(),
    });
    if (!created) return run;
    const fleet = (await bus.listVehicles()).filter((v) => !v.archived);
    for (const [i, v] of fleet.entries()) {
      const before = prevVehicles.find((p) => p.vehicleId === v.id);
      // Leaders carry over from last week's car; a vehicle new since then starts with none.
      const leaderIds = (before ? before.leaderIds : []).filter((id) => activeIds.has(id));
      await saveRV({
        id: generateId(), runId: run.id, vehicleId: v.id, ownerLeaderId: null, name: v.name, seats: v.seats, plate: v.plate,
        running: before ? before.running : true, leaderIds,
        endsAt: v.endsAt, endsAddress: v.endsAddress, endsPlaceId: v.endsPlaceId, colourIndex: i, locked: false, kind: v.kind ?? 'car',
      }, activeList);
    }
    return run;
  }

  function isPast(run: BusRun, ctx: BusCtx, c: MinistryConfig): boolean {
    return run.serviceDate < currentRunDate(ctx.localNow, c.structure.serviceDayOfWeek);
  }
  // Writes always target the current night (ensureRun never returns a past run);
  // a rider/car id from a finished night therefore fails its runId check → 404.
  const writableRun = ensureRun;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  /** BUS-1 Trip logging: the run for ctx.tripDate. Absent/current → tonight (ensureRun). Other dates → that
   *  date's run, created bare (no fleet) when `create`. Window today-14..today+7; a later bus night is refused. */
  async function tripRunIfAny(ctx: BusCtx, c: MinistryConfig, create = false): Promise<BusRun | null> {
    const d = ctx.tripDate, dow = c.structure.serviceDayOfWeek;
    const cur = currentRunDate(ctx.localNow, dow);
    if (!d || d === cur) return ensureRun(ctx, c);
    if (!DATE_RE.test(d) || Number.isNaN(Date.parse(d + 'T00:00:00Z'))) throw new BadRequestError('Bad date');
    const today = localDay(ctx.localNow);
    if (d < addDays(today, -14) || d > addDays(today, 7)) throw new BadRequestError('Pick a date in the last 14 days or the next 7');
    // A bare run made early for a later bus night would stop ensureRun copying the fleet into it.
    if (d > cur && isServiceDay(d, dow)) throw new BadRequestError("That's a later bus night — log it on the night");
    const existing = await bus.getRunByDate(d);
    if (existing || !create) return existing;
    return (await bus.insertRunIfAbsent({ id: generateId(), serviceDate: d, version: 0, availablePoolLeaderIds: [],
      lockBy: null, lockUntil: null, lastChangeBy: null, lastChangeAt: null, undoSnapshot: null, undoUntil: null, createdAt: nowIso() })).run;
  }
  /** tripRunIfAny that always has a run (creates a bare one), for the trip writes. */
  const tripRunForWrite = async (ctx: BusCtx, c: MinistryConfig): Promise<BusRun> => (await tripRunIfAny(ctx, c, true))!;
  async function touch(ctx: BusCtx, run: BusRun): Promise<void> {
    await bus.bumpRun(run.id, await whoLabel(ctx), nowIso());
  }

  const CHECK_STALE_MS = 10 * 60_000; // Review Focus 5: a check nobody claimed for 10 min no longer holds the button
  /** One consent loader per request: the forms, the year, who sees details, the DNC mark. `runId` lets a coordinator's
   *  differs hint skip riders on a bus (their address is the bus drop-off, not home: pre-flight F16). */
  async function consentCtx(ctx: BusCtx, c: MinistryConfig, runId?: string): Promise<ConsentFn> {
    const full = !isRedactedLeader(ctx, c), coord = allowed(ctx, c, 'bus:coordinate');
    const [forms, mark, rvs] = await Promise.all([bus.listConsentForms(), dnc.forActor(ctx.actor),
      coord && runId ? bus.listRunVehicles(runId) : Promise.resolve([] as BusRunVehicle[])]);
    const onBus = new Set(rvs.filter(isBus).map((v) => v.id));
    const year = Number(ctx.localNow.slice(0, 4)); // R4: localNow is the phone's local time in the site zone
    return (who, at) => {
      const v = consentView(forms, who, year, full);
      if (v.details) v.details = mark(v.details, who.studentId); // DNC: parentPhone -> null for a non-admin/director login
      if (coord && v.details && at && !(at.runVehicleId && onBus.has(at.runVehicleId))) v.differs = !!at.snapAddress.trim() && !sameAddress(v.details.address, at.snapAddress); // M2: no address saved = no hint
      return v;
    };
  }

  /** R8: the person's own consent form -> an ordinary new address, geocoded through the Places path (never stored as a form link). */
  async function consentWhere<T extends { consentFormId?: string }>(v: T, owner: { studentId?: string | null; guestId?: string | null }) {
    if (!v.consentFormId) return v;
    const f = (await bus.listConsentForms()).find((x) => x.id === v.consentFormId
      && (owner.studentId ? x.studentId === owner.studentId : !!owner.guestId && x.guestId === owner.guestId));
    if (!f) throw new NotFoundError('That consent form is not this person\'s');
    const a = f.data.address, text = `${a.line1}, ${a.city} ${a.state} ${a.postcode}`.replace(/\s+/g, ' ').trim();
    let hit: PlaceSuggestion | undefined;
    try { hit = (await routing.autocomplete(text, generateId(), routingDeadline()))[0]; } catch (err) { throw routingFailed(err, SEARCH_FAILED); }
    if (!hit) throw new AppError('CONSENT_ADDRESS_UNMATCHED', "We couldn't find that address. Pick it from the list.", 422, { text });
    const { consentFormId: _drop, ...rest } = v;
    return { ...rest, newAddress: { label: 'Consent form', address: hit.text, placeId: hit.placeId } };
  }

  /** Queue one busConsentCheck for the newest console (reuses a fresh open row; replaces a stale pending one). No role check. */
  async function queueCheck(ctx: BusCtx): Promise<{ id: string }> {
    if (!ext.link) throw new LinkUnavailable();
    const con = (await ext.link.listConsoles()).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))[0];
    if (!con || (con.capabilities.busConsentCheck ?? 'off') === 'off') throw new LinkUnavailable();
    for (const r of await ext.link.listActions({ types: ['busConsentCheck'], statuses: ['pending', 'claimed'] })) {
      if (Date.now() - Date.parse(r.createdAt) < CHECK_STALE_MS) return { id: r.id };
      if (r.status === 'pending') await ext.link.cancelPending(r.id); // never claimed: an old or offline console
    }
    try {
      const row = await ext.link.insertAction({ id: generateId(), type: 'busConsentCheck', payload: {}, note: null, dedupeKey: 'bcc',
        serviceDate: ctx.localNow.slice(0, 10), studentId: null, personId: null, createdBy: ctx.actor.id,
        leaderId: selfLeaderId(ctx), leaderName: await whoLabel(ctx) });
      return { id: row.id };
    } catch (e) {
      if (e instanceof LinkOpenDuplicate) return { id: String(e.extra?.existingId) };
      throw e;
    }
  }

  function riderView(r: BusRunRider, cv?: ConsentFn): BusRiderView {
    return { id: r.id, studentId: r.studentId, guestId: r.guestId, addressId: r.addressId, runVehicleId: r.runVehicleId,
      stopOrder: r.stopOrder, pinned: r.pinned, name: r.snapName, grade: r.snapGrade, gender: r.snapGender,
      address: r.snapAddress, placeId: r.snapPlaceId,
      consent: cv ? cv(r, r) : { year: 0, current: false },
      droppedAt: r.droppedAt, droppedBy: r.droppedBy };
  }

  /** `ridersIn`: the caller's own ridingOf(runId) read, so one request reads the riders once. */
  async function vehicleViews(runId: string, past = false, ridersIn?: Promise<BusRunRider[]>): Promise<BusRunVehicleView[]> {
    const [all, riders] = await Promise.all([leaders.findAll(), ridersIn ?? ridingOf(runId)]);
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
        // A finished night names who drove from the snapshot, so a since-deleted leader still shows.
        leaderNames: past ? leaderNamesOf(v, new Map(all.map((l) => [l.id, l.fullName]))) : leaderIds.map((id) => byId.get(id)!.fullName),
        needsFemaleLeader: hasGirl && !eligibility.female && !isBus(v), // BUS-2: no gender rule on a bus
      };
    });
  }

  async function buildView(ctx: BusCtx, c: MinistryConfig, run: BusRun): Promise<BusRunView> {
    const ridersP = ridingOf(run.id);
    const [vehicles, riders, active, prefs, fleet] = await Promise.all([
      vehicleViews(run.id, isPast(run, ctx, c), ridersP), ridersP, leaders.findActive(), bus.listLeaderPrefs(), bus.listVehicles(),
    ]);
    const prefBy = new Map(prefs.map((p) => [p.id, p]));
    const leaderViews: BusLeaderView[] = active.map((l) => ({ id: l.id, name: l.fullName, gender: genderOf(l.gender),
      inPool: prefBy.get(l.id)?.inPool ?? false,
      prefGrades: prefBy.get(l.id)?.prefGrades ?? [] }));
    const seesPending = can(ctx.actor, 'bus:analysis');
    const canCoordinate = allowed(ctx, c, 'bus:coordinate');
    const cv = await consentCtx(ctx, c, run.id);
    const riderViews = riders.map((r) => riderView(r, cv));
    const busIds = new Set(vehicles.filter(isBus).map((v) => v.id));
    if (riderViews.some((r) => r.runVehicleId && busIds.has(r.runVehicleId))) {
      const all = await bus.listAllAddresses();
      for (const r of riderViews) {
        if (r.runVehicleId && busIds.has(r.runVehicleId)
          && !latestHome(all.filter((a) => (r.studentId ? a.studentId === r.studentId : a.guestId === r.guestId)))) r.noHome = true;
      }
    }
    // I1: a 'leader' login who isn't a self-identified coordinator gets "My car only" per
    // spec §4 — strip every rider's street address/place/consent note/who-recorded-it (name +
    // suburb only; this is also what their read-only Assign shows). Leaders + fleet stay:
    // Car setup is open to every Bus login since 2026-10-15 and they hold no student data.
    const redacted = isRedactedLeader(ctx, c);
    // F4 (review 2026-10-16): a driver's end address is their home. The "My car only" leader gets it blanked on
    // every car but its own (grade/quad logins keep it: Car setup is open to them).
    const me = selfLeaderId(ctx);
    const hideEnds = <T extends { endsAddress: string | null; endsPlaceId: string | null }>(v: T, own = false): T =>
      redacted && !own ? { ...v, endsAddress: null, endsPlaceId: null } : v;
    return {
      run: { id: run.id, serviceDate: run.serviceDate, version: run.version, readOnly: isPast(run, ctx, c),
        lastChangeBy: run.lastChangeBy, lastChangeAt: run.lastChangeAt, lockBy: lockName(run.lockBy), lockUntil: run.lockUntil, undoUntil: run.undoUntil },
      vehicles: vehicles.map((v) => hideEnds(v, !!me && (v.ownerLeaderId === me || v.leaderIds.includes(me)))),
      riders: redacted ? riderViews.map((r) => ({
        id: r.id, studentId: null, guestId: null, addressId: null,
        runVehicleId: r.runVehicleId, stopOrder: r.stopOrder, pinned: r.pinned,
        name: r.name, grade: r.grade, gender: r.gender, address: suburbOnly(r.address), placeId: null,
        consent: { year: r.consent.year, current: r.consent.current },
        droppedAt: r.droppedAt, droppedBy: r.droppedBy,
      })) : riderViews,
      leaders: leaderViews, availablePoolLeaderIds: run.availablePoolLeaderIds,
      fleet: fleet.filter((v) => !v.archived).map((v) => hideEnds(v)), canCoordinate,
      pendingNewPeople: seesPending ? (await pendingGuestList()).length : null,
      pastRiders: isPast(run, ctx, c) ? [] : await pastRidersList(ctx, c, riders, cv),
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
    input: { addressId?: string; newAddress?: { label: string; address: string; placeId: string | null }; busRunVehicleId?: string },
    run: BusRun): Promise<BusAddress> {
    if (input.busRunVehicleId) { // BUS-2: their "Bus drop off" row for this fleet bus (one per person per bus), bumped to last used
      const rv = (await bus.listRunVehicles(run.id)).find((v) => v.id === input.busRunVehicleId && isBus(v) && v.running);
      if (!rv?.vehicleId || !rv.endsAddress) throw new BadRequestError(BUS_NOT_RUNNING);
      const prior = (await bus.listAddresses(owner.studentId ? { studentId: owner.studentId } : { guestId: owner.guestId! })).find((a) => a.vehicleId === rv.vehicleId);
      // address: a placeholder copy (column is NOT NULL); a running bus seats from rv.endsAddress, never from this.
      return bus.saveAddress({ id: prior?.id ?? generateId(), studentId: owner.studentId ?? null, guestId: owner.guestId ?? null,
        label: 'Bus drop off', address: rv.endsAddress, placeId: rv.endsPlaceId, vehicleId: rv.vehicleId,
        lastUsedAt: nowIso(), createdAt: prior?.createdAt ?? nowIso() });
    }
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
    v: { studentId?: string; guestId?: string; addressId?: string; newAddress?: { label: string; address: string; placeId: string | null }; busRunVehicleId?: string }): Promise<BusRunRider> {
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
    // BUS-1: no address given (a trip rider) = none; an existing/revived row keeps its own address.
    const owner = v.studentId ? { studentId: v.studentId } : { guestId: v.guestId! };
    const addr = v.addressId || v.newAddress || v.busRunVehicleId ? await resolveAddress(owner, v, run) : null;
    const existing = (await bus.listRunRiders(run.id)).find((r) => (v.studentId ? r.studentId === v.studentId : r.guestId === v.guestId));
    const seat = addr ? busPatch(existing ?? { runVehicleId: null }, addr, await bus.listRunVehicles(run.id), await bus.listAddresses(owner)) : {}; // BUS-2
    if (!seat) throw new BadRequestError(NO_BUS_NO_HOME);
    // Re-adding someone who was taken off tonight revives their "not riding" row (unique per run+person).
    const revive = async (r: BusRunRider) => (r.notRiding
      ? { ...OFF_CAR, notRiding: false, noShow: false, droppedAt: null, droppedBy: null, addedBy: await whoLabel(ctx), addedAt: nowIso() } : {});
    const patch = { studentId: v.studentId ?? null, guestId: v.guestId ?? null,
      snapName: name, snapGrade: grade, snapGender: gender,
      ...(addr ? { addressId: addr.id, ...seat } : {}) };
    if (existing) return bus.saveRunRider({ ...existing, ...patch, ...(await revive(existing)) });
    try {
      return await bus.saveRunRider({ id: generateId(), runId: run.id, runVehicleId: null, stopOrder: null,
        pinned: false, addedBy: await whoLabel(ctx), addedAt: nowIso(), droppedAt: null, droppedBy: null,
        notRiding: false, noShow: false, note: null, wasGuest: false, addressId: null, snapAddress: '', snapPlaceId: null, ...patch });
    } catch (err) {
      // Two leaders adding the same student/guest at once — see addRider's original comment
      // (same race, same fix): re-read and merge onto the winner's row.
      if ((err as { code?: string }).code !== '23505') throw err;
      const again = (await bus.listRunRiders(run.id)).find((r) => (v.studentId ? r.studentId === v.studentId : r.guestId === v.guestId));
      if (!again) throw err;
      return bus.saveRunRider({ ...again, ...patch, ...(await revive(again)) });
    }
  }

  /** BUS-2: where this address seats a rider tonight. A bus row + that bus running → on the bus at its drop-off;
   *  a bus row + no bus → their latest home address (addressId stays the bus row = still remembered);
   *  a home row → that address, and off any bus. null = bus row, no bus, no home address. */
  type Seat = Pick<BusRunRider, 'snapAddress' | 'snapPlaceId'> & Partial<Pick<BusRunRider, 'runVehicleId' | 'stopOrder' | 'pinned'>>;
  function busPatch(r: Pick<BusRunRider, 'runVehicleId'>, addr: BusAddress, rvs: BusRunVehicle[], owned: BusAddress[]): Seat | null {
    const off = rvs.some((v) => v.id === r.runVehicleId && isBus(v)) ? { runVehicleId: null, stopOrder: null, pinned: false } : {};
    if (!addr.vehicleId) return { snapAddress: addr.address, snapPlaceId: addr.placeId, ...off };
    const rv = rvs.find((v) => v.vehicleId === addr.vehicleId && isBus(v) && v.running);
    if (rv) return { snapAddress: rv.endsAddress ?? addr.address, snapPlaceId: rv.endsPlaceId,
      ...(r.runVehicleId === rv.id ? {} : { runVehicleId: rv.id, stopOrder: null, pinned: true }) };
    const home = latestHome(owned);
    return home ? { snapAddress: home.address, snapPlaceId: home.placeId, ...off } : null;
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
  async function pastRidersList(ctx: BusCtx, c: MinistryConfig, riders: BusRunRider[], cv: ConsentFn): Promise<BusPastRiderView[]> {
    if (!allowed(ctx, c, 'bus:roster')) return [];
    const onRun = new Set(riders.map(riderKey));
    const [addresses, guests, allStudents, forms] = await Promise.all([bus.listAllAddresses(), bus.listGuests(), students.findAll(), bus.listConsentForms()]);
    const guestById = new Map(guests.map((g) => [g.id, g]));
    const studentById = new Map(allStudents.map((s) => [s.id, s]));
    const latest = new Map<string, BusAddress>(); // owner key → their most-recently-used address
    for (const a of addresses) {
      const key = riderKey(a);
      const cur = latest.get(key);
      if (!cur || a.lastUsedAt > cur.lastUsedAt) latest.set(key, a);
    }
    // Operator 2026-10-23: a matched consent form for this consent year (R4) also lists them, address or not.
    const year = Number(ctx.localNow.slice(0, 4));
    const consented = new Map<string, BusConsentForm>(); // owner key → their newest current-year form
    for (const f of forms) {
      if (f.year !== year || !(f.studentId || f.guestId)) continue;
      const key = riderKey(f), cur = consented.get(key);
      if (!cur || f.submittedAt > cur.submittedAt) consented.set(key, f);
    }
    const out: (Omit<BusPastRiderView, 'consent'> & { lastUsedAt: string; first: string; last: string })[] = [];
    for (const key of new Set([...latest.keys(), ...consented.keys()])) {
      if (onRun.has(key)) continue;
      const addr = latest.get(key), f = consented.get(key), owner = addr ?? f!;
      const p = owner.studentId ? studentById.get(owner.studentId) : owner.guestId ? guestById.get(owner.guestId) : undefined;
      if (!p) continue; // purged guest, or never existed
      const g = owner.studentId ? genderOf((p as { gender: string | null }).gender) : (p as { gender: BusGender }).gender;
      const at = [addr?.lastUsedAt ?? '', f?.submittedAt ?? ''].sort().pop()!; // recency = max(address last used, consent submitted)
      out.push({ studentId: owner.studentId ? p.id : null, guestId: owner.studentId ? null : p.id, addressId: addr?.id ?? null,
        name: `${p.firstName} ${p.lastName}`, grade: p.grade, gender: g, suburb: addr ? addrOut(addr).suburb : f!.data.address.city,
        lastUsedAt: at, first: p.firstName, last: p.lastName });
    }
    out.sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt) || a.name.localeCompare(b.name));
    // Operator 2026-10-23 (replaces N01b): the most recent 100 are kept, then shown by first name, then last name, any case.
    // The consent chip is the same per-request loader as tonight's riders (R7: no details for a junior leader).
    const cmp = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });
    return out.slice(0, PAST_RIDERS_CAP).sort((a, b) => cmp(a.first, b.first) || cmp(a.last, b.last))
      .map(({ lastUsedAt, first, last, ...rest }) => ({ ...rest, consent: cv(rest) }));
  }

  async function linkOne(guestId: string, studentId: string): Promise<void> {
    const g = await bus.getGuest(guestId);
    if (!g) throw new NotFoundError('Person not found');
    if (!(await students.findById(studentId))) throw new NotFoundError('Student not found');
    await bus.reassignGuestAddresses(guestId, studentId);
    await bus.reassignGuestConsentForms(guestId, studentId);
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
        else await bus.saveRunRider({ ...r, studentId, guestId: null, wasGuest: true });
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
    rvs: BusRunVehicle[];                // every run vehicle when prepared
  }
  /** Cars no bulk action touches: own cars (the leader's choice), locked cars (I11) and buses (BUS-2). */
  function fixedCarIdsOf(rvs: BusRunVehicle[]): Set<string> {
    return new Set(rvs.filter((v) => v.ownerLeaderId || v.locked || isBus(v)).map((v) => v.id));
  }
  /** BUS-2: re-apply every rider's bus choice after a bus is turned on/off, re-addressed or re-kinded, and before Generate.
   *  Own-car and locked-car riders and riders already dropped off are left alone. */
  async function syncBusRiders(run: BusRun): Promise<void> {
    const [rvs, riders, all] = await Promise.all([bus.listRunVehicles(run.id), ridingOf(run.id), bus.listAllAddresses()]);
    const byId = new Map(all.map((a) => [a.id, a]));
    for (const r of riders) {
      const addr = r.addressId ? byId.get(r.addressId) : undefined;
      const onBus = rvs.some((v) => v.id === r.runVehicleId && isBus(v));
      if (!addr || (!addr.vehicleId && !onBus) || r.droppedAt) continue; // ordinary rider (or no address) — untouched
      if (rvs.some((v) => v.id === r.runVehicleId && (v.ownerLeaderId || v.locked))) continue; // L1: Lock = leave alone
      const owned = all.filter((a) => (r.studentId ? a.studentId === r.studentId : a.guestId === r.guestId));
      const seat = busPatch(r, addr, rvs, owned) ?? NO_SEAT;
      const next = { ...r, ...seat };
      if (SEAT_KEYS.some((k) => next[k] !== r[k])) await bus.saveRunRider(next);
    }
  }
  /** Builds the fleet solve for Generate / Fit in (and R3's "Try +N cars"). Reads only. */
  async function prepareFleet(c: MinistryConfig, run: BusRun, mode: 'all' | 'fit'): Promise<FleetPrep> {
    const b = c.busMinistry;
    const [rvs, riders, all] = await Promise.all([bus.listRunVehicles(run.id), ridingOf(run.id), leaders.findAll()]);
    const genderBy = new Map(all.map((l) => [l.id, genderOf(l.gender)]));
    const known = (ids: string[]) => ids.filter((id) => genderBy.has(id));
    // I11: a locked car is left out of the solve like an own car — its riders, stop order and leaders stay as they are.
    const cars = rvs.filter((v) => v.running && v.vehicleId && !v.locked && !isBus(v));
    const buses = rvs.filter((v) => v.running && isBus(v) && !v.locked); // BUS-2: not solved, but the pool still fills them
    const fixedCarIds = fixedCarIdsOf(rvs);
    const fleetRiders = riders.filter((r) => !(r.runVehicleId && fixedCarIds.has(r.runVehicleId)));
    const busy = new Set(rvs.filter((v) => v.running).flatMap((v) => [...v.leaderIds, ...(v.ownerLeaderId ? [v.ownerLeaderId] : [])]));
    const pool = run.availablePoolLeaderIds.filter((id) => genderBy.has(id) && !busy.has(id)).map((id) => ({ id, gender: genderBy.get(id) ?? null }));
    const need = { female: fleetRiders.filter((r) => r.snapGender === 'female').length, male: fleetRiders.filter((r) => r.snapGender === 'male').length };
    // Known follow-up (2026-10-06): riders already fixed to a car (pinned, under Fit in, or with
    // no map pin at all — none of those are ever moved by this solve) must keep their seats —
    // auto-fill must not add a 2nd leader if that would drop capacity below how many of them there are.
    const fixedCount = new Map<string, number>();
    for (const r of fleetRiders) {
      if (r.runVehicleId && (r.pinned || r.droppedAt || mode === 'fit' || !r.snapPlaceId))
        fixedCount.set(r.runVehicleId, (fixedCount.get(r.runVehicleId) ?? 0) + 1);
    }
    const filled = autoFillPool([...cars, ...buses].map((v) => ({ id: v.id, seats: v.seats, leaderIds: known(v.leaderIds),
      fixedRiders: isBus(v) ? riders.filter((r) => r.runVehicleId === v.id).length : fixedCount.get(v.id) ?? 0,
      endsAt: v.endsAt, bus: isBus(v) })), // Task 9: don't maroon a pool leader in a car that ends at a drop-off address (a bus comes back)
      pool, (id) => genderBy.get(id) ?? null, need);
    const untouched = fleetRiders.filter((r) => !r.snapPlaceId);
    // A rider moved to Unassigned by hand (pinned, no car) stays unassigned under Fit in; Generate all re-places them.
    const solvable = fleetRiders.filter((r) => r.snapPlaceId && !(mode === 'fit' && r.pinned && !r.runVehicleId));
    const fleetCars: FleetCar[] = cars.map((v) => {
      const ids = filled.get(v.id) ?? known(v.leaderIds);
      // B1 (2026-10-20): preferred grades (vehicle or leader) no longer feed the solve.
      return { id: v.id,
        capacity: Math.max(0, capacityOf(v.seats, ids.length) - untouched.filter((r) => r.runVehicleId === v.id).length),
        eligibility: eligibilityOf(ids.map((id) => genderBy.get(id) ?? null)),
        endPlaceId: endPlaceOf(v.endsAt, v.endsPlaceId, b.churchPlaceId) };
    });
    const { problem, stopRiderIds } = buildFleetProblem(mode, fleetCars,
      solvable.map((r) => ({ id: r.id, placeId: r.snapPlaceId!, gender: r.snapGender, grade: r.snapGrade, runVehicleId: r.runVehicleId, pinned: r.pinned || !!r.droppedAt })), // already dropped off: never changes car
      b.churchPlaceId, leaveIso(run.serviceDate, b.leaveTime), b);
    return { problem, stopRiderIds, cars, filled, riders, untouched, rvs };
  }

  /** Single-car solve for one car's stop order (Move, own car). No church pin / Google down → keep the current order. */
  async function reorderCar(c: MinistryConfig, run: BusRun, rv: BusRunVehicle): Promise<boolean> {
    if (isBus(rv)) return true; // BUS-2: one drop-off, nothing to order
    const b = c.busMinistry;
    const all = (await ridingOf(run.id)).filter((x) => x.runVehicleId === rv.id)
      .sort((x, y) => (x.stopOrder ?? 999) - (y.stopOrder ?? 999));
    // Riders already dropped off stay first, in their existing order — only the rest are re-sequenced.
    const dropped = all.filter((x) => x.droppedAt).sort((x, y) => x.droppedAt!.localeCompare(y.droppedAt!));
    // The car is out on the road: sequence the remaining stops from the last drop-off, not the church.
    const startPlaceId = dropped[dropped.length - 1]?.snapPlaceId || b.churchPlaceId;
    const inCar = all.filter((x) => !x.droppedAt);
    const mapped = inCar.filter((x) => x.snapPlaceId);
    if (!b.churchPlaceId) return false;
    if (mapped.length < 2) return true; // nothing to re-order
    try {
      const res = await routing.solve(buildSingleProblem(mapped.map((x) => x.snapPlaceId!), startPlaceId,
        endPlaceOf(rv.endsAt, rv.endsPlaceId, b.churchPlaceId), leaveIso(run.serviceDate, b.leaveTime), b.targetRouteMin), routingDeadline());
      const order = res.routes[0]?.stops ?? [];
      if (order.length !== mapped.length) return false;
      const next = [...dropped, ...order.map((i) => mapped[i]!), ...inCar.filter((x) => !x.snapPlaceId)];
      for (const [i, x] of next.entries()) if (x.stopOrder !== i + 1) await bus.saveRunRider({ ...x, stopOrder: i + 1 });
      return true;
    } catch (err) {
      console.error('[bus] reorder skipped:', err instanceof Error ? err.message : err);
      return false;
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
  const pastMapCache = new Map<string, MapImage>(); // finished images only, keyed by run version — editPastRider's touch() bumps it
  async function analysisSolve(c: MinistryConfig, run: BusRun, signal: AbortSignal): Promise<AnalysisSolve> {
    const b = c.busMinistry;
    // M6: a Bus-settings change (church, leave time, target route length) doesn't bump the run
    // version, so without these in the key a warm instance would keep serving the old solve/map.
    const key = `${run.id}:${run.version}:${b.churchPlaceId}:${b.leaveTime}:${b.targetRouteMin}`;
    const cached = analysisCache.get(key);
    if (cached) return cached;
    if (!b.churchPlaceId) throw new BadRequestError(NO_CHURCH);
    const cars = (await bus.listRunVehicles(run.id)).filter((v) => v.running);
    const riders = (await ridingOf(run.id)).filter((r) => r.snapPlaceId && r.runVehicleId && cars.some((v) => v.id === r.runVehicleId));
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
    async carsView(ctx) {
      const c = await gate(ctx, 'bus:use');
      // ctx.asLeaderId is deliberately unused: everyone allowed sees the same view.
      const run = await ensureRun(ctx, c);
      const ridersP = ridingOf(run.id);
      const [vehicles, riders] = await Promise.all([vehicleViews(run.id, false, ridersP), ridersP]);
      const running = vehicles.filter((v) => v.running);
      const onCar = new Set(running.map((v) => v.id));
      // Built field by field — never spread a repo object into this response. A placed rider
      // with no stopOrder sorts last with no number; the rest are numbered 1..n like Assign.
      return {
        cars: running.map((v) => ({
          name: v.name, colourIndex: v.colourIndex, leaderNames: [...v.leaderNames],
          stops: riders.filter((r) => r.runVehicleId === v.id)
            .sort((a, b) => (a.stopOrder ?? 999) - (b.stopOrder ?? 999))
            .map((r, i) => ({ stop: r.stopOrder == null ? null : i + 1, name: r.snapName, grade: r.snapGrade ?? null,
              suburb: suburbOnly(r.snapAddress), dropped: !!r.droppedAt })),
        })),
        unassigned: riders.filter((r) => !r.runVehicleId || !onCar.has(r.runVehicleId)).length,
      };
    },
    async getVersion(ctx) {
      const c = await gate(ctx, 'bus:use');
      // R19-L3: ?date= polls the trip being viewed; no date = tonight. Polling never creates a trip's run.
      const run = await tripRunIfAny(ctx, c);
      return { runId: run?.id ?? null, version: run?.version ?? 0 };
    },
    // The edit-rider sheet's saved addresses, by rider — the current one first. (Was a name
    // search, which missed riders past the 5-guest cap or with a common name.)
    async riderAddresses(ctx, riderId) {
      await gate(ctx, 'bus:roster');
      const r = await bus.getRunRider(riderId);
      if (!r) throw new NotFoundError('Rider not found');
      const addrs = await bus.listAddresses(r.studentId ? { studentId: r.studentId } : { guestId: r.guestId! });
      return addrs.sort((a, b) => Number(b.id === r.addressId) - Number(a.id === r.addressId))
        .map(addrOut);
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
      const onTonight = (await ridingOf(run.id)).some((r) => (who.studentId ? r.studentId === who.studentId : r.guestId === who.guestId));
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
        .map(addrOut);
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
          const mine = await myStudentIds(ctx);
          pool = pool.filter((s) => mine.has(s.id));
        } else pool = pool.filter((s) => canAccessStudent(ctx.actor, s.grade, s.gender, c.structure));
      }
      const cv = await consentCtx(ctx, c);
      const addrsOf = async (who: { studentId: string } | { guestId: string }) =>
        full ? (await bus.listAddresses(who)).map(addrOut) : [];
      // Task 3 (owner): `street` is always the decrypted address's street part — a display
      // fallback for an address saved before the default-label fix, when `label` is still blank.
      const studentHits = await Promise.all(pool.slice(0, 15).map(async (s): Promise<BusSearchHit> => ({
        kind: 'student', id: s.id, name: `${s.firstName} ${s.lastName}`, grade: s.grade, gender: genderOf(s.gender), addresses: await addrsOf({ studentId: s.id }),
        consent: cv({ studentId: s.id, guestId: null }) })));
      const guestHits = await Promise.all((await bus.listGuests()).filter((g) => !g.linkedStudentId && nameMatches(q, g.firstName, g.lastName)).slice(0, 5)
        .map(async (g): Promise<BusSearchHit> => ({ kind: 'guest', id: g.id, name: `${g.firstName} ${g.lastName}`, grade: g.grade, gender: g.gender, addresses: await addrsOf({ guestId: g.id }),
          consent: cv({ studentId: null, guestId: g.id }) })));
      return [...studentHits, ...guestHits];
    },
    async addRider(ctx, input) {
      const c = await gate(ctx, 'bus:roster');
      const p = parseIn(AddRider, input);
      const v = await consentWhere(p, p);
      const run = await writableRun(ctx, c);
      if (lockActive(run)) throw lockConflict(run); // a solve in flight is working off this run's current roster
      const rider = await placeRider(ctx, run, v);
      await touch(ctx, run);
      return riderView(rider, await consentCtx(ctx, c, rider.runId));
    },
    async updateRider(ctx, riderId, input) {
      const c = await gate(ctx, 'bus:roster');
      const v = parseIn(UpdateRider, input);
      const run = await writableRun(ctx, c);
      if (lockActive(run)) throw lockConflict(run); // a solve in flight is using this rider's current address/pin
      const r = await bus.getRunRider(riderId);
      if (!r || r.runId !== run.id || r.notRiding) throw new NotFoundError('Rider not found');
      const owner = r.studentId ? { studentId: r.studentId } : { guestId: r.guestId! };
      const addr = await resolveAddress(owner, await consentWhere(v, owner), run);
      const seat = busPatch(r, addr, await bus.listRunVehicles(run.id), await bus.listAddresses(owner)); // BUS-2
      if (!seat) throw new BadRequestError(NO_BUS_NO_HOME);
      const saved = await bus.saveRunRider({ ...r, addressId: addr.id, ...seat });
      const rv = saved.runVehicleId ? (await bus.listRunVehicles(run.id)).find((x) => x.id === saved.runVehicleId && x.running) : undefined;
      if (rv) await reorderCar(c, run, rv); // a new address can change the best stop order
      await touch(ctx, run);
      return riderView(saved, await consentCtx(ctx, c, saved.runId));
    },
    async removeRider(ctx, riderId) {
      const c = await gate(ctx, 'bus:roster');
      const run = await writableRun(ctx, c);
      if (lockActive(run)) throw lockConflict(run); // a solve in flight is working off this run's current roster
      const r = await bus.getRunRider(riderId);
      if (!r || r.runId !== run.id || r.notRiding) throw new NotFoundError('Rider not found');
      // Task 5 (owner): "New Person" is a guest, not a platform student. If this is their only
      // bus_run_riders row in ANY run (and they were never linked to a real student) it was a
      // mistaken entry: fully delete the row, the guest and their saved addresses so "Pending new
      // people" drops accordingly. Anyone else is kept as a "not riding" row (history), never deleted.
      let mistaken = false;
      if (r.guestId) {
        const g = await bus.getGuest(r.guestId);
        if (g && !g.linkedStudentId) {
          const rows = await bus.listRunRidersOf((await bus.listRuns()).map((x) => x.id));
          mistaken = !rows.some((x) => x.guestId === r.guestId && x.id !== r.id);
        }
      }
      if (mistaken) { await bus.deleteRunRider(riderId); await bus.deleteGuest(r.guestId!); }
      else await bus.saveRunRider({ ...r, ...OFF_CAR, notRiding: true });
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
      const c = await gate(ctx, 'bus:use'); // 2026-10-15: Car setup is open to every Bus login
      const v = parseIn(SaveVehicle, input);
      assertRealPlaceId(v.endsPlaceId, v.endsAt === 'address'); // Task 2: required only when this save actually picks "ends at an address"
      const prior = v.id ? await bus.getVehicle(v.id) : null;
      if (v.id && !prior) throw new NotFoundError('Vehicle not found');
      const kind = v.kind ?? prior?.kind ?? 'car';
      if (kind === 'bus' && !(v.endsAt === 'address' && v.endsPlaceId)) throw new BadRequestError(BUS_NEEDS_DROP);
      const saved = await bus.saveVehicle({ id: v.id ?? generateId(), name: v.name, plate: v.plate, seats: v.seats,
        prefGrades: v.prefGrades, endsAt: v.endsAt, endsAddress: v.endsAddress, endsPlaceId: v.endsPlaceId,
        sort: v.sort, archived: v.archived, createdAt: prior?.createdAt ?? nowIso(), updatedAt: nowIso(), kind });
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
        else if (rv) await saveRV({ ...rv, name: saved.name, seats: saved.seats, plate: saved.plate, kind: saved.kind,
          ...(isBus(saved) ? { endsAt: saved.endsAt, endsAddress: saved.endsAddress, endsPlaceId: saved.endsPlaceId } : {}) });
        else if (!saved.archived) await saveRV({ id: generateId(), runId: run.id, vehicleId: saved.id, ownerLeaderId: null,
          name: saved.name, seats: saved.seats, plate: saved.plate, running: true, leaderIds: [], endsAt: saved.endsAt,
          endsAddress: saved.endsAddress, endsPlaceId: saved.endsPlaceId, colourIndex: rvs.length, locked: false, kind: saved.kind });
        await syncBusRiders(run);
        await touch(ctx, run);
      }
      return saved;
    },
    async updateRunVehicle(ctx, id, input) {
      const c = await gate(ctx, 'bus:use'); // 2026-10-15: Car setup is open to every Bus login
      const v = parseIn(UpdateRunVehicle, input);
      // I11: Car setup stays bus:use, but only a coordinator can tick or untick Lock.
      if (v.locked !== undefined && !allowed(ctx, c, 'bus:coordinate')) throw new ForbiddenError('Only a coordinator can lock a car');
      // SY-03: joining a car would open its riders' addresses + phones in My car to a "My car only" login.
      if (v.leaderIds && isRedactedLeader(ctx, c)) throw new ForbiddenError("Ask a coordinator to change a car's leaders");
      if (v.running === false) v.locked = false; // a car turned off is not locked; it starts fresh if turned back on
      assertRealPlaceId(v.endsPlaceId, v.endsAt === 'address'); // Task 2: required only when this patch sets "ends at an address"
      const run = await writableRun(ctx, c);
      if (lockActive(run)) throw lockConflict(run); // I1: a solve in flight is using this car's current seats/running state
      const rv = (await bus.listRunVehicles(run.id)).find((x) => x.id === id);
      if (!rv) throw new NotFoundError('Car not found');
      if (isBus(rv) && ((v.endsAt && v.endsAt !== 'address') || v.endsPlaceId === null)) throw new BadRequestError(BUS_NEEDS_DROP); // L6
      await saveRV({ ...rv, ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) } as BusRunVehicle);
      if (v.running === false) {
        for (const r of (await bus.listRunRiders(run.id)).filter((r) => r.runVehicleId === id))
          await bus.saveRunRider({ ...r, runVehicleId: null, stopOrder: null, pinned: false });
      }
      if (isBus(rv)) await syncBusRiders(run);
      await touch(ctx, run);
      return (await vehicleViews(run.id)).find((x) => x.id === id)!;
    },
    async setPool(ctx, input) {
      const c = await gate(ctx, 'bus:use'); // 2026-10-15: Car setup is open to every Bus login
      const v = parseIn(SetPool, input);
      const run = await writableRun(ctx, c);
      if (lockActive(run)) throw lockConflict(run); // I1: the pool feeds the solve's auto-fill — don't change it mid-solve
      await bus.setPoolIds(run.id, v.availableLeaderIds);
      await touch(ctx, run);
    },
    async setLeaderPrefs(ctx, leaderId, input) {
      const c = await gate(ctx, 'bus:use'); // 2026-10-15: Car setup is open to every Bus login
      const v = parseIn(LeaderPrefsIn, input);
      if (!(await leaders.findById(leaderId))) throw new NotFoundError('Leader not found');
      const run = await ensureRun(ctx, c);
      if (lockActive(run)) throw lockConflict(run); // I1: inPool feeds the solve's auto-fill
      const p = (await bus.getLeaderPrefs(leaderId)) ?? { id: leaderId, inPool: false, ownCar: null, lastOwnRiderKeys: [], prefGrades: [] };
      await bus.saveLeaderPrefs({ ...p, ...(v.inPool !== undefined ? { inPool: v.inPool } : {}),
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
      // BUS-1: never force an end address — "address" with nothing picked is just the last drop.
      if (v.car.endsAt === 'address' && !v.car.endsPlaceId) v.car = { ...v.car, endsAt: 'last_drop', endsAddress: null };
      assertRealPlaceId(v.car.endsPlaceId, v.car.endsAt === 'address'); // Task 2: required only when ending at an address
      const run = await tripRunForWrite(ctx, c);
      if (lockActive(run)) throw lockConflict(run); // a solve in flight is working off this run's current roster
      // Owner (2026-10-07): newRiders are created here, inside the SAME bus:use-gated call and
      // under the SAME lock check above — a junior leader with no bus:roster places someone new
      // straight into their own car via placeRider (addRider's shared internals). Anyone already
      // on tonight's run is left alone and just folded into riderIds below, never re-written.
      let riders = await ridingOf(run.id);
      const rvs = await bus.listRunVehicles(run.id);
      const prior = rvs.find((x) => x.ownerLeaderId === me);
      // Review B: never silently move a rider — anyone already in another car/bus that night stays there and is named back.
      const elsewhere = (r: BusRunRider) => rvs.find((x) => x.id === r.runVehicleId && x.id !== prior?.id);
      const skipped: { name: string; car: string }[] = [];
      // Fail fast BEFORE creating any guest/rider, so a rejected save leaves nothing behind.
      for (const id of v.riderIds) if (!riders.some((r) => r.id === id)) throw new NotFoundError('Rider not found');
      if (isRedactedLeader(ctx, c)) {
        // SY-04: My car shows full addresses + phones, so a "My car only" login takes only riders already in its
        // car or its own connected students (as search() offers); walk-in guests stay open (search lists them).
        const mine = await myStudentIds(ctx);
        const ok = (r?: BusRunRider) => !!r && ((!!prior && r.runVehicleId === prior.id) || (!!r.studentId && mine.has(r.studentId)));
        const refuse = () => new ForbiddenError('You can only add your own students to your car');
        for (const id of v.riderIds) if (!ok(riders.find((r) => r.id === id))) throw refuse();
        for (const nr of v.newRiders) if (nr.studentId && !mine.has(nr.studentId) && !ok(riders.find((r) => r.studentId === nr.studentId))) throw refuse();
      }
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
        if (already && elsewhere(already)) { newRiderIds.push(already.id); continue; } // skipped below, address untouched
        // BUS-1 B6: an address-less rider already on this run (e.g. a removed trip re-logged) takes the address
        // the leader just gave; a rider who already has one keeps it.
        if (already && (already.addressId || !(nr.addressId || nr.newAddress))) { newRiderIds.push(already.id); continue; }
        const rider = await placeRider(ctx, run, { studentId, guestId, addressId: nr.addressId, newAddress: nr.newAddress });
        riders = [...riders, rider];
        newRiderIds.push(rider.id);
      }
      // I6: validate BEFORE writing the car — the old order saved the car first and only
      // then checked capacity/rider ids, leaving a created-or-resized car behind on a 400/404.
      const byId = new Map(riders.map((r) => [r.id, r]));
      for (const id of [...v.riderIds, ...newRiderIds]) if (!byId.has(id)) throw new NotFoundError('Rider not found');
      const riderIds = [...new Set([...v.riderIds, ...newRiderIds])].filter((id) => {
        const r = byId.get(id)!, car = elsewhere(r);
        if (car) skipped.push({ name: r.snapName, car: car.name });
        return !car;
      });
      if (riderIds.length > capacityOf(v.car.seats, 1)) throw new BadRequestError(`${v.car.name} only has ${capacityOf(v.car.seats, 1)} seats`);
      // Review leftover: every picked rider is elsewhere and there is no trip yet — don't save an empty car.
      // (An existing trip still saves, so a leader can change their car details.)
      if (!prior && !riderIds.length && skipped.length) {
        const by = new Map<string, string[]>();
        for (const x of skipped) by.set(x.car, [...(by.get(x.car) ?? []), x.name]);
        throw new BadRequestError('Not saved. ' + [...by].map(([car, names]) => `${names.join(', ')}: already in ${car}`).join('; ') + ' — move them in Assign');
      }
      const rv = await saveRV({ id: prior?.id ?? generateId(), runId: run.id, vehicleId: null, ownerLeaderId: me,
        name: v.car.name, seats: v.car.seats, plate: v.car.plate, running: true, leaderIds: [me],
        endsAt: v.car.endsAt, endsAddress: v.car.endsAddress, endsPlaceId: v.car.endsPlaceId,
        colourIndex: prior?.colourIndex ?? rvs.length, leaderSnap: prior?.leaderSnap, locked: prior?.locked ?? false });
      for (const r of riders.filter((r) => r.runVehicleId === rv.id && !riderIds.includes(r.id)))
        await bus.saveRunRider({ ...r, runVehicleId: null, stopOrder: null, pinned: false });
      for (const [i, id] of riderIds.entries()) {
        await bus.saveRunRider({ ...byId.get(id)!, runVehicleId: rv.id, stopOrder: i + 1, pinned: true });
      }
      await reorderCar(c, run, rv);
      const prefs = (await bus.getLeaderPrefs(me)) ?? { id: me, inPool: false, ownCar: null, lastOwnRiderKeys: [], prefGrades: [] };
      await bus.saveLeaderPrefs({ ...prefs, ownCar: v.car as BusOwnCar,
        lastOwnRiderKeys: riders.filter((r) => riderIds.includes(r.id)).map(riderKey) });
      await bus.setUndo(run.id, null, null); // I2: these riders just moved into an own car — a later Undo must not pull them back out
      await touch(ctx, run);
      return { ...(await vehicleViews(run.id)).find((x) => x.id === rv.id)!, skipped };
    },
    async removeOwnCar(ctx, ownerLeaderId) {
      let c = await gate(ctx, 'bus:use');
      // Removing ANOTHER leader's own car (Car setup's trash button) is a coordinator action.
      const other = !!ownerLeaderId && ownerLeaderId !== selfLeaderId(ctx);
      if (other) c = await gate(ctx, 'bus:coordinate');
      const me = other ? ownerLeaderId : selfLeaderId(ctx);
      const run = await tripRunForWrite(ctx, c);
      if (lockActive(run)) throw lockConflict(run); // a solve in flight is working off this run's current roster
      const rv = (await bus.listRunVehicles(run.id)).find((x) => x.ownerLeaderId === me);
      if (!rv) return;
      // rel19: on a non-bus night (a dated trip) there's no Assign to pick them up, so the trip's riders go with it.
      const trip = !isServiceDay(run.serviceDate, c.structure.serviceDayOfWeek);
      for (const r of (await bus.listRunRiders(run.id)).filter((r) => r.runVehicleId === rv.id))
        await (trip ? bus.deleteRunRider(r.id) : bus.saveRunRider({ ...r, runVehicleId: null, stopOrder: null, pinned: false }));
      await bus.deleteRunVehicle(rv.id);
      // Review: the last trip gone → its "not riding" rows go too, so Past shows no empty date.
      if (trip && !(await bus.listRunVehicles(run.id)).length)
        for (const r of (await bus.listRunRiders(run.id)).filter((x) => x.notRiding)) await bus.deleteRunRider(r.id);
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
      const run = await tripRunForWrite(ctx, c);
      if (lockActive(run)) throw lockConflict(run);
      const views = await vehicleViews(run.id);
      const vehicle = views.find((x) => x.running && (x.ownerLeaderId === me || x.leaderIds.includes(me)));
      if (!vehicle) throw new NotFoundError('Car not found');
      const inCar = (await ridingOf(run.id)).filter((r) => r.runVehicleId === vehicle.id);
      const currentIds = new Set(inCar.map((r) => r.id));
      const given = [...v.riderIds, ...v.removeIds];
      const givenSet = new Set(given);
      if (givenSet.size !== given.length || givenSet.size !== currentIds.size || [...givenSet].some((id) => !currentIds.has(id)))
        throw new ConflictError('Your car changed — refresh');
      const byId = new Map(inCar.map((r) => [r.id, r]));
      for (const [i, id] of v.riderIds.entries()) await bus.saveRunRider({ ...byId.get(id)!, stopOrder: i + 1, pinned: true });
      for (const id of v.removeIds) await bus.saveRunRider({ ...byId.get(id)!, ...OFF_CAR, notRiding: true }); // kept as "not riding"; a guest is never hard-deleted — see comment above
      await bus.setUndo(run.id, null, null);
      await touch(ctx, run);
      return (await vehicleViews(run.id)).find((x) => x.id === vehicle.id)!;
    },
    // My car "Reset to optimal order": re-solve the stop order of the acting leader's car.
    async optimiseMyCar(ctx) {
      const c = await gate(ctx, 'bus:use');
      const me = selfLeaderId(ctx);
      if (!me) throw new BadRequestError('Choose who you are first');
      const run = await tripRunForWrite(ctx, c);
      if (lockActive(run)) throw lockConflict(run);
      const rv = (await bus.listRunVehicles(run.id)).find((x) => x.running && (x.ownerLeaderId === me || x.leaderIds.includes(me)));
      if (!rv) throw new NotFoundError('Car not found');
      const optimised = await reorderCar(c, run, rv);
      await touch(ctx, run);
      return { ...(await vehicleViews(run.id)).find((x) => x.id === rv.id)!, optimised };
    },
    async moveRider(ctx, riderId, input) {
      const c = await gate(ctx, 'bus:coordinate');
      const v = parseIn(MoveIn, input);
      const run = await writableRun(ctx, c);
      if (lockActive(run)) throw lockConflict(run);
      const r = await bus.getRunRider(riderId);
      if (!r || r.runId !== run.id || r.notRiding) throw new NotFoundError('Rider not found');
      const rvs = await bus.listRunVehicles(run.id);
      const owner = r.studentId ? { studentId: r.studentId } : { guestId: r.guestId! };
      const target = v.runVehicleId ? rvs.find((x) => x.id === v.runVehicleId && x.running) : null;
      const ontoBus = !!target && isBus(target);
      let cur = r;
      // BUS-2: onto a bus = their bus choice (never "full"); off a bus = back to their home address. busPatch seats both.
      if (!v.unpin && (ontoBus || rvs.some((x) => x.id === r.runVehicleId && isBus(x)))) {
        const owned = await bus.listAddresses(owner), home = latestHome(owned);
        // R19-L5/K1: off the bus with no home = no address (no pin), never the bus drop-off; the row is kept.
        const addr = ontoBus || home ? await resolveAddress(owner, ontoBus ? { busRunVehicleId: target!.id } : { addressId: home!.id }, run) : null;
        cur = await bus.saveRunRider({ ...r, ...(addr ? { addressId: addr.id, ...busPatch(r, addr, rvs, owned)! } : { addressId: null, ...NO_SEAT }) });
        if (ontoBus) {
          await bus.setUndo(run.id, null, null); await touch(ctx, run);
          return { ...riderView(cur, await consentCtx(ctx, c, cur.runId)), reordered: true };
        }
      }
      if (v.unpin) { // keeps the rider's current car/stop — works pinned-in-a-car or pinned-in-Unassigned
        const saved = await bus.saveRunRider({ ...r, pinned: false });
        await bus.setUndo(run.id, null, null); // I2: survive Undo like moveRider's other writes
        await touch(ctx, run);
        return { ...riderView(saved, await consentCtx(ctx, c, saved.runId)), reordered: true };
      }
      if (v.runVehicleId === null) {
        // Owner 2026-10-06: Unassigned is never pinned — the next Generate / Fit in places them again.
        const saved = await bus.saveRunRider({ ...cur, runVehicleId: null, stopOrder: null, pinned: false });
        await bus.setUndo(run.id, null, null); // I2: a hand-moved rider must survive a later Undo, not be reverted by it
        await touch(ctx, run);
        return { ...riderView(saved, await consentCtx(ctx, c, saved.runId)), reordered: true };
      }
      const rv = target;
      if (!rv) throw new NotFoundError('Car not found');
      const inCar = (await ridingOf(run.id)).filter((x) => x.runVehicleId === rv.id && x.id !== r.id);
      // I7: a leader removed from the roster can still be named in this car's raw leaderIds —
      // vehicleViews/prepareFleet already filter them out of capacity/eligibility; Move must too,
      // or a free seat behind a now-deleted leader gets rejected as "full".
      const knownLeaders = new Set((await leaders.findAll()).map((l) => l.id));
      const activeLeaderCount = rv.leaderIds.filter((id) => knownLeaders.has(id)).length;
      if (inCar.length >= capacityOf(rv.seats, activeLeaderCount)) throw new BadRequestError(`${rv.name} is full`);
      const maxStop = Math.max(0, ...inCar.map((x) => x.stopOrder ?? 0));
      const saved = await bus.saveRunRider({ ...cur, runVehicleId: rv.id, stopOrder: maxStop + 1, pinned: true });
      const reordered = await reorderCar(c, run, rv); // R1 appended last; R2 re-orders with a single-car solve (falls back to appended)
      await bus.setUndo(run.id, null, null); // I2: see above
      await touch(ctx, run);
      const fresh = (await bus.getRunRider(saved.id)) ?? saved;
      return { ...riderView(fresh, await consentCtx(ctx, c, fresh.runId)), reordered };
    },
    async consentStatus(ctx) {
      const c = await gate(ctx, 'bus:use');
      const coord = allowed(ctx, c, 'bus:coordinate') || ctx.actor.role === 'admin';
      const open = ext.link ? (await ext.link.listActions({ types: ['busConsentCheck'], statuses: ['pending', 'claimed'] }))
        .filter((r) => Date.now() - Date.parse(r.createdAt) < CHECK_STALE_MS) : [];
      const forms = coord ? await bus.listConsentForms() : [];
      return { year: Number(ctx.localNow.slice(0, 4)), lastChecked: c.busMinistry.consentLastChecked, lastNew: c.busMinistry.consentLastNew,
        checking: open.length > 0, canCheck: coord && !!ext.link,
        unmatched: coord ? forms.filter((f) => !f.studentId && !f.guestId).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
          .map((f) => ({ name: `${f.first} ${f.last}`, submittedAt: f.submittedAt })) : null };
    },
    async consentCheck(ctx) {
      const c = await gate(ctx, 'bus:use');
      if (!(allowed(ctx, c, 'bus:coordinate') || ctx.actor.role === 'admin')) throw new ForbiddenError('Only bus coordinators and admins can check for consent forms');
      return queueCheck(ctx);
    },
    async consentForms(ctx) { // consent hub (2026-10-23): Bus > Forms, coordinators and admins (names only, never a parent's details)
      const c = await gate(ctx, 'bus:use');
      if (!(allowed(ctx, c, 'bus:coordinate') || ctx.actor.role === 'admin')) throw new ForbiddenError('Only bus coordinators and admins can see consent forms');
      return { rows: (await bus.listConsentForms()).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
        .map((f) => ({ name: `${f.first} ${f.last}`.trim(), submittedAt: f.submittedAt, year: f.year, matched: !!(f.studentId || f.guestId) })) };
    },
    async consentPrefill(ctx, q) {
      const c = await gate(ctx, 'bus:use');
      let who = { studentId: q.studentId ?? null, guestId: q.studentId ? null : q.guestId ?? null };
      if (q.riderId) { // F6
        const r = await bus.getRunRider(q.riderId);
        if (!r) throw new NotFoundError('Rider not found');
        who = { studentId: r.studentId, guestId: r.studentId ? null : r.guestId };
      }
      const s = who.studentId ? await students.findById(who.studentId) : null, g = who.guestId ? await bus.getGuest(who.guestId) : null;
      if (!s && !g) throw new NotFoundError('Person not found');
      const sex = s ? s.gender : g!.gender;
      const base = { first: s ? s.firstName : g!.firstName, last: s ? s.lastName : g!.lastName, grade: s ? s.grade : g!.grade,
        gender: sex === 'female' ? 'f' : sex === 'male' ? 'm' : '', declaration: c.busMinistry.consentDeclaration };
      if (isRedactedLeader(ctx, c)) return base; // R7: a junior leader files with app basics only, never a parent's details
      const mark = await dnc.forActor(ctx.actor);
      const f = latestForm(await bus.listConsentForms(), who);
      const home = !f ? latestHome(await bus.listAddresses(who.studentId ? { studentId: who.studentId } : { guestId: who.guestId! })) : undefined;
      return mark({ ...base, mobile: s ? s.mobile : g!.phone, parentPhone: s?.parentPhone ?? f?.data.parentPhone ?? null,
        school: f?.data.school ?? '', parentName: f?.data.parentName ?? '', pickup: f?.data.pickup ?? null, pickupBy: f?.data.pickupBy ?? '',
        address: f ? f.data.address : home ? { line1: streetOf(home.address), line2: '', postcode: '', city: suburbOf(home.address), state: '' } : null }, who.studentId);
    },
    async consentSubmit(ctx, input) {
      await gate(ctx, 'bus:use');
      const i = (input ?? {}) as Record<string, unknown>;
      if (i.readOut !== true) throw new BadRequestError('Tick that you read the declaration to the parent');
      if (!ext.newYouth) throw new AppError('ELVANTO_NOT_SET', "The bus consent form isn't set up here yet. Ask your admin.", 409);
      let who = { studentId: typeof i.studentId === 'string' ? i.studentId : null,
        guestId: typeof i.studentId === 'string' ? null : typeof i.guestId === 'string' ? i.guestId : null };
      if (typeof i.riderId === 'string') { // F6: a redacted junior view has no studentId/guestId
        const r = await bus.getRunRider(i.riderId);
        if (!r) throw new NotFoundError('Rider not found');
        who = { studentId: r.studentId, guestId: r.studentId ? null : r.guestId };
      }
      const r = await ext.newYouth.sendBusConsent(ctx.actor, input); // 4xx/5xx refusals throw before any POST: no audit row then
      // The form is in Elvanto now: nothing below may turn the reply into an error (a leader would file it twice).
      if (!r.repeat) { // F20: a double tap answers the first send again; it is not a second submit
        try {
          await bus.insertConsentSubmit({ id: generateId(), ...who, leaderId: selfLeaderId(ctx), leaderName: await whoLabel(ctx), submittedAt: nowIso(),
            readOutConfirmed: true, elvantoResult: r.result === 'sent' ? 'sent' : r.result === 'failed' ? 'failed' : 'unconfirmed',
            first: String(i.first ?? ''), last: String(i.last ?? '') });
        } catch (err) { log.error('bus consent audit row not saved', { result: r.result, code: (err as { code?: string }).code ?? 'unknown' }); }
      }
      if (r.result === 'sent' && ext.link) {
        try { await queueCheck(ctx); } catch (err) {
          // LinkUnavailable = no console lists the type yet: Friday's checks pick the form up. Anything else is logged (code only).
          if (!(err instanceof LinkUnavailable)) log.error('bus consent check not queued', { code: (err as { code?: string }).code ?? 'unknown' });
        }
      }
      return r;
    },
    async setDropped(ctx, riderId, input) {
      const c = await gate(ctx, 'bus:use');
      const v = parseIn(DroppedIn, input);
      const run = await tripRunIfAny(ctx, c);
      const r = await bus.getRunRider(riderId);
      if (!run || !r || r.runId !== run.id || r.notRiding) throw new NotFoundError('Rider not found');
      // 2026-10-15 (operator): any Bus login can mark a drop-off on any car.
      const saved = await bus.saveRunRider({ ...r, droppedAt: v.dropped ? (v.at ?? nowIso()) : null,
        droppedBy: v.dropped ? await whoLabel(ctx) : null });
      await touch(ctx, run);
      return riderView(saved, await consentCtx(ctx, c, saved.runId));
    },
    async myCar(ctx) {
      const c = await gate(ctx, 'bus:use');
      const me = selfLeaderId(ctx);
      const run = await tripRunIfAny(ctx, c); // browsing a date never creates its run
      if (!run) return { vehicle: null, stops: [], churchAddress: c.busMinistry.churchAddress, churchPlaceId: c.busMinistry.churchPlaceId,
        ownCarDraft: me ? { car: (await bus.getLeaderPrefs(me))?.ownCar ?? null, riderIds: [] } : null, onCarLeaders: [] };
      const views = await vehicleViews(run.id);
      const vehicle = me ? views.find((v) => v.running && (v.ownerLeaderId === me || v.leaderIds.includes(me))) ?? null : null;
      const stops: MyCarView['stops'] = [];
      if (vehicle) {
        const mine = (await ridingOf(run.id)).filter((r) => r.runVehicleId === vehicle.id)
          .sort((a, b) => (a.stopOrder ?? 999) - (b.stopOrder ?? 999));
        const [mark, cv] = await Promise.all([dnc.forActor(ctx.actor), consentCtx(ctx, c, run.id)]);
        for (const r of mine) {
          const mobile = r.studentId ? (await students.findById(r.studentId))?.mobile ?? null
            : r.guestId ? (await bus.getGuest(r.guestId))?.phone ?? null : null;
          // R1: a guest has no roster row, so studentId null = never DNC.
          stops.push(mark({ ...riderView(r, cv), mobile }, r.studentId));
        }
      }
      let ownCarDraft: MyCarView['ownCarDraft'] = null;
      if (me && !vehicle) {
        const p = await bus.getLeaderPrefs(me);
        const tonight = await ridingOf(run.id);
        const mine = isRedactedLeader(ctx, c) ? await myStudentIds(ctx) : null; // SY-04: pre-tick only what saveOwnCar takes
        ownCarDraft = { car: p?.ownCar ?? null,
          riderIds: tonight.filter((r) => !r.runVehicleId && p?.lastOwnRiderKeys.includes(riderKey(r))
            && (!mine || (!!r.studentId && mine.has(r.studentId)))).map((r) => r.id) }; // review B
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
    // Past-nights history: nights before tonight (>= from) with their riders/cars, plus one row per
    // ride for the table + export. Built from batch reads; firstTime looks at ALL history, not the window.
    async history(ctx, from) {
      const c = await gate(ctx, 'bus:coordinate');
      if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new BadRequestError('Bad from date');
      const today = currentRunDate(ctx.localNow, c.structure.serviceDayOfWeek);
      const floor = from || (() => { const d = new Date(`${today}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() - 1); return d.toISOString().slice(0, 10); })();
      const canEdit = allowed(ctx, c, 'bus:analysis');
      const past = (await bus.listRuns()).filter((r) => r.serviceDate < today); // newest first
      const windowRuns = past.filter((r) => r.serviceDate >= floor);
      const dateOf = new Map(past.map((r) => [r.id, r.serviceDate]));
      const winIds = windowRuns.map((r) => r.id);
      const [allRows, vehicles, allLeaders, edits] = await Promise.all([
        bus.listRunRidersOf(past.map((r) => r.id)), bus.listRunVehiclesOf(winIds), leaders.findAll(),
        canEdit ? bus.listRunEdits(winIds) : Promise.resolve([]),
      ]);
      const firstRide = new Map<string, string>(); // person → date of their first ride ever
      for (const r of allRows) {
        if (r.notRiding) continue;
        const d = dateOf.get(r.runId)!, k = riderKey(r), cur = firstRide.get(k);
        if (!cur || d < cur) firstRide.set(k, d);
      }
      const live = new Map(allLeaders.map((l) => [l.id, l.fullName]));
      const nights: BusHistoryNight[] = [], rides: BusHistoryRide[] = [];
      for (const run of windowRuns) {
        const rows = allRows.filter((r) => r.runId === run.id);
        if (!rows.length) continue;
        const cars = vehicles.filter((v) => v.runId === run.id), running = cars.filter((v) => v.running);
        const carById = new Map(cars.map((v) => [v.id, v]));
        const riding = rows.filter((r) => !r.notRiding);
        const placed = riding.filter((r) => r.runVehicleId && carById.get(r.runVehicleId)?.running).length;
        nights.push({ id: run.id, date: run.serviceDate, trip: !isServiceDay(run.serviceDate, c.structure.serviceDayOfWeek), riders: riding.length, placed, unassigned: riding.length - placed,
          dropped: riding.filter((r) => r.droppedAt).length, notRiding: rows.length - riding.length, noShow: riding.filter((r) => r.noShow).length,
          cars: running.length, seats: running.reduce((n, v) => n + v.seats, 0),
          leaders: [...new Set(running.flatMap((v) => leaderNamesOf(v, live)))], guests: riding.filter((r) => r.guestId).length,
          firstTime: riding.filter((r) => firstRide.get(riderKey(r)) === run.serviceDate).length,
          ...(canEdit ? { edits: edits.filter((e) => e.runId === run.id).map((e) => ({ at: e.at, by: e.by, detail: e.detail })) } : {}) });
        for (const r of [...rows].sort((a, b) => (carById.get(a.runVehicleId ?? '')?.colourIndex ?? 99) - (carById.get(b.runVehicleId ?? '')?.colourIndex ?? 99)
          || (a.stopOrder ?? 999) - (b.stopOrder ?? 999) || a.snapName.localeCompare(b.snapName))) {
          const car = r.runVehicleId ? carById.get(r.runVehicleId) ?? null : null;
          rides.push({ runId: run.id, date: run.serviceDate, riderId: r.id, studentId: r.studentId, guestId: r.guestId,
            kind: r.guestId ? 'guest' : 'student', name: r.snapName, grade: r.snapGrade, gender: r.snapGender,
            car: car ? (isBus(car) ? `${car.name} (bus)` : car.name) : null, carColour: car?.colourIndex ?? null, runVehicleId: car?.id ?? null, leaders: car ? leaderNamesOf(car, live) : [],
            stop: r.stopOrder, address: r.snapAddress, suburb: suburbOf(r.snapAddress), droppedAt: r.droppedAt, droppedBy: r.droppedBy,
            addedBy: r.addedBy, notRiding: r.notRiding, noShow: r.noShow, note: r.note });
        }
      }
      return { canEdit, nights, rides };
    },
    // Director/admin correction of a finished night: no routing, no lock; every change is logged.
    async editPastRider(ctx, runId, riderId, input) {
      const c = await gate(ctx, 'bus:analysis');
      const v = parseIn(EditPastIn, input);
      const run = await bus.getRun(runId);
      if (!run) throw new NotFoundError('Night not found');
      if (!isPast(run, ctx, c)) throw new BadRequestError('Only finished nights can be edited');
      const r = await bus.getRunRider(riderId);
      if (!r || r.runId !== run.id) throw new NotFoundError('Rider not found');
      const cars = await bus.listRunVehicles(run.id);
      const carName = (id: string | null) => (id ? cars.find((x) => x.id === id)?.name ?? 'removed car' : 'Unassigned');
      const next = { ...r };
      const parts: string[] = [];
      if (v.notRiding !== undefined && v.notRiding !== r.notRiding) {
        next.notRiding = v.notRiding;
        if (v.notRiding) Object.assign(next, OFF_CAR);
        parts.push(`not riding: ${r.notRiding ? 'yes' : 'no'} → ${v.notRiding ? 'yes' : 'no'}`);
      }
      if (v.runVehicleId !== undefined && !next.notRiding && v.runVehicleId !== r.runVehicleId) {
        if (v.runVehicleId && !cars.some((x) => x.id === v.runVehicleId)) throw new NotFoundError('Car not found');
        const last = Math.max(0, ...(await bus.listRunRiders(run.id)).filter((x) => x.runVehicleId === v.runVehicleId && x.id !== r.id).map((x) => x.stopOrder ?? 0));
        next.runVehicleId = v.runVehicleId; next.stopOrder = v.runVehicleId ? last + 1 : null; next.pinned = false;
        parts.push(`car ${carName(r.runVehicleId)} → ${carName(v.runVehicleId)}`);
      }
      if (v.droppedAt !== undefined && v.droppedAt !== r.droppedAt) {
        next.droppedAt = v.droppedAt; next.droppedBy = v.droppedAt ? r.droppedBy ?? await whoLabel(ctx) : null;
        parts.push(`dropped ${r.droppedAt ? clockAt(r.droppedAt, c.structure.timeZone) : 'none'} → ${v.droppedAt ? clockAt(v.droppedAt, c.structure.timeZone) : 'none'}`);
      }
      if (v.noShow !== undefined && v.noShow !== r.noShow) { next.noShow = v.noShow; parts.push(`no-show: ${r.noShow ? 'yes' : 'no'} → ${v.noShow ? 'yes' : 'no'}`); }
      if (v.note !== undefined && (v.note || null) !== r.note) { next.note = v.note || null; parts.push(next.note ? 'note edited' : 'note cleared'); }
      if (!parts.length) return { ok: true };
      await bus.saveRunRider(next);
      const by = await whoLabel(ctx);
      await bus.insertRunEdit({ id: generateId(), runId: run.id, at: nowIso(), by, detail: `${r.snapName}: ${parts.join('; ')}${v.reason ? ` (${v.reason})` : ''}` });
      await touch(ctx, run);
      return { ok: true };
    },
    async autocomplete(ctx, q, session) {
      const c = await gate(ctx, 'bus:use');
      const input = q.trim();
      if (input.length < 3 || input.length > 120) return [];
      const token = SESSION_RE.test(session) ? session : generateId();
      try { return await routing.autocomplete(input, token, routingDeadline()); }
      catch (err) { throw routingFailed(err, SEARCH_FAILED); }
    },
    // Operator 2026-10-23: the consent form sheet's Address search fills the five lines from the picked place.
    async placeDetails(ctx, placeId, session) {
      await gate(ctx, 'bus:use');
      if (!PLACE_ID_RE.test(placeId)) throw new BadRequestError('Pick the address from the suggestions list');
      const token = SESSION_RE.test(session) ? session : generateId();
      try { return await routing.addressDetails(placeId, token, routingDeadline()); }
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
        await syncBusRiders(run); // BUS-2: "on auto-assign they get put in that bus"
        const prep = await prepareFleet(c, run, mode);
        const busRunning = prep.rvs.some((v) => v.running && isBus(v));
        if (!prep.problem.vehicles.length && !busRunning) throw new BadRequestError(prep.rvs.some((v) => v.running && v.locked)
          ? 'Every car is locked. Untick Lock on a car to Generate' : 'Turn on at least one car in Car setup');
        let result: SolveResult;
        try { result = prep.problem.stops.length && prep.problem.vehicles.length ? await routing.solve(prep.problem, signal) : { routes: [], skipped: [] }; }
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
        const current = await ridingOf(run.id);
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
        // Dropped riders kept their cars (fixed above) but the solver renumbered every stop: put them
        // first again and sequence the rest from the last drop-off.
        const droppedCars = new Set((await ridingOf(run.id)).filter((r) => r.droppedAt && r.runVehicleId).map((r) => r.runVehicleId!));
        await Promise.all([...droppedCars].map((id) => live.get(id)).filter((v): v is BusRunVehicle => !!v?.running).map((v) => reorderCar(c, run, v)));
        for (const [id, leaderIds] of prep.filled) { const v = live.get(id); if (v) await saveRV({ ...v, leaderIds }); }

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
        const finalRiders = await ridingOf(run.id);
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
      const fixedCarIds = fixedCarIdsOf(rvs);
      for (const r of await ridingOf(run.id)) {
        const e = snap.get(r.id);
        if (!e) continue; // added after the generate — leave alone
        if (r.runVehicleId && fixedCarIds.has(r.runVehicleId)) continue; // I2/I11: never pull a rider out of an own or locked car
        const car = e.runVehicleId && running.has(e.runVehicleId) ? e.runVehicleId : null;
        if (car && fixedCarIds.has(car)) continue; // I11: nor put one back into a car locked since
        await bus.saveRunRider({ ...r, runVehicleId: car, stopOrder: car ? e.stopOrder : null, pinned: e.pinned });
      }
      await bus.setUndo(run.id, null, null);
      await touch(ctx, run);
    },
    // Owner 2026-10-09: clear every non-pinned rider out of the fleet cars (own cars are the
    // leader's choice, left alone, like Undo). Saves an undo snapshot so it can be reverted.
    async unassignAll(ctx) {
      const c = await gate(ctx, 'bus:coordinate');
      const run = await writableRun(ctx, c);
      if (lockActive(run)) throw lockConflict(run);
      const fixedCarIds = fixedCarIdsOf(await bus.listRunVehicles(run.id)); // own cars + locked cars (I11)
      const riders = await ridingOf(run.id);
      const out = riders.filter((r) => r.runVehicleId && !r.pinned && !r.droppedAt && !fixedCarIds.has(r.runVehicleId));
      if (!out.length) return { unassigned: 0 };
      await bus.setUndo(run.id, riders.map((r) => ({ riderId: r.id, runVehicleId: r.runVehicleId, stopOrder: r.stopOrder, pinned: r.pinned })),
        new Date(Date.now() + UNDO_MS).toISOString());
      for (const r of out) await bus.saveRunRider({ ...r, runVehicleId: null, stopOrder: null, pinned: false });
      await touch(ctx, run);
      return { unassigned: out.length };
    },
    async analysis(ctx) {
      const c = await gateAnalysisView(ctx);
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
        unassigned: (await ridingOf(run.id)).filter((r) => !r.runVehicleId).length,
        longestMin: Math.max(0, ...cars.map((x) => x.routeMin)), totalMin: sum(cars.map((x) => x.routeMin)) };
    },
    async extraCars(ctx, input) {
      const c = await gateAnalysisView(ctx); // read-only "Try +N cars" what-if, part of route analysis
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
    // Past night popup map: each car's route through its stops in stop order (Routes API computeRoutes).
    // Nothing is stored (Google terms) — only the finished image is cached per run version.
    async pastRunMap(ctx, runId) {
      const c = await gate(ctx, 'bus:coordinate');
      const run = await bus.getRun(runId);
      if (!run) throw new NotFoundError('Night not found');
      const b = c.busMinistry;
      if (!b.churchPlaceId) throw new BadRequestError(NO_CHURCH);
      const key = `${run.id}:${run.version}:${b.churchPlaceId}`;
      const hit = pastMapCache.get(key);
      if (hit) return hit;
      const [cars, rows] = await Promise.all([bus.listRunVehicles(run.id), bus.listRunRiders(run.id)]);
      const signal = routingDeadline();
      const paths: MapPath[] = [], markers: MapMarker[] = [];
      try {
        await Promise.all(cars.map(async (rv) => {
          // Same list/order as the popup, so marker labels match the numbers people see there.
          const list = rows.filter((r) => r.runVehicleId === rv.id && !r.notRiding).sort((x, y) => (x.stopOrder ?? 99) - (y.stopOrder ?? 99));
          const stops = list.map((r, i) => ({ r, i })).filter((x) => x.r.snapPlaceId && !x.r.noShow).slice(0, ROUTE_MAX_INTERMEDIATES);
          if (!stops.length) return;
          const end = endPlaceOf(rv.endsAt, rv.endsPlaceId, b.churchPlaceId);
          const route = await routing.route([b.churchPlaceId, ...stops.map((x) => x.r.snapPlaceId!), ...(end ? [end] : [])].map((placeId) => ({ placeId })), signal);
          const colour = BUS_CAR_COLOURS[rv.colourIndex % BUS_CAR_COLOURS.length]!;
          paths.push({ colour, polyline: thinPolyline(route.polyline, MAP_MAX_POINTS) });
          stops.forEach((x, n) => { const at = route.stops[n]; if (at) markers.push({ colour, label: markerLabel(x.i), lat: at.lat, lng: at.lng }); });
        }));
      } catch (err) { throw routingFailed(err, MAP_FAILED); }
      if (!paths.length && !markers.length) throw new BadRequestError('No routes to show');
      let img: MapImage;
      try { img = await routing.staticMap(paths, markers, signal); }
      catch (err) { throw routingFailed(err, MAP_FAILED); }
      pastMapCache.set(key, img);
      if (pastMapCache.size > ANALYSIS_CACHE_MAX) {
        const oldest = pastMapCache.keys().next().value;
        if (oldest !== undefined) pastMapCache.delete(oldest);
      }
      return img;
    },
    async analysisMap(ctx) {
      const c = await gateAnalysisView(ctx);
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
