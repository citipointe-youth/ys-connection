// ID Checks Task 15: the Assign leaders grid, Archived leaders' history and the Full Reset line.
import { describe, it, expect, vi } from 'vitest';
import { loadIndexHtml, extractFn, loadFns } from './helpers/extract-fn';

const HTML = loadIndexHtml();
const ROLES = `const _ROLE_LABEL_DEFAULTS = { admin: 'Admin', oversight: 'Oversight' }; function _roleLabel(r) { return _ROLE_LABEL_DEFAULTS[r] || r; }`;
const BASE = `${ROLES} function _gradeWord() { return 'Grade'; } function fmtDay(v) { return 'D:' + v; } function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\\x27/g, '&#39;'); }`;

const DATA = {
  rows: [
    { id: 'l1', name: 'Sample Dummyton', gender: 'female', grades: [8, 9] },
    { id: 'l2', name: 'Codeman Sample', gender: 'male', grades: [] },
  ],
  columns: [{ id: 'u1', name: 'Oversight One', role: 'oversight' }, { id: 'u2', name: 'The Admin', role: 'admin' }],
  ticks: [{ leaderId: 'l1', userId: 'u1' }],
};

describe('grid HTML', () => {
  const { _icGridHtml } = loadFns(['_icGridHtml', '_icTickKeys', '_icRowMeta', '_icJs'], BASE);
  it('has one column per account and a checked box only for a tick', () => {
    const h = _icGridHtml(DATA);
    expect((h.match(/class="ic-col"/g) || []).length).toBe(2);
    expect((h.match(/class="ic-tk"/g) || []).length).toBe(4);
    expect((h.match(/ checked /g) || []).length).toBe(1);
    expect(h).toMatch(/data-u="u1" data-l="l1"[^>]*checked/);
    expect(h).toContain('title="Oversight One"');
  });
  it('shows grades as "Gr 8, 9", All and Clear per column, a sticky first column and scrolls inside its card', () => {
    const h = _icGridHtml(DATA);
    expect(h).toContain('Girls · Gr 8, 9');
    expect(h).toContain('Guys');
    expect((h.match(/>All</g) || []).length).toBe(2);
    expect(h).toContain('aria-label="Tick all for Oversight"');
    expect((h.match(/>Clear</g) || []).length).toBe(2);
    expect(h).toContain('position:sticky;left:0');
    const page = extractFn(HTML, '_icGridPage');
    expect(page).toContain('overflow-x:auto');
    expect(page).toContain('overflow:hidden');
  });
  it('escapes names and passes only ids to onchange', () => {
    const h = _icGridHtml({ ...DATA, rows: [{ id: 'l1', name: '<b>x</b>', gender: null, grades: [] }] });
    expect(h).not.toContain('<b>x</b>');
    expect(h).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(h).toContain('onchange="_icTick(&quot;u1&quot;,&quot;l1&quot;,this.checked)"');
    expect(h).toContain('onclick="_icTickCol(&quot;u1&quot;,true)"');
  });
  it('column heads are the first name only, flat, thin, with no role line', () => {
    const h = _icGridHtml({ ...DATA, columns: [{ id: 'u2', name: 'Admin', role: 'admin' }, { id: 'u1', name: 'Oversight Two', role: 'oversight' }] });
    expect(h).toMatch(/title="Oversight Two"[^>]*>Oversight</);
    expect(h).not.toContain('Two<');
    expect(h).not.toContain('<span class="lk-d" style="display:block">');
    expect(h).not.toContain('writing-mode');
    expect(h).toContain('width:60px;min-width:60px');
    expect(h).toContain('min-height:44px;min-width:36px');
  });
  it('two logins with the same first name get a last initial, others stay plain', () => {
    const h = _icGridHtml({ ...DATA, columns: [{ id: 'a', name: 'Sam Kelly', role: 'oversight' }, { id: 'b', name: 'sam Brown Lee', role: 'oversight' }, { id: 'c', name: 'Tom Ree', role: 'admin' }] });
    expect(h).toMatch(/title="Sam Kelly"[^>]*>Sam K</);
    expect(h).toMatch(/title="sam Brown Lee"[^>]*>sam L</);
    expect(h).toMatch(/title="Tom Ree"[^>]*>Tom</);
  });
  it('the page shows a swipe hint and an edge shadow only when more than two columns', () => {
    const page = (cols: number) => loadFns(['_icGridPage', '_icGridHtml', '_icTickKeys', '_icRowMeta', '_icJs', '_icArchHtml'], `${BASE}
      const _ICG = { data: ${JSON.stringify({ ...DATA, columns: [...Array(cols)].map((_, i) => ({ id: 'u' + i, name: 'N' + i, role: 'oversight' })) })}, arch: [] };`)._icGridPage();
    expect(page(2)).not.toContain('Swipe the table');
    expect(page(3)).toContain('Swipe the table sideways');
    expect(page(3)).toContain('no-repeat local');
    expect(page(2)).toContain('<div class="sh">Assign leaders</div>');
  });
  it('an empty roster says so', () => { expect(_icGridHtml({ rows: [], columns: DATA.columns, ticks: [] })).toContain('No active leaders yet.'); });
});

