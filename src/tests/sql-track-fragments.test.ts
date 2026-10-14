import { describe, it, expect } from 'vitest';
import { trackForCancellation } from '../repositories/supabase/client';
import { requestContext, type CancellableQuery } from '../utils/request-context';

// Mirrors postgres.js 3.4 Query (node_modules/postgres/src/query.js): a lazy Promise
// subclass whose then()/catch()/finally() call handle(), and handle() sends it once.
// A fragment (sql`and status in ...` nested in another query) must never be sent:
// 2026-10-14 prod logged "syntax error at or near "and"" for every such fragment.
class FakeQuery extends Promise<unknown> {
  sent = 0; executed = false;
  private res!: (v: unknown) => void;
  constructor() { let r!: (v: unknown) => void; super(a => { r = a; }); this.res = r; }
  static override get [Symbol.species]() { return Promise; }
  cancel() { /* no-op */ }
  async handle() { if (!this.executed) { this.executed = true; await 1; this.sent++; this.res([]); } }
  override then<A, B>(a?: ((v: unknown) => A | PromiseLike<A>) | null, b?: ((e: unknown) => B | PromiseLike<B>) | null) {
    void this.handle(); return super.then(a, b);
  }
}

const store = () => ({ id: 'r', route: 'GET /x', start: 0, pendingQueries: new Set<CancellableQuery>() });

describe('trackForCancellation', () => {
  it('does not send a query that is never awaited (a fragment)', async () => {
    const ctx = store(); const frag = new FakeQuery();
    requestContext.run(ctx, () => trackForCancellation(frag));
    await new Promise(r => setTimeout(r, 5));
    expect(frag.sent).toBe(0);
    expect(ctx.pendingQueries.size).toBe(0);
  });

  it('tracks an awaited query while it runs and drops it once settled', async () => {
    const ctx = store(); const q = new FakeQuery();
    await requestContext.run(ctx, async () => {
      trackForCancellation(q);
      const p = q.then(x => x);
      expect(ctx.pendingQueries.has(q)).toBe(true);
      await p;
    });
    await new Promise(r => setTimeout(r, 0));
    expect(q.sent).toBe(1);
    expect(ctx.pendingQueries.size).toBe(0);
  });
});
