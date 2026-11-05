// Friday night check: read-only rows for POST /sync/night-summary. Allow-listed columns only; never a name, payload or note.
import type { ActionType, LogEvent } from '../../core/link-types';

export interface NightOutboxRow { type: ActionType; status: string; reason: string | null; serviceDate: string;
  createdAt: string; resultAt: string | null; attempts: number; inWindow: boolean }
export interface NightTapRow { at: string; event: LogEvent; outcome: string; deviceId: string | null }
export interface INightSummaryRepository {
  /** Rows whose service_date is in [fromYmd, toYmd] (inWindow true), plus open rows (pending, claimed, unclear) of any other date (inWindow false). */
  outbox(fromYmd: string, toYmd: string): Promise<NightOutboxRow[]>;
  /** link_log rows with from <= at < to, at most `limit`. */
  taps(fromIso: string, toIso: string, limit: number): Promise<NightTapRow[]>;
}
