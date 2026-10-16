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
  /** Deletes rows (and New person request claims) created before `iso`. */
  purgeBefore(iso: string): Promise<void>;
  /** S-5/D4 (migration 0032): claim a New person request id. `fresh` when this call made the claim; otherwise the
   *  stored result, or null while the first send is still running (or its finish was lost). */
  /** staleMs (RV-S-m4, admin retries only): an unfinished claim older than this is taken over (fresh). */
  claimRequest(id: string, by: string, staleMs?: number): Promise<{ fresh: boolean; result: unknown | null }>;
  /** Store the final result, or null to drop the claim so a fixed retry can go (nothing posted, or rejected). */
  finishRequest(id: string, result: unknown | null): Promise<void>;
}
