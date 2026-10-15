import { describe, it, expect } from 'vitest';
import { InMemoryNoticeRepository } from '../repositories/in-memory/in-memory.repositories';
import { makeNoticeService } from '../services/notice.service';
import { can } from '../services/access-control';
import { buildContainer } from '../container';
import type { Actor } from '../core/entities/user';

const A = (role: string, quad: string | null = null): Actor =>
  ({ id: `${role}-${quad}`, role: role as any, displayName: role, grade: null as any, quad: quad as any });
const settings = (notices: 'on' | 'off') => ({ getSettings: async () => ({ ministryConfig: { modules: { notices } } }) }) as any;
const NOW = new Date('2026-10-15T10:00:00Z');

function make(notices: 'on' | 'off' = 'on', now = NOW) {
  const repo = new InMemoryNoticeRepository();
  return { repo, svc: makeNoticeService(repo, settings(notices), () => now) };
}

describe('notice RBAC', () => {
  it('only admin and director may write', () => {
    for (const r of ['admin', 'director']) expect(can(A(r), 'notice:write')).toBe(true);
    for (const r of ['quad', 'grade', 'leader']) expect(can(A(r), 'notice:write')).toBe(false);
  });
});

describe('notice service', () => {
  it('admin and director send; others are refused', async () => {
    const { svc } = make();
    await expect(svc.send(A('admin'), { title: 't', body: 'b', recipients: ['b79'] })).resolves.toMatchObject({ title: 't', recipients: ['b79'] });
    await expect(svc.send(A('director'), { title: 't', body: 'b', recipients: ['g79'] })).resolves.toBeTruthy();
    for (const r of ['quad', 'grade', 'leader']) {
      await expect(svc.send(A(r, 'b79'), { title: 't', body: 'b', recipients: ['b79'] })).rejects.toThrow();
    }
  });

  it('validates input: empty, too long, no recipients, unknown quad', async () => {
    const { svc } = make();
    const ok = { title: 't', body: 'b', recipients: ['b79'] };
    for (const bad of [{ ...ok, title: '' }, { ...ok, body: ' ' }, { ...ok, body: 'x'.repeat(1001) }, { ...ok, title: 'x'.repeat(121) },
      { ...ok, recipients: [] }, { ...ok, recipients: ['juniorguys'] }]) {
      await expect(svc.send(A('admin'), bad)).rejects.toThrow();
    }
    await expect(svc.send(A('admin'), { ...ok, body: 'x'.repeat(1000) })).resolves.toBeTruthy();
  });

  it('quad logins see only notices addressed to their quad; admin/director see all; others none', async () => {
    const { svc } = make();
    await svc.send(A('admin'), { title: 'jg', body: 'b', recipients: ['b79'] });
    await svc.send(A('admin'), { title: 'both', body: 'b', recipients: ['b79', 'g1012'] });
    const titles = async (a: Actor) => (await svc.list(a)).map((n) => n.title).sort();
    expect(await titles(A('quad', 'b79'))).toEqual(['both', 'jg']);
    expect(await titles(A('quad', 'g1012'))).toEqual(['both']);
    expect(await titles(A('quad', 'g79'))).toEqual([]);
    expect(await titles(A('admin'))).toEqual(['both', 'jg']);
    expect(await titles(A('director'))).toEqual(['both', 'jg']);
    expect(await titles(A('grade'))).toEqual([]);
    expect(await titles(A('leader'))).toEqual([]);
  });

  it('lists only the last 30 days', async () => {
    const { repo, svc } = make();
    const mk = (id: string, daysAgo: number) => repo.save({ id, title: id, body: 'b', recipients: ['b79'], senderId: 'a', senderName: 'a',
      createdAt: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString() });
    await mk('new', 1); await mk('edge', 29); await mk('old', 31);
    expect((await svc.list(A('admin'))).map((n) => n.id)).toEqual(['new', 'edge']);
  });

  it('delete: admin/director only, unknown id is 404', async () => {
    const { svc } = make();
    const n = await svc.send(A('admin'), { title: 't', body: 'b', recipients: ['b79'] });
    await expect(svc.remove(A('quad', 'b79'), n.id)).rejects.toThrow();
    await svc.remove(A('director'), n.id);
    expect(await svc.list(A('admin'))).toEqual([]);
    await expect(svc.remove(A('admin'), n.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('module off: every call is 404-shaped and stored notices are kept', async () => {
    const repo = new InMemoryNoticeRepository();
    await makeNoticeService(repo, settings('on'), () => NOW).send(A('admin'), { title: 't', body: 'b', recipients: ['b79'] });
    const off = makeNoticeService(repo, settings('off'), () => NOW);
    await expect(off.list(A('admin'))).rejects.toMatchObject({ code: 'MODULE_DISABLED', statusCode: 404 });
    await expect(off.send(A('admin'), { title: 't', body: 'b', recipients: ['b79'] })).rejects.toMatchObject({ code: 'MODULE_DISABLED' });
    await expect(off.remove(A('admin'), 'x')).rejects.toMatchObject({ code: 'MODULE_DISABLED' });
    expect(await repo.findAll()).toHaveLength(1);
  });
});

describe('container wires notices, default off', () => {
  it('a fresh container answers 404 until modules.notices is on', async () => {
    const { services } = await buildContainer();
    await expect(services.notice.list(A('admin'))).rejects.toMatchObject({ code: 'MODULE_DISABLED' });
  });
});
