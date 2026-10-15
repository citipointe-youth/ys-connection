import { describe, it, expect } from 'vitest';
import { quadGradesOf } from '../services/access-control';
import { computeQuad } from '../core/types/enums';
import { can, assertCan, canAccessGrade, canAccessGender, canAccessStudent, canUseNewYouth, canUseIntakeAdmin, canWithConfig, modeAllows, canSetViewGrades, type Action } from '../services/access-control';
import { deriveActorGender } from '../services/auth.service';
import type { Actor, User } from '../core/entities/user';
import { ForbiddenError } from '../core/errors/app-error';

// Test helpers
function actor(role: string, opts: { grade?: number; quad?: string; gender?: 'male' | 'female' | null } = {}): Actor {
  return { id: 'test', role: role as any, displayName: 'Test', grade: (opts.grade ?? null) as any, quad: (opts.quad ?? null) as any, gender: opts.gender ?? null };
}

describe('RBAC — can()', () => {
  // TC01 — grade login can read students
  it('TC01: grade can read students', () => {
    expect(can(actor('grade', { grade: 9 }), 'student:read')).toBe(true);
  });

  // TC02 — grade login can write leaders
  it('TC02: grade can write leaders', () => {
    expect(can(actor('grade', { grade: 9 }), 'leader:write')).toBe(true);
  });

  // TC03 — grade login CANNOT import CSV
  it('TC03: grade cannot import', () => {
    expect(can(actor('grade', { grade: 9 }), 'import:run')).toBe(false);
  });

  // TC04 — grade login CANNOT manage admin
  it('TC04: grade cannot admin:manage', () => {
    expect(can(actor('grade', { grade: 9 }), 'admin:manage')).toBe(false);
  });

  // TC05 — quad login CAN write leaders (scoped to gender + bracket; see leader.service.test)
  it('TC05: quad can write leaders', () => {
    expect(can(actor('quad', { quad: 'g79' }), 'leader:write')).toBe(true);
  });

  // Gendered grade login: own grade + own gender only.
  it('gendered grade login sees only its own gender; ungendered sees both', () => {
    const g7girls = actor('grade', { grade: 7, gender: 'female' });
    expect(canAccessStudent(g7girls, 7, 'female')).toBe(true);
    expect(canAccessStudent(g7girls, 7, 'male')).toBe(false);   // wrong gender
    expect(canAccessStudent(g7girls, 8, 'female')).toBe(false); // wrong grade
    expect(canAccessGender(g7girls, 'female')).toBe(true);
    expect(canAccessGender(g7girls, 'male')).toBe(false);
    // Ungendered grade login (no gender derived) still sees both genders.
    const g7 = actor('grade', { grade: 7, gender: null });
    expect(canAccessStudent(g7, 7, 'male')).toBe(true);
    expect(canAccessStudent(g7, 7, 'female')).toBe(true);
  });

  // deriveActorGender from the email convention.
  it('deriveActorGender reads grade email g/b suffix and quad gender', () => {
    const mk = (role: string, email: string, quad?: string): User =>
      ({ id: 'u', displayName: 'X', email, role: role as any, grade: 7 as any, quad: (quad ?? null) as any, status: 'active', createdAt: '', updatedAt: '' });
    expect(deriveActorGender(mk('grade', 'grade7g'))).toBe('female');
    expect(deriveActorGender(mk('grade', 'grade7b'))).toBe('male');
    expect(deriveActorGender(mk('grade', 'grade7'))).toBeNull(); // no suffix
    expect(deriveActorGender(mk('quad', 'b1012', 'b1012'))).toBe('male');
    expect(deriveActorGender(mk('admin', 'admin'))).toBeNull();
  });

  // TC06 — quad login can allocate
  it('TC06: quad can allocate', () => {
    expect(can(actor('quad', { quad: 'g79' }), 'connection:write')).toBe(true);
  });

  // TC07 — director can import
  it('TC07: director can import', () => {
    expect(can(actor('director'), 'import:run')).toBe(true);
  });

  // TC08 — director cannot admin:manage
  it('TC08: director cannot admin:manage', () => {
    expect(can(actor('director'), 'admin:manage')).toBe(false);
  });

  // TC09 — admin can do everything
  it('TC09: admin has all permissions', () => {
    const a = actor('admin');
    expect(can(a, 'admin:manage')).toBe(true);
    expect(can(a, 'import:run')).toBe(true);
    expect(can(a, 'student:write')).toBe(true);
    expect(can(a, 'leader:write')).toBe(true);
  });

  // TC10 — assertCan throws for forbidden
  it('TC10: assertCan throws ForbiddenError', () => {
    expect(() => assertCan(actor('grade', { grade: 7 }), 'admin:manage')).toThrow(ForbiddenError);
  });
});

