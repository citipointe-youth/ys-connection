import { describe, it, expect } from 'vitest';
import { InMemoryReconcileRunRepository } from '../repositories/in-memory/reconcile-run.repository';
import type { ReconcileRun } from '../repositories/interfaces/reconcile-run.repository';

const run = (i: number): ReconcileRun => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  ranAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(), importId: `imp-${i}`, ok: true,
  checks: { checkins: { count: 0 }, unmatched: { count: 0 }, lifegroups: { count: 0, noId: 0 }, members: { count: 0 } },
  items: { checkins: [], unmatched: [], lifegroups: [], noId: [], members: [] },
});

describe('reconcile run store', () => {
  it('latest is null when empty', async () => {
    expect(await new InMemoryReconcileRunRepository().latest()).toBeNull();
  });
  it('latest returns the newest by ranAt and keeps 20', async () => {
    const r = new InMemoryReconcileRunRepository();
    for (let i = 1; i <= 25; i++) await r.save(run(i));
    expect((await r.latest())?.importId).toBe('imp-25');
    expect(r.size()).toBe(20);
  });
});
