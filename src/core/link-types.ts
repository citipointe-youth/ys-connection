// Shared Elvanto link types (spec docs/superpowers/specs/2026-10-12-elvanto-link-app-design.md §3). Copied exactly;
// every lane imports these rather than inventing its own.
import type { z } from 'zod';
import type { ACTION_TYPES, STATUSES, PUSH_KINDS, MIRROR_KINDS, REASONS, ResultItem as ResultItemSchema,
  ResultResponse as ResultResponseSchema, ResultStep as ResultStepSchema, ResultStop as ResultStopSchema } from './link-contract';

export type ActionType = (typeof ACTION_TYPES)[number];
export type Status = (typeof STATUSES)[number];
export type PushKind = (typeof PUSH_KINDS)[number];
/** The four kinds kept in link_mirror_state (X19: the intake pushes are stored per date instead). */
export type MirrorKind = (typeof MIRROR_KINDS)[number];
export type ResultStep = z.infer<typeof ResultStepSchema>;
export type ResultStop = z.infer<typeof ResultStopSchema>;
export type Reason = (typeof REASONS)[number];
export type Capability = 'live' | 'shadow' | 'locked' | 'off';
/** X18: a type the console does not list (an older console) counts as off: never leased, new rows refused. */
export type Capabilities = Partial<Record<ActionType, Capability>>;
export type Consent = 'ok' | 'contact' | 'all' | 'unknown';
export type Match = 'auto' | 'manual' | 'none' | 'ambiguous' | 'ignored';
export type IgnoredWhy = 'unknown-id' | 'not-leased' | 'already-final' | 'bad-transition';
export type ResultItem = z.infer<typeof ResultItemSchema>;
export type ResultReply = z.infer<typeof ResultResponseSchema>;

export interface OutboxRow {
  id: string; type: ActionType; payload: Record<string, unknown>;
  note: string | null;              // plaintext in memory; the Supabase repo encrypts/decrypts
  /** Set by getAction/listActions: a note is stored (note IS NOT NULL), without decrypting or returning it. */
  hasNote?: boolean;
  dedupeKey: string; serviceDate: string; studentId: string | null; personId: string | null;
  createdBy: string; leaderId: string | null; leaderName: string;
  status: Status; reason: string | null; detail: string | null;
  attempts: number; retryAt: string | null; leaseOwner: string | null; leaseUntil: string | null;
  resultAt: string | null; sentLogKey: string | null; reportId: string | null;
  createdAt: string; updatedAt: string;
  /** X19: an intake chain's per-step outcomes and why it stopped (null for every other type). */
  steps?: ResultStep[] | null; stop?: ResultStop | null;
}
export type NewOutboxRow = Pick<OutboxRow, 'id' | 'type' | 'payload' | 'note' | 'dedupeKey' | 'serviceDate' |
  'studentId' | 'personId' | 'createdBy' | 'leaderId' | 'leaderName'> & {
  /** S-4 / D8: in the same transaction, cancel the pending rows of `type` that match every given field, before the insert. */
  supersede?: { type: ActionType; dedupeKey?: string; createdBy?: string; kind?: string } };
export interface ConsoleRow { consoleId: string; label: string; lastSeenAt: string; contractVersion: number;
  consoleVersion: string; inWindow: boolean; pollSeconds: number; capabilities: Capabilities;
  /** T1: the console's LINK_REV from its last claim (missing = 1). */
  linkRev: number;
  /** S5 (migration 0030): key -> the console's last progress post for that job (link-contract PROGRESS_KEY). */
  progress?: Record<string, LinkProgress>; }
/** S5: at = when the app stored it (server clock). */
export interface LinkProgress { done: number | null; total: number | null; stage: string; at: string }
export interface ClaimArgs { console: Omit<ConsoleRow, 'lastSeenAt'>; max: number; leaseSeconds: number;
  cutoffDays: number; leaseLostMs: number;
  /** T3: the repo pushes each row its sweep closed (too-old / lease-lost) here, for the admin Error log. */
  swept?: { type: ActionType; reason: 'too-old' | 'lease-lost' }[]; }
export interface ClaimedRow { row: OutboxRow; reclaimed: boolean; noteUnreadable: boolean; }
export interface MirrorStateRow { kind: MirrorKind; takenAt: string; consoleId: string; rowCount: number; appliedAt: string; }
export interface LinkRosterRow { personId: string; firstName: string; lastName: string; gender: 'male' | 'female' | null;
  grade: number | null; kind: 'student' | 'leader' | 'other'; active: boolean; studentId: string | null; match: Match;
  updatedAt: string; /** Rev 6 (R1): null = unknown (an older console, or never read). */ consent?: Consent | null; }
export interface LinkServiceRow { serviceTimeId: string; serviceId: string; name: string; startsAt: string; ymd: string;
  rooms: { id: string; name: string }[];
  checkedIn: { personId: string; roomId: string; firstName?: string; lastName?: string }[]; } // T3: names when pushed
export interface LinkLastReport { reportId: string; date: string; time: string; didNotMeet: boolean; attendees: string[];
  guests: number; serviceTimeId: string | null; editable: boolean;
  blocked: 'multi-service' | 'unkept-notes' | 'member-left' | null;
  /** App view only (never pushed): the "I am" leader of the app's submit of this report; null when made in Elvanto. */
  by?: string | null; }
export interface LinkGroupRow { groupId: string; name: string; grade: number | null; gender: 'male' | 'female' | null;
  meets: string; members: { personId: string; name: string; leader: boolean }[];
  thisWeek: 'reported' | 'did-not-meet' | 'none' | 'later' | 'unreadable'; lastReport: LinkLastReport | null;
  /** T8: newest first, at most 8 ([] from an older console). */
  history: LinkLastReport[]; }
/** T4: grade/gender/mobile are the person's own (null/false from an older console); mobile is plaintext here. */
export interface LinkFlowRow { rowId: string; flowId: string; flowName: string; stepId: string; stepName: string;
  stepOrder: number; personId: string | null; name: string; due: string | null; assignedTo: string;
  grade: number | null; gender: 'male' | 'female' | null; mobile: string | null; mobileIsParent: boolean;
  /** Rev 6 (R1): null = unknown (an older console). */ consent?: Consent | null;
  /** Rev 10 (R8): New People step 0, the parent-texted date the consent Friday counts from; null = none (or an older console). */
  textedOn?: string | null; }
/** T12: one step of a pushed flow (the flows push's optional `steps`). */
export interface LinkFlowStep { flowId: string; flowName: string; stepId: string; stepName: string; stepOrder: number; }
/** T6: a flow person given to a self-identified leader (app only, never sent to Elvanto). */
export interface LinkFlowAssign { flowId: string; personId: string; leaderId: string; assignedBy: string; assignedAt: string; }
export type LogEvent = ActionType | 'identity' | 'cancel' | 'undo';
export interface LinkLogRow { id: string; at: string; userId: string; login: string; deviceId: string | null;
  deviceLabel: string | null; event: LogEvent; leaderId: string | null; leaderName: string | null;
  prevLeaderId: string | null; prevLeaderName: string | null;
  targetKind: 'person' | 'group' | 'flowRow' | 'action' | null; targetId: string | null; targetName: string | null;
  outboxId: string | null; outcome: string; }
