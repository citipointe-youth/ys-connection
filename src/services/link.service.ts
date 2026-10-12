// Elvanto link, app side: the leader + admin service (spec 2026-10-12-elvanto-link-app-design.md §2, §6, §8.2, §9.1;
// contract 2026-10-11 §4, §5). Every method starts with the one switch (modules.newYouthForms) + RBAC.
// Never logs: no note text, phone or address goes into a reply or a link_log row.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Actor } from '../core/entities/user';
import type { Leader } from '../core/entities/leader';
import type { AppSettings } from '../core/entities/settings';
import type { ILinkRepository } from '../repositories/interfaces/link.repository';
import type {
  ILeaderRepository, IServiceAttendanceRepository, IServiceSessionRepository, ISettingsRepository, IStudentRepository,
  IUserRepository,
} from '../repositories/interfaces/entity-repositories';
import type {
  ActionType, Capabilities, ConsoleRow, LinkFlowRow, LinkGroupRow, LinkLastReport, LinkLogRow, LinkRosterRow,
  LinkServiceRow, LogEvent, Match, MirrorStateRow, OutboxRow, PushKind, Status,
} from '../core/link-types';
import { ACTION_TYPES, PAYLOAD_SCHEMAS, PUSH_KINDS } from '../core/link-contract';
import {
  AppError, BadRequestError, ConflictError, ForbiddenError, ModuleDisabledError, NotFoundError, TooManyRequestsError,
} from '../core/errors/app-error';
import {
  LinkEditInElvanto, LinkIdExists, LinkIdReused, LinkNotYours, LinkOpenDuplicate, LinkStale, LinkStillSending, LinkTooOld,
  LinkUnavailable,
} from '../core/errors/link-errors';
import { createLogger } from '../utils/logger';
import { isDbError } from '../utils/transient-db';
import { can, canAccessGender, canAccessGrade, genderScopeOf, modeAllows, type StructureScope } from './access-control';
import {
  LINK_CUTOFF_DAYS, addDays, brisbaneToday, dedupeKey, defaultService, effectiveCheckState, lastMeetingDate, noteRoom, pickList,
} from './link-rules';

export const LINK_NOTE_MAX = 1800;
export const LINK_BATCH_MAX = 50;
export const LINK_RATE_MAX = 300;          // items per login …
export const LINK_RATE_WINDOW_MS = 600_000; // … per 10 minutes (container builds the RateLimiter with these)
const LOG_MAX = 2000;
const logger = createLogger('link');
const REPORT_BACK_DAYS = 14;
const CONSOLE_RECENT_MS = 600_000;
const BRISBANE_MS = 10 * 3_600_000;

const NOTE_TYPES: ActionType[] = ['submitReport', 'editReport', 'completeStep'];
const CHECK_TYPES: ActionType[] = ['checkIn', 'checkOut'];
const OPEN: Status[] = ['pending', 'claimed', 'unclear'];
const LOG_EVENTS = [...ACTION_TYPES, 'identity', 'cancel', 'undo'] as const;
const MATCHES = ['auto', 'manual', 'none', 'ambiguous', 'ignored'] as const;

const Uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ActionFields = { id: Uuid, type: z.enum(ACTION_TYPES), payload: z.record(z.unknown()),
  note: z.string().nullable().optional(), leaderId: Uuid.nullable().optional() };
const ActionItem = z.object(ActionFields);
/** B8 / T-39: the phone's tap time (its own clock); the envelope's sentAt maps it onto the server clock. */
const QueuedAt = z.string().datetime().optional();
const BatchItem = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('action'), ...ActionFields, queuedAt: QueuedAt }),
  z.object({ kind: z.literal('cancel'), id: Uuid, leaderId: Uuid.nullable().optional(), queuedAt: QueuedAt }),
  z.object({ kind: z.literal('undo'), id: Uuid, leaderId: Uuid.nullable().optional(), newId: Uuid, queuedAt: QueuedAt }),
  z.object({ kind: z.literal('identity'), id: Uuid, at: z.string().datetime(), from: Uuid.nullable(), to: Uuid.nullable() }),
]);
/** Only the envelope fails the whole call (APP-17); each item is parsed in the loop and a bad one is refused alone. */
const BatchBody = z.object({
  device: z.object({ id: z.string().max(100).nullable().optional(), label: z.string().max(100).nullable().optional() }).optional(),
  sentAt: z.string().datetime().optional(),
  items: z.array(z.unknown()).min(1).max(LINK_BATCH_MAX),
});
const ITEM_KINDS = ['action', 'cancel', 'undo', 'identity'] as const;

// ---------------------------------------------------------------- public shapes

export interface Device { id: string | null; label: string | null }
export interface ActionView { id: string; type: ActionType; status: Status; reason: string | null }
export type ItemKind = 'action' | 'cancel' | 'undo' | 'identity';
export type ItemOutcome = 'saved' | 'replay' | 'duplicate' | 'refused' | 'cancelled' | 'too-late' | 'logged';
/** One item's result (spec §9.1). `httpStatus` is for the single routes; batch replies leave it out. */
export interface ItemResult {
  id: string; kind: ItemKind; outcome: ItemOutcome; httpStatus: number;
  existingId?: string; code?: string; message?: string; reason?: string; action?: ActionView;
  /** B6 / APP-50: true when this call stored (or replayed) the row; false on duplicate (someone else's row). */
  mine?: boolean;
}
export type BatchItemResult = Omit<ItemResult, 'httpStatus'>;

export interface LinkStatus {
  console: { lastSeenAt: string | null; online: boolean; inWindow: boolean; pollSeconds: number | null;
    capabilities: Capabilities | null; consoles: number };
  mirrors: Record<PushKind, { takenAt: string | null; ageSeconds: number | null }>;
}
export interface ServiceView { serviceTimeId: string; serviceId: string; name: string; startsAt: string; ymd: string }
export interface CheckinPerson { personId: string; name: string; grade: number | null; leader: boolean; checkedIn: boolean;
  practice: boolean; action: ActionView | null; mine: boolean }
export interface CheckinLeader { leaderId: string; name: string; personId: string | null; checkedIn: boolean;
  practice: boolean; action: ActionView | null; mine: boolean }
export interface CheckinView { today: string; services: ServiceView[]; defaultServiceTimeId: string | null;
  people?: CheckinPerson[]; leaders?: CheckinLeader[] }
