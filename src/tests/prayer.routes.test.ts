import { describe, it, expect } from 'vitest';
import { buildContainer } from '../container';
import type { Actor } from '../core/entities/user';

const ADMIN: Actor = { id: 'a', role: 'admin' as any, displayName: 'Admin', grade: null as any, quad: null as any };

describe('container wires the prayer service', () => {
  it('exposes services.prayer with a working list()', async () => {
    const { services } = await buildContainer();
    expect(services.prayer).toBeDefined();
    await expect(services.prayer.list(ADMIN)).resolves.toEqual([]);
  });
});
