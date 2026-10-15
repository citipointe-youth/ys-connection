// Fix round 16 Oct 2026, lane G1 (intake + admin link page). Extract-and-run: the REAL functions from public/index.html.
import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml } from './helpers/extract-fn';

const HTML = loadIndexHtml();
const IK = ['esc', 'progBar', '_lkTime', '_lkDay', '_lkAt', '_lkSeen', '_ik', '_ikFresh', '_ikRev', '_ikSt', '_ikOldConsole', '_ikIsText', '_ikOpenAct',
  '_ikOpenOf', '_ikAge', '_ikReasons', '_ikAct', '_ikChip', '_ikTodo', '_ikSaveBlock', '_ikTextBlock', '_ikBanner', '_ikVal', '_ikNm', '_ikNames',
  '_ikPoss', '_ikHoldText', '_ikHoldLines', '_ikHoldReason', '_ikDTag', '_ikTagHtml', '_ikPast', '_ikStepText', '_ikResultHtml', '_ikFieldLabel',
  '_ikSheetHtml', '_ikSaveOpen', '_ikAns', '_ikSeed', '_ikMob', '_ikMobText', '_ikIssueText', '_ikCompareHtml', '_ikKv', '_ikTextCardHtml',
  '_ikRowsHtml', '_ikListPage', '_ikPageHtml', '_ikPickDate', '_ikSchedule', '_ikD26', '_intakeOn', '_ikModuleOn', '_lkAdmShadowHtml'];
const CONSTS = [/^const IK_HOLD = \{[\s\S]*?\n\};/m, /^const IK_VERDICT_HOLDS = \[[^\]]*\];/m, /^const IK_ISSUE = \{[\s\S]*?\};$/m]
  .map((re) => HTML.match(re)![0]).join('\n');
const extra = (src: string) => (src.match(/^function (_ik[A-Za-z0-9]+)\(/gm) || []).map((s) => s.slice(9, -1));
// Any new _ik helper this lane adds is picked up too (only those not already listed and present in the HTML).
const NEW = ['_ikNameChanges', '_ikWhenMs', '_ikResultLine'].filter((n) => extra(HTML).includes(n));

function env(o: { tab?: string; date?: string | null } = {}) {
  const calls = { modals: [] as string[], timers: [] as number[], loads: 0 };
  const prelude = `
    const __calls = globalThis.__g1;
    const S = { user: { id: 'u1', role: 'admin' }, page: 'link-intake', settings: { ministryConfig: { modules: { intakeAdmin: 'on' } } } };
    const LINK = { ik: null, status: null, adm: { shadow: null, sErr: null, sDate: '2026-10-09' } };
    ${CONSTS}
    const localStorage = { getItem: () => null, setItem() {} };
    const document = { visibilityState: 'visible' };
    const modal = (h) => __calls.modals.push(h);
    const icS = (k) => '<svg data-ic="' + k + '"></svg>';
    const helpTip = () => '';
    const navPush = () => {};
    const setTimeout = (f, ms) => { __calls.timers.push(ms); return 1; };
    const clearTimeout = () => {};
    const _ikDraw = () => {};
    const _ikLoad = () => { __calls.loads++; };
    const _ikLkPoll = () => {}; const _ikFixPoll = () => {};
    const _ikRefBar = () => ''; const _ikSubBar = () => ''; const _ikLkPage = () => ''; const _ikWeekHtml = () => '';
    const _ikConsentHelp = () => ''; const _ikConsentTag = () => null; const _ikReadyRows = () => [];
    const _ikFamilyPage = () => 'FAMILY';
    const _lkToday = () => '2026-10-16'; const _lkLastFriday = () => '2026-10-09';
  `;
  (globalThis as any).__g1 = calls;
  const f = loadFns([...IK, ...NEW], prelude, [...IK, ...NEW]);
  const I = f._ik();
  if (o.tab) I.tab = o.tab;
  if (o.date !== undefined) I.date = o.date;
  return { f, I, calls };
}
const strip = (h: string) => h.replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const P = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ST = (o: any = {}) => ({ console: { online: o.online ?? true, lastSeenAt: o.lastSeenAt ?? new Date().toISOString(), capabilities: {} }, consoleLinkRev: o.rev ?? 6 });
const step = (o: any) => ({ key: 'k', action: 'approve', role: 'student', text: 'Approve against the profile', state: 'todo', alone: false, locked: false, sms: null, alts: [], ...o });
const form = (sub: string, o: any = {}) => ({ subId: sub, status: 'pending', when: 'Fri 2 Oct 7:42pm', values: { first: 'Tom', last: 'LEstrange', mobile: '0412345678', gender: 'Male' },
  edits: {}, caps: {}, editable: [], issues: [], ...o });
const DETAIL = (o: any = {}) => ({ key: P(1), status: 'ready', title: 'Tom LEstrange', holds: [], fromApp: false, siblings: [],
  match: { kind: 'exact', parentSub: P(2), options: [] },
  forms: { student: form(P(1)), parent: form(P(2), { values: { first: 'Ree', last: 'LEstrange', mobile: '0412999111', gender: 'Female' } }) },
  verdicts: [], profiles: { student: { id: P(5), name: 'Tom Strange', archived: false }, parent: { id: P(6), name: 'Ree Strange', archived: false } },
  grade: null, gender: null, age: null, steps: [step({ key: 'approve:student:' + P(1) })], extras: [], kept: [], dropped: [], links: [], ...o });
const DET = (d: any = DETAIL()) => ({ row: { key: P(1), status: 'ready', title: 'Tom LEstrange' }, detail: d, unreadable: false, actions: [] });
const LIST = (o: any = {}) => ({ date: '2026-10-09', takenAt: new Date().toISOString(), stale: false, cut: false, rows: [], ...o });

describe('F-14 Save sheet names each name field that changes', () => {
  it('a profile renamed by the form shows "Surname: Strange → LEstrange" for each person', () => {
    const { f, I, calls } = env({ tab: 'intake', date: '2026-10-09' });
    I.det = DET(); I.list = LIST(); I.head = ST();
    f._ikSaveOpen();
    const t = strip(calls.modals[0]);
    expect(t).toContain('Surname: Strange → LEstrange');
    expect(t).toContain('Parent surname: Strange → LEstrange');
  });
  it('no line when the names already agree, or when the person gets a new profile', () => {
    const { f } = env();
    expect(f._ikNameChanges(DETAIL({ profiles: { student: { id: P(5), name: 'Tom LEstrange', archived: false }, parent: null } }), {})).toEqual([]);
    const d = DETAIL({ verdicts: [{ role: 'student', subId: P(1), chosen: 'new' }], profiles: { student: { id: P(5), name: 'Tom Strange', archived: false }, parent: null } });
    expect(f._ikNameChanges(d, {})).toEqual([]);
    expect(f._ikNameChanges(DETAIL({ profiles: { student: { id: P(5), name: 'Thomas LEstrange', archived: false }, parent: null } }), {})).toEqual(['First name: Thomas → Tom']);
  });
});