export interface ActionListRow { id: string; type: ActionType; status: Status; reason: string | null; detail?: string | null;
  createdAt: string; resultAt: string | null; leaderName: string; login: string; hasNote: boolean;
  /** B3 / T-7: the person (or group / flow row) of an `unclear` row, for link:admin only. */
  name?: string | null }
export interface LifegroupView { groupId: string; name: string; meets: string; members: LinkGroupRow['members'];
  thisWeek: LinkGroupRow['thisWeek']; lastReport: LinkLastReport | null; defaultDate: string; openAction: ActionView | null }
export interface FlowView { rowId: string; flowId: string; stepId: string; flowName: string; stepName: string; stepOrder: number;
  personId: string | null; name: string; due: string | null; assignedTo: string; openAction: ActionView | null }
export interface MatchCandidate { studentId: string; name: string; grade: number | null; dob: string | null }
/** A roster row the admin may need to act on (APP-40: no unused fields, so fewer minors' details on the wire). */
export interface MatchRow { personId: string; name: string; grade: number | null; kind: LinkRosterRow['kind'];
  active: boolean; studentId: string | null; match: Match; candidates: MatchCandidate[] }
export type ShadowVerdict = 'matched' | 'sent-not-imported' | 'practice-matched' | 'practice-missing' | 'no-student';
export interface ShadowRow { id: string; personId: string | null; name: string | null; status: Status; studentId: string | null;
  verdict: ShadowVerdict; message?: string }
export interface ShadowCheck { date: string; imported: boolean; message?: string; rows: ShadowRow[]; unlinkedAttenders: number }

export interface LinkService {
  status(actor: Actor): Promise<LinkStatus>;
  checkin(actor: Actor, serviceTimeId?: string): Promise<CheckinView>;
  enqueue(actor: Actor, item: unknown, device: Partial<Device>): Promise<ItemResult>;
  cancel(actor: Actor, id: string, leaderId: string | null, device: Partial<Device>): Promise<ItemResult>;
  undo(actor: Actor, id: string, leaderId: string | null, newId: string, device: Partial<Device>): Promise<ItemResult>;
  listActions(actor: Actor, q: unknown): Promise<ActionListRow[]>;
  batch(actor: Actor, body: unknown): Promise<{ results: BatchItemResult[] }>;
  lifegroups(actor: Actor): Promise<{ groups: LifegroupView[] }>;
  flows(actor: Actor): Promise<{ rows: FlowView[] }>;
  rosterForMatching(actor: Actor, q: unknown): Promise<{ rows: MatchRow[] }>;
  setMatch(actor: Actor, personId: string, body: unknown): Promise<{ personId: string; studentId: string | null; match: Match }>;
  shadowCheck(actor: Actor, date: unknown): Promise<ShadowCheck>;
  log(actor: Actor, q: unknown): Promise<{ rows: LinkLogRow[] }>;
}

export interface LinkServiceDeps {
  link: ILinkRepository; settings: ISettingsRepository; students: IStudentRepository; leaders: ILeaderRepository;
  users: IUserRepository; serviceSessions: IServiceSessionRepository; serviceAttendance: IServiceAttendanceRepository;
  limiter: { isBlocked(key: string): boolean };
  now?: () => Date;
}

// ---------------------------------------------------------------- helpers

const fold = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
const fullName = (r: { firstName: string; lastName: string }) => `${r.firstName} ${r.lastName}`.trim();
const view = (r: OutboxRow): ActionView => ({ id: r.id, type: r.type, status: r.status, reason: r.reason });
const isAdminRole = (a: Actor) => a.role === 'admin' || a.role === 'director';
const newest = (cs: ConsoleRow[]) => [...cs].sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))[0] ?? null;
/** Key-order-independent JSON, for the replay check (contract §4.1 "jsonb ="). */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}
/** Brisbane midnight of a date, as an instant. */
const brisbaneStart = (ymd: string) => new Date(Date.parse(`${ymd}T00:00:00Z`) - BRISBANE_MS).toISOString();

function groupVisible(a: Actor, g: LinkGroupRow, s: StructureScope): boolean {
  if (g.grade == null) return isAdminRole(a);
  return canAccessGrade(a, g.grade, s) && (g.gender ? canAccessGender(a, g.gender, s) : true);
}
function personVisible(a: Actor, r: LinkRosterRow | undefined, s: StructureScope): boolean {
  if (!r) return isAdminRole(a);
  return canAccessGrade(a, r.grade, s) && (r.gender ? canAccessGender(a, r.gender, s) : genderScopeOf(a, s) == null);
}
/** Read-time name match (decision 20): one active roster row with the folded name, preferring kind leader. */
function rosterPersonOf(l: Leader, roster: LinkRosterRow[]): string | null {
  const key = fold(l.fullName);
  const g = l.gender === 'male' || l.gender === 'female' ? l.gender : null;
  let hits = roster.filter((r) => r.active && fold(fullName(r)) === key && (!g || !r.gender || r.gender === g));
  const leaders = hits.filter((r) => r.kind === 'leader');
  if (leaders.length > 0) hits = leaders;
  return hits.length === 1 ? hits[0]!.personId : null;
}

const refused = (id: string, kind: ItemKind, e: AppError): ItemResult => ({ id, kind, outcome: 'refused', httpStatus: e.statusCode,
  code: e.code, message: e.message, ...(typeof e.extra?.reason === 'string' ? { reason: e.extra.reason } : {}) });

interface Target { kind: LinkLogRow['targetKind']; id: string | null; name: string | null }
/** B8: when the tap happened (server clock) and the ids of the batch it came in (they never make each other stale). */
interface Tap { at: Date; batchIds: Set<string> }
interface Who { id: string | null; name: string | null }

// ---------------------------------------------------------------- service

