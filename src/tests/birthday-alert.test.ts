// B1: birthday alert kind (spec 6.1). Pure helpers, then the sweep through makeAlertRun (eligibility lives in the run).
import { describe, it, expect } from 'vitest';
import { birthdayToday, birthdayBody, makeBirthdayKind } from '../services/birthday-alert';
import { makeAlertRun } from '../services/alert-run.service';
import { InMemoryNoticePushRepository, InMemoryAlertSendRepository } from '../repositories/in-memory/in-memory.repositories';
import type { PushSender } from '../services/push-send';

describe('birthdayToday', () => {
  it.each([
    ['2010-11-06', '2026-11-06', 16], ['2010-11-07', '2026-11-06', null],
    ['2008-02-29', '2026-02-28', 18], ['2008-02-29', '2028-02-28', null], ['2008-02-29', '2028-02-29', 20],
    ['2010-12-31', '2026-12-31', 16], ['2011-01-01', '2027-01-01', 16],
    ['2010-02-30', '2026-02-28', null], [null, '2026-11-06', null], ['', '2026-11-06', null],
    ['2026-11-06', '2026-11-06', null], // born today: not a birthday
  ])('%s on %s -> %s', (dob, day, want) => expect(birthdayToday(dob, day)).toBe(want));
});

describe('birthdayBody', () => {
  const s = (firstName: string, age: number) => ({ firstName, age });
  it('one, two, three', () => {
    expect(birthdayBody([s('Sam', 16)])).toBe('🎂 Sam turns 16 today');
    expect(birthdayBody([s('Mia', 15), s('Sam', 16)])).toBe('🎂 Mia turns 15 and Sam turns 16 today');
    expect(birthdayBody([s('Leo', 14), s('Mia', 15), s('Sam', 16)])).toBe('🎂 Leo (14), Mia (15) and Sam (16) have birthdays today');
  });
  it('ten long accented names stay within 120 chars and end "and N more today"', () => {
    const names = ['Zoë-Anastasia', "D'Arcy-Montgomery", 'Émilie-Rosalind', 'Bartholomew', 'Cristóbal-Maximilian', 'Dominique-Seraphina', 'Evangelina', 'Fitzgerald-Augustus', 'Genevieve-Marguerite', 'Hieronymus'];
    const body = birthdayBody(names.map((n, i) => s(n, 12 + (i % 6))));
    expect(body.length).toBeLessThanOrEqual(120);
    expect(body).toMatch(/… and \d+ more today$/);
  });
  it('two long names stay within 120 chars (falls to the "and 1 more" form)', () => {
    const body = birthdayBody([s('A'.repeat(60), 15), s('B'.repeat(60), 16)]);
    expect(body.length).toBeLessThanOrEqual(120);
    expect(body).toBe(`🎂 ${'A'.repeat(60)} (15) … and 1 more today`);
  });
});

