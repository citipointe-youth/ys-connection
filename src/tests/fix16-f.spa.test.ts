// Fix round 16 Oct 2026, lane F (Flows): F-05, F-20(b), F-21, F-22, F-23, F-37 (YS render), F-48(f).
// Run from the REAL page source (extract-and-evaluate).
import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml, extractFn } from './helpers/extract-fn';

const SRC = loadIndexHtml();
const LK_FF_SRC = SRC.match(/^const LK_FF = .*;/m)![0];
const NAMES = ['_lkFirstName', '_lkTextHref', '_lkSmsHref', '_lkFfHtml', '_lkFlowRowHtml', '_lkFlowsHtml', '_lkFlowGroups', '_lkFlowVisible', '_lkFlowKind', '_lkFirstStep', '_lkTilesOn', '_lkTilesHtml', '_lkFlowPick',
  '_lkFlowAct', '_lkFlowFree', '_lkTickable', '_lkCanComplete', '_lkStepBlock', '_lkSelIds', '_lkRemoveHtml', '_lkLoadFlows', '_lkFlowShown',
  '_lkFlowBucket', '_lkFfGet'];
const PRELUDE = `
  ${LK_FF_SRC}
  var ROLE = 'admin', QUEUE = [], FRESH = null, CALLS = [];
  var localStorage = { getItem: () => null, setItem: () => {} };
  var S = { page: 'link-flows', get user() { return { role: ROLE }; } };
  var LINK = { flows: [], fSteps: [], fres: {}, fsel: {}, status: null };
  var API = { fresh: (p) => { CALLS.push(p); return FRESH(p); } };
  var document = { visibilityState: 'visible' };
  const LK_FLOW_TYPES = ['completeStep', 'removeFromFlowStep'];
  function _lkQGet() { return QUEUE.slice(); }
  function _lkBoss() { return ROLE === 'admin' || ROLE === 'director'; }
  function _lkCapOff() { return false; }
  function _juniorMin() { return 7; }
  function _lkToday() { return '2026-10-16'; }
  function _lkFlowDue() { return ''; }
  function _lkStatusHtml(a) { return 'ST:' + a.status; }
  function _lkStatusTone() { return 'wait'; }
  function _lkLastSeen() { return ''; }
  function progBar() { return ''; }
  function dncChip() { return ''; }
  function _busGradeChip() { return ''; }
  function icS(k) { return '<i:' + k + '>'; }
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function set(o) { if ('role' in o) ROLE = o.role; if ('fresh' in o) FRESH = o.fresh; if ('calls' in o) CALLS = o.calls; }
  function calls() { return CALLS; }
`;
const f = loadFns(NAMES, PRELUDE, [...NAMES, 'set', 'calls', 'LINK']);
const L = f.LINK;
const R = (o: any) => ({ rowId: 'r1', flowId: 'F1', flowName: 'New People', stepId: 'S1', stepName: 'Step 0', stepOrder: 0, personId: 'p1',
  name: 'LEstrange, Thomas', due: null, grade: 9, gender: 'male', mobile: '0455100000', consent: 'ok', dnc: false, consentStep: false, openAction: null, ...o });
const reset = () => { f.set({ role: 'admin', calls: [] }); Object.assign(L, { flows: [], fSteps: [], fres: {}, fsel: {}, ff: undefined, flowGone: undefined, fProg: null }); };

describe('F-23 the flow Text link greets by first name ("Last, First" names)', () => {
  it('takes the part after the comma', () => {
    expect(f._lkFirstName('LEstrange, Thomas')).toBe('Thomas');
    expect(f._lkFirstName('Sam Smith')).toBe('Sam');
    expect(f._lkFirstName('')).toBe('');
  });
  it('the sms body says "Hey Thomas", not the surname', () => {
    expect(decodeURIComponent(f._lkTextHref(R({})))).toContain('body=Hey Thomas ');
  });
});

describe('F-21 filter pills say Jr/Sr Guys/Girls (not colour only)', () => {
  it('four distinct labels', () => {
    const h = f._lkFfHtml([]);
    const labels = [...h.matchAll(/>([^<]+)<\/button>/g)].map((m) => m[1]);
    expect(labels).toEqual(['Jr Guys', 'Jr Girls', 'Sr Guys', 'Sr Girls']);
  });
});

describe('F-22 Remove sheet note hint is plain', () => {
  it('no console jargon', () => {
    L.fs = { rmNote: '' };
    const h = f._lkRemoveHtml(R({}));
    expect(h).toContain('Goes on their Elvanto notes. Leave empty to just remove.');
    expect(h).not.toContain('console');
  });
});

