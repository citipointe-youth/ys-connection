// Admin Error log (UX batch 2026-10-13 T3). Table from migration 0019. One row per fingerprint; never a name or value.
export const ERROR_CATEGORIES = ['server', 'link', 'elvanto-form', 'client'] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export interface ErrorLogRow {
  id: string; category: ErrorCategory; code: string; route: string; status: number | null; message: string;
  count: number; firstSeen: string; lastSeen: string; lastRole: string | null; minimised: boolean; ignored: boolean;
}
/** One occurrence. `id` is the fingerprint hash; `at` an ISO instant. */
export type ErrorLogEntry = Pick<ErrorLogRow, 'id' | 'category' | 'code' | 'route' | 'status' | 'message'> & {
  role: string | null; at: string;
};

export interface IErrorLogRepository {
  /**
   * Upsert by id: a new row starts at count 1; a repeat adds 1 and moves last_seen/last_role (flags are kept).
   * `setCount` stores that count instead of adding; last_seen only moves when the count changes.
   */
  record(e: ErrorLogEntry, setCount?: number): Promise<void>;
  /** Newest last_seen first, at most 500. */
  list(): Promise<ErrorLogRow[]>;
  /** false when the id is unknown. */
  setFlags(id: string, flags: { minimised?: boolean; ignored?: boolean }): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  /** Every row, or every row of one category. Returns how many went. */
  removeAll(category?: ErrorCategory): Promise<number>;
  /** Deletes rows whose last_seen is before `iso`. */
  purgeBefore(iso: string): Promise<void>;
}
