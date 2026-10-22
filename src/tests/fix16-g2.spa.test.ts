// Fix round 2026-10-16, lane G2 (Consents tab): F-08, F-18, F-32(b), F-36, F-42, F-48(a), L6-8.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn, SITE_TIME_SRC } from './helpers/extract-fn';

const FNS = ['esc', '_ikLk', '_ikLkBusy', '_ikLkReason', '_ikLkErr', '_ikLkGo', '_ikLkItem', '_ikLkApply', '_ikLkPoll',
  '_ikMisRow', '_ikLkGate', '_ikRev', '_ikMisLines', '_ikMisVal', '_ikFixText', '_ikDmy', 'fmtDay', '_ikFormChip', '_ikFormLines', '_ikFormRowEnd', '_ikAnd', '_ikFormName', 'tidyName',
  '_ikClCap', '_ikClNow', '_ikClText', '_ikClRow', '_ikClSplit', '_ikClSuggest', '_ikClRoster', '_ikClMulti', '_ikClBusy', '_ikClToLink', '_ikClWho', '_ikClMultiLines', '_ikClMultiAct'];
const HTML = loadIndexHtml();
const BODY = SITE_TIME_SRC + '\n' + FNS.map((n) => extractFn(HTML, n)).join('\n');
const FIX_REASON = HTML.match(/^const IK_FIX_REASON = \{[\s\S]*?\};$/m)![0];
const strip = (h: string) => h.replace(/<[^>]*>/g, '');
const P = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function env(o: { fresh?: () => any } = {}) {
  const t = { delays: [] as number[], cbs: [] as Array<() => any>, picked: [] as number[], loads: 0 };
  const I: any = { csub: 'last', dates: [{ date: '2026-10-16' }, { date: '2026-10-09' }], date: '2026-10-16', fixes: {}, lk: null };
  const fns = new Function('__t', '__I', '__fresh', `
    const S = { page: 'link-intake' };
    const navigator = { onLine: true };
    const document = { getElementById: () => null };
    const API = { fresh: () => __fresh() };
    const setTimeout = (cb, ms) => { __t.delays.push(ms); __t.cbs.push(cb); return __t.cbs.length; };
    const clearTimeout = () => {};
    const _ik = () => __I; const _ikSt = () => null; // N02: console status unknown here
    const navPush = () => {}; const _ikDraw = () => {}; const _ikLoad = () => { __t.loads++; };
    const _ikPickDate = (i) => { __t.picked.push(i); __I.date = __I.dates[i].date; };
    const progBar = (s) => '<div>' + s + '</div>'; const icS = (k) => ''; const _ikSeenLine = () => '';
    const _lkDay = (d) => d; const _lkUuid = () => 'u-1'; const _ikPost = async () => { throw new Error('Load failed'); }; const _ikOutcome = () => null; const _lkSeen = (d) => d;
    ${FIX_REASON}
    const IK_CONTACT_RE = /contact with my child/i;
    ${BODY}
    return { ${FNS.join(', ')} };`)(t, I, o.fresh ?? (() => ({ status: 'waiting' })));
  return { fns, t, I };
}
const ST = (caps: Record<string, string> = {}) => ({ consoleLinkRev: 7, console: { capabilities: { consentLookup: 'live', consentFix: 'live', consentLink: 'live', ...caps } } });

// Consents run 2026-10-17 (R1): F-48(a) is gone with the Show dropdown: the week is the chips, a Tidy up tool is its own screen.
describe('F-32(b) no doubled prefix', () => {
  it('a refused detail that already says Not sent/Not saved is shown as is', () => {
    const { fns } = env();
    expect(fns._ikClText({ status: 'refused', detail: 'Not sent: the console was busy.' })).toEqual(['bad', 'Not sent: the console was busy.']);
    expect(fns._ikClText({ status: 'refused', detail: 'Only the admin can do this.' })).toEqual(['bad', 'Not saved: Only the admin can do this.']);
  });
});

describe('L6-8 lookup poll schedule', () => {
  it('2.5 s while waiting (L8 2026-10-21: was 10 s; 10 s after a minute, consents-preload), 2.5 s once working, 5 s after a minute', async () => {
    let reply: any = { status: 'waiting' };
    const { fns, t } = env({ fresh: () => reply });
    const x = fns._ikLk('forms');
    Object.assign(x, { id: P(9), st: 'waiting', since: Date.now() });
    fns._ikLkPoll('forms');
    expect(t.delays.at(-1)).toBe(2500);
    reply = { status: 'working' };
    await t.cbs.at(-1)!();
    expect(t.delays.at(-1)).toBe(2500);
    x.workSince = Date.now() - 61000;
    await t.cbs.at(-1)!();
    expect(t.delays.at(-1)).toBe(5000);
  });
  it('a new lookup starts with a fresh blip count', async () => {
    const { fns } = env({ fresh: () => ({ status: 'waiting' }) });
    const x = fns._ikLk('forms');
    x.blips = 3;
    await fns._ikLkGo('forms', 1, '');
    expect(x.blips).toBe(0);
  });
  it('a network blip is retried silently 3 times, then shown', async () => {
    const { fns, t } = env({ fresh: () => { throw new Error('Load failed'); } });
    const x = fns._ikLk('forms');
    Object.assign(x, { id: P(9), st: 'waiting', since: Date.now() });
    fns._ikLkPoll('forms');
    for (let i = 0; i < 3; i++) { await t.cbs.at(-1)!(); expect(x.st).toBe('waiting'); }
    const n = t.cbs.length;
    await t.cbs.at(-1)!();
    expect(x.st).toBe('offline');
    expect(t.cbs.length).toBe(n);
  });
});
