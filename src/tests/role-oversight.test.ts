// Oversight rename (director -> oversight), server side.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { USER_ROLES } from '../core/types/enums';
import { can, type Action } from '../services/access-control';
import { MinistryConfigSchema } from '../core/ministry-config';
import { makeSettingsService } from '../services/settings.service';
import { InMemorySettingsRepository, InMemoryAuditRepository, InMemoryUserRepository } from '../repositories/in-memory';
import type { Actor, User } from '../core/entities/user';

// Snapshot of the director permission set from `git show eb41ada:src/services/access-control.ts`.
const DIRECTOR_ACTIONS: Action[] = [
  'student:read', 'student:read:sensitive', 'student:write', 'leader:read', 'leader:write', 'connection:write',
  'overview:read', 'atrisk:read', 'import:run', 'prayer:read', 'prayer:write', 'notice:write', 'notice:alerts',
  'bus:use', 'bus:roster', 'bus:coordinate', 'bus:analysis', 'intake:write', 'link:use', 'link:flowRemove',
];
const ALL_ACTIONS: Action[] = [
  ...DIRECTOR_ACTIONS, 'connection:import', 'admin:manage', 'prayer:import', 'link:admin', 'intake:admin',
];

const actor = (role: string): Actor => ({ id: 'a-test', role: role as any, displayName: 'T', grade: null as any, quad: null as any });

describe('oversight role', () => {
  it('USER_ROLES has oversight, not director', () => {
    expect(USER_ROLES).toContain('oversight');
    expect(USER_ROLES).not.toContain('director' as any);
  });

  it('oversight can exactly what director could, for every action', () => {
    for (const a of ALL_ACTIONS) expect(can(actor('oversight'), a), a).toBe(DIRECTOR_ACTIONS.includes(a));
    expect(can(actor('director'), 'student:read')).toBe(false);
  });

  it('MinistryConfigSchema reads a legacy roles.enabled.director as oversight', () => {
    const legacy = MinistryConfigSchema.parse({ roles: { enabled: { director: false } } });
    expect(legacy.roles.enabled.oversight).toBe(false);
    expect('director' in legacy.roles.enabled).toBe(false);
    const both = MinistryConfigSchema.parse({ roles: { enabled: { director: false, oversight: true } } });
    expect(both.roles.enabled.oversight).toBe(true);
    expect('director' in both.roles.enabled).toBe(false);
    expect(MinistryConfigSchema.parse({}).roles.enabled.oversight).toBe(true);
  });

  it('turning roles.enabled.oversight off deactivates oversight accounts, not quad ones', async () => {
    const repo = new InMemorySettingsRepository();
    const users = new InMemoryUserRepository();
    await Promise.all([repo.init(), new InMemoryAuditRepository().init(), users.init()]);
    const service = makeSettingsService(repo, new InMemoryAuditRepository(), users);
    const now = new Date().toISOString();
    const mk = (id: string, role: string, extra: Partial<User> = {}) => users.save({
      id, displayName: id, email: id, role, grade: null, quad: null, status: 'active', mustChangePassword: false,
      createdAt: now, updatedAt: now, ...extra,
    } as User);
    const ov = await mk('ov1', 'oversight');
    const quad = await mk('q1', 'quad', { quad: 'g79' });
    await service.update(actor('admin'), { ministryConfig: { roles: { enabled: { oversight: false } } } });
    expect((await users.findById(ov.id))!.status).toBe('inactive');
    expect((await users.findById(quad.id))!.status).toBe('active');
  });

  it('no src file outside tests says director, except the legacy config key', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) { if (f !== 'tests') walk(p); continue; }
        if (!p.endsWith('.ts')) continue;
        readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
          if (/\bdirector\b/i.test(line) && !(p.endsWith('ministry-config.ts') && line.includes('// legacy key'))) hits.push(`${p}:${i + 1}`);
        });
      }
    };
    walk(join(__dirname, '..'));
    expect(hits).toEqual([]);
  });
});
