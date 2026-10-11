import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractFn } from './helpers/extract-fn';
import { ALLERGIES, CONDITIONS } from '../services/elvanto-forms';

const html = readFileSync('public/index.html', 'utf8');
const listOf = (name: string) => JSON.parse(new RegExp(`const ${name} = (\\[[^\\]]*\\]);`).exec(html)![1]!);
const nyMessage = new Function(`${extractFn(html, '_nyMessage')}; return _nyMessage;`)() as (r: any) => { tone: string; retryParent: boolean; lines: string[] };
const nyErrorText = new Function(`${extractFn(html, '_nyErrorText')}; return _nyErrorText;`)() as (e: any) => { unsent: boolean; text: string };

describe('New youth SPA', () => {
  it('checkbox labels match the server lists exactly', () => {
    expect(listOf('NY_ALLERGIES')).toEqual(Object.keys(ALLERGIES));
    expect(listOf('NY_CONDITIONS')).toEqual(Object.keys(CONDITIONS));
  });
  it('both sent → good, no retry', () => {
    const m = nyMessage({ student: 'sent', parent: 'sent', dryRun: false });
    expect(m).toEqual({ tone: 'good', retryParent: false, lines: ['Student form is in Elvanto.', 'Parent form is in Elvanto.'] });
  });
  it('student rejected → bad, says nothing else was sent', () => {
    const m = nyMessage({ student: 'failed', parent: 'skipped', dryRun: false });
    expect(m.tone).toBe('bad');
    expect(m.retryParent).toBe(false);
    expect(m.lines[1]).toMatch(/Nothing else was sent/);
  });
  it('parent rejected → offers a parent-only retry', () => {
    expect(nyMessage({ student: 'sent', parent: 'failed', dryRun: false }).retryParent).toBe(true);
  });
  it('unconfirmed → warn, tells the host to check Elvanto, no retry', () => {
    const m = nyMessage({ student: 'unconfirmed', parent: 'sent', dryRun: false });
    expect(m.tone).toBe('warn');
    expect(m.retryParent).toBe(false);
    expect(m.lines[0]).toMatch(/Check the forms list in Elvanto/);
  });
  it('repeat and dry run say so', () => {
    expect(nyMessage({ student: 'sent', parent: 'sent', dryRun: false, repeat: true }).lines[0]).toMatch(/already sent/);
    expect(nyMessage({ student: 'skipped', parent: 'skipped', dryRun: true }).lines).toEqual(['Test mode: nothing was sent to Elvanto.']);
  });
  it('a refusal before sending is recognised by its server CODE and shows the server message', () => {
    const cases: Array<[string, number]> = [['BAD_REQUEST', 400], ['MODULE_DISABLED', 404], ['RATE_LIMITED', 429], ['ELVANTO_UNREACHABLE', 502], ['ELVANTO_FORM_CHANGED', 502]];
    for (const [code, status] of cases) {
      expect(nyErrorText(Object.assign(new Error('Check the parent mobile'), { status, code }))).toEqual({ unsent: true, text: 'Check the parent mobile' });
    }
  });
  it('a 502 with no code (Vercel itself, a function that died) is an UNKNOWN outcome, not a refusal', () => {
    for (const status of [502, 400, 404, 429]) {
      const r = nyErrorText(Object.assign(new Error('Bad Gateway'), { status }));
      expect(r.unsent).toBe(false);
      expect(r.text).toMatch(/Check the forms list in Elvanto before sending again/);
      expect(r.text).not.toMatch(/Bad Gateway|try again/i);
    }
  });
  it('an unrelated server code is an unknown outcome too', () => {
    expect(nyErrorText(Object.assign(new Error('x'), { status: 502, code: 'SOMETHING_ELSE' })).unsent).toBe(false);
  });
  it('a lost reply or timeout never says "try again": check Elvanto first', () => {
    for (const e of [new Error("Can't reach the server"), Object.assign(new Error('Please try again'), { status: 503 }), Object.assign(new Error('x'), { status: 500 })]) {
      const r = nyErrorText(e);
      expect(r.unsent).toBe(false);
      expect(r.text).toMatch(/Check the forms list in Elvanto before sending again/);
      expect(r.text).not.toMatch(/try again/i);
    }
  });
  it('junior leaders may open the page', () => {
    expect(html).toMatch(/\['home','my-students','at-risk','prayers','birthdays','bus','new-youth'\]/);
  });
});

