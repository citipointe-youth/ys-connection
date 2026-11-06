// F3: the alert run (spec 5.2 d): eligible subs, alert_sends claim before send, 40 s budget, push-off / module-off, one failure log.
import { describe, it, expect } from 'vitest';
import { InMemoryNoticePushRepository, InMemoryAlertSendRepository } from '../repositories/in-memory/in-memory.repositories';
import { makeAlertRun, type AlertKind, type AlertItem, type EligibleSub } from '../services/alert-run.service';
import type { PushSender } from '../services/push-send';

const VAPID = { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:x@example.com' };
const NOW = new Date('2026-11-07T22:00:00Z');
const lid = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;
const U = (id: string, role = 'quad', status = 'active') => ({ id, role, quad: 'b79', status, displayName: 'Quad Login' });
const sub = (n: string, userId: string, leaderId: string | null) =>
  ({ id: n, userId, endpoint: `https://push.example.com/${n}`, p256dh: 'p', auth: 'a', createdAt: NOW.toISOString(), leaderId, bdayOn: true, lgremOn: true });

/** A stub kind: one item per leader, carrying every eligible sub of that leader. Records the ctx it saw. */
function stubKind(seen: EligibleSub[][] = []): AlertKind {
  return {
    kind: 'bday',
    async plan(ctx) {
      seen.push(ctx.subs);
      const by = new Map<string, EligibleSub[]>();
      for (const s of ctx.subs) by.set(s.leaderId!, [...(by.get(s.leaderId!) ?? []), s]);
      const items: AlertItem[] = [...by].map(([leaderId, subs]) => ({ key: '2026-11-08', leaderId, subs, payload: { title: 'Birthday', body: 'x', tag: 'bday' } }));
      return { skipped: null, items };
    },
  };
}

function make(o: { env?: Record<string, string>; notices?: 'on' | 'off'; sender?: PushSender; leaders?: number; users?: any[]; clock?: () => number;
  extraSubs?: ReturnType<typeof sub>[]; kinds?: AlertKind[] } = {}) {
  const subs = new InMemoryNoticePushRepository();
  const claims = new InMemoryAlertSendRepository();
  const claimed: string[] = [];
  const pruned: Date[] = [];
  const claimSpy = { claim: async (k: 'bday' | 'lgrem', key: string, l: string) => { const won = await claims.claim(k, key, l); if (won) claimed.push(l); return won; },
    prune: async (d: Date) => { pruned.push(d); } };
  const sent: string[] = [];
  const logged: any[] = [];
  const n = o.leaders ?? 2;
  const leaders = Array.from({ length: n }, (_, i) => ({ id: lid(i + 1), active: true }));
  const users = o.users ?? [U('u1')];
  const sender: PushSender = o.sender ?? (async (s) => { sent.push(s.endpoint); });
  const run = makeAlertRun({
    subs, users: { findAll: async () => users as any }, leaders: { findAll: async () => leaders as any },
    settings: { getSettings: async () => ({ ministryConfig: { modules: { notices: o.notices ?? 'on' }, structure: { timeZone: 'Australia/Brisbane' } } }) } as any,
    claims: claimSpy, sender, env: o.env ?? VAPID, errorLog: { record: async (r) => { logged.push(r); } }, clock: o.clock,
  }, o.kinds ?? [stubKind()]);
  const seed = async () => {
    for (let i = 0; i < n; i++) await subs.save(sub(`d${i + 1}`, 'u1', lid(i + 1)));
    for (const s of o.extraSubs ?? []) await subs.save(s);
  };
  return { run, subs, sent, logged, claimed, pruned, seed };
}

describe('alert run: ledger', () => {
  it('two concurrent runs send each leader once', async () => {
    const m = make({ leaders: 3 });
    await m.seed();
    const [a, b] = await Promise.all([m.run.run(NOW, ['bday']), m.run.run(NOW, ['bday'])]);
    expect(m.sent.length).toBe(3);
    expect(a.bday!.sent + b.bday!.sent).toBe(3);
  });

  it('a second run sends 0', async () => {
    const m = make();
    await m.seed();
    expect((await m.run.run(NOW, ['bday'])).bday).toEqual({ leaders: 2, sent: 2, failed: 0, skipped: null });
    expect((await m.run.run(NOW, ['bday'])).bday).toEqual({ leaders: 0, sent: 0, failed: 0, skipped: null });
  });

  it('claims before sending: a sender throw still leaves the claim', async () => {
    let calls = 0;
    const m = make({ leaders: 1, sender: async () => { calls++; throw new Error('network'); } });
    await m.seed();
    expect((await m.run.run(NOW, ['bday'])).bday).toMatchObject({ sent: 0, failed: 1 });
    expect((await m.run.run(NOW, ['bday'])).bday).toMatchObject({ sent: 0, failed: 0 });
    expect(calls).toBe(1);
  });

  it('a 410 device is pruned and the other device still gets it', async () => {
    const m = make({ leaders: 1, extraSubs: [sub('d1b', 'u1', lid(1))],
      sender: async (s) => { if (s.endpoint.endsWith('/d1')) throw Object.assign(new Error('gone'), { statusCode: 410 }); m.sent.push(s.endpoint); } });
    await m.seed();
    expect((await m.subs.findAll()).length).toBe(2);
    expect((await m.run.run(NOW, ['bday'])).bday).toEqual({ leaders: 1, sent: 1, failed: 0, skipped: null });
    expect(m.sent).toEqual(['https://push.example.com/d1b']);
    expect((await m.subs.findAll()).map((s) => s.id)).toEqual(['d1b']);
  });

  it('stops claiming after 40 s', async () => {
    let t = 0;
    const m = make({ leaders: 5, clock: () => t, sender: async (s) => { t += 15_000; m.sent.push(s.endpoint); } });
    await m.seed();
    expect((await m.run.run(NOW, ['bday'])).bday).toMatchObject({ leaders: 3, sent: 3 });
    expect(m.claimed.length).toBe(3);
    t = 0;
    expect((await m.run.run(NOW, ['bday'])).bday).toMatchObject({ leaders: 2, sent: 2 });
    expect(m.claimed.length).toBe(5);
    expect(new Set(m.sent).size).toBe(5);
  });

  it('prunes alert_sends older than 30 days', async () => {
    const m = make();
    await m.seed();
    await m.run.run(NOW, ['bday']);
    expect(m.pruned).toEqual([new Date(NOW.getTime() - 30 * 86_400_000)]);
  });
});

describe('alert run: skips', () => {
  it('VAPID unset = push-off, nothing claimed', async () => {
    const m = make({ env: {} });
    await m.seed();
    expect(await m.run.run(NOW, ['bday'])).toEqual({ bday: { leaders: 0, sent: 0, failed: 0, skipped: 'push-off' } });
    expect(m.claimed).toEqual([]);
    expect(m.sent).toEqual([]);
  });

  it('notices off = module-off', async () => {
    const m = make({ notices: 'off' });
    await m.seed();
    expect(await m.run.run(NOW, ['bday'])).toEqual({ bday: { leaders: 0, sent: 0, failed: 0, skipped: 'module-off' } });
    expect(m.claimed).toEqual([]);
  });

  it('runs only the kinds asked for', async () => {
    const m = make();
    await m.seed();
    expect(await m.run.run(NOW, ['lgrem'])).toEqual({});
    expect(m.sent).toEqual([]);
  });

  it('drops subs with no leader, inactive leader, inactive user, grade/leader-role user', async () => {
    const seen: EligibleSub[][] = [];
    const users = [U('u1'), U('u-off', 'quad', 'inactive'), U('u-grade', 'grade'), U('u-leader', 'leader'), U('u-admin', 'admin'), U('u-dir', 'oversight')];
    const m = make({ leaders: 1, users, kinds: [stubKind(seen)], extraSubs: [
      sub('none', 'u1', null), sub('gone', 'u1', '99999999-9999-4999-8999-999999999999'), sub('off', 'u-off', lid(1)),
      sub('grade', 'u-grade', lid(1)), sub('leader', 'u-leader', lid(1)), sub('admin', 'u-admin', lid(1)), sub('dir', 'u-dir', lid(1)),
      sub('nouser', 'u-missing', lid(1)),
    ] });
    await m.seed();
    await m.run.run(NOW, ['bday']);
    expect(seen[0]!.map((s) => s.id).sort()).toEqual(['admin', 'd1', 'dir']);
    expect(seen[0]![0]!.user.id).toBeTruthy();
  });

  it('an inactive leader is dropped', async () => {
    const seen: EligibleSub[][] = [];
    const subs = new InMemoryNoticePushRepository();
    await subs.save(sub('d1', 'u1', lid(1)));
    const run = makeAlertRun({
      subs, users: { findAll: async () => [U('u1')] as any }, leaders: { findAll: async () => [{ id: lid(1), active: false }] as any },
      settings: { getSettings: async () => ({ ministryConfig: { modules: { notices: 'on' }, structure: { timeZone: 'Australia/Brisbane' } } }) } as any,
      claims: new InMemoryAlertSendRepository(), sender: async () => {}, env: VAPID, errorLog: { record: async () => {} },
    }, [stubKind(seen)]);
    await run.run(NOW, ['bday']);
    expect(seen[0]).toEqual([]);
  });
});

describe('alert run: logging', () => {
  it('logs ALERT_PUSH_FAILED once with a count and no names', async () => {
    const m = make({ leaders: 3, sender: async () => { throw Object.assign(new Error('Sample Dummyton'), { statusCode: 500 }); } });
    await m.seed();
    expect((await m.run.run(NOW, ['bday'])).bday).toMatchObject({ sent: 0, failed: 3 });
    expect(m.logged).toEqual([{ category: 'server', code: 'ALERT_PUSH_FAILED', route: 'alerts', count: 3 }]);
  });

  it('logs nothing when every send works', async () => {
    const m = make();
    await m.seed();
    await m.run.run(NOW, ['bday']);
    expect(m.logged).toEqual([]);
  });
});
