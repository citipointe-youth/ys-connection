// Elvanto link, app side: the leader + admin service (spec 2026-10-12-elvanto-link-app-design.md §2, §6, §8.2, §9.1;
// contract 2026-10-11 §4, §5). Every method starts with gate(): its module (T10: modules.checkin / lifegroupReport /
// flows) + RBAC; the admin routes are the admin login's in every module state (T9).
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
  ActionType, Capabilities, ConsoleRow, LinkFlowRow, LinkFlowStep, LinkGroupRow, LinkLastReport, LinkLogRow, LinkRosterRow,
  LinkServiceRow, LogEvent, Match, MirrorKind, MirrorStateRow, OutboxRow, Status,
} from '../core/link-types';
import { MATCHES } from '../core/link-types';
import { ACTION_TYPES, CONSENT_TYPES, type ConsentLookupKind, LINK_REV, MIRROR_KINDS, NOTE_FAILED_DETAIL, PAYLOAD_SCHEMAS, Uuid, isDnc } from '../core/link-contract';
import {
  AppError, BadRequestError, ConflictError, ForbiddenError, ModuleDisabledError, NotFoundError, TooManyRequestsError,
} from '../core/errors/app-error';
import {
  ConsentCheckFirst, LinkBusyRow, LinkDnc, LinkEditInElvanto, LinkIdExists, LinkIdReused, LinkNotYours, LinkOpenDuplicate, LinkStale,
  LinkStillSending, LinkTooOld, LinkUnavailable,
} from '../core/errors/link-errors';
import { makeLeaderService } from './leader.service';
import { createLogger } from '../utils/logger';
import { isDbError } from '../utils/transient-db';
import type { ErrorLogService } from './error-log.service';
import type { ILinkIntakeRepository } from '../repositories/interfaces/link-intake.repository';
import { checkIntakeItem, intakeGate, isIntakeType } from './link-intake.service';
import {
  can, canAccessGender, canAccessGrade, canAccessStudent, canEditGroupMembers, genderScopeOf, isAdminRole, leaderInScope, modeAllows, type StructureScope,
} from './access-control';
import {
  LINK_CUTOFF_DAYS, addDays, brisbaneToday, dedupeKey, defaultService, effectiveCheckState, effectiveMembers, lastMeetingDate, meetsWeekday,
  noteRoom, pickList, matchFold, serviceDay, genderFixes, isConsentStep, peopleFlowName, consentStepAllowed, consentFriday,
} from './link-rules';
import { saveGenderFixes } from './sync.service';

export const LINK_NOTE_MAX = 1800;
export const LINK_BATCH_MAX = 50;
export const LINK_RATE_MAX = 600;          // new outbox rows per login … (B12 / T-36: replays and duplicates never count)
export const LINK_RATE_WINDOW_MS = 600_000; // … per 10 minutes (container builds the RateLimiter with these)
const LOG_MAX = 2000;
const logger = createLogger('link');
const REPORT_BACK_DAYS = 14;
const FLOW_BACK_DAYS = 7;       // S-1: a refused flow step is shown back for a week
const TYPE_ONLY_MAX = 100;      // S-1: GET /link/actions?type= alone returns the newest 100
const CONSOLE_RECENT_MS = 600_000;
const BRISBANE_MS = 10 * 3_600_000;
const SWEEP_EVERY_MS = 5 * 60_000; // S-2: the read-path too-old sweep, per instance

const NOTE_TYPES: ActionType[] = ['submitReport', 'editReport', 'completeStep', 'removeFromFlowStep'];
/** Rev 6: the flow-row types (one open per row between them). */
const FLOW_ROW_TYPES: ActionType[] = ['completeStep', 'removeFromFlowStep'];
const isConsentType = (t: ActionType) => (CONSENT_TYPES as readonly string[]).includes(t);
/** Rev 6 (R2 b): a consentLookup's search text (the encrypted note). */
const LOOKUP_Q_MAX = 60;
const CHECK_TYPES: ActionType[] = ['checkIn', 'checkOut'];
const MEMBER_TYPES: ActionType[] = ['addGroupMember', 'removeGroupMember']; // T6 (contract X18)
const OPEN: Status[] = ['pending', 'claimed', 'unclear'];
const LOG_EVENTS = [...ACTION_TYPES, 'identity', 'cancel', 'undo', 'resolve'] as const;

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
/** One item's result in a /link/batch reply (spec §9.1). */
export interface ItemResult {
  id: string; kind: ItemKind; outcome: ItemOutcome;
  existingId?: string; code?: string; message?: string; reason?: string; action?: ActionView;
  /** B6 / APP-50: true when this call stored (or replayed) the row; false on duplicate (someone else's row). */
  mine?: boolean;
}
export type BatchItemResult = ItemResult;

export interface LinkStatus {
  console: { lastSeenAt: string | null; online: boolean; inWindow: boolean; pollSeconds: number | null;
    capabilities: Capabilities | null; consoles: number;
    /** S5: the newest console's fresh progress entries by key (intake:<mode>:<date> is the Refresh ask's). */
    progress: Record<string, ProgressView> };
  mirrors: Record<MirrorKind, { takenAt: string | null; ageSeconds: number | null }>;
  /** T1: the newest console's LINK_REV (null = no console yet) and this app's; the admin page warns when lower. */
  consoleLinkRev: number | null; appLinkRev: number;
}
/** `isDefault`: the default service of its own day (spec §2.3; APP-43), so the report form needs no copy of the rule. */
export interface ServiceView { serviceTimeId: string; serviceId: string; name: string; startsAt: string; ymd: string; isDefault: boolean }
export interface CheckinPerson { personId: string; name: string; grade: number | null; leader: boolean; checkedIn: boolean;
  action: ActionView | null; mine: boolean; /** T3: shown from the pushed check-in name only: check out works, check in does not. */ noRoster?: true }
export interface CheckinLeader { leaderId: string; name: string; personId: string | null; checkedIn: boolean;
  action: ActionView | null; mine: boolean }
export interface CheckinView { today: string; services: ServiceView[]; defaultServiceTimeId: string | null;
  people?: CheckinPerson[]; leaders?: CheckinLeader[] }
export interface ActionListRow { id: string; type: ActionType; status: Status; reason: string | null; detail?: string | null;
  createdAt: string; resultAt: string | null; leaderName: string; login: string; hasNote: boolean;
  /** B3 / T-7, B17: the person (or group / flow row) of an `unclear` row or a first-timer, for link:admin only. */
  name?: string | null;
  /** C-1 (F-37): 'failed' = a sent remove whose Elvanto note was not saved; missing otherwise. */
  note?: 'failed';
  /** S-1 / D7 (link:admin only): the consent fix/link screen's key: personId (consentFix), 'cn:'+subId (consentLink). */
  fixKey?: string }
/** T8: `history` newest first (<= 8, the last report included); the list comes sorted grade, girls then boys. */
export interface LifegroupView { groupId: string; name: string; grade: number | null; gender: LinkGroupRow['gender'];
  meets: string; members: LinkGroupRow['members']; thisWeek: LinkGroupRow['thisWeek']; lastReport: LinkLastReport | null;
  history: LinkLastReport[]; defaultDate: string; openAction: ActionView | null;
  /** S-1 / D7: the newest report row of the last 14 days when it was refused and nothing is open; else the key is absent. */
  lastRefused?: ActionView }
/** T4/T6: the person's own grade/gender/mobile (decrypted, bare digits) and the app-side assignee. */
export interface FlowView { rowId: string; flowId: string; stepId: string; flowName: string; stepName: string; stepOrder: number;
  personId: string | null; name: string; due: string | null; assignedTo: string; openAction: ActionView | null;
  grade: number | null; gender: LinkFlowRow['gender']; mobile: string | null; mobileIsParent: boolean;
  assignedLeaderId: string | null; assignedLeaderName: string | null;
  /** Rev 6 (R1): the profile consent flag; dnc = contact|all (mobile is then null for a non-admin/director login). */
  consent: 'ok' | 'contact' | 'all' | 'unknown'; dnc: boolean;
  /** Rev 6 (review C1): the New People consent step; Complete there is refused CONSENT_CHECK_FIRST unless the consent check is done. */
  consentStep: boolean;
  /** R4/R6 (rev 9): on the consent step, the consent Friday this row waits for (null elsewhere or with no due date), and whether
   *  Complete is open as "consent not received" (that Friday 9:00 passed, no consent on the profile, a rev 9 console). The batch
   *  still refuses it while a consent row for the person is open. */
  consentFriday: string | null; notReceivedOk: boolean;
  /** S-1 / D7: the newest Complete/Remove of the last 7 days when it was refused and nothing is open; else the key is absent. */
  lastRefused?: ActionView }
/** Rev 6 (R2 b/c): GET /link/consents/lookup. `rows` are ConsentFormRow / ConsentMismatchRow (link-contract.ts). R9: an `other`
 *  row also carries flowId, stepId, dnc, consentFriday, notReceivedOk and marking (otherWait). */
export interface ConsentLookupView { id: string; kind: ConsentLookupKind; status: 'waiting' | 'working' | 'ready' | 'failed';
  reason: string | null; page: number; pageSize: number; total: number | null; takenAt: string | null; rows: unknown[];
  /** S5: while working, how far the console has got (null = not known). */
  progress?: ProgressView | null }
export interface MatchCandidate { studentId: string; name: string; grade: number | null; dob: string | null }
/** A roster row the admin may need to act on (APP-40: no unused fields, so fewer minors' details on the wire). */
export interface MatchRow { personId: string; name: string; grade: number | null; kind: LinkRosterRow['kind'];
  active: boolean; studentId: string | null; match: Match; candidates: MatchCandidate[] }