// Runs the REAL nySend / nyOpen / renderNewYouth etc. from index.html against minimal stubs.
const FRESH = '{ keep: null, sibling: false, sending: false, result: null, last: null, error: null, unknown: false }';
const FNS = ['_nyModeOf', '_nyMode', '_nyOn', '_nyHost', '_nyHostHtml', '_nyHostDraw', '_nyPickHost', '_nyMessage', '_nyErrorText', 'nySend', 'nyReset', 'nyOpen', 'nyBack', 'nySibling', 'renderNewYouth'];
function harness(post: (path: string, body: any, ms?: number) => Promise<any>, hostName = 'H', picks: any[] = []) {
  const S: any = { user: { role: 'admin' }, page: 'new-youth', settings: { ministryConfig: { modules: { newYouthForms: 'on' } } } };
  const pages: string[] = [];
  const toasts: Array<[string, number | undefined]> = [];
  const scrolled: any[] = [];
  const button: any = { disabled: false, textContent: 'Send to Elvanto', isConnected: true };
  const errEl = { scrollIntoView: (o: any) => scrolled.push(o) };
  const body = { host: hostName, firstName: 'A', lastName: 'T', dob: '2012-04-03', gender: 'm', grade: '8', school: 'S', mobile: '0412345678', parentFirst: 'P', parentLast: 'T', parentMobile: '0498765432' };
  const ref: any = {};
  const doc = { getElementById: (id: string) => (id === 'ny-send' ? button : id === 'ny-err' ? errEl : null) };
  const factory = new Function('S', 'API', 'toast', 'document', 'localStorage', 'setApp', 'shell', 'esc', 'go', 'window', '_nyRead', 'NY_ALLERGIES', 'NY_CONDITIONS',
    'getMyLeaderId', '_lkMyName', '_lkIamPick',
    `let NY = ${FRESH};
    ${FNS.map((n) => extractFn(html, n)).join('\n')}
    return { nySend, nyOpen, nyReset, nyBack, nySibling, renderNewYouth, get NY() { return NY; }, set NY(v) { NY = v; } };`);
  const h = factory(S, { post }, (m: string, d?: number) => toasts.push([m, d]), doc, { setItem() {}, getItem: () => '' },
    (x: string) => pages.push(x), (x: string) => x, (x: any) => String(x), (p: string) => { S.page = p; if (p === 'new-youth') ref.h.renderNewYouth(); }, { scrollTo() {} },
    () => ({ ...body, host: ref.hostName }), [], [], () => (ref.hostName ? 'L1' : null), () => ref.hostName, (then: any) => picks.push(then));
  ref.hostName = hostName;
  ref.h = h;
  return { h, S, pages, toasts, scrolled, button, body, last: () => pages[pages.length - 1] ?? '' };
}
const deferred = () => {
  let res!: (v: any) => void, rej!: (e: any) => void;
  const p = new Promise<any>((a, b) => { res = a; rej = b; });
  return { p, res, rej };
};
const fresh = (over: any = {}) => ({ keep: null, sibling: false, sending: false, result: null, last: null, error: null, unknown: false, ...over });

