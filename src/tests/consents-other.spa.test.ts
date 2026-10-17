// Consents "Other (no date)" (2026-10-16, operator rulings): the 5th Consents pill. Step-0 students in no pushed consent week, each with
// the earliest parent-texted date (console text | parent note) or why there is none, and a profile link. Display only (no write button).
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

const FNS = ['esc', '_ikConsentSub', '_ikTidyHtml', '_ikTidyList', '_ikTidyTitle', '_ikLk', '_ikLkBusy', '_ikLkReason', '_ikLkApply', '_ikLkStatusHtml',
  '_ikLkPage', '_ikLkResHtml', '_ikLkPages', '_ikLkGate', '_ikRev', '_ikMisLines', '_ikFixBanner', '_ikFixText', '_ikDmy', '_ikFormChip', '_ikFormLines', '_ikFormRowEnd', '_ikAnd', '_ikFormName', 'tidyName', '_ikOtherMiss',
  '_ikClCap', '_ikClNow', '_ikClText', '_ikClRow', '_ikOtherRow'];
const HTML = loadIndexHtml();
const BODY = FNS.map((n) => extractFn(HTML, n)).join('\n');
const FIX_REASON = HTML.match(/^const IK_FIX_REASON = \{[\s\S]*?\};$/m)![0];
const strip = (h: string) => h.replace(/<[^>]*>/g, '');
const P = (n: number) => `9e000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function env() {
  const t = { loads: 0, pushes: 0 };
  const I: any = { csub: 'last', dates: [{ date: '2026-10-16' }], date: '2026-10-16', fixes: {}, lk: null };
  const fns = new Function('__t', '__I', `
    const S = { page: 'link-intake' };
    const _ik = () => __I;
    const navPush = () => { __t.pushes++; }; const _ikDraw = () => {}; const _ikLoad = () => { __t.loads++; };
    const _ikPickDate = () => {}; const _ikFixRestore = () => {}; const icS = () => '';
    const progBar = (s) => '<div>' + s + '</div>'; const _ikSeenLine = () => '';
    const _lkDay = (d) => d; const _lkSeen = (d) => d;
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
  it('an older console (rev 7) says it needs an update and offers no Load', () => {
    const { fns } = env();
    const h = strip(fns._ikLkPage('other', ST(7)));
    expect(h).toContain('The console needs an update before it can list these students.');
    expect(h).not.toContain('Load students');
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
    expect(s).toContain('Parent texted ~20/09/2026 (console text)');
    expect(s).toContain('Parent texted ~02/09/2026 (parent note)');
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
