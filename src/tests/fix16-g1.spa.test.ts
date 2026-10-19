// Fix round 16 Oct 2026, lane G1 (intake + admin link page). Extract-and-run: the REAL functions from public/index.html.
import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml } from './helpers/extract-fn';

const HTML = loadIndexHtml();
const IK = ['esc', 'progBar', '_lkTime', '_lkDay', 'fmtDay', '_lkAt', '_lkSeen', '_ik', '_ikFresh', '_ikRev', '_ikSt', '_ikOldConsole', '_ikIsText', '_ikOpenAct',
  '_ikOpenOf', '_ikReasons', '_ikAct', '_ikChip', '_ikTodo', '_ikSaveBlock', '_ikTextBlock', '_ikBanner', '_ikVal', '_ikNm', '_ikNames',
  '_ikPoss', '_ikHoldText', '_ikHoldLines', '_ikHoldReason', '_ikDTag', '_ikTagHtml', '_ikPast', '_ikStepText', '_ikResultHtml', '_ikFieldLabel',
  '_ikSheetHtml', '_ikSaveOpen', '_ikAns', '_ikSeed', '_ikMob', '_ikMobText', '_ikIssueText', '_ikCompareHtml',
  '_ikRowsHtml', '_ikByOutcome', '_ikOutcomes', '_ikOutcomeLine', '_ikListPage', '_ikTidyHtml', '_ikTidyTitle', '_ikTidyList', '_ikPageHtml', '_ikPickDate', '_ikSchedule', '_ikD26', '_intakeOn', '_ikModuleOn', '_lkAdmShadowHtml'];
const CONSTS = [/^const IK_HOLD = \{[\s\S]*?\n\};/m, /^const IK_VERDICT_HOLDS = \[[^\]]*\];/m, /^const IK_ISSUE = \{[\s\S]*?\};$/m]
  .map((re) => HTML.match(re)![0]).join('\n');