describe('nySend failure paths', () => {
  it('a 401 during send does not draw the form', async () => {
    const t = harness(async () => { t.S.user = null; throw Object.assign(new Error('Session expired'), { status: 401 }); });
    await t.h.nySend({ preventDefault() {} });
    expect(t.pages).toHaveLength(0);
    expect(t.h.NY.sending).toBe(false);
  });
  it('a parent-only retry that was REFUSED stays on the result page with the server message', async () => {
    const t = harness(async () => { throw Object.assign(new Error('X'), { status: 502, code: 'ELVANTO_UNREACHABLE' }); });
    const earlier = { student: 'sent', parent: 'failed', dryRun: false };
    t.h.NY = fresh({ result: earlier, last: { ...t.body } });
    await t.h.nySend(null, ['parent']);
    expect(t.h.NY.result).toBe(earlier);
    expect(t.h.NY.error).toBe('X');
    expect(t.h.NY.unknown).toBe(false);
    expect(t.pages).toHaveLength(1);
    expect(t.last()).toContain('Send the parent form again');
  });
  it('a parent-only retry with an UNKNOWN outcome offers no ready send button', async () => {
    const t = harness(async () => { throw Object.assign(new Error('Bad Gateway'), { status: 502 }); });
    t.h.NY = fresh({ result: { student: 'sent', parent: 'failed', dryRun: false }, last: { ...t.body } });
    await t.h.nySend(null, ['parent']);
    expect(t.h.NY.unknown).toBe(true);
    expect(t.last()).toMatch(/Check the forms list in Elvanto before sending again/);
    expect(t.last()).not.toContain('id="ny-send"');
    expect(t.last()).not.toContain('Send the parent form again');
    expect(t.last()).not.toContain('nyBack()'); // the full form would send the student a second time
    expect(t.last()).toContain('Next new person');
  });
  it('a REFUSED full send keeps the inputs, stays on the form, and puts the card above Send in view', async () => {
    const t = harness(async () => { throw Object.assign(new Error('Check the parent mobile'), { status: 400, code: 'BAD_REQUEST' }); });
    await t.h.nySend({ preventDefault() {} });
    expect(t.h.NY.result).toBeNull();
    expect(t.h.NY.unknown).toBe(false);
    expect(t.h.NY.keep).toEqual(t.body);
    expect(t.h.NY.error).toBe('Check the parent mobile');
    expect(t.pages).toHaveLength(1);
    const out = t.last();
    expect(out).toContain('id="ny-send"');
    const card = out.indexOf('id="ny-err"');
    expect(card).toBeGreaterThan(-1);
    expect(card).toBeLessThan(out.indexOf('id="ny-send"')); // directly above Send, not at the top of a long form
    expect(out.indexOf('id="ny-send"') - card).toBeLessThan(400);
    expect(out).toContain('Check the parent mobile');
    expect(t.scrolled).toEqual([{ block: 'center' }]);
  });
  it('an UNKNOWN full send shows a warn page with the student name and a deliberate Back button, never a ready Send', async () => {
    const t = harness(async () => { throw new Error("Can't reach the server"); });
    await t.h.nySend({ preventDefault() {} });
    expect(t.h.NY.result).toBeNull();
    expect(t.h.NY.unknown).toBe(true);
    expect(t.h.NY.last).toEqual(t.body);
    expect(t.pages).toHaveLength(1);
    const out = t.last();
    expect(out).toMatch(/Check the forms list in Elvanto before sending again/);
    expect(out).toContain('A T');
    expect(out).toContain('nyBack()');
    expect(out).toContain('Back to the form');
    expect(out).not.toContain('id="ny-send"');
    expect(out).not.toContain('Send to Elvanto');
    expect(out).not.toMatch(/try again/i);
  });
  it('Back to the form restores the inputs and clears the unknown flag', async () => {
    const t = harness(async () => { throw new Error("Can't reach the server"); });
    await t.h.nySend({ preventDefault() {} });
    t.h.nyBack();
    expect(t.h.NY.unknown).toBe(false);
    expect(t.h.NY.error).toBeNull();
    expect(t.h.NY.keep).toEqual(t.body);
    expect(t.last()).toContain('id="ny-send"');
  });
  it('the result page shows the error card, and sign-out clears the form state', () => {
    const r = extractFn(html, 'renderNewYouth');
    const resultBranch = r.slice(r.indexOf('if (NY.result)'), r.indexOf('const k = NY.keep'));
    expect(resultBranch.indexOf('NY.error ?')).toBeGreaterThan(-1);
    expect(resultBranch.indexOf('NY.error ?')).toBeLessThan(resultBranch.indexOf('border-left:4px solid ${colour}'));
    expect(extractFn(html, 'doLogout')).toContain('nyReset()');
  });
});

