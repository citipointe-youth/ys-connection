// ID Checks permissions (Task 9, spec 2026-10-30 §7.4).
import { describe, it, expect } from 'vitest';
import { can, canSeeIdChecks, isIdCheckTickTarget } from '../services/access-control';
import type { Actor, User } from '../core/entities/user';

const A = (role: string, id = `${role}-1`): Actor => ({ id, role: role as Actor['role'], displayName: role, grade: null, quad: null });
const U = (role: string, status: 'active' | 'inactive' = 'active'): User =>
  ({ id: 'u', displayName: 'Ovie Codeman', email: 'x', role: role as User['role'], status, createdAt: '', updatedAt: '' });

describe('idcheck actions', () => {
  it('only oversight and admin use; only admin assigns', () => {
    for (const r of ['leader', 'grade', 'quad', 'oversight', 'admin']) {
      expect(can(A(r), 'idcheck:use')).toBe(r === 'oversight' || r === 'admin');
      expect(can(A(r), 'idcheck:assign')).toBe(r === 'admin');
    }
  });
});

describe('canSeeIdChecks', () => {
  it('admin unticked = false; admin ticked = true (no role short-cut)', () => {
    const admin = A('admin');
    expect(canSeeIdChecks(admin, new Set())).toBe(false);
    expect(canSeeIdChecks(admin, new Set([admin.id]))).toBe(true);
  });
  it('inert tick: a ticked account that is now a quad login sees nothing', () => {
    const q = A('quad', 'was-oversight');
    expect(canSeeIdChecks(q, new Set([q.id]))).toBe(false);
  });
  it('oversight needs its own tick', () => {
    expect(canSeeIdChecks(A('oversight'), new Set(['someone-else']))).toBe(false);
    expect(canSeeIdChecks(A('oversight'), new Set(['oversight-1']))).toBe(true);
  });
});

describe('isIdCheckTickTarget', () => {
  it('active oversight or admin only', () => {
    expect(isIdCheckTickTarget(U('oversight'))).toBe(true);
    expect(isIdCheckTickTarget(U('admin'))).toBe(true);
    expect(isIdCheckTickTarget(U('oversight', 'inactive'))).toBe(false);
    expect(isIdCheckTickTarget(U('quad'))).toBe(false);
    expect(isIdCheckTickTarget(U('grade'))).toBe(false);
  });
});
