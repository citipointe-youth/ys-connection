// Review 2026-10-15b (S3/S6): back restores intake tabs, dates and consent sub-tabs; back with a sheet open closes the sheet;
// Save answers leaves the form only when the answer was saved.
import { describe, it, expect } from 'vitest';
import { extractFn, loadFns, loadIndexHtml } from './helpers/extract-fn';

const HTML = loadIndexHtml();
const loadSrc = (n: string) => extractFn(HTML, n);

function navWorld() {
  const calls: string[] = [];
  const env: any = {
    S: { user: { id: 'u1' }, page: 'link-intake' },
    LINK: { ik: { tab: 'intake', date: '2026-10-09', csub: 'last', key: null } },
    modalOpen: false,
    histBack: 0,
    pushed: 0,
  };
  const prelude = `
    const S = env.S, LINK = env.LINK, NAV = { stack: [] };
    const history = { pushState() { env.pushed++; }, back() { env.histBack++; }, go() {} };
    const document = { querySelector: () => (env.modalOpen ? {} : null) };
    const localStorage = { setItem() {} };
    function closeModal() { env.modalOpen = false; env.calls.push('closeModal'); }
    function _ikLeave() {} function _ikDraw() { env.calls.push('draw'); } function _ikLoad() { env.calls.push('load'); }
    function render() { env.calls.push('render'); } function _lkPaintGroups() {}
  `;
  env.calls = calls;
  const fns = new Function('env', `${prelude}
    ${['_navSnap', '_navSame', 'navPush', '_navPop'].map((n) => loadSrc(n)).join('\n')}
    return { navPush, _navPop, NAV };`);
  return { env, ...fns(env) };
}

describe('S3 back: intake tab, date and consent sub-tab come back', () => {
  it('Consents tab then back -> Intakes tab with its date', () => {
    const w = navWorld();
    w.navPush(); // what _ikTab does before switching
    Object.assign(w.env.LINK.ik, { tab: 'consent', date: '2026-10-16', csub: 'forms' });
    w._navPop();
    expect(w.env.LINK.ik.tab).toBe('intake');
    expect(w.env.LINK.ik.date).toBe('2026-10-09');
    expect(w.env.LINK.ik.csub).toBe('last');
    expect(w.env.calls).toContain('load');
  });
  it('another date then back -> the first date, same tab', () => {
    const w = navWorld();
    w.navPush();
    w.env.LINK.ik.date = '2026-10-02';
    w._navPop();
    expect(w.env.LINK.ik.date).toBe('2026-10-09');
    expect(w.env.LINK.ik.tab).toBe('intake');
  });
});

describe('S3 back with a sheet open', () => {
  it('closes the sheet, keeps the screen and the stack, puts the browser entry back', () => {
    const w = navWorld();
    w.navPush();
    w.env.LINK.ik.date = '2026-10-02';
    w.env.modalOpen = true;
    const pushedBefore = w.env.pushed;
    w._navPop();
    expect(w.env.calls).toEqual(['closeModal']);
    expect(w.NAV.stack).toHaveLength(1);
    expect(w.env.LINK.ik.date).toBe('2026-10-02');
    expect(w.env.pushed).toBe(pushedBefore + 1);
  });
});

describe('S6 Save answers', () => {
  const mk = (ok: boolean) => {
    const env: any = { backs: 0, toasts: [] as string[] };
    const I = { det: { row: { key: 'k1' } }, busy: false, resend: {} };
    env.I = I; env.ok = ok; (globalThis as any).__nav = env;
    const { _ikAnswersSave } = loadFns(['_ikAnswersSave'], `
      const env = globalThis.__nav; const I0 = env.I;
      function _ik() { return I0; }
      async function _ikAnswerSend() { return env.ok; }
      function toast(m) { env.toasts.push(m); }
      function navBack() { env.backs++; }
      function _here() { return {}; } function _still() { return true; } // C-B1: same screen, so a saved answer goes back`);
    return { env, _ikAnswersSave };
  };
  it('a refused answer (server message, nothing queued for resend) stays on the form and never says saved', async () => {
    const t = mk(false);
    await t._ikAnswersSave();
    expect(t.env.backs).toBe(0);
    expect(t.env.toasts).not.toContain('Answers noted');
  });
  it('a saved answer says so and goes back', async () => {
    const t = mk(true);
    await t._ikAnswersSave();
    expect(t.env.backs).toBe(1);
    expect(t.env.toasts).toContain('Answers noted');
  });
});

describe('consent hub T9 fix I1: back from a family page forgets the hub family', () => {
  it('Back clears hubFam/hubKid with the key, so a later row opened another way shows no stale strip', () => {
    const w = navWorld();
    w.navPush(); // what _hubOpen does on the landing
    Object.assign(w.env.LINK.ik, { key: 'k1', hubFam: { title: 'Ava Sample', kids: [{}, {}] }, hubKid: 1 });
    w._navPop();
    expect(w.env.LINK.ik.key).toBeNull();
    expect(w.env.LINK.ik.hubFam).toBeNull();
    expect(w.env.LINK.ik.hubKid).toBe(0);
  });
  it('_ikOpen (an old list row, or step 0 Consents via _ikFind) clears the hub family', () => {
    const I: any = { list: { rows: [{ key: 'k2' }] }, hubFam: { title: 'Ava Sample', kids: [{}] }, hubKid: 1 };
    (globalThis as any).__hubI = I;
    const { _ikOpen } = loadFns(['_ikOpen'], `const _ik = () => globalThis.__hubI; const navPush = () => {}; const _ikDraw = () => {};
      const _ikLoadRow = () => Promise.resolve(); const _ikSchedule = () => {}; const window = { scrollTo() {} };`);
    _ikOpen(0);
    expect(I.key).toBe('k2');
    expect(I.hubFam).toBeNull();
    expect(I.hubKid).toBe(0);
  });
});
