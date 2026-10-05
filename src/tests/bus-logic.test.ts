import { describe, it, expect } from 'vitest';
import { MINISTRY_CONFIG_DEFAULTS, mergeMinistryConfig } from '../core/ministry-config';
import { can } from '../services/access-control';
import type { Actor } from '../core/entities/user';
import { currentRunDate, eligibilityOf, capacityOf, nameMatches, suburbOf, riderKey } from '../services/bus-logic';

const A = (role: string): Actor => ({ id: 'x', role: role as any, displayName: 'X', grade: null as any, quad: null as any });

describe('bus config defaults', () => {
  it('module off, admin-only, no ministry-specific values', () => {
    expect(MINISTRY_CONFIG_DEFAULTS.modules.busMinistry).toBe(false);
    expect(MINISTRY_CONFIG_DEFAULTS.labels.busMinistry).toBe('Bus Ministry');
    expect(MINISTRY_CONFIG_DEFAULTS.busMinistry).toEqual({
      visibility: 'admin', churchAddress: '', churchPlaceId: '', leaveTime: '21:00',
      targetRouteMin: 45, prefWeightMin: 10, genderWeightMin: 120,
      detourMin: 10, detourPct: 20, coordinatorLeaderIds: [], regionCode: '',
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

describe('currentRunDate (Friday = 5)', () => {
  it('Wednesday → coming Friday', () => expect(currentRunDate('2026-10-07T15:00', 5)).toBe('2026-10-09'));
  it('Friday evening → today', () => expect(currentRunDate('2026-10-09T19:05', 5)).toBe('2026-10-09'));
  it('Saturday 00:40 → still last night (drivers out late)', () => expect(currentRunDate('2026-10-10T00:40', 5)).toBe('2026-10-09'));
  it('Saturday 06:00 → next Friday', () => expect(currentRunDate('2026-10-10T06:00', 5)).toBe('2026-10-16'));
  it('works for a Sunday ministry', () => expect(currentRunDate('2026-10-07T10:00', 0)).toBe('2026-10-11'));
});
describe('eligibility + capacity', () => {
  it('from leader genders', () => {
    expect(eligibilityOf(['male'])).toEqual({ male: true, female: false, unknown: false });
    expect(eligibilityOf(['male', 'female'])).toEqual({ male: true, female: true, unknown: false });
    expect(eligibilityOf([null])).toEqual({ male: false, female: false, unknown: true });
    expect(eligibilityOf([])).toEqual({ male: false, female: false, unknown: true });
  });
  it('capacity never negative', () => { expect(capacityOf(12, 2)).toBe(10); expect(capacityOf(1, 3)).toBe(0); });
});
describe('names + suburb', () => {
  it('token prefix match, any order, accent-insensitive', () => {
    expect(nameMatches('kim ril', 'Riley', 'Kim')).toBe(true);
    expect(nameMatches('zoe', 'Zoë', 'Ng')).toBe(true);
    expect(nameMatches('ril x', 'Riley', 'Kim')).toBe(false);
  });
  it('suburb from a Google-style address', () => {
    expect(suburbOf('24 Wynnum Rd, Carina QLD 4152, Australia')).toBe('Carina');
    expect(suburbOf('12 Smith St')).toBe('12 Smith St');
  });
  it('rider key', () => expect(riderKey({ studentId: null, guestId: 'g1' })).toBe('g:g1'));
});
