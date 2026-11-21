// L2: lifegroup report reminders (spec 7.1, L1-L7). Pure helpers, then the sweep through makeAlertRun.
import { describe, it, expect } from 'vitest';
import { dueOccurrences, nudgeOccurrences, reportDone, makeLifegroupKind } from '../services/lifegroup-reminder';
import { makeAlertRun } from '../services/alert-run.service';
import { InMemoryNoticePushRepository, InMemoryAlertSendRepository } from '../repositories/in-memory/in-memory.repositories';
import type { PushSender } from '../services/push-send';
import type { LinkGroupRow, LinkLastReport, LinkRosterRow, OutboxRow } from '../core/link-types';

const BNE = 'Australia/Brisbane', SYD = 'Australia/Sydney';
const G = '0000000a-0000-4000-8000-000000000000';
const P1 = '000000f1-0000-4000-8000-000000000000', P2 = '000000f2-0000-4000-8000-000000000000';
const L1 = '00000001-0000-4000-8000-000000000000';

describe('dueOccurrences (L2, L4)', () => {
  const at = (iso: string, meets = 'Tue 6:30 PM', tz = BNE) => dueOccurrences(meets, new Date(iso), tz);
  it('due at meeting + 2 h, for 60 min (Brisbane UTC+10)', () => {
    expect(at('2026-11-10T10:29:00Z')).toEqual([]);           // Tue 20:29
    expect(at('2026-11-10T10:30:00Z')).toEqual(['2026-11-10']); // 20:30
    expect(at('2026-11-10T11:29:00Z')).toEqual(['2026-11-10']); // 21:29
    expect(at('2026-11-10T11:30:00Z')).toEqual([]);           // 21:30
  });
  it('a late meeting is keyed to the meeting date after midnight', () => {
    expect(at('2026-11-07T14:45:00Z', 'Sat 10:30 PM')).toEqual(['2026-11-07']); // Sun 00:45
  });
  it('Sydney summer site uses Sydney time (Review Focus 1)', () => {
    expect(at('2026-11-10T09:30:00Z', 'Tue 6:30 PM', SYD)).toEqual(['2026-11-10']); // 20:30 AEDT
    expect(at('2026-11-10T09:30:00Z', 'Tue 6:30 PM', BNE)).toEqual([]);            // 19:30 Brisbane
  });
  it('no weekday or no time: none', () => {
    expect(at('2026-11-10T10:30:00Z', 'Tue')).toEqual([]);
    expect(at('2026-11-10T10:30:00Z', '6:30 PM')).toEqual([]);
  });
});

describe('nudgeOccurrences (08:00 the next morning, Brisbane)', () => {
  const at = (iso: string, meets = 'Tue 6:30 PM', tz = BNE) => nudgeOccurrences(meets, new Date(iso), tz);
  it('08:00 to 08:59 the day after the meeting', () => {
    expect(at('2026-11-10T21:59:00Z')).toEqual([]);             // Wed 07:59
    expect(at('2026-11-10T22:00:00Z')).toEqual(['2026-11-10']); // Wed 08:00
    expect(at('2026-11-10T22:59:00Z')).toEqual(['2026-11-10']); // Wed 08:59
    expect(at('2026-11-10T23:00:00Z')).toEqual([]);             // Wed 09:00
  });
  it('not on the meeting day, and nothing without a weekday', () => {
    expect(at('2026-11-09T22:00:00Z')).toEqual([]);              // Tue 08:00
    expect(at('2026-11-10T22:00:00Z', 'Tue')).toEqual(['2026-11-10']); // time not needed for the morning nudge
    expect(at('2026-11-10T22:00:00Z', '6:30 PM')).toEqual([]);
  });
});

const rep = (date: string, o: Partial<LinkLastReport> = {}): LinkLastReport => ({ reportId: `r-${date}`, date, time: '18:30', didNotMeet: false,
  attendees: [], guests: 0, serviceTimeId: null, editable: true, blocked: null, ...o });
