// F4 (round 2026-10-22): phone visibility sweep. 14-16 Oct leaked DNC and out-of-scope phones 5 ways (leader summary:
// the juniorguys login saw 53 out-of-scope phones; the at-risk PATCH; a step-0 flow row; a failed form read; a form link).
// One live memory server: every student has its own mobile and parent phone, every student is connected to every leader,
// two in-scope boys are DNC (then a later roster push reads 'unknown': the flag must stick), and the flows carry phones.
// Then EVERY GET route (each :param tried with every student and leader id) plus the query variants the screens use is
// called as scoped logins; no response may hold a phone of a student outside the login's scope or of a DNC person.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { buildContainer, type Container } from '../container';
import { buildRoutes } from '../api/http/router';
import { createApp } from '../api/http/express-adapter';
import { seedDemoData } from '../seed';
import type { Student } from '../core/entities/student';

const TOKEN = 'Sw' + 'p9'.repeat(20);
const CONSOLE = '8f5a1c2e-0000-4000-8000-000000000001';
const FLOW = 'f1000000-0000-4000-8000-0000000000f4', STEP = 'f5000000-0000-4000-8000-0000000000f4';
const pid = (i: number) => `9e000000-0000-4000-8000-${String(500 + i).padStart(12, '0')}`;
const DNC_NAMES = ['William Garcia', 'Benjamin Davis']; // grade 8 and grade 9 boys: inside juniorguys' scope
type Login = { name: string; sees: (grade: number | null, gender: string | null) => boolean };
const LOGINS: Login[] = [
  { name: 'juniorguys', sees: (g, s) => s === 'male' && g != null && g >= 6 && g <= 9 },
  { name: 'grade8', sees: (g) => g === 8 },
  { name: 'seniorgirls', sees: (g, s) => s === 'female' && g != null && g >= 10 },
];

