// X19 (T4): the youth intake + consent plans the console pushes (migration 0021). One (mode, date) is replaced whole by
// each push. `detail` is the whole pushed row (names, phones, DOB): encrypted at rest by the Supabase repo, null once the
// row is done. Admin only (service layer).
export type IntakeMode = 'intake' | 'consent';
export type PlanStatus = 'needs-you' | 'ready' | 'done';

export interface IntakeDateRow {
  mode: IntakeMode; date: string;
  /** null = the admin asked for this date but no push has landed yet. */
  takenAt: string | null; consoleId: string | null; rowCount: number; cut: boolean;
  inputsFrom: 'console' | 'app' | null; inputsAt: string | null; refreshAskedAt: string | null;
}
/** A list row: no PII beyond the title (the name, as on the roster). */
export interface IntakeRowLite {
  mode: IntakeMode; date: string; key: string; status: PlanStatus; title: string; reason: string;
  fromApp: boolean; hasText: boolean; takenAt: string; doneAt: string | null;
  /** Consent rows: the planned outcome ('' for intake rows). */
  outcome: string;
}
export interface IntakePushMeta {
  date: string; takenAt: string; consoleId: string; cut: boolean; inputs: { from: 'console' | 'app'; at: string } | null;
}
export type IntakeRowWrite = Omit<IntakeRowLite, 'mode' | 'date' | 'takenAt' | 'doneAt'> & { detail: unknown };

export interface ILinkIntakeRepository {
  /** takenAt <= the stored one for (mode, date) -> not applied. Done rows are stored without detail. Clears refreshAskedAt. */
  replace(mode: IntakeMode, meta: IntakePushMeta, rows: IntakeRowWrite[]): Promise<{ applied: boolean; rows: number }>;
  dates(mode?: IntakeMode): Promise<IntakeDateRow[]>;
  rows(mode: IntakeMode, date?: string): Promise<IntakeRowLite[]>;
  /** The decrypted detail; `unreadable` when it would not decrypt (detail is then null). */
  detail(mode: IntakeMode, date: string, key: string): Promise<{ row: IntakeRowLite; detail: unknown; unreadable: boolean } | null>;
  /** Marks a Refresh ask; false when one was asked for the same (mode, date) under 60 s ago. */
  askRefresh(mode: IntakeMode, date: string): Promise<boolean>;
  markViewed(): Promise<void>;
  viewedAt(): Promise<string | null>;
  /** Deletes every row and date older than `before` (YYYY-MM-DD, exclusive). */
  purge(before: string): Promise<void>;
  /** Module Off: deletes every link_intake_* row. */
  clear(): Promise<void>;
}