export function makeLinkService(d: LinkServiceDeps): LinkService {
  const clock = d.now ?? (() => new Date());

  /** The switch, then RBAC: a mode miss is 404 for everyone; a link:admin miss under the mode is 403. */
  async function gate(actor: Actor, action: 'link:use' | 'link:admin'): Promise<AppSettings> {
    const settings = await d.settings.getSettings();
    if (!modeAllows(actor, settings.ministryConfig.modules.newYouthForms)) throw new ModuleDisabledError('Elvanto link');
    if (!can(actor, action)) {
      if (action === 'link:admin') throw new ForbiddenError('Only the director or admin can do this.');
      throw new ModuleDisabledError('Elvanto link');
    }
    return settings;
  }

  type Ctx = ReturnType<typeof context>;
  /** Per call: one clock reading and memoised mirror reads (a batch of 50 reads each table once). */
  function context(actor: Actor, settings: AppSettings) {
    const memo = <T>(f: () => Promise<T>) => { let p: Promise<T> | undefined; return () => (p ??= f()); };
    const t = clock();
    return {
      actor, t, today: brisbaneToday(t), structure: settings.ministryConfig.structure as StructureScope,
      admin: can(actor, 'link:admin'),
      roster: memo(() => d.link.roster()), services: memo(() => d.link.services()), groups: memo(() => d.link.groups()),
      flows: memo(() => d.link.flows()), consoles: memo(() => d.link.listConsoles()), mirror: memo(() => d.link.mirrorState()),
      leaders: memo(() => d.leaders.findAll()),
      login: memo(async () => (await d.users.findById(actor.id))?.email ?? actor.displayName),
    };
  }
  const takenAt = (ms: MirrorStateRow[], k: PushKind) => ms.find((m) => m.kind === k)?.takenAt ?? null;

  async function logRow(c: Ctx, device: Device, p: Partial<LinkLogRow> & { event: LogEvent; outcome: string }): Promise<LinkLogRow> {
    return { id: randomUUID(), at: c.t.toISOString(), userId: c.actor.id, login: await c.login(), deviceId: device.id,
      deviceLabel: device.label, leaderId: null, leaderName: null, prevLeaderId: null, prevLeaderName: null, targetKind: null,
      targetId: null, targetName: null, outboxId: null, ...p };
  }
  const leaderName = async (c: Ctx, id: string | null) => (id ? (await c.leaders()).find((l) => l.id === id)?.fullName ?? null : null);

  /** "I am" (spec §2.2): a junior leader login always uses its bound leader; required for the three note types. */
  async function resolveLeader(c: Ctx, given: string | null | undefined, required: boolean): Promise<{ id: string | null; name: string }> {
    const id = c.actor.role === 'leader' ? (c.actor.leaderId ?? null) : (given ?? null);
    const l = id ? (await c.leaders()).find((x) => x.id === id) ?? null : null;
    if (required && !l) throw new BadRequestError('Pick who you are first.');
    return l ? { id: l.id, name: l.fullName } : { id: null, name: c.actor.displayName };
  }

  /** The group's last report: the mirror's, or the overlay (newest sent submit with a reportId after the groups push). */
  function lastReportOf(g: LinkGroupRow, sentSubmits: OutboxRow[], groupsTakenAt: string | null): LinkLastReport | null {
    const ov = sentSubmits.find((r) => (r.payload as { groupId?: string }).groupId === g.groupId && r.reportId && r.resultAt &&
      (!groupsTakenAt || Date.parse(r.resultAt) > Date.parse(groupsTakenAt)));
    if (!ov) return g.lastReport;
    const p = ov.payload as { date: string; didNotMeet: boolean; attendees: string[]; guests: number; serviceTimeId: string | null };
    return { reportId: ov.reportId!, date: p.date, time: '', didNotMeet: p.didNotMeet, attendees: p.attendees, guests: p.guests,
      serviceTimeId: p.serviceTimeId, editable: true, blocked: null };
  }

  /** The log target of a stored row (APP-30): person, group or flow row. */
  async function targetOf(c: Ctx, r: OutboxRow): Promise<Target> {
    const p = r.payload as { personId?: string; firstName?: string; lastName?: string; groupId?: string; rowId?: string };
    if (r.type === 'firstTimerCheckIn') return { kind: 'person', id: r.personId, name: `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() };
    if (r.type === 'checkIn' || r.type === 'checkOut') {
      const x = (await c.roster()).find((y) => y.personId === p.personId);
      return { kind: 'person', id: p.personId ?? null, name: x ? fullName(x) : null };
    }
    if (r.type === 'submitReport' || r.type === 'editReport') {
      const g = (await c.groups()).find((y) => y.groupId === p.groupId);
      return { kind: 'group', id: p.groupId ?? null, name: g?.name ?? null };
    }
    const f = (await c.flows()).find((y) => y.rowId === p.rowId);
    return { kind: 'flowRow', id: p.rowId ?? null, name: f?.name ?? null };
  }

  const checkRows = (personId: string, serviceTimeId: string) =>
    d.link.listActions({ personId, serviceTimeId, types: CHECK_TYPES });

  // ---- enqueue (spec §8.2 steps 1–6). Throws AppError for a refusal; the caller turns it into a result.
  async function enqueueChecked(c: Ctx, it: z.infer<typeof ActionItem>, tgt: Target, who: Who, tap?: Tap): Promise<ItemResult> {
    const ok = (row: OutboxRow, outcome: 'saved' | 'replay'): ItemResult =>
      ({ id: it.id, kind: 'action', outcome, httpStatus: outcome === 'saved' ? 201 : 200, action: view(row), mine: true });
    const dup = (row: OutboxRow): ItemResult =>
      ({ id: it.id, kind: 'action', outcome: 'duplicate', httpStatus: 409, existingId: row.id, action: view(row), mine: false });

    // Replay (same id, same type + payload + note-or-not + "I am") or id reuse (APP-30). The log target comes from the
    // stored row, so a retried item still names its person.
    const replay = async (prev: OutboxRow): Promise<ItemResult> => {
      const noteGiven = it.note != null && it.note.trim() !== '';
      const me0 = await resolveLeader(c, it.leaderId, false);
      if (prev.type !== it.type || stable(prev.payload) !== stable(it.payload) || prev.hasNote !== noteGiven
        || (prev.leaderId ?? null) !== me0.id) throw new LinkIdReused();
      Object.assign(who, { id: prev.leaderId, name: prev.leaderName });
      Object.assign(tgt, await targetOf(c, prev));
      return ok(prev, 'replay');
    };
    // 1. rate limit
    if (d.limiter.isBlocked(c.actor.id)) throw new TooManyRequestsError('Too many taps. Wait a minute.');
    // 2. replay / id reuse
    const prev = await d.link.getAction(it.id);
    if (prev) return replay(prev);
    // 3. capability off on the newest console (none seen yet → allowed)
    const con = newest(await c.consoles());
    if (con && con.capabilities[it.type] === 'off') throw new LinkUnavailable();
    // 3b. the 3-day cut-off counts from the tap, not from when the phone got a signal (B8 / APP-16 A)
    if (tap && tap.at.getTime() < c.t.getTime() - LINK_CUTOFF_DAYS * 86_400_000) throw new LinkTooOld();
    // 4. type checks, note, "I am"
    const parsed = PAYLOAD_SCHEMAS[it.type].safeParse(it.payload);
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Validation failed', 400);
    const p = parsed.data as Record<string, unknown> & { serviceTimeId?: string; personId?: string | null };
    const note = it.note == null || it.note.trim() === '' ? null : it.note;
    const noteType = NOTE_TYPES.includes(it.type);
    if (note !== null && !noteType) throw new BadRequestError('A note can only go on a lifegroup report or a flow step.');
    const me = await resolveLeader(c, it.leaderId, noteType);
    Object.assign(who, me);
    // X1: the claim row carries "Self identified leader: <name> — <note>", so the leader's part is capped to fit 1,900.
    const room = Math.min(LINK_NOTE_MAX, noteRoom(me.name));
    if (note !== null && note.length > room) throw new BadRequestError(`A note can be up to ${room} characters.`);

    const [roster, services] = await Promise.all([c.roster(), c.services()]);
    let serviceDate = c.today;
    let personId: string | null = null;
    let svc: LinkServiceRow | undefined;
    if (it.type === 'checkIn' || it.type === 'checkOut' || it.type === 'firstTimerCheckIn') {
      svc = pickList(services, c.today).find((s) => s.serviceTimeId === p.serviceTimeId);
      if (!svc) throw new BadRequestError('Pick a service from the list.');
      if ('serviceId' in p && p.serviceId !== svc.serviceId) throw new BadRequestError('Pick a service from the list.');
      serviceDate = svc.ymd;
      if (it.type === 'firstTimerCheckIn') {
        Object.assign(tgt, { kind: 'person', name: `${String(p.firstName)} ${String(p.lastName)}` });
      } else {
        const r = roster.find((x) => x.personId === p.personId);
        if (r) Object.assign(tgt, { kind: 'person', id: r.personId, name: fullName(r) });
        if (!r || !r.active) throw new BadRequestError('This person is not on the list. Reload.');
        personId = r.personId;
      }
    } else if (it.type === 'submitReport' || it.type === 'editReport') {
      const rp = p as unknown as { groupId: string; date: string; attendees: string[]; serviceTimeId: string | null;
        didNotMeet: boolean; guests: number; reportId?: string; base?: { date: string; didNotMeet: boolean; attendees: string[];
          guests: number; serviceTimeId: string | null } };
      const g = (await c.groups()).find((x) => x.groupId === rp.groupId);
      if (!g) throw new BadRequestError('This group is not in the list. Reload.');
      Object.assign(tgt, { kind: 'group', id: g.groupId, name: g.name });
      if (!groupVisible(c.actor, g, c.structure)) throw new ForbiddenError('This group is not one of yours.');
      if (rp.date > c.today || rp.date < addDays(c.today, -REPORT_BACK_DAYS)) {
        throw new BadRequestError('The date must be in the last 14 days.');
      }
      const members = new Set(g.members.map((m) => m.personId));
      if (rp.attendees.some((a) => !members.has(a))) throw new BadRequestError('Someone ticked is not in this group. Reload.');
      if (rp.serviceTimeId !== null && !services.some((s) => s.serviceTimeId === rp.serviceTimeId)) {
        throw new BadRequestError('Pick a service from the list.');
      }
      if (it.type === 'editReport') {
        const [sent, ms] = await Promise.all([
          d.link.listActions({ groupId: g.groupId, types: ['submitReport'], statuses: ['sent'] }), c.mirror()]);
        const last = lastReportOf(g, sent, takenAt(ms, 'groups'));
        if (!last || last.reportId !== rp.reportId) throw new BadRequestError('Only the last report can be edited. Reload.');
        if (!last.editable) throw new LinkEditInElvanto(last.blocked ?? 'unknown');
        const b = rp.base!;
        const same = b.date === last.date && b.didNotMeet === last.didNotMeet && b.guests === last.guests &&
          b.serviceTimeId === last.serviceTimeId && stable([...b.attendees].sort()) === stable([...last.attendees].sort());
        if (!same) throw new BadRequestError('This report changed. Reload and try again.');
        if (rp.date !== b.date) throw new BadRequestError('The date of a report cannot be changed here.');
      }
      serviceDate = rp.date;
    } else { // completeStep
      const sp = p as unknown as { rowId: string; flowId: string; stepId: string; personId: string | null };
      const row = (await c.flows()).find((x) => x.rowId === sp.rowId);
      if (!row) throw new BadRequestError('This step is not in the list. Reload.');
      Object.assign(tgt, { kind: 'flowRow', id: row.rowId, name: row.name });
      if (row.flowId !== sp.flowId || row.stepId !== sp.stepId || row.personId !== sp.personId) {
        throw new BadRequestError('This step changed. Reload.');
      }
      if (!personVisible(c.actor, roster.find((x) => x.personId === row.personId), c.structure)) {
        throw new ForbiddenError('This person is not one of yours.');
      }
      personId = row.personId;
    }

    // 5. ordering (B4 / T-24), same-action dedupe (decision 18), then the check-out rule (spec §2.4)
    if (it.type === 'checkIn' || it.type === 'checkOut') {
      let rows = await checkRows(personId!, svc!.serviceTimeId);
      const opposite = rows.find((r) => r.status !== 'cancelled' && r.status !== 'refused');
      // B8 / APP-16 B: someone else changed this person after the tap (a late flush must not undo a newer action).
      const other = rows.find((r) => r.status !== 'cancelled' && r.status !== 'refused' && !tap?.batchIds.has(r.id));
      if (tap && other && Date.parse(other.createdAt) > tap.at.getTime()) throw new LinkStale();
      if (opposite && opposite.type !== it.type) {
        if (opposite.status === 'claimed' || opposite.status === 'unclear') throw new LinkStillSending();
        // The opposite row has not gone yet: cancel it instead of queueing both (the console could run them in the
        // wrong order). A check-out answers `cancelled`; a check-in answers with the open check-in as `duplicate`.
        if (opposite.status === 'pending') {
          if (!(await d.link.cancelPending(opposite.id))) throw new LinkStillSending(); // picked up meanwhile
          if (it.type === 'checkOut') {
            return { id: it.id, kind: 'action', outcome: 'cancelled', httpStatus: 200, action: { ...view(opposite), status: 'cancelled' } };
          }
          rows = await checkRows(personId!, svc!.serviceTimeId);
          const open = rows.find((r) => r.type === 'checkIn' && r.status !== 'cancelled' && r.status !== 'refused');
          if (open) return dup(open);
          return { id: it.id, kind: 'action', outcome: 'duplicate', httpStatus: 409, mine: false }; // in by the kiosk (the mirror)
        }
      }
      const mirror = { mirrorIn: svc!.checkedIn.some((x) => x.personId === personId), mirrorTakenAt: takenAt(await c.mirror(), 'services') };
      const st = effectiveCheckState({ ...mirror, rows });
      // A shadowed row is practice: it shows on the door, but it is not "in" for the duplicate check, so a re-tap
      // once the type is live is sent for real (B5 / APP-46).
      const real = rows.filter((r) => r.status !== 'shadowed');
      const realIn = effectiveCheckState({ ...mirror, rows: real }).in;
      const live = real.find((r) => r.status !== 'cancelled' && r.status !== 'refused');
      // Same type AND the person is still in that state: a kiosk check-out after a sent check-in allows a new one.
      if (live && live.type === it.type && realIn === (it.type === 'checkIn')) return dup(live);
      if (it.type === 'checkOut' && !st.in) throw new BadRequestError('Not checked in to this service.');
    }

    // 6. insert
    const studentId = personId ? roster.find((x) => x.personId === personId)?.studentId ?? null : null;
    try {
      const row = await d.link.insertAction({ id: it.id, type: it.type, payload: p, note, dedupeKey: dedupeKey(it.type, p),
        serviceDate, studentId, personId, createdBy: c.actor.id, leaderId: me.id, leaderName: me.name });
      return ok(row, 'saved');
    } catch (e) {
      if (e instanceof LinkIdExists) { // a concurrent flush stored the same id first (APP-72): re-read, then replay
        const again = await d.link.getAction(it.id);
        if (again) return replay(again);
      }
      if (e instanceof LinkOpenDuplicate) {
        const existingId = String(e.extra?.existingId);
        const row = await d.link.getAction(existingId);
        return row ? dup(row) : { id: it.id, kind: 'action', outcome: 'duplicate', httpStatus: 409, existingId, mine: false };
      }
      throw e;
    }
  }

  /** One action item: never throws for a refusal; non-AppErrors propagate (the batch turns them into a 503). */
  async function enqueueItem(c: Ctx, raw: unknown, tap?: Tap): Promise<{ res: ItemResult; type: ActionType | null; tgt: Target; who: Who }> {
    const tgt: Target = { kind: null, id: null, name: null };
    const who: Who = { id: null, name: null };
    const it = ActionItem.safeParse(raw);
    if (!it.success) {
      const id = typeof (raw as { id?: unknown } | null)?.id === 'string' ? (raw as { id: string }).id : '';
      return { res: refused(id, 'action', new AppError('VALIDATION_ERROR', 'Validation failed', 400)), type: null, tgt, who };
    }
    who.id = it.data.leaderId ?? null;
    try {
      return { res: await enqueueChecked(c, it.data, tgt, who, tap), type: it.data.type, tgt, who };
    } catch (e) {
      if (e instanceof AppError) return { res: refused(it.data.id, 'action', e), type: it.data.type, tgt, who };
      throw e;
    }
  }
  const outcomeText = (r: ItemResult) => (r.outcome === 'refused' ? `refused:${r.code}` : r.outcome);

  async function doEnqueue(c: Ctx, raw: unknown, device: Device, tap?: Tap): Promise<{ res: ItemResult; log: LinkLogRow | null }> {
    const { res, type, tgt, who } = await enqueueItem(c, raw, tap);
    if (!type) return { res, log: null };
    const outboxId = res.outcome === 'saved' || res.outcome === 'replay' ? res.id : res.existingId ?? null;
    const log = await logRow(c, device, { event: type, leaderId: who.id, leaderName: who.name ?? await leaderName(c, who.id),
      targetKind: tgt.kind, targetId: tgt.id, targetName: tgt.name, outboxId, outcome: outcomeText(res) });
    return { res, log };
  }

  /** Cancel/undo ownership (spec §8.2): same login and same "I am" (null = null), or link:admin. */
  const iAm = (c: Ctx, leaderId: string | null) => (c.actor.role === 'leader' ? (c.actor.leaderId ?? null) : leaderId);
  function owns(c: Ctx, row: OutboxRow, leaderId: string | null): boolean {
    return c.admin || (row.createdBy === c.actor.id && (row.leaderId ?? null) === iAm(c, leaderId));
  }

  async function doCancel(c: Ctx, id: string, leaderId: string | null, device: Device): Promise<{ res: ItemResult; log: LinkLogRow }> {
    const res = await (async (): Promise<ItemResult> => {
      const row = await d.link.getAction(id);
      if (!row) return refused(id, 'cancel', new NotFoundError('This action is not on the server.'));
      if (!owns(c, row, leaderId)) return refused(id, 'cancel', new LinkNotYours());
      if (row.status === 'cancelled' || await d.link.cancelPending(id)) return { id, kind: 'cancel', outcome: 'cancelled', httpStatus: 200 };
      return { id, kind: 'cancel', outcome: 'too-late', httpStatus: 409, code: 'LINK_TOO_LATE',
        message: 'Too late: this has already been picked up.' };
    })();
    const me = iAm(c, leaderId);
    const log = await logRow(c, device, { event: 'cancel', leaderId: me, leaderName: await leaderName(c, me),
      targetKind: 'action', targetId: id, outboxId: id, outcome: outcomeText(res) });
    return { res, log };
  }

  async function doUndo(c: Ctx, id: string, leaderId: string | null, newId: string, device: Device, tap?: Tap):
    Promise<{ res: ItemResult; log: LinkLogRow }> {
    let outboxId: string | null = id;
    const res = await (async (): Promise<ItemResult> => {
      const row = await d.link.getAction(id);
      if (!row) return refused(id, 'undo', new NotFoundError('This action is not on the server.'));
      if (row.type !== 'checkIn') return refused(id, 'undo', new BadRequestError('Only a check-in can be undone.'));
      if (row.status === 'cancelled') return { id, kind: 'undo', outcome: 'cancelled', httpStatus: 200 };
      // B6 / APP-5: the owner rule applies only to a cancel (the check-in is still pending). Past that, Undo is a
      // plain check-out, which anyone on the door may do (a shared login has several "I am" leaders).
      if (row.status === 'pending') {
        if (!owns(c, row, leaderId)) return refused(id, 'undo', new LinkNotYours());
        if (await d.link.cancelPending(id)) return { id, kind: 'undo', outcome: 'cancelled', httpStatus: 200 };
      }
      const p = row.payload as { serviceTimeId: string; personId: string };
      const out = await enqueueItem(c, { id: newId, type: 'checkOut', payload: { serviceTimeId: p.serviceTimeId, personId: p.personId },
        note: null, leaderId }, tap);
      if (out.res.outcome !== 'refused') outboxId = out.res.existingId ?? newId;
      return { ...out.res, id, kind: 'undo' };
    })();
    const me = iAm(c, leaderId);
    const log = await logRow(c, device, { event: 'undo', leaderId: me, leaderName: await leaderName(c, me),
      targetKind: 'action', targetId: id, outboxId, outcome: outcomeText(res) });
    return { res, log };
  }

  const dev = (x: Partial<Device> | undefined): Device => ({ id: x?.id ?? null, label: x?.label ?? null });
  const strip = ({ httpStatus: _h, ...r }: ItemResult): BatchItemResult => r;

  return {
    async status(actor) {
      await gate(actor, 'link:use');
      const t = clock().getTime();
      const [consoles, mirrors] = await Promise.all([d.link.listConsoles(), d.link.mirrorState()]);
      const n = newest(consoles);
      const console = n
        ? { lastSeenAt: n.lastSeenAt, online: t - Date.parse(n.lastSeenAt) <= (2 * n.pollSeconds + 60) * 1000,
          inWindow: n.inWindow, pollSeconds: n.pollSeconds, capabilities: n.capabilities,
          consoles: consoles.filter((x) => t - Date.parse(x.lastSeenAt) <= CONSOLE_RECENT_MS).length }
        : { lastSeenAt: null, online: false, inWindow: false, pollSeconds: null, capabilities: null, consoles: 0 };
      const m = Object.fromEntries(PUSH_KINDS.map((k) => {
        const at = takenAt(mirrors, k);
        return [k, { takenAt: at, ageSeconds: at ? Math.round((t - Date.parse(at)) / 1000) : null }];
      })) as LinkStatus['mirrors'];
      return { console, mirrors: m };
    },

    async checkin(actor, serviceTimeId) {
      const c = context(actor, await gate(actor, 'link:use'));
      const one = typeof serviceTimeId === 'string' && serviceTimeId !== '';
      const [services, roster, mirrors, rows, leaders] = await Promise.all([c.services(), one ? c.roster() : [], c.mirror(),
        one ? d.link.listActions({ serviceTimeId, types: CHECK_TYPES }) : [], one ? c.leaders() : []]);
      const list = pickList(services, c.today);
      const out: CheckinView = { today: c.today,
        services: list.map((s) => ({ serviceTimeId: s.serviceTimeId, serviceId: s.serviceId, name: s.name, startsAt: s.startsAt, ymd: s.ymd })),
        defaultServiceTimeId: defaultService(c.today, services)?.serviceTimeId ?? null };
      if (!one) return out;
      const svc = services.find((s) => s.serviceTimeId === serviceTimeId);
      if (!svc) throw new BadRequestError('Pick a service from the list.');
      const svcAt = takenAt(mirrors, 'services');
      const byPerson = new Map<string, OutboxRow[]>();
      for (const r of rows) if (r.personId) byPerson.set(r.personId, [...(byPerson.get(r.personId) ?? []), r]);
      const state = (personId: string) => {
        const pr = byPerson.get(personId) ?? [];
        const st = effectiveCheckState({ mirrorIn: svc.checkedIn.some((x) => x.personId === personId), mirrorTakenAt: svcAt, rows: pr });
        const top = pr[0] ?? null;
        return { checkedIn: st.in, practice: st.practice, action: top ? view(top) : null, mine: top?.createdBy === actor.id };
      };
      const cmp = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });
      out.people = roster.filter((r) => r.active && (r.kind === 'student' || r.kind === 'leader'))
        .sort((a, b) => cmp(a.lastName, b.lastName) || cmp(a.firstName, b.firstName))
        .map((r) => ({ personId: r.personId, name: fullName(r), grade: r.grade, leader: r.kind === 'leader', ...state(r.personId) }));
      out.leaders = leaders.filter((l) => l.active).sort((a, b) => cmp(a.fullName, b.fullName)).map((l) => {
        const personId = rosterPersonOf(l, roster);
        return { leaderId: l.id, name: l.fullName, personId,
          ...(personId ? state(personId) : { checkedIn: false, practice: false, action: null, mine: false }) };
      });
      return out;
    },

    async enqueue(actor, item, device) {
      const c = context(actor, await gate(actor, 'link:use'));
      const { res, log } = await doEnqueue(c, item, dev(device));
      if (log) await d.link.addLog([log]);
      return res;
    },

    async cancel(actor, id, leaderId, device) {
      const c = context(actor, await gate(actor, 'link:use'));
      if (!Uuid.safeParse(id).success || (leaderId != null && !Uuid.safeParse(leaderId).success)) {
        return refused(String(id), 'cancel', new AppError('VALIDATION_ERROR', 'Validation failed', 400));
      }
      const { res, log } = await doCancel(c, id, leaderId ?? null, dev(device));
      await d.link.addLog([log]);
      return res;
    },

    async undo(actor, id, leaderId, newId, device) {
      const c = context(actor, await gate(actor, 'link:use'));
      if (![id, newId].every((x) => Uuid.safeParse(x).success) || (leaderId != null && !Uuid.safeParse(leaderId).success)) {
        return refused(String(id), 'undo', new AppError('VALIDATION_ERROR', 'Validation failed', 400));
      }
      const { res, log } = await doUndo(c, id, leaderId ?? null, newId, dev(device));
      await d.link.addLog([log]);
      return res;
    },

    async listActions(actor, q) {
      const c = context(actor, await gate(actor, 'link:use'));
      const Q = z.object({ ids: z.union([z.string(), z.array(z.string())]).optional(), serviceDate: Ymd.optional(),
        type: z.enum(ACTION_TYPES).optional() });
      const f = Q.parse(q ?? {});
      const ids = f.ids === undefined ? undefined
        : z.array(Uuid).max(200).parse((Array.isArray(f.ids) ? f.ids : f.ids.split(',')).map((s) => s.trim()).filter(Boolean));
      if (!ids && !f.serviceDate && !f.type) throw new BadRequestError('Give ids, or a serviceDate and type.');
      const rows = await d.link.listActions({ ids, serviceDateFrom: f.serviceDate, serviceDateTo: f.serviceDate,
        types: f.type ? [f.type] : undefined, createdBy: c.admin ? undefined : actor.id });
      const logins = new Map<string, string>();
      await Promise.all([...new Set(rows.map((r) => r.createdBy))].map(async (id) =>
        logins.set(id, (await d.users.findById(id))?.email ?? '')));
      // The admin checks an unclear row in Elvanto, so it needs the person; the console must not log names (B3 / T-7).
      const names = new Map<string, string | null>();
      if (c.admin) {
        for (const r of rows) if (r.status === 'unclear') names.set(r.id, (await targetOf(c, r)).name);
      }
      return rows.map((r) => ({ id: r.id, type: r.type, status: r.status, reason: r.reason,
        ...(c.admin ? { detail: r.detail } : {}), createdAt: r.createdAt, resultAt: r.resultAt, leaderName: r.leaderName,
        login: logins.get(r.createdBy) ?? '', hasNote: r.hasNote === true, ...(names.has(r.id) ? { name: names.get(r.id) } : {}) }));
    },

    async batch(actor, body) {
      const c = context(actor, await gate(actor, 'link:use'));
      const parsed = BatchBody.safeParse(body); // only a bad envelope fails the whole call
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Validation failed', 400, { details: parsed.error.errors });
      const b = parsed.data;
      const device = dev(b.device ?? undefined);
      const results: BatchItemResult[] = [];
      const logs: LinkLogRow[] = [];
      // B8 / T-39: tapAt = queuedAt + (serverNow - sentAt), never in the future; no queuedAt = now.
      const skew = b.sentAt ? c.t.getTime() - Date.parse(b.sentAt) : 0;
      const batchIds = new Set<string>();
      for (const x of b.items) {
        const o = (x && typeof x === 'object' ? x : {}) as { id?: unknown; newId?: unknown };
        for (const v of [o.id, o.newId]) if (typeof v === 'string') batchIds.add(v);
      }
      const tapOf = (queuedAt: string | undefined): Tap => ({ batchIds,
        at: new Date(queuedAt ? Math.min(c.t.getTime(), Date.parse(queuedAt) + skew) : c.t.getTime()) });
      for (const rawItem of b.items) {
        const pi = BatchItem.safeParse(rawItem);
        if (!pi.success) {
          const o = (rawItem && typeof rawItem === 'object' ? rawItem : {}) as { id?: unknown; kind?: unknown };
          const kind = (ITEM_KINDS as readonly unknown[]).includes(o.kind) ? o.kind as ItemKind : 'action';
          results.push(strip(refused(typeof o.id === 'string' ? o.id : '', kind, new AppError('VALIDATION_ERROR', 'Validation failed', 400))));
          continue;
        }
        const it = pi.data;
        try {
          let out: { res: ItemResult; log: LinkLogRow | null };
          if (it.kind === 'action') {
            const { kind: _k, queuedAt, ...raw } = it;
            out = await doEnqueue(c, raw, device, tapOf(queuedAt));
          } else if (it.kind === 'cancel') out = await doCancel(c, it.id, it.leaderId ?? null, device);
          else if (it.kind === 'undo') out = await doUndo(c, it.id, it.leaderId ?? null, it.newId, device, tapOf(it.queuedAt));
          else {
            const atMs = Date.parse(it.at);
            const at = atMs <= c.t.getTime() && atMs >= c.t.getTime() - 3 * 86_400_000 ? new Date(atMs).toISOString() : c.t.toISOString();
            out = { res: { id: it.id, kind: 'identity', outcome: 'logged', httpStatus: 200 },
              // The item id is the log id, so a retried identity item is written once (APP-71).
              log: await logRow(c, device, { id: it.id, at, event: 'identity', prevLeaderId: it.from, prevLeaderName: await leaderName(c, it.from),
                leaderId: it.to, leaderName: await leaderName(c, it.to), outcome: 'logged' }) };
          }
          results.push(strip(out.res));
          if (out.log) logs.push(out.log);
        } catch (e) {
          if (e instanceof AppError) { results.push(strip(refused(it.id, it.kind, e))); continue; }
          const er = e instanceof Error ? e : new Error(String(e));
          logger.error('batch item failed', { kind: it.kind, name: er.name, message: er.message, stack: er.stack }); // never the body
          if (isDbError(e)) {
            // A DB fault: keep the log rows so far, then fail the whole call so the phone retries it (ids make that
            // safe; done items come back `replay`).
            if (logs.length > 0) await d.link.addLog(logs).catch(() => {});
            throw new AppError('SERVICE_UNAVAILABLE', 'The service is temporarily unavailable. Please try again.', 503);
          }
          // Any other fault refuses this item alone (APP-7).
          const res = refused(it.id, it.kind, new AppError('INTERNAL', 'Something went wrong. Do it in Elvanto.', 500));
          results.push(strip(res));
          try {
            logs.push(await logRow(c, device, { event: it.kind === 'action' ? it.type : it.kind,
              outboxId: it.kind === 'identity' ? null : it.id, outcome: outcomeText(res) }));
          } catch { /* the log row is best effort */ }
        }
      }
      if (logs.length > 0) await d.link.addLog(logs);
      return { results };
    },

    async lifegroups(actor) {
      const c = context(actor, await gate(actor, 'link:use'));
      const [groups, mirrors, sent, open] = await Promise.all([c.groups(), c.mirror(),
        d.link.listActions({ types: ['submitReport'], statuses: ['sent'] }),
        d.link.listActions({ types: ['submitReport', 'editReport'], statuses: OPEN })]);
      const gAt = takenAt(mirrors, 'groups');
      return { groups: groups.filter((g) => groupVisible(actor, g, c.structure)).map((g) => {
        const o = open.find((r) => (r.payload as { groupId?: string }).groupId === g.groupId);
        return { groupId: g.groupId, name: g.name, meets: g.meets, members: g.members, thisWeek: g.thisWeek,
          lastReport: lastReportOf(g, sent, gAt), defaultDate: lastMeetingDate(g.meets, c.today), openAction: o ? view(o) : null };
      }) };
    },

    async flows(actor) {
      const c = context(actor, await gate(actor, 'link:use'));
      const [flows, roster, open] = await Promise.all([c.flows(), c.roster(),
        d.link.listActions({ types: ['completeStep'], statuses: OPEN })]);
      const byId = new Map(roster.map((r) => [r.personId, r]));
      const rows = flows.filter((f) => personVisible(actor, f.personId ? byId.get(f.personId) : undefined, c.structure))
        .sort((a, b) => a.flowName.localeCompare(b.flowName) || a.stepOrder - b.stepOrder)
        .map((f: LinkFlowRow) => {
          const o = open.find((r) => (r.payload as { rowId?: string }).rowId === f.rowId);
          return { rowId: f.rowId, flowId: f.flowId, stepId: f.stepId, flowName: f.flowName, stepName: f.stepName,
            stepOrder: f.stepOrder, personId: f.personId, name: f.name, due: f.due, assignedTo: f.assignedTo, openAction: o ? view(o) : null };
        });
      return { rows };
    },

    async rosterForMatching(actor, q) {
      await gate(actor, 'link:admin');
      const f = z.object({ match: z.enum(MATCHES).optional() }).parse(q ?? {});
      const [roster, students] = await Promise.all([d.link.roster(), d.students.findAll()]);
      // Active students that still need a match (never `auto`), plus any inactive row still holding a student, so the
      // admin can release it (APP-11). Candidates only for none/ambiguous, from one index of folded names.
      const rows = roster.filter((r) => ((r.active && r.kind === 'student' && r.match !== 'auto') || (!r.active && r.studentId))
        && (!f.match || r.match === f.match));
      const byName = new Map<string, typeof students>();
      const add = (k: string, s: (typeof students)[number]) => byName.set(k, [...(byName.get(k) ?? []), s]);
      if (rows.some((r) => r.match === 'none' || r.match === 'ambiguous')) {
        for (const s of students) { add('n:' + fold(fullName(s)), s); add('l:' + fold(s.lastName), s); }
      }
      const candidatesOf = (r: LinkRosterRow): MatchCandidate[] => {
        if (r.match !== 'none' && r.match !== 'ambiguous') return [];
        const seen = new Set<string>();
        return [...(byName.get('n:' + fold(fullName(r))) ?? []), ...(byName.get('l:' + fold(r.lastName)) ?? [])]
          .filter((s) => !seen.has(s.id) && seen.add(s.id))
          .sort((a, b) => students.indexOf(a) - students.indexOf(b))
          .map((s) => ({ studentId: s.id, name: fullName(s), grade: s.grade, dob: s.dateOfBirth }));
      };
      return { rows: rows.map((r) => ({ personId: r.personId, name: fullName(r), grade: r.grade, kind: r.kind, active: r.active,
        studentId: r.studentId, match: r.match, candidates: candidatesOf(r) })) };
    },

    async setMatch(actor, personId, body) {
      await gate(actor, 'link:admin');
      const b = z.object({ studentId: Uuid.nullable(), ignore: z.literal(true).optional() }).parse(body ?? {});
      const roster = await d.link.roster();
      if (!roster.some((r) => r.personId === personId)) throw new NotFoundError('This person is not in the roster.');
      let change: { personId: string; studentId: string | null; match: Match };
      const release: { personId: string; studentId: null; match: Match }[] = [];
      if (b.ignore) change = { personId, studentId: null, match: 'ignored' };
      else if (b.studentId) {
        if (!(await d.students.findById(b.studentId))) throw new NotFoundError('No such student.');
        const holder = roster.find((r) => r.personId !== personId && r.studentId === b.studentId);
        if (holder?.active) throw new ConflictError('This student is already matched to someone else.');
        // An inactive holder (a merged or removed Elvanto profile) is released first (APP-11 B).
        if (holder) release.push({ personId: holder.personId, studentId: null, match: 'none' });
        change = { personId, studentId: b.studentId, match: 'manual' };
      } else change = { personId, studentId: null, match: 'none' };
      await d.link.setMatches([...release, change]);
      return change;
    },

    async shadowCheck(actor, date) {
      await gate(actor, 'link:admin');
      const day = Ymd.parse(date);
      const sessions = (await d.serviceSessions.findAll()).filter((s) => s.sessionDate.slice(0, 10) === day);
      if (sessions.length === 0) return { date: day, imported: false, message: 'Not in the import', rows: [], unlinkedAttenders: 0 };
      const [att, roster, rows] = await Promise.all([
        Promise.all(sessions.map((s) => d.serviceAttendance.findBySession(s.id))).then((x) => x.flat()),
        d.link.roster(),
        d.link.listActions({ types: ['checkIn'], statuses: ['sent', 'shadowed'], serviceDateFrom: day, serviceDateTo: day })]);
      const attended = new Set(att.filter((a) => a.attended).map((a) => a.studentId));
      const byId = new Map(roster.map((r) => [r.personId, r]));
      const linked = new Set<string>();
      const out: ShadowRow[] = rows.map((r) => {
        const p = r.personId ? byId.get(r.personId) : undefined;
        const studentId = r.studentId ?? p?.studentId ?? null;
        if (studentId) linked.add(studentId);
        const verdict: ShadowVerdict = !studentId ? 'no-student'
          : r.status === 'sent' ? (attended.has(studentId) ? 'matched' : 'sent-not-imported')
            : (attended.has(studentId) ? 'practice-matched' : 'practice-missing');
        return { id: r.id, personId: r.personId, name: p ? fullName(p) : null, status: r.status, studentId, verdict,
          ...(verdict === 'sent-not-imported' ? { message: 'In Elvanto; in YS attendance after the next import.' } : {}) };
      });
      return { date: day, imported: true, rows: out, unlinkedAttenders: [...attended].filter((s) => !linked.has(s)).length };
    },

    async log(actor, q) {
      await gate(actor, 'link:admin');
      const f = z.object({ from: Ymd.optional(), to: Ymd.optional(), login: z.string().max(200).optional(),
        event: z.enum(LOG_EVENTS).optional() }).parse(q ?? {});
      const to = f.to ?? brisbaneToday(clock());
      const from = f.from ?? addDays(to, -6);
      let userId: string | undefined;
      if (f.login) {
        const u = await d.users.findByEmail(f.login);
        if (!u) return { rows: [] };
        userId = u.id;
      }
      return { rows: await d.link.listLog({ from: brisbaneStart(from), to: brisbaneStart(addDays(to, 1)), userId,
        event: f.event, limit: LOG_MAX }) };
    },
  };
}
