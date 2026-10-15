// Run 2026-10-15 lane B: DO NOT CONTACT display, flow-step filters, bulk Complete exclusion, Remove from step and the
// console-offline banner, run from the REAL page source (extract-and-evaluate).
import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml, extractFn } from './helpers/extract-fn';

const NAMES = ['_lkFlowBucket', '_lkFlowShown', '_lkStepBlock', '_lkFlowFree', '_lkFlowAct', '_lkCap', '_lkCapOff', '_lkCanComplete',
  '_lkTickable', '_lkSelIds', '_lkTextHref', '_lkSmsHref', '_lkFirstName', '_lkOfflineSince', 'dncChip', 'dncBanner', '_lkFfGet',
  '_lkFfHtml', '_lkFlowVisible', '_lkFlowGroups', '_lkFlowRowHtml', '_lkFlowsHtml', '_lkStatusText', '_lkPracticeLine', '_lkFlowTypes',
  '_lkMemOff', '_lkCanRemove'];
const PRELUDE = `
  var STORE = {}, THROW = false, ROLE = 'admin', QUEUE = [];
  var localStorage = { getItem: (k) => { if (THROW) throw new Error('blocked'); return STORE[k] == null ? null : STORE[k]; },
    setItem: (k, v) => { if (THROW) throw new Error('blocked'); STORE[k] = String(v); } };
  var S = { get user() { return { role: ROLE }; } };
  var LINK = { flows: [], fSteps: [], fres: {}, fsel: {}, status: null };
  const LK_FLOW_TYPES = ['completeStep', 'removeFromFlowStep'];
  const LK_FF = [['jg', 'Junior Guys', 'boy'], ['jf', 'Junior Girls', 'girl'], ['sg', 'Senior Guys', 'boy'], ['sf', 'Senior Girls', 'girl']];
  const LK_OFFLINE_MS = 15 * 60000;
  function _lkQGet() { return QUEUE.slice(); }
  function _lkBoss() { return ROLE === 'admin' || ROLE === 'director'; }
  function _juniorMin() { return 7; }
  function _lkToday() { return '2026-10-15'; }
  function _lkFlowDue() { return ''; }
  function _lkStatusHtml(a) { return 'ST:' + a.status; }
  function _lkStatusTone() { return 'wait'; }
  function _lkLastSeen() { return ''; }
  function _lkTime() { return '7:02 pm'; }
  function _lkOutsideWindow() { return false; }
  function _busGradeChip(g) { return g ? '<chip>' : ''; }
  function icS(k) { return '<i:' + k + '>'; }
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function set(o) { if ('role' in o) ROLE = o.role; if ('queue' in o) QUEUE = o.queue; if ('throw' in o) THROW = o.throw; if ('store' in o) STORE = o.store; }
`;
const f = loadFns(NAMES, PRELUDE, [...NAMES, 'set', 'LINK']);
const L = f.LINK;
let n = 0;
const R = (o: any) => ({ rowId: o.rowId ?? 'r' + (++n), flowId: 'F1', flowName: 'New People', stepId: 'S1', stepName: 'Step 1', stepOrder: 2,
  personId: 'p' + n, name: 'Zed ' + n, due: null, grade: 8, gender: 'male', mobile: '0412345678', consent: 'ok', dnc: false, consentStep: false, ...o });
const reset = (o: any = {}) => { f.set({ role: 'admin', queue: [], throw: false, store: {}, ...o }); Object.assign(L, { flows: [], fSteps: [], fres: {}, fsel: {}, status: null, ff: undefined }); };

describe('R4 filter buckets: junior Y7-9 (+Y6 with Include Grade 6), senior Y10-12, unknown always shows', () => {
  it('buckets by grade and gender', () => {
    expect(f._lkFlowBucket(R({ grade: 7, gender: 'male' }), 7)).toBe('jg');
    expect(f._lkFlowBucket(R({ grade: 9, gender: 'female' }), 7)).toBe('jf');
    expect(f._lkFlowBucket(R({ grade: 10, gender: 'male' }), 7)).toBe('sg');
    expect(f._lkFlowBucket(R({ grade: 12, gender: 'female' }), 7)).toBe('sf');
  });
  it('Grade 6 is junior only when includeGrade6 (jMin 6)', () => {
    expect(f._lkFlowBucket(R({ grade: 6, gender: 'female' }), 6)).toBe('jf');
    expect(f._lkFlowBucket(R({ grade: 6, gender: 'female' }), 7)).toBeNull();
  });
  it('unknown grade or gender -> null', () => {
    expect(f._lkFlowBucket(R({ grade: null }), 7)).toBeNull();
    expect(f._lkFlowBucket(R({ gender: null }), 7)).toBeNull();
    expect(f._lkFlowBucket(R({ gender: 'other' }), 7)).toBeNull();
  });
  it('filtering keeps the chips that are on plus every unknown row', () => {
    const rows = [R({ rowId: 'jg', grade: 8 }), R({ rowId: 'sf', grade: 11, gender: 'female' }), R({ rowId: 'u', grade: null })];
    expect(f._lkFlowShown(rows, ['sf'], 7).map((r: any) => r.rowId)).toEqual(['sf', 'u']);
    expect(f._lkFlowShown(rows, [], 7).map((r: any) => r.rowId)).toEqual(['u']);
    expect(f._lkFlowShown(rows, ['jg', 'jf', 'sg', 'sf'], 7)).toHaveLength(3);
  });
});