describe('a tick saves at once', () => {
  const load = (put: (p: string, b: any) => Promise<any>) => {
    const boxes = [['u1', 'l1'], ['u1', 'l2'], ['u2', 'l1'], ['u2', 'l2']].map(([u, l]) => ({ dataset: { u, l }, checked: u === 'u1' && l === 'l1' }));
    const toast = vi.fn();
    Object.assign(globalThis, { __put: put, __toast: toast, __boxes: boxes });
    const f = loadFns(['_icTick', '_icTickCol', '_icTickKeys', '_icSetTicks', '_icGridSync'], `
      const _ICG = { data: ${JSON.stringify(DATA)}, arch: [], pend: null, busy: false };
      const API = { put: globalThis.__put };
      const toast = globalThis.__toast;
      const document = { querySelectorAll: () => globalThis.__boxes };`, ['_icTick', '_icTickCol', '_icGridSync']);
    return { f, boxes, toast };
  };
  it('PUTs the one tick and keeps the box', async () => {
    const put = vi.fn().mockResolvedValue({});
    const { f, boxes, toast } = load(put);
    await f._icTick('u2', 'l1', true);
    expect(put).toHaveBeenCalledWith('/id-checks/access', { userId: 'u2', leaderIds: ['l1'], on: true });
    expect(boxes.find(b => b.dataset.u === 'u2' && b.dataset.l === 'l1')!.checked).toBe(true);
    expect(toast).not.toHaveBeenCalled();
  });
  it('a failed PUT puts the box back and toasts', async () => {
    const put = vi.fn().mockRejectedValue(new Error('x'));
    const { f, boxes, toast } = load(put);
    await f._icTick('u2', 'l1', true);
    expect(boxes.every(b => b.checked === (b.dataset.u === 'u1' && b.dataset.l === 'l1'))).toBe(true);
    expect(toast).toHaveBeenCalledWith('Could not save. Try again.');
  });
  it('a failed untick of an existing tick ticks it again', async () => {
    const { f, boxes } = load(vi.fn().mockRejectedValue(new Error('x')));
    await f._icTick('u1', 'l1', false);
    expect(boxes.find(b => b.dataset.u === 'u1' && b.dataset.l === 'l1')!.checked).toBe(true);
  });
  it('quick tick then untick: the PUTs go one at a time in click order, so the last click wins', async () => {
    const calls: any[] = [];
    const put = vi.fn((_p: string, b: any) => new Promise((res) => calls.push({ b, res })));
    const { f } = load(put);
    const a = f._icTick('u2', 'l1', true);
    const b = f._icTick('u2', 'l1', false);
    await Promise.resolve(); await Promise.resolve();
    expect(calls.map((c) => c.b.on)).toEqual([true]); // the untick waits for the tick
    calls[0].res({});
    await a;
    await Promise.resolve(); await Promise.resolve();
    expect(calls.map((c) => c.b.on)).toEqual([true, false]);
    calls[1].res({});
    await b;
  });
  it('a failed PUT does not block the next one', async () => {
    let n = 0;
    const put = vi.fn(() => (n++ === 0 ? Promise.reject(new Error('x')) : Promise.resolve({})));
    const { f } = load(put);
    await f._icTick('u2', 'l1', true);
    await f._icTick('u2', 'l2', true);
    expect(put).toHaveBeenCalledTimes(2);
  });
  it('Tick all sends only the ones not yet ticked; Clear sends only the ticked', async () => {
    const put = vi.fn().mockResolvedValue({});
    const { f } = load(put);
    await f._icTickCol('u1', true);
    expect(put).toHaveBeenLastCalledWith('/id-checks/access', { userId: 'u1', leaderIds: ['l2'], on: true });
    await f._icTickCol('u1', false);
    expect(put).toHaveBeenLastCalledWith('/id-checks/access', { userId: 'u1', leaderIds: ['l1', 'l2'], on: false });
  });
});