describe('canAccessGrade()', () => {
  // TC11 — grade login accesses own grade
  it('TC11: grade accesses own grade', () => {
    expect(canAccessGrade(actor('grade', { grade: 9 }), 9)).toBe(true);
  });

  // TC12 — grade login denied other grade
  it('TC12: grade denied other grade', () => {
    expect(canAccessGrade(actor('grade', { grade: 9 }), 10)).toBe(false);
  });

  // TC13 — g79 quad accesses Gr 7
  it('TC13: g79 quad accesses Gr 7', () => {
    expect(canAccessGrade(actor('quad', { quad: 'g79' }), 7)).toBe(true);
  });

  // TC14 — g79 quad denied Gr 10
  it('TC14: g79 quad denied Gr 10', () => {
    expect(canAccessGrade(actor('quad', { quad: 'g79' }), 10)).toBe(false);
  });

  // TC15 — b1012 quad accesses Gr 11
  it('TC15: b1012 quad accesses Gr 11', () => {
    expect(canAccessGrade(actor('quad', { quad: 'b1012' }), 11)).toBe(true);
  });

  // TC16 — director accesses any grade
  it('TC16: director accesses any grade', () => {
    expect(canAccessGrade(actor('director'), 7)).toBe(true);
    expect(canAccessGrade(actor('director'), 12)).toBe(true);
  });

  // TC17 — grade login with null grade returns false
  it('TC17: grade with null grade returns false', () => {
    expect(canAccessGrade(actor('grade', {}), 9)).toBe(false);
  });
});

describe('canAccessGender()', () => {
  // TC18 — g79 quad can access female students
  it('TC18: g79 quad can access female', () => {
    expect(canAccessGender(actor('quad', { quad: 'g79' }), 'female')).toBe(true);
  });

  // TC19 — g79 quad denied male students
  it('TC19: g79 quad denied male', () => {
    expect(canAccessGender(actor('quad', { quad: 'g79' }), 'male')).toBe(false);
  });

  // TC20 — b79 quad can access male students
  it('TC20: b79 quad can access male', () => {
    expect(canAccessGender(actor('quad', { quad: 'b79' }), 'male')).toBe(true);
  });

  // TC21 — grade login can access any gender
  it('TC21: grade can access any gender', () => {
    expect(canAccessGender(actor('grade', { grade: 8 }), 'male')).toBe(true);
    expect(canAccessGender(actor('grade', { grade: 8 }), 'female')).toBe(true);
  });

  // TC22 — director can access any gender
  it('TC22: director can access any gender', () => {
    expect(canAccessGender(actor('director'), 'female')).toBe(true);
    expect(canAccessGender(actor('director'), 'male')).toBe(true);
  });
});

describe('RBAC — intake:write (New youth forms)', () => {
  it.each(['leader', 'grade', 'quad', 'director', 'admin'])('%s can send new youth forms', (role) => {
    expect(can(actor(role), 'intake:write')).toBe(true);
  });
});

describe('RBAC — canUseNewYouth (off / shadow / on)', () => {
  const roles = ['leader', 'grade', 'quad', 'director', 'admin'];
  it.each(roles)('off: %s cannot', (role) => {
    expect(canUseNewYouth(actor(role), 'off')).toBe(false);
  });
  it.each(roles)('on: %s can', (role) => {
    expect(canUseNewYouth(actor(role), 'on')).toBe(true);
  });
  it.each(roles)('shadow: only admin (%s)', (role) => {
    expect(canUseNewYouth(actor(role), 'shadow')).toBe(role === 'admin');
  });
});

describe('RBAC — Elvanto link (link:use / link:admin)', () => {
  const roles = ['leader', 'grade', 'quad', 'director', 'admin'];
  it.each(roles)('link:use: %s can', (role) => {
    expect(can(actor(role), 'link:use')).toBe(true);
  });
  it.each(roles)('link:admin: admin only, directors lose it too (T9) (%s)', (role) => {
    expect(can(actor(role), 'link:admin')).toBe(role === 'admin');
  });
  it.each(roles)('T4 intake:admin and canUseIntakeAdmin: admin only (not director), and only while the module is on (%s)', (role) => {
    expect(can(actor(role), 'intake:admin')).toBe(role === 'admin');
    expect(can(actor(role), 'link:flowRemove')).toBe(role === 'admin' || role === 'director'); // rev 6 (R4)
    expect(canUseIntakeAdmin(actor(role), 'on')).toBe(role === 'admin');
    expect(canUseIntakeAdmin(actor(role), 'off')).toBe(false);
  });
  it.each(roles)('modeAllows: on -> all, shadow -> admin only, off -> none (%s)', (role) => {
    expect(modeAllows(actor(role), 'on')).toBe(true);
    expect(modeAllows(actor(role), 'shadow')).toBe(role === 'admin');
    expect(modeAllows(actor(role), 'off')).toBe(false);
  });
});

