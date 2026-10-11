import { describe, it, expect } from 'vitest';
import { InMemoryLeaderRepository } from '../repositories/in-memory';
import type { Leader } from '../core/entities/leader';

function leader(id: string, extra: Partial<Leader> = {}): Leader {
  const now = new Date().toISOString();
  return {
    id, fullName: `L ${id}`, gender: 'male', grades: [10], active: true,
    createdByGrade: null, smsTemplate: null, createdAt: now, updatedAt: now, ...extra,
  };
}

async function repoWith(...ls: Leader[]) {
  const repo = new InMemoryLeaderRepository();
  await repo.init();
  for (const l of ls) await repo.save(l);
  return repo;
}

describe('ILeaderRepository.setViewGrades (in-memory; json mode uses the same class)', () => {
  it('sets and resets viewGrades', async () => {
    const repo = await repoWith(leader('a'));
    await repo.setViewGrades('a', [9, 10]);
    expect((await repo.findById('a'))!.viewGrades).toEqual([9, 10]);
    await repo.setViewGrades('a', null);
    expect((await repo.findById('a'))!.viewGrades).toBeNull();
  });

  it('save() and saveMany() of a leader without viewGrades keep the stored value', async () => {
    const repo = await repoWith(leader('a'), leader('b'));
    await repo.setViewGrades('a', [11]);
    await repo.setViewGrades('b', [12]);
    await repo.save(leader('a', { fullName: 'Renamed' }));
    await repo.saveMany([leader('b', { grades: [11] })]);
    const a = (await repo.findById('a'))!;
    const b = (await repo.findById('b'))!;
    expect(a.fullName).toBe('Renamed');
    expect(a.viewGrades).toEqual([11]);
    expect(b.grades).toEqual([11]);
    expect(b.viewGrades).toEqual([12]);
  });

  it('a leader never given a value reads viewGrades as undefined or null', async () => {
    const repo = await repoWith(leader('a'));
    expect((await repo.findById('a'))!.viewGrades ?? null).toBeNull();
  });
});
