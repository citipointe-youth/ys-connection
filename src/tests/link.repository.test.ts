import { describe, it, expect } from 'vitest';
import { InMemoryLinkRepository } from '../repositories/in-memory/link.repository';
import { describeLinkRepo } from './helpers/link-repo-suite';

describeLinkRepo('memory', async (opts) => {
  const repo = new InMemoryLinkRepository({ decrypt: opts?.decrypt });
  return {
    repo,
    backdate: async (table, id, column, iso) => repo._backdate(table, id, column, iso),
    peekNote: async (id) => repo._peekNote(id),
    cleanup: async () => {},
  };
});

// T6 (memory only: on Postgres leader_id references leaders, so the shared V2 suite would need a leader row).
describe('InMemoryLinkRepository flow assignments (T6)', () => {
  const F = 'f1000000-0000-4000-8000-000000000001', P = '9e000000-0000-4000-8000-000000000001';
  const L1 = 'aa000000-0000-4000-8000-000000000001', L2 = 'aa000000-0000-4000-8000-000000000002';
  it('one per (flow, person): assign, reassign replaces, null unassigns', async () => {
    const repo = new InMemoryLinkRepository();
    await repo.setFlowAssign({ flowId: F, personId: P, leaderId: L1, assignedBy: 'grade9g' });
    await repo.setFlowAssign({ flowId: F, personId: P, leaderId: L2, assignedBy: 'admin' });
    const [a, ...rest] = await repo.flowAssignments();
    expect(rest).toEqual([]);
    expect(a).toMatchObject({ flowId: F, personId: P, leaderId: L2, assignedBy: 'admin' });
    expect(typeof a!.assignedAt).toBe('string');
    await repo.setFlowAssign({ flowId: F, personId: P, leaderId: null, assignedBy: 'admin' });
    expect(await repo.flowAssignments()).toEqual([]);
  });
});
