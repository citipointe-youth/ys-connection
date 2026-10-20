// Consents "Other (no date)" (2026-10-16, operator rulings): the 5th Consents pill. Step-0 students in no pushed consent week, each with
// the earliest parent-texted date (console text | parent note) or why there is none, and a profile link. R9 (consents run 2026-10-17):
// a row past its consent Friday with no reply offers Mark not received (one row or Mark all N, one confirm, one batch, per-row results).
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn, SITE_TIME_SRC } from './helpers/extract-fn';

const FNS = ['esc', '_ikConsentSub', '_ikTidyHtml', '_ikTidyList', '_ikTidyTitle', '_ikLk', '_ikLkBusy', '_ikLkReason', '_ikLkApply', '_ikLkStatusHtml',
  '_ikLkPage', '_ikLkResHtml', '_ikLkPages', '_ikLkGate', '_ikRev', '_ikMisLines', '_ikMisVal', '_ikFixBanner', '_ikFixText', '_ikDmy', 'fmtDay', '_ikFormChip', '_ikFormLines', '_ikFormRowEnd', '_ikAnd', '_ikFormName', 'tidyName', '_ikOtherMiss',
  '_ikClCap', '_ikClNow', '_ikClText', '_ikClRow', '_ikClSplit', '_ikClSuggest', '_ikClRoster', '_ikClMulti', '_ikClBusy', '_ikClToLink', '_ikClWho', '_ikClMultiLines', '_ikClMultiAct', '_ikOtherRow', 'fmtDay', '_ikNrState', '_ikNrOk', '_ikNrRowHtml', '_ikNrAllHtml', '_ikNrOpen', '_ikNrGo'];