describe('F-20(b) flow tick and select-all are 44 px targets', () => {
  it('the row tick sits in a 44x44 label that stops the row opening', () => {
    reset();
    const h = f._lkFlowRowHtml(R({}), '2026-10-16', true);
    expect(h).toMatch(/<label[^>]*min-width:44px;min-height:44px[^>]*onclick="event.stopPropagation\(\)"><input type="checkbox" class="lk-tick"/);
  });
  it('select-all is at least 44 px tall', () => {
    reset();
    L.flows = [R({ rowId: 'a' }), R({ rowId: 'b', name: 'Other, Ann' })];
    L.fOpen = {};
    expect(f._lkFlowsHtml()).toMatch(/<label class="lk-chk lk-selall" style="[^"]*min-height:44px/);
  });
});

describe('F-48(f) the "same name" chip does not wrap', () => {
  it('nowrap', () => {
    reset();
    const h = f._lkFlowRowHtml(R({ sameName: true }), '2026-10-16', false);
    expect(h).toMatch(/white-space:nowrap[^>]*>same name as another row/);
  });
});

describe('F-05 a sent Remove/Complete shows done, then hides until the console stops listing it', () => {
  const pending = { id: 'a1', type: 'removeFromFlowStep', status: 'claimed', reason: null };
  it('asks about an action that left the open list; sent = done line now, hidden next load, cleared when unlisted', async () => {
    reset();
    L.flows = [R({ openAction: pending })];
    let acts: any[] = [{ id: 'a1', type: 'removeFromFlowStep', status: 'sent', reason: null, resultAt: '2026-10-16T07:49:00Z' }];
    let rows = [R({ openAction: null })];
    f.set({ fresh: (p: string) => Promise.resolve(p.startsWith('/link/actions') ? acts : { rows, steps: [] }) });
    expect(await f._lkLoadFlows(true)).toBe(true);
    expect(f.calls()).toContain('/link/actions?ids=a1');
    expect(L.fres.r1.status).toBe('sent');
    expect(L.flows.map((r: any) => r.rowId)).toEqual(['r1']); // still shown, with its done line
    expect(f._lkFlowRowHtml(L.flows[0], '2026-10-16', true)).toContain('ST:sent');
    await f._lkLoadFlows(true); // the console has not pushed yet: the row is hidden
    expect(L.flows).toEqual([]);
    rows = [];
    await f._lkLoadFlows(true); // the push no longer lists it: the map clears
    expect(L.flowGone).toEqual({});
    acts = [];
  });
  it('a still-open row is not asked about, and a refused answer keeps the row', async () => {
    reset();
    L.flows = [R({ openAction: pending })];
    f.set({ fresh: (p: string) => Promise.resolve(p.startsWith('/link/actions') ? [{ id: 'a1', type: 'removeFromFlowStep', status: 'refused', reason: 'step-moved' }]
      : { rows: [R({ openAction: pending })], steps: [] }) });
    await f._lkLoadFlows(true);
    expect(f.calls().some((p: string) => p.startsWith('/link/actions'))).toBe(false);
    L.flows = [R({ openAction: pending })];
    f.set({ fresh: (p: string) => Promise.resolve(p.startsWith('/link/actions') ? [{ id: 'a1', type: 'removeFromFlowStep', status: 'refused', reason: 'step-moved' }]
      : { rows: [R({ openAction: null })], steps: [] }) });
    await f._lkLoadFlows(true);
    expect(L.fres.r1.status).toBe('refused');
    expect(L.flows).toHaveLength(1);
  });
});

describe('F-37 Remove landed but the note did not (rev 7 note:"failed")', () => {
  it('the row says the note was not saved; hidden when the field is missing', () => {
    reset();
    L.fres = { r1: { id: 'a1', type: 'removeFromFlowStep', status: 'sent', reason: null, note: 'failed' } };
    expect(f._lkFlowRowHtml(R({}), '2026-10-16', true)).toContain('note not saved');
    L.fres = { r1: { id: 'a1', type: 'removeFromFlowStep', status: 'sent', reason: null } };
    expect(f._lkFlowRowHtml(R({}), '2026-10-16', true)).not.toContain('note not saved');
  });
});

it('extract sanity', () => { expect(extractFn(SRC, '_lkLoadFlows')).toContain('/link/flows'); });