describe('leaving the screen mid-send (I2)', () => {
  it('the reply for a send the host left is toasted, and does not wipe or repaint the next entry', async () => {
    const d = deferred();
    const t = harness(() => d.p);
    const sending = t.h.nySend({ preventDefault() {} });
    const mine = t.h.NY;
    t.h.NY = fresh({ keep: { firstName: 'Next' } }); // the host went Home, tapped the tile, started the next student
    d.res({ student: 'sent', parent: 'sent', dryRun: false });
    await sending;
    expect(t.pages).toHaveLength(0);
    expect(t.h.NY.keep).toEqual({ firstName: 'Next' });
    expect(t.h.NY.result).toBeNull();
    expect(mine.result).toEqual({ student: 'sent', parent: 'sent', dryRun: false });
    expect(t.toasts).toHaveLength(1);
    expect(t.toasts[0]![0]).toMatch(/Student form is in Elvanto\. Parent form is in Elvanto\./);
    expect(t.toasts[0]![1]).toBeGreaterThanOrEqual(8000);
  });
  it('a reply that lands while the host is on another page does not paint over it', async () => {
    const d = deferred();
    const t = harness(() => d.p);
    const sending = t.h.nySend({ preventDefault() {} });
    t.S.page = 'home';
    d.res({ student: 'sent', parent: 'unconfirmed', dryRun: false });
    await sending;
    expect(t.pages).toHaveLength(0);
    expect(t.toasts[0]![0]).toMatch(/Check the forms list in Elvanto/);
  });
  it('an unknown-outcome failure after leaving still tells the host to check Elvanto, in a long toast', async () => {
    const d = deferred();
    const t = harness(() => d.p);
    const sending = t.h.nySend({ preventDefault() {} });
    t.S.page = 'home';
    d.rej(new Error("Can't reach the server"));
    await sending;
    expect(t.pages).toHaveLength(0);
    expect(t.toasts[0]![0]).toMatch(/Check the forms list in Elvanto before sending again/);
    expect(t.toasts[0]![1]).toBeGreaterThanOrEqual(8000);
  });
  it('coming back to the screen mid-send shows a Sending page, not a blank form, and the reply then lands', async () => {
    const d = deferred();
    const t = harness(() => d.p);
    const sending = t.h.nySend({ preventDefault() {} });
    t.S.page = 'home';
    t.h.nyOpen(); // the More menu entry
    expect(t.S.page).toBe('new-youth');
    expect(t.h.NY.sending).toBe(true); // not reset: still the same in-flight send
    expect(t.last()).toMatch(/Sending/);
    expect(t.last()).not.toContain('id="ny-send"');
    d.res({ student: 'sent', parent: 'sent', dryRun: false });
    await sending;
    expect(t.last()).toContain('Student form is in Elvanto.');
  });
  it('the More entry resets only when nothing is in flight', () => {
    const t = harness(async () => ({}));
    t.h.NY = fresh({ keep: { firstName: 'Old' }, sibling: true });
    t.h.nyOpen();
    expect(t.h.NY.keep).toBeNull();
    expect(t.S.page).toBe('new-youth');
    expect(extractFn(html, 'moreItems')).toContain("open:'nyOpen()'");
    expect(extractFn(html, 'moreItems')).not.toContain('nyReset');
  });
  it('the button reads Sending... while waiting, and a second tap is ignored', async () => {
    const d = deferred();
    const post = vi.fn(() => d.p);
    const t = harness(post);
    const sending = t.h.nySend({ preventDefault() {} });
    expect(t.button.textContent).toBe('Sending...');
    expect(t.button.disabled).toBe(true);
    await t.h.nySend({ preventDefault() {} });
    expect(post).toHaveBeenCalledTimes(1);
    t.S.page = 'home'; // left; the button node is gone
    t.button.isConnected = false;
    d.res({ student: 'sent', parent: 'sent', dryRun: false });
    await sending;
    expect(t.button.textContent).toBe('Sending...'); // a detached node is never touched
  });
  it('the SPA comment states the real worst case', () => {
    expect(extractFn(html, 'nySend')).not.toMatch(/35 s/);
  });
});

