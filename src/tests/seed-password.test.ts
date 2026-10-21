import { describe, it, expect } from 'vitest';
import { buildContainer } from '../container';
import { seedDemoData } from '../seed';
import { verifyPassword } from '../utils/crypto';
import { LEGACY_SEED_PASSWORD } from '../services/setup.service';

// F5 (2026-10-22): the demo seed never uses a fixed, known password. It makes a random one and returns it once.
describe('seedDemoData password', () => {
  it('random per seed, 12+ chars, never the old default; every seeded login uses it', async () => {
    const a = await buildContainer(), b = await buildContainer();
    const pa = await seedDemoData(a.repos), pb = await seedDemoData(b.repos);
    expect(pa).toMatch(/^[A-Za-z0-9_-]{12,}$/);
    expect(pa).not.toBe(pb);
    expect(pa).not.toBe(LEGACY_SEED_PASSWORD);
    const admin = await a.repos.users.findByEmail('admin');
    expect(await verifyPassword(pa!, admin!.passwordHash!)).toBe(true);
    expect(await verifyPassword(LEGACY_SEED_PASSWORD, admin!.passwordHash!)).toBe(false);
  }, 20_000);
  it('takes a password for tests, and returns null when users already exist', async () => {
    const c = await buildContainer();
    expect(await seedDemoData(c.repos, 'test-only-pass')).toBe('test-only-pass');
    expect(await seedDemoData(c.repos)).toBeNull();
  }, 20_000);
});