const extra = (src: string) => (src.match(/^function (_ik[A-Za-z0-9]+)\(/gm) || []).map((s) => s.slice(9, -1));
// Any new _ik helper this lane adds is picked up too (only those not already listed and present in the HTML).
const NEW = ['_ikNameChanges', '_ikWhenMs', '_ikResultLine'].filter((n) => extra(HTML).includes(n));

function env(o: { tab?: string; date?: string | null } = {}) {
  const calls = { modals: [] as string[], timers: [] as number[], cbs: [] as Array<() => void>, loads: 0, vis: 'visible' };
  const prelude = `
    const __calls = globalThis.__g1;
    const S = { user: { id: 'u1', role: 'admin' }, page: 'link-intake', settings: { ministryConfig: { modules: { intakeAdmin: 'on' } } } };
    const LINK = { ik: null, status: null, adm: { shadow: null, sErr: null, sDate: '2026-10-09' } };
    ${CONSTS}
    const localStorage = { getItem: () => null, setItem() {} };
    const document = { get visibilityState() { return __calls.vis; } };
    const modal = (h) => __calls.modals.push(h);
    const icS = (k) => '<svg data-ic="' + k + '"></svg>';
    const helpTip = () => '';
    const navPush = () => {};
    const setTimeout = (f, ms) => { __calls.timers.push(ms); __calls.cbs.push(f); return 1; };
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
  grade: null, gender: null, age: null, steps: [step({ key: 'approve:student:' + P(1) }), step({ key: 'approve:parent:' + P(2), role: 'parent' })], extras: [], kept: [], dropped: [], links: [], ...o });
const DET = (d: any = DETAIL()) => ({ row: { key: P(1), status: 'ready', title: 'Tom LEstrange' }, detail: d, unreadable: false, actions: [] });
const LIST = (o: any = {}) => ({ date: '2026-10-09', takenAt: new Date().toISOString(), stale: false, cut: false, rows: [], ...o });

describe('F-14 Save sheet names each name field that changes', () => {
  it('a profile renamed by the form shows "Surname: Strange [arrow] LEstrange" for each person', () => {
    const { f, I, calls } = env({ tab: 'intake', date: '2026-10-09' });
    I.det = DET(); I.list = LIST(); I.head = ST();
    f._ikSaveOpen();
    const h = calls.modals[0]!;
    expect(h).toContain('Surname: Strange <svg data-ic="arrr"></svg> LEstrange');
    expect(h).toContain('Parent surname: Strange <svg data-ic="arrr"></svg> LEstrange');
  });
  it('review r1: no line when the form is already approved (no approve step left), e.g. Tom re-save', () => {
    const { f } = env();
    const done = DETAIL({ steps: [step({ key: 'approve:student:' + P(1), state: 'done' }), step({ key: 'approve:parent:' + P(2), role: 'parent', state: 'done' })] });
    expect(f._ikNameChanges(done, {})).toEqual([]);
    const parentOnly = DETAIL({ steps: [step({ key: 'approve:parent:' + P(2), role: 'parent' })] });
    expect(f._ikNameChanges(parentOnly, {})).toEqual([['Parent surname', 'Strange', 'LEstrange']]);
  });
  it('no line when the names already agree, or when the person gets a new profile', () => {
    const { f } = env();
    expect(f._ikNameChanges(DETAIL({ profiles: { student: { id: P(5), name: 'Tom LEstrange', archived: false }, parent: null } }), {})).toEqual([]);
    const d = DETAIL({ steps: [step({ key: 'approveNew:student:' + P(1), action: 'approveNew' })], profiles: { student: { id: P(5), name: 'Tom Strange', archived: false }, parent: null } });
    expect(f._ikNameChanges(d, {})).toEqual([]);
    expect(f._ikNameChanges(DETAIL({ profiles: { student: { id: P(5), name: 'Thomas LEstrange', archived: false }, parent: null } }), {})).toEqual([['First name', 'Thomas', 'Tom']]);
  });
});

describe('F-15 Save result lines are plain and counted', () => {
  const at = new Date().toISOString();
  it('maps each reported step to a plain past-tense line, with no raw keys, and counts only what was made', () => {
    const { f } = env();
    const d = DETAIL({ steps: [] }); // the plan moved on: the result keys are no longer in it
    const a = { id: P(9), type: 'intakeSave', status: 'sent', steps: [
      { key: 'approve:student:' + P(1), action: 'approve', role: 'student', outcome: 'confirmed', at },
      { key: 'approve:student:' + P(1), action: 'approve', role: 'student', outcome: 'confirmed', at },
      { key: 'complete:parent:' + P(2), action: 'complete', role: 'parent', outcome: 'confirmed', at },
      { key: 'note:parent:' + P(2), action: 'note', role: 'parent', outcome: 'not-sent', at: null }], stop: { code: 'stuck', text: 'Stopped: Elvanto was slow.' } };
    const t = strip(f._ikResultHtml(a, d, ST()));
    expect(t).not.toMatch(/approve:|complete:|note:/);
    expect(t).toMatch(/Approved Tom's form \d+:\d\d (am|pm)/);
    expect(t).toMatch(/Parent texted \d+:\d\d (am|pm)/);
    expect(t.match(/Approved Tom's form/g)!.length).toBe(1); // a repeated step shows once
    expect(t).toContain('Made 2 changes');
    expect(t).toContain('Not sent: Add a note to the parent');
    expect(t.match(/Stopped: Elvanto was slow\./g)!.length).toBe(1);
  });
});

// F-16's text card was deleted by I8 (R2-G4, 2026-10-17): the parent text is sent from Flow steps.
describe('F-17 the late-text hold is one plain sentence, shown once', () => {
  it('says when the parent was texted and which week it missed; the Save reason does not repeat it', () => {
    const { f, I } = env({ tab: 'consent', date: '2026-10-09' });
    const d = { key: P(1), status: 'needs-you', title: 'Tom LEstrange', holds: [{ role: 'student', text: 'Parent texted late (09/10/2026)? Check in Elvanto' }],
      outcome: '', consent: null, consentNote: '', textedOn: null, profiles: { student: null }, steps: [], links: [] };
    const want = 'Parent texted Fri 9 Oct, too late for the Fri 2 Oct week. Look in Elvanto before saving.';
    expect(f._ikHoldLines(d)).toEqual([want]);
    I.head = ST();
    const why = f._ikSaveBlock({ row: { key: P(1), status: 'needs-you' }, detail: d, actions: [] }, LIST(), ST());
    expect(why).toBe('Sort the line at the top first.');
    expect(why).not.toContain('texted');
  });
});

describe('F-19 a failed date load offers Try again, never an endless Loading', () => {
  it('an error with no list renders Try again, not the Loading bar', () => {
    const { f, I } = env({ tab: 'intake', date: '2026-10-09' });
    I.dates = [{ date: '2026-10-09', counts: {} }]; I.head = ST(); I.err = "Can't reach the server"; I.list = null;
    const h = f._ikListPage();
    expect(h).toContain('Try again');
    expect(h).not.toContain('Loading');
  });
  it('re-tapping the same date after a failure loads it again', () => {
    const { f, I, calls } = env({ tab: 'intake', date: '2026-10-09' });
    I.dates = [{ date: '2026-10-09' }]; I.list = null;
    f._ikPickDate(0);
    expect(calls.loads).toBe(1);
  });
});

describe('F-24(b) one name: New youth & consent', () => {
  it('the tab is "New youth" and the page title is "New youth & consent"', async () => {
    const { f, I } = env({ tab: 'intake', date: null });
    I.dates = []; I.head = ST();
    const h = f._ikListPage();
    expect(h).toContain('>New youth<');
    expect(h).not.toContain('Intakes');
    const { extractFn } = await import('./helpers/extract-fn');
    const r = extractFn(HTML, 'renderLinkIntake');
    expect(r).toContain('New youth &amp; consent');
    expect(r).not.toContain('Form Approve');
  });
});

describe('F-32(a) console messages', () => {
  it('the out-of-date console line points at New youth on the console PC, not a missing tab', () => {
    const { f } = env();
    expect(f._ikOldConsole()).toBe('Console out of date: use New youth on the console PC');
    expect(HTML).not.toContain('Youth intake tab');
  });
  it('a refusal shows the app\'s own sentence for the reason before the console detail', () => {
    const { f } = env();
    const a = { id: P(9), type: 'intakeSave', status: 'refused', reason: 'locked', detail: 'Not sent: locked by the console' };
    expect(f._ikChip({ actions: [a] }, ST()).line).toBe("This isn't connected yet. Do it in Elvanto.");
    expect(f._ikChip({ actions: [{ ...a, reason: 'weird' }] }, ST()).line).toBe('Not sent: locked by the console');
  });
});

describe('F-41 the Keep as is button stays short (fits at 360 px)', () => {
  it('the button says only "Keep as is"; the explanation is a line below it', () => {
    const { f } = env();
    const iss = { key: 'parentPhone', msg: 'Forms disagree', suggest: '', advisory: false, keep: { field: 'parentPhone', value: '0412999111' } };
    const d = DETAIL({ forms: { student: form(P(1), { values: { first: 'Tom', last: 'LEstrange', mobile: '0412345678', gender: 'Male', parentPhone: '0412000000' }, issues: [iss] }),
      parent: form(P(2), { values: { first: 'Ree', last: 'LEstrange', mobile: '0412999111', gender: 'Female' } }) } });
    const h = f._ikCompareHtml(d, { keeps: {} });
    const btn = /<button[^>]*_ikKeep[^>]*>([^<]*)<\/button>/.exec(h)!;
    expect(btn[1]).toBe('Keep as is');
    expect(h).toContain(`<div class="ik-line">The text goes to the parent form's mobile.</div>`);
  });
});