describe('Archived leaders history', () => {
  const ARCH = [{ name: 'Sample Dummyton', count: 3, lastOn: '2026-10-16' }, { name: 'One Entry', count: 1, lastOn: '2026-09-01' }];
  const { _icArchHtml } = loadFns(['_icArchHtml'], BASE);
  it('is hidden when empty', () => { expect(_icArchHtml([])).toBe(''); expect(_icArchHtml(null)).toBe(''); });
  it('lists name, entry count, last date and the two actions', () => {
    const h = _icArchHtml(ARCH);
    expect(h).toContain("Archived leaders' history");
    expect(h).toContain('3 entries');
    expect(h).toContain('1 entry');
    expect(h).toContain('Last D:2026-10-16');
    expect(h).toContain('Re-attach');
    expect(h).toContain('Delete forever');
  });
  it('never carries note text: no field or text box, and a stray content key is not printed', () => {
    const h = _icArchHtml([{ name: 'Sample Dummyton', count: 2, lastOn: '2026-10-16', content: { text: 'PRIVATE NOTE' }, text: 'PRIVATE NOTE' }]);
    expect(h).not.toContain('PRIVATE NOTE');
    expect(h).not.toMatch(/<(input|textarea)/);
  });
  it("a group named O'Brien Sample is escaped and its onclick holds only an index", () => {
    const h = _icArchHtml([{ name: "O'Brien Sample", count: 2, lastOn: '2026-10-16' }, { name: '<i>x</i>', count: 1, lastOn: '2026-10-16' }]);
    expect(h).toContain('O&#39;Brien Sample');
    expect(h).not.toContain("O'Brien");
    expect(h).not.toContain('<i>x</i>');
    const clicks = [...h.matchAll(/onclick="([^"]*)"/g)].map(m => m[1] as string);
    expect(clicks).toEqual(['_icArchAttach(0)', '_icArchDel(0)', '_icArchAttach(1)', '_icArchDel(1)']);
    for (const c of clicks) expect(() => new Function(c.replace(/^/, 'var _icArchAttach, _icArchDel;\n'))).not.toThrow();
  });

  const loadAct = (post: any) => {
    const modal = vi.fn(), toast = vi.fn();
    const els: Record<string, any> = {};
    Object.assign(globalThis, { __modal: modal, __toast: toast, __post: post, __els: els });
    const f = loadFns(['_icArchDel', '_icArchDelGo', '_icArchAttach', '_icArchPick', '_icArchAttachGo', '_icArchReload', '_icArchPaint', '_icArchHtml'], `${BASE}
      const _ICG = { data: ${JSON.stringify(DATA)}, arch: ${JSON.stringify(ARCH)}, pend: null, busy: false };
      const API = { post: globalThis.__post }; const modal = globalThis.__modal; const toast = globalThis.__toast; const closeModal = () => {};
      async function _icGet() { return []; }
      const document = { getElementById: (id) => globalThis.__els[id] || null };`, ['_icArchDel', '_icArchDelGo', '_icArchAttach', '_icArchPick', '_icArchAttachGo']);
    return { f, modal, toast, els };
  };
  it('Delete forever opens the exact confirm, then posts the name', async () => {
    const post = vi.fn().mockResolvedValue({ deleted: 3 });
    const { f, modal, toast } = loadAct(post);
    f._icArchDel(0);
    expect(modal.mock.calls[0]![0]).toContain('Delete all 3 entries for Sample Dummyton for good? This cannot be undone.');
    expect(post).not.toHaveBeenCalled();
    await f._icArchDelGo();
    expect(post).toHaveBeenCalledWith('/id-checks/archived/delete', { name: 'Sample Dummyton' });
    expect(toast).toHaveBeenCalledWith('Deleted 3 entries');
  });
  it('Re-attach offers the active leaders, names who can read, then posts name and leader id', async () => {
    const post = vi.fn().mockResolvedValue({ moved: 3 });
    const { f, modal, els } = loadAct(post);
    f._icArchAttach(0);
    const html = modal.mock.calls[0]![0] as string;
    expect(html).toContain('<option value="l1">Sample Dummyton</option>');
    expect(html).toContain('<option value="l2">Codeman Sample</option>');
    els['ic-att'] = { value: 'l2', options: [{}, {}, { textContent: 'Codeman Sample' }], selectedIndex: 2 };
    els['ic-att-msg'] = {}; els['ic-att-go'] = { disabled: true };
    f._icArchPick(els['ic-att']);
    expect(els['ic-att-msg'].textContent).toBe('Everyone ticked for Codeman Sample will be able to read these notes.');
    expect(els['ic-att-go'].disabled).toBe(false);
    await f._icArchAttachGo();
    expect(post).toHaveBeenCalledWith('/id-checks/archived/attach', { name: 'Sample Dummyton', leaderId: 'l2' });
  });
  it('a failed delete toasts and keeps the list', async () => {
    const { f, toast } = loadAct(vi.fn().mockRejectedValue(new Error('x')));
    f._icArchDel(1);
    await f._icArchDelGo();
    expect(toast).toHaveBeenCalledWith('Could not delete. Try again.');
  });
});

