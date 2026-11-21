// Consent automation A1: the console's alert call carries a `due` list (Fri 19:45 consentText, Fri 06:30 consentRecord); the app
// pushes counts only, once per (kind, date), to every active user with notice:alerts and a push subscription (leader picked or not).
import { describe, it, expect } from 'vitest';
import { InMemoryNoticePushRepository, InMemoryAlertSendRepository } from '../repositories/in-memory/in-memory.repositories';
import { makeAlertRun, type Due } from '../services/alert-run.service';
import { makeConsentWeekKind } from '../services/consent-week-alert';
import { makeSyncController } from '../api/controllers/sync.controller';
import { LINK_CONTRACT_VERSION } from '../core/link-contract';

const VAPID = { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:x@example.com' };
const NOW = new Date('2026-11-27T09:46:00Z');
const U = (id: string, role = 'admin', status = 'active') => ({ id, role, status, displayName: 'Admin' });
const sub = (n: string, userId: string) =>
  ({ id: n, userId, endpoint: `https://push.example.com/${n}`, p256dh: 'p', auth: 'a', createdAt: NOW.toISOString(), leaderId: null, bdayOn: true, lgremOn: true });
const COUNTS = { save: 4, text: 3, record: 0, assume: 0, move: 0, held: 2 };
const TEXT: Due = { kind: 'consentText', date: '2026-11-27', counts: COUNTS };

function make(users: any[] = [U('u1'), U('u2')]) {
  const subs = new InMemoryNoticePushRepository();
  const sent: { endpoint: string; body: any }[] = [];
  const run = makeAlertRun({
    subs, users: { findAll: async () => users as any }, leaders: { findAll: async () => [] as any },
    settings: { getSettings: async () => ({ ministryConfig: { modules: { notices: 'on' }, structure: { timeZone: 'Australia/Brisbane' } } }) } as any,
    claims: new InMemoryAlertSendRepository(), env: VAPID, errorLog: { record: async () => {} },
    sender: async (s, payload) => { sent.push({ endpoint: s.endpoint, body: JSON.parse(String(payload)) }); },
  }, [makeConsentWeekKind('consentText'), makeConsentWeekKind('consentRecord')]);
  return { run, subs, sent };
}

describe('consent-week alerts', () => {
  it('consentText due → one push per eligible user, body counts only', async () => {
    const m = make();
    await m.subs.save(sub('d1', 'u1'));
    await m.subs.save(sub('d2', 'u2'));
    const out = await m.run.run(NOW, ['consentText'], [TEXT]);
    expect(m.sent.length).toBe(2);
    expect(out.consentText!.sent).toBe(2);
    for (const s of m.sent) {
      expect(s.body.body).toMatch(/^\d+ to save, \d+ parents to text, \d+ held$/);
      expect(s.body).toMatchObject({ tag: 'consentText', screen: 'consentweek', mode: 'intake', date: '2026-11-27' });
    }
  });

  it('consentRecord body reads record/assume/move/held, mode consent', async () => {
    const m = make();
    await m.subs.save(sub('d1', 'u1'));
    await m.run.run(NOW, ['consentRecord'], [{ kind: 'consentRecord', date: '2026-11-27', counts: { ...COUNTS, record: 5, assume: 1, move: 6 } }]);
    expect(m.sent[0]!.body.body).toBe('5 to record, 1 assume, 6 to move, 2 held');
    expect(m.sent[0]!.body.mode).toBe('consent');
  });

  it('claims once per kind+date (a repeat call sends nothing)', async () => {
    const m = make();
    await m.subs.save(sub('d1', 'u1'));
    await m.run.run(NOW, ['consentText'], [TEXT]);
    const again = await m.run.run(NOW, ['consentText'], [TEXT]);
    expect(m.sent.length).toBe(1);
    expect(again.consentText!.sent).toBe(0);
  });

  it('no due → consent kinds not planned', async () => {
    const m = make();
    await m.subs.save(sub('d1', 'u1'));
    await m.run.run(NOW, ['consentText', 'consentRecord'], []);
    expect(m.sent.length).toBe(0);
  });

  it('quad login (notice:alerts, no intake:admin) gets nothing', async () => {
    const m = make([U('u1', 'quad')]);
    await m.subs.save(sub('d1', 'u1'));
    await m.run.run(NOW, ['consentText'], [TEXT]);
    expect(m.sent.length).toBe(0);
  });

  it('user without notice:alerts gets nothing', async () => {
    const m = make([U('u1', 'leader')]);
    await m.subs.save(sub('d1', 'u1'));
    await m.run.run(NOW, ['consentText'], [TEXT]);
    expect(m.sent.length).toBe(0);
  });
});

describe('consent-week alerts: controller', () => {
  const BODY = { contractVersion: LINK_CONTRACT_VERSION, consoleId: '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a' };
  const ctl = () => {
    const calls: any[] = [];
    const c = makeSyncController({ sync: {} as never, reconcile: {} as never, nightSummary: {} as never,
      alerts: { run: async (_n: Date, w: string[], d?: Due[]) => { calls.push([w, d ?? []]); return {}; } } as any });
    return { c, calls };
  };

  it('due kinds join bday + lgrem', async () => {
    const { c, calls } = ctl();
    await c.alerts({ body: { ...BODY, due: [TEXT] } } as any);
    expect(calls).toEqual([[['bday', 'lgrem', 'consentText'], [TEXT]]]);
  });

  it('bad date in due → refused, never runs', async () => {
    const { c, calls } = ctl();
    await expect(c.alerts({ body: { ...BODY, due: [{ ...TEXT, date: '27/11/2026' }] } } as any)).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});
