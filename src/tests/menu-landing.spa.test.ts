// Operator 2026-10-16: a menu tap (bottom/desk nav, More sheet) opens the section's landing screen, never the
// sub-screen last seen. All menu taps go through go(); _navLanding resets view state only.
import { describe, it, expect } from 'vitest';
import { extractFn, loadIndexHtml } from './helpers/extract-fn';

const HTML = loadIndexHtml();

function world(page = 'home') {
  const env: any = {
    S: { user: { id: 'u1' }, page },
    LINK: { gid: null, rf: null, rfd: {}, ik: null },
    BUS: { tab: 'mycar', carsOpen: false },
    calls: [] as string[],
  };
  const fns = new Function('env', `
    const S = env.S, LINK = env.LINK, BUS = env.BUS, NAV = { stack: [] };
    let _arNameFilter = '';
    const history = { pushState() {}, back() { env.calls.push('back'); }, go() {} };
    const document = { querySelector: () => null };
    const localStorage = { setItem() {} };
    function closeModal() {} function _ikDraw() {} function _ikLoad() {} function _lkPaintGroups() {} function _nyRaw() { return {}; }
    function _ikLeave() { env.calls.push('ikLeave'); }
    function render() { env.calls.push('render:' + S.page); }
    ${['go', '_navLanding', '_navSnap', '_navSame', 'navPush', '_navPop'].map((n) => extractFn(HTML, n)).join('\n')}
    return { go, _navPop, NAV };`)(env);
  return { env, ...fns };
}
const intake = (o: any = {}) => ({ tab: 'consent', dates: [{ date: '2026-10-16' }], date: '2026-10-09', list: {}, key: 'fam1', det: { row: {} }, detErr: null,
  pick: null, hideText: null, csub: 'forms', doneOpen: true, saErr: {}, ans: { fam1: { a: 1 } }, busy: 0, ...o });

describe('menu tap opens the landing screen', () => {
  it('New youth & consent: a family left open -> the list, consent sub-tab back to Last, tab and answers kept', () => {
    const w = world('home');
    w.env.LINK.ik = intake();
    w.go('link-intake');
    const I = w.env.LINK.ik;
    expect(I.key).toBeNull();
    expect(I.det).toBeNull();
    expect(I.csub).toBe('last');
    expect(I.date).toBeNull(); // _ikLoad picks the first date again
    expect(I.tab).toBe('consent');
    expect(I.ans).toEqual({ fam1: { a: 1 } });
    expect(w.env.calls).toContain('ikLeave'); // a typed answer still goes
  });
  it('the same section tapped while on its sub-screen also lands', () => {
    const w = world('link-intake');
    w.env.LINK.ik = intake();
    w.go('link-intake');
    expect(w.env.LINK.ik.key).toBeNull();
    expect(w.NAV.stack).toHaveLength(0); // no new back step for the same page
  });
  it('Lifegroup report: an open group and new-report form close; the draft is kept', () => {
    const w = world('home');
    const draft = { mode: 'submit', date: '2026-10-14', dirty: true };
    Object.assign(w.env.LINK, { gid: 'g1', rf: draft, rfd: { 'g1|2026-10-14': draft } });
    w.go('link-groups');
    expect(w.env.LINK.gid).toBeNull();
    expect(w.env.LINK.rf).toBeNull();
    expect(w.env.LINK.rfd['g1|2026-10-14']).toBe(draft);
  });
  it('an edited report with changes stays open (it has no draft to come back to)', () => {
    const w = world('home');
    const ed = { mode: 'edit', date: '2026-10-07', dirty: true };
    Object.assign(w.env.LINK, { gid: 'g1', rf: ed });
    w.go('link-groups');
    expect(w.env.LINK.gid).toBe('g1');
    expect(w.env.LINK.rf).toBe(ed);
  });
  it('Bus: a sub-screen (route analysis) -> the first tab', () => {
    const w = world('home');
    Object.assign(w.env.BUS, { tab: 'analysis', carsOpen: true });
    w.go('bus');
    expect(w.env.BUS).toMatchObject({ tab: 'mycar', carsOpen: false });
  });
  it('Back after a menu tap still returns to the screen before it', () => {
    const w = world('home');
    w.env.LINK.ik = intake();
    w.go('link-intake');
    w._navPop();
    expect(w.env.S.page).toBe('home');
  });
});

describe('More sheet', () => {
  it('the row for the page you are on re-opens its landing screen; New person still only closes the sheet', () => {
    const src = extractFn(HTML, 'openMore');
    expect(src).toContain("here && m.id === 'new-youth' ? '' : m.open");
  });
});
