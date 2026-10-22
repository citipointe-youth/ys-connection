// Consents "Other (no date)" (2026-10-16, operator rulings). Consent hub (2026-10-23, Task 11): the Other screen and its Mark not received rows
// are gone (step 0 lives in the hub); the lookup's 15-minute wait stays. Was: the 5th Consents pill. Step-0 students in no pushed consent week, each with
// the earliest parent-texted date (console text | parent note) or why there is none, and a profile link. R9 (consents run 2026-10-17):
// a row past its consent Friday with no reply offers Mark not received (one row or Mark all N, one confirm, one batch, per-row results).
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn, SITE_TIME_SRC } from './helpers/extract-fn';

const FNS = ['esc', '_ikLk', '_ikLkBusy', '_ikLkReason', '_ikLkApply', '_ikLkGate', '_ikRev', '_ikMisLines', '_ikMisVal', '_ikFixText', '_ikDmy', 'fmtDay', '_ikFormChip', '_ikFormLines', '_ikFormRowEnd', '_ikAnd', '_ikFormName', 'tidyName', '_ikClCap', '_ikClNow', '_ikClText', '_ikClRow', '_ikClSplit', '_ikClSuggest', '_ikClRoster', '_ikClMulti', '_ikClBusy', '_ikClToLink', '_ikClWho', '_ikClMultiLines', '_ikClMultiAct', 'fmtDay'];
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

describe('Consents Other: rows', () => {
  it('a first Other scan waits 15 minutes before giving up (like Mismatches)', () => {
    const { fns } = env(), now = Date.now();
    const x: any = { kind: 'other', since: now };
    expect(fns._ikLkApply(x, { status: 'working' }, now + 10 * 60000)).toBe(true);
    expect(fns._ikLkApply(x, { status: 'working' }, now + 16 * 60000)).toBe(false);
    expect(x.st).toBe('timeout');
  });
});
