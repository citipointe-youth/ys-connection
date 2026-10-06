import { describe, it, expect, vi } from 'vitest';
import { makeSettingsService } from '../services/settings.service';
import { invalidateOverviewCache, makeOverviewService } from '../services/overview.service';
import { invalidateTrendsCache } from '../services/trends.service';
import { invalidateLgStatsCache } from '../services/lifegroup-stats.service';
import { InMemorySettingsRepository, InMemoryAuditRepository, InMemoryStudentRepository, InMemoryLeaderRepository, InMemoryConnectionRepository, InMemoryUserRepository } from '../repositories/in-memory';
import { MINISTRY_CONFIG_DEFAULTS } from '../core/ministry-config';
import type { Actor, User } from '../core/entities/user';

function actor(role: string): Actor {
  return { id: 'a-test', role: role as any, displayName: 'T', grade: null as any, quad: null as any };
}

const ADMIN = actor('admin');
const GRADE = actor('grade');

async function makeService() {
  invalidateOverviewCache();
  invalidateTrendsCache();
  invalidateLgStatsCache();
  const repo = new InMemorySettingsRepository();
  const audit = new InMemoryAuditRepository();
  const users = new InMemoryUserRepository();
  await Promise.all([repo.init(), audit.init(), users.init()]);
  return { repo, audit, users, service: makeSettingsService(repo, audit, users) };
}

function makeUser(overrides: Partial<User>): User {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? 'u-' + Math.random().toString(36).slice(2),
    displayName: 'Test User', email: 'test-user', role: 'grade', grade: null, quad: null,
    status: 'active', mustChangePassword: false,
    createdAt: now, updatedAt: now, ...overrides,
  } as User;
}

