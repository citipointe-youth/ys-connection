// T4 Intake + Consents SPA (spec 2026-10-13-intake-consent-app-spec.md §7, §10, §11, §12 item 4). Extract-and-run: the
// REAL functions from public/index.html run against small stubs (localStorage, API, modal). No server.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

const FNS = ['esc', 'progBar', '_lkTime', '_lkDay', '_lkSeen', '_lkAt', '_lkUuid', '_lkFresh', '_lkAdmFresh', '_lkSoftReset',
  '_nyModeOf', '_nyMode', '_nyOn', '_linkModeOf', '_linkOn', '_linkAdminOn', 'moreItems', 'renderLink', '_lkTickStart', '_lkStatusLoad', '_lkTick',
  '_ikFresh', '_ik', '_ikModuleOn', '_ikRev', '_intakeOn', '_ikSt', '_ikOldConsole', '_ikIsText', '_ikOpenAct', '_ikOpenOf', '_ikAge', '_ikNameChanges', '_ikWhenMs', '_ikResultLine',
  '_ikSeenLine', '_ikBanner', '_ikReasons', '_ikAct', '_ikChip', '_ikTodo', '_ikTextStep', '_ikAlone', '_ikSaveBlock', '_ikTextBlock',
  '_ikShowText', '_ikDTag', '_ikD26', '_ikTagHtml', '_ikPast', '_ikStepText', '_ikStepsHtml', '_ikResultHtml', '_ikSeed', '_ikAnswerBody',
  '_ikAns', '_ikPost', '_ikQKey', '_ikQRow', '_ikQSlot', '_ikSame', '_ikQGet', '_ikQSet', '_ikQFind', '_ikQFlush', '_ikQApply', '_ikUnlocal', '_ikOutcome', '_ikLocal', '_ikAnswerSend', '_ikForm', '_ikStudentSub', '_ikChoose', '_ikPair', '_ikPairIdx', '_ikKeep',
  '_ikFieldLabel', '_ikSheetHtml', '_ikSaveOpen', '_ikOneOpen', '_ikTextOpen', '_ikSheetGo', 'renderLinkIntake', '_ikDraw', '_ikPageHtml',
  '_ikListPage', '_ikRowsHtml', '_ikConsentHelp', '_ikFamilyPage', '_ikHead', '_ikKv', '_ikCompareHtml', '_ikMatchHtml', '_ikDiffHtml',
  '_ikLinkedLine', '_ikVerdictHtml', '_ikVal', '_ikNm', '_ikNames', '_ikPoss', '_ikHoldText', '_ikHoldLines', '_ikNext', '_ikHoldReason', '_ikConseq',
  '_ikIssueText', '_ikMob', '_ikMobText', '_ikUnkeep', '_ikPickParent', '_ikTextCardHtml', '_ikSaveHtml', '_ikFamilyHtml', '_ikConsentHtml', '_ikLoad', '_ikLoadRow', '_ikAfterLoad',
  '_ikSchedule', '_ikTab', '_ikOpen', '_ikBack', '_ikLeave',
  // R2 Consents sub-menus + R8 Save all (run 2026-10-15)
  '_ikSubBar', '_ikConsentSub', '_ikPrevWeek', '_ikWeekHtml', '_ikReturned', '_ikReadyRows', '_ikSaveAllItems', '_ikSaveAllOpen', '_ikSaveAllGo',
  '_ikLk', '_ikLkBusy', '_ikLkItem', '_ikLkGate', '_ikLkReason', '_ikLkSearch', '_ikLkKey', '_ikLkTurn', '_ikLkGo', '_ikLkErr', '_ikLkAgain',
  '_ikLkApply', '_ikLkPoll', '_ikLkPages', '_ikFormIconDefs', '_ikFormIcons', '_ikIcHtml', '_ikMisLines', '_ikLkStatusHtml', '_ikFixBanner',
  '_ikLkPage', '_ikLkResHtml', '_ikFixText', '_ikFixOpen', '_ikFixGo', '_ikFixPoll',
  // integration review fixes (run 2026-10-15)
  '_ikConsentTag', '_ikSaveAllGroups', '_ikDmy', '_ikFixChanges', '_ikDncLine',
  // L6 Unlinked consent forms (run 2026-10-15b)
  '_lkYouthFilter', '_ikClCap', '_ikClNow', '_ikClText', '_ikClRow', '_ikClOpen', '_ikClQ', '_ikClDraw', '_ikClPick', '_ikClUnlink', '_ikClGo',
  // nav/save fix round 2026-10-16: C0 still-here guard (C-B1 _ikAnswersSave, C-B4 _ikSaveAllOpen)
  '_navSnap', '_navSame', '_here', '_still'];
const HTML = loadIndexHtml();
const BODY = FNS.map((n) => extractFn(HTML, n)).join('\n');
const CONSTS = [/^const IK_FIX = \[[^\]]*\];/m, /^const IK_HOLD = \{[\s\S]*?\n\};/m, /^const IK_VERDICT_HOLDS = \[[^\]]*\];/m,
  /^const IK_ISSUE = \{[\s\S]*?\};$/m, /^const IK_CONTACT_RE = .*;$/m, /^const IK_FIX_REASON = \{[\s\S]*?\};$/m].map((re) => HTML.match(re)![0]).join('\n');

const P = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const HOSTILE = '<img src=x onerror=alert(1)>';
const NOW = Date.now();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

interface Env { role?: string; modules?: Record<string, string>; fresh?: (p: string) => any; post?: (p: string, b: any) => any; storage?: Map<string, string> }
function makeEnv(e: Env = {}) {
  const storage = e.storage ?? new Map<string, string>();
  const calls = { posts: [] as any[], fresh: [] as string[], apps: [] as string[], gos: [] as string[], modals: [] as string[], toasts: [] as string[], closed: 0 };
  const ls = { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, String(v)); }, removeItem: (k: string) => { storage.delete(k); } };
  const prelude = `
    const S = { user: { id: 'u1', role: ${JSON.stringify(e.role ?? 'admin')} }, page: 'link-intake',
      settings: { ministryConfig: { modules: Object.assign({ newYouthForms: 'off' }, ${JSON.stringify(e.modules ?? { intakeAdmin: 'on' })}) } } };
    let LINK = _lkFresh();
    const NAV = { stack: [] };
    function navPush() {}
    ${CONSTS}
    const localStorage = __ls;
    const navigator = { userAgent: 'iPhone Safari' };
    const window = { scrollTo() {} };
    const document = { getElementById: () => null, querySelector: () => null, visibilityState: 'visible' };
    const API = { post: (p, b) => __post(p, b), fresh: (p) => __fresh(p) };
    const setApp = (h) => __calls.apps.push(h);
    const shell = (h) => h;
    const go = (p) => __calls.gos.push(p);
    const toast = (m) => __calls.toasts.push(m);
    const modal = (h) => __calls.modals.push(h);
    const closeModal = () => { __calls.closed++; };
    const icS = (k) => '<svg data-ic="' + k + '"></svg>';
    const helpTip = () => '';
    const L = (k) => k;
    const _busOn = () => false;
    const _prayersOn = () => true;
    const _deviceId = () => 'dev-1';
    const _deviceLabel = () => 'iPhone';
    const _lkLastFriday = () => '2026-10-09';
    const _lkRefreshView = () => {};
    function __get() { return { S, LINK }; }
  `;
  const fresh = (p: string) => { calls.fresh.push(p); return e.fresh ? Promise.resolve(e.fresh(p)) : Promise.reject(new Error('no')); };
  const post = (p: string, b: any) => { calls.posts.push({ p, b }); return Promise.resolve(e.post ? e.post(p, b) : { results: [] }); };
  const fns = new Function('__ls', '__post', '__fresh', '__calls', `${prelude}\n${BODY}\nreturn { ${[...FNS, '__get'].join(', ')} };`)(ls, post, fresh, calls);
  return { fns, calls, storage, get: () => fns.__get() as { S: any; LINK: any } };
}

const ST = (o: { online?: boolean; rev?: number; caps?: Record<string, string>; lastSeenAt?: string | null } = {}) => ({
  console: { online: o.online ?? true, lastSeenAt: o.lastSeenAt === undefined ? iso(60_000) : o.lastSeenAt, inWindow: true, pollSeconds: 60,
    capabilities: o.caps ?? { intakeSave: 'live', intakeText: 'live', consentSave: 'live', intakeAnswer: 'live' }, consoles: 1 },
  consoleLinkRev: o.rev ?? 4, appLinkRev: 4 });