const grp = (o: Partial<LinkGroupRow> = {}): LinkGroupRow => ({ groupId: G, name: 'Year 8 Boys Tuesday', grade: 8, gender: 'male', meets: 'Tue 6:30 PM',
  members: [{ personId: P1, name: 'Ari Leaderson', leader: true }, { personId: P2, name: 'Kid Membername', leader: false }],
  thisWeek: 'none', lastReport: null, history: [], ...o });
const ob = (status: OutboxRow['status'], date: string, type: OutboxRow['type'] = 'submitReport'): OutboxRow =>
  ({ id: `o-${status}`, type, payload: { groupId: G, date }, status } as unknown as OutboxRow);

describe('reportDone (L3, L5)', () => {
  const D = '2026-11-10', T = '2026-11-10'; // week Mon 9 .. Sun 15 Nov
  it.each(['pending', 'claimed', 'sent', 'unclear'] as const)('outbox %s -> done', (s) => expect(reportDone(grp(), [ob(s, D)], D, T)).toBe(true));
  it('editReport counts', () => expect(reportDone(grp(), [ob('sent', D, 'editReport')], D, T)).toBe(true));
  it.each(['refused', 'cancelled'] as const)('outbox %s -> not done', (s) => expect(reportDone(grp(), [ob(s, D)], D, T)).toBe(false));
  it('another group\'s report does not count', () => {
    const o = { ...ob('sent', D), payload: { groupId: 'other', date: D } } as OutboxRow;
    expect(reportDone(grp(), [o], D, T)).toBe(false);
  });
  it('mirror history the same week -> done, incl. did-not-meet and no service', () => {
    expect(reportDone(grp({ history: [rep('2026-11-10')] }), [], D, T)).toBe(true);
    expect(reportDone(grp({ history: [rep('2026-11-10', { didNotMeet: true })] }), [], D, T)).toBe(true);
    expect(reportDone(grp({ lastReport: rep('2026-11-10', { serviceTimeId: null }) }), [], D, T)).toBe(true);
  });
  it('a report another day that week -> done', () => {
    expect(reportDone(grp({ history: [rep('2026-11-15')] }), [], D, T)).toBe(true);
    expect(reportDone(grp(), [ob('pending', '2026-11-09')], D, T)).toBe(true);
  });
  it('last week only -> not done', () => {
    expect(reportDone(grp({ history: [rep('2026-11-08')], lastReport: rep('2026-11-03') }), [ob('sent', '2026-11-08')], D, T)).toBe(false);
  });
  it('thisWeek reported / did-not-meet counts in the current week', () => {
    expect(reportDone(grp({ thisWeek: 'reported' }), [], D, T)).toBe(true);
    expect(reportDone(grp({ thisWeek: 'did-not-meet' }), [], D, T)).toBe(true);
    expect(reportDone(grp({ thisWeek: 'reported' }), [], '2026-11-08', '2026-11-09')).toBe(false); // D last week, today Mon
  });
  it('thisWeek unreadable -> unreadable', () => expect(reportDone(grp({ thisWeek: 'unreadable' }), [], D, T)).toBe('unreadable'));
});

// ---------------- the sweep ----------------

