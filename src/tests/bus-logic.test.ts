import { describe, it, expect } from 'vitest';
import { MINISTRY_CONFIG_DEFAULTS, mergeMinistryConfig } from '../core/ministry-config';
import { can } from '../services/access-control';
import type { Actor } from '../core/entities/user';

const A = (role: string): Actor => ({ id: 'x', role: role as any, displayName: 'X', grade: null as any, quad: null as any });

describe('bus config defaults', () => {
  it('module off, admin-only, no ministry-specific values', () => {
    expect(MINISTRY_CONFIG_DEFAULTS.modules.busMinistry).toBe(false);
    expect(MINISTRY_CONFIG_DEFAULTS.labels.busMinistry).toBe('Bus Ministry');
    expect(MINISTRY_CONFIG_DEFAULTS.busMinistry).toEqual({
      visibility: 'admin', churchAddress: '', churchPlaceId: '', leaveTime: '21:00',
      targetRouteMin: 45, prefWeightMin: 10, genderWeightMin: 120,
      detourMin: 10, detourPct: 20, coordinatorLeaderIds: [],
    });
  });
  it('merges a partial busMinistry patch', () => {
    const m = mergeMinistryConfig(MINISTRY_CONFIG_DEFAULTS, { busMinistry: { visibility: 'all' } });
    expect(m.busMinistry.visibility).toBe('all');
    expect(m.busMinistry.targetRouteMin).toBe(45);
  });
});

describe('bus RBAC', () => {
  it('matches the spec matrix', () => {
    expect(['leader', 'grade', 'quad', 'director', 'admin'].map((r) => can(A(r), 'bus:use'))).toEqual([true, true, true, true, true]);
    expect(['leader', 'grade', 'quad', 'director', 'admin'].map((r) => can(A(r), 'bus:roster'))).toEqual([false, true, true, true, true]);
    expect(['leader', 'grade', 'quad', 'director', 'admin'].map((r) => can(A(r), 'bus:coordinate'))).toEqual([false, false, true, true, true]);
    expect(['leader', 'grade', 'quad', 'director', 'admin'].map((r) => can(A(r), 'bus:analysis'))).toEqual([false, false, false, true, true]);
  });
});