describe('result page buttons (M3)', () => {
  const page = (result: any, sibling = false) => {
    const t = harness(async () => ({}));
    t.h.NY = fresh({ sibling, result, last: { ...t.body } });
    t.h.renderNewYouth();
    return t.last();
  };
  it('sibling is offered after sent or unconfirmed parent forms', () => {
    expect(page({ student: 'sent', parent: 'sent', dryRun: false })).toContain('nySibling()');
    expect(page({ student: 'sent', parent: 'unconfirmed', dryRun: false })).toContain('nySibling()');
    expect(page({ student: 'unconfirmed', parent: 'unconfirmed', dryRun: false })).toContain('nySibling()');
  });
  it('sibling is offered after a student-only send (a brother or sister) and in test mode', () => {
    expect(page({ student: 'sent', parent: 'skipped', dryRun: false }, true)).toContain('nySibling()');
    expect(page({ student: 'skipped', parent: 'skipped', dryRun: true })).toContain('nySibling()');
  });
  it('sibling is NOT offered when the parent form failed, which competes with the parent retry', () => {
    const out = page({ student: 'sent', parent: 'failed', dryRun: false });
    expect(out).toContain('Send the parent form again');
    expect(out).not.toContain('nySibling()');
  });
  it('sibling is NOT offered when the student form failed', () => {
    const out = page({ student: 'failed', parent: 'skipped', dryRun: false });
    expect(out).not.toContain('nySibling()');
    expect(out).toContain('Back to the form');
  });
  it('the sibling card is true after an unconfirmed parent form too', () => {
    const t = harness(async () => ({}));
    t.h.NY = fresh({ sibling: true });
    t.h.renderNewYouth();
    expect(t.last()).toContain('Only the student form will be sent: the parent form was sent with the last student.');
    expect(t.last()).not.toContain('already in');
  });
});


// ---- Task 7: shadow mode, "New person" naming, nav swap; 2026-10-12: the More menu ----
const modeOf = (mode: any, role: string, bus = false) => ({ user: { role }, page: 'home', settings: { ministryConfig: { modules: { newYouthForms: mode, busMinistry: bus } } } });
const nyOnFn = (S: any) => new Function('S', `${extractFn(html, '_nyModeOf')}; ${extractFn(html, '_nyMode')}; ${extractFn(html, '_nyOn')}; return _nyOn;`)(S) as () => boolean;
const NAV_FNS = ['_nyModeOf', '_nyMode', '_nyOn', '_linkOn', '_busOn', '_prayersOn', 'moreItems', '_navItemsBase', '_navSlots', 'navItems', 'bottomNavItems', '_navClick', '_isRootPage', 'openMore'];
type NavFns = { navItems: () => any[]; bottomNavItems: () => any[]; _navClick: (it: any) => string; moreItems: () => any[]; _isRootPage: (p: string) => boolean; openMore: () => void };
const navFns = (S: any, modal: (h: string) => void = () => {}) => new Function('S', 'L', 'modal', 'icN', 'esc', `${NAV_FNS.map((n) => extractFn(html, n)).join('\n')}; return { navItems, bottomNavItems, _navClick, moreItems, _isRootPage, openMore };`)(
  S, (k: string) => (k === 'busMinistry' ? 'Bus Ministry' : k), modal, (k: string) => `<i ${k}>`, (x: string) => x,
) as NavFns;
const ids = (xs: any[]) => xs.map((i) => i.id);
// The Elvanto link entries share this switch (link.spa.test.ts covers them); these tests look at the rest.
const noLink = (xs: string[]) => xs.filter((id) => !id.startsWith('link-'));
const ROLES = ['leader', 'grade', 'quad', 'director', 'admin'];