describe('F4 phone sweep: a scoped login never gets an out-of-scope or DNC phone', () => {
  const saved = process.env['LINK_SYNC_TOKEN'];
  let server: Server; let base = ''; let c: Container;
  const tokens: Record<string, string> = {};
  let students: Student[] = [];
  let leaderIds: string[] = [];
  // phone -> who it belongs to (grade, gender, dnc)
  const phones = new Map<string, { grade: number | null; gender: string | null; dnc: boolean; what: string }>();

  const get = async (path: string, tok: string) => {
    const r = await fetch(base + path, { headers: { authorization: `Bearer ${tok}` } });
    return { status: r.status, text: (await r.text()).replace(/[\s-]/g, '') };
  };
  const push = async (kind: string, rows: unknown[], takenAt: string) => {
    const r = await fetch(`${base}/sync/push/${kind}`, { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ contractVersion: 1, consoleId: CONSOLE, takenAt, rows }) });
    expect([kind, r.status]).toEqual([kind, 200]);
  };

  /** Every GET path a login can be sent to: params filled with each student and leader id, plus the screens' queries. */
  function paths(): string[] {
    const ids = [...students.map((s) => s.id), ...leaderIds];
    const out = new Set<string>([
      '/students?crossGrade=1', '/connections?crossGrade=1', '/students?q=a', '/bus/search?q=a', '/link/youth?q=a',
      '/batch?sections=overview,trends,students,lifegroupStats,connections,atRisk,settings,leaders,studentsConnect,connectionsConnect',
      '/leaders?pick=1', '/link/consents/lookup?kind=other', '/link/consents/lookup?kind=mismatches',
    ]);
    for (const r of buildRoutes(c.services)) {
      if (r.method !== 'GET') continue;
      if (!r.path.includes(':')) { out.add(r.path); continue; }
      for (const id of r.path.includes(':year') ? ['2026'] : ids) out.add(r.path.replace(/:[A-Za-z]+/g, id));
    }
    return [...out];
  }

  beforeAll(async () => {
    process.env['LINK_SYNC_TOKEN'] = TOKEN;
    c = await buildContainer();
    await seedDemoData(c.repos);
    const s = await c.repos.settings.getSettings();
    await c.repos.settings.updateSettings({ ministryConfig: { ...s.ministryConfig,
      modules: { ...s.ministryConfig.modules, newYouthForms: 'on', checkin: 'on', lifegroupReport: 'on', flows: 'on',
        intakeAdmin: 'on', busMinistry: true, notices: 'on', flowHiddenStep: { [FLOW]: 'none' } } } as any });
    server = createApp(buildRoutes(c.services), c.services.auth).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    students = await c.repos.students.findAll();
    leaderIds = (await c.repos.leaders.findAll()).map((l) => l.id);
    const now = new Date().toISOString();
    for (const [i, st] of students.entries()) {
      const mobile = `0491${String(i).padStart(6, '0')}`, parentPhone = `0492${String(i).padStart(6, '0')}`;
      await c.repos.students.save({ ...st, mobile, parentPhone, svcAttended: 0, prevSvcAttended: 3, prevSvcTotal: 4 }); // 'stopped': at-risk + follow-up
      const dnc = DNC_NAMES.includes(`${st.firstName} ${st.lastName}`);
      for (const p of [mobile, parentPhone]) phones.set(p, { grade: st.grade, gender: st.gender, dnc, what: `${st.firstName} ${st.lastName}` });
      for (const l of leaderIds) await c.repos.connections.save({ id: `${st.id}-${l}`, studentId: st.id, leaderId: l, assignedByRole: 'admin', createdAt: now } as any);
    }
    students = await c.repos.students.findAll();

    // The roster (names match the seed, so every student auto-matches); then a failed form read: DNC reads 'unknown'.
    const roster = (consentOf: (dnc: boolean) => string) => students.map((st, i) => ({ personId: pid(i), firstName: st.firstName,
      lastName: st.lastName, gender: st.gender, grade: st.grade, kind: 'student',
      consent: consentOf(DNC_NAMES.includes(`${st.firstName} ${st.lastName}`)) }));
    await push('roster', roster((d) => (d ? 'all' : 'ok')), new Date(Date.now() - 60_000).toISOString());
    await push('roster', roster((d) => (d ? 'unknown' : 'ok')), new Date(Date.now() - 30_000).toISOString());

    // Flow rows with their own phones, on the step a non-admin could see (hidden step set to none): an in-scope ok boy,
    // a DNC boy whose flow row reads unknown, a boy whose flow row itself says contact, and an out-of-scope girl.
    const idx = (n: string) => students.findIndex((st) => `${st.firstName} ${st.lastName}` === n);
    const flowPeople: [string, string, boolean][] = [['Liam Anderson', 'ok', false], ['William Garcia', 'unknown', true],
      ['Mason Wilson', 'contact', true], ['Harper Evans', 'ok', false]];
    const flows = flowPeople.map(([n, consent], k) => {
      const st = students[idx(n)]!, mobile = `0493${String(k).padStart(6, '0')}`;
      return { rowId: `f7000000-0000-4000-8000-0000000000${50 + k}`, flowId: FLOW, flowName: 'Youth - New People', stepId: STEP,
        stepName: 'Step 0', stepOrder: 1, personId: pid(idx(n)), name: n, due: '2026-10-09', assignedTo: '', consent,
        grade: st.grade, gender: st.gender, mobile, mobileIsParent: false };
    });
    for (const [k, [n, , dnc]] of flowPeople.entries()) {
      const st = students[idx(n)]!;
      phones.set(flows[k]!.mobile, { grade: st.grade, gender: st.gender, dnc, what: `flow ${n}` });
    }
    await push('flows', flows, new Date(Date.now() - 20_000).toISOString());

    for (const u of ['admin', ...LOGINS.map((l) => l.name)]) {
      const r = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: u, password: 'demo1234' }) });
      tokens[u] = ((await r.json()) as { token: string }).token;
    }
  }, 60_000);
  afterAll(() => {
    server?.close();
    if (saved === undefined) delete process.env['LINK_SYNC_TOKEN']; else process.env['LINK_SYNC_TOKEN'] = saved;
  });

  it('control: the planted phones really ride on the incident routes (admin sees them)', async () => {
    const jg = (await c.repos.leaders.findAll()).find((l) => l.fullName === 'James Thompson')!.id; // a junior guys leader
    const garcia = [...phones].find(([, v]) => v.what === 'William Garcia')![0];
    for (const p of ['/students', `/connections/leader/${jg}/summary`, // /at-risk rows carry no phones now (swept below all the same)
      '/link/flows', '/connections/export', `/batch?sections=students`]) {
      const r = await get(p, tokens['admin']!);
      expect([p, r.status]).toEqual([p, 200]);
      expect(/049[123]\d{6}/.test(r.text), `${p} carries phones`).toBe(true);
    }
    expect((await get('/students', tokens['admin']!)).text).toContain(garcia); // admin keeps a DNC number
    // The F-01 route as juniorguys: its own leader's summary carries in-scope numbers, never Garcia's (DNC).
    const sum = await get(`/connections/leader/${jg}/summary`, tokens['juniorguys']!);
    expect(sum.status).toBe(200);
    expect(/049[12]\d{6}/.test(sum.text)).toBe(true);
    expect(sum.text).not.toContain(garcia);
  });

  for (const login of LOGINS) {
    it(`${login.name}: no out-of-scope or DNC phone on any GET route`, async () => {
      const tok = tokens[login.name]!;
      const leaks: string[] = [];
      let ok = 0;
      for (const p of paths()) {
        const r = await get(p, tok);
        if (r.status === 200) ok++;
        for (const [phone, v] of phones) {
          if ((v.dnc || !login.sees(v.grade, v.gender)) && r.text.includes(phone)) leaks.push(`${p} -> ${v.what}${v.dnc ? ' (DNC)' : ''}`);
        }
      }
      expect(leaks).toEqual([]);
      expect(ok).toBeGreaterThan(10); // the sweep reached real payloads, not only refusals
      // ...and the login still gets its own in-scope, non-DNC numbers (the sweep is not vacuous).
      const own = [...phones].filter(([, v]) => !v.dnc && login.sees(v.grade, v.gender) && !v.what.startsWith('flow')).map(([p]) => p);
      const list = (await get('/students', tok)).text;
      expect(own.length).toBeGreaterThan(0);
      expect(own.every((p) => list.includes(p))).toBe(true);
    }, 120_000);
  }
});