const VAPID = { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:x@example.com' };
const DUE = new Date('2026-11-10T10:45:00Z'); // Tue 20:45 Brisbane: a Tue 6:30 PM group is due
const ON = { notices: 'on', liveLink: 'on', lifegroupReport: 'on', lifegroupReminders: 'on' };
const sub = (n: string, userId: string, leaderId: string | null, lgremOn = true) =>
  ({ id: n, userId, endpoint: `https://push.example.com/${n}`, p256dh: 'p', auth: 'a', createdAt: DUE.toISOString(), leaderId, bdayOn: true, lgremOn });
const ros = (personId: string, first: string, last: string): LinkRosterRow => ({ personId, firstName: first, lastName: last, gender: null, grade: null,
  kind: 'leader', active: true, studentId: null, match: 'none', updatedAt: '2026-11-01T00:00:00Z' });
const QUAD = { id: 'u1', role: 'quad', quad: 'b79', status: 'active', displayName: 'Boys 7-9' };
const ADMIN = { id: 'u2', role: 'admin', status: 'active', displayName: 'Admin' };

async function rig(o: { groups?: LinkGroupRow[]; outbox?: OutboxRow[]; roster?: LinkRosterRow[]; takenAt?: string | null; subs?: any[]; users?: any[];
  leaders?: any[]; modules?: Record<string, string> } = {}) {
  const subs = new InMemoryNoticePushRepository();
  for (const s of o.subs ?? [sub('d1', 'u1', L1)]) await subs.save(s);
  const sent: { endpoint: string; payload: string }[] = [];
  const sender: PushSender = async (s, payload) => { sent.push({ endpoint: s.endpoint, payload }); };
  const leaders = o.leaders ?? [{ id: L1, fullName: 'Ari Leaderson', gender: null, active: true }];
  const takenAt = o.takenAt === undefined ? '2026-11-10T09:00:00Z' : o.takenAt;
  const kind = makeLifegroupKind({
    link: {
      groups: async () => o.groups ?? [grp()],
      roster: async () => o.roster ?? [ros(P1, 'Ari', 'Leaderson')],
      mirrorState: async () => (takenAt ? [{ kind: 'groups', takenAt, consoleId: 'c', rowCount: 1, appliedAt: takenAt }] : []) as any,
      listActions: async () => o.outbox ?? [],
    },
  });
  const run = makeAlertRun({
    subs, users: { findAll: async () => (o.users ?? [QUAD]) as any }, leaders: { findAll: async () => leaders as any },
    settings: { getSettings: async () => ({ ministryConfig: { modules: { ...ON, ...o.modules }, structure: { timeZone: BNE, cohortModel: 'grades-quads', gradeMin: 6, gradeMax: 12 } } }) } as any,
    claims: new InMemoryAlertSendRepository(), sender, env: VAPID, errorLog: { record: async () => {} },
  }, [kind]);
  return { sent, go: (now = DUE) => run.run(now, ['lgrem']).then((r) => r.lgrem!) };
}

describe('lifegroup reminder sweep', () => {
  it('sends the payload to the group leader\'s device; a second run sends 0', async () => {
    const r = await rig();
    expect(await r.go()).toEqual({ leaders: 1, sent: 1, failed: 0, skipped: null, hidden: 0, unlinked: 0 });
    expect(JSON.parse(r.sent[0]!.payload)).toEqual({ title: 'Lifegroup report', body: 'Year 8 Boys Tuesday met at 6:30 PM. Tap to fill in the report.',
      tag: `lgrem:${G}`, screen: 'lgreport', g: G, d: '2026-11-10' });
    expect((await r.go()).sent).toBe(0);
  });

  it('a long name is cut to 40 chars; no member names (A2)', async () => {
    const r = await rig({ groups: [grp({ name: 'Year 8 Boys Tuesday Night Lifegroup at the Big Hall' })] });
    await r.go();
    const p = JSON.parse(r.sent[0]!.payload);
    const name = p.body.split(' met at ')[0];
    expect(name.length).toBeLessThanOrEqual(40);
    expect(p.body).not.toMatch(/Ari|Leaderson|Kid|Membername/);
  });

  it('stale mirror -> skipped stale, 0 sent', async () => {
    const r = await rig({ takenAt: '2026-11-10T04:44:00Z' }); // 6 h 1 min old
    expect(await r.go()).toMatchObject({ skipped: 'stale', sent: 0 });
    expect((await rig({ takenAt: null }).then((x) => x.go())).skipped).toBe('stale');
  });

  it('report already in -> 0 sent', async () => {
    const r = await rig({ groups: [grp({ thisWeek: 'reported' })] });
    expect((await r.go()).sent).toBe(0);
  });

  it('unmapped Elvanto leader -> unlinked 1, 0 sent', async () => {
    const r = await rig({ roster: [] });
    expect(await r.go()).toMatchObject({ unlinked: 1, sent: 0 });
  });

  // 2026-11-21 (Tom): a group's own leader always sees it, so its reminder reaches them whatever their login's scope.
  it("a group outside the login's scope still reminds its own leader", async () => {
    const r = await rig({ groups: [grp({ grade: 11, name: 'Grade 11 Boys' })] });
    expect(await r.go()).toMatchObject({ hidden: 0, sent: 1 });
  });

  it('lgremOn=false is skipped', async () => {
    const r = await rig({ subs: [sub('d1', 'u1', L1, false)] });
    expect((await r.go()).sent).toBe(0);
  });

  it('module off -> module-off', async () => {
    expect((await (await rig({ modules: { lifegroupReminders: 'off' } })).go()).skipped).toBe('module-off');
    expect((await (await rig({ modules: { lifegroupReport: 'off' } })).go()).skipped).toBe('module-off');
  });

  it("lifegroupReport 'admin' -> only admin-role devices", async () => {
    const r = await rig({ modules: { lifegroupReport: 'admin' }, users: [QUAD, ADMIN], subs: [sub('d1', 'u1', L1), sub('d2', 'u2', L1)] });
    expect(await r.go()).toMatchObject({ sent: 1, hidden: 1 });
    expect(r.sent.map((s) => s.endpoint)).toEqual(['https://push.example.com/d2']);
  });

  it('outside the due window -> nothing', async () => {
    const r = await rig();
    expect((await r.go(new Date('2026-11-10T09:00:00Z'))).sent).toBe(0);
  });

  it('second nudge at 08:00 next morning if still unsent; its own claim, sent once', async () => {
    const r = await rig({ takenAt: '2026-11-10T21:00:00Z' });
    await r.go(); // Tue 20:45 first push
    const WED = new Date('2026-11-10T22:05:00Z'); // Wed 08:05
    expect(await r.go(WED)).toMatchObject({ sent: 1 });
    expect(JSON.parse(r.sent[1]!.payload)).toMatchObject({ screen: 'lgreport', g: G, d: '2026-11-10', body: 'Year 8 Boys Tuesday: still no report from last night. Tap to fill it in.' });
    expect((await r.go(WED)).sent).toBe(0);
  });

  it('a report in before 08:00 stops the nudge', async () => {
    const r = await rig({ groups: [grp({ thisWeek: 'reported' })], takenAt: '2026-11-10T21:00:00Z' });
    expect((await r.go(new Date('2026-11-10T22:05:00Z'))).sent).toBe(0);
  });

  it('co-leader sent the report: neither leader is pushed (first push or nudge)', async () => {
    const P3 = '000000f3-0000-4000-8000-000000000000', L2 = '00000002-0000-4000-8000-000000000000';
    const two = grp({ members: [{ personId: P1, name: 'Ari Leaderson', leader: true }, { personId: P3, name: 'Bee Coleader', leader: true }] });
    const mk = (outbox: OutboxRow[]) => rig({ groups: [two], outbox, roster: [ros(P1, 'Ari', 'Leaderson'), ros(P3, 'Bee', 'Coleader')],
      leaders: [{ id: L1, fullName: 'Ari Leaderson', gender: null, active: true }, { id: L2, fullName: 'Bee Coleader', gender: null, active: true }],
      subs: [sub('d1', 'u1', L1), sub('d2', 'u1', L2)], takenAt: '2026-11-10T21:00:00Z' });
    const both = await mk([]);
    expect((await both.go()).sent).toBe(2);       // control: both get it while unsent
    const done = await mk([ob('pending', '2026-11-10')]);
    expect((await done.go()).sent).toBe(0);
    expect((await done.go(new Date('2026-11-10T22:05:00Z'))).sent).toBe(0);
  });
});
