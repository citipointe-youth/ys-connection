import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import { makeAccountService, passwordProblem } from '../services/account.service';
import { InMemoryUserRepository, InMemorySettingsRepository } from '../repositories/in-memory';
import { hashPassword } from '../utils/crypto';
import { BadRequestError } from '../core/errors/app-error';
import type { Actor } from '../core/entities/user';

// QA 2026-11-02 lane U (items 14, BRK-16): limits apply to create and rename only; older accounts keep working.
const admin = { id: 'a1', role: 'admin', displayName: 'A', grade: null, quad: null } as unknown as Actor;
async function build() {
  const users = new InMemoryUserRepository(); await users.init();
  const settings = new InMemorySettingsRepository(); await settings.init();
  const now = new Date().toISOString();
  // An account made before these rules: a username with a space and a 100-character display name.
  const old = await users.save({
    id: 'old', displayName: 'x'.repeat(100), email: 'Old Name', role: 'quad', grade: null, quad: 'g79', status: 'active',
    passwordHash: await hashPassword('        '), mustChangePassword: false, createdAt: now, updatedAt: now,
  } as any);
  return { svc: makeAccountService(users, settings), old };
}
const base = { displayName: 'Grade 9', email: 'grade9', password: 'longenough1', role: 'admin' };

describe('new and renamed accounts', () => {
  it('create refuses a username with spaces, markup or emoji, and names every problem at once', async () => {
    const { svc } = await build();
    for (const email of ['has space', '<b>x</b>', 'smile\u{1F600}', 'a'.repeat(41)]) {
      await expect(svc.create(admin, { ...base, email })).rejects.toBeInstanceOf(ZodError);
    }
    const err: any = await svc.create(admin, { displayName: 'x'.repeat(61), email: 'bad name', password: 'short', role: 'admin' }).catch((e) => e);
    expect([...new Set(err.errors.map((i: any) => i.path[0]))].sort()).toEqual(['displayName', 'email', 'password']);
  });
  it('create refuses a long or right-to-left display name', async () => {
    const { svc } = await build();
    await expect(svc.create(admin, { ...base, displayName: 'x'.repeat(61) })).rejects.toBeInstanceOf(ZodError);
    await expect(svc.create(admin, { ...base, displayName: 'abc‮def' })).rejects.toBeInstanceOf(ZodError);
    await expect(svc.create(admin, base)).resolves.toMatchObject({ email: 'grade9' });
  });
  it('an older account can still be edited for another field, but not renamed to a bad name', async () => {
    const { svc, old } = await build();
    await expect(svc.update(admin, old.id, { quad: 'b79', email: 'Old Name', displayName: old.displayName })).resolves.toMatchObject({ quad: 'b79' });
    await expect(svc.update(admin, old.id, { email: 'new name' })).rejects.toBeInstanceOf(ZodError);
    await expect(svc.update(admin, old.id, { email: 'new.name' })).resolves.toMatchObject({ email: 'new.name' });
  });
});

describe('password rules apply on set only', () => {
  it('spaces-only and over-72-byte passwords are refused', async () => {
    const { svc, old } = await build();
    expect(passwordProblem('        ')).toMatch(/only spaces/);
    expect(passwordProblem('a'.repeat(72))).toBeNull();
    expect(passwordProblem('a'.repeat(73))).toMatch(/too long/);
    expect(passwordProblem('\u{1F600}'.repeat(19))).toMatch(/too long/); // 76 bytes
    await expect(svc.create(admin, { ...base, password: '        ' })).rejects.toBeInstanceOf(ZodError);
    await expect(svc.setPassword(admin, old.id, 'a'.repeat(73))).rejects.toBeInstanceOf(BadRequestError);
    await expect(svc.setPassword(admin, old.id, '         ')).rejects.toBeInstanceOf(BadRequestError);
    await expect(svc.setPassword(admin, old.id, 'a'.repeat(72))).resolves.toBeUndefined();
  });
});
