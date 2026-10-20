// I7 (R2-G4): admin-only Flow steps tiles "New Students" / "Parent text", the "Send parent text" labels and the bulk cap of 50.
import { describe, it, expect, beforeEach } from 'vitest';
import { loadFns, loadIndexHtml, extractFn } from './helpers/extract-fn';

const NAMES = ['_lkFlowBucket', '_lkFlowShown', '_lkStepBlock', '_lkConsentWait', '_lkNotReceived', '_lkNotReceivedText', '_lkFlowFree', '_lkFlowAct', '_lkCap', '_lkCapOff', '_lkCanComplete',
  '_lkTickable', '_lkSelIds', '_lkFfGet', '_lkFfHtml', '_lkFlowVisible', '_lkFlowKind', '_lkFirstStep', '_lkTilesOn', '_lkTilesHtml', '_lkFlowPick',
  '_lkFlowGroups', '_lkFlowRowHtml', '_lkFlowsHtml', '_lkMemOff', '_lkCanRemove', '_lkFlowRow', '_lkBulkOpen', '_lkBulkSend', '_lkStepHtml', '_lkStepBtns',
  '_lkTextHref', '_lkSmsHref', '_lkFirstName'];
const PRELUDE = `
  var ROLE = 'admin', MODALS = [], TOASTS = [], PUSHED = [];
  var localStorage = { getItem: () => null, setItem: () => {} };
  var S = { get user() { return { role: ROLE }; }, page: 'link-flows' };
  var LINK = { flows: [], fSteps: [], fres: {}, fsel: {}, fOpen: {}, status: null, fFlow: '', ldrs: [] };
  const LK_FLOW_TYPES = ['completeStep', 'removeFromFlowStep'];
  const LK_FF = [['jg', 'Junior Guys', 'boy'], ['jf', 'Junior Girls', 'girl'], ['sg', 'Senior Guys', 'boy'], ['sf', 'Senior Girls', 'girl']];
  const document = { getElementById: () => null };
  function _lkQGet() { return []; }
  function _lkBoss() { return ROLE === 'admin' || ROLE === 'director'; }
  function _juniorMin() { return 7; }
  function _lkToday() { return '2026-10-17'; }
  function _lkFlowDue() { return ''; }
  function _lkStatusHtml(a) { return 'ST:' + a.status; } function _lkStatusTone() { return 'wait'; } function _lkLastSeen() { return ''; }
  function _busGradeChip() { return ''; } function dncChip() { return ''; } function dncBanner() { return ''; } function fmtPhone(p) { return p; }
  function _ikModuleOn() { return true; } function _lkRemoveHtml() { return ''; } function _lkNoteCount() { return ''; }
  function progBar(s) { return s; } function icS(k) { return '<i:' + k + '>'; }
  function getMyLeaderId() { return 'L1'; } function _lkIamPick() {} function _lkUuid() { return 'u'; }
  function _lkPush(it) { PUSHED.push(it); } function closeModal() {} function _lkFlowsDraw() {}
  function modal(h) { MODALS.push(h); } function toast(t) { TOASTS.push(t); }
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function set(o) { if ('role' in o) ROLE = o.role; MODALS.length = 0; TOASTS.length = 0; PUSHED.length = 0; }
  function out() { return { MODALS, TOASTS, PUSHED }; }
`;
const f = loadFns(NAMES, PRELUDE, [...NAMES, 'set', 'out', 'LINK']);
const L = f.LINK;
const PEOPLE = 'Brisbane - Youth - New People', PARENT = 'Brisbane - Youth - Parent Consent';
let n = 0;
const R = (o: any) => ({ rowId: o.rowId ?? 'r' + (++n), flowId: 'F1', flowName: PEOPLE, stepId: 'S1', stepName: 'Welcome', stepOrder: 2,
  personId: 'p' + n, name: 'Amy Test ' + n, due: null, grade: 8, gender: 'female', mobile: '0412345678', consent: 'ok', dnc: false, consentStep: false, ...o });
const PAR = (o: any = {}) => R({ flowId: 'F2', flowName: PARENT, stepId: 'P1', stepName: 'Text parent', stepOrder: 1, grade: null, gender: null, ...o });

function load(role = 'admin', parents = 3) {
  f.set({ role });
  Object.assign(L, { fres: {}, fsel: {}, fOpen: {}, fFlow: '', ff: undefined });
  L.flows = [R({ rowId: 'a' }), R({ rowId: 'b', stepId: 'S2', stepName: 'Follow up', stepOrder: 3 }),
    ...Array.from({ length: parents }, (_, i) => PAR({ rowId: 'pp' + i })), PAR({ rowId: 'p2nd', stepId: 'P2', stepName: 'Chase', stepOrder: 2 })];
  L.fSteps = [{ flowId: 'F1', flowName: PEOPLE, stepId: 'S1', stepName: 'Welcome', stepOrder: 2 }, { flowId: 'F1', flowName: PEOPLE, stepId: 'S2', stepName: 'Follow up', stepOrder: 3 },
    { flowId: 'F2', flowName: PARENT, stepId: 'P1', stepName: 'Text parent', stepOrder: 1 }, { flowId: 'F2', flowName: PARENT, stepId: 'P2', stepName: 'Chase', stepOrder: 2 }];
}
const strip = (h: string) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

