import { describe, it, expect } from 'vitest';
import { makeAuthService } from '../services/auth.service';
import { InMemoryUserRepository } from '../repositories/in-memory';
import { hashPassword } from '../utils/crypto';

async function seedUser(mustChangePassword: boolean) {
  const users = new InMemoryUserRepository();
  await users.init();
  const now = new Date().toISOString();
  await users.save({
    id: 'u-1', displayName: 'Director', email: 'director', role: 'director',
    grade: null, quad: null, status: 'active', passwordHash: await hashPassword('correcthorse1'),
    mustChangePassword, createdAt: now, updatedAt: now,
  });
  return { users, auth: makeAuthService(users) };
}

describe('Auth Service — mustChangePassword in the session', () => {
  it('embeds mustChangePassword: true in the token for a flagged account', async () => {
    const { auth } = await seedUser(true);
    const { token } = await auth.login({ email: 'director', password: 'correcthorse1' });
    const actor = await auth.resolveToken(token);
    expect(actor?.mustChangePassword).toBe(true);
  });

  it('embeds mustChangePassword: false for a normal account', async () => {
    const { auth } = await seedUser(false);
    const { token } = await auth.login({ email: 'director', password: 'correcthorse1' });
    const actor = await auth.resolveToken(token);
    expect(actor?.mustChangePassword).toBe(false);
  });
});
