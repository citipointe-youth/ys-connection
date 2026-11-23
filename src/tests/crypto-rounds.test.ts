import { describe, it, expect, vi } from 'vitest';

describe('bcrypt rounds', () => {
  it('uses 12 rounds when VITEST is unset', async () => {
    vi.stubEnv('VITEST', '');
    vi.resetModules();
    const { hashPassword } = await import('../utils/crypto');
    expect(await hashPassword('x')).toMatch(/^\$2[ab]\$12\$/);
    vi.unstubAllEnvs();
  });
});
