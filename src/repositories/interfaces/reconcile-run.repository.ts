export type CheckState = { count: number; noId?: number } | { error: true };
export interface ReconcileChecks { checkins: CheckState; unmatched: CheckState; lifegroups: CheckState; members: CheckState }
export interface ReconcileItems {
  checkins: { personId: string; date: string }[];
  unmatched: string[];
  lifegroups: { groupId: string; date: string; personIds: string[] }[];
  noId: string[];                       // lifegroup ids
  members: { groupId: string; personId: string; op: 'add' | 'remove' }[];
}
export interface ReconcileRun { id: string; ranAt: string; importId: string | null; ok: boolean; checks: ReconcileChecks; items: ReconcileItems }
export interface IReconcileRunRepository { save(r: ReconcileRun): Promise<void>; latest(): Promise<ReconcileRun | null> }
export const KEEP_RUNS = 20;