describe('R4 filter persistence (localStorage in try/catch)', () => {
  it('all four on by default; a stored pick wins; junk keys are dropped', () => {
    reset();
    expect(f._lkFfGet()).toEqual(['jg', 'jf', 'sg', 'sf']);
    reset({ store: { yap_lk_flowf: JSON.stringify(['sg', 'nope']) } });
    expect(f._lkFfGet()).toEqual(['sg']);
  });
  it('a blocked localStorage still gives all four', () => {
    reset({ throw: true });
    expect(f._lkFfGet()).toEqual(['jg', 'jf', 'sg', 'sf']);
  });
  it('chips show for admin/director only; leaders see every row unfiltered', () => {
    reset({ store: { yap_lk_flowf: '[]' } });
    L.flows = [R({ rowId: 'a' }), R({ rowId: 'b', grade: null })];
    expect(f._lkFlowVisible().map((r: any) => r.rowId)).toEqual(['b']);
    expect(f._lkFlowsHtml()).toContain('Junior Guys');
    f.set({ role: 'quad' });
    expect(f._lkFlowVisible()).toHaveLength(2);
    expect(f._lkFlowsHtml()).not.toContain('Junior Guys');
  });
  it('chip colours: guys blue, girls pink, aria-pressed follows the pick', () => {
    const h = f._lkFfHtml(['jf']);
    expect(h).toMatch(/lk-ff-boy" aria-pressed="false"[^>]*>Junior Guys/);
    expect(h).toMatch(/lk-ff-girl on" aria-pressed="true"[^>]*>Junior Girls/);
  });
});

describe('R1 DNC on flow rows: no number, no Text, Complete blocked, Remove only', () => {
  it('no Text link on a DNC row even when admin still has the number', () => {
    expect(f._lkTextHref(R({ dnc: true, mobile: '0412345678' }))).toBe('');
    expect(f._lkTextHref(R({ dnc: false }))).toContain('sms:0412345678');
  });
  it('Complete blocked with a reason on DNC and on the consent step until consent is ok', () => {
    reset();
    expect(f._lkStepBlock(R({ dnc: true }))).toMatch(/Do not contact/);
    expect(f._lkCanComplete(R({ dnc: true }))).toBe(false);
    expect(f._lkStepBlock(R({ consentStep: true, consent: 'unknown' }))).toMatch(/^Do the consent check first/);
    expect(f._lkCanComplete(R({ consentStep: true, consent: 'ok' }))).toBe(true);
    expect(f._lkCanComplete(R({}))).toBe(true);
  });
  it('Remove: admin/director only, allowed on DNC rows, not while an action is open', () => {
    reset();
    const r = R({ dnc: true });
    expect(f._lkCanRemove(r)).toBe(true);
    f.set({ role: 'director' }); expect(f._lkCanRemove(r)).toBe(true);
    f.set({ role: 'grade' }); expect(f._lkCanRemove(r)).toBe(false);
    f.set({ role: 'admin', queue: [{ kind: 'action', type: 'removeFromFlowStep', id: 'x', payload: { rowId: r.rowId } }] });
    expect(f._lkCanRemove(r)).toBe(false);
    expect(f._lkCanComplete(r)).toBe(false);
  });
  it('an older console that does not list removeFromFlowStep hides Remove', () => {
    reset();
    L.status = { console: { lastSeenAt: '2026-10-15T00:00:00Z', capabilities: { completeStep: 'live' } } };
    expect(f._lkCanRemove(R({}))).toBe(false);
    L.status.console.capabilities.removeFromFlowStep = 'live';
    expect(f._lkCanRemove(R({}))).toBe(true);
  });
  it('DNC row renders red with the badge and no tick box', () => {
    reset();
    const h = f._lkFlowRowHtml(R({ rowId: 'd1', dnc: true }), '2026-10-15', true);
    expect(h).toContain('lk-row lk-dnc');
    expect(h).toContain('DO NOT CONTACT');
    expect(h).not.toContain('lk-tick"');
  });
});

describe('R4 bulk selection: DNC, consent-blocked, busy and hidden rows are never selected', () => {
  it('_lkSelIds drops untickable rows even when ticked', () => {
    reset();
    const ok = R({ rowId: 'ok' }), dnc = R({ rowId: 'dnc', dnc: true }), cs = R({ rowId: 'cs', consentStep: true, consent: 'contact' });
    const busy = R({ rowId: 'busy' });
    f.set({ queue: [{ kind: 'action', type: 'completeStep', id: 'q', payload: { rowId: 'busy' } }] });
    const sel = { ok: true, dnc: true, cs: true, busy: true };
    expect(f._lkSelIds([ok, dnc, cs, busy], sel)).toEqual(['ok']);
  });
  it('a refused earlier action frees the row again', () => {
    reset();
    const r = R({ rowId: 'rf' });
    L.fres.rf = { status: 'refused', type: 'completeStep' };
    expect(f._lkSelIds([r], { rf: true })).toEqual(['rf']);
  });
  it('the list shows the bulk bar + select-all for the visible tickable rows only', () => {
    reset({ store: { yap_lk_flowf: JSON.stringify(['jg']) } });
    L.flows = [R({ rowId: 'a' }), R({ rowId: 'b' }), R({ rowId: 'c', dnc: true }), R({ rowId: 'g', gender: 'female' })];
    L.fsel = { a: true, c: true, g: true }; // g is filtered out, c is DNC
    const h = f._lkFlowsHtml();
    expect(h).toContain('1 selected');
    expect(h).toContain('Complete 1');
    expect(h).toContain('Select all shown here (2)');
    expect(h).not.toContain("_lkSel('g'"); // filtered out: not on the screen at all
    expect(h).not.toContain("_lkSel('c'"); // DNC: no tick box
  });
});

describe('Remove / consent refusal lines', () => {
  it('locked remove (note path) and practice are said plainly', () => {
    expect(f._lkStatusText({ status: 'refused', reason: 'locked', type: 'removeFromFlowStep' })).toMatch(/remove with a note isn't switched on/);
    expect(f._lkStatusText({ status: 'shadowed', type: 'removeFromFlowStep' })).toMatch(/^Practice mode/);
    expect(f._lkStatusText({ status: 'sent', type: 'removeFromFlowStep', reason: 'already' })).toBe('Not in this step any more.');
    expect(f._lkStatusText({ status: 'sent', type: 'removeFromFlowStep', resultAt: 'x' })).toBe('Removed from the step in Elvanto 7:02 pm');
  });
  it('CONSENT_CHECK_FIRST shows "Do the consent check first"', () => {
    expect(f._lkStatusText({ status: 'refused', code: 'CONSENT_CHECK_FIRST', message: 'x', type: 'completeStep' })).toMatch(/^Do the consent check first/);
  });
  it('the flows banner covers Remove only for admin/director', () => {
    reset(); expect(f._lkFlowTypes()).toEqual(['completeStep', 'removeFromFlowStep']);
    f.set({ role: 'quad' }); expect(f._lkFlowTypes()).toEqual(['completeStep']);
  });
});

describe('R1 student badge + banner', () => {
  it('only when dnc is true', () => {
    expect(f.dncChip({ dnc: true })).toContain('DO NOT CONTACT');
    expect(f.dncChip({ dnc: false })).toBe('');
    expect(f.dncChip(null)).toBe('');
    expect(f.dncBanner({ dnc: true })).toContain('role="alert"');
    expect(f.dncBanner({})).toBe('');
  });
  it('every student screen calls the badge (detail banner, follow-up, birthdays, My students, Health, search, bus)', () => {
    const src = loadIndexHtml();
    expect(extractFn(src, 'showStudentDetail')).toContain('${dncBanner(s)}');
    expect(extractFn(src, '_followupListHtml')).toContain('dncChip(s)');
    expect(extractFn(src, '_scopedWeeklyBirthdays')).toContain('dnc: !!s.dnc');
    expect((src.match(/dncChip\(s\)/g) || []).length).toBeGreaterThanOrEqual(7);
  });
});

describe('R8 console offline: over 15 minutes since the last check-in', () => {
  const now = Date.parse('2026-10-15T09:00:00Z');
  it('returns lastSeenAt only past 15 min; never seen = nothing', () => {
    expect(f._lkOfflineSince({ console: { lastSeenAt: '2026-10-15T08:44:00Z' } }, now)).toBe('2026-10-15T08:44:00Z');
    expect(f._lkOfflineSince({ console: { lastSeenAt: '2026-10-15T08:46:00Z' } }, now)).toBe('');
    expect(f._lkOfflineSince({ console: { lastSeenAt: null } }, now)).toBe('');
    expect(f._lkOfflineSince(null, now)).toBe('');
  });
});
