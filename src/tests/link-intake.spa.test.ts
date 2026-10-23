// T4 Intake + Consents SPA (spec 2026-10-13-intake-consent-app-spec.md §7, §10, §11, §12 item 4). Extract-and-run: the
// REAL functions from public/index.html run against small stubs (localStorage, API, modal). No server.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn, SITE_TIME_SRC } from './helpers/extract-fn';

const FNS = ['esc', 'progBar', '_lkRcHtml', '_lkTime', '_lkDay', 'fmtDay', '_lkSeen', '_lkAt', '_lkUuid', '_lkFresh', '_lkAdmFresh', '_lkSoftReset',
  '_nyModeOf', '_nyMode', '_nyOn', '_linkModeOf', '_linkOn', '_linkAdminOn', 'moreItems', 'renderLink', '_lkTickStart', '_lkStatusLoad', '_lkTick',
  '_ikFresh', '_ik', '_ikModuleOn', '_ikRev', '_intakeOn', '_ikSt', '_ikOldConsole', '_ikIsText', '_ikOpenAct', '_ikOpenOf', '_ikNameChanges', '_ikResultLine',
  '_ikSeenLine', '_ikBanner', '_ikReasons', '_ikAct', '_ikChip', '_ikTodo', '_ikTextStep', '_ikAlone', '_ikSaveBlock', '_ikTextBlock',
  '_ikDTag', '_ikD26', '_ikTagHtml', '_ikPast', '_ikStepText', '_ikStepsHtml', '_ikResultHtml', '_ikSeed', '_ikAnswerBody',
  '_ikAns', '_ikPost', '_ikQKey', '_ikQRow', '_ikQSlot', '_ikSame', '_ikQGet', '_ikQSet', '_ikQFind', '_ikQFlush', '_ikQApply', '_ikUnlocal', '_ikOutcome', '_ikLocal', '_ikAnswerSend', '_ikForm', '_ikStudentSub', '_ikChoose', '_ikPair', '_ikPairIdx', '_ikKeep',
  '_ikFieldLabel', '_ikSheetHtml', '_ikSaveOpen', '_ikOneOpen', '_ikSheetGo', 'renderLinkIntake', '_ikDraw', '_ikPageHtml',
  '_ikConsentHelp', '_ikFamilyPage', '_ikHead', '_ikCompareHtml', '_ikMatchHtml', '_ikDiffHtml',
  '_ikLinkedLine', '_ikVerdictHtml', '_ikVal', '_ikNm', '_ikNames', '_ikPoss', '_ikHoldText', '_ikHoldLines', '_ikNext', '_ikHoldReason', '_ikConseq',
  '_ikIssueText', '_ikMob', '_ikMobText', '_ikUnkeep', '_ikPickParent', '_ikSaveHtml', '_ikFamilyHtml', '_ikConsentHtml', '_ikLoad', '_ikLoadRow', '_ikAfterLoad',
  '_ikSchedule', '_ikLeave',
  // R2 Consents sub-menus + R8 Save all (run 2026-10-15)
  '_ikReadyRows', '_ikSaveAllItems', '_ikSaveAllGo',
  '_ikLk', '_ikLkBusy', '_ikLkItem', '_ikLkGate', '_ikLkReason', '_ikLkGo', '_ikLkErr',
  '_ikLkApply', '_ikLkPoll', '_ikFormChip', '_ikFormLines', '_ikFormRowEnd', '_ikAnd', '_ikFormName', 'tidyName', '_ikMisLines', '_ikMisVal',
  '_ikFixText', '_ikFixOpen', '_ikFixGo', '_ikFixPoll',
  // integration review fixes (run 2026-10-15)
  '_ikSaveAllGroups', '_ikDmy', 'fmtDay', '_ikFixChanges', '_ikDncLine',
  // L6 Unlinked consent forms (run 2026-10-15b)
  '_lkYouthFilter', '_ikClCap', '_ikClNow', '_ikClText', '_ikClRow', '_ikClSplit', '_ikClSuggest', '_ikClRoster', '_ikClMulti', '_ikClBusy', '_ikClToLink', '_ikClWho', '_ikClMultiLines', '_ikClMultiAct', '_ikClOpen', '_ikClQ', '_ikClDraw', '_ikClPick', '_ikClUnlink', '_ikClGo',
  // nav/save fix round 2026-10-16: C0 still-here guard (C-B1 _ikAnswersSave, C-B4 _ikSaveAllOpen)
  '_navSnap', '_navSame', '_here', '_still',
  // consent hub landing (2026-10-23)
  '_ikMisRow', '_hubPage', '_hubBodyHtml', '_hubSaveTag', '_hubWk', '_hubInWeek', '_lkWeekStart', '_lkAddDays', '_hubM', '_hubRows', '_hubCheckedAt', '_hubLoad', '_hubSnapApply', '_hubFamRow', '_hubChip', '_hubRefresh', '_hubQ', '_hubToggle',
  '_hubFold', '_hubAddDays', '_hubFriday', '_hubStage', '_hubStray', '_hubReasons', '_hubNext', '_hubFamilies', '_hubModel', '_hubSearch',
  '_hubNextHtml', '_hubMoreHtml', '_hubKidMore', '_hubUnlinkIdx', '_hubStripHtml'];