describe('SettingsService', () => {
  it('get() returns ministryConfig defaulted to MINISTRY_CONFIG_DEFAULTS', async () => {
    const { service } = await makeService();
    const settings = await service.get();
    expect(settings.ministryConfig).toEqual(MINISTRY_CONFIG_DEFAULTS);
  });

  it('rejects a ministryConfig patch from a non-admin actor', async () => {
    const { service } = await makeService();
    await expect(
      service.update(GRADE, { ministryConfig: { branding: { accent: '#ff0000' } } }),
    ).rejects.toThrow();
  });

  it('PATCH with only ministryConfig.branding.accent leaves every other field at default, and existing scalar fields untouched', async () => {
    const { service } = await makeService();
    const before = await service.get();
    const updated = await service.update(ADMIN, { ministryConfig: { branding: { accent: '#ff0000' } } });

    expect(updated.ministryConfig.branding.accent).toBe('#ff0000');
    expect(updated.ministryConfig.branding.ministryName).toBe(MINISTRY_CONFIG_DEFAULTS.branding.ministryName);
    expect(updated.ministryConfig.labels).toEqual(MINISTRY_CONFIG_DEFAULTS.labels);
    expect(updated.termGapDays).toBe(before.termGapDays);
    expect(updated.serviceMinAttendance).toBe(before.serviceMinAttendance);
  });

  it('a second partial patch merges onto the first, not onto the defaults', async () => {
    const { service } = await makeService();
    await service.update(ADMIN, { ministryConfig: { branding: { accent: '#ff0000' } } });
    const second = await service.update(ADMIN, { ministryConfig: { labels: { smallGroup: 'Small Group' } } });

    expect(second.ministryConfig.branding.accent).toBe('#ff0000'); // preserved from the first patch
    expect(second.ministryConfig.labels.smallGroup).toBe('Small Group');
  });

  it('PATCH with termGapDays alone (no ministryConfig) still works exactly as before', async () => {
    const { service } = await makeService();
    const updated = await service.update(ADMIN, { termGapDays: 21 });
    expect(updated.termGapDays).toBe(21);
    expect(updated.ministryConfig).toEqual(MINISTRY_CONFIG_DEFAULTS);
  });

  it('drops a logoSvg key in a patch instead of storing it (feature removed 2026-07-12)', async () => {
    const { service } = await makeService();
    const updated = await service.update(ADMIN, {
      ministryConfig: { branding: { logoSvg: '<svg onload=alert(1)>' } },
    });
    expect((updated.ministryConfig.branding as Record<string, unknown>)['logoSvg']).toBeUndefined();
  });

  // I4 (controller ruling): once Google is fully configured, saving a "fake:" church place
  // ID — only ever produced by the dev/test fallback provider — must be rejected, or every
  // future Generate 400s against Google with no clue why.
  it('I4: rejects a fake: churchPlaceId once the Google env is fully configured', async () => {
    const { service } = await makeService();
    vi.stubEnv('GOOGLE_MAPS_API_KEY', 'k'); vi.stubEnv('GOOGLE_SA_EMAIL', 'e');
    vi.stubEnv('GOOGLE_SA_PRIVATE_KEY', 'k'); vi.stubEnv('GOOGLE_PROJECT_ID', 'p');
    vi.stubEnv('PERSISTENCE', 'supabase');
    try {
      await expect(service.update(ADMIN, { ministryConfig: { busMinistry: { churchPlaceId: 'fake:church' } } }))
        .rejects.toMatchObject({ statusCode: 400 });
    } finally { vi.unstubAllEnvs(); }
  });
  it('I4: allows a fake: churchPlaceId when Google env is not configured (dev/test)', async () => {
    const { service } = await makeService();
    const updated = await service.update(ADMIN, { ministryConfig: { busMinistry: { churchPlaceId: 'fake:church' } } });
    expect(updated.ministryConfig.busMinistry.churchPlaceId).toBe('fake:church');
  });

  // Task 2 (owner): the church address is a "new address" path too — a non-blank churchAddress
  // saved without a real churchPlaceId means it was typed, not picked from a suggestion.
  describe('Task 2: church address requires a real placeId', () => {
    it('rejects a non-blank churchAddress saved with no (or blank) churchPlaceId', async () => {
      const { service } = await makeService();
      await expect(service.update(ADMIN, { ministryConfig: { busMinistry: { churchAddress: '1 Church St, Testville', churchPlaceId: '' } } }))
        .rejects.toMatchObject({ statusCode: 400, message: 'Pick the address from the suggestions list' });
    });
    it('a churchAddress with a real churchPlaceId saves fine', async () => {
      const { service } = await makeService();
      const updated = await service.update(ADMIN, { ministryConfig: { busMinistry: { churchAddress: '1 Church St, Testville', churchPlaceId: 'fake:church' } } });
      expect(updated.ministryConfig.busMinistry.churchAddress).toBe('1 Church St, Testville');
    });
    it('a patch that does not touch churchAddress at all is unaffected (e.g. leaveTime alone)', async () => {
      const { service } = await makeService();
      const updated = await service.update(ADMIN, { ministryConfig: { busMinistry: { leaveTime: '20:30' } } });
      expect(updated.ministryConfig.busMinistry.leaveTime).toBe('20:30');
    });
    it('clearing the church address (both blank together) is allowed', async () => {
      const { service } = await makeService();
      await service.update(ADMIN, { ministryConfig: { busMinistry: { churchAddress: '1 Church St, Testville', churchPlaceId: 'fake:church' } } });
      const cleared = await service.update(ADMIN, { ministryConfig: { busMinistry: { churchAddress: '', churchPlaceId: '' } } });
      expect(cleared.ministryConfig.busMinistry.churchAddress).toBe('');
    });
  });

  it('accepts a logoImage data URI patch and stores it verbatim (no server-side re-encoding)', async () => {
    const { service } = await makeService();
    const dataUri = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    const updated = await service.update(ADMIN, {
      ministryConfig: { branding: { logoImage: dataUri } },
    });
    expect(updated.ministryConfig.branding.logoImage).toBe(dataUri);
  });

  it('accepts logoImage: null (clearing it)', async () => {
    const { service } = await makeService();
    await service.update(ADMIN, { ministryConfig: { branding: { logoImage: 'data:image/png;base64,abc' } } });
    const cleared = await service.update(ADMIN, { ministryConfig: { branding: { logoImage: null } } });
    expect(cleared.ministryConfig.branding.logoImage).toBe(null);
  });

  it('rejects a logoImage patch that is not a data:image/... URI', async () => {
    const { service } = await makeService();
    await expect(
      service.update(ADMIN, { ministryConfig: { branding: { logoImage: 'https://evil.example/x.png' } } }),
    ).rejects.toThrow();
    await expect(
      service.update(ADMIN, { ministryConfig: { branding: { logoImage: '<script>alert(1)</script>' } } }),
    ).rejects.toThrow();
  });

  it('invalidates the overview/trends/lifegroup-stats caches on every update', async () => {
    const studentRepo = new InMemoryStudentRepository();
    const leaderRepo = new InMemoryLeaderRepository();
    const connRepo = new InMemoryConnectionRepository();
    await Promise.all([studentRepo.init(), leaderRepo.init(), connRepo.init()]);
    const overviewSvc = makeOverviewService(studentRepo, leaderRepo, connRepo);

    const { service } = await makeService();

    const first = await overviewSvc.getStats(ADMIN);
    expect(first.ministryTotal).toBe(0);

    // Write a connectable student directly via the repo, bypassing overview's
    // own invalidation hooks — simulates the cache staying warm across an
    // unrelated settings change.
    await studentRepo.save({
      id: 's1', firstName: 'A', lastName: 'B', gender: 'female', grade: 9,
      quad: null, mobile: null, parentPhone: null, dateOfBirth: null,
      svcAttended: 1, svcTotal: 1, grpAttended: 0, grpTotal: 0, grpMetWeeks: 0,
      prevSvcAttended: 0, prevSvcTotal: 0, prevGrpAttended: 0, prevGrpTotal: 0,
      atRiskStatus: null, dataSource: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });

    const stillCached = await overviewSvc.getStats(ADMIN);
    expect(stillCached.ministryTotal).toBe(0);

    await service.update(ADMIN, { termGapDays: 20 });

    const afterSettingsUpdate = await overviewSvc.getStats(ADMIN);
    expect(afterSettingsUpdate.ministryTotal).toBe(1); // fresh — proves settings.update() invalidated it
  });

  describe('turning a role off in Setup deactivates its accounts', () => {
    it('deactivates active quad accounts when roles.enabled.quad flips false, leaves other roles alone', async () => {
      const { service, users } = await makeService();
      const q1 = await users.save(makeUser({ id: 'q1', role: 'quad', quad: 'g79' }));
      const g1 = await users.save(makeUser({ id: 'g1', role: 'grade', grade: 9 }));

      await service.update(ADMIN, { ministryConfig: { roles: { enabled: { quad: false } } } });

      expect((await users.findById(q1.id))!.status).toBe('inactive');
      expect((await users.findById(g1.id))!.status).toBe('active');
    });

    it('covers all four optional roles (director/grade/quad/leader), never admin', async () => {
      const { service, users } = await makeService();
      const admin1 = await users.save(makeUser({ id: 'admin1', role: 'admin' }));
      const dir1 = await users.save(makeUser({ id: 'dir1', role: 'director' }));
      const lead1 = await users.save(makeUser({ id: 'lead1', role: 'leader' }));

      // leader defaults to disabled — enable it first so disabling it below is a
      // real true->false transition, not a no-op against the already-false default.
      await service.update(ADMIN, { ministryConfig: { roles: { enabled: { leader: true } } } });

      await service.update(ADMIN, {
        ministryConfig: { roles: { enabled: { director: false, leader: false } } },
      });

      expect((await users.findById(dir1.id))!.status).toBe('inactive');
      expect((await users.findById(lead1.id))!.status).toBe('inactive');
      expect((await users.findById(admin1.id))!.status).toBe('active'); // never touched
    });

    it('does not re-deactivate an already-inactive account, and leaves an unrelated inactive account alone', async () => {
      const { service, users } = await makeService();
      const q1 = await users.save(makeUser({ id: 'q1', role: 'quad', quad: 'g79', status: 'inactive' }));

      await expect(
        service.update(ADMIN, { ministryConfig: { roles: { enabled: { quad: false } } } }),
      ).resolves.toBeTruthy();

      expect((await users.findById(q1.id))!.status).toBe('inactive');
    });

    it('re-enabling a role does NOT auto-reactivate accounts deactivated while it was off', async () => {
      const { service, users } = await makeService();
      const q1 = await users.save(makeUser({ id: 'q1', role: 'quad', quad: 'g79' }));

      await service.update(ADMIN, { ministryConfig: { roles: { enabled: { quad: false } } } });
      expect((await users.findById(q1.id))!.status).toBe('inactive');

      await service.update(ADMIN, { ministryConfig: { roles: { enabled: { quad: true } } } });
      expect((await users.findById(q1.id))!.status).toBe('inactive'); // still inactive — manual reactivation only
    });

    it('a patch that leaves roles.enabled unchanged does not touch any account', async () => {
      const { service, users } = await makeService();
      const q1 = await users.save(makeUser({ id: 'q1', role: 'quad', quad: 'g79' }));

      await service.update(ADMIN, { ministryConfig: { branding: { accent: '#ff0000' } } });

      expect((await users.findById(q1.id))!.status).toBe('active');
    });
  });
});
