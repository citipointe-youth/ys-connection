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
