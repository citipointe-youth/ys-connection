import { describe, it, expect } from 'vitest';
import { actorGrades, canAccessGrade, canAccessStudent } from '../services/access-control';
import { makeAccountService } from '../services/account.service';
import { deriveActorGender, toActor } from '../services/auth.service';
import { InMemoryUserRepository } from '../repositories/in-memory';
import type { Actor, User } from '../core/entities/user';
import { BadRequestError } from '../core/errors/app-error';

// Multi-grade grade accounts — §5.1a of the generalisation design. These lock in
// the NEW behaviour; the pre-existing access-control.test.ts asserts the legacy
// single-grade path is byte-identical and is intentionally left unmodified.

function actor(over: Partial<Actor>): Actor {
  return { id: 'a', role: 'grade', displayName: 'T', grade: null, quad: null, ...over };
}

describe('actorGrades() — effective grade set', () => {
  it('returns the multi-grade array when present', () => {
    expect(actorGrades(actor({ grades: [7, 8, 9] }))).toEqual([7, 8, 9]);
  });
  it('falls back to [grade] for a legacy single-grade actor', () => {
    expect(actorGrades(actor({ grade: 9 }))).toEqual([9]);
  });
  it('returns [] when neither is set', () => {
    expect(actorGrades(actor({}))).toEqual([]);
  });
  it('prefers grades over a stale single grade', () => {
    expect(actorGrades(actor({ grade: 7, grades: [10, 11, 12] }))).toEqual([10, 11, 12]);
  });
});

describe('canAccessGrade() with a multi-grade grade login', () => {
  const a = actor({ grades: [7, 8, 9], gender: 'female' });
  it('grants access to every grade in the set', () => {
    expect(canAccessGrade(a, 7)).toBe(true);
    expect(canAccessGrade(a, 8)).toBe(true);
    expect(canAccessGrade(a, 9)).toBe(true);
  });
  it('denies grades outside the set', () => {
    expect(canAccessGrade(a, 10)).toBe(false);
    expect(canAccessGrade(a, 6)).toBe(false);
  });
  it('scopes students to exactly the set × explicit gender', () => {
    expect(canAccessStudent(a, 8, 'female')).toBe(true);
    expect(canAccessStudent(a, 8, 'male')).toBe(false);   // wrong gender
    expect(canAccessStudent(a, 10, 'female')).toBe(false); // wrong grade
  });
});

describe('deriveActorGender() — explicit field vs email convention', () => {
  const mk = (over: Partial<User>): User => ({
    id: 'u', displayName: 'X', email: 'grade789@youth.ministry', role: 'grade',
    grade: null, quad: null, status: 'active', createdAt: '', updatedAt: '', ...over,
  });
  it('uses the explicit gender field when set (multi-grade accounts)', () => {
    expect(deriveActorGender(mk({ grades: [7, 8, 9], gender: 'female' }))).toBe('female');
    expect(deriveActorGender(mk({ grades: [7, 8, 9], gender: 'male' }))).toBe('male');
  });
  it('still honours the email convention when no explicit gender is set', () => {
    expect(deriveActorGender(mk({ email: 'grade7g@youth.ministry', grade: 7 }))).toBe('female');
    expect(deriveActorGender(mk({ email: 'grade7@youth.ministry', grade: 7 }))).toBeNull();
  });
  it('toActor carries the full grade set and derived gender', () => {
    const a = toActor(mk({ grades: [7, 8, 9], gender: 'male' }));
    expect(a.grades).toEqual([7, 8, 9]);
    expect(a.gender).toBe('male');
  });
});

describe('AccountService — multi-grade create/update', () => {
  const admin: Actor = { id: 'adm', role: 'admin', displayName: 'A', grade: null, quad: null };

  async function svc() {
    const users = new InMemoryUserRepository();
    await users.init();
    return { users, account: makeAccountService(users) };
  }

  it('creates a grade account spanning several grades with an explicit gender', async () => {
    const { users, account } = await svc();
    const created = await account.create(admin, {
      displayName: 'Junior Girls', email: 'juniorg@youth.ministry', password: 'longenoughpw',
      role: 'grade', grades: [7, 8, 9], gender: 'female',
    });
    const stored = await users.findById(created.id);
    expect(stored?.grades).toEqual([7, 8, 9]);
    expect(stored?.gender).toBe('female');
    // single-grade back-compat anchor is null when spanning >1 grade
    expect(stored?.grade).toBeNull();
  });

  it('keeps the legacy single-grade path working (grade → grades:[grade])', async () => {
    const { users, account } = await svc();
    const created = await account.create(admin, {
      displayName: 'Grade 8', email: 'grade8@youth.ministry', password: 'longenoughpw',
      role: 'grade', grade: 8, gender: 'male',
    });
    const stored = await users.findById(created.id);
    expect(stored?.grade).toBe(8);
    expect(stored?.grades).toEqual([8]);
  });

  it('rejects a grade account with no grades', async () => {
    const { account } = await svc();
    await expect(
      account.create(admin, {
        displayName: 'Bad', email: 'bad@youth.ministry', password: 'longenoughpw',
        role: 'grade', grades: [],
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rejects a grade account with no gender scope', async () => {
    const { account } = await svc();
    await expect(
      account.create(admin, {
        displayName: 'No Gender', email: 'nogender@youth.ministry', password: 'longenoughpw',
        role: 'grade', grade: 7,
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rejects clearing gender on an existing grade account via update', async () => {
    const { account } = await svc();
    const created = await account.create(admin, {
      displayName: 'Grade 9', email: 'grade9x@youth.ministry', password: 'longenoughpw',
      role: 'grade', grade: 9, gender: 'female',
    });
    await expect(
      account.update(admin, created.id, { gender: null }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('updates an existing account to span multiple grades', async () => {
    const { users, account } = await svc();
    const created = await account.create(admin, {
      displayName: 'Grade 7', email: 'grade7@youth.ministry', password: 'longenoughpw',
      role: 'grade', grade: 7, gender: 'female',
    });
    await account.update(admin, created.id, { grades: [7, 8, 9], gender: 'male' });
    const stored = await users.findById(created.id);
    expect(stored?.grades).toEqual([7, 8, 9]);
    expect(stored?.gender).toBe('male');
    expect(stored?.grade).toBeNull();
  });

  it('dedupes and sorts an out-of-order grade set', async () => {
    const { users, account } = await svc();
    const created = await account.create(admin, {
      displayName: 'Messy', email: 'messy@youth.ministry', password: 'longenoughpw',
      role: 'grade', grades: [9, 7, 8, 7], gender: 'female',
    });
    const stored = await users.findById(created.id);
    expect(stored?.grades).toEqual([7, 8, 9]);
  });
});