const HTML = loadIndexHtml();
const BODY = SITE_TIME_SRC + '\n' + FNS.map((n) => extractFn(HTML, n)).join('\n');
const FIX_REASON = HTML.match(/^const IK_FIX_REASON = \{[\s\S]*?\};$/m)![0];
const strip = (h: string) => h.replace(/<[^>]*>/g, '');
const P = (n: number) => `9e000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function env() {
  const t: any = { loads: 0, pushes: 0, posts: [], modal: '', toast: '', leader: 'L1', picks: 0, answer: null, n: 0 };
  const I: any = { csub: 'last', dates: [{ date: '2026-10-16' }], date: '2026-10-16', fixes: {}, lk: null };
  const fns = new Function('__t', '__I', `
    const S = { page: 'link-intake' };
    const _ik = () => __I;
    const navPush = () => { __t.pushes++; }; const _ikDraw = () => {}; const _ikLoad = () => { __t.loads++; };
    const _ikPickDate = () => {}; const _ikFixRestore = () => {}; const icS = () => '';
    const progBar = (s) => '<div>' + s + '</div>'; const _ikSeenLine = () => '';
    const _lkDay = (d) => d; const _lkSeen = (d) => d;
    const getMyLeaderId = () => __t.leader; const _lkIamPick = (then) => { __t.picks++; __t.then = then; };
    const modal = (h) => { __t.modal = h; }; const closeModal = () => {}; const toast = (m) => { __t.toast = m; };
    const _lkUuid = () => 'id-' + (++__t.n);
    const _ikPost = async (items) => { __t.posts.push(items); return __t.answer ? __t.answer(items) : items.map((it) => ({ kind: 'action', id: it.id, outcome: 'saved' })); };
    const _ikOutcome = (results, id) => (results || []).find((r) => r && r.kind === 'action' && r.id === id) || null;
    ${FIX_REASON}
    const IK_CONTACT_RE = /contact with my child/i;
    ${BODY}
    return { ${FNS.join(', ')} };`)(t, I);
  return { fns, t, I };
}
const ST = (rev = 8) => ({ consoleLinkRev: rev, console: { capabilities: { consentLookup: 'live', consentFix: 'live', consentLink: 'live' } } });
const ROWS = [
  { personId: P(11), rowId: P(21), name: 'Avery <Tran>', date: '2026-09-20', source: 'console text', why: '', link: 'https://your-org.elvanto.com.au/admin/people/person/?id=' + P(11) },
  { personId: P(12), rowId: P(22), name: 'Bo Sample', date: '2026-09-02', source: 'parent note', why: '', link: null },
  { personId: P(13), rowId: P(23), name: 'Jamie Test', date: null, source: null, why: 'Parent not texted yet (Parent Consent step 1 is not Complete)', link: 'https://your-org.elvanto.com.au/admin/people/person/?id=' + P(13) },
];

describe('Consents Other: the 5th pill', () => {
  it('R1 (consents run 2026-10-17): no Show dropdown; Tidy up lists four tools, the third "On step 0, not in a week"; a tap opens it', () => {
    const { fns, I, t } = env();
    const h = fns._ikTidyHtml();
    expect(strip(h)).toBe('Tidy upForms with no personProfiles that differ from formOn step 0, not in a weekFind any consent form');
    expect(h).toContain(`onclick="_ikConsentSub('other')"`);
    expect(h).not.toContain('<select');
    expect(fns._ikTidyTitle('other')).toBe('On step 0, not in a week');
    fns._ikConsentSub('other');
    expect(I.csub).toBe('other');
    expect(t.pushes).toBe(1);
    fns._ikConsentSub('other'); // the same tool again: nothing new on the back stack
    expect(t.pushes).toBe(1);
  });
  it('R1: a Tidy up row counts only a list this session already loaded (no search)', () => {
    const { fns, I } = env();
    I.lk = { other: { res: { total: 7 }, resQ: '' }, forms: { res: { total: 3 }, resQ: 'sam' } };
    const h = strip(fns._ikTidyHtml());
    expect(h).toContain('On step 0, not in a week7');
    expect(h).toContain('Find any consent form'); expect(h).not.toContain('Find any consent form3');
  });
  it('a rev 8 console: no intro sentence (R1: the screen title says it), a search and one Load button', () => {
    const { fns } = env();
    const h = fns._ikLkPage('other', ST());
    expect(strip(h)).not.toContain('Students on step 0 with no consent week.');
    expect(h).toContain("_ikLkSearch('other')");
    expect(strip(h)).toContain('Load students');
  });
});

describe('Consents Other: rows', () => {
  it('a dated row says "Parent texted ~dd/mm/yyyy (source)", an undated one "No date found: why"; names escaped', () => {
    const { fns } = env();
    const x = fns._ikLk('other');
    Object.assign(x, { st: 'ready', res: { rows: ROWS, page: 1, pageSize: 25, total: 3 } });
    const h = fns._ikLkResHtml('other', x, ST()), s = strip(h);
    expect(s).toMatch(/Parent texted ~Sun 20 Sep( 2026)? \(console text\)/); // UI standard F: fmtDay, not dd/mm/yyyy
    expect(s).toMatch(/Parent texted ~Wed 2 Sep( 2026)? \(parent note\)/);
    expect(s).toContain('No date found: Parent not texted yet (Parent Consent step 1 is not Complete)');
    expect(h).toContain('Avery &lt;Tran&gt;');
    expect(s).toContain('3 students');
  });
  it('a profile link opens Elvanto in a new tab; a row without one has none; no write button anywhere', () => {
    const { fns } = env();
    const x = fns._ikLk('other');
    Object.assign(x, { st: 'ready', res: { rows: ROWS, page: 1, pageSize: 25, total: 3 } });
    const h = fns._ikLkResHtml('other', x, ST());
    expect((h.match(/<a /g) || []).length).toBe(2);
    expect(h).toContain(`href="https://your-org.elvanto.com.au/admin/people/person/?id=${P(11)}" target="_blank" rel="noopener"`);
    expect(h).not.toMatch(/onclick="_ik(Fix|Cl)/);
    expect(h).not.toContain('btn-primary');
  });
  it('a non-https link is never rendered', () => {
    const { fns } = env();
    const x = fns._ikLk('other');
    Object.assign(x, { st: 'ready', res: { rows: [{ ...ROWS[0], link: 'javascript:alert(1)' }], page: 1, pageSize: 25, total: 1 } });
    expect(fns._ikLkResHtml('other', x, ST())).not.toContain('javascript:');
  });
  it('empty: "Every student on step 0 has a week."; R7: a search with no match never blames the search', () => {
    const { fns, I } = env();
    const x = fns._ikLk('other');
    Object.assign(x, { st: 'ready', res: { rows: [], page: 1, pageSize: 25, total: 0 } });
    expect(strip(fns._ikLkResHtml('other', x, ST()))).toBe('Every student on step 0 has a week.');
    x.resQ = 'zed';
    expect(strip(fns._ikLkResHtml('other', x, ST()))).toBe('Nobody on step 0 without a week matches &quot;zed&quot;. Students in a week above, or whose form is approved, are not listed here.'); // esc() encodes the quotes
    I.findMiss = 'Kuyi Alway'; x.resQ = 'Kuyi Alway'; // from step 0's Consents button: names the student
    expect(strip(fns._ikLkResHtml('other', x, ST()))).toBe("Kuyi Alway isn&#39;t on a consent list. Their form may already be approved.");
  });
  it('a first Other scan waits 15 minutes before giving up (like Mismatches)', () => {
    const { fns } = env(), now = Date.now();
    const x: any = { kind: 'other', since: now };
    expect(fns._ikLkApply(x, { status: 'working' }, now + 10 * 60000)).toBe(true);
    expect(fns._ikLkApply(x, { status: 'working' }, now + 16 * 60000)).toBe(false);
    expect(x.st).toBe('timeout');
  });
});

describe('R9: Mark not received on Consents Other (consents run 2026-10-17)', () => {
  const NP = P(91), S0 = P(92);
  // NOW is real time: a Friday long past and one far ahead.
  const row = (n: number, o: Record<string, unknown> = {}) => ({ personId: P(30 + n), rowId: P(40 + n), name: 'Kid' + n + ', Sample', date: '2026-10-05',
    source: 'parent note', why: '', link: null, flowId: NP, stepId: S0, dnc: false, consentFriday: '2026-10-09', notReceivedOk: true, marking: false, ...o });
  const page = (rows: unknown[]) => {
    const e = env(), x = e.fns._ikLk('other');
    Object.assign(x, { st: 'ready', res: { rows, page: 1, pageSize: 25, total: rows.length } });
    return { ...e, x, html: () => e.fns._ikLkResHtml('other', x, ST(10)) };
  };
  it('only a row past its consent Friday gets the button; before it "Waiting (consent ...)"; DO NOT CONTACT a chip; marking a status', () => {
    const { html } = page([row(1), row(2, { notReceivedOk: false, consentFriday: '2999-01-01' }), row(3, { dnc: true, notReceivedOk: false }),
      row(4, { marking: true }), row(5, { flowId: null, notReceivedOk: false, consentFriday: null })]);
    const h = html(), s = strip(h);
    expect((h.match(/>Mark not received</g) || []).length).toBe(1);
    expect(h).toContain('onclick="_ikNrOpen(0)"');
    expect(s).toMatch(/No reply by Fri 9 Oct( 2026)?, 9am/);
    expect(s).toContain('Waiting (consent 2999-01-01)');
    expect(s).toContain('Do not contact');
    expect(s).toContain('Marking consent not received.');
    expect(h).not.toContain('Mark all'); // one markable row: the row's own button only
  });
  it('Mark all N counts only the markable rows on this page', () => {
    const { html } = page([row(1), row(2), row(3, { dnc: true, notReceivedOk: false }), row(4, { notReceivedOk: false, consentFriday: '2999-01-01' }), row(5)]);
    const s = strip(html());
    expect(s).toContain('3 on this page had no reply by their consent Friday.');
    expect(s).toContain('Mark all 3');
  });
  it('per row: one confirm that says what is written, then one completeStep (the R4 path, signed by I am)', async () => {
    const { fns, t, I } = page([row(1), row(2)]);
    fns._ikNrOpen(1);
    expect(strip(t.modal)).toContain('Mark Sample Kid2 consent not received?');
    expect(strip(t.modal)).toContain('This marks &quot;Consent not received&quot; (dated today) on their Elvanto profile, then completes New People step 0.');
    expect(t.modal).toContain('onclick="_ikNrGo()"');
    await fns._ikNrGo();
    expect(t.posts).toHaveLength(1);
    expect(t.posts[0]).toEqual([{ kind: 'action', id: 'id-1', type: 'completeStep', payload: { rowId: P(42), flowId: NP, stepId: S0, personId: P(32), notePrivate: false },
      note: null, leaderId: 'L1' }]);
    expect(I.nr[P(42)]).toEqual({ sent: true, msg: null });
    expect(fns._ikNrOk(row(2))).toBe(false); // no second tap
  });
  it('no "I am": the picker first, then the same sheet', () => {
    const { fns, t } = page([row(1)]);
    t.leader = null;
    fns._ikNrOpen(0);
    expect(t.picks).toBe(1);
    expect(t.modal).toBe('');
    t.leader = 'L1'; t.then();
    expect(t.modal).toContain('_ikNrGo');
  });
  it('Mark all: one confirm, 20 a call in order, each row its own answer; a refused row says why and keeps its button', async () => {
    const rows = Array.from({ length: 23 }, (_, i) => row(i + 1));
    rows[22] = row(23, { dnc: true, notReceivedOk: false }); // never sent
    const { fns, t, I } = page(rows);
    t.answer = (items: any[]) => items.map((it: any, k: number) => (it.payload.rowId === P(45)
      ? { kind: 'action', id: it.id, outcome: 'refused', code: 'CONSENT_CHECK_FIRST', message: 'Do the consent check first.' }
      : { kind: 'action', id: it.id, outcome: k === 0 ? 'duplicate' : 'saved' }));
    fns._ikNrOpen(-1);
    expect(strip(t.modal)).toContain('Mark 22 students consent not received?');
    expect(t.modal).toContain('Show names'); // more than 5 fold away
    await fns._ikNrGo();
    expect(t.posts.map((p: unknown[]) => p.length)).toEqual([20, 2]);
    expect(t.posts.flat().map((it: any) => it.payload.rowId)).toEqual(rows.slice(0, 22).map((r) => r.rowId));
    expect(I.nr[P(45)]).toEqual({ sent: false, msg: 'Do the consent check first.' });
    expect(fns._ikNrOk(rows[4])).toBe(true);
    expect(strip(fns._ikNrRowHtml(rows[4], 4, false))).toContain('Do the consent check first.');
    expect(I.nr[P(41)]).toEqual({ sent: true, msg: null }); // a duplicate is already queued: counted as marking
    expect(t.toast).toBe('Marking 21. The console works through them one at a time.');
  });
  it('no answer from the server: the phone keeps and resends them, so the rows show that and offer no new tap', async () => {
    const { fns, t, I } = page([row(1), row(2)]);
    t.answer = () => { throw Object.assign(new Error('offline'), { status: 0 }); };
    fns._ikNrOpen(-1);
    await fns._ikNrGo();
    expect(I.nr[P(41)]).toEqual({ sent: true, msg: 'Not sent yet. It goes again by itself.' });
    expect(fns._ikNrOk(row(1))).toBe(false);
    expect(t.toast).toBe('Nothing was marked. See each row.');
  });
});