describe('_nyOn: who sees the New person screen', () => {
  it('off: nobody', () => {
    for (const r of ROLES) expect(nyOnFn(modeOf('off', r))()).toBe(false);
  });
  it('on: everybody', () => {
    for (const r of ROLES) expect(nyOnFn(modeOf('on', r))()).toBe(true);
  });
  it('shadow: the admin login only', () => {
    for (const r of ['leader', 'grade', 'quad', 'director']) expect(nyOnFn(modeOf('shadow', r))()).toBe(false);
    expect(nyOnFn(modeOf('shadow', 'admin'))()).toBe(true);
  });
  it('a legacy boolean still works (true = on, false/missing = off)', () => {
    expect(nyOnFn(modeOf(true, 'grade'))()).toBe(true);
    expect(nyOnFn(modeOf(false, 'admin'))()).toBe(false);
    expect(nyOnFn(modeOf(undefined, 'admin'))()).toBe(false);
    expect(nyOnFn({ user: { role: 'admin' }, settings: null })()).toBe(false);
  });
});

describe('bottom nav order', () => {
  it('grade: Home | Health | My Connections | Prayers | Setup', () => {
    const n = navFns(modeOf('off', 'grade'));
    expect(ids(n.bottomNavItems())).toEqual(['home', 'at-risk', 'my-students', 'prayers', 'leaders']);
    expect(ids(n.navItems())).toEqual(['home', 'at-risk', 'my-students', 'prayers', 'leaders', 'trends', 'birthdays']);
  });
  it('leader: Home | Prayers | Health | My Connections | Birthdays', () => {
    const n = navFns(modeOf('off', 'leader'));
    expect(ids(n.bottomNavItems())).toEqual(['home', 'prayers', 'at-risk', 'my-students', 'birthdays']);
  });
  it('the swap keeps each item id, icon, label and mbl as they were', () => {
    const g = navFns(modeOf('off', 'grade')).navItems();
    expect(g.find((i) => i.id === 'prayers')).toMatchObject({ ic: 'pray', label: 'Prayers', mbl: 'Prayers' });
    expect(g.find((i) => i.id === 'my-students')).toMatchObject({ ic: 'users', label: 'My Connections' });
  });
  it('quad, director and admin keep their order', () => {
    expect(ids(navFns(modeOf('off', 'quad')).bottomNavItems())).toEqual(['home', 'at-risk', 'prayers', 'trends', 'leaders']);
    expect(ids(navFns(modeOf('off', 'director')).bottomNavItems())).toEqual(['home', 'at-risk', 'prayers', 'trends', 'leaders']);
    expect(ids(navFns(modeOf('off', 'admin')).bottomNavItems())).toEqual(['home', 'at-risk', 'prayers', 'leaders', 'admin']);
  });
  it('the shell builds both navs from _navClick, so desktop and bottom agree', () => {
    const shell = extractFn(html, '_initShell');
    expect(shell.match(/_navClick\(it\)/g)).toHaveLength(2);
    expect(shell).not.toMatch(/onclick="go\('\$\{it\.id\}'\)"/);
  });
});

