import { describe, it, expect } from 'vitest';
import { can } from '../services/access-control';
import type { Actor } from '../core/entities/user';

const A = (role: string): Actor =>
  ({ id: 'a', role: role as any, displayName: 'T', grade: null as any, quad: null as any });

describe('Prayer RBAC', () => {
  it('all five roles can read and write prayers', () => {
    for (const r of ['leader', 'grade', 'quad', 'director', 'admin']) {
      expect(can(A(r), 'prayer:read')).toBe(true);
      expect(can(A(r), 'prayer:write')).toBe(true);
    }
  });
  it('only admin can import prayers', () => {
    expect(can(A('admin'), 'prayer:import')).toBe(true);
    for (const r of ['leader', 'grade', 'quad', 'director']) {
      expect(can(A(r), 'prayer:import')).toBe(false);
    }
  });
});