const LIST = (o: any = {}) => ({ date: '2026-10-09', takenAt: iso(10 * 60_000), stale: false, cut: false, inputs: null, refreshAskedAt: null, rows: [], ...o });
const act = (o: any) => ({ id: P(90), type: 'intakeSave', status: 'pending', reason: null, detail: null, steps: null, stop: null, createdAt: iso(1000), resultAt: null, ...o });
const step = (o: any) => ({ key: 'k', action: 'approve', role: 'student', text: 'Approve the student form', state: 'todo', alone: false, locked: false, sms: null, alts: [], ...o });
const TEXT = step({ key: 'complete:parent:' + P(2), action: 'complete', role: 'parent', text: 'Text Jo', sms: { name: 'Jo Nguyen', last3: '111' } });
const form = (sub: string, o: any = {}) => ({ subId: sub, status: 'pending', when: 'Fri 9 Oct 7:42pm', values: { first: 'Ava', last: 'nguyen', mobile: '0412345678', gender: 'Female' },
  edits: {}, caps: { last: 'Nguyen' }, editable: ['first', 'last', 'mobile'], issues: [], ...o });
const DETAIL = (o: any = {}) => ({ key: P(1), status: 'ready', title: 'Ava Nguyen', holds: [], fromApp: true, siblings: [],
  match: { kind: 'exact', parentSub: P(2), options: [{ subId: P(2), name: 'Jo Nguyen', when: 'Fri 9 Oct' }] },
  forms: { student: form(P(1)), parent: form(P(2), { values: { first: 'Jo', last: 'Nguyen', mobile: '0412999111', gender: 'Female' }, caps: {} }) },
  verdicts: [], profiles: { student: null, parent: null }, grade: null, gender: null, age: null,
  steps: [step({ key: 'approve:student:' + P(1), state: 'done' }), step({ key: 'approve:parent:' + P(2), role: 'parent', text: 'Approve the parent form' }),
    step({ key: 'category:parent:' + P(2), action: 'category', role: 'parent', text: 'Set Jo to Affiliate' }), TEXT],
  extras: [], kept: [], dropped: [], links: [['Open in Elvanto', 'https://citipointe.elvanto.com.au/admin/people/person/?id=' + P(5)]], ...o });
const DET = (o: any = {}, d: any = DETAIL()) => ({ row: { key: P(1), status: 'ready', title: 'Ava Nguyen', reason: '', fromApp: true, hasText: true, takenAt: iso(600_000) },
  detail: d, unreadable: false, actions: [], ...o });
const strip = (h: string) => h.replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ');

describe('module gating', () => {
  it('More shows Intake for the admin with module On only', () => {
    const ids = (role: string, modules: Record<string, string>) => makeEnv({ role, modules }).fns.moreItems().map((m: any) => m.id);
    expect(ids('admin', { intakeAdmin: 'on' })).toContain('link-intake');
    expect(ids('admin', { intakeAdmin: 'off' })).not.toContain('link-intake');
    expect(ids('admin', {})).not.toContain('link-intake'); // no key = off (no inheriting New person)
    for (const role of ['director', 'quad', 'grade', 'leader']) expect(ids(role, { intakeAdmin: 'on' }), role).not.toContain('link-intake');
  });
  it('renderLink bounces a non-admin or module Off home; admin + On loads the dates', async () => {
    const off = makeEnv({ modules: { intakeAdmin: 'off' } });
    await off.fns.renderLink('link-intake');
    expect(off.calls.gos).toEqual(['home']);
    const dir = makeEnv({ role: 'director' });
    await dir.fns.renderLink('link-intake');
    expect(dir.calls.gos).toEqual(['home']);
    const on = makeEnv({ fresh: (p) => (p.includes('date=') ? LIST() : { ...ST(), dates: [{ date: '2026-10-09', takenAt: iso(1000), counts: { needsYou: 1 } }] }) });
    await on.fns.renderLink('link-intake');
    expect(on.calls.gos).toEqual([]);
    expect(on.calls.fresh).toContain('/link/intake?mode=intake&view=1'); // B18: page entry marks the view
    expect(on.calls.fresh).toContain('/link/intake?mode=intake&date=2026-10-09');
    expect(on.calls.apps.length).toBe(1);
  });
  it('a console below link rev 4 shows the out-of-date banner instead of the lists, and never loads a date', async () => {
    const e = makeEnv({ fresh: () => ({ ...ST({ rev: 3 }), dates: [{ date: '2026-10-09', takenAt: iso(1000), counts: { needsYou: 0 } }] }) });
    await e.fns._ikLoad(false);
    expect(e.fns._intakeOn()).toBe(false);
    expect(strip(e.fns._ikPageHtml())).toContain('Console out of date: use New youth on the console PC');
    expect(e.calls.fresh.some((p: string) => p.includes('date='))).toBe(false);
    // and the Save reason says the same
    expect(e.fns._ikSaveBlock(DET(), LIST(), ST({ rev: 3 }))).toBe('Console out of date: use New youth on the console PC');
  });
  it('the tab is remembered per device; logout drops the intake state', () => {
    const storage = new Map([['ysc.intakeTab', 'consent']]);
    const e = makeEnv({ storage });
    expect(e.fns._ik().tab).toBe('consent');
    e.fns._ik().ans[P(1)] = { fixes: { [P(1)]: { last: 'Nguyen' } } };
    e.fns._lkSoftReset();
    expect(e.get().LINK.ik).toBe(null);
    expect([...storage.keys()]).toEqual(['ysc.intakeTab']); // no answers ever stored
  });
});