describe('F-46(b) plain words: no "stale", no "Plan", no "Shadow check"', () => {
  it('an old plan says "Over 2 hours old. Tap Refresh." everywhere, and the list says "old"', () => {
    const { f, I } = env({ tab: 'intake', date: '2026-10-09' });
    const old = LIST({ stale: true, takenAt: new Date(Date.now() - 3 * 36e5).toISOString() });
    const want = 'Over 2 hours old. Tap Refresh.';
    expect(f._ikSaveBlock(DET(), old, ST())).toBe(want);
    expect(f._ikTextBlock(DET(), old, ST())).toBe(want);
    expect(strip(f._ikBanner(ST(), old, 'intake'))).toContain(want);
    I.dates = [{ date: '2026-10-09' }]; I.head = ST(); I.list = old;
    const t = strip(f._ikListPage());
    expect(t).toMatch(/Checked .* · old/);
    expect(t).not.toMatch(/stale|Plan /);
  });
  it('the admin link page calls the check "Kiosk vs app check"', () => {
    const { f } = env();
    expect(f._lkAdmShadowHtml()).toContain('Kiosk vs app check');
    expect(f._lkAdmShadowHtml()).not.toContain('Shadow check');
  });
});

describe('F-47(c) no per-row "console last seen" (the banner already says it)', () => {
  it('a pending row and a pending result say only that they wait', () => {
    const { f } = env();
    const off = ST({ online: false, lastSeenAt: new Date(Date.now() - 36e5).toISOString() });
    const a = { id: P(9), type: 'intakeSave', status: 'pending' };
    expect(f._ikChip({ actions: [a] }, off).line).toBe('Waiting for the console.');
    expect(strip(f._ikResultHtml(a, null, off))).toBe('Pending');
  });
});

