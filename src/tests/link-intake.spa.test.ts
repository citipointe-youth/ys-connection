// T4 Intake + Consents SPA (spec 2026-10-13-intake-consent-app-spec.md §7, §10, §11, §12 item 4). Extract-and-run: the
// REAL functions from public/index.html run against small stubs (localStorage, API, modal). No server.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

const FNS = ['esc', '_lkTime', '_lkDay', '_lkSeen', '_lkAt', '_lkUuid', '_lkFresh', '_lkAdmFresh', '_lkSoftReset',
  '_nyModeOf', '_nyMode', '_nyOn', '_linkModeOf', '_linkOn', '_linkAdminOn', 'moreItems', 'renderLink', '_lkTickStart', '_lkStatusLoad', '_lkTick',
  '_ikFresh', '_ik', '_ikModuleOn', '_ikRev', '_intakeOn', '_ikSt', '_ikOldConsole', '_ikIsText', '_ikOpenAct', '_ikOpenOf', '_ikAge',
  '_ikSeenLine', '_ikBanner', '_ikReasons', '_ikAct', '_ikChip', '_ikTodo', '_ikTextStep', '_ikAlone', '_ikSaveBlock', '_ikTextBlock',
  '_ikShowText', '_ikDTag', '_ikD26', '_ikTagHtml', '_ikPast', '_ikStepText', '_ikStepsHtml', '_ikResultHtml', '_ikSeed', '_ikAnswerBody',
  '_ikAns', '_ikPost', '_ikOutcome', '_ikLocal', '_ikAnswerSend', '_ikForm', '_ikStudentSub', '_ikChoose', '_ikPair', '_ikPairIdx', '_ikKeep',
  '_ikFieldLabel', '_ikSheetHtml', '_ikSaveOpen', '_ikOneOpen', '_ikTextOpen', '_ikSheetGo', 'renderLinkIntake', '_ikDraw', '_ikPageHtml',
  '_ikListPage', '_ikRowsHtml', '_ikConsentHelp', '_ikFamilyPage', '_ikHead', '_ikKv', '_ikFormHtml', '_ikMatchHtml', '_ikDiffHtml',
  '_ikWho', '_ikVerdictHtml', '_ikTextCardHtml', '_ikSaveHtml', '_ikFamilyHtml', '_ikConsentHtml', '_ikLoad', '_ikLoadRow', '_ikAfterLoad',
  '_ikSchedule', '_ikTab', '_ikOpen', '_ikBack', '_ikLeave'];