const HTML = loadIndexHtml();
const BODY = SITE_TIME_SRC + '\n' + FNS.map((n) => extractFn(HTML, n)).join('\n');
const CONSTS = [/^const IK_FIX = \[[^\]]*\];/m, /^const IK_HOLD = \{[\s\S]*?\n\};/m, /^const IK_VERDICT_HOLDS = \[[^\]]*\];/m,
  /^const IK_ISSUE = \{[\s\S]*?\};$/m, /^const IK_CONTACT_RE = .*;$/m, /^const IK_FIX_REASON = \{[\s\S]*?\};$/m, /^const _LK_RC = \{\};$/m, /^const IK_LK_KINDS = .*$/m, /^const HUB_STAGES = .*$/m].map((re) => HTML.match(re)![0]).join('\n');

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
    const _ikLkWarm = () => { (__calls.warm = __calls.warm || []).push(1); return []; }; // ux18 preload: consents-preload.spa.test.ts
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
    const _usLoad = () => Promise.resolve(); const _usPaint = () => {}; const _usRows = [];
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
  it('L8 (2026-10-21): a quiet Consents load that will warm the lists marks the view; later quiet loads do not', async () => {
    const e = makeEnv({ fresh: () => ({ ...ST(), dates: [] }) });
    e.fns._ik().tab = 'consent';
    await e.fns._ikLoad(true);
    expect(e.calls.fresh).toContain('/link/intake?mode=consent&view=1');
    e.fns._ik().lkPre = Date.now(); e.calls.fresh.length = 0;
    await e.fns._ikLoad(true);
    expect(e.calls.fresh).toContain('/link/intake?mode=consent');
    const i = makeEnv({ fresh: () => ({ ...ST(), dates: [] }) }); // Intakes never warms lookups: a quiet load stays quiet
    await i.fns._ikLoad(true);
    expect(i.calls.fresh).toContain('/link/intake?mode=intake');
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
  it('consent hub (Task 11): no tab is stored or read; logout drops the intake state', () => {
    const storage = new Map([['ysc.intakeTab', 'consent']]); // left by an older build: ignored
    const e = makeEnv({ storage });
    expect(e.fns._ik().tab).toBe('intake');
    expect(e.fns._ik()).toMatchObject({ hub: null, hubQ: '', hubAsk: 0, hubOpen: {}, hubShown: null, hubFam: null, hubKid: 0 });
    expect(e.fns._ik()).not.toHaveProperty('csub');
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
  it('I9b (R2-G7): a sent answer reads Noted, never Saved; the older Save behind it shows', () => {
    const e = makeEnv();
    const noted = { label: 'Noted', tone: 'ok', line: 'Answer noted. The plan is updated.' };
    expect(e.fns._ikChip({ actions: [act({ type: 'intakeAnswer', status: 'sent', reason: 'planned' })] }, ST())).toEqual(noted);
    expect(e.fns._ikChip({ actions: [act({ type: 'intakeAnswer', status: 'sent', reason: 'planned' })] }, ST()).label).not.toBe('Saved');
    expect(chip(act({ type: 'intakeSave', status: 'sent', resultAt: iso(1000) })).label).toBe('Saved'); // an Elvanto write stays "Saved"
    expect(e.fns._ikResultHtml(act({ type: 'intakeAnswer', status: 'sent', reason: 'planned' }), DETAIL(), ST())).not.toContain('>Saved');
    expect(e.fns._ikChip({ actions: [act({ type: 'intakeAnswer', status: 'sent', reason: 'planned' }), act({ status: 'shadowed' })] }, ST())).toBeNull(); // R1 cut 8: no Practice chip
  });
  it('sent, already, unclear, refused (reason wins, else the detail); shadowed shows nothing (R1: no Practice chip)', () => {
    expect(chip(act({ status: 'sent', resultAt: iso(1000) })).label).toBe('Saved');
    expect(chip(act({ status: 'sent', reason: 'already' })).line).toBe('Already in Elvanto');
    expect(chip(act({ status: 'unclear' }))).toEqual({ label: 'Unclear', tone: 'bad', line: "Not sure it saved. Check in Elvanto or the console's Unclear saves" });
    expect(chip(act({ status: 'refused', reason: 'plan-changed', detail: 'The console said this.' })).line).toBe('Something changed in Elvanto. Review the family again.');
    expect(chip(act({ status: 'refused', reason: 'weird', detail: 'The console said this.' })).line).toBe('The console said this.');
    expect(chip(act({ status: 'refused', reason: 'plan-changed' })).line).toBe('Something changed in Elvanto. Review the family again.');
    expect(chip(act({ status: 'refused', reason: 'chain-not-done' })).line).toBe('Finish saving the family before the parent text.');
    expect(chip(act({ status: 'shadowed' }))).toBeNull();
    expect(chip(act({ status: 'cancelled' }))).toBe(null);
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

describe('family review footer (ux18 P9, consent hub T9)', () => {
  it('Save to Elvanto is the one primary; Save answers is a secondary under More', () => {
    const e = makeEnv();
    const h = e.fns._ikFamilyHtml(DET(), LIST(), ST(), e.fns._ikSeed(DETAIL()));
    expect(h).toMatch(/btn-primary btn-full lk-mt"[^>]*onclick="_ikSaveOpen\(\)">Save to Elvanto/);
    expect((h.match(/btn-primary/g) || []).length).toBe(1);
    const more = h.slice(h.indexOf('<summary>More'));
    expect(more).toMatch(/btn-secondary btn-sm" onclick="_ikAnswersSave\(\)">Save answers/);
    expect(h).not.toContain('rc-foot');
  });
});

describe('Parent text commentary (I8)', () => {
  it('I8 (R2-G4): a ready family with the parent text pending shows none of the deleted parent-text commentary', () => {
    const e = makeEnv();
    const det = DET({ actions: [act({ status: 'sent', stop: { code: 'sms', text: 'Stopped before the parent text.' }, steps: [] })] });
    const h = strip(e.fns._ikFamilyHtml(det, LIST(), ST(), e.fns._ikSeed(det.detail)));
    for (const s of ['Text Jo Nguyen now?', 'ends in 111', "It can't be recalled.", 'Send the text', 'Not now', 'Text the parent',
      'Only the parent text is left.', 'then asks about the parent text', 'The parent text is separate.', 'The parent texts are separate.'])
      expect(h).not.toContain(s);
    const only = DET({ detail: DETAIL({ steps: [step({ state: 'done' }), TEXT] }) });
    const t2 = strip(e.fns._ikFamilyHtml(only, LIST(), ST(), e.fns._ikSeed(only.detail)));
    expect(t2).not.toContain('Only the parent text is left.');
    expect(t2).toContain('In Flow steps');
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
});

describe('escaping (§11)', () => {
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
    expect(sheet).not.toContain('The parent text is separate.'); // I8
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
  it("I9 (R2-G4): Parent's name / mobile rows show the student form's answer only, spanning both columns", () => {
    const d = DETAIL({ forms: { student: form(P(1), { values: { first: 'Ava', last: 'Nguyen', mobile: '0412345678', gender: 'Female', parentName: 'Jo Nguyen', parentPhone: '0412 999 000' } }),
      parent: form(P(2), { values: { first: 'Joanne', last: 'Parentname', mobile: '0412999111', gender: 'Female' }, caps: {}, status: 'approved' }) } });
    const h = raw(d);
    const row = (label: string) => h.match(new RegExp(`<tr[^>]*><th scope="row">${label}[\\s\\S]*?</tr>`))![0];
    for (const r of [row('Parent&#39;s name'), row('Parent&#39;s mobile')]) {
      expect(r.match(/<td/g)!.length).toBe(1);
      expect(r).toContain('<td colspan="2"');
      expect(r).not.toContain('Joanne');
      expect(r).not.toContain('Parentname');
      expect(r).not.toContain('999 111');
    }
    expect(row('Parent&#39;s mobile')).toContain('Differs'); // still compared with the parent form
    expect(row('First name').match(/<td/g)!.length).toBe(2); // the other rows keep both forms
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
  it('I9b (R2-G7): a linked-profile hold says how to fix it in Elvanto, then Refresh', () => {
    for (const text of ['Linked profile unclear', "Linked to a profile the form page doesn't confirm"]) {
      const d = DETAIL({ status: 'needs-you', holds: [{ role: 'student', text }] });
      const t = fam(d, { row: { key: P(1), status: 'needs-you', title: 'Ava Nguyen' } });
      expect(t).toContain('Fix in Elvanto, then Refresh');
      expect(t).toContain("Elvanto links this student form to a profile the console can't confirm. Open the Student form, then approve it to the right person or Unlink it in Elvanto, then Refresh.");
      expect(t).not.toContain('answer the question');
    }
    // an answerable hold beside it still asks for the answer
    const d2 = DETAIL({ status: 'needs-you', holds: [{ role: 'student', text: 'Same person?' }],
      verdicts: [{ role: 'student', subId: P(1), verdict: 'unsure', chosen: null, options: ['same', 'new'], linked: { name: 'Ava Nguyen', age: 14, archived: false }, candidates: [], diff: [] }] });
    expect(fam(d2, { row: { key: P(1), status: 'needs-you', title: 'Ava Nguyen' } })).not.toContain('Fix in Elvanto, then Refresh');
  });
  it('steps: to-dos first by person, done ones under Already done, console chips', () => {
    const d = DETAIL({ steps: [step({ key: 'a', state: 'done', text: 'Approve the student form' }), step({ key: 'b', role: 'parent', text: 'Approve the parent form', locked: true }), TEXT] });
    const h = raw(d), t = strip(h);
    expect(t).toContain('What saving does');
    expect(t).toContain('Jo Nguyen (parent) Approve the parent form Do in Elvanto Text Jo Nguyen (…111) In Flow steps'); // I8 row 7
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
    expect(t).toContain("Makes 1 change for Ava Nguyen's family. You'll confirm first."); // I8 row 4
  });
});

// ── R2 Consents sub-menus + R8 Save all (run 2026-10-15) ──
const ST6 = (caps: Record<string, string> = {}) => ST({ rev: 6, caps: { intakeSave: 'live', intakeText: 'live', consentSave: 'live', intakeAnswer: 'live', consentLookup: 'live', consentFix: 'locked', ...caps } });
const LROW = (n: number, o: any = {}) => ({ key: P(n), status: 'ready', title: 'Kid ' + n, reason: '', outcome: 'Contact allowed', fromApp: false, hasText: false, actions: [], ...o });

describe('consents sub-menus (R2)', () => {
  it('a console without the lookup says so instead of a search box', () => {
    const e = makeEnv();
    expect(e.fns._ikLkGate(ST6({ consentLookup: 'off' }))).toMatch(/needs an update/);
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
});

describe('form rows (R2 b; consents run 2026-10-17 R1: one chip in words, no icons, no legend)', () => {
  const row = (o: any = {}) => ({ subId: P(1), personId: P(2), name: 'Ava', submitted: '2026-10-09', status: 'approved', consentDate: '09/10/2026', contactOptOut: false, total: '', otherOptOuts: [], ...o });
  it('one status chip in words; a pending form is never "Consent given"', () => {
    const f = makeEnv().fns;
    expect(f._ikFormChip(row())).toEqual(['Consent given', 'ik-ok']);
    expect(f._ikFormChip(row({ contactOptOut: true }))).toEqual(['Do not contact', 'ik-bad']);
    expect(f._ikFormChip(row({ total: '09/10/2026' }))).toEqual(['No consent at all', 'ik-bad']);
    expect(f._ikFormLines(row({ total: '03/10/2026' }))[0]).toMatch(/^No consent at all from Sat 3 Oct( 2026)?$/); // year only when not this year
    expect(f._ikFormChip(row({ status: 'pending' }))).toBeNull(); // the meta line says Pending
    expect(f._ikFormChip(row({ consentDate: '', otherOptOuts: ['Photos'] }))).toEqual(['No consent date', 'ik-prac']); // other opt-outs never count
  });
  it('names read First Last: Last, First pairs split, one surname collapses, shouty caps tidied', () => {
    const f = makeEnv().fns;
    expect(f._ikFormName('Fakely, Clara')).toBe('Clara Fakely');
    expect(f._ikFormName('Sample, Jo, Sample, Bo')).toBe('Jo & Bo Sample');
    expect(f._ikFormName('Ng, Al, Ng, Bo, Ng, Cy')).toBe('Al, Bo & Cy Ng');
    expect(f._ikFormName('Ng, Al, Tran, Bo')).toBe('Al Ng & Bo Tran');
    expect(f._ikFormName('QUINN FAKENAME')).toBe('Quinn Fakename');
    expect(f._ikFormName('Yun-ting (Tinna) Sun')).toBe('Yun-ting (Tinna) Sun');
    expect(f._ikFormName('a, b, c')).toBe('A, B, C'); // odd parts: as it came (tidied)
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
});

describe('integration review fixes (run 2026-10-15)', () => {
  const P2 = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  it('code H2 / UI H3: the fix confirm lists every changed field and says when DO NOT CONTACT flips', () => {
    const e = makeEnv();
    const m = { subId: P2(3), personId: P2(4), name: 'Ava Nguyen', submitted: '2026-10-09', diffs: ['consent date'],
      form: { consentDate: '09/10/2026', total: '', optOuts: [] }, profile: { consentDate: '01/02/2025', total: '', optOuts: ['Contact with my child', 'Photos'] } };
    const ch = e.fns._ikFixChanges(m);
    expect(ch.lines.map((x: string) => x.replace(/ 2026\b/, ''))).toEqual(['Consent date: set to Fri 9 Oct (now Sat 1 Feb 2025)', 'Opt-out removed: Contact with my child', 'Opt-out removed: Photos']);
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
  it('UI M3/M4: the bulk confirm says what each outcome does and drops the old D26 wording', () => {
    const f = makeEnv().fns;
    const h = strip(f._ikSaveAllGroups([{ title: 'A', outcome: 'No contact' }, { title: 'B', outcome: 'Contact allowed' }]));
    expect(h).toContain('No contact (1): approve the form, then remove them from New People (DO NOT CONTACT)');
    expect(h).toContain('Contact allowed (1): approve the form, then complete New People step 0');
    expect(f._ikD26()).not.toMatch(/Provisional/);
    expect(f._ikD26()).toMatch(/Monday/);
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

// Task 11 fix round 1: the helpers the hub still uses, tested directly (their old cases went through the deleted Tidy up screens).
describe('consent hub: mismatch rows and lookups, called directly', () => {
  const mis = { subId: P(3), personId: P(4), name: 'Ava Nguyen', submitted: '2026-10-09', diffs: ['consent date', 'opt-outs'],
    form: { consentDate: '09/10/2026', total: '', optOuts: ['Contact with my child'] }, profile: { consentDate: '', total: '', optOuts: [] } };
  const live = (rev: number) => ({ ...ST6({ consentFix: 'live' }), consoleLinkRev: rev });
  it('lines show form vs profile; fix result lines', () => {
    const f = makeEnv().fns;
    expect(f._ikMisLines(mis).map((l: string[]) => l.map((x) => x.replace(/ 2026$/, '')))).toEqual([['Consent date', 'Fri 9 Oct', 'blank'], ['Opt-outs', 'Contact with my child', 'blank']]);
    const h = strip(f._ikMisRow(mis, 0, '', live(15)));
    expect(h).toContain('Consent date');
    expect(h).toContain('Contact with my child');
    expect(f._ikFixText({ status: 'sent', reason: 'already' }, ST6())[1]).toMatch(/Already matched/);
  });
  it('F-36: a console-linked row on an older console has no Fix button and says to fix it in Elvanto; an unlinked row has one', () => {
    const f = makeEnv().fns;
    const linked = f._ikMisRow({ ...mis, linked: true }, 1, '', live(14));
    expect(linked).not.toContain('_ikFixOpen(');
    expect(strip(linked)).toContain('Linked on the console; fix in Elvanto.');
    expect(f._ikMisRow(mis, 2, '', live(14))).toContain('onclick="_ikFixOpen(2)"');
  });
  it('L2: a rev 15 console copies a console-linked form too, so the linked row gets the Fix button', () => {
    const h = makeEnv().fns._ikMisRow({ ...mis, linked: true }, 1, '', live(15));
    expect(h).toContain('onclick="_ikFixOpen(1)"');
    expect(strip(h)).not.toContain('fix in Elvanto');
  });
  it('a console without the writer: "Do in Elvanto", no Fix button', () => {
    const h = makeEnv().fns._ikMisRow(mis, 0, '', ST6({ consentFix: 'off' }));
    expect(h).toContain('Do in Elvanto');
    expect(h).not.toContain('_ikFixOpen(');
  });
  it('a hostile name and form value render inert; the onclick holds only the index', () => {
    const h = makeEnv().fns._ikMisRow({ ...mis, name: HOSTILE, form: { ...mis.form, optOuts: [HOSTILE] } }, 3, '', live(15));
    expect(h).not.toContain(HOSTILE);
    expect(h).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(h).not.toContain(P(4));
  });
  it('_ikLkGo posts one consentLookup and waits', async () => {
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
    expect(x.st).toBe('ready');
  });
  it('a refused queue shows the server message; no network = offline; 404 = expired', async () => {
    const e = makeEnv({ post: (_p, b) => ({ results: [{ id: b.items[0].id, kind: 'action', outcome: 'refused', code: 'LINK_UNAVAILABLE', message: 'Do this in Elvanto for now.' }] }) });
    await e.fns._ikLkGo('forms', 1, '');
    expect(e.fns._ikLk('forms').st).toBe('failed');
    expect(e.fns._ikLk('forms').msg).toBe('Do this in Elvanto for now.');
    const x: any = { kind: 'forms' };
    e.fns._ikLkErr(x, new Error('Load failed'));
    expect(x.st).toBe('offline');
    e.fns._ikLkErr(x, Object.assign(new Error('nf'), { status: 404 }));
    expect(x.msg).toMatch(/expired/);
  });
  it('M6: a resend after a network error with the same id (sameId) posts that id again', async () => {
    const ids: string[] = [];
    const e = makeEnv({ post: (_p, b) => { ids.push(b.items[0].id); if (ids.length === 1) throw new Error('Load failed'); return { results: [{ id: b.items[0].id, kind: 'action', outcome: 'replay' }] }; } });
    await e.fns._ikLkGo('forms', 1, '');
    const x = e.fns._ikLk('forms');
    expect(x.st).toBe('offline');
    await e.fns._ikLkGo('forms', 1, '', x.id);
    expect(ids[1]).toBe(ids[0]);
    expect(e.fns._ikLk('forms').st).toBe('waiting');
    clearTimeout(e.fns._ikLk('forms').poll);
  });
  it('M3/M5: an unreadable answer is an error that says why', () => {
    const f = makeEnv().fns, now = Date.now();
    const x: any = { kind: 'mismatches', since: now };
    f._ikLkApply(x, { status: 'failed', reason: 'unreadable' }, now);
    expect(x.msg).toBe("Couldn't read the answer. Search again.");
  });
});
