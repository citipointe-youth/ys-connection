// Admin Error log (T3; Part 1 rework 2026-10-17). Table from migrations 0019 + 0035. Never a name or value.
import type { ErrorTier } from '../../services/error-log-text';
export const ERROR_CATEGORIES = ['server', 'link', 'elvanto-form', 'client', 'reconcile'] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];
/** An occurrence joins the newest row with its fold key whose last_seen is within this window. */
export const FOLD_WINDOW_MS = 30 * 60_000;

export interface ErrorLogRow {
  id: string; category: ErrorCategory; code: string; route: string; status: number | null; message: string;
  count: number; firstSeen: string; lastSeen: string; lastRole: string | null; minimised: boolean; ignored: boolean;
  tier: ErrorTier; foldKey: string | null;
}
/** One occurrence. `id` = the new row's id if it starts one; `at` an ISO instant. */
export type ErrorLogEntry = Pick<ErrorLogRow, 'id' | 'category' | 'code' | 'route' | 'status' | 'message' | 'tier' | 'foldKey'> & {
  role: string | null; at: string;
  /** Occurrences this write adds (default 1). */
  n?: number;
};

export interface IErrorLogRepository {
  /**
   * setCount 0: delete row `id`. setCount n: upsert row `id` with count n (last_seen moves only when the count changes).
   * No setCount and a foldKey: add n to the newest row with that fold_key seen within FOLD_WINDOW_MS of `at`
   * and not ignored (F4 2026-10-22: an ignored row never hides a new occurrence), else insert `id`.
   * No setCount and no foldKey: upsert by id adding n (rows from before 0035).
   */
  record(e: ErrorLogEntry, setCount?: number): Promise<void>;
  /** Newest last_seen first, at most 500. */
  list(): Promise<ErrorLogRow[]>;
  /** false when the id is unknown. */
  setFlags(id: string, flags: { minimised?: boolean; ignored?: boolean }): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  /**
   * Every row, or only rows of that category and/or tier. Returns how many went.
   * ponytail: "Clear FYI" deletes by the STORED tier, while the screen groups by the tier textFor() recomputes at read
   * time; a code whose tier changes in error-log-text.ts after its row was written can show under FYI yet survive the
   * clear (or vice versa) until the row is rewritten. Fix by recomputing tiers in the service and deleting by id.
   */
  removeAll(category?: ErrorCategory, tier?: ErrorTier): Promise<number>;
  /** Deletes rows whose last_seen is before `iso`. */
  purgeBefore(iso: string): Promise<void>;
}
