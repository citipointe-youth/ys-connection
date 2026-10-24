// Impeccable review 2026-10-24 (YS SPA UI fixes), run from the REAL page source (extract-and-evaluate).
import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml, extractFn } from './helpers/extract-fn';

const html = loadIndexHtml();

describe('#2 step-0 Complete is off while this year\'s New People flow is missing', () => {
  const NAMES = ['_lkStepBlock', '_lkPeopleFlowFound', '_lkConsentWait', '_lkCanComplete', '_lkTickable', '_lkHubOwned', '_lkFlowFree', '_lkFlowAct', '_lkCap', '_lkCapOff'];
  const PRELUDE = `
    var S = { user: { role: 'admin' }, settings: { ministryConfig: { elvanto: { peopleFlowPrefix: 'Brisbane - Youth - New People' } } } };
    var LINK = { flows: [], fSteps: [], fres: {}, status: null };
    function _ikModuleOn() { return false; }
    function _lkQGet() { return []; }
    function _lkDay(v) { return v; } function _cutoffWords() { return ''; } function _siteInstant() { return 0; } function _consentCutoff() { return ''; }
    function set(o) { if (o.role) S.user.role = o.role; if ('flows' in o) LINK.flows = o.flows; }
  `;
  const f = loadFns(NAMES, PRELUDE, [...NAMES, 'set']);
  const row = (o: any) => ({ rowId: 'r1', flowId: 'F1', flowName: 'Brisbane - Youth - New People 2026', stepId: 'S0', stepName: 'Step 0 - wait 7 days', stepOrder: 1,
    personId: 'p1', name: 'Ava Example', consent: 'ok', dnc: false, consentStep: false, ...o });
  it('found: step 0 can be ticked and completed', () => {
    const r = row({});
    f.set({ role: 'admin', flows: [r] });
    expect(f._lkStepBlock(r)).toBe('');
    expect(f._lkTickable(r)).toBe(true);
  });
  it('missing: step 0 is not tickable and the sheet says why (admin gets the fix, others "Ask the admin.")', () => {
    const r = row({ flowName: 'Follow up - Youth' });
    f.set({ role: 'admin', flows: [r] });
    expect(f._lkTickable(r)).toBe(false);
    expect(f._lkStepBlock(r)).toMatch(/^This year's New People flow wasn't found, so step 0 can't be completed\. In Admin > Youth Setup/);
    f.set({ role: 'director' });
    expect(f._lkStepBlock(r)).toMatch(/Ask the admin\.$/);
    f.set({ role: 'admin' });
  });
  it('missing: a later step is unchanged; flows not loaded yet blocks nothing', () => {
    const r = row({ flowName: 'Follow up - Youth', stepName: 'Call' });
    f.set({ flows: [r] });
    expect(f._lkTickable(r)).toBe(true);
    f.set({ flows: null });
    expect(f._lkStepBlock(row({ flowName: 'x' }))).toBe('');
  });
  it('the admin banner and the row gate use the one test', () => {
    expect(extractFn(html, '_lkFlowsHtml')).toContain('if (!_lkPeopleFlowFound()) top +=');
  });
});

describe('#3 sheets are dialogs: focus in, background inert, focus back', () => {
  const run = () => {
    const opener: any = { isConnected: true, focus: () => { log.push('opener'); } };
    const log: string[] = [];
    const title: any = { id: '' };
    const box: any = { attrs: {} as Record<string, string>, setAttribute(k: string, v: string) { this.attrs[k] = v; }, focus: () => log.push('box'), querySelector: () => title };
    const overlay: any = { addEventListener: () => {} };
    const app: any = { style: {}, inert: false };
    const root: any = { _onClose: null, innerHTML: '', querySelector: (s: string) => (s === '.mo-box' ? box : overlay) };
    const document: any = { activeElement: opener, body: {}, getElementById: (id: string) => (id === 'app' ? app : root) };
    const fns = new Function('document', 'window', 'setTimeout', 'clearTimeout',
      `${extractFn(html, 'modal')}\n${extractFn(html, 'closeModal')}\nfunction _moFitViewport() {}\nreturn { modal, closeModal };`)(document, {}, () => {}, () => {});
    return { fns, log, title, box, app, root, document };
  };
  it('modal() marks the box role=dialog aria-modal, labels it by its title, makes #app inert and focuses the box', () => {
    const t = run();
    t.fns.modal('<div class="mo-title">Pick a service</div>');
    expect(t.root.innerHTML).toContain('role="dialog" aria-modal="true" tabindex="-1"');
    expect(t.title.id).toBe('mo-title');
    expect(t.box.attrs['aria-labelledby']).toBe('mo-title');
    expect(t.app.inert).toBe(true);
    expect(t.log).toEqual(['box']);
  });
  it('closeModal() lifts inert and gives focus back to the opener; a replaced sheet keeps the first opener', () => {
    const t = run();
    t.fns.modal('<p>one</p>');
    t.document.activeElement = { isConnected: true, focus: () => t.log.push('inside') }; // focus moved into the first sheet
    t.fns.modal('<p>two</p>');
    t.fns.closeModal();
    expect(t.app.inert).toBe(false);
    expect(t.log.pop()).toBe('opener');
  });
  it('Esc still closes the open sheet', () => {
    expect(html).toMatch(/if \(e\.key === 'Escape'\) \{\s*const root = document\.getElementById\('modal-root'\);\s*if \(root && root\.innerHTML\) closeModal\(\);/);
  });
});

describe('#4 text colours reach 4.5:1', () => {
  const lum = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const tok = (n: string) => html.match(new RegExp(`--${n}:(#[0-9a-f]{6})`))![1];
  it('--ink-faint, --ink-mid and --danger on white, paper, paper-dark and chip', () => {
    for (const fg of ['ink-faint', 'ink-mid', 'danger']) for (const bg of ['#ffffff', tok('paper'), tok('paper-dark'), tok('chip')]) {
      if (fg === 'danger' && bg !== '#ffffff' && bg !== tok('paper')) continue; // red text sits on cards and the page
      expect(ratio(tok(fg), bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('#6 / #7 touch layout', () => {
  it('#7: Flows / Lifegroup filter chips are 44px tall on touch (a later rule than the 36px one)', () => {
    const i36 = html.indexOf('.lk-ff .fc{min-height:36px'), i44 = html.indexOf('@media(pointer:coarse){.lk-ff .fc{min-height:44px}}');
    expect(i36).toBeGreaterThan(0);
    expect(i44).toBeGreaterThan(i36);
  });
  it('#6: the Bus header row wraps so the settings gear stays on screen', () => {
    expect(html).toContain('<div class="ph bus-head" style="display:flex;');
    expect(html).toMatch(/\.bus-head\{flex-wrap:wrap\}\.bus-head \.bus-head-act\{flex-wrap:wrap;/);
  });
});

describe('#8 form fields have accessible names', () => {
  it('login: Username and Password labels point at their inputs', () => {
    expect(html).toContain('<label class="fl" for="lemail">Username</label><input class="fi" id="lemail"');
    expect(html).toContain('<label class="fl" for="lpw">Password</label><input class="fi" id="lpw"');
  });
  it('every .fl label straight before a field names it with for= (only template-text labels are left)', () => {
    const re = /<label class="fl"( for="([^"]+)")?>((?:(?!<\/label>)[\s\S])*?)<\/label>\s*<(?:input|select|textarea)\b([^>]*)>/g;
    const bad: string[] = [];
    for (let m; (m = re.exec(html));) {
      const id = /\sid="([^"]+)"/.exec(m[4]);
      if (!m[1] || !id || id[1] !== m[2]) { if (!/^\$\{/.test(m[3].trim())) bad.push(m[3].slice(0, 40)); }
    }
    expect(bad).toEqual([]);
  });
  it('the Home "Choose your name" pick and the Bus add box have names', () => {
    expect(html).toContain('id="home-leader-pick" aria-label="Choose your name"');
    expect(html).toContain('id="bus-q" aria-label="Add any student"');
  });
});
