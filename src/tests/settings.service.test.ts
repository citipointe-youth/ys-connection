import { describe, it, expect, vi } from 'vitest';
import { makeSettingsService } from '../services/settings.service';
import { invalidateOverviewCache, makeOverviewService } from '../services/overview.service';
import { invalidateTrendsCache } from '../services/trends.service';
import { invalidateLgStatsCache } from '../services/lifegroup-stats.service';
import { InMemorySettingsRepository, InMemoryAuditRepository, InMemoryStudentRepository, InMemoryLeaderRepository, InMemoryConnectionRepository, InMemoryUserRepository } from '../repositories/in-memory';
import { MINISTRY_CONFIG_DEFAULTS } from '../core/ministry-config';
import type { Actor, User } from '../core/entities/user';
import { brisbaneElvanto } from './helpers/brisbane-elvanto';

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

describe('SettingsService — Simple (Junior/Senior) logins', () => {
  const ON = { ministryConfig: { logins: { simple: true } } };
  const OFF = { ministryConfig: { logins: { simple: false } } };
  const MSG = 'Pick a Login style in Youth Setup: Junior/Senior, or Director and leaders.';

  async function fixture() {
    const f = await makeService();
    const { users } = f;
    await users.save(makeUser({ id: 'g7', email: 'grade7g', role: 'grade', grade: 7 }));
    await users.save(makeUser({ id: 'g8', email: 'grade8b', role: 'grade', grade: 8 }));
    await users.save(makeUser({ id: 'g9', email: 'grade9g', role: 'grade', grade: 9, status: 'inactive', updatedAt: 'old' }));
    await users.save(makeUser({ id: 'q1', email: 'girls-junior', role: 'quad', quad: 'g79', displayName: 'Girls Yr 7–9' }));
    await users.save(makeUser({ id: 'q2', email: 'b79', role: 'quad', quad: 'b79', displayName: 'Boys Yr 7–9' }));
    await users.save(makeUser({ id: 'q3', email: 'g1012', role: 'quad', quad: 'g1012', displayName: 'Girls Yr 10–12' }));
    await users.save(makeUser({ id: 'q4', email: 'b1012', role: 'quad', quad: 'b1012', displayName: 'Boys Yr 10–12' }));
    return f;
  }
  const status = async (users: InMemoryUserRepository, id: string) => (await users.findById(id))!.status;

  it('on: one settings write carries simple, the active grade ids, gradeRoleWasOn and Grade off; then exactly those are retired', async () => {
    const { service, repo, users } = await fixture();
    const spy = vi.spyOn(repo, 'updateSettings');
    await service.update(ADMIN, ON);
    expect(spy).toHaveBeenCalledTimes(1);
    const written = spy.mock.calls[0]![0].ministryConfig!;
    expect(written.logins.simple).toBe(true);
    expect([...written.logins.retiredGradeIds].sort()).toEqual(['g7', 'g8']);
    expect(written.logins.gradeRoleWasOn).toBe(true);
    expect(written.roles.enabled.grade).toBe(false);
    expect(await status(users, 'g7')).toBe('inactive');
    expect(await status(users, 'g8')).toBe('inactive');
    expect((await users.findById('g9'))!.updatedAt).toBe('old');
  });

  it('on with Grade already off: a left-behind active grade account is retired; gradeRoleWasOn false', async () => {
    const { service, repo, users } = await makeService();
    await service.update(ADMIN, { ministryConfig: { roles: { enabled: { grade: false } } } });
    await users.save(makeUser({ id: 'left', role: 'grade', grade: 10 }));
    await service.update(ADMIN, ON);
    const cfg = (await repo.getSettings()).ministryConfig;
    expect(cfg.logins.retiredGradeIds).toEqual(['left']);
    expect(cfg.logins.gradeRoleWasOn).toBe(false);
    expect(await status(users, 'left')).toBe('inactive');
  });

  it('on: quads are renamed by the quad field, not the username, and the count is returned', async () => {
    const { service, users } = await fixture();
    const r = await service.update(ADMIN, ON);
    expect((await users.findById('q1'))!.displayName).toBe('Junior Girls');
    expect((await users.findById('q4'))!.displayName).toBe('Senior Guys');
    expect(r.renamedQuads).toBe(4);
  });

  it('server-owned: patches cannot clear, plant or flip retiredGradeIds / gradeRoleWasOn while on', async () => {
    const { service, repo } = await fixture();
    await service.update(ADMIN, ON);
    const stored = (await repo.getSettings()).ministryConfig.logins;
    for (const logins of [{ retiredGradeIds: [] }, { retiredGradeIds: ['foreign'] }, { gradeRoleWasOn: false }]) {
      await service.update(ADMIN, { ministryConfig: { logins } });
      expect((await repo.getSettings()).ministryConfig.logins).toEqual(stored);
    }
  });

  it('off: restores only listed ids that are still inactive grade users; Grade restored; list cleared in one write; quads keep their Junior/Senior names', async () => {
    const { service, repo, users } = await fixture();
    await users.save(makeUser({ id: 'g10', role: 'grade', grade: 10 }));
    await users.save(makeUser({ id: 'g11', role: 'grade', grade: 11 }));
    await users.save(makeUser({ id: 'g12', role: 'grade', grade: 12 }));
    await service.update(ADMIN, ON);
    // g10 becomes a quad, g11 is deleted, g12 is unlocked by hand (already active).
    const g10 = (await users.findById('g10'))!;
    await users.save({ ...g10, role: 'quad', quad: 'g79' });
    await users.delete('g11');
    const g12 = (await users.findById('g12'))!;
    await users.save({ ...g12, status: 'active', updatedAt: 'by-hand' });

    const spy = vi.spyOn(repo, 'updateSettings');
    await service.update(ADMIN, OFF);
    expect(spy).toHaveBeenCalledTimes(1);
    const written = spy.mock.calls[0]![0].ministryConfig!;
    expect(written.logins.simple).toBe(false);
    expect(written.logins.retiredGradeIds).toEqual([]);
    expect(written.roles.enabled.grade).toBe(true);

    expect(await status(users, 'g7')).toBe('active');
    expect(await status(users, 'g8')).toBe('active');
    expect(await status(users, 'g9')).toBe('inactive');
    expect(await status(users, 'g10')).toBe('inactive');
    expect((await users.findById('g12'))!.updatedAt).toBe('by-hand');
    expect((await users.findById('q1'))!.displayName).toBe('Junior Girls');
    expect((await users.findById('q4'))!.displayName).toBe('Senior Guys');
  });

  it('off restores Grade from gradeRoleWasOn (false stays false)', async () => {
    const { service, repo } = await makeService();
    await service.update(ADMIN, { ministryConfig: { roles: { enabled: { grade: false } } } });
    await service.update(ADMIN, ON);
    await service.update(ADMIN, OFF);
    expect((await repo.getSettings()).ministryConfig.roles.enabled.grade).toBe(false);
  });

  it('rule (Login style): a cohort model and Quad role that do not pair, while on or when turning on, is 400', async () => {
    const { service } = await fixture();
    await expect(service.update(ADMIN, { ministryConfig: { logins: { simple: true }, structure: { cohortModel: 'none' } } }))
      .rejects.toMatchObject({ statusCode: 400, message: MSG });
    await expect(service.update(ADMIN, { ministryConfig: { logins: { simple: true }, roles: { enabled: { quad: false } } } }))
      .rejects.toMatchObject({ statusCode: 400, message: MSG });
    await service.update(ADMIN, ON);
    await expect(service.update(ADMIN, { ministryConfig: { structure: { cohortModel: 'none' } } }))
      .rejects.toMatchObject({ statusCode: 400, message: MSG });
    await expect(service.update(ADMIN, { ministryConfig: { roles: { enabled: { quad: false } } } }))
      .rejects.toMatchObject({ statusCode: 400, message: MSG });
  });

  it('Grade is forced off while on', async () => {
    const { service, repo } = await fixture();
    await service.update(ADMIN, ON);
    await service.update(ADMIN, { ministryConfig: { roles: { enabled: { grade: true } } } });
    expect((await repo.getSettings()).ministryConfig.roles.enabled.grade).toBe(false);
  });

  it('a save that does not flip Simple logins renames nothing and returns no count', async () => {
    const { service, users } = await fixture();
    const r = await service.update(ADMIN, { ministryConfig: { branding: { accent: '#ff0000' } } });
    expect(r.renamedQuads).toBeUndefined();
    expect((await users.findById('q1'))!.displayName).toBe('Girls Yr 7–9');
  });
  // T13 (2026-10-12): grade 6 joins the junior quads, so Include Grade 6 no longer blocks Simple logins.
  it('T13: turning Simple on with Include Grade 6 is allowed', async () => {
    const { service, repo, users } = await fixture();
    await service.update(ADMIN, { ministryConfig: { structure: { gradeMin: 6 } } });
    await service.update(ADMIN, ON);
    expect((await repo.getSettings()).ministryConfig.logins.simple).toBe(true);
    expect(await status(users, 'g7')).toBe('inactive');
  });

  it('T13: turning Include Grade 6 on while Simple is on is allowed', async () => {
    const { service, repo } = await fixture();
    await service.update(ADMIN, ON);
    await service.update(ADMIN, { ministryConfig: { structure: { gradeMin: 6 } } });
    expect((await repo.getSettings()).ministryConfig.structure.gradeMin).toBe(6);
  });

  // T1: a stale draft must not flip Simple logins / Prayers.
  it('T1: a colour-only save (no logins/prayers in the patch) keeps Simple logins on', async () => {
    const { service, repo, users } = await fixture();
    await service.update(ADMIN, ON);
    await service.update(ADMIN, { ministryConfig: { branding: { accent: '#ff0000' } } });
    expect((await repo.getSettings()).ministryConfig.logins.simple).toBe(true);
    expect(await status(users, 'g7')).toBe('inactive');
  });

  it('T1: a flip whose expect does not match the stored value is 409 SETTINGS_CHANGED and touches nothing', async () => {
    const { service, repo, users } = await fixture();
    await service.update(ADMIN, ON);
    const spy = vi.spyOn(repo, 'updateSettings');
    await expect(service.update(ADMIN, { ministryConfig: { logins: { simple: true } }, expect: { simple: true } })).resolves.toBeDefined();
    spy.mockClear();
    // A stale tab still thinks Simple is off and "turns it on" again — fine; but a stale OFF:
    await expect(service.update(ADMIN, { ministryConfig: { logins: { simple: false } }, expect: { simple: false } }))
      .rejects.toMatchObject({ statusCode: 409, code: 'SETTINGS_CHANGED', message: 'Someone else changed this. Reload Youth Setup.' });
    expect(spy).not.toHaveBeenCalled();
    expect(await status(users, 'g7')).toBe('inactive');
  });

  it('T1: a stale Prayers flip is 409; a matching expect saves', async () => {
    const { service, repo } = await fixture();
    await service.update(ADMIN, { ministryConfig: { modules: { prayers: false } }, expect: { prayers: true } });
    expect((await repo.getSettings()).ministryConfig.modules.prayers).toBe(false);
    await expect(service.update(ADMIN, { ministryConfig: { modules: { prayers: false } }, expect: { prayers: true } }))
      .rejects.toMatchObject({ statusCode: 409, code: 'SETTINGS_CHANGED' });
  });

  // T2: the flip converges, so a re-save repairs a half-applied one.
  function failNthSave(users: InMemoryUserRepository, n: number) {
    const real = users.save.bind(users);
    let calls = 0;
    return vi.spyOn(users, 'save').mockImplementation(async (u) => {
      calls++;
      if (calls === n) throw new Error('EMAXCONNSESSION');
      return real(u);
    });
  }

  it('T2: on, a save failing mid-retire; a second save retires the rest and renames the quads', async () => {
    const { service, repo, users } = await fixture();
    const spy = failNthSave(users, 2);
    await expect(service.update(ADMIN, ON)).rejects.toThrow('EMAXCONNSESSION');
    spy.mockRestore();
    const after1 = [await status(users, 'g7'), await status(users, 'g8')];
    expect(after1).toContain('active'); // half-applied
    await service.update(ADMIN, { ministryConfig: { branding: { accent: '#00ff00' } } });
    expect(await status(users, 'g7')).toBe('inactive');
    expect(await status(users, 'g8')).toBe('inactive');
    expect([...(await repo.getSettings()).ministryConfig.logins.retiredGradeIds].sort()).toEqual(['g7', 'g8']);
    expect((await users.findById('q1'))!.displayName).toBe('Junior Girls');
  });

  it('T2: off, a restore failing mid-loop keeps the list; a second OFF save restores the rest', async () => {
    const { service, repo, users } = await fixture();
    await service.update(ADMIN, ON);
    const spy = failNthSave(users, 2);
    await expect(service.update(ADMIN, OFF)).rejects.toThrow('EMAXCONNSESSION');
    spy.mockRestore();
    expect([...(await repo.getSettings()).ministryConfig.logins.retiredGradeIds].sort()).toEqual(['g7', 'g8']);
    await service.update(ADMIN, OFF);
    const cfg = (await repo.getSettings()).ministryConfig;
    expect(cfg.logins.simple).toBe(false);
    expect(cfg.logins.retiredGradeIds).toEqual([]);
    expect(await status(users, 'g7')).toBe('active');
    expect(await status(users, 'g8')).toBe('active');
  });

  it('T2: the stats caches are cleared even when the retire loop fails', async () => {
    const studentRepo = new InMemoryStudentRepository();
    const leaderRepo = new InMemoryLeaderRepository();
    const connRepo = new InMemoryConnectionRepository();
    await Promise.all([studentRepo.init(), leaderRepo.init(), connRepo.init()]);
    const overviewSvc = makeOverviewService(studentRepo, leaderRepo, connRepo);
    const { service, users } = await fixture();
    expect((await overviewSvc.getStats(ADMIN)).ministryTotal).toBe(0);
    await studentRepo.save({
      id: 's1', firstName: 'A', lastName: 'B', gender: 'female', grade: 9,
      quad: null, mobile: null, parentPhone: null, dateOfBirth: null,
      svcAttended: 1, svcTotal: 1, grpAttended: 0, grpTotal: 0, grpMetWeeks: 0,
      prevSvcAttended: 0, prevSvcTotal: 0, prevGrpAttended: 0, prevGrpTotal: 0,
      atRiskStatus: null, dataSource: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    const spy = failNthSave(users, 1);
    await expect(service.update(ADMIN, ON)).rejects.toThrow();
    spy.mockRestore();
    expect((await overviewSvc.getStats(ADMIN)).ministryTotal).toBe(1);
  });
});

describe('T10 link module keys through PATCH /settings (the settings file is a GET + PATCH round trip)', () => {
  it('saves each key on its own and a downloaded ministryConfig loads back unchanged', async () => {
    const { service } = await makeService();
    await service.update(ADMIN, { ministryConfig: { elvanto: brisbaneElvanto(), modules: { newYouthForms: 'admin', checkin: 'on', lifegroupReport: 'off', flows: 'admin' } } });
    const file = JSON.parse(JSON.stringify((await service.get()).ministryConfig));
    expect([file.modules.checkin, file.modules.lifegroupReport, file.modules.flows]).toEqual(['on', 'off', 'admin']);
    const fresh = await makeService();
    await fresh.service.update(ADMIN, { ministryConfig: file });
    expect((await fresh.service.get()).ministryConfig.modules).toMatchObject({ newYouthForms: 'admin', checkin: 'on', lifegroupReport: 'off', flows: 'admin' });
    await expect(service.update(ADMIN, { ministryConfig: { modules: { flows: 'sometimes' } } })).rejects.toBeTruthy();
  });
});

describe('Y1b: New person needs this location\'s Elvanto forms before it is turned on', () => {
  const MSG = 'Fill in Elvanto for this location. Then select Check forms.';
  it('PATCH refuses off -> on while incomplete', async () => {
    const { service } = await makeService();
    for (const mode of ['admin', 'on']) {
      const err: any = await service.update(ADMIN, { ministryConfig: { modules: { newYouthForms: mode } } }).catch((e) => e);
      expect(err.statusCode).toBe(400);
      expect(err.message).toBe(MSG);
    }
    expect((await service.get()).ministryConfig.modules.newYouthForms).toBe('off');
    // half filled is still incomplete
    const { host: _h, ...fields } = brisbaneElvanto().fields;
    const half: any = await service.update(ADMIN, { ministryConfig: { elvanto: { ...brisbaneElvanto(), fields }, modules: { newYouthForms: 'on' } } }).catch((e) => e);
    expect(half.message).toBe(MSG);
  });
  it('PATCH accepts off -> on when the same save fills Elvanto', async () => {
    const { service } = await makeService();
    const s = await service.update(ADMIN, { ministryConfig: { elvanto: brisbaneElvanto(), modules: { newYouthForms: 'on' } } });
    expect(s.ministryConfig.modules.newYouthForms).toBe('on');
  });
  it('PATCH accepts an unrelated save while incomplete', async () => {
    const { repo, service } = await makeService();
    const cur = (await repo.getSettings()).ministryConfig; // New person already on, Elvanto blank (e.g. after a rollback)
    await repo.updateSettings({ ministryConfig: { ...cur, modules: { ...cur.modules, newYouthForms: 'on' } } } as any);
    const s = await service.update(ADMIN, { ministryConfig: { structure: { serviceDayOfWeek: 4 } } });
    expect(s.ministryConfig.structure.serviceDayOfWeek).toBe(4);
    expect(s.ministryConfig.modules.newYouthForms).toBe('on');
    const off = await service.update(ADMIN, { ministryConfig: { modules: { newYouthForms: 'off' } } }); // turning it off is never refused
    expect(off.ministryConfig.modules.newYouthForms).toBe('off');
  });
});

describe('bus consent check stamps are push-only (fix round 1)', () => {
  it('PATCH /settings ignores busMinistry.consentLastChecked / consentLastNew and keeps the stored values; other bus keys still save', async () => {
    const { repo, service } = await makeService();
    const cur = (await repo.getSettings()).ministryConfig;
    await repo.updateSettings({ ministryConfig: { ...cur, busMinistry: { ...cur.busMinistry, consentLastChecked: '2026-10-23T04:00:20.000Z', consentLastNew: 3 } } });
    await service.update(ADMIN, { ministryConfig: { busMinistry: { consentLastChecked: '2026-01-01T00:00:00.000Z', consentLastNew: 0, leaveTime: '20:30' } } });
    const b = (await repo.getSettings()).ministryConfig.busMinistry;
    expect([b.consentLastChecked, b.consentLastNew, b.leaveTime]).toEqual(['2026-10-23T04:00:20.000Z', 3, '20:30']);
  });
});