describe('chips per action status (§7.5)', () => {
  const chip = (a: any, st: any = ST()) => makeEnv().fns._ikChip({ actions: [a] }, st);
  it('pending / claimed / answer pending', () => {
    expect(chip(act({}))).toEqual({ label: 'Pending', tone: 'wait', line: 'Waiting for the console.' });
    expect(chip(act({}), ST({ online: false, lastSeenAt: iso(30_000) })).line).toBe('Waiting for the console.'); // F-47(c): no per-row last seen
    expect(chip(act({ status: 'claimed' })).line).toBe('Sending to Elvanto…');
    expect(chip(act({ type: 'intakeAnswer' }))).toEqual({ label: 'Pending', tone: 'wait', line: 'Updating plan…' });
  });
  it('claimed reads Saving, never Pending (consent-pending fix 1)', () => {
    expect(chip(act({ status: 'claimed' }))).toEqual({ label: 'Saving', tone: 'wait', line: 'Sending to Elvanto…' });
    expect(chip(act({ type: 'consentSave', status: 'claimed', createdAt: iso(40 * 60_000) }))).toEqual({ label: 'Saving', tone: 'wait', line: 'Sending to Elvanto…' });
  });
  it('pending > 15 min: online says queued behind the open saves ahead; offline keeps the old line', () => {
    const f = makeEnv().fns, old = iso(30 * 60_000);
    const mine = act({ id: P(91), type: 'consentSave', createdAt: old });
    const rows = [LROW(1, { actions: [act({ type: 'consentSave', status: 'claimed', createdAt: iso(40 * 60_000) })] }),
      LROW(2, { actions: [act({ type: 'consentSave', createdAt: iso(35 * 60_000) })] }),
      LROW(3, { actions: [mine] }),
      LROW(4, { actions: [act({ type: 'consentSave', createdAt: iso(20 * 60_000) })] }), // behind, not ahead
      LROW(5, { actions: [act({ type: 'consentSave', status: 'sent', createdAt: iso(50 * 60_000) })] })]; // done, not open
    expect(f._ikChip(rows[2], ST(), rows)).toEqual({ label: 'Pending', tone: 'wait', line: 'Queued behind 2 saves' });
    expect(f._ikChip(rows[1], ST(), rows).line).toBe('Queued behind 1 save');
    expect(f._ikChip(rows[2], ST()).line).toBe('Queued behind other saves'); // no list: n unknown
    expect(f._ikChip(rows[0], ST(), rows).label).toBe('Saving');
    expect(f._ikChip(rows[2], ST({ online: false }), rows).line).toMatch(/^Console hasn't picked this up yet \(since /);
    expect(f._ikRowsHtml(LIST({ rows }), ST(), false)).toContain('Queued behind 2 saves');
    expect(f._ikFixText({ status: 'pending', createdAt: old }, ST())).toEqual(['wait', 'Queued behind other saves.']);
    expect(f._ikClText({ status: 'pending', createdAt: old }, ST())).toEqual(['wait', 'Queued behind other saves.']);
    expect(f._ikClText({ status: 'pending', createdAt: old }, ST({ online: false }))[1]).toMatch(/^Console hasn't picked this up yet/);
  });
  it('a sent answer reads Answers saved, never Saved; the older Save behind it shows', () => {
    const e = makeEnv();
    expect(e.fns._ikChip({ actions: [act({ type: 'intakeAnswer', status: 'sent', reason: 'planned' })] }, ST())).toEqual({ label: 'Answers saved', tone: 'ok', line: 'Answers saved' });
    expect(e.fns._ikChip({ actions: [act({ type: 'intakeAnswer', status: 'sent', reason: 'planned' }), act({ status: 'shadowed' })] }, ST()).label).toBe('Practice');
  });
  it('sent, already, unclear, refused (reason wins, else the detail), shadowed', () => {
    expect(chip(act({ status: 'sent', resultAt: iso(1000) })).label).toBe('Saved');
    expect(chip(act({ status: 'sent', reason: 'already' })).line).toBe('Already in Elvanto');
    expect(chip(act({ status: 'unclear' }))).toEqual({ label: 'Unclear', tone: 'bad', line: "Not sure it saved. Check in Elvanto or the console's Unclear saves" });
    expect(chip(act({ status: 'refused', reason: 'plan-changed', detail: 'The console said this.' })).line).toBe('Something changed in Elvanto. Review the family again.');
    expect(chip(act({ status: 'refused', reason: 'weird', detail: 'The console said this.' })).line).toBe('The console said this.');
    expect(chip(act({ status: 'refused', reason: 'plan-changed' })).line).toBe('Something changed in Elvanto. Review the family again.');
    expect(chip(act({ status: 'refused', reason: 'chain-not-done' })).line).toBe('Finish saving the family before the parent text.');
    expect(chip(act({ status: 'shadowed' }))).toEqual({ label: 'Practice', tone: 'prac', line: 'Practice: nothing sent' });
    expect(chip(act({ status: 'cancelled' }))).toBe(null);
  });
  it('the list row shows the chip label and its line, escaped', () => {
    const h = makeEnv().fns._ikRowsHtml(LIST({ rows: [{ key: P(1), status: 'ready', title: 'Mia', reason: 'Mum: Jo', fromApp: true, hasText: false,
      actions: [act({ status: 'refused', detail: HOSTILE })] }] }), ST(), false);
    expect(h).toContain('From app');
    expect(h).toContain('Refused');
    expect(h).not.toContain(HOSTILE);
    expect(h).toContain('&lt;img');
  });
});

describe('Save disabled reasons', () => {
  const block = (det: any, list: any = LIST()) => makeEnv().fns._ikSaveBlock(det, list, ST());
  it('enabled for a ready, fresh family with todo steps', () => { expect(block(DET())).toBe(''); });
  it('needs-you says what holds the family (console holdReason wording)', () => {
    const nv = (holds: any[]) => block(DET({ row: { key: P(1), status: 'needs-you', title: 'A' } }, DETAIL({ status: 'needs-you', holds })));
    expect(nv([])).toBe('Sort the lines at the top first.');
    expect(nv([{ role: 'student', text: 'Same person?' }, { role: 'student', text: 'Fix the flagged items' }])).toBe('Answer the question and fix the flagged answers first.');
    expect(nv([{ role: 'student', text: 'Profile archived' }])).toBe('Unarchive the profile first.');
    expect(nv([{ role: 'pair', text: 'Waiting for parent form' }])).toBe('Sort the line at the top first.'); // F-17: the hold is already at the top
  });
  it('an answer still pending', () => { expect(block(DET({ actions: [act({ type: 'intakeAnswer' })] }))).toBe('Updating plan…'); });
  it('stale plan', () => { expect(block(DET(), LIST({ stale: true }))).toBe('Over 2 hours old. Tap Refresh.'); });
  it('an open save row for this family', () => {
    expect(block(DET({ actions: [act({ status: 'claimed' })] }))).toBe('Waiting for the console');
    expect(block(DET({ actions: [act({ type: 'intakeText' })] }))).toBe('Waiting for the console');
  });
  it('the rendered button is disabled with the reason; answers stay allowed while stale', () => {
    const e = makeEnv();
    const h = e.fns._ikFamilyHtml(DET(), LIST({ stale: true }), ST(), e.fns._ikSeed(DETAIL()));
    expect(h).toMatch(/<button[^>]*disabled[^>]*onclick="_ikSaveOpen\(\)"/);
    expect(h).toContain('Over 2 hours old. Tap Refresh.');
    expect(h).toContain('onclick="_ikPair(false)"'); // the answer controls are still there
    expect(h).not.toMatch(/disabled[^>]*onclick="_ikPair/);
  });
});

describe('Text card (R4)', () => {
  const show = (d: any, acts: any[]) => makeEnv().fns._ikShowText(d, acts);
  it('not shown while other steps are todo and no Save stopped at the text', () => {
    expect(show(DETAIL(), [])).toBe(null);
    expect(show(DETAIL(), [act({ status: 'sent', stop: { code: 'finished', text: 'Done.' } })])).toBe(null);
  });
  it('shown after a Save result with stop.code sms', () => {
    expect(show(DETAIL(), [act({ status: 'sent', stop: { code: 'sms', text: 'Stopped before the parent text.' } })])).toEqual(TEXT);
  });
  it('shown when the text is the only todo step', () => {
    const d = DETAIL({ steps: [step({ state: 'done' }), TEXT] });
    expect(show(d, [])).toEqual(TEXT);
  });
  it('hidden once a text row is pending or sent', () => {
    const d = DETAIL({ steps: [step({ state: 'done' }), TEXT] });
    expect(show(d, [act({ type: 'intakeText' })])).toBe(null);
    expect(show(d, [act({ type: 'intakeText', status: 'sent' })])).toBe(null);
  });
  it('the review renders the card with its own confirm, never inside the Save sheet', () => {
    const e = makeEnv();
    const det = DET({ actions: [act({ status: 'sent', stop: { code: 'sms', text: 'Stopped before the parent text.' }, steps: [] })] });
    const h = strip(e.fns._ikFamilyHtml(det, LIST(), ST(), e.fns._ikSeed(det.detail)));
    expect(h).toContain('Text Jo Nguyen now?');
    expect(h).toContain('ends in 111');
    expect(h).toContain("Elvanto sends the consent text. It can't be recalled.");
    expect(h).toContain('Send the text');
    const none = strip(e.fns._ikFamilyHtml(DET(), LIST(), ST(), e.fns._ikSeed(DETAIL())));
    expect(none).not.toContain('now?');
  });
});

describe('banner lines and stale greying', () => {
  const b = (st: any, list: any, tab = 'intake') => strip(makeEnv().fns._ikBanner(st, list, tab));
  it('console offline', () => {
    expect(b(ST({ online: false, lastSeenAt: iso(60_000) }), LIST())).toMatch(/The console was last seen \d+:\d\d (am|pm)\. Saves wait until it's back\./);
    expect(b(ST({ lastSeenAt: null }), LIST())).toContain('The console has not been seen yet.');
    expect(b(ST(), LIST())).not.toContain('last seen');
  });
  it('S1: no practice banner, whatever the save types say', () => {
    expect(b(ST({ caps: { intakeSave: 'shadow', intakeText: 'live', consentSave: 'shadow' } }), LIST())).not.toContain('Practice');
    expect(b(ST({ caps: { intakeSave: 'live', consentSave: 'shadow' } }), LIST(), 'consent')).not.toContain('Practice');
  });
  it('stale age, cut, answers last changed in the console', () => {
    expect(b(ST(), LIST({ stale: true, takenAt: iso((2 * 60 + 10) * 60_000 + 5000) }))).toContain('Over 2 hours old. Tap Refresh.');
    expect(b(ST(), LIST({ cut: true }))).toContain('Some forms were cut off: every family needs a look');
    expect(b(ST(), LIST({ inputs: { from: 'console', at: iso(60_000) } }))).not.toContain('Answers last changed'); // dropped 2026-10-14
  });
  it('a stale list is greyed; a fresh one is not', () => {
    const rows = [{ key: P(1), status: 'needs-you', title: 'Ava', reason: 'Check the match', fromApp: false, hasText: false, actions: [] }];
    const e = makeEnv();
    expect(e.fns._ikRowsHtml(LIST({ stale: true, rows }), ST(), false)).toContain('ik-grey');
    expect(e.fns._ikRowsHtml(LIST({ rows }), ST(), false)).not.toContain('ik-grey');
    expect(strip(e.fns._ikRowsHtml(LIST({ rows }), ST(), false))).toContain('Needs you (1)');
  });
  it('T6/T14: an empty Consents date says repliers show early; Intakes keeps its wording', () => {
    const e = makeEnv();
    expect(e.fns._ikRowsHtml(LIST({ rows: [] }), ST(), false)).toContain('No families for this date.');
    e.fns._ik().tab = 'consent';
    expect(e.fns._ikRowsHtml(LIST({ rows: [] }), ST(), false)).toContain('Parents who reply show here straight away. Everyone else is added at 9am Friday.');
  });
});

describe('escaping (§11)', () => {
  it('a hostile title, hold, value, step text and name render inert', () => {
    const e = makeEnv();
    const d = DETAIL({ title: HOSTILE, holds: [{ role: 'pair', text: HOSTILE }],
      forms: { student: form(P(1), { values: { first: HOSTILE, last: 'x', mobile: '1', gender: 'F' }, issues: [{ key: 'first', msg: HOSTILE, suggest: HOSTILE, advisory: false, keep: null }] }), parent: null },
      verdicts: [{ role: 'student', subId: P(1), verdict: 'unsure', chosen: null, options: ['same', 'new', P(7)], linked: { name: HOSTILE, age: 15, archived: false },
        candidates: [{ id: P(7), name: HOSTILE, age: 14, archived: true, verdict: 'unsure', diff: [{ label: HOSTILE, a: HOSTILE, b: '1' }] }], diff: [] }],
      steps: [step({ text: HOSTILE }), { ...TEXT, sms: { name: HOSTILE, last3: '111' } }] });
    const det = DET({ row: { key: P(1), status: 'needs-you', title: HOSTILE }, actions: [act({ status: 'sent', stop: { code: 'sms', text: HOSTILE }, steps: [] })] }, d);
    const h = e.fns._ikFamilyHtml(det, LIST(), ST(), e.fns._ikSeed(d));
    expect(h).not.toContain(HOSTILE);
    expect(h).toContain('&lt;img src=x onerror=alert(1)&gt;');
    const rows = e.fns._ikRowsHtml(LIST({ rows: [{ key: P(1), status: 'ready', title: HOSTILE, reason: HOSTILE, fromApp: false, hasText: false, actions: [] }] }), ST(), false);
    expect(rows).not.toContain(HOSTILE);
    // ids and step keys never reach an onclick: only indexes do
    expect(h).not.toContain(P(1) + "'");
    expect(h).not.toContain('complete:parent:');
  });
  it('an error message is escaped on the page', async () => {
    const e = makeEnv({ fresh: () => { throw new Error(HOSTILE); } });
    await e.fns._ikLoad(false);
    const h = e.fns._ikPageHtml();
    expect(h).not.toContain(HOSTILE);
    expect(h).toContain('&lt;img');
  });
});

describe('answers and saves go straight to /link/batch (never the phone queue)', () => {
  it('the answer body carries the whole set; fixes travel in the note; undo empties them', () => {
    const e = makeEnv();
    const d = DETAIL({ match: { kind: 'manual', parentSub: P(2), options: [] }, verdicts: [{ role: 'student', subId: P(1), verdict: 'same', chosen: 'same', options: ['same', 'new'], linked: null, candidates: [], diff: [] }],
      forms: { student: form(P(1), { edits: { last: 'Nguyen' } }), parent: form(P(2)) } });
    const a = e.fns._ikSeed(d, null);
    expect(a).toEqual({ choices: { [P(1)]: 'same' }, pairs: { [P(1)]: P(2) }, fixes: { [P(1)]: { last: 'Nguyen' } }, keeps: {} });
    const body = e.fns._ikAnswerBody('2026-10-09', P(1), d, a, false);
    expect(body.payload).toEqual({ date: '2026-10-09', family: [P(1), P(2)], choices: { [P(1)]: 'same' }, pairs: { [P(1)]: P(2) }, undo: false });
    expect(JSON.parse(body.note)).toEqual({ fixes: { [P(1)]: { last: 'Nguyen' } }, keeps: {} });
    const undo = e.fns._ikAnswerBody('2026-10-09', P(1), d, a, true);
    expect(undo.note).toBe(null);
    expect(undo.payload.undo).toBe(true);
    a.pairs[P(1)] = 'none';
    expect(e.fns._ikAnswerBody('2026-10-09', P(1), d, a, false).payload.family).toEqual([P(1)]);
  });
  it('a new answer is one item (S-4: the server supersedes the still-pending one); nothing is left in localStorage', async () => {
    const e = makeEnv({ post: (_p, b) => ({ results: b.items.map((it: any) => ({ id: it.id, kind: it.kind, outcome: it.kind === 'cancel' ? 'cancelled' : 'saved' })) }) });
    const I = e.fns._ik();
    I.date = '2026-10-09'; I.key = P(1);
    I.det = DET({ actions: [act({ id: P(80), type: 'intakeAnswer' })] });
    e.fns._ikChoose(0, 0); // no verdicts: ignored
    expect(e.calls.posts.length).toBe(0);
    await e.fns._ikAnswerSend(false);
    expect(e.calls.posts.length).toBe(1);
    const { p, b } = e.calls.posts[0];
    expect(p).toBe('/link/batch');
    expect(b.items).toHaveLength(1); // S-4: no client {kind:'cancel'}; n6 insertAction supersede cancels P(80) in one transaction
    expect(b.items[0]).toMatchObject({ kind: 'action', type: 'intakeAnswer', leaderId: null, payload: { date: '2026-10-09', family: [P(1), P(2)], undo: false } });
    expect(b.device).toEqual({ id: 'dev-1', label: 'iPhone' });
    expect([...e.storage.keys()]).toEqual([]);
    expect(I.det.actions[0]).toMatchObject({ type: 'intakeAnswer', status: 'pending' }); // shown as Updating plan at once
  });
  it('Save sheet: only todo, non-text steps, the D25 sentence (no code), parent text separate; Save sends those keys verbatim', async () => {
    const e = makeEnv({ post: (_p, b) => ({ results: [{ id: b.items[0].id, kind: 'action', outcome: 'saved' }] }), fresh: () => Promise.reject(new Error('x')) });
    const I = e.fns._ik();
    I.date = '2026-10-09'; I.key = P(1); I.head = ST(); I.list = LIST(); I.det = DET();
    e.fns._ikSaveOpen();
    const sheet = strip(e.calls.modals[0]!);
    expect(sheet).toContain("Save Ava Nguyen's family to Elvanto?");
    expect(sheet).toContain('Approve the parent form');
    expect(sheet).toContain('Set Jo to Affiliate');
    expect(sheet).not.toContain('D25');
    expect(sheet).toContain('Provisional rule: New People or Inactive parents become Affiliate.');
    expect(sheet).toContain('The parent text is separate.');
    expect(sheet).not.toContain('Approve the student form'); // done
    expect(sheet).not.toContain('Text Jo');
    await e.fns._ikSheetGo();
    const it = e.calls.posts[0].b.items[0];
    expect(it).toMatchObject({ kind: 'action', type: 'intakeSave', note: null,
      payload: { date: '2026-10-09', row: P(1), confirmed: ['approve:parent:' + P(2), 'category:parent:' + P(2)], one: false } });
  });
  it('a stale plan never opens the Save sheet', () => {
    const e = makeEnv();
    const I = e.fns._ik();
    I.date = '2026-10-09'; I.key = P(1); I.head = ST(); I.list = LIST({ stale: true }); I.det = DET();
    e.fns._ikSaveOpen();
    expect(e.calls.modals.length).toBe(0);
  });
});

describe('results and consents', () => {
  it('per-step result lines', () => {
    const e = makeEnv();
    const a = act({ status: 'unclear', stop: { code: 'not-confirmed', text: 'Stopped: not confirmed.' }, steps: [
      { key: 'approve:parent:' + P(2), action: 'approve', role: 'parent', outcome: 'confirmed', at: iso(1000) },
      { key: 'category:parent:' + P(2), action: 'category', role: 'parent', outcome: 'unconfirmed', at: null },
      { key: 'x', action: 'note', role: 'parent', outcome: 'not-sent', at: null }] });
    const h = strip(e.fns._ikResultHtml(a, DETAIL(), ST()));
    expect(h).toContain('Made 1 change'); // F-15: plain past-tense lines, counted
    expect(h).toMatch(/Approved Jo's form \d+:\d\d (am|pm)/);
    expect(h).toContain('Not sure it saved: Set Jo to Affiliate');
    expect(h).toContain('Not sent: Add a note to the parent');
    expect(h).toContain('Stopped: not confirmed.');
  });
  it('the consent detail shows the outcome with no ruling codes; the D26 and D20(b) sentences are on the Save sheet only', () => {
    const e = makeEnv({ fresh: () => Promise.reject(new Error('x')) });
    const d = { key: P(3), status: 'ready', title: 'Ava Nguyen', holds: [], outcome: 'No reply: assume consent', consent: { ymd: '2026-10-08', contact: false, total: '' },
      consentNote: '', textedOn: '2026-10-03', profiles: { student: null }, links: [],
      steps: [step({ key: 'cnr:' + P(3), action: 'consentNotReceived', role: 'consent', text: 'Mark consent not received' })] };
    const det = { row: { key: P(3), status: 'ready', title: 'Ava Nguyen' }, detail: d, unreadable: false, actions: [] };
    const h = strip(e.fns._ikConsentHtml(det, LIST(), ST()));
    expect(h).toContain('Consent form Thu 8 Oct: No reply: assume consent');
    expect(h).toContain('Texted on Sat 3 Oct');
    expect(h).toContain('Ava Nguyen (student)');
    expect(h).not.toMatch(/D26|D20\(b\)|Provisional/);
    const I = e.fns._ik();
    I.tab = 'consent'; I.date = '2026-10-09'; I.key = P(3); I.head = ST(); I.list = LIST(); I.det = det;
    e.fns._ikSaveOpen();
    const sheet = strip(e.calls.modals[0]!);
    expect(sheet).toContain('Provisional: this re-saves the whole profile form.');
    expect(sheet).toContain('Assume consent only where the parent was texted before the Monday after the intake Friday, and no unmatched form came in.');
    expect(sheet).not.toMatch(/D26|D20\(b\)/);
  });
});

describe('Form Approve & Consent review (spec 2026-10-14)', () => {
  const fam = (d: any, o: any = {}) => { const e = makeEnv(); const det = DET(o, d); return strip(e.fns._ikFamilyHtml(det, LIST(), ST(), e.fns._ikSeed(d))); };
  const raw = (d: any) => { const e = makeEnv(); return e.fns._ikFamilyHtml(DET({}, d), LIST(), ST(), e.fns._ikSeed(d)); };
  it('the two forms side by side: headings with when, values in force, the parent mismatch highlighted', () => {
    const d = DETAIL({ forms: { student: form(P(1), { values: { first: 'Ava', last: 'nguyen', mobile: '0412345678', gender: 'Female', parentName: 'Jo Nguyen', parentPhone: '0412 999 000' } }),
      parent: form(P(2), { values: { first: 'Jo', last: 'Nguyen', mobile: '0412999111', gender: 'Female' }, caps: {}, status: 'approved' }) } });
    const h = raw(d), t = strip(h);
    expect(h).toContain('<table class="ik-cmp">');
    expect(t).toContain('Student form Fri 9 Oct 7:42pm');
    expect(t).toContain('Parent form Fri 9 Oct 7:42pm · Approved');
    expect(t).toContain('Last name Nguyen Nguyen'); // the tidy-up in force, beside the parent's own
    expect(t).toContain('Mobile 0412 345 678 0412 999 111');
    expect(h).toMatch(/<tr class="ik-diff"><th scope="row">Parent&#39;s mobile<span class="ik-dflag">Differs<\/span>/);
    expect(h).not.toMatch(/<tr class="ik-diff"><th scope="row">Parent&#39;s name/); // Jo Nguyen = Jo Nguyen
    expect(t).toContain("Matched with Jo Nguyen's parent form.");
  });
  it('no editable cells: no fix sheet, no Undo my changes, no tappable values', () => {
    const h = raw(DETAIL());
    expect(h).not.toContain('_ikFix');
    expect(h).not.toContain('Undo my changes');
    expect(h).not.toContain('Your fix');
  });
  it('a flagged answer says what is wrong under it; Keep as is sits on its own row and Undo keep follows a keep', () => {
    const iss = { key: 'parentPhone', msg: 'Forms disagree', suggest: '', advisory: false, keep: { field: 'parentPhone', value: '0412999000' } };
    const d = DETAIL({ status: 'needs-you', holds: [{ role: 'student', text: 'Fix the flagged items' }],
      forms: { student: form(P(1), { values: { first: 'Ava', last: 'Nguyen', mobile: '0412345678', gender: 'F', parentName: 'Jo', parentPhone: '0412999000' }, issues: [iss] }),
        parent: form(P(2), { values: { first: 'Jo', last: 'Nguyen', mobile: '0412999111', gender: 'F' }, caps: {} }) } });
    const h = raw(d), t = strip(h);
    expect(h).toContain('class="ik-flag"');
    expect(t).toContain("Parent's mobile on the student form doesn't match the Mobile on the parent form");
    expect(h).toContain('onclick="_ikKeep(0,0)">Keep as is<'); // F-41: short button, the explanation is a line below
    expect(h).toContain(`<div class="ik-line">The text goes to the parent form's mobile.</div>`);
    expect(t).toContain('Student: Fix the answers marked below in the console or Elvanto.');
    expect(t).toContain("Matched with Jo Nguyen's parent form (mobiles differ).");
    const e = makeEnv(), a = e.fns._ikSeed(d);
    a.keeps[P(1)] = { parentPhone: '0412999000' };
    const k = e.fns._ikFamilyHtml(DET({}, d), LIST(), ST(), a);
    expect(strip(k)).toContain("Kept as is. The parent text goes to the parent form's mobile.");
    expect(k).toContain('onclick="_ikUnkeep(0,0)">Undo keep');
  });
  it('each column carries its own Elvanto links: the form and the profile (by name, archived marked)', () => {
    const base = 'https://citipointe.elvanto.com.au/admin/';
    const d = DETAIL({ profiles: { student: { id: P(5), name: 'Ava Nguyen', archived: true }, parent: null },
      links: [['Student form · Fri 9 Oct', base + 'forms/form_submission/?id=' + P(1)], ['Student profile', base + 'people/person/?id=' + P(5)],
        ['Parent form · Fri 9 Oct', base + 'forms/form_submission/?id=' + P(2)], ['Bad', 'javascript:alert(1)']] });
    const h = raw(d);
    expect(h).toMatch(/<th scope="row">In Elvanto<\/th><td><a [^>]+>Form<\/a><a [^>]+>Ava Nguyen \(archived\)<\/a><\/td><td><a [^>]+>Form<\/a><\/td>/);
    expect(h).toContain('target="_blank" rel="noopener"');
    expect(h).not.toContain('javascript:');
  });
  it('a waiting student shows one column; student-only rows span it', () => {
    const d = DETAIL({ status: 'needs-you', holds: [{ role: 'pair', text: 'Waiting for parent form' }], match: { kind: null, parentSub: null, options: [] },
      forms: { student: form(P(1), { values: { first: 'Ava', last: 'Nguyen', mobile: '0412345678', gender: 'F', birthday: '03/04/2011' } }), parent: null } });
    const h = raw(d), t = strip(h);
    expect(h).toContain('ik-cmp ik-one');
    expect(t).toContain('No parent form matched.');
    expect(t).toContain("Waiting for parent form. Nothing is saved for this student until their parent's form comes in.");
    expect(t).not.toContain('Before this family can be saved');
  });
  it('the verdict is asked as a sentence, in the console wording, with no codes', () => {
    const d = DETAIL({ status: 'needs-you', holds: [{ role: 'student', text: 'Same person?' }],
      verdicts: [{ role: 'student', subId: P(1), verdict: 'unsure', chosen: null, options: ['same', 'new'], linked: { name: 'Ava Nguyen', age: 14, archived: false }, candidates: [], diff: [] }] });
    const t = fam(d, { row: { key: P(1), status: 'needs-you', title: 'Ava Nguyen' } });
    expect(t).toContain("Is this the same Ava who's already in Elvanto?");
    expect(t).toContain('Ava Nguyen, 14');
    expect(t).toContain('Yes, same person');
    expect(t).toContain('No, someone new (new profile)');
    expect(t).toContain('Before this family can be saved, answer the question below.');
    expect(t).not.toMatch(/D17|is linked to|active/);
  });
  it('steps: to-dos first by person, done ones under Already done, console chips', () => {
    const d = DETAIL({ steps: [step({ key: 'a', state: 'done', text: 'Approve the student form' }), step({ key: 'b', role: 'parent', text: 'Approve the parent form', locked: true }), TEXT] });
    const h = raw(d), t = strip(h);
    expect(t).toContain('What saving does');
    expect(t).toContain('Jo Nguyen (parent) Approve the parent form Do in Elvanto Text Jo Nguyen (…111) Asked separately');
    expect(h).toMatch(/<details class="lk-done"><summary>Already done \(1\)/);
    expect(t).toContain('Approved the student form');
    expect(t).not.toMatch(/own confirm|not connected|waits/);
  });
  it('chain steps have no one-step buttons; an extra keeps its own, named for Elvanto; Save says what it will do', () => {
    const d = DETAIL({ steps: [step({ key: 'x', role: 'parent', alone: true, text: 'Approve the parent form' }), TEXT],
      extras: [{ ...step({ key: 'g', action: 'setField', text: "Set Ava's grade to 8" }), field: 'grade', value: '8' }] });
    const h = raw(d), t = strip(h);
    expect(h.match(/_ikOneOpen\(/g)!.length).toBe(1);
    expect(t).toContain("Set Ava's grade to 8 in Elvanto");
    expect(t).toContain("Makes 1 change for Ava Nguyen's family, then asks about the parent text. You'll confirm first.");
  });
});

// ── R2 Consents sub-menus + R8 Save all (run 2026-10-15) ──
const ST6 = (caps: Record<string, string> = {}) => ST({ rev: 6, caps: { intakeSave: 'live', intakeText: 'live', consentSave: 'live', intakeAnswer: 'live', consentLookup: 'live', consentFix: 'locked', ...caps } });
const LROW = (n: number, o: any = {}) => ({ key: P(n), status: 'ready', title: 'Kid ' + n, reason: '', outcome: 'Contact allowed', fromApp: false, hasText: false, actions: [], ...o });

describe('consents sub-menus (R2)', () => {
  const consentEnv = () => makeEnv({ storage: new Map([['ysc.intakeTab', 'consent']]), fresh: (p) => (p.includes('date=')
    ? { ...ST6(), ...LIST({ date: '2026-10-16', rows: [LROW(1), LROW(2, { outcome: 'No reply: assume consent' }), LROW(3, { status: 'needs-you', outcome: '' })] }) }
    : { ...ST6(), dates: [{ date: '2026-10-16', takenAt: iso(1000), counts: { needsYou: 1 } }, { date: '2026-10-09', takenAt: iso(1000), counts: {} }] }) });
  it('Last Friday is the default: newest week, its new people, returned chips, a week picker instead of date tabs', async () => {
    const e = consentEnv();
    await e.fns._ikLoad(false);
    const h = e.fns._ikPageHtml(), t = strip(h);
    expect(e.fns._ik().csub).toBe('last');
    expect(t).toContain('Last Friday All forms Unlinked Mismatches Other (no date)');
    expect(t).toContain('New people from ' + e.fns._lkDay('2026-10-09'));
    expect(h).not.toContain('onclick="_ikPickDate(');
    expect(h).toContain('onchange="this.blur();_ikPickDate(+this.value)"');
    expect(t).toContain('Form back: contact OK');
    expect(t).toContain('No form: assume consent');
    expect(t).not.toContain('Form returned');
    expect(t).toContain('Save 2 to Elvanto');
    expect(t.indexOf('Ready (2)')).toBeLessThan(t.indexOf('Save 2 to Elvanto')); // M2: under the Ready heading
  });
  it('the other sub-menus load nothing until asked, and the Intakes tab still works', async () => {
    const e = consentEnv();
    await e.fns._ikLoad(false);
    const n = e.calls.fresh.length;
    e.fns._ikConsentSub('forms');
    const t = strip(e.fns._ikPageHtml());
    expect(t).toContain('Load forms');
    expect(t).toContain('Nothing loaded yet');
    expect(e.calls.posts.length).toBe(0);
    expect(e.calls.fresh.length).toBe(n);
    e.fns._ikConsentSub('mismatches');
    expect(strip(e.fns._ikPageHtml())).toContain('Find mismatches');
    e.fns._ikConsentSub('bogus');
    expect(e.fns._ik().csub).toBe('mismatches');
    e.fns._ikTab('intake');
    expect(e.fns._ik().tab).toBe('intake');
  });
  it('an older console or a locked lookup says so instead of a search box', () => {
    const e = makeEnv();
    expect(e.fns._ikLkGate(ST({ rev: 5 }))).toMatch(/needs an update/);
    expect(e.fns._ikLkGate(ST6({ consentLookup: 'locked' }))).toMatch(/isn't switched on/);
    expect(e.fns._ikLkGate(ST6())).toBe('');
  });
});

describe('lookup request shaping, polling, pagination (R2 b/c)', () => {
  it('the search text goes in the note, trimmed to 60; the ref is the item id', () => {
    const f = makeEnv().fns;
    expect(f._ikLkItem('forms', 2, '  Ava  ', P(9))).toEqual({ kind: 'action', id: P(9), type: 'consentLookup', payload: { kind: 'forms', page: 2, ref: P(9) }, note: 'Ava', leaderId: null });
    expect(f._ikLkItem('mismatches', 1, '', P(8)).note).toBe(null);
    expect(f._ikLkItem('forms', 1, 'x'.repeat(80), P(7)).note).toHaveLength(60);
  });
  it('_ikLkGo posts one consentLookup and waits; Next asks for page + 1 with the same search', async () => {
    const e = makeEnv({ post: (_p, b) => ({ results: b.items.map((i: any) => ({ id: i.id, kind: 'action', outcome: 'saved' })) }) });
    await e.fns._ikLkGo('forms', 1, ' Ava ');
    const x = e.fns._ikLk('forms');
    expect(x.st).toBe('waiting');
    const item = e.calls.posts[0].b.items[0];
    expect(item.type).toBe('consentLookup');
    expect(item.payload).toEqual({ kind: 'forms', page: 1, ref: item.id });
    expect(item.note).toBe('Ava');
    clearTimeout(x.poll);
    expect(e.fns._ikLkApply(x, { status: 'ready', kind: 'forms', page: 1, pageSize: 25, total: 60, rows: [] }, Date.now())).toBe(false);
    await e.fns._ikLkTurn('forms', 1);
    const next = e.calls.posts[1].b.items[0];
    expect(next.payload.page).toBe(2);
    expect(next.note).toBe('Ava');
    clearTimeout(e.fns._ikLk('forms').poll);
  });
  it('a refused queue shows the server message; no network = offline with Check again; 404 = expired', async () => {
    const e = makeEnv({ post: (_p, b) => ({ results: [{ id: b.items[0].id, kind: 'action', outcome: 'refused', code: 'LINK_UNAVAILABLE', message: 'Do this in Elvanto for now.' }] }) });
    await e.fns._ikLkGo('forms', 1, '');
    expect(e.fns._ikLk('forms').st).toBe('failed');
    expect(e.fns._ikLk('forms').msg).toBe('Do this in Elvanto for now.');
    const x: any = { kind: 'forms' };
    e.fns._ikLkErr(x, new Error('Load failed'));
    expect(x.st).toBe('offline');
    expect(strip(e.fns._ikLkStatusHtml('forms', x, ST6()))).toContain('Ask again');
    e.fns._ikLkErr(x, Object.assign(new Error('nf'), { status: 404 }));
    expect(x.msg).toMatch(/expired/);
  });
  it('apply: waiting/working keep polling; failed maps the reason; too long = timeout (mismatches waits longer)', () => {
    const f = makeEnv().fns, now = Date.now();
    const x: any = { kind: 'forms', since: now, q: 'a' };
    expect(f._ikLkApply(x, { status: 'working' }, now + 1000)).toBe(true);
    expect(x.st).toBe('working');
    expect(f._ikLkApply(x, { status: 'waiting' }, now + 6 * 60000)).toBe(false);
    expect(x.st).toBe('timeout');
    const m: any = { kind: 'mismatches', since: now };
    expect(f._ikLkApply(m, { status: 'working' }, now + 6 * 60000)).toBe(true);
    const y: any = { kind: 'forms', since: now };
    f._ikLkApply(y, { status: 'failed', reason: 'too-old' }, now);
    expect(y.msg).toMatch(/within an hour/);
  });
  it('pages: total known = page x of y; unknown total = Next while a full page came back', () => {
    const f = makeEnv().fns;
    expect(f._ikLkPages({ page: 1, pageSize: 25, total: 51, rows: [] })).toEqual({ page: 1, pages: 3, prev: false, next: true });
    expect(f._ikLkPages({ page: 3, pageSize: 25, total: 51, rows: [] })).toEqual({ page: 3, pages: 3, prev: true, next: false });
    expect(f._ikLkPages({ page: 2, pageSize: 25, total: null, rows: new Array(25).fill({}) }).next).toBe(true);
    expect(f._ikLkPages({ page: 2, pageSize: 25, total: null, rows: [{}] }).next).toBe(false);
    expect(f._ikLkPages({ page: 1, pageSize: 25, total: 0, rows: [] }).pages).toBe(1);
  });
});

describe('form icons and rows (R2 b)', () => {
  const row = (o: any = {}) => ({ subId: P(1), personId: P(2), name: 'Ava', submitted: '2026-10-09', status: 'approved', consentDate: '09/10/2026', contactOptOut: false, total: '', otherOptOuts: [], ...o });
  it('maps each flag to its icon with a spoken label', () => {
    const f = makeEnv().fns;
    expect(f._ikFormIcons(row()).map((i: any) => i.k)).toEqual(['given']);
    expect(f._ikFormIcons(row({ contactOptOut: true })).map((i: any) => i.k)).toEqual(['given', 'contact']);
    expect(f._ikFormIcons(row({ total: '09/10/2026' })).map((i: any) => i.k)).toEqual(['total']);
    expect(f._ikFormIcons(row({ consentDate: '', otherOptOuts: ['Photos'] })).map((i: any) => i.label)).toEqual(['Other opt-outs: Photos']);
    expect(f._ikFormIcons(row({ consentDate: '' }))).toEqual([]);
  });
  it('rows escape names and labels and carry a legend', () => {
    const e = makeEnv(), x = e.fns._ikLk('forms');
    Object.assign(x, { st: 'ready', resQ: '', res: { status: 'ready', page: 1, pageSize: 25, total: 1, takenAt: null, rows: [row({ name: HOSTILE, otherOptOuts: [HOSTILE] })] } });
    const h = e.fns._ikLkResHtml('forms', x, ST6());
    expect(h).not.toContain('<img');
    expect(h).toContain('aria-label="Consent given"');
    expect(strip(h)).toContain('Consent given DO NOT CONTACT Total non-consent from');
  });
  it('empty results say why', () => {
    const e = makeEnv(), x = e.fns._ikLk('mismatches');
    Object.assign(x, { st: 'ready', resQ: '', res: { page: 1, pageSize: 25, total: 0, rows: [] } });
    expect(strip(e.fns._ikLkResHtml('mismatches', x, ST6()))).toContain('Every profile matches its newest consent form');
    x.resQ = 'zed';
    expect(strip(e.fns._ikLkResHtml('mismatches', x, ST6()))).toContain('No mismatches for &quot;zed&quot;');
  });
});

describe('mismatches + Make profile match form (R2 c, LOCKED)', () => {
  const mis = { subId: P(3), personId: P(4), name: 'Ava Nguyen', submitted: '2026-10-09', diffs: ['consent date', 'opt-outs'],
    form: { consentDate: '09/10/2026', total: '', optOuts: ['Contact with my child'] }, profile: { consentDate: '', total: '', optOuts: [] } };
  it('lines show form vs profile; a locked writer is said plainly', () => {
    const f = makeEnv().fns;
    expect(f._ikMisLines(mis)).toEqual([['Consent date', 'Fri 9 Oct 2026', 'blank'], ['Opt-outs', 'Contact with my child', 'blank']]);
    expect(strip(f._ikFixBanner(ST6()))).toContain("isn't allowed to change profiles yet");
    expect(f._ikFixText({ status: 'refused', reason: 'locked' }, ST6())).toEqual(['bad', 'Not sent. Waiting for first live approval in the console.']);
    expect(f._ikFixText({ status: 'sent', reason: 'already' }, ST6())[1]).toMatch(/Already matched/);
  });
  it('the fix queues one consentFix {personId, subId} after one confirm', async () => {
    const e = makeEnv({ post: (_p, b) => ({ results: [{ id: b.items[0].id, kind: 'action', outcome: 'saved' }] }) });
    const x = e.fns._ikLk('mismatches');
    Object.assign(x, { st: 'ready', resQ: '', res: { page: 1, pageSize: 25, total: 1, rows: [mis] } });
    expect(e.fns._ikLkResHtml('mismatches', x, ST6())).not.toContain('_ikFixOpen(0)'); // M5: locked = "Do in Elvanto"
    expect(strip(e.fns._ikLkResHtml('mismatches', x, ST6()))).toContain('Do in Elvanto');
    expect(e.fns._ikLkResHtml('mismatches', x, ST6({ consentFix: 'live' }))).toContain('_ikFixOpen(0)');
    e.fns._ikFixOpen(0);
    expect(strip(e.calls.modals[0]!)).toContain("Change Ava Nguyen's profile to match the form?");
    await e.fns._ikFixGo();
    const it1 = e.calls.posts[0].b.items[0];
    expect(it1.type).toBe('consentFix');
    expect(it1.payload).toEqual({ personId: P(4), subId: P(3) });
    expect(e.fns._ik().fixes[P(4)].status).toBe('pending');
    clearTimeout(e.fns._ik().fixPoll);
  });
});

describe('Save all ready (R8)', () => {
  it('only ready rows with nothing open and no save already sent', () => {
    const f = makeEnv().fns;
    const rows = [LROW(1), LROW(2, { status: 'needs-you' }), LROW(3, { actions: [act({ type: 'consentSave', status: 'pending' })] }),
      LROW(4, { actions: [act({ type: 'consentSave', status: 'sent' })] }), LROW(5, { actions: [act({ type: 'consentSave', status: 'refused' })] }),
      LROW(6, { actions: [act({ type: 'consentSave', status: 'unclear' })] }), LROW(7, { status: 'done' })];
    expect(f._ikReadyRows({ rows }).map((r: any) => r.key)).toEqual([P(1), P(5)]);
  });
  it('items skip a row the single Save would block and carry the todo keys', () => {
    const f = makeEnv().fns;
    const ok = DET({ row: { key: P(1), status: 'ready', title: 'Ava' } });
    const held = DET({ row: { key: P(2), status: 'needs-you', title: 'Ben' } });
    const gone = { row: { key: P(3), title: 'Cy' }, detail: null };
    const x = f._ikSaveAllItems([ok, held, gone], '2026-10-09', 'intakeSave', LIST(), ST());
    expect(x.items.map((i: any) => i.key)).toEqual([P(1)]);
    expect(x.items[0].payload).toEqual({ date: '2026-10-09', row: P(1), confirmed: ['approve:parent:' + P(2), 'category:parent:' + P(2)], one: false });
    expect(x.skipped).toEqual(['Ben', 'Cy']);
    expect(f._ikSaveAllItems([ok], '2026-10-16', 'consentSave', LIST(), ST()).items[0].payload).not.toHaveProperty('one');
  });
  it('one confirm, then N saves in one batch; refused rows get their own status line', async () => {
    const e = makeEnv({
      fresh: (p) => (p.startsWith('/link/intake/row') ? DET({ row: { key: p.includes(P(1)) ? P(1) : P(5), status: 'ready', title: p.includes(P(1)) ? 'Ava' : 'Eve' } }) : LIST()),
      post: (_p, b) => ({ results: b.items.map((i: any, n: number) => (n === 0 ? { id: i.id, kind: 'action', outcome: 'saved' }
        : { id: i.id, kind: 'action', outcome: 'refused', message: 'This plan changed. Refresh and check again.' })) }),
    });
    const I = e.fns._ik();
    Object.assign(I, { head: ST(), tab: 'intake', date: '2026-10-09', dates: [{ date: '2026-10-09' }], list: LIST({ rows: [LROW(1), LROW(5)] }) });
    await e.fns._ikSaveAllOpen();
    expect(e.calls.modals.length).toBe(1);
    expect(strip(e.calls.modals[0]!)).toContain('Save 2 families to Elvanto?');
    expect(e.calls.posts.length).toBe(0);
    await e.fns._ikSaveAllGo();
    expect(e.calls.posts.length).toBe(1);
    expect(e.calls.posts[0].b.items.map((i: any) => i.type)).toEqual(['intakeSave', 'intakeSave']);
    expect(I.saErr[P(5)]).toBe('This plan changed. Refresh and check again.');
    expect(I.saErr[P(1)]).toBeUndefined();
  });
});

describe('integration review fixes (run 2026-10-15)', () => {
  const P2 = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  it('code H2 / UI H3: the fix confirm lists every changed field and says when DO NOT CONTACT flips', () => {
    const e = makeEnv();
    const m = { subId: P2(3), personId: P2(4), name: 'Ava Nguyen', submitted: '2026-10-09', diffs: ['consent date'],
      form: { consentDate: '09/10/2026', total: '', optOuts: [] }, profile: { consentDate: '01/02/2025', total: '', optOuts: ['Contact with my child', 'Photos'] } };
    const ch = e.fns._ikFixChanges(m);
    expect(ch.lines).toEqual(['Consent date: set to Fri 9 Oct 2026 (now Sat 1 Feb 2025)', 'Opt-out removed: Contact with my child', 'Opt-out removed: Photos']);
    expect(ch.dnc).toBe('off');
    const x = e.fns._ikLk('mismatches');
    Object.assign(x, { st: 'ready', resQ: '', res: { page: 1, pageSize: 25, total: 1, rows: [m] } });
    e.fns._ikFixOpen(0);
    const t = strip(e.calls.modals[0]!);
    expect(t).toContain('Opt-out removed: Contact with my child');
    expect(t).toContain('This turns DO NOT CONTACT off');
    expect(e.fns._ikFixChanges({ form: { consentDate: '', total: '09/10/2026', optOuts: [] }, profile: { consentDate: '', total: '', optOuts: [] } }).dnc).toBe('on');
    expect(e.fns._ikFixChanges({ form: { consentDate: 'a', total: '', optOuts: ['Photos'] }, profile: { consentDate: 'b', total: '', optOuts: [] } }).dnc).toBe(null);
    expect(e.fns._ikFixText({ status: 'sent', dnc: 'on' }, ST6(), 'Ava')[1]).toContain('Ava is DO NOT CONTACT');
    expect(e.fns._ikFixText({ status: 'unclear' }, ST6(), 'Ava')[1]).toBe("Elvanto may not have saved this change. Look at Ava's profile in Elvanto.");
    expect(e.fns._ikFixText({ status: 'refused', reason: 'weird' }, ST6())[1]).toBe("The console couldn't do this. Do it in Elvanto.");
  });
  it('UI H2: No contact is a red DO NOT CONTACT tag, never green', () => {
    const f = makeEnv().fns;
    expect(f._ikConsentTag({ outcome: 'No contact' })).toEqual(['Form back: DO NOT CONTACT', 'ik-bad']);
    expect(f._ikConsentTag({ outcome: 'Contact allowed' })).toEqual(['Form back: contact OK', 'ik-ok']);
    expect(f._ikConsentTag({ status: 'needs-you', reason: 'Unmatched consent form' })).toEqual(['Form back?', 'ik-wait']);
  });
  it('UI H1: Enter in the search box blurs it before the redraw', () => {
    const e = makeEnv();
    let blurred = false;
    e.fns._ikLkKey('forms', { key: 'Enter', preventDefault() {}, target: { blur() { blurred = true; } } });
    expect(blurred).toBe(true);
  });
  it('UI M3/M4: the bulk confirm says what each outcome does and drops the old D26 wording', () => {
    const f = makeEnv().fns;
    const h = strip(f._ikSaveAllGroups([{ title: 'A', outcome: 'No contact' }, { title: 'B', outcome: 'Contact allowed' }]));
    expect(h).toContain('No contact (1): approve the form, then remove them from New People (DO NOT CONTACT)');
    expect(h).toContain('Contact allowed (1): approve the form, then complete New People step 0');
    expect(f._ikD26()).not.toMatch(/Provisional/);
    expect(f._ikD26()).toMatch(/Monday/);
  });
  it('resilience M6: Ask again after a network error resends the same request id', async () => {
    const ids: string[] = [];
    const e = makeEnv({ post: (_p, b) => { ids.push(b.items[0].id); if (ids.length === 1) throw new Error('Load failed'); return { results: [{ id: b.items[0].id, kind: 'action', outcome: 'replay' }] }; } });
    await e.fns._ikLkGo('forms', 1, '');
    expect(e.fns._ikLk('forms').st).toBe('offline');
    await e.fns._ikLkAgain('forms');
    expect(ids[1]).toBe(ids[0]);
    expect(e.fns._ikLk('forms').st).toBe('waiting');
    clearTimeout(e.fns._ikLk('forms').poll);
  });
  it('resilience M3/M5: an unreadable answer is an error, a retry says why', () => {
    const f = makeEnv().fns, now = Date.now();
    const x: any = { kind: 'mismatches', since: now };
    f._ikLkApply(x, { status: 'failed', reason: 'unreadable' }, now);
    expect(x.msg).toBe("Couldn't read the answer. Search again.");
    const y: any = { kind: 'forms', since: now };
    f._ikLkApply(y, { status: 'waiting', reason: 'console-busy' }, now);
    expect(strip(f._ikLkStatusHtml('forms', y, ST6()))).toContain('busy with the service');
  });
});

describe('Unlinked consent forms (L6)', () => {
  const ST7 = (caps: Record<string, string> = {}) => ST6({ consentLink: 'live', ...caps });
  const ROW = (n: number, o: any = {}) => ({ subId: P(n), name: 'Riley Sample', submitted: '2026-10-09', status: 'pending', consentDate: '09/10/2026', contactOptOut: true,
    total: '', otherOptOuts: ['Photos'], names: ['Pat Sample'], linked: null, ...o });
  const env = (post?: any) => {
    const e = makeEnv({ fresh: (p) => (p.startsWith('/link/youth') ? { rows: [{ personId: P(70), name: 'Riley Sample', grade: 8 }, { personId: P(71), name: 'Sam Other', grade: null }] } : ST7()), post });
    const I = e.fns._ik();
    Object.assign(e.fns._ikLk('unlinked'), { st: 'ready', res: { rows: [ROW(1), ROW(2, { linked: { personId: P(70), name: 'Riley Sample' } })], page: 1, pageSize: 25, total: 2 } });
    e.get().LINK.st = ST7();
    return { e, I };
  };
  it('the sub-menu is there and loads nothing until asked', () => {
    const e = makeEnv({ storage: new Map([['ysc.intakeTab', 'consent']]) });
    e.fns._ikConsentSub('unlinked');
    expect(e.fns._ik().csub).toBe('unlinked');
    expect(e.calls.posts.length).toBe(0);
  });
  it('rows show names, the icons, and Find person or Unlink by link state; hostile text is escaped', () => {
    const { e } = env();
    const x = e.fns._ikLk('unlinked');
    x.res.rows[0].name = HOSTILE;
    const h = e.fns._ikLkResHtml('unlinked', x, ST7());
    expect(h).not.toContain(HOSTILE);
    expect(strip(h)).toContain('Also on the form: Pat Sample');
    expect(strip(h)).toContain('DO NOT CONTACT');
    expect(strip(h)).toContain('Find person');
    expect(strip(h)).toContain('Linked to Riley Sample (not in Elvanto)');
    expect(strip(h)).toContain('Unlink');
    expect(strip(e.fns._ikClRow(x.res.rows[0], 0, '', ST6()))).toContain('Console needs an update'); // no consentLink capability
  });
  it('Find person searches the roster, pick -> confirm warns about DO NOT CONTACT, Link posts one consentLink', async () => {
    const { e } = env((_p: string, b: any) => ({ results: b.items.map((i: any) => ({ id: i.id, kind: 'action', outcome: 'saved' })) }));
    await e.fns._ikClOpen(0);
    expect(e.get().LINK.cyouth.length).toBe(2);
    e.fns._ikClQ('riley');
    expect(e.fns._ik().clp.list.map((r: any) => r.personId)).toEqual([P(70)]);
    e.fns._ikClPick(0);
    expect(e.calls.modals.at(-1)).toContain('Link this form to Riley Sample?');
    expect(strip(e.calls.modals.at(-1)!)).toContain('DO NOT CONTACT');
    await e.fns._ikClGo();
    const item = e.calls.posts[0].b.items[0];
    expect(item).toMatchObject({ type: 'consentLink', payload: { subId: P(1), personId: P(70) }, note: null });
    expect(e.fns._ik().fixes['cn:' + P(1)].status).toBe('pending');
    e.fns._ik().fixes['cn:' + P(1)].status = 'sent';
    expect(e.fns._ikClNow(ROW(1))).toEqual({ personId: P(70), name: 'Riley Sample' });
  });
  it('Unlink posts personId null, and a sent unlink shows the form as unlinked again', async () => {
    const { e } = env((_p: string, b: any) => ({ results: b.items.map((i: any) => ({ id: i.id, kind: 'action', outcome: 'saved' })) }));
    e.fns._ikClUnlink(1);
    expect(e.calls.modals.at(-1)).toContain('Unlink this form from Riley Sample?');
    await e.fns._ikClGo();
    expect(e.calls.posts[0].b.items[0].payload).toEqual({ subId: P(2), personId: null });
    e.fns._ik().fixes['cn:' + P(2)].status = 'sent';
    expect(e.fns._ikClNow(ROW(2, { linked: { personId: P(70), name: 'Riley Sample' } }))).toBe(null);
  });
  it('a refused link says why', () => {
    const { e } = env();
    expect(e.fns._ikClText({ status: 'refused', detail: 'Only the admin can do this.' })).toEqual(['bad', 'Not saved: Only the admin can do this.']);
  });
});
