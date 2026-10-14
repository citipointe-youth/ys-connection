// T10 (UX batch 2026-10-14b): New person sends that did not land, kept for the admin to resend.
// Table from migration 0023. `payload` is the submitted form, encrypted (AAD `newperson_unsent.payload:<id>`).
export type UnsentReason = 'unreachable' | 'form-changed' | 'failed' | 'unconfirmed';

export interface UnsentRow { id: string; reason: UnsentReason; payload: string; createdAt: string; updatedAt: string }

export interface IUnsentRepository {
  /** Insert, or replace reason/payload/updatedAt of an existing id (createdAt is kept). */
  save(row: UnsentRow): Promise<void>;
  /** Oldest first. */
  list(): Promise<UnsentRow[]>;
  remove(id: string): Promise<boolean>;
  /** Deletes rows created before `iso`. */
  purgeBefore(iso: string): Promise<void>;
}