// Every Action, checked at compile time against the union in both directions.
const ALL_ACTIONS = [
  'student:read', 'student:read:sensitive', 'student:write', 'leader:read', 'leader:write',
  'connection:write', 'overview:read', 'atrisk:read', 'import:run', 'connection:import',
  'admin:manage', 'prayer:read', 'prayer:write', 'prayer:import', 'bus:use', 'bus:roster',
  'bus:coordinate', 'bus:analysis', 'intake:write', 'link:use', 'link:admin', 'intake:admin', 'link:flowRemove', 'notice:write',
] as const satisfies readonly Action[];
type _MissingAction = Exclude<Action, (typeof ALL_ACTIONS)[number]>;
const _allActionsListed: [_MissingAction] extends [never] ? true : never = true;
void _allActionsListed;
const ALL_ROLES = ['leader', 'grade', 'quad', 'director', 'admin'] as const;
const simpleCfg = (simple: boolean) => ({ logins: { simple, retiredGradeIds: [], gradeRoleWasOn: true } });

describe('RBAC — canWithConfig (Simple logins)', () => {
  it('quad loses bus:coordinate only while Simple logins is on', () => {
    expect(canWithConfig(actor('quad', { quad: 'b1012' }), 'bus:coordinate', simpleCfg(true))).toBe(false);
    expect(canWithConfig(actor('quad', { quad: 'b1012' }), 'bus:coordinate', simpleCfg(false))).toBe(true);
  });

  it('equals can() for every role × action × simple, except quad + bus:coordinate + simple', () => {
    for (const role of ALL_ROLES) {
      for (const action of ALL_ACTIONS) {
        for (const simple of [true, false]) {
          const a = actor(role, { quad: role === 'quad' ? 'g79' : undefined, grade: role === 'grade' ? 9 : undefined });
          const expected = role === 'quad' && action === 'bus:coordinate' && simple ? false : can(a, action);
          expect(canWithConfig(a, action, simpleCfg(simple)), `${role} ${action} simple=${simple}`).toBe(expected);
        }
      }
    }
  });
});

describe('RBAC — modeAllows', () => {
  it.each(ALL_ROLES)('on: %s allowed', (role) => {
    expect(modeAllows(actor(role), 'on')).toBe(true);
  });
  it.each(ALL_ROLES)('shadow: only admin (%s)', (role) => {
    expect(modeAllows(actor(role), 'shadow')).toBe(role === 'admin');
  });
  it.each(ALL_ROLES)('off: %s not allowed', (role) => {
    expect(modeAllows(actor(role), 'off')).toBe(false);
  });
});

describe('RBAC — canUseNewYouth full table', () => {
  const table: Array<[string, 'off' | 'shadow' | 'on', boolean]> = [];
  for (const role of ALL_ROLES) {
    table.push([role, 'off', false], [role, 'shadow', role === 'admin'], [role, 'on', true]);
  }
  it.each(table)('%s in %s mode → %s', (role, mode, expected) => {
    expect(canUseNewYouth(actor(role), mode)).toBe(expected);
  });
});

describe('RBAC — canSetViewGrades', () => {
  it.each(['quad', 'director', 'admin'])('%s may write any leader', (role) => {
    expect(canSetViewGrades(actor(role, { quad: role === 'quad' ? 'g79' : undefined }), 'L1')).toBe(true);
    expect(canSetViewGrades(actor(role, { quad: role === 'quad' ? 'g79' : undefined }), 'L2')).toBe(true);
  });
  it('leader may write only its own leaderId', () => {
    const me: Actor = { ...actor('leader'), leaderId: 'L1' };
    expect(canSetViewGrades(me, 'L1')).toBe(true);
    expect(canSetViewGrades(me, 'L2')).toBe(false);
  });
  it('a leader with no leaderId cannot write', () => {
    expect(canSetViewGrades(actor('leader'), 'L1')).toBe(false);
  });
  it('grade cannot write', () => {
    expect(canSetViewGrades(actor('grade', { grade: 9 }), 'L1')).toBe(false);
  });
});

describe('T13 grade 6 is junior', () => {
  it('computeQuad puts grade 6 in the junior quads', () => {
    expect(computeQuad(6, 'female')).toBe('g79');
    expect(computeQuad(6, 'male')).toBe('b79');
    expect(computeQuad(5, 'male')).toBeNull();
  });
  it('a junior quad login sees grade 6; a senior one does not', () => {
    expect(canAccessGrade(actor('quad', { quad: 'g79' }), 6)).toBe(true);
    expect(canAccessGrade(actor('quad', { quad: 'b1012' }), 6)).toBe(false);
    expect(quadGradesOf('b79')).toEqual([6, 7, 8, 9]);
  });
});