describe('GAP-2 a pending intake row polls every 5 s, and keeps polling after the phone was away', () => {
  it('polls at 5 s while something is pending', () => {
    const { f, I, calls } = env({ tab: 'intake', date: '2026-10-09' });
    I.det = { ...DET(), actions: [{ id: P(9), type: 'intakeText', status: 'pending' }] };
    f._ikSchedule();
    expect(calls.timers).toContain(5000);
  });
  it('a poll that fires while the app is hidden re-arms, so the result shows within ~5 s of coming back (was the 60 s tick)', () => {
    const { f, I, calls } = env({ tab: 'intake', date: '2026-10-09' });
    I.det = { ...DET(), actions: [{ id: P(9), type: 'intakeText', status: 'pending' }] };
    f._ikSchedule();
    calls.vis = 'hidden';
    calls.cbs.shift()!();
    expect(calls.loads).toBe(0);
    expect(calls.cbs.length).toBe(1); // re-armed
    calls.vis = 'visible';
    calls.cbs.shift()!();
    expect(calls.loads).toBe(1);
  });
});

describe('review r1: picking a date clears the old error', () => {
  it('after a failed load, another date shows Loading, not the stale error / Try again', () => {
    const { f, I } = env({ tab: 'intake', date: '2026-10-09' });
    I.dates = [{ date: '2026-10-09' }, { date: '2026-10-02' }]; I.head = ST(); I.err = "Can't reach the server"; I.list = null;
    f._ikPickDate(1);
    expect(I.err).toBe(null);
    expect(f._ikListPage()).not.toContain('Try again');
  });
});

describe('review r1: failed result lines use the step wording, not the past tense', () => {
  it('a not-sent step reads "Not sent: Add note to parent", never "Not sent: Added..."', () => {
    const { f } = env();
    const d = DETAIL({ steps: [step({ key: 'note:parent:' + P(2), action: 'note', role: 'parent', text: 'Add note to parent' })] });
    const a = { id: P(9), type: 'intakeSave', status: 'sent', steps: [{ key: 'note:parent:' + P(2), action: 'note', role: 'parent', outcome: 'not-sent', at: null },
      { key: 'gone', action: 'category', role: 'parent', outcome: 'unconfirmed', at: null }] };
    const t = strip(f._ikResultHtml(a, d, ST()));
    expect(t).toContain('Not sent: Add note to parent');
    expect(t).toContain('Not sure it saved: Set the parent to Affiliate');
    expect(t).not.toMatch(/Not sent: Added|Not sure it saved: Set the parent to Affiliate\b.*Set/);
  });
});