describe('the page', () => {
  const src = HTML.slice(HTML.lastIndexOf('async function renderIdCheckGrid'));
  const render = (role: string, get: (p: string) => Promise<any>) => {
    const go = vi.fn(), setApp = vi.fn();
    const f = new Function('S', 'go', 'setApp', '_icGet', '_here', '_still', 'shell', 'progBar', 'icS', 'esc', '_ICG', '_icGridPage', `${extractFn(src, 'renderIdCheckGrid')}\nreturn renderIdCheckGrid;`)(
      { user: { role } }, go, setApp, get, () => ({}), () => true, (x: string) => x, () => 'LOADING', () => '', (s: string) => s, { data: null, arch: [] }, () => 'PAGE');
    return { f, go, setApp };
  };
  it('is admin only: any other login goes back to the list and makes no request', async () => {
    const get = vi.fn();
    const { f, go, setApp } = render('oversight', get);
    await f();
    expect(go).toHaveBeenCalledWith('idchecks');
    expect(get).not.toHaveBeenCalled();
    expect(setApp).not.toHaveBeenCalled();
  });
  it('an admin loads access and archived fresh and paints the page', async () => {
    const get = vi.fn().mockResolvedValue([]);
    const { f, setApp } = render('admin', get);
    await f();
    expect(get.mock.calls.map(c => c[0]).sort()).toEqual(['/id-checks/access', '/id-checks/archived']);
    expect(setApp).toHaveBeenLastCalledWith('PAGE');
  });
  it('a failed load says so with a way to retry', async () => {
    const { f, setApp } = render('admin', vi.fn().mockRejectedValue(new Error('x')));
    await f();
    expect(setApp.mock.calls.at(-1)![0]).toContain('Could not load. Try again.');
  });
  it('the block sits above its marker and renderIdCheckGrid is defined once', () => {
    expect(HTML.indexOf('async function renderIdCheckGrid')).toBeLessThan(HTML.indexOf('/*IC-GRID*/'));
    expect(HTML.match(/function renderIdCheckGrid\b/g)).toHaveLength(1);
    expect(HTML.indexOf('function _icTick(')).toBeLessThan(HTML.indexOf('/*IC-GRID*/'));
  });
});

describe('Full Reset line', () => {
  const KEPT = "ID-check history is kept. Leaders are deleted, so it moves to Archived leaders' history in More, ID Checks.";
  const load = (idChecks: 'on' | 'off') => loadFns(['_wizStepCard', 'renderNewYearWizard'],
    `const S = { settings: { ministryConfig: { modules: { connectionAudit: false, idChecks: '${idChecks}' } } }, user: { role: 'admin' } };
     let _wiz = ${JSON.stringify({ step1Done: true, prayersExportDone: true, step2Done: true })};
     function _prayersOn() { return true; } function _busOn() { return false; }
     function esc(s) { return String(s); } function icS() { return ''; }`, ['renderNewYearWizard']);
  it('with the module on the card text carries the kept line', () => {
    expect(load('on').renderNewYearWizard()).toContain(KEPT);
  });
  it('with the module off there is no line', () => {
    expect(load('off').renderNewYearWizard()).not.toContain('ID-check history');
  });
  it('the Full Reset onclick keeps the plain reset text, no apostrophe, and parses', () => {
    const h = load('on').renderNewYearWizard();
    const m = h.match(/<button class="btn btn-danger btn-full" onclick="(confirmType[^"]*)">Full Reset<\/button>/);
    expect(m).toBeTruthy();
    expect(m![1]).not.toContain('Archived leaders');
    expect(m![1]).toContain('Permanently deletes all students');
    expect(() => new Function('confirmType', 'wizStep3Confirmed', m![1])).not.toThrow();
  });
});

describe('source hygiene', () => {
  it('no console calls and no note text in the grid or export blocks', () => {
    const a = HTML.indexOf('const _ICG ='), b = HTML.indexOf('/*IC-EXPORT*/');
    expect(a).toBeGreaterThan(0);
    expect(HTML.slice(a, b)).not.toMatch(/console\./);
  });
});
