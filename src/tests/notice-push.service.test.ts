// Notice alerts (web push): subscribe/unsubscribe, RBAC, module gate, recipient selection, 404/410 cleanup. Sender is mocked.
import { describe, it, expect } from 'vitest';
import { InMemoryNoticePushRepository, InMemoryNoticeRepository } from '../repositories/in-memory/in-memory.repositories';
import { makeNoticeService, pushPayload, type PushSender } from '../services/notice.service';
import type { Actor } from '../core/entities/user';

const A = (role: string, quad: string | null = null): Actor =>
  ({ id: `${role}-${quad}`, role: role as any, displayName: role, grade: null as any, quad: quad as any });
const U = (a: Actor, status = 'active') => ({ id: a.id, role: a.role, quad: a.quad, status });
const VAPID = { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:x@example.com' };
const NOW = new Date('2026-10-15T10:00:00Z');
const sub = (n: string) => ({ endpoint: `https://push.example.com/${n}`, keys: { p256dh: 'p', auth: 'a' } });

const ADMIN = A('admin'), DIR = A('director'), JG = A('quad', 'b79'), SG = A('quad', 'b1012'), GR = A('grade'), LD = A('leader');

function make(o: { notices?: 'on' | 'off'; env?: Record<string, string>; sender?: PushSender; users?: any[] } = {}) {
  const subs = new InMemoryNoticePushRepository();
  const sent: string[] = [];
  const logged: any[] = [];
  const settingsRepo = { getSettings: async () => ({ ministryConfig: { modules: { notices: o.notices ?? 'on' } } }) } as any;
  const users = o.users ?? [ADMIN, DIR, JG, SG, GR, LD].map((a) => U(a));
  const sender: PushSender = o.sender ?? (async (s, p) => { sent.push(s.endpoint); expect(JSON.parse(p).title).toBe('New notice'); });
  const svc = makeNoticeService(new InMemoryNoticeRepository(), settingsRepo, () => NOW, {
    subs, users: { findAll: async () => users as any }, sender, env: o.env ?? VAPID,
    errorLog: { record: async (r) => { logged.push(r); } },
  });
  return { svc, subs, sent, logged };
}

describe('notice push: subscribe / unsubscribe / RBAC / module', () => {
  it('quad, admin and director may subscribe; grade and leader are refused', async () => {
    const { svc, subs } = make();
    for (const [a, n] of [[ADMIN, 'a'], [DIR, 'd'], [JG, 'j']] as const) await expect(svc.subscribe(a, sub(n))).resolves.toEqual({ ok: true });
    for (const a of [GR, LD]) await expect(svc.subscribe(a, sub('x'))).rejects.toThrow();
    expect((await subs.findAll()).length).toBe(3);
  });
  it('validates the subscription body', async () => {
    const { svc } = make();
    for (const bad of [{}, { endpoint: 'http://insecure/1', keys: { p256dh: 'p', auth: 'a' } }, { endpoint: 'https://x/1', keys: { p256dh: '', auth: 'a' } }])
      await expect(svc.subscribe(JG, bad)).rejects.toThrow();
  });
  it('re-subscribing the same device upserts and moves it to the new login', async () => {
    const { svc, subs } = make();
    await svc.subscribe(JG, sub('1'));
    await svc.subscribe(SG, sub('1'));
    const all = await subs.findAll();
    expect(all.length).toBe(1);
    expect(all[0]!.userId).toBe(SG.id);
  });
  it('unsubscribe removes only your own device', async () => {
    const { svc, subs } = make();
    await svc.subscribe(JG, sub('1'));
    await svc.unsubscribe(SG, { endpoint: sub('1').endpoint });
    expect((await subs.findAll()).length).toBe(1);
    await svc.unsubscribe(JG, { endpoint: sub('1').endpoint });
    expect((await subs.findAll()).length).toBe(0);
  });
  it('module off: config and subscribe refuse, nothing is pushed', async () => {
    const off = make({ notices: 'off' });
    await expect(off.svc.pushConfig(JG)).rejects.toThrow();
    await expect(off.svc.subscribe(JG, sub('1'))).rejects.toThrow();
    await expect(off.svc.send(ADMIN, { title: 't', body: 'b', recipients: ['b79'] })).rejects.toThrow();
    expect(off.sent).toEqual([]);
  });
  it('VAPID unset: config says null, subscribe refuses, send still works with no push', async () => {
    const { svc, sent } = make({ env: {} });
    expect(await svc.pushConfig(JG)).toEqual({ publicKey: null });
    await expect(svc.subscribe(JG, sub('1'))).rejects.toMatchObject({ code: 'PUSH_OFF' });
    await expect(svc.send(ADMIN, { title: 't', body: 'b', recipients: ['b79'] })).resolves.toBeTruthy();
    expect(sent).toEqual([]);
    expect(await make().svc.pushConfig(ADMIN)).toEqual({ publicKey: 'pub' });
  });
});

describe('notice push: sending', () => {
  it('goes to the addressed quad logins plus every subscribed admin/director, never others', async () => {
    const { svc, sent } = make();
    await svc.subscribe(ADMIN, sub('admin'));
    await svc.subscribe(DIR, sub('dir'));
    await svc.subscribe(JG, sub('jg'));
    await svc.subscribe(SG, sub('sg'));
    await svc.send(ADMIN, { title: 't', body: 'b', recipients: ['b79', 'g79'] });
    expect(sent.sort()).toEqual(['admin', 'dir', 'jg'].map((n) => sub(n).endpoint).sort());
  });
  it('skips inactive accounts', async () => {
    const { svc, sent } = make({ users: [U(JG, 'inactive'), U(ADMIN)] });
    await svc.subscribe(JG, sub('jg'));
    await svc.send(ADMIN, { title: 't', body: 'b', recipients: ['b79'] });
    expect(sent).toEqual([]);
  });
  it('404/410 removes the subscription; other failures are logged by code only and never fail the send', async () => {
    const fail: Record<string, number> = { gone: 410, missing: 404, flaky: 500 };
    const sender: PushSender = async (s) => {
      const k = s.endpoint.split('/').pop()!;
      if (fail[k]) throw Object.assign(new Error('x'), { statusCode: fail[k] });
    };
    const { svc, subs, logged } = make({ sender });
    for (const n of ['gone', 'missing', 'flaky', 'ok']) await svc.subscribe(JG, sub(n));
    await expect(svc.send(ADMIN, { title: 't', body: 'b', recipients: ['b79'] })).resolves.toMatchObject({ title: 't' });
    expect((await subs.findAll()).map((s) => s.endpoint.split('/').pop()).sort()).toEqual(['flaky', 'ok']);
    expect(logged).toEqual([{ category: 'server', code: 'PUSH_FAILED', route: 'POST /notices', count: 1 }]);
  });
  it('a crashing subscription read still lets the notice save', async () => {
    const { svc, subs, logged } = make();
    subs.findAll = async () => { throw new Error('db down'); };
    await expect(svc.send(ADMIN, { title: 't', body: 'b', recipients: ['b79'] })).resolves.toBeTruthy();
    expect(logged[0].code).toBe('PUSH_FAILED');
  });
  it('payload: fixed title, first line of the notice, truncated near 120, opens Notices', () => {
    const p = JSON.parse(pushPayload({ title: 'x'.repeat(130) }));
    expect(p.title).toBe('New notice');
    expect(p.body.length).toBe(120);
    expect(p.body.endsWith('…')).toBe(true);
    expect(p.screen).toBe('notices');
    expect(Object.keys(p).sort()).toEqual(['body', 'screen', 'title']);
  });
});