describe('the More menu (in the Prayers slot)', () => {
  it('only Prayers available: the slot stays a plain Prayers tab', () => {
    for (const r of ROLES) {
      for (const mode of ['off', 'shadow']) {
        if (mode === 'shadow' && r === 'admin') continue;
        const n = navFns(modeOf(mode, r));
        expect(ids(n.moreItems()), `${mode}/${r}`).toEqual(['prayers']);
        const p = n.navItems().find((i) => i.id === 'prayers')!;
        expect(p.action, `${mode}/${r}`).toBeUndefined();
        expect(n._navClick(p)).toBe("go('prayers')");
        expect(ids(n.navItems())).not.toContain('more');
      }
    }
  });
  it('Bus on: every role gets More in the Prayers slot, same position', () => {
    for (const r of ROLES) {
      const n = navFns(modeOf('off', r, true));
      const before = ids(navFns(modeOf('off', r)).navItems());
      expect(ids(n.navItems()), r).toEqual(before.map((id) => (id === 'prayers' ? 'more' : id)));
      const m = n.navItems().find((i) => i.id === 'more')!;
      expect(m).toMatchObject({ ic: 'grid', label: 'More', mbl: 'More', action: 'openMore()' });
      expect(n._navClick(m)).toBe('openMore()');
      expect(ids(n.moreItems())).toEqual(['prayers', 'bus']);
    }
  });
  it('shadow: New person is in More for the admin only', () => {
    expect(noLink(ids(navFns(modeOf('shadow', 'admin')).moreItems()))).toEqual(['prayers', 'new-youth']);
    expect(noLink(ids(navFns(modeOf('shadow', 'admin', true)).moreItems()))).toEqual(['prayers', 'bus', 'new-youth']);
    for (const r of ['leader', 'grade', 'quad', 'director']) expect(ids(navFns(modeOf('shadow', r, true)).moreItems()), r).toEqual(['prayers', 'bus']);
  });
  it('on: New person is in More for every role', () => {
    for (const r of ROLES) expect(noLink(ids(navFns(modeOf('on', r)).moreItems())), r).toEqual(['prayers', 'new-youth']);
  });
  it('the sheet lists each entry with its entry call; New person uses nyOpen (never a reset)', () => {
    let shown = '';
    navFns(modeOf('shadow', 'admin', true), (h) => { shown = h; }).openMore();
    expect(shown).toContain('More');
    expect(shown).toContain(`closeModal();go('prayers')`);
    expect(shown).toContain(`closeModal();go('bus')`);
    expect(shown).toContain('closeModal();nyOpen()');
    expect(shown).toContain('Cancel');
    expect(shown).not.toMatch(/nyReset/);
    expect(shown.indexOf('Prayers')).toBeLessThan(shown.indexOf('Bus Ministry'));
    expect(shown.indexOf('Bus Ministry')).toBeLessThan(shown.indexOf('New person'));
  });
  it('the sheet marks the page you are on', () => {
    let shown = '';
    navFns({ ...modeOf('off', 'grade', true), page: 'bus' }, (h) => { shown = h; }).openMore();
    expect(shown).toMatch(/class="more-row on" onclick="closeModal\(\);"><i bus>/);
    expect(shown).toMatch(/class="more-row" onclick="closeModal\(\);go\('prayers'\)"><i pray>/);
  });
  it('the row for the page you are on only closes the sheet: it never re-runs nyOpen over a form or result', () => {
    let shown = '';
    navFns({ ...modeOf('shadow', 'admin', true), page: 'new-youth' }, (h) => { shown = h; }).openMore();
    expect(shown).not.toContain('nyOpen()');
    expect(shown).toMatch(/class="more-row on" onclick="closeModal\(\);"><i plus><span>New person/);
    expect(shown).toContain(`closeModal();go('prayers')`);
    expect(shown).toContain(`closeModal();go('bus')`);
  });
  it('the More nav item says it opens a popup', () => {
    expect(extractFn(html, '_initShell').match(/it\.action \? ' aria-haspopup="dialog"' : ''/g)).toHaveLength(2);
  });
  it('Prayers stays a root page behind More (no back arrow); Bus and New person stay sub-pages', () => {
    const n = navFns(modeOf('shadow', 'admin', true));
    expect(n._isRootPage('prayers')).toBe(true);
    expect(n._isRootPage('bus')).toBe(false);
    expect(n._isRootPage('new-youth')).toBe(false);
  });
  it('More lights up while on any page it lists', () => {
    expect(extractFn(html, '_updateNavActive')).toContain("el.dataset.navPage === 'more' && moreItems().some(m => m.id === cur)");
  });
  it('New person has no Home tile; the leader Home buttons still show Prayers', () => {
    expect(html).not.toContain('_nyHomeTile');
    expect(html).not.toContain('nyPrayersMenu');
    expect(extractFn(html, 'renderLeaderHome')).toContain("_navItemsBase().filter(i => i.id !== 'home' && (i.id !== 'prayers' || _prayersOn()))");
  });
});