describe('I7 Flow steps tiles', () => {
  beforeEach(() => load());
  it('admin with both flows: 2 tiles with first-step counts', () => {
    const h = f._lkFlowsHtml();
    expect(h).toContain('class="lk-tiles"');
    expect(strip(h)).toContain('New Students · 1');
    expect(strip(h)).toContain('Parent text · 3');
    expect(h).toContain(`onclick="_lkFlowPick('people')"`);
    expect(h).toContain(`onclick="_lkFlowPick('parent')"`);
  });
  it("_lkFlowPick('parent'): only the Parent Consent flow's first step, open, no Jr/Sr chips", () => {
    f._lkFlowPick('parent');
    const h = f._lkFlowsHtml();
    expect(h).toContain('aria-pressed="true" onclick="_lkFlowPick(\'parent\')"');
    expect(strip(h)).toContain('Text parent · 3');
    expect(h).not.toContain('Chase');
    expect(h).not.toContain('Welcome');
    expect(h).not.toContain('Junior Guys');
    expect(h).toMatch(/<div class="drop open" id="lks-F2-P1">/);
    // the user closed it: stays closed
    L.fOpen['lks-F2-P1'] = false;
    expect(f._lkFlowsHtml()).toMatch(/<div class="drop" id="lks-F2-P1">/);
    f._lkFlowPick('parent'); // tap again = all flows
    expect(L.fFlow).toBe('');
  });
  it("'people': only New People steps", () => {
    L.fsel = { a: true };
    f._lkFlowPick('people');
    expect(L.fsel).toEqual({});
    const h = f._lkFlowsHtml();
    expect(h).toContain('Welcome');
    expect(h).toContain('Follow up');
    expect(h).not.toContain('Text parent');
    expect(h).toContain('Junior Guys');
  });
  it('director, and admin with only one flow: no tiles, every flow listed', () => {
    load('director');
    expect(f._lkFlowsHtml()).not.toContain('lk-tiles');
    L.fFlow = 'parent'; // a stale pick does nothing without tiles
    expect(f._lkFlowsHtml()).toContain('Welcome');
    load('admin');
    L.flows = L.flows.filter((r: any) => r.flowName === PEOPLE);
    L.fSteps = L.fSteps.filter((r: any) => r.flowName === PEOPLE);
    expect(f._lkFlowsHtml()).not.toContain('lk-tiles');
  });
  it('a parent-row sheet: "Send parent text" and the can\'t-be-recalled line', () => {
    L.fs = { rowId: 'pp0', note: '', priv: false };
    expect(f._lkStepBtns()).toContain('Send parent text');
    expect(f._lkStepHtml()).toContain('It can&#39;t be recalled'.replace('&#39;', "'"));
    L.fs = { rowId: 'a', note: '', priv: false };
    expect(f._lkStepBtns()).toContain('Complete');
    expect(f._lkStepBtns()).not.toContain('Send parent text');
    expect(f._lkStepHtml()).not.toContain('recalled');
  });
  it('Service Visits line: shown for a number (including 0), hidden for null or missing', () => {
    const sheet = (extra: any) => { L.flows = [...L.flows.filter((r: any) => r.rowId !== 'sv'), { ...L.flows.find((r: any) => r.rowId === 'a'), rowId: 'sv', ...extra }]; L.fs = { rowId: 'sv', note: '', priv: false }; return f._lkStepHtml(); };
    expect(sheet({ serviceVisits: 2 })).toContain('<p class="lk-sub">Service Visits: 2</p>');
    expect(sheet({ serviceVisits: 0 })).toContain('<p class="lk-sub">Service Visits: 0</p>');
    expect(sheet({ serviceVisits: null })).not.toContain('Service Visits');
    expect(sheet({ serviceVisits: undefined })).not.toContain('Service Visits');
  });
  it('bulk in parent view: "Send parent text to 3 families?", Send 3, toast "3 parent texts queued"', () => {
    f._lkFlowPick('parent');
    L.fsel = { pp0: true, pp1: true, pp2: true };
    expect(f._lkFlowsHtml()).toContain('Send parent text (3)');
    f._lkBulkOpen();
    const m = f.out().MODALS[0];
    expect(m).toContain('Send parent text to 3 families?');
    expect(m).toContain("It can't be recalled.");
    expect(m).toContain('<i:check> Send 3');
    f._lkBulkSend();
    expect(f.out().PUSHED.length).toBe(3);
    expect(f.out().TOASTS).toEqual(['3 parent texts queued']);
  });
  it('51 ticked: no sheet, toast "Up to 50 at a time. Untick some first." (generic path too)', () => {
    load('admin', 51);
    f._lkFlowPick('parent');
    L.fsel = Object.fromEntries(Array.from({ length: 51 }, (_, i) => ['pp' + i, true]));
    f._lkBulkOpen();
    expect(f.out().MODALS).toEqual([]);
    expect(f.out().TOASTS).toEqual(['Up to 50 at a time. Untick some first.']);
    f._lkFlowPick('parent'); // off: the generic Complete path has the same cap
    L.fsel = Object.fromEntries(Array.from({ length: 51 }, (_, i) => ['pp' + i, true]));
    f._lkBulkOpen();
    expect(f.out().MODALS).toEqual([]);
  });
  it('onclicks hold no id or name', () => {
    const src = ['_lkTilesHtml', '_lkFlowPick', '_lkBulkOpen'].map((x) => extractFn(loadIndexHtml(), x)).join('\n');
    const handlers = [...src.matchAll(/onclick="([^"]*)"/g)].map((m) => m[1]);
    expect(handlers.length).toBeGreaterThan(0);
    for (const h of handlers) expect(h).not.toMatch(/rowId|personId|name/);
  });
});
