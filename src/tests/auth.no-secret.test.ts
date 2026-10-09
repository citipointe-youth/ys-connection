import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('auth without SESSION_SECRET in production', () => {
  const saved = { ...process.env };
  beforeEach(() => { vi.resetModules(); process.env['NODE_ENV'] = 'production'; delete process.env['SESSION_SECRET']; });
  afterEach(() => { process.env = { ...saved }; });

  it('the module loads (no throw at import)', async () => {
    await expect(import('../services/auth.service')).resolves.toBeDefined();
  });
  it('sessionSecretConfigured() is false; resolveToken returns null; issuing a token throws a clear error', async () => {
    const { makeAuthService, sessionSecretConfigured } = await import('../services/auth.service');
    const { InMemoryUserRepository } = await import('../repositories/in-memory/in-memory.repositories');
    const auth = makeAuthService(new InMemoryUserRepository());
    expect(sessionSecretConfigured()).toBe(false);
    expect(await auth.resolveToken('abc.def')).toBeNull();
    await expect(auth.login({ email: 'admin', password: 'whatever1' })).rejects.toThrow(/SESSION_SECRET/);
  });
  it('a 32+ char secret is configured', async () => {
    process.env['SESSION_SECRET'] = 'x'.repeat(32);
    const { sessionSecretConfigured } = await import('../services/auth.service');
    expect(sessionSecretConfigured()).toBe(true);
  });
  it('VERCEL_ENV=preview or VERCEL=1 with no secret is NOT configured, even without NODE_ENV', async () => {
    const { sessionSecretConfigured } = await import('../services/auth.service');
    expect(sessionSecretConfigured({ VERCEL_ENV: 'preview' })).toBe(false);
    expect(sessionSecretConfigured({ VERCEL: '1' })).toBe(false);
    expect(sessionSecretConfigured({ VERCEL_ENV: 'production', SESSION_SECRET: 'cms-dev-secret-change-in-production' })).toBe(false);
    expect(sessionSecretConfigured({ VERCEL_ENV: 'preview', SESSION_SECRET: 'x'.repeat(32) })).toBe(true);
  });
  it('a local run with nothing set is configured (dev fallback)', async () => {
    const { sessionSecretConfigured } = await import('../services/auth.service');
    expect(sessionSecretConfigured({})).toBe(true);
  });
});
