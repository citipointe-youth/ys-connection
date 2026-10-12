// Elvanto link data (spec docs/superpowers/specs/2026-10-12-elvanto-link-app-design.md §4.1). Tables from migration 0017.
import type { ActionType, Status, PushKind, Match, OutboxRow, NewOutboxRow, ConsoleRow, ClaimArgs, ClaimedRow,
  MirrorStateRow, LinkRosterRow, LinkServiceRow, LinkGroupRow, LinkFlowRow, LinkLogRow, LogEvent, ResultItem,
  ResultReply, LinkFlowAssign } from '../../core/link-types';

export interface LinkActionFilter {
  ids?: string[]; createdBy?: string; serviceDateFrom?: string; serviceDateTo?: string;   // service dates inclusive
  types?: ActionType[]; statuses?: Status[]; personId?: string;
  serviceTimeId?: string; groupId?: string;                                              // matched on the payload
}

/** A roster push row as the console sends it (contract RosterRow). The app keeps student_id/match itself. */
export interface LinkRosterPushRow { personId: string; firstName: string; lastName: string;
  gender: 'male' | 'female' | null; grade: number | null; kind: 'student' | 'leader' | 'other'; }

/**
 * Rows per kind for replaceMirror: roster = LinkRosterPushRow, services = LinkServiceRow,
 * groups = LinkGroupRow (grade/gender already set by the caller via parseGroupName), flows = LinkFlowRow.
 * The UX-batch fields (history, flow grade/gender/mobile/mobileIsParent) may be absent: stored as []/null/false.
 * A flows push also drops each assignment whose (flowId, personId) is no longer in the pushed rows (T6).
 */
export interface ILinkRepository {
  /** Throws LinkOpenDuplicate(existingId) when an open row (pending/claimed/unclear) has the same dedupeKey. */
  insertAction(row: NewOutboxRow): Promise<OutboxRow>;
  /** note is always null here (never decrypted outside claim); hasNote says whether one is stored. */
  getAction(id: string): Promise<OutboxRow | null>;
  /** Newest first. note is always null; hasNote says whether one is stored. */
  listActions(f: LinkActionFilter): Promise<OutboxRow[]>;
  /** true only when the row was pending (now cancelled). */
  /** `by`: the id of the opposite check tap that cancelled it, kept in `detail` as `cancelled-by:<id>` (a re-send replays). */
  cancelPending(id: string, by?: string): Promise<boolean>;
  /** ONE transaction, DB clock: console upsert + sweep + purge + lease. */
  claim(a: ClaimArgs): Promise<ClaimedRow[]>;
  applyResults(consoleId: string, items: ResultItem[], now: Date): Promise<ResultReply>;
  listConsoles(): Promise<ConsoleRow[]>;
  replaceMirror(kind: PushKind, rows: unknown[], meta: { takenAt: string; consoleId: string }):
    Promise<{ applied: boolean; rows: number }>;
  mirrorState(): Promise<MirrorStateRow[]>;
  roster(): Promise<LinkRosterRow[]>;
  services(): Promise<LinkServiceRow[]>;
  groups(): Promise<LinkGroupRow[]>;
  flows(): Promise<LinkFlowRow[]>;
  setMatches(changes: { personId: string; studentId: string | null; match: Match }[]): Promise<void>;
  /** T6: every flow assignment. */
  flowAssignments(): Promise<LinkFlowAssign[]>;
  /** T6: upsert by (flowId, personId); leaderId null deletes it. */
  setFlowAssign(a: { flowId: string; personId: string; leaderId: string | null; assignedBy: string }): Promise<void>;
  addLog(rows: LinkLogRow[]): Promise<void>;
  /** from inclusive, to exclusive (ISO instants); newest first; at most `limit` rows. */
  listLog(f: { from: string; to: string; userId?: string; event?: LogEvent; outboxId?: string; limit: number }): Promise<LinkLogRow[]>;
}