/** T5: a group member as this login may see them: studentId only when that student is in its scope (canAccessStudent). */
export interface MemberView { personId: string; name: string; leader: boolean; grade: number | null; studentId: string | null }
/** T6: a member change of the last 3 days (not cancelled), newest first. name = the roster's (an add is not a member yet). */
export interface MemberChange { id: string; type: ActionType; personId: string | null; name: string | null; status: Status;
  reason: string | null; createdAt: string; resultAt: string | null }
export interface GroupMembersView { groupId: string; canEdit: boolean; members: MemberView[]; changes: MemberChange[] }
/** T6: the Add student picker: active youth roster rows (not 'other') this login may see. Name + grade only. */
export interface YouthRow { personId: string; name: string; grade: number | null }

export interface LinkService {
  status(actor: Actor): Promise<LinkStatus>;
  checkin(actor: Actor, serviceTimeId?: string): Promise<CheckinView>;
  listActions(actor: Actor, q: unknown): Promise<ActionListRow[]>;
  batch(actor: Actor, body: unknown): Promise<{ results: BatchItemResult[] }>;
  lifegroups(actor: Actor): Promise<{ groups: LifegroupView[] }>;
  /** `steps` (link:admin only): every pushed flow step, hidden ones included, for the Youth Setup hidden-step picker. */
  /** T12: every login gets `steps` (the console's pushed list, else from the rows), minus the hidden step for a non-admin. */
  flows(actor: Actor): Promise<{ rows: FlowView[]; steps: LinkFlowStep[]; progress: ProgressView | null }>;
  groupMembers(actor: Actor, groupId: string, q: unknown): Promise<GroupMembersView>;
  youth(actor: Actor, q?: unknown): Promise<{ rows: YouthRow[] }>;
  assignFlow(actor: Actor, body: unknown): Promise<{ ok: true }>;
  rosterForMatching(actor: Actor, q: unknown): Promise<{ rows: MatchRow[] }>;
  setMatch(actor: Actor, personId: string, body: unknown): Promise<{ personId: string; studentId: string | null; match: Match }>;
  /** CY-A1: the admin says whether an unclear row landed in Elvanto (the console's own `resolved` transition). */
  resolveUnclear(actor: Actor, id: string, body: unknown): Promise<{ ok: true; status: 'sent' | 'refused' }>;
  log(actor: Actor, q: unknown): Promise<{ rows: LinkLogRow[] }>;
  /** Rev 6 (R2 b/c): the console's answer to one consentLookup row (admin only, module intakeAdmin). */
  consentLookup(actor: Actor, q: unknown): Promise<ConsentLookupView>;
}

export interface LinkServiceDeps {
  link: ILinkRepository; settings: ISettingsRepository; students: IStudentRepository; leaders: ILeaderRepository;
  users: IUserRepository; serviceSessions: IServiceSessionRepository; serviceAttendance: IServiceAttendanceRepository;
  limiter: { isBlocked(key: string): boolean };
  now?: () => Date;
  /** T3 admin Error log; a batch item that crashes is recorded here (kind/type only). */
  errorLog?: Pick<ErrorLogService, 'record'>;
  /** T4 (X19): the pushed intake plans, to check an intake batch item. Without it every intake item is refused. */
  intake?: ILinkIntakeRepository;
}

// ---------------------------------------------------------------- helpers

const fullName = (r: { firstName: string; lastName: string }) => `${r.firstName} ${r.lastName}`.trim();
const view = (r: OutboxRow): ActionView => ({ id: r.id, type: r.type, status: r.status, reason: r.reason });
/** S-1 / D7: `{lastRefused}` = of one group's / row's final rows (newest first) the newest, when it was refused and no
 *  row is open (a later sent or cancelled one clears it, RV-S-m3); otherwise `{}`, so the key is absent (the SPA hides the line). */
const refusedLast = (open: OutboxRow | undefined, rows: OutboxRow[]): { lastRefused?: ActionView } =>
  (!open && rows[0]?.status === 'refused' ? { lastRefused: view(rows[0]) } : {});
/** S-1 / D7: the key the consent fix/link screen keeps its state under (I.fixes). */
function fixKeyOf(r: OutboxRow): string | null {
  const p = r.payload as { personId?: unknown; subId?: unknown };
  if (r.type === 'consentFix' && typeof p.personId === 'string') return p.personId;
  if (r.type === 'consentLink' && typeof p.subId === 'string') return `cn:${p.subId}`;
  return null;
}
/** S5: how far a long console job has got (POST /sync/push/progress); stale after 2 min, or once `after` (the push it
 *  leads to) has landed. null = nothing known (the SPA slides its bar). */
export interface ProgressView { done: number | null; total: number | null; stage: string }
const PROGRESS_FRESH_MS = 120_000;
export function progressOf(con: ConsoleRow | null, key: string, now: number, after?: string | null): ProgressView | null {
  const p = con?.progress?.[key];
  if (!p || now - Date.parse(p.at) > PROGRESS_FRESH_MS || (after && Date.parse(p.at) <= Date.parse(after))) return null;
  return { done: p.done, total: p.total, stage: p.stage };
}
const newest = (cs: ConsoleRow[]) => [...cs].sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))[0] ?? null;
/** R4/R6 (rev 9): the FlowView consent-wait fields of one flow row (see FlowView): the batch's own verdict, so the phone offers
 *  Complete exactly when the batch takes it. `consent` is the row's shown (sticky) flag. R8 (rev 10): the Friday counts from
 *  the row's textedOn when the console sent one, else its due date (one date for the step list and Consents Other). */
function consentWait(f: LinkFlowRow, consent: string, consentRows: { key: string; status: string }[], rev: number, now: Date,
  people: string | null): { consentFriday: string | null; notReceivedOk: boolean } {
  const fri = isConsentStep(f, people) ? consentFriday(f.due, f.textedOn) : null;
  return { consentFriday: fri, notReceivedOk: !!fri && consentStepAllowed({ personId: f.personId, consent, due: f.due, textedOn: f.textedOn }, consentRows, now, rev) === 'notReceived' };
}
/** E3: this year's New People flow among the pushed flow rows. */
const peopleFlowOf = (flows: LinkFlowRow[], now: Date) => peopleFlowName(flows.map((f) => f.flowName), brisbaneToday(now));
/** Resilience H3: a flow row's shown consent flag; an unreadable flow profile (unknown) falls back to the roster's sticky flag. */
function shownConsent(f: LinkFlowRow, byId: Map<string, LinkRosterRow>): 'ok' | 'contact' | 'all' | 'unknown' {
  if (f.consent === 'ok' || f.consent === 'contact' || f.consent === 'all') return f.consent;
  const r = f.personId ? byId.get(f.personId) : undefined;
  return isDnc(r?.consent) ? r!.consent! as 'contact' | 'all' : f.consent ?? 'unknown';
}
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
/**
 * T4: a flow row is seen by its own grade/gender first, then the roster's (no grade = admin/director only, through
 * canAccessGrade). Step 0, Elvanto's first step (the console numbers every step from 1, empty ones included), is the
 * 7-day wait: it moves on its own (contact consent confirmed, or 6.5 days), so no non-admin login lists, completes or
 * assigns it on the Flow Steps screen (admin / director still see it; no intake screen is affected). Operator 2026-10-14b T11.
 */
/** The admin's pick per flow (modules.flowHiddenStep): missing / '' = the first step, 'none' = none, else that step id. */
export function stepHidden(a: Actor, f: Pick<LinkFlowRow, 'flowId' | 'stepId' | 'stepOrder'>, picks: Record<string, string> | undefined): boolean {
  if (isAdminRole(a)) return false; // T11: the Flow Steps screen hides it from non-admin logins only
  const h = picks?.[f.flowId] || '';
  return h === '' ? f.stepOrder <= 1 : f.stepId === h;
}
function flowRowVisible(a: Actor, f: LinkFlowRow, roster: Map<string, LinkRosterRow>, s: StructureScope, hidden: Record<string, string> | undefined): boolean {
  if (stepHidden(a, f, hidden)) return false;
  const r = f.personId ? roster.get(f.personId) : undefined;
  const grade = f.grade ?? r?.grade ?? null;
  const gender = f.gender ?? r?.gender ?? null;
  return canAccessGrade(a, grade, s) && (gender ? canAccessGender(a, gender, s) : genderScopeOf(a, s) == null);
}
/** T6: a youth roster person this login may pick (admin/director: anyone; else grade, then gender when known). */
// F-50(a): unknown gender is visible only to a login with no gender scope (as flowRowVisible).
export function personVisible(a: Actor, r: LinkRosterRow, s: StructureScope): boolean {
  return isAdminRole(a) || (canAccessGrade(a, r.grade, s) && (r.gender ? canAccessGender(a, r.gender, s) : genderScopeOf(a, s) == null));
}
/**
 * Read-time name match (decision 20; B11): one active roster row of kind leader with the X8-folded name. No leader row
 * means Not linked (never a same-name student or other, APP-10). Two active app leaders with the same folded name are
 * both Not linked (APP-55). APP-79: the folded names are indexed once per call, not once per leader.
 * T8 (2026-10-14b): keyed on matchFold (case, spaces, hyphens, apostrophes, dots), as students are; the console adds a leader
 * found in Elvanto by exactly one non-archived person of that name.
 */
function rosterPersonMatcher(roster: LinkRosterRow[], appLeaders: Leader[]): (l: Leader) => string | null {
  const appCount = new Map<string, number>();
  for (const x of appLeaders) if (x.active) { const k = matchFold(x.fullName); appCount.set(k, (appCount.get(k) ?? 0) + 1); }
  const byName = new Map<string, LinkRosterRow[]>();
  for (const r of roster) {
    if (!r.active || r.kind !== 'leader') continue;
    const k = matchFold(fullName(r));
    byName.set(k, [...(byName.get(k) ?? []), r]);
  }
  return (l) => {
    const key = matchFold(l.fullName);
    if ((appCount.get(key) ?? 0) > 1) return null;
    const g = l.gender === 'male' || l.gender === 'female' ? l.gender : null;
    const hits = (byName.get(key) ?? []).filter((r) => !g || !r.gender || r.gender === g);
    return hits.length === 1 ? hits[0]!.personId : null;
  };
}

