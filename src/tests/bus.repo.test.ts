import { describe, it, expect } from 'vitest';
import { InMemoryBusRepository } from '../repositories/in-memory';
import type { BusRun } from '../core/entities/bus';

const run = (id: string, date: string): BusRun => ({ id, serviceDate: date, version: 0, availablePoolLeaderIds: [],
  lockBy: null, lockUntil: null, lastChangeBy: null, lastChangeAt: null, undoSnapshot: null, undoUntil: null,
  createdAt: '2026-10-01T00:00:00.000Z' });

describe('InMemoryBusRepository', () => {
  it('insertRunIfAbsent is idempotent per date', async () => {
    const r = new InMemoryBusRepository(); await r.init();
    expect((await r.insertRunIfAbsent(run('a', '2026-10-09'))).created).toBe(true);
    const second = await r.insertRunIfAbsent(run('b', '2026-10-09'));
    expect(second.created).toBe(false);
    expect(second.run.id).toBe('a');
  });
  it('bumpRun increments version and records who', async () => {
    const r = new InMemoryBusRepository(); await r.init();
    await r.insertRunIfAbsent(run('a', '2026-10-09'));
    const b = await r.bumpRun('a', 'Sarah', '2026-10-09T09:04:00.000Z');
    expect([b.version, b.lastChangeBy]).toEqual([1, 'Sarah']);
  });
  it('deleteGuest removes their addresses; reassign moves them to a student', async () => {
    const r = new InMemoryBusRepository(); await r.init();
    const base = { label: 'Home', address: '1 A St, Carina', placeId: null, lastUsedAt: '2026-10-01T00:00:00.000Z', createdAt: '2026-10-01T00:00:00.000Z' };
    await r.saveAddress({ id: 'x1', studentId: null, guestId: 'g1', ...base });
    await r.saveAddress({ id: 'x2', studentId: null, guestId: 'g2', ...base });
    await r.reassignGuestAddresses('g1', 's1');
    expect((await r.listAddresses({ studentId: 's1' })).map((a) => a.id)).toEqual(['x1']);
    await r.deleteGuest('g2');
    expect(await r.listAddresses({ guestId: 'g2' })).toEqual([]);
  });
});

describe('run lock + undo (R2)', () => {
  it('tryLock only succeeds when unlocked or expired; release/setUndo/setPoolIds touch only their own fields', async () => {
    const r = new InMemoryBusRepository(); await r.init();
    await r.insertRunIfAbsent(run('a', '2026-10-09'));
    const t0 = '2026-10-09T09:00:00.000Z', t30 = '2026-10-09T09:00:30.000Z';
    expect((await r.tryLock('a', 'Sarah', t0, t30))!.lockBy).toBe('Sarah');
    expect(await r.tryLock('a', 'Tom', '2026-10-09T09:00:10.000Z', '2026-10-09T09:00:40.000Z')).toBeNull();
    expect((await r.tryLock('a', 'Tom', '2026-10-09T09:00:31.000Z', '2026-10-09T09:01:01.000Z'))!.lockBy).toBe('Tom');
    await r.setPoolIds('a', ['L1']);
    expect(await r.getRun('a')).toMatchObject({ lockBy: 'Tom', availablePoolLeaderIds: ['L1'] });
    await r.setUndo('a', [{ riderId: 'x', runVehicleId: null, stopOrder: null, pinned: false }], t30);
    await r.releaseLock('a', 'Tom');
    expect(await r.getRun('a')).toMatchObject({ lockBy: null, lockUntil: null, undoUntil: t30, availablePoolLeaderIds: ['L1'] });
  });

  // I3 (controller ruling): a successful tryLock and a releaseLock must bump the run version —
  // otherwise other phones' 10s version poll never notices the lock and the
  // "<name> is generating routes…" banner only shows if someone happens to reopen the page.
  it('I3: a successful tryLock and releaseLock each bump the version; a failed tryLock does not', async () => {
    const r = new InMemoryBusRepository(); await r.init();
    await r.insertRunIfAbsent(run('a', '2026-10-09'));
    const t0 = '2026-10-09T09:00:00.000Z', t30 = '2026-10-09T09:00:30.000Z';
    expect((await r.getRun('a'))!.version).toBe(0);
    expect((await r.tryLock('a', 'Sarah', t0, t30))!.version).toBe(1);
    expect(await r.tryLock('a', 'Tom', '2026-10-09T09:00:10.000Z', '2026-10-09T09:00:40.000Z')).toBeNull();
    expect((await r.getRun('a'))!.version).toBe(1); // the rejected tryLock changed nothing
    await r.releaseLock('a', 'Sarah');
    expect((await r.getRun('a'))!.version).toBe(2);
  });

  // M1: a generate that overran LOCK_MS must not clear a lock a second, legitimate generate has
  // since taken over — releaseLock only clears a lock the caller itself still holds.
  it('M1: releaseLock is a no-op for a caller who no longer holds the lock', async () => {
    const r = new InMemoryBusRepository(); await r.init();
    await r.insertRunIfAbsent(run('a', '2026-10-09'));
    const t0 = '2026-10-09T09:00:00.000Z', t30 = '2026-10-09T09:00:30.000Z';
    await r.tryLock('a', 'Sarah', t0, t30); // Sarah's generate overran LOCK_MS…
    await r.tryLock('a', 'Tom', '2026-10-09T09:01:00.000Z', '2026-10-09T09:01:30.000Z'); // …Tom's legitimately took over
    await r.releaseLock('a', 'Sarah'); // Sarah's stale finally{} fires last
    expect(await r.getRun('a')).toMatchObject({ lockBy: 'Tom' }); // Tom's lock survives
    await r.releaseLock('a', 'Tom');
    expect((await r.getRun('a'))!.lockBy).toBeNull();
  });

  // Task 2: M1 above uses two different names (Sarah/Tom) — but the real prod bug is the SAME
  // leader, two devices, so bus.service.ts must never pass the bare display name as `by`. Both
  // repos already match `by` as an opaque string, so a "<name>#<token>" value (minted once per
  // generate() call) fixes this with no repo code change and no migration — proven here directly
  // against the repo, independent of bus.service.ts's own lock-by-token wiring.
  it('Task 2: a per-call token suffix on lock_by lets a stale same-NAME release miss a newer same-name lock', async () => {
    const r = new InMemoryBusRepository(); await r.init();
    await r.insertRunIfAbsent(run('a', '2026-10-09'));
    const t0 = '2026-10-09T09:00:00.000Z', t30 = '2026-10-09T09:00:30.000Z';
    await r.tryLock('a', 'Sarah#tok1', t0, t30); // Sarah's phone A generate
    await r.tryLock('a', 'Sarah#tok2', '2026-10-09T09:01:00.000Z', '2026-10-09T09:01:30.000Z'); // Sarah's phone B takes over
    await r.releaseLock('a', 'Sarah#tok1'); // phone A's stale finally{} fires last — SAME display name as phone B
    expect(await r.getRun('a')).toMatchObject({ lockBy: 'Sarah#tok2' }); // phone B's lock survives
    await r.releaseLock('a', 'Sarah#tok2');
    expect((await r.getRun('a'))!.lockBy).toBeNull();
  });
});