const HTML = loadIndexHtml();
const BODY = FNS.map((n) => extractFn(HTML, n)).join('\n');
const CONSTS = HTML.match(/^const IK_FIX = \[[^\]]*\];/m)![0];

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
    ${CONSTS}
    const localStorage = __ls;
    const navigator = { userAgent: 'iPhone Safari' };
    const window = { scrollTo() {} };
    const document = { getElementById: () => null, visibilityState: 'visible' };
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
    expect(on.calls.fresh).toContain('/link/intake?mode=intake');
    expect(on.calls.fresh).toContain('/link/intake?mode=intake&date=2026-10-09');
    expect(on.calls.apps.length).toBe(1);
  });
  it('a console below link rev 4 shows the out-of-date banner instead of the lists, and never loads a date', async () => {
    const e = makeEnv({ fresh: () => ({ ...ST({ rev: 3 }), dates: [{ date: '2026-10-09', takenAt: iso(1000), counts: { needsYou: 0 } }] }) });
    await e.fns._ikLoad(false);
    expect(e.fns._intakeOn()).toBe(false);
    expect(strip(e.fns._ikPageHtml())).toContain("Console out of date: use the console's Youth intake tab");
    expect(e.calls.fresh.some((p: string) => p.includes('date='))).toBe(false);
    // and the Save reason says the same
    expect(e.fns._ikSaveBlock(DET(), LIST(), ST({ rev: 3 }))).toBe("Console out of date: use the console's Youth intake tab");
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
    expect(chip(act({}), ST({ online: false, lastSeenAt: iso(30_000) })).line).toMatch(/^Waiting for the console\. Console last seen \d+:\d\d (am|pm)\.$/);
    expect(chip(act({ status: 'claimed' })).line).toBe('Sending to Elvanto…');
    expect(chip(act({ type: 'intakeAnswer' }))).toEqual({ label: 'Pending', tone: 'wait', line: 'Updating plan…' });
  });
  it('a planned answer is not shown as Saved; the older Save behind it shows', () => {
    const e = makeEnv();
    expect(e.fns._ikChip({ actions: [act({ type: 'intakeAnswer', status: 'sent', reason: 'planned' })] }, ST())).toBe(null);
    expect(e.fns._ikChip({ actions: [act({ type: 'intakeAnswer', status: 'sent', reason: 'planned' }), act({ status: 'shadowed' })] }, ST()).label).toBe('Practice');
  });
  it('sent, already, unclear, refused (detail wins, else the reason), shadowed', () => {
    expect(chip(act({ status: 'sent', resultAt: iso(1000) })).label).toBe('Saved');
    expect(chip(act({ status: 'sent', reason: 'already' })).line).toBe('Already in Elvanto');
    expect(chip(act({ status: 'unclear' }))).toEqual({ label: 'Unclear', tone: 'bad', line: "Not sure it saved. Check in Elvanto or the console's Unclear saves" });
    expect(chip(act({ status: 'refused', reason: 'plan-changed', detail: 'The console said this.' })).line).toBe('The console said this.');
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
  it('needs-you', () => { expect(block(DET({ row: { key: P(1), status: 'needs-you', title: 'A' } }))).toBe('Needs you: sort the lines at the top first.'); });
  it('an answer still pending', () => { expect(block(DET({ actions: [act({ type: 'intakeAnswer' })] }))).toBe('Updating plan…'); });
  it('stale plan', () => { expect(block(DET(), LIST({ stale: true }))).toBe('Plan is over 2 hours old. Refresh first.'); });
  it('an open save row for this family', () => {
    expect(block(DET({ actions: [act({ status: 'claimed' })] }))).toBe('Waiting for the console');
    expect(block(DET({ actions: [act({ type: 'intakeText' })] }))).toBe('Waiting for the console');
  });
  it('the rendered button is disabled with the reason; answers stay allowed while stale', () => {
    const e = makeEnv();
    const h = e.fns._ikFamilyHtml(DET(), LIST({ stale: true }), ST(), e.fns._ikSeed(DETAIL()));
    expect(h).toMatch(/<button[^>]*disabled[^>]*onclick="_ikSaveOpen\(\)"/);
    expect(h).toContain('Plan is over 2 hours old. Refresh first.');
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
  it('practice when a save type is shadow; the consent tab looks at consentSave only', () => {
    expect(b(ST({ caps: { intakeSave: 'shadow', intakeText: 'live', consentSave: 'live' } }), LIST())).toContain('Practice: nothing is sent to Elvanto');
    expect(b(ST({ caps: { intakeSave: 'shadow', consentSave: 'live' } }), LIST(), 'consent')).not.toContain('Practice');
    expect(b(ST({ caps: { intakeSave: 'live', consentSave: 'shadow' } }), LIST(), 'consent')).toContain('Practice: nothing is sent to Elvanto');
  });
  it('stale age, cut, answers last changed in the console', () => {
    expect(b(ST(), LIST({ stale: true, takenAt: iso((2 * 60 + 10) * 60_000 + 5000) }))).toContain('Plan 2 h 10 m old. Refresh first.');
    expect(b(ST(), LIST({ cut: true }))).toContain('Some forms were cut off: every family needs a look');
    expect(b(ST(), LIST({ inputs: { from: 'console', at: iso(60_000) } }))).toMatch(/Answers last changed in the console at \d+:\d\d (am|pm)/);
    expect(b(ST(), LIST({ inputs: { from: 'app', at: iso(60_000) } }))).not.toContain('Answers last changed');
  });
  it('a stale list is greyed; a fresh one is not', () => {
    const rows = [{ key: P(1), status: 'needs-you', title: 'Ava', reason: 'Check the match', fromApp: false, hasText: false, actions: [] }];
    const e = makeEnv();
    expect(e.fns._ikRowsHtml(LIST({ stale: true, rows }), ST(), false)).toContain('ik-grey');
    expect(e.fns._ikRowsHtml(LIST({ rows }), ST(), false)).not.toContain('ik-grey');
    expect(strip(e.fns._ikRowsHtml(LIST({ rows }), ST(), false))).toContain('Needs you (1)');
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
  it('a new answer cancels the still-pending one in the same batch; nothing is written to localStorage', async () => {
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
    expect(b.items[0]).toEqual({ kind: 'cancel', id: P(80) });
    expect(b.items[1]).toMatchObject({ kind: 'action', type: 'intakeAnswer', leaderId: null, payload: { date: '2026-10-09', family: [P(1), P(2)], undo: false } });
    expect(b.device).toEqual({ id: 'dev-1', label: 'iPhone' });
    expect([...e.storage.keys()]).toEqual([]);
    expect(I.det.actions[0]).toMatchObject({ type: 'intakeAnswer', status: 'pending' }); // shown as Updating plan at once
  });
  it('Save sheet: only todo, non-text steps, D25 tag, parent text separate; Save sends those keys verbatim', async () => {
    const e = makeEnv({ post: (_p, b) => ({ results: [{ id: b.items[0].id, kind: 'action', outcome: 'saved' }] }), fresh: () => Promise.reject(new Error('x')) });
    const I = e.fns._ik();
    I.date = '2026-10-09'; I.key = P(1); I.head = ST(); I.list = LIST(); I.det = DET();
    e.fns._ikSaveOpen();
    const sheet = strip(e.calls.modals[0]!);
    expect(sheet).toContain("Save Ava Nguyen's family to Elvanto?");
    expect(sheet).toContain('Approve the parent form');
    expect(sheet).toContain('Set Jo to Affiliate D25');
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
    expect(h).toMatch(/Approve the parent form: Saved \d+:\d\d (am|pm)/);
    expect(h).toContain('Set Jo to Affiliate: Not sure it saved');
    expect(h).toContain('note: Not sent: Stopped: not confirmed.');
    expect(strip(e.fns._ikResultHtml(act({}), DETAIL(), ST({ online: false })))).toMatch(/Pending \(console last seen/);
  });
  it('the consent detail shows the outcome with the D26 tag and the D20(b) step line', () => {
    const e = makeEnv();
    const d = { key: P(3), status: 'ready', title: 'Ava Nguyen', holds: [], outcome: 'No reply: assume consent', consent: { ymd: '2026-10-08', contact: false, total: '' },
      consentNote: '', textedOn: '2026-10-03', profiles: { student: null }, links: [],
      steps: [step({ key: 'cnr:' + P(3), action: 'consentNotReceived', role: 'consent', text: 'Mark consent not received' })] };
    const h = strip(e.fns._ikConsentHtml({ row: { key: P(3), status: 'ready', title: 'Ava Nguyen' }, detail: d, unreadable: false, actions: [] }, LIST(), ST()));
    expect(h).toContain('Consent form Thu 8 Oct: No reply: assume consent D26');
    expect(h).toContain('Provisional rule: assume consent only with a dated text record and no unmatched form.');
    expect(h).toContain('Provisional: this re-saves the whole profile form.');
    expect(h).toContain('Texted on Sat 3 Oct');
  });
});