/** T10: the three link screens, each its own module mode (ministryConfig.modules). */
type Feature = 'checkin' | 'lifegroupReport' | 'flows';
const FEATURES: Feature[] = ['checkin', 'lifegroupReport', 'flows'];
const FEATURE_OF: Partial<Record<ActionType, Feature>> = { checkIn: 'checkin', checkOut: 'checkin', firstTimerCheckIn: 'checkin',
  submitReport: 'lifegroupReport', editReport: 'lifegroupReport', completeStep: 'flows',
  addGroupMember: 'lifegroupReport', removeGroupMember: 'lifegroupReport', removeFromFlowStep: 'flows' }; // the intake + consent types: module intakeAdmin (X19, rev 6)
/** `?? newYouthForms`: a json-mode settings file stored before T10 is never re-parsed. */
const usable = (a: Actor, s: AppSettings, f: Feature) =>
  can(a, 'link:use') && modeAllows(a, s.ministryConfig.modules[f] ?? s.ministryConfig.modules.newYouthForms);

const refused = (id: string, kind: ItemKind, e: AppError): ItemResult => ({ id, kind, outcome: 'refused',
  code: e.code, message: e.message, ...(typeof e.extra?.reason === 'string' ? { reason: e.extra.reason } : {}) });

interface Target { kind: LinkLogRow['targetKind']; id: string | null; name: string | null }
/** B8: when the tap happened (server clock) and the ids of the batch it came in (they never make each other stale). */
interface Tap { at: Date; batchIds: Set<string>; deviceId: string | null }
interface Who { id: string | null; name: string | null }

// ---------------------------------------------------------------- service

