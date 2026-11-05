// Friday night check: read-only rows for POST /sync/night-summary. Allow-listed columns only; never a name, payload or note.
import type { ActionType, LogEvent, Match } from '../../core/link-types';
import type { IntakeMode, PlanStatus } from './link-intake.repository';
import type { UnsentReason } from './unsent.repository';

export interface NightOutboxRow { type: ActionType; status: string; reason: string | null; serviceDate: string;
  createdAt: string; resultAt: string | null; attempts: number; inWindow: boolean }
export interface NightTapRow { at: string; event: LogEvent; outcome: string; deviceId: string | null }
/** One (mode, date, status, reason) group of plan rows. `reason` is the plan's first hold text: it goes no further than the classifier. */
export interface NightIntakeRow { mode: IntakeMode; date: string; status: PlanStatus; reason: string; n: number }
export interface NightUnsentRow { reason: UnsentReason; createdAt: string }
export interface NightRosterRow { kind: 'student' | 'leader' | 'other'; match: Match; active: boolean; hasGrade: boolean; n: number }
export interface INightSummaryRepository {
  /** Rows whose service_date is in [fromYmd, toYmd] (inWindow true), plus open rows (pending, claimed, unclear) of any other date (inWindow false).
   *  Order is not part of the contract (Supabase: window rows then open rows; the twin: by createdAt). Callers must not rely on it. */
  outbox(fromYmd: string, toYmd: string): Promise<NightOutboxRow[]>;
  /** link_log rows with from <= at < to, at most `limit`. */
  taps(fromIso: string, toIso: string, limit: number): Promise<NightTapRow[]>;
  /** Plan rows grouped by (mode, date, status, reason); no title, detail or id. */
  intakeRows(): Promise<NightIntakeRow[]>;
  /** Needs-you consent rows dated on or before siteToday, held 'Not found in consent step', whose student also has a needs-you intake row. */
  notFoundHeldInIntake(siteToday: string): Promise<number>;
  /** The New person sends that did not land: the reason and the age only. */
  unsent(): Promise<NightUnsentRow[]>;
  /** Roster rows grouped by the predicate fields only. */
  roster(): Promise<NightRosterRow[]>;
}