const L1 = '00000001-0000-4000-8000-000000000000', L2 = '00000002-0000-4000-8000-000000000000';
const VAPID = { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:x@example.com' };
const AT_0800 = new Date('2026-11-06T22:00:00Z'); // 08:00 Sat 7 Nov Brisbane (UTC+10, no DST)
const stu = (id: string, firstName: string, dateOfBirth: string | null) => ({ id, firstName, lastName: 'Surname', mobile: '0400000000', dateOfBirth });
const sub = (n: string, userId: string, leaderId: string | null, bdayOn = true) =>
  ({ id: n, userId, endpoint: `https://push.example.com/${n}`, p256dh: 'p', auth: 'a', createdAt: AT_0800.toISOString(), leaderId, bdayOn, lgremOn: true });

async function rig(o: { students?: any[]; conns?: [string, string][]; dnc?: string[]; subs?: any[]; users?: any[]; leaders?: any[];
  modules?: Record<string, string>; tz?: string; env?: Record<string, string> } = {}) {
  const subs = new InMemoryNoticePushRepository();
  for (const s of o.subs ?? [sub('d1', 'u1', L1)]) await subs.save(s);
  const sent: { endpoint: string; payload: string }[] = [];
  const sender: PushSender = async (s, payload) => { sent.push({ endpoint: s.endpoint, payload }); };
  const students = o.students ?? [stu('s1', 'Sam', '2010-11-07')];
  const conns = (o.conns ?? [['s1', L1]]).map(([studentId, leaderId]) => ({ studentId, leaderId }));
  const kind = makeBirthdayKind({
    students: { findAll: async () => students as any }, connections: { findAll: async () => conns as any },
    dnc: { ids: async () => new Set(o.dnc ?? []) },
  });
  const run = makeAlertRun({
    subs, users: { findAll: async () => (o.users ?? [{ id: 'u1', role: 'quad', status: 'active' }]) as any },
    leaders: { findAll: async () => (o.leaders ?? [{ id: L1, active: true }, { id: L2, active: true }]) as any },
    settings: { getSettings: async () => ({ ministryConfig: { modules: { notices: 'on', birthdayAlerts: 'on', ...o.modules }, structure: { timeZone: o.tz ?? 'Australia/Brisbane' } } }) } as any,
    claims: new InMemoryAlertSendRepository(), sender, env: o.env ?? VAPID, errorLog: { record: async () => {} },
  }, [kind]);
  return { run, sent, go: (now = AT_0800) => run.run(now, ['bday']).then((r) => r.bday!) };
}

describe('birthday sweep', () => {
  it('sends the payload to a connected leader', async () => {
    const r = await rig();
    expect(await r.go()).toEqual({ leaders: 1, sent: 1, failed: 0, skipped: null });
    expect(JSON.parse(r.sent[0]!.payload)).toEqual({ title: 'Birthday', body: '🎂 Sam turns 16 today', tag: 'bday', screen: 'student', ids: ['s1'] });
  });

  it('only connected students (A1)', async () => {
    const r = await rig({ conns: [['s1', L2]] }); // Sam is L2's student, the device is L1's
    expect((await r.go()).sent).toBe(0);
  });

  it.each([
    ['graduated (findAll omits it)', { students: [] }],
    ['DNC', { dnc: ['s1'] }],
    ['no DOB', { students: [stu('s1', 'Sam', null)] }],
    ['blank first name', { students: [stu('s1', '  ', '2010-11-07')] }],
    ['inactive leader', { leaders: [{ id: L1, active: false }] }],
    ['no notice:alerts', { users: [{ id: 'u1', role: 'leader', status: 'active' }] }],
    ['inactive login', { users: [{ id: 'u1', role: 'quad', status: 'inactive' }] }],
    ['null leader', { subs: [sub('d1', 'u1', null)] }],
    ['bdayOn=false', { subs: [sub('d1', 'u1', L1, false)] }],
  ])('skips %s', async (_n, o) => {
    const r = await rig(o as any);
    expect((await r.go()).sent).toBe(0);
    expect(r.sent).toEqual([]);
  });

  it('one push per device, two devices both get it', async () => {
    const r = await rig({ subs: [sub('d1', 'u1', L1), sub('d2', 'u1', L1)] });
    expect(await r.go()).toMatchObject({ leaders: 1, sent: 2 });
    expect(r.sent.map((s) => s.endpoint).sort()).toEqual(['https://push.example.com/d1', 'https://push.example.com/d2']);
  });

  it('body has first names only (A2)', async () => {
    const r = await rig();
    await r.go();
    expect(r.sent[0]!.payload).not.toMatch(/Surname|0400000000|lastName|mobile/);
  });

  it('sorts names and ids together, ids capped at 10', async () => {
    const students = Array.from({ length: 12 }, (_, i) => stu(`s${String(i).padStart(2, '0')}`, `N${String.fromCharCode(90 - i)}`, '2010-11-07'));
    const r = await rig({ students, conns: students.map((s) => [s.id, L1]) });
    await r.go();
    const p = JSON.parse(r.sent[0]!.payload);
    expect(p.ids).toHaveLength(10);
    expect(p.ids[0]).toBe('s11'); // NK sorts first
  });

  it('07:59 and 12:00 send 0 with skipped window (A4)', async () => {
    const r = await rig();
    for (const iso of ['2026-11-06T21:59:00Z', '2026-11-07T02:00:00Z']) expect(await r.go(new Date(iso))).toEqual({ leaders: 0, sent: 0, failed: 0, skipped: 'window' });
    expect(r.sent).toEqual([]);
    expect((await r.go(new Date('2026-11-07T01:59:00Z'))).sent).toBe(1); // 11:59 still sends
  });

  it('a second run on the same day sends 0', async () => {
    const r = await rig();
    await r.go();
    expect((await r.go(new Date('2026-11-06T23:00:00Z'))).sent).toBe(0);
  });

  it('module off / VAPID off send 0', async () => {
    const off = await rig({ modules: { birthdayAlerts: 'off' } });
    expect(await off.go()).toMatchObject({ sent: 0, skipped: 'module-off' });
    const noVapid = await rig({ env: {} });
    expect(await noVapid.go()).toMatchObject({ sent: 0, skipped: 'push-off' });
  });

  it('Sydney site in summer sends at 08:00 Sydney (21:00 UTC prev day)', async () => {
    const r = await rig({ tz: 'Australia/Sydney' });
    expect((await r.go(new Date('2026-11-06T20:59:00Z'))).skipped).toBe('window'); // 07:59 AEDT
    expect(await r.go(new Date('2026-11-06T21:00:00Z'))).toMatchObject({ sent: 1, skipped: null }); // 08:00 AEDT, day = 7 Nov
    expect(r.sent).toHaveLength(1);
  });
});