export function makeLinkService(d: LinkServiceDeps): LinkService {
  const clock = d.now ?? (() => new Date());

  /**
   * T9/T10: 'admin' = link:admin (the admin login only), in every module state, else 403. A feature list passes when
   * any of those screens is usable (its own mode, then link:use), else 404. 'any' = any link screen, and the admin
   * always (its page reads status and actions, and cancels through the batch).
   */
  async function gate(actor: Actor, need: Feature[] | 'any' | 'admin'): Promise<AppSettings> {
    const settings = await access(actor, need);
    await sweepIfDue();
    return settings;
  }
  // S-2 / D6: the claim's too-old sweep also runs on link reads, so a row never sits pending forever while the console
  // is off. Thresholds are the claim's (3 days, intake 24 h). Never fails the read; swept rows go to the error log as
  // the claim's do. ponytail: throttled per instance (serverless), a DB-side schedule if that ever bites.
  let lastSweep = -Infinity;
  async function sweepIfDue(): Promise<void> {
    const t = clock().getTime();
    if (t - lastSweep < SWEEP_EVERY_MS) return;
    lastSweep = t;
    try {
      const n = new Map<string, number>();
      for (const s of await d.link.sweepTooOld(LINK_CUTOFF_DAYS)) n.set(s.type, (n.get(s.type) ?? 0) + 1);
      await Promise.all([...n].map(([route, count]) => d.errorLog?.record({ category: 'link', code: 'too-old', route, role: 'console', count })));
    } catch (e) {
      logger.warn('too-old sweep failed', { message: e instanceof Error ? e.message : String(e) });
    }
  }
  async function access(actor: Actor, need: Feature[] | 'any' | 'admin'): Promise<AppSettings> {
    const settings = await d.settings.getSettings();
    const admin = can(actor, 'link:admin');
    if (need === 'admin') {
      if (!admin) throw new ForbiddenError('Only the admin can do this.');
      return settings;
    }
    if (need === 'any' && admin) return settings;
    if (!(need === 'any' ? FEATURES : need).some((f) => usable(actor, settings, f))) throw new ModuleDisabledError('Elvanto link');
    return settings;
  }

  type Ctx = ReturnType<typeof context>;
  /** Per call: one clock reading and memoised mirror reads (a batch of 50 reads each table once). */
  function context(actor: Actor, settings: AppSettings) {
    const memo = <T>(f: () => Promise<T>) => { let p: Promise<T> | undefined; return () => (p ??= f()); };
    const t = clock();
    return {
      actor, settings, t, today: brisbaneToday(t), structure: settings.ministryConfig.structure as StructureScope,
      admin: can(actor, 'link:admin'),
      roster: memo(() => d.link.roster()), services: memo(() => d.link.services()), groups: memo(() => d.link.groups()),
      flows: memo(() => d.link.flows()), consoles: memo(() => d.link.listConsoles()), mirror: memo(() => d.link.mirrorState()),
      leaders: memo(() => d.leaders.findAll()),
      // Rev 6: read once per batch. ponytail: a Complete and a Remove for one row queued in the SAME batch are not seen by each other.
      openFlowRows: memo(() => d.link.listActions({ types: FLOW_ROW_TYPES, statuses: OPEN })),
      consentRows: memo(async () => (d.intake ? d.intake.rows('consent') : [])),
      login: memo(async () => (await d.users.findById(actor.id))?.email ?? actor.displayName),
    };
  }
  const takenAt = (ms: MirrorStateRow[], k: MirrorKind) => ms.find((m) => m.kind === k)?.takenAt ?? null;

  async function logRow(c: Ctx, device: Device, p: Partial<LinkLogRow> & { event: LogEvent; outcome: string }): Promise<LinkLogRow> {
    return { id: randomUUID(), at: c.t.toISOString(), userId: c.actor.id, login: await c.login(), deviceId: device.id,
      deviceLabel: device.label, leaderId: null, leaderName: null, prevLeaderId: null, prevLeaderName: null, targetKind: null,
      targetId: null, targetName: null, outboxId: null, ...p };
  }
  const leaderName = async (c: Ctx, id: string | null) => (id ? (await c.leaders()).find((l) => l.id === id)?.fullName ?? null : null);

  /** "I am" (spec §2.2): a junior leader login always uses its bound leader; required for the three note types.
   *  F1 (review 2026-10-16): every other login may only act as a leader inside leaderInScope — the same rule as the
   *  Home / link "I am" pickers (GET /leaders?pick=1). An out-of-scope id is treated exactly like an unknown id:
   *  a plain action is recorded under the login's own name, a note type is refused, cancel/undo compares against null.
   *  Director/admin may act as anyone. `identity` log items are not actions and are left alone. */
  async function scopedLeader(c: Ctx, id: string | null): Promise<Leader | null> {
    if (!id) return null;
    const l = (await c.leaders()).find((x) => x.id === id);
    return l && leaderInScope(c.actor, l, c.structure) ? l : null;
  }
  async function resolveLeader(c: Ctx, given: string | null | undefined, required: boolean): Promise<{ id: string | null; name: string }> {
    const l = await scopedLeader(c, c.actor.role === 'leader' ? (c.actor.leaderId ?? null) : (given ?? null));
    if (required && !l) throw new BadRequestError('Pick who you are first.');
    return l ? { id: l.id, name: l.fullName } : { id: null, name: c.actor.displayName };
  }

  /** R9 (consents run 2026-10-17): each Consents Other row with its step-0 row's consent wait, as GET /link/flows shows it, so
   *  "Mark not received" is offered exactly when the batch takes it. A row whose step-0 row has gone (moved on, a newer flows
   *  push) gets flowId null and no button; `marking` = a Complete for that row is already open. */
  async function otherWait(c: Ctx, rows: { rowId: string }[]) {
    const [flows, roster, consoles, open, cRows] = await Promise.all([c.flows(), c.roster(), c.consoles(), c.openFlowRows(), c.consentRows()]);
    const rev = newest(consoles)?.linkRev ?? 1, now = clock(), byId = new Map(roster.map((r) => [r.personId, r]));
    const people = peopleFlowOf(flows, now);
    return rows.map((o) => {
      const f = flows.find((x) => x.rowId === o.rowId && isConsentStep(x, people));
      if (!f) return { ...o, flowId: null, stepId: null, dnc: false, consentFriday: null, notReceivedOk: false, marking: false };
      const consent = shownConsent(f, byId);
      return { ...o, flowId: f.flowId, stepId: f.stepId, dnc: isDnc(consent), ...consentWait(f, consent, cRows, rev, now, people),
        marking: open.some((r) => r.type === 'completeStep' && (r.payload as { rowId?: string }).rowId === f.rowId) };
    });
  }

  /**
   * The group's last report: the mirror's, or the overlay. T-27 / APP-29: the overlay is the newest sent submitReport
   * or editReport sent after the groups push, by report date then resultAt (an edit carries its reportId in the
   * payload). Editable while the console confirms link-sent reports stay editable (its T-27 test).
   */
  type RP = { groupId?: string; reportId?: string; date: string; didNotMeet: boolean; attendees: string[]; guests: number;
    serviceTimeId: string | null };
  function lastReportOf(g: LinkGroupRow, sentReports: OutboxRow[], groupsTakenAt: string | null): LinkLastReport | null {
    const rid = (r: OutboxRow) => r.reportId ?? (r.payload as RP).reportId ?? null;
    const ov = sentReports
      .filter((r) => (r.payload as RP).groupId === g.groupId && rid(r) && r.resultAt &&
        (!groupsTakenAt || Date.parse(r.resultAt) > Date.parse(groupsTakenAt)))
      .sort((a, b) => ((b.payload as RP).date.localeCompare((a.payload as RP).date))
        || Date.parse(b.resultAt!) - Date.parse(a.resultAt!))[0];
    if (!ov) return g.lastReport;
    const p = ov.payload as RP;
    if (g.lastReport && g.lastReport.date > p.date) return g.lastReport;
    return { reportId: rid(ov)!, date: p.date, time: '', didNotMeet: p.didNotMeet, attendees: p.attendees, guests: p.guests,
      serviceTimeId: p.serviceTimeId, editable: true, blocked: null };
  }
  const REPORT_TYPES: ActionType[] = ['submitReport', 'editReport'];

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
    if (isIntakeType(r.type)) return { kind: null, id: null, name: null }; // X19: the family is in the plan, not the roster
    if (MEMBER_TYPES.includes(r.type)) {
      const x = (await c.roster()).find((y) => y.personId === p.personId);
      return { kind: 'person', id: p.personId ?? null, name: x ? fullName(x) : null };
    }
    const f = (await c.flows()).find((y) => y.rowId === p.rowId);
    return { kind: 'flowRow', id: p.rowId ?? null, name: f?.name ?? null };
  }

  /** T6: the "I am" leader is a leader of this group in Elvanto (matched to the roster by name, as on the door). */
  async function leadsGroup(c: Ctx, g: LinkGroupRow, leaderId: string | null): Promise<boolean> {
    const leaders = await c.leaders();
    const l = leaderId ? leaders.find((x) => x.id === leaderId) : undefined;
    const pid = l ? rosterPersonMatcher(await c.roster(), leaders)(l) : null;
    return !!pid && g.members.some((m) => m.leader && m.personId === pid);
  }
  const memberRows = (groupId: string, personId?: string) => d.link.listActions({ groupId, types: MEMBER_TYPES, personId });
  const nameOfPerson = (roster: LinkRosterRow[]) => {
    const by = new Map(roster.map((r) => [r.personId, fullName(r)]));
    return (pid: string) => by.get(pid) ?? '';
  };

  const checkRows = (personId: string, serviceTimeId: string) =>
    d.link.listActions({ personId, serviceTimeId, types: CHECK_TYPES });

  // ---- enqueue (spec §8.2 steps 1–6). Throws AppError for a refusal; the caller turns it into a result.
  async function enqueueChecked(c: Ctx, it: z.infer<typeof ActionItem>, tgt: Target, who: Who, tap?: Tap): Promise<ItemResult> {
    const ok = (row: OutboxRow, outcome: 'saved' | 'replay'): ItemResult =>
      ({ id: it.id, kind: 'action', outcome, action: view(row), mine: true });
    const dup = (row: OutboxRow): ItemResult =>
      ({ id: it.id, kind: 'action', outcome: 'duplicate', existingId: row.id, action: view(row), mine: false });

    // Replay (same id, same type + payload + note-or-not + "I am") or id reuse (APP-30). The log target comes from the
    // stored row, so a retried item still names its person.
    const replay = async (prev: OutboxRow): Promise<ItemResult> => {
      const noteGiven = it.note != null && it.note.trim() !== '';
      const me0 = await resolveLeader(c, it.leaderId, false);
      // R4 (rev 9): notReceived is the server's own mark on a stored completeStep, never part of what the phone sent.
      const sent = (x: unknown) => { if (it.type !== 'completeStep' || !x || typeof x !== 'object') return x; const { notReceived: _n, ...rest } = x as Record<string, unknown>; return rest; };
      if (prev.type !== it.type || stable(sent(prev.payload)) !== stable(sent(it.payload)) || prev.hasNote !== noteGiven
        || (prev.leaderId ?? null) !== me0.id) throw new LinkIdReused();
      Object.assign(who, { id: prev.leaderId, name: prev.leaderName });
      Object.assign(tgt, await targetOf(c, prev));
      return ok(prev, 'replay');
    };
    // 1. T10: the item's own screen must be usable (the batch envelope only checks that one is); X19: intake = admin + module
    // Rev 6: the Consents screen's two types = intake's gate; removeFromFlowStep = the flows screen + admin/director.
    const intake = isIntakeType(it.type);
    const consentType = isConsentType(it.type);
    if (intake || consentType) intakeGate(c.actor, c.settings);
    else if (!usable(c.actor, c.settings, FEATURE_OF[it.type]!)) throw new ModuleDisabledError('Elvanto link');
    if (it.type === 'removeFromFlowStep' && !can(c.actor, 'link:flowRemove')) throw new ForbiddenError('Only the admin or a director can remove someone from a step.');
    // 2. replay / id reuse
    const prev = await d.link.getAction(it.id);
    if (prev) return replay(prev);
    // 3. capability off on the newest console (none seen yet → allowed)
    const con = newest(await c.consoles());
    if (con && (con.capabilities[it.type] ?? 'off') === 'off') throw new LinkUnavailable(); // X18: unlisted = off
    // 3b. the 3-day cut-off counts from the tap, not from when the phone got a signal (B8 / APP-16 A)
    if (tap && tap.at.getTime() < c.t.getTime() - LINK_CUTOFF_DAYS * 86_400_000) throw new LinkTooOld();
    // 4. type checks, note, "I am"
    const parsed = PAYLOAD_SCHEMAS[it.type].safeParse(it.payload);
    if (!parsed.success) {
      if (it.type === 'checkIn' && it.payload.serviceId === undefined) {
        throw new AppError('VALIDATION_ERROR', 'A check-in needs the service (serviceId).', 400);
      }
      throw new AppError('VALIDATION_ERROR', 'Validation failed', 400);
    }
    const p = parsed.data as Record<string, unknown> & { serviceTimeId?: string; personId?: string | null };
    const note = it.note == null || it.note.trim() === '' ? null : it.note;
    const noteType = NOTE_TYPES.includes(it.type);
    const lookup = it.type === 'consentLookup';
    if (note !== null && !noteType && !intake && !lookup) throw new BadRequestError('A note can only go on a lifegroup report or a flow step.');
    if (lookup && note !== null && note.length > LOOKUP_Q_MAX) throw new BadRequestError(`Search for up to ${LOOKUP_Q_MAX} characters.`);
    const member = MEMBER_TYPES.includes(it.type);
    // Rev 6: a removal needs "I am" only when it carries a note (the note is signed with it).
    const needMe = it.type === 'removeFromFlowStep' ? note !== null : noteType || (member && !isAdminRole(c.actor));
    const me = await resolveLeader(c, it.leaderId, needMe);
    Object.assign(who, me);
    // X1: the claim row carries "Self identified leader: <name> — <note>", so the leader's part is capped to fit 1,900.
    const room = Math.min(LINK_NOTE_MAX, noteRoom(me.name));
    if (note !== null && !intake && !lookup && note.length > room) throw new BadRequestError(`A note can be up to ${room} characters.`);

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
        // T3: someone shown from the pushed check-in names alone (no roster row yet) can still be checked out.
        const pushed = it.type === 'checkOut' && (!r || !r.active) ? svc.checkedIn.find((x) => x.personId === p.personId) : undefined;
        if (r) Object.assign(tgt, { kind: 'person', id: r.personId, name: fullName(r) });
        else if (pushed) Object.assign(tgt, { kind: 'person', id: pushed.personId, name: `${pushed.firstName ?? ''} ${pushed.lastName ?? ''}`.trim() || null });
        if (!pushed && (!r || !r.active)) throw new BadRequestError('This person is not on the list. Reload.');
        // APP-31 (after APP-10): a parent or other adult is never checked in to the youth service; a check-out is
        // still allowed so an existing check-in can be undone.
        if (it.type === 'checkIn' && r!.kind === 'other') throw new BadRequestError('Only youth and leaders can be checked in here.');
        personId = pushed ? pushed.personId : r!.personId;
      }
    } else if (it.type === 'submitReport' || it.type === 'editReport') {
      const rp = p as unknown as { groupId: string; date: string; attendees: string[]; serviceTimeId: string | null;
        didNotMeet: boolean; guests: number; reportId?: string; base?: { date: string; didNotMeet: boolean; attendees: string[];
          guests: number; serviceTimeId: string | null } };
      const g = (await c.groups()).find((x) => x.groupId === rp.groupId);
      if (!g) throw new BadRequestError('This group is not in the list. Reload.');
      Object.assign(tgt, { kind: 'group', id: g.groupId, name: g.name });
      if (!groupVisible(c.actor, g, c.structure)) throw new ForbiddenError('This group is not one of yours.');
      // The 14-day window is for a new report only; an edit keeps its own (older) report's date.
      if (rp.date > c.today || (it.type === 'submitReport' && rp.date < addDays(c.today, -REPORT_BACK_DAYS))) {
        throw new BadRequestError('The date must be in the last 14 days.');
      }
      const members = new Set(g.members.map((m) => m.personId));
      if (rp.attendees.some((a) => !members.has(a))) throw new BadRequestError('Someone ticked is not in this group. Reload.');
      if (rp.serviceTimeId !== null && !services.some((s) => s.serviceTimeId === rp.serviceTimeId)) {
        throw new BadRequestError('Pick a service from the list.');
      }
      if (it.type === 'editReport') {
        const [sent, ms] = await Promise.all([
          d.link.listActions({ groupId: g.groupId, types: REPORT_TYPES, statuses: ['sent'] }), c.mirror()]);
        // Any report in the group's history can be edited (the console reads that report's own form); the app's
        // newest (an overlay) leads, then the mirror's last report and its history.
        const at = lastReportOf(g, sent, takenAt(ms, 'groups'));
        const base0 = [at, g.lastReport, ...g.history].find((x) => x && x.reportId === rp.reportId);
        if (!base0) throw new BadRequestError('This report is not in the list. Reload.');
        if (!base0.editable) throw new LinkEditInElvanto(base0.blocked ?? 'unknown');
        const b = rp.base!;
        const same = b.date === base0.date && b.didNotMeet === base0.didNotMeet && b.guests === base0.guests &&
          b.serviceTimeId === base0.serviceTimeId && stable([...b.attendees].sort()) === stable([...base0.attendees].sort());
        if (!same) throw new BadRequestError('This report changed. Reload and try again.');
        if (rp.date !== b.date) throw new BadRequestError('The date of a report cannot be changed here.');
      }
      serviceDate = rp.date;
    } else if (member) { // T6: addGroupMember / removeGroupMember
      const mp = p as unknown as { groupId: string; personId: string };
      const g = (await c.groups()).find((x) => x.groupId === mp.groupId);
      if (!g) throw new BadRequestError('This group is not in the list. Reload.');
      const r = roster.find((x) => x.personId === mp.personId);
      Object.assign(tgt, { kind: 'person', id: mp.personId,
        name: r ? fullName(r) : g.members.find((m) => m.personId === mp.personId)?.name ?? null });
      if (!groupVisible(c.actor, g, c.structure)) throw new ForbiddenError('This group is not one of yours.');
      if (!canEditGroupMembers(c.actor, await leadsGroup(c, g, me.id))) {
        throw new ForbiddenError('Only a leader of this group can change who is in it.');
      }
      personId = mp.personId;
      const rows = await memberRows(g.groupId, mp.personId);
      // A re-send after a lost reply: this tap already cancelled the pending opposite change (as the door's check-out).
      const undone = rows.find((x) => x.status === 'cancelled' && x.detail === `cancelled-by:${it.id}`);
      if (undone) {
        if (undone.type === it.type) throw new LinkIdReused();
        return { id: it.id, kind: 'action', outcome: 'cancelled', action: view(undone) };
      }
      // The opposite change has not gone yet: cancel it instead of queueing both (the console could run them in either order).
      const opp = rows.find((x) => x.type !== it.type && OPEN.includes(x.status));
      if (opp) {
        if (opp.status !== 'pending' || !(await d.link.cancelPending(opp.id, it.id))) throw new LinkStillSending();
        return { id: it.id, kind: 'action', outcome: 'cancelled', action: { ...view(opp), status: 'cancelled' } };
      }
      // Same change already waiting: falls through to the insert, which answers `duplicate` (dedupe key).
      const waiting = rows.some((x) => x.type === it.type && OPEN.includes(x.status));
      const cur = effectiveMembers(g.members, rows, takenAt(await c.mirror(), 'groups'), nameOfPerson(roster))
        .find((m) => m.personId === mp.personId);
      if (it.type === 'addGroupMember') {
        if (!r || !r.active || r.kind === 'other') throw new BadRequestError('This person is not on the youth list. Reload.');
        if (!personVisible(c.actor, r, c.structure)) throw new ForbiddenError('This person is not one of yours.');
        if (cur && !waiting) throw new BadRequestError('Already in this group.');
      } else {
        if (!cur && !waiting) throw new BadRequestError('Not in this group now. Reload.');
        if (cur?.leader) throw new BadRequestError('Remove a leader in Elvanto.');
      }
    } else if (intake) { // X19 (T4): date pushed, plan fresh, keys in the stored plan; the console re-plans before each step
      if (!d.intake) throw new LinkUnavailable();
      await checkIntakeItem(d.intake, it.type, p, note, c.t);
      serviceDate = p.date as string;
    } else if (it.type === 'consentLookup') { // rev 6 (R2 b/c): a read request; ref is its own id (one dedupe key per request)
      if ((p as { ref: string }).ref !== it.id) throw new BadRequestError('A lookup ref must be its own id.');
    } else if (it.type === 'consentLink') { // L6: console-local; nothing is checked in Elvanto, the app names the form and the person
      personId = (p as { personId: string | null }).personId;
    } else if (it.type === 'consentFix') { // rev 6 (R2 c): the console re-checks the form; the app only names the person
      personId = (p as { personId: string }).personId;
    } else { // completeStep, removeFromFlowStep (rev 6)
      const sp = p as unknown as { rowId: string; flowId: string; stepId: string; personId: string | null };
      const row = (await c.flows()).find((x) => x.rowId === sp.rowId);
      if (!row) throw new BadRequestError('This step is not in the list. Reload.');
      Object.assign(tgt, { kind: 'flowRow', id: row.rowId, name: row.name });
      if (row.flowId !== sp.flowId || row.stepId !== sp.stepId || row.personId !== sp.personId) {
        throw new BadRequestError('This step changed. Reload.');
      }
      if (stepHidden(c.actor, row, c.settings.ministryConfig.modules.flowHiddenStep)) throw new ForbiddenError('This step moves on its own after contact consent.');
      if (!flowRowVisible(c.actor, row, new Map(roster.map((x) => [x.personId, x])), c.structure, c.settings.ministryConfig.modules.flowHiddenStep)) {
        throw new ForbiddenError('This person is not one of yours.');
      }
      // Rev 6: one open flow-row action per row (a Complete and a Remove would race in Elvanto).
      const other = it.type === 'completeStep' ? 'removeFromFlowStep' : 'completeStep';
      if ((await c.openFlowRows()).some((r) => r.type === other && (r.payload as { rowId?: string }).rowId === row.rowId)) {
        throw new LinkBusyRow();
      }
      if (it.type === 'completeStep') {
        // R4: DO NOT CONTACT = Remove only. CY-B1: the flag GET /link/flows shows (the roster's sticky DNC when the flow
        // row's own is unreadable), so a Complete queued on a phone before the flag arrived is still refused.
        const consent = shownConsent(row, new Map(roster.map((x) => [x.personId, x])));
        if (isDnc(consent)) throw new LinkDnc();
        // Review C1: the consent wait moves on through the consent check only (consentSave never comes through here).
        // R4 (consents run 2026-10-17, rev 9): or, past the student's consent Friday with no reply, with consent not received
        // recorded by the console first. The server decides: notReceived is set here, never taken from the phone.
        const v = isConsentStep(row, peopleFlowOf(await c.flows(), clock())) ? consentStepAllowed({ ...row, consent }, await c.consentRows(), clock(), newest(await c.consoles())?.linkRev ?? 1) : 'done';
        if (!v) throw new ConsentCheckFirst();
        if (v === 'notReceived') (p as { notReceived?: true }).notReceived = true; else delete (p as { notReceived?: true }).notReceived;
      }
      personId = row.personId;
    }

    // 5. ordering (B4 / T-24), same-action dedupe (decision 18), then the check-out rule (spec §2.4)
    if (it.type === 'checkIn' || it.type === 'checkOut') {
      let rows = await checkRows(personId!, svc!.serviceTimeId);
      // smoke-2: this tap already cancelled the pending opposite row (its id is on that row), so it is a re-send
      // after a lost reply: answer the same, never "Not checked in" or a fresh check-in.
      const undone = rows.find((r) => r.status === 'cancelled' && r.detail === `cancelled-by:${it.id}`);
      if (undone) {
        if (undone.type === it.type) throw new LinkIdReused();
        if (it.type === 'checkOut') return { id: it.id, kind: 'action', outcome: 'cancelled', action: view(undone) };
        const open = rows.filter((r) => r.type === 'checkIn' && r.status !== 'cancelled' && r.status !== 'refused'
          && r.createdAt <= undone.createdAt).sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0]; // open then
        return open ? dup(open) : { id: it.id, kind: 'action', outcome: 'duplicate', mine: false };
      }
      const opposite = rows.find((r) => r.status !== 'cancelled' && r.status !== 'refused');
      // B8 / APP-16 B: someone else changed this person after the tap (a late flush must not undo a newer action).
      // A row this same phone wrote never counts (B8 follow-up): same batch, or same login + same device id. The
      // outbox has no device column; the row's own link_log line (written with each batch) carries the device id.
      const own = async (r: OutboxRow) => {
        if (tap!.batchIds.has(r.id)) return true;
        if (!tap!.deviceId || r.createdBy !== c.actor.id) return false;
        const logs = await d.link.listLog({ from: r.createdAt, to: new Date(Date.parse(r.createdAt) + 86_400_000).toISOString(),
          outboxId: r.id, userId: c.actor.id, limit: 5 });
        return logs.some((l) => l.deviceId === tap!.deviceId && (l.event === r.type || l.event === 'undo'));
      };
      if (tap) {
        for (const r of rows) {
          // R2-G1 G1-2: a newer row of the SAME type (another leader's check-in after a check-in) is not stale; it
          // reaches the same-type dedupe below and answers duplicate. A newer opposite row is still stale (APP-16 B).
          if (r.status === 'cancelled' || r.status === 'refused' || r.type === it.type || Date.parse(r.createdAt) <= tap.at.getTime()) continue;
          if (!(await own(r))) throw new LinkStale();
        }
      }
      if (opposite && opposite.type !== it.type) {
        if (opposite.status === 'claimed' || opposite.status === 'unclear') throw new LinkStillSending();
        // The opposite row has not gone yet: cancel it instead of queueing both (the console could run them in the
        // wrong order). A check-out answers `cancelled`; a check-in answers with the open check-in as `duplicate`.
        if (opposite.status === 'pending') {
          if (!(await d.link.cancelPending(opposite.id, it.id))) throw new LinkStillSending(); // picked up meanwhile
          if (it.type === 'checkOut') {
            return { id: it.id, kind: 'action', outcome: 'cancelled', action: { ...view(opposite), status: 'cancelled' } };
          }
          rows = await checkRows(personId!, svc!.serviceTimeId);
          const open = rows.find((r) => r.type === 'checkIn' && r.status !== 'cancelled' && r.status !== 'refused');
          if (open) return dup(open);
          return { id: it.id, kind: 'action', outcome: 'duplicate', mine: false }; // in by the kiosk (the mirror)
        }
      }
      const mirror = { mirrorIn: svc!.checkedIn.some((x) => x.personId === personId), mirrorTakenAt: takenAt(await c.mirror(), 'services') };
      const st = effectiveCheckState({ ...mirror, rows });
      const live = rows.find((r) => r.status !== 'cancelled' && r.status !== 'refused');
      // Same type AND the person is still in that state: a kiosk check-out after a sent check-in allows a new one.
      if (live && live.type === it.type && st.in === (it.type === 'checkIn')) return dup(live);
      if (it.type === 'checkOut' && !st.in) throw new BadRequestError('Not checked in to this service.');
    }

    // 6. rate limit (B12 / T-36), then insert. Only a new row counts: it bounds how many live Elvanto writes a runaway
    // phone can make, and a busy door's retries and duplicates never stall it.
    if (d.limiter.isBlocked(c.actor.id)) throw new TooManyRequestsError('Too many taps. Wait a minute.');
    const studentId = personId ? roster.find((x) => x.personId === personId)?.studentId ?? null : null;
    const key = dedupeKey(it.type, p);
    // S-4 / D5: a new intakeAnswer replaces the family's pending one in the same transaction (no separate cancel item).
    // S-6 / D8: a new consentLookup cancels this login's pending lookups of the same kind (abandoned searches); claimed ones still run.
    const supersede = it.type === 'intakeAnswer' ? { type: it.type, dedupeKey: key }
      : it.type === 'consentLookup' ? { type: it.type, createdBy: c.actor.id, kind: String(p.kind) } : undefined;
    try {
      const row = await d.link.insertAction({ id: it.id, type: it.type, payload: p, note, dedupeKey: key,
        serviceDate, studentId, personId, createdBy: c.actor.id, leaderId: me.id, leaderName: me.name, ...(supersede ? { supersede } : {}) });
      return ok(row, 'saved');
    } catch (e) {
      if (e instanceof LinkIdExists) { // a concurrent flush stored the same id first (APP-72): re-read, then replay
        const again = await d.link.getAction(it.id);
        if (again) return replay(again);
      }
      if (e instanceof LinkOpenDuplicate) {
        const existingId = String(e.extra?.existingId);
        const row = await d.link.getAction(existingId);
        return row ? dup(row) : { id: it.id, kind: 'action', outcome: 'duplicate', existingId, mine: false };
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

  /** Cancel/undo ownership (spec §8.2): same login and same "I am" (null = null), or link:admin. F1: the "I am" is scoped. */
  const iAm = async (c: Ctx, leaderId: string | null): Promise<string | null> =>
    (await scopedLeader(c, c.actor.role === 'leader' ? (c.actor.leaderId ?? null) : leaderId))?.id ?? null;
  async function owns(c: Ctx, row: OutboxRow, leaderId: string | null): Promise<boolean> {
    return c.admin || (row.createdBy === c.actor.id && (row.leaderId ?? null) === await iAm(c, leaderId));
  }

  async function doCancel(c: Ctx, id: string, leaderId: string | null, device: Device): Promise<{ res: ItemResult; log: LinkLogRow }> {
    const res = await (async (): Promise<ItemResult> => {
      const row = await d.link.getAction(id);
      if (!row) return refused(id, 'cancel', new NotFoundError('This action is not on the server.'));
      if (!(await owns(c, row, leaderId))) return refused(id, 'cancel', new LinkNotYours());
      if (row.status === 'cancelled' || await d.link.cancelPending(id)) return { id, kind: 'cancel', outcome: 'cancelled' };
      return { id, kind: 'cancel', outcome: 'too-late', code: 'LINK_TOO_LATE',
        message: 'Too late: this has already been picked up.' };
    })();
    const me = await iAm(c, leaderId);
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
      if (row.status === 'cancelled') return { id, kind: 'undo', outcome: 'cancelled' };
      // B6 / APP-5: the owner rule applies only to a cancel (the check-in is still pending). Past that, Undo is a
      // plain check-out, which anyone on the door may do (a shared login has several "I am" leaders).
      if (row.status === 'pending') {
        if (!(await owns(c, row, leaderId))) return refused(id, 'undo', new LinkNotYours());
        if (await d.link.cancelPending(id)) return { id, kind: 'undo', outcome: 'cancelled' };
      }
      const p = row.payload as { serviceTimeId: string; personId: string };
      const out = await enqueueItem(c, { id: newId, type: 'checkOut', payload: { serviceTimeId: p.serviceTimeId, personId: p.personId },
        note: null, leaderId }, tap);
      if (out.res.outcome !== 'refused') outboxId = out.res.existingId ?? newId;
      return { ...out.res, id, kind: 'undo' };
    })();
    const me = await iAm(c, leaderId);
    const log = await logRow(c, device, { event: 'undo', leaderId: me, leaderName: await leaderName(c, me),
      targetKind: 'action', targetId: id, outboxId, outcome: outcomeText(res) });
    return { res, log };
  }

  const dev = (x: Partial<Device> | undefined): Device => ({ id: x?.id ?? null, label: x?.label ?? null });

  return {
    async status(actor) {
      await gate(actor, 'any');
      const t = clock().getTime();
      const [consoles, mirrors] = await Promise.all([d.link.listConsoles(), d.link.mirrorState()]);
      const n = newest(consoles);
      const console = n
        ? { lastSeenAt: n.lastSeenAt, online: t - Date.parse(n.lastSeenAt) <= (2 * n.pollSeconds + 60) * 1000,
          inWindow: n.inWindow, pollSeconds: n.pollSeconds, capabilities: n.capabilities,
          consoles: consoles.filter((x) => t - Date.parse(x.lastSeenAt) <= CONSOLE_RECENT_MS).length,
          progress: Object.fromEntries(Object.keys(n.progress ?? {}).flatMap((k) => { const p = progressOf(n, k, t); return p ? [[k, p]] : []; })) }
        : { lastSeenAt: null, online: false, inWindow: false, pollSeconds: null, capabilities: null, consoles: 0, progress: {} };
      const m = Object.fromEntries(MIRROR_KINDS.map((k) => {
        const at = takenAt(mirrors, k);
        return [k, { takenAt: at, ageSeconds: at ? Math.round((t - Date.parse(at)) / 1000) : null }];
      })) as LinkStatus['mirrors'];
      return { console, mirrors: m, consoleLinkRev: n?.linkRev ?? null, appLinkRev: LINK_REV };
    },

    async checkin(actor, serviceTimeId) {
      const c = context(actor, await gate(actor, ['checkin', 'lifegroupReport'])); // T10: the report form picks its service here
      const one = typeof serviceTimeId === 'string' && serviceTimeId !== '';
      const services = await c.services();
      const svc = one ? services.find((s) => s.serviceTimeId === serviceTimeId) : undefined;
      if (one && !svc) throw new BadRequestError('Pick a service from the list.');
      // APP-77: the service's own day narrows the outbox read to one day's rows (link_outbox_date_idx).
      const [roster, mirrors, rows, leaders] = await Promise.all([svc ? c.roster() : [], c.mirror(),
        svc ? d.link.listActions({ serviceTimeId, types: CHECK_TYPES, serviceDateFrom: svc.ymd, serviceDateTo: svc.ymd }) : [],
        svc ? c.leaders() : []]);
      const list = pickList(services, c.today);
      const out: CheckinView = { today: c.today,
        services: list.map((s) => ({ serviceTimeId: s.serviceTimeId, serviceId: s.serviceId, name: s.name, startsAt: s.startsAt, ymd: s.ymd,
          isDefault: defaultService(s.ymd, services, s.ymd === serviceDay(c.t) ? c.t : undefined)?.serviceTimeId === s.serviceTimeId })),
        defaultServiceTimeId: defaultService(serviceDay(c.t), services, c.t)?.serviceTimeId ?? null }; // D3: before 03:00, yesterday
      if (!svc) return out;
      const svcAt = takenAt(mirrors, 'services');
      const byPerson = new Map<string, OutboxRow[]>();
      for (const r of rows) if (r.personId) byPerson.set(r.personId, [...(byPerson.get(r.personId) ?? []), r]);
      const state = (personId: string) => {
        const pr = byPerson.get(personId) ?? [];
        const st = effectiveCheckState({ mirrorIn: svc.checkedIn.some((x) => x.personId === personId), mirrorTakenAt: svcAt, rows: pr });
        const top = pr[0] ?? null;
        return { checkedIn: st.in, action: top ? view(top) : null, mine: top?.createdBy === actor.id };
      };
      const cmp = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });
      const listed: { first: string; last: string; grade: number | null; leader: boolean; personId: string; noRoster?: true }[] = roster.filter((r) => r.active && (r.kind === 'student' || r.kind === 'leader'))
        .map((r) => ({ first: r.firstName, last: r.lastName, grade: r.grade, leader: r.kind === 'leader', personId: r.personId }));
      // T3: a checked-in person the roster does not list (not pushed yet, inactive, other) still shows, by the name the
      // console pushed with the check-in; a leader when the room's name says so. No name (an older console): not shown.
      const seen = new Set(listed.map((p) => p.personId));
      const byId = new Map(roster.map((r) => [r.personId, r]));
      const roomName = new Map(svc.rooms.map((r) => [r.id, r.name]));
      for (const x of svc.checkedIn) {
        if (seen.has(x.personId) || !`${x.firstName ?? ''}${x.lastName ?? ''}`.trim()) continue;
        seen.add(x.personId);
        listed.push({ first: x.firstName ?? '', last: x.lastName ?? '', grade: byId.get(x.personId)?.grade ?? null,
          leader: /leader/i.test(roomName.get(x.roomId) ?? ''), personId: x.personId, noRoster: true });
      }
      out.people = listed.sort((a, b) => cmp(a.last, b.last) || cmp(a.first, b.first))
        .map((p) => ({ personId: p.personId, name: `${p.first} ${p.last}`.trim(), grade: p.grade, leader: p.leader, ...(p.noRoster ? { noRoster: true as const } : {}), ...state(p.personId) }));
      const personOf = rosterPersonMatcher(roster, leaders);
      out.leaders = leaders.filter((l) => l.active).sort((a, b) => cmp(a.fullName, b.fullName)).map((l) => {
        const personId = personOf(l);
        return { leaderId: l.id, name: l.fullName, personId,
          ...(personId ? state(personId) : { checkedIn: false, action: null, mine: false }) };
      });
      return out;
    },

    async listActions(actor, q) {
      const c = context(actor, await gate(actor, 'any'));
      const Q = z.object({ ids: z.union([z.string(), z.array(z.string())]).optional(), serviceDate: Ymd.optional(),
        type: z.enum(ACTION_TYPES).optional() });
      const f = Q.parse(q ?? {});
      const ids = f.ids === undefined ? undefined
        : z.array(Uuid).max(200).parse((Array.isArray(f.ids) ? f.ids : f.ids.split(',')).map((s) => s.trim()).filter(Boolean));
      if (!ids && !f.serviceDate && !f.type) throw new BadRequestError('Give ids, or a serviceDate and type.');
      const rows = await d.link.listActions({ ids, serviceDateFrom: f.serviceDate, serviceDateTo: f.serviceDate,
        types: f.type ? [f.type] : undefined, createdBy: c.admin ? undefined : actor.id,
        ...(!ids && !f.serviceDate ? { limit: TYPE_ONLY_MAX } : {}) }); // S-1: a type-only read is the newest 100
      const logins = new Map<string, string>();
      await Promise.all([...new Set(rows.map((r) => r.createdBy))].map(async (id) =>
        logins.set(id, (await d.users.findById(id))?.email ?? '')));
      // The admin checks an unclear row in Elvanto, so it needs the person; the console must not log names (B3 / T-7).
      const names = new Map<string, string | null>();
      if (c.admin) {
        // B17: and every first-timer, for the "waiting over 1 hour" list (the name is the payload's own).
        for (const r of rows) if (r.status === 'unclear' || r.type === 'firstTimerCheckIn') names.set(r.id, (await targetOf(c, r)).name);
      }
      return rows.map((r) => ({ id: r.id, type: r.type, status: r.status, reason: r.reason,
        ...(c.admin ? { detail: r.detail } : {}), createdAt: r.createdAt, resultAt: r.resultAt, leaderName: r.leaderName,
        login: logins.get(r.createdBy) ?? '', hasNote: r.hasNote === true, ...(names.has(r.id) ? { name: names.get(r.id) } : {}),
        ...(r.status === 'sent' && r.detail === NOTE_FAILED_DETAIL ? { note: 'failed' as const } : {}),
        ...(c.admin && fixKeyOf(r) ? { fixKey: fixKeyOf(r)! } : {}) }));
    },

    async batch(actor, body) {
      const c = context(actor, await gate(actor, 'any')); // T10: each action item is checked against its own module
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
      // A real per-phone id only (the SPA sends 'unknown' when it has none): that never exempts anything.
      const deviceId = device.id && device.id !== 'unknown' ? device.id : null;
      const tapOf = (queuedAt: string | undefined): Tap => ({ batchIds, deviceId,
        at: new Date(queuedAt ? Math.min(c.t.getTime(), Date.parse(queuedAt) + skew) : c.t.getTime()) });
      for (const rawItem of b.items) {
        const pi = BatchItem.safeParse(rawItem);
        if (!pi.success) {
          const o = (rawItem && typeof rawItem === 'object' ? rawItem : {}) as { id?: unknown; kind?: unknown };
          const kind = (ITEM_KINDS as readonly unknown[]).includes(o.kind) ? o.kind as ItemKind : 'action';
          results.push(refused(typeof o.id === 'string' ? o.id : '', kind, new AppError('VALIDATION_ERROR', 'Validation failed', 400)));
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
            out = { res: { id: it.id, kind: 'identity', outcome: 'logged' },
              // The item id is the log id, so a retried identity item is written once (APP-71).
              log: await logRow(c, device, { id: it.id, at, event: 'identity', prevLeaderId: it.from, prevLeaderName: await leaderName(c, it.from),
                leaderId: it.to, leaderName: await leaderName(c, it.to), outcome: 'logged' }) };
          }
          results.push(out.res);
          if (out.log) logs.push(out.log);
        } catch (e) {
          if (e instanceof AppError) { results.push(refused(it.id, it.kind, e)); continue; }
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
          await d.errorLog?.record({ category: 'server', code: 'INTERNAL', route: `POST /link/batch ${it.kind === 'action' ? it.type : it.kind}`,
            status: 500, role: c.actor.role });
          results.push(res);
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
      const c = context(actor, await gate(actor, ['lifegroupReport']));
      const [groups, mirrors, sent, open, done] = await Promise.all([c.groups(), c.mirror(),
        d.link.listActions({ types: REPORT_TYPES, statuses: ['sent'] }),
        d.link.listActions({ types: ['submitReport', 'editReport'], statuses: OPEN }),
        d.link.listActions({ types: REPORT_TYPES, statuses: ['sent', 'refused', 'cancelled'], serviceDateFrom: addDays(c.today, -REPORT_BACK_DAYS) })]);
      const gAt = takenAt(mirrors, 'groups');
      // 2026-10-14: who sent each report from the app (the submit's "I am" leader), so same-day duplicates can be told apart.
      const byId = new Map(sent.filter((r) => r.type === 'submitReport' && r.reportId).map((r) => [r.reportId!, r.leaderName]));
      const withBy = (x: LinkLastReport): LinkLastReport => ({ ...x, by: byId.get(x.reportId) ?? null });
      // T8 + R2 (2026-10-17): grade 6..12, girls then boys, then Mon..Sun (no day last), then name; no grade last.
      const rank = (g: LinkGroupRow) => {
        const wd = meetsWeekday(g.meets || '');
        return [g.grade ?? 99, g.gender === 'female' ? 0 : g.gender === 'male' ? 1 : 2, wd < 0 ? 7 : (wd + 6) % 7] as const;
      };
      const order = (a: LinkGroupRow, b: LinkGroupRow) => {
        const x = rank(a), y = rank(b);
        return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || a.name.localeCompare(b.name);
      };
      return { groups: groups.filter((g) => groupVisible(actor, g, c.structure)).sort(order).map((g) => {
        const o = open.find((r) => (r.payload as { groupId?: string }).groupId === g.groupId);
        const last0 = lastReportOf(g, sent, gAt), last = last0 && withBy(last0);
        // The last report (an app overlay included) leads the history; an edit replaces its own entry.
        const history = [...(last ? [last] : []), ...g.history.filter((h) => h.reportId !== last?.reportId).map(withBy)]
          .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
        return { groupId: g.groupId, name: g.name, grade: g.grade, gender: g.gender, meets: g.meets, members: g.members,
          thisWeek: g.thisWeek, lastReport: last, history, defaultDate: lastMeetingDate(g.meets, c.today), openAction: o ? view(o) : null,
          ...refusedLast(o, done.filter((r) => (r.payload as { groupId?: string }).groupId === g.groupId)) };
      }) };
    },

    async flows(actor) {
      const c = context(actor, await gate(actor, ['flows']));
      const [flows, roster, open, assigns, leaders, pushed, consoles, mirrors] = await Promise.all([c.flows(), c.roster(),
        d.link.listActions({ types: FLOW_ROW_TYPES, statuses: OPEN }), d.link.flowAssignments(), c.leaders(), d.link.flowSteps(), c.consoles(), c.mirror()]);
      const done = await d.link.listActions({ types: FLOW_ROW_TYPES, statuses: ['sent', 'refused', 'cancelled'], serviceDateFrom: addDays(c.today, -FLOW_BACK_DAYS) });
      const seesDnc = isAdminRole(actor); // R1: admin/director keep a DO NOT CONTACT person's number (and see the banner)
      const rev = newest(consoles)?.linkRev ?? 1, now = clock();
      const people = peopleFlowOf(flows, now);
      const cRows = flows.some((f) => isConsentStep(f, people)) ? await c.consentRows() : []; // R4: one light read, only with a step 0
      const byId = new Map(roster.map((r) => [r.personId, r]));
      const assigned = new Map(assigns.map((x) => [`${x.flowId}:${x.personId}`, leaders.find((l) => l.id === x.leaderId)]));
      const rows = flows.filter((f) => flowRowVisible(actor, f, byId, c.structure, c.settings.ministryConfig.modules.flowHiddenStep))
        .sort((a, b) => a.flowName.localeCompare(b.flowName) || a.stepOrder - b.stepOrder)
        .map((f: LinkFlowRow): FlowView => {
          const o = open.find((r) => (r.payload as { rowId?: string }).rowId === f.rowId);
          const l = f.personId ? assigned.get(`${f.flowId}:${f.personId}`) : undefined; // a deleted leader reads as none
          const consent = shownConsent(f, byId), dnc = isDnc(consent);
          return { rowId: f.rowId, flowId: f.flowId, stepId: f.stepId, flowName: f.flowName, stepName: f.stepName,
            stepOrder: f.stepOrder, personId: f.personId, name: f.name, due: f.due, assignedTo: f.assignedTo, openAction: o ? view(o) : null,
            grade: f.grade, gender: f.gender, mobile: dnc && !seesDnc ? null : f.mobile, mobileIsParent: f.mobileIsParent,
            assignedLeaderId: l?.id ?? null, assignedLeaderName: l?.fullName ?? null,
            consent, dnc, consentStep: isConsentStep(f, people), ...consentWait(f, consent, cRows, rev, now, people),
            ...refusedLast(o, done.filter((r) => (r.payload as { rowId?: string }).rowId === f.rowId)) };
        });
      // T12: the pushed list (empty steps included); an older console sends none, so the rows' steps. Admin: every step (the picker).
      const steps = new Map((pushed ?? flows).map((f) => [f.stepId, { flowId: f.flowId, flowName: f.flowName, stepId: f.stepId, stepName: f.stepName, stepOrder: f.stepOrder }]));
      const hidden = c.settings.ministryConfig.modules.flowHiddenStep;
      // S5: the console is reading the flows now (progress posted after the last flows push landed)
      const progress = progressOf(newest(consoles), 'flows', clock().getTime(), mirrors.find((m) => m.kind === 'flows')?.appliedAt ?? null);
      return { rows, steps: [...steps.values()].filter((s) => !stepHidden(actor, s, hidden)) // T11: admin/director see every step
        .sort((a, b) => a.flowName.localeCompare(b.flowName) || a.stepOrder - b.stepOrder), progress };
    },

    /**
     * T5/T6: one group's members for the collapsed list. A member opens the app profile only when matched to a student
     * this login may see (canAccessStudent); anyone else is name + roster grade. Never a phone. `?leaderId=` = "I am".
     */
    async consentLookup(actor, q) {
      const settings = await d.settings.getSettings();
      intakeGate(actor, settings);
      const { id } = z.object({ id: Uuid }).parse(q ?? {});
      const row = await d.link.getAction(id);
      if (!row || row.type !== 'consentLookup') throw new NotFoundError('That lookup is not known.');
      const p = row.payload as { kind: ConsentLookupKind; page: number };
      const base = { id, kind: p.kind, page: p.page, pageSize: 25, total: null, takenAt: null, rows: [] as unknown[] };
      if (row.status === 'pending') return { ...base, status: 'waiting', reason: row.reason ?? null }; // a retry carries why (resilience M5)
      if (row.status === 'claimed') return { ...base, status: 'working', reason: null,
        progress: progressOf(newest(await d.link.listConsoles()), `lookup:${id}`, clock().getTime()) };
      if (row.status !== 'sent') return { ...base, status: 'failed', reason: row.reason ?? row.status };
      const got = await d.link.consentLookup(id);
      if (!got) return { ...base, status: 'failed', reason: 'expired' };
      if (got.unreadable) return { ...base, status: 'failed', reason: 'unreadable' }; // never an empty 'all clear' (resilience M3)
      const ready = { id, kind: got.kind, status: 'ready' as const, reason: null, page: got.page, pageSize: got.pageSize, total: got.total, takenAt: got.takenAt, rows: got.rows };
      return got.kind === 'other' ? { ...ready, rows: await otherWait(context(actor, settings), got.rows as { rowId: string }[]) } : ready;
    },

    async groupMembers(actor, groupId, q) {
      const c = context(actor, await gate(actor, ['lifegroupReport']));
      const f = z.object({ leaderId: Uuid.optional() }).parse(q ?? {});
      const g = (await c.groups()).find((x) => x.groupId === groupId);
      if (!g) throw new NotFoundError('This group is not in the list. Reload.');
      if (!groupVisible(actor, g, c.structure)) throw new ForbiddenError('This group is not one of yours.');
      const [roster, rows, mirrors, students, me] = await Promise.all([c.roster(), memberRows(g.groupId), c.mirror(),
        d.students.findAll(), resolveLeader(c, f.leaderId, false)]);
      const byPerson = new Map(roster.map((r) => [r.personId, r]));
      const byStudent = new Map(students.map((s) => [s.id, s]));
      const members = effectiveMembers(g.members, rows, takenAt(mirrors, 'groups'), nameOfPerson(roster)).map((m): MemberView => {
        const r = byPerson.get(m.personId);
        const s = r?.studentId ? byStudent.get(r.studentId) : undefined;
        return { personId: m.personId, name: m.name, leader: m.leader, grade: r?.grade ?? null,
          studentId: s && canAccessStudent(actor, s.grade, s.gender, c.structure) ? s.id : null };
      });
      const from = c.t.getTime() - LINK_CUTOFF_DAYS * 86_400_000;
      const changes = rows.filter((r) => r.status !== 'cancelled' && Date.parse(r.createdAt) >= from).map((r): MemberChange => {
        const pid = (r.payload as { personId?: string }).personId ?? null;
        const x = pid ? byPerson.get(pid) : undefined;
        return { id: r.id, type: r.type, personId: pid, name: x ? fullName(x) : null, status: r.status, reason: r.reason,
          createdAt: r.createdAt, resultAt: r.resultAt };
      });
      return { groupId: g.groupId, canEdit: canEditGroupMembers(actor, await leadsGroup(c, g, me.id)), members, changes };
    },

    async youth(actor, q) {
      // L6: ?scope=consents = the Consents screen's person search (intake gate: admin + module), not the lifegroup one.
      let c;
      if ((q as { scope?: string } | undefined)?.scope === 'consents') { const s = await d.settings.getSettings(); intakeGate(actor, s); c = context(actor, s); }
      else c = context(actor, await gate(actor, ['lifegroupReport']));
      const cmp = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });
      const rows = (await c.roster()).filter((r) => r.active && r.kind !== 'other' && personVisible(actor, r, c.structure))
        .sort((a, b) => cmp(a.lastName, b.lastName) || cmp(a.firstName, b.firstName))
        .map((r) => ({ personId: r.personId, name: fullName(r), grade: r.grade }));
      return { rows };
    },

    /** T6: give a flow person to a leader (app only, never sent to Elvanto). Any login that sees the person may. */
    async assignFlow(actor, body) {
      const c = context(actor, await gate(actor, ['flows']));
      const parsed = z.object({ flowId: Uuid, personId: Uuid, leaderId: Uuid.nullable() }).safeParse(body ?? {});
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Validation failed', 400);
      const b = parsed.data;
      const [flows, roster] = await Promise.all([c.flows(), c.roster()]);
      const rows = flows.filter((f) => f.flowId === b.flowId && f.personId === b.personId);
      if (!rows.length) throw new BadRequestError('This person is not in this flow any more. Reload.');
      const byId = new Map(roster.map((r) => [r.personId, r]));
      if (!rows.some((f) => flowRowVisible(actor, f, byId, c.structure, c.settings.ministryConfig.modules.flowHiddenStep))) {
        throw new ForbiddenError('This person is not one of yours.');
      }
      // Only a leader this login could pick in its "I am" list (same scope as GET /leaders).
      if (b.leaderId !== null && !(await makeLeaderService(d.leaders).list(actor)).some((l) => l.id === b.leaderId)) {
        throw new BadRequestError('Pick a leader from the list.');
      }
      await d.link.setFlowAssign({ ...b, assignedBy: await c.login() });
      return { ok: true };
    },

    async rosterForMatching(actor, q) {
      await gate(actor, 'admin');
      const f = z.object({ match: z.enum(MATCHES).optional() }).parse(q ?? {});
      const [roster, students] = await Promise.all([d.link.roster(), d.students.findAll()]);
      // Active students that still need a match (never `auto`), plus any inactive row still holding a student, so the
      // admin can release it (APP-11). Candidates only for none/ambiguous, from one index of folded names.
      const rows = roster.filter((r) => ((r.active && r.kind === 'student' && r.match !== 'auto') || (!r.active && r.studentId))
        && (!f.match || r.match === f.match));
      // Candidates: same surname (matchFold), whose first name starts like the person's either way or whose grade is
      // within 1, and not already held by an active roster person.
      const heldBy = new Set(roster.filter((r) => r.active && r.studentId).map((r) => r.studentId!));
      const bySurname = new Map<string, typeof students>();
      if (rows.some((r) => r.match === 'none' || r.match === 'ambiguous')) {
        for (const s of students) { const k = matchFold(s.lastName); bySurname.set(k, [...(bySurname.get(k) ?? []), s]); }
      }
      const candidatesOf = (r: LinkRosterRow): MatchCandidate[] => {
        if (r.match !== 'none' && r.match !== 'ambiguous') return [];
        const f = matchFold(r.firstName);
        return (bySurname.get(matchFold(r.lastName)) ?? [])
          .filter((s) => !heldBy.has(s.id) && (f.startsWith(matchFold(s.firstName)) || matchFold(s.firstName).startsWith(f)
            || (r.grade != null && s.grade != null && Math.abs(s.grade - r.grade) <= 1)))
          .map((s) => ({ studentId: s.id, name: fullName(s), grade: s.grade, dob: s.dateOfBirth }));
      };
      return { rows: rows.map((r) => ({ personId: r.personId, name: fullName(r), grade: r.grade, kind: r.kind, active: r.active,
        studentId: r.studentId, match: r.match, candidates: candidatesOf(r) })) };
    },

    async setMatch(actor, personId, body) {
      await gate(actor, 'admin');
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
      if (change.studentId) { // operator 2026-10-14: Elvanto's gender wins when name + grade agree
        const s = await d.students.findById(change.studentId);
        if (s) await saveGenderFixes(d.students, genderFixes(roster, [s], [change]));
      }
      return change;
    },

    /** CY-A1: an unclear row (lease-lost, or a write the console could not confirm) blocks its dedupe key until resolved.
     *  The console resolves only keys in its own sent-log; this is the admin's way out. landed -> sent; not landed ->
     *  refused 'not-landed' (both final, so the key is free again). Same applyOutcome transition as the console's. */
    async resolveUnclear(actor, id, body) {
      const c = context(actor, await gate(actor, 'admin'));
      const b = z.object({ landed: z.boolean() }).safeParse(body ?? {});
      if (!b.success) throw new BadRequestError('Say whether it landed in Elvanto.');
      const row = Uuid.safeParse(id).success ? await d.link.getAction(id) : null;
      if (!row) throw new NotFoundError('This action is not on the server.');
      if (row.status !== 'unclear') throw new ConflictError('This is no longer waiting for a check.');
      const res = await d.link.applyResults(row.leaseOwner ?? 'admin', [{ id, outcome: 'resolved', landed: b.data.landed }], c.t);
      if (!res.applied.includes(id)) throw new ConflictError('This is no longer waiting for a check.');
      const status = b.data.landed ? 'sent' as const : 'refused' as const;
      await d.link.addLog([await logRow(c, { id: null, label: null }, { event: 'resolve', targetKind: 'action', targetId: id,
        targetName: null, outboxId: id, outcome: b.data.landed ? 'sent' : 'refused:not-landed' })]);
      return { ok: true, status };
    },

    async log(actor, q) {
      await gate(actor, 'admin');
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