describe('"New person" is the name the host sees', () => {
  it('title, tile and buttons say New person', () => {
    const r = extractFn(html, 'renderNewYouth');
    expect(r).not.toMatch(/New youth/);
    expect(r.match(/<h1>New person<\/h1>/g)!.length).toBeGreaterThanOrEqual(4);
    expect(r).toContain('Next new person');
    expect(extractFn(html, 'moreItems')).toContain("label:'New person'");
    expect(extractFn(html, 'moreItems')).not.toMatch(/New youth/);
  });
  it('Youth Setup shows an Off / Shadow mode / On select and no checkbox for it', () => {
    expect(html).toContain("_setupSet('modules.newYouthForms', this.value)");
    expect(html).not.toContain("_setupSet('modules.newYouthForms', this.checked)");
    expect(html).toMatch(/Shadow mode \(admin only\)/);
    expect(html).toMatch(/newYouthForms: 'off'/);
    expect(html).toMatch(/Elvanto features \$\{helpTip\("Turns on the screens that send to Elvanto: New person, Check-in/);
  });
  it('saving Youth Setup rebuilds the nav when the module state changed', () => {
    expect(extractFn(html, 'saveMinistrySetup')).toContain('_initShell()');
  });
  it('Bus Ministry keeps its own New Person button', () => {
    expect(html).toMatch(/New Person/);
  });
});

describe('the host is the "I am" leader (ledger 22)', () => {
  it('no "Your name (host)" input and no ysc.nyHost; the form shows "Host: <leader>" with a Change control', () => {
    expect(html).not.toContain('Your name (host)');
    expect(html).not.toContain('ysc.nyHost');
    const t = harness(async () => ({}), 'Cody <b>Cobb</b>');
    t.h.renderNewYouth();
    expect(t.last()).toContain('id="ny-hostc"');
    expect(t.last()).not.toContain('id="ny-host"');
    const host = new Function('S', 'esc', 'getMyLeaderId', '_lkMyName', `${extractFn(html, '_nyHost')}; ${extractFn(html, '_nyHostHtml')}; return _nyHostHtml;`);
    const esc = (s: any) => String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const out = host({ user: { role: 'grade' } }, esc, () => 'L1', () => 'Cody <b>Cobb</b>')();
    expect(out).toContain('Host: Cody &lt;b&gt;Cobb&lt;/b&gt;');
    expect(out).toContain('_nyPickHost()');
    expect(out).toContain('>Change<');
    const none = host({ user: { role: 'grade' } }, esc, () => null, () => '')();
    expect(none).toContain('>Pick<');
    // a junior leader login uses its bound leader: no Change
    const bound = host({ user: { role: 'leader', displayName: 'Dana' } }, esc, () => 'L9', () => '')();
    expect(bound).toContain('Host: Dana');
    expect(bound).not.toContain('_nyPickHost');
    expect(extractFn(html, '_nyPickHost')).toContain('_lkIamPick(');
    expect(extractFn(html, '_lkIamUse')).toContain('_lkSwitchLeader(id)');
  });
  it('no leader picked: the picker opens and nothing is sent; the leader name goes where the host name went', async () => {
    const posts: any[] = [];
    const picks: any[] = [];
    const t = harness(async (_p, b) => { posts.push(b); return { student: 'sent', parent: 'sent', dryRun: false }; }, '', picks);
    await t.h.nySend({ preventDefault() {} });
    expect(posts).toHaveLength(0);
    expect(picks).toHaveLength(1);
    const k = harness(async (_p, b) => { posts.push(b); return { student: 'sent', parent: 'sent', dryRun: false }; }, 'Cody Cobb');
    await k.h.nySend({ preventDefault() {} });
    expect(posts).toHaveLength(1);
    expect(posts[0].host).toBe('Cody Cobb');
    expect(extractFn(html, '_nyRead')).toContain('host: _nyHost()');
  });
});
