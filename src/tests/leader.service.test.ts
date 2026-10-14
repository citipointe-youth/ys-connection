import { describe, it, expect } from 'vitest';
import { makeLeaderService } from '../services/leader.service';
import { InMemoryLeaderRepository } from '../repositories/in-memory';
import type { Actor } from '../core/entities/user';
import { ForbiddenError, BadRequestError } from '../core/errors/app-error';

function actor(role: string, opts: { grade?: number; quad?: string } = {}): Actor {
  return { id: 'a', role: role as any, displayName: 'T', grade: (opts.grade ?? null) as any, quad: (opts.quad ?? null) as any };
}
const ADMIN = actor('admin');
const G79 = actor('quad', { quad: 'g79' }); // Girls Yr 7-9
const B1012 = actor('quad', { quad: 'b1012' }); // Boys Yr 10-12

async function svc() {
  const repo = new InMemoryLeaderRepository();
  await repo.init();
  return makeLeaderService(repo);
}

describe('Leader Service — quad add/edit parity (scoped to gender + bracket)', () => {
  it('quad can create a leader auto-scoped to its gender + bracket', async () => {
    const s = await svc();
    const l = await s.create(G79, { fullName: 'Quad Leader', gender: 'male', grades: [7, 11] });
    expect(l.gender).toBe('female'); // forced to the quad's gender
    expect(l.grades).toEqual([7]); // 11 dropped (out of bracket), 7 kept
  });

  it('quad create defaults grades to the full bracket when none given', async () => {
    const s = await svc();
    const l = await s.create(B1012, { fullName: 'X' });
    expect(l.gender).toBe('male');
    expect([...l.grades].sort((a, b) => a - b)).toEqual([10, 11, 12]);
  });

  it('quad cannot create a leader entirely outside its bracket', async () => {
    const s = await svc();
    await expect(s.create(G79, { fullName: 'X', grades: [10, 12] })).rejects.toBeInstanceOf(BadRequestError);
  });

  it('quad cannot edit a leader outside its scope', async () => {
    const s = await svc();
    const senior = await s.create(ADMIN, { fullName: 'Senior', gender: 'female', grades: [11] });
    await expect(s.update(G79, senior.id, { fullName: 'Nope' })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('quad can edit a leader within its scope', async () => {
    const s = await svc();
    const mine = await s.create(G79, { fullName: 'Mine', grades: [8] });
    const upd = await s.update(G79, mine.id, { fullName: 'Renamed' });
    expect(upd.fullName).toBe('Renamed');
  });

  it('quad cannot delete a leader outside its scope', async () => {
    const s = await svc();
    const senior = await s.create(ADMIN, { fullName: 'Senior', gender: 'male', grades: [12] });
    await expect(s.remove(G79, senior.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('list() scopes a quad to its OWN gender + bracket only', async () => {
    const s = await svc();
    await s.create(ADMIN, { fullName: 'Girl Jr', gender: 'female', grades: [8] });   // visible to G79
    await s.create(ADMIN, { fullName: 'Boy Jr', gender: 'male', grades: [8] });       // wrong gender
    await s.create(ADMIN, { fullName: 'Girl Snr', gender: 'female', grades: [11] });  // wrong bracket
    await s.create(ADMIN, { fullName: 'Any', gender: null, grades: [] });             // all-grades, any gender → visible
    const visible = (await s.list(G79)).map((l) => l.fullName).sort();
    expect(visible).toEqual(['Any', 'Girl Jr']);
  });
});

describe('Leader Service — updateGrades (self-service grade broadening)', () => {
  it('a grade login can broaden grades on a leader it did NOT create (no ownership check)', async () => {
    const s = await svc();
    const GRADE9 = actor('grade', { grade: 9 });
    const leader = await s.create(ADMIN, { fullName: 'Auto-imported Leader', gender: 'male', grades: [9] });
    const updated = await s.updateGrades(GRADE9, leader.id, [9, 10, 11]);
    expect([...updated.grades].sort((a, b) => a - b)).toEqual([9, 10, 11]);
  });

  it('a quad login can broaden grades outside its own bracket', async () => {
    const s = await svc();
    const leader = await s.create(G79, { fullName: 'Girls Leader', grades: [8] });
    const updated = await s.updateGrades(G79, leader.id, [8, 11, 12]);
    expect([...updated.grades].sort((a, b) => a - b)).toEqual([8, 11, 12]);
  });

  it('never changes gender, regardless of what broadened the grades', async () => {
    const s = await svc();
    const leader = await s.create(ADMIN, { fullName: 'Locked Gender', gender: 'female', grades: [7] });
    const updated = await s.updateGrades(B1012, leader.id, [7, 12]);
    expect(updated.gender).toBe('female');
  });

  it('rejects an out-of-range grade', async () => {
    const s = await svc();
    const leader = await s.create(ADMIN, { fullName: 'X', grades: [9] });
    await expect(s.updateGrades(ADMIN, leader.id, [6])).rejects.toBeInstanceOf(Error);
  });
});

describe('Leader Service — setViewGrades (quad grade filter)', async () => {
  const { InMemorySettingsRepository } = await import('../repositories/in-memory');
  const { mergeMinistryConfig } = await import('../core/ministry-config');
  const { NotFoundError } = await import('../core/errors/app-error');

  async function setup(opts: { gradeMin?: number } = {}) {
    const repo = new InMemoryLeaderRepository();
    await repo.init();
    const settings = new InMemorySettingsRepository();
    await settings.init();
    if (opts.gradeMin !== undefined) {
      const cur = await settings.getSettings();
      await settings.updateSettings({
        ministryConfig: mergeMinistryConfig(cur.ministryConfig, { structure: { gradeMin: opts.gradeMin } }),
      });
    }
    const s = makeLeaderService(repo, settings);
    const l = await s.create(ADMIN, { fullName: 'Cody', gender: 'female', grades: [8] });
    return { s, repo, l };
  }

  it('quad g79 sets [9,7] on any leader -> saved sorted; [10] -> 400 (outside bracket)', async () => {
    const { s, l } = await setup();
    const saved = await s.setViewGrades(G79, l.id, { grades: [9, 7, 9] });
    expect(saved.viewGrades).toEqual([7, 9]);
    await expect(s.setViewGrades(G79, l.id, { grades: [10] })).rejects.toBeInstanceOf(BadRequestError);
  });

  it('admin [6] -> 400 with gradeMin 7; ok with Include Grade 6', async () => {
    const a = await setup();
    await expect(a.s.setViewGrades(ADMIN, a.l.id, { grades: [6] })).rejects.toBeInstanceOf(BadRequestError);
    const b = await setup({ gradeMin: 6 });
    expect((await b.s.setViewGrades(ADMIN, b.l.id, { grades: [6] })).viewGrades).toEqual([6]);
  });

  it('null resets to "my grades"; [] -> 400', async () => {
    const { s, l } = await setup();
    await s.setViewGrades(ADMIN, l.id, { grades: [9] });
    expect((await s.setViewGrades(ADMIN, l.id, { grades: null })).viewGrades).toBeNull();
    await expect(s.setViewGrades(ADMIN, l.id, { grades: [] })).rejects.toBeInstanceOf(BadRequestError);
  });

  it('leader role: own id ok, another id 403; grade role 403', async () => {
    const { s, l } = await setup();
    const own: Actor = { ...actor('leader'), leaderId: l.id } as Actor;
    const other: Actor = { ...actor('leader'), leaderId: 'someone-else' } as Actor;
    expect((await s.setViewGrades(own, l.id, { grades: [8] })).viewGrades).toEqual([8]);
    await expect(s.setViewGrades(other, l.id, { grades: [8] })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(s.setViewGrades(actor('grade', { grade: 8 }), l.id, { grades: [8] })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('unknown leader id -> 404', async () => {
    const { s } = await setup();
    await expect(s.setViewGrades(ADMIN, 'nope', { grades: [8] })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('works without a settings repo (defaults to grades 7-12)', async () => {
    const repo = new InMemoryLeaderRepository();
    await repo.init();
    const s = makeLeaderService(repo);
    const l = await s.create(ADMIN, { fullName: 'X', grades: [8] });
    expect((await s.setViewGrades(ADMIN, l.id, { grades: [12] })).viewGrades).toEqual([12]);
    await expect(s.setViewGrades(ADMIN, l.id, { grades: [6] })).rejects.toBeInstanceOf(BadRequestError);
  });

  it('updateSmsTemplate, updateGrades and an import-style saveMany leave viewGrades unchanged', async () => {
    const { s, repo, l } = await setup();
    await s.setViewGrades(ADMIN, l.id, { grades: [9] });
    await s.updateSmsTemplate(ADMIN, l.id, 'Hi <first name>');
    await s.updateGrades(ADMIN, l.id, [8, 9]);
    const cur = (await repo.findById(l.id))!;
    const { viewGrades: _drop, ...imported } = cur;
    await repo.saveMany([{ ...imported, fullName: 'Cody Cobb' }]);
    const after = (await repo.findById(l.id))!;
    expect(after.fullName).toBe('Cody Cobb');
    expect(after.viewGrades).toEqual([9]);
  });
});

describe('Leader Service — inactive list (Setup "Inactive leaders")', () => {
  it('list(actor, {inactive:true}) returns only inactive leaders, with the same role scoping', async () => {
    const s = await svc();
    const a = await s.create(ADMIN, { fullName: 'Gone Girl', gender: 'female', grades: [8] });
    const b = await s.create(ADMIN, { fullName: 'Gone Boy', gender: 'male', grades: [11] });
    await s.create(ADMIN, { fullName: 'Still Here', gender: 'female', grades: [8] });
    await s.update(ADMIN, a.id, { active: false });
    await s.update(ADMIN, b.id, { active: false });
    expect((await s.list(ADMIN, { inactive: true })).map((l) => l.fullName).sort()).toEqual(['Gone Boy', 'Gone Girl']);
    expect((await s.list(G79, { inactive: true })).map((l) => l.fullName)).toEqual(['Gone Girl']);
    expect((await s.list(G79)).map((l) => l.fullName)).toEqual(['Still Here']);
  });
  it('a junior leader login (no Setup screen) cannot read the inactive list', async () => {
    const s = await svc();
    await expect(s.list(actor('leader'), { inactive: true })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
