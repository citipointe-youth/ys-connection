// I7 (R2-G4) Flow steps; consent hub (2026-10-23, Task 11): the tiles are gone, step 0 and Parent Consent step 1 are read-only
// here with New youth & consent on (_lkHubOwned); the bulk cap of 50 stays.
import { describe, it, expect, beforeEach } from 'vitest';
import { loadFns, loadIndexHtml, extractFn } from './helpers/extract-fn';

const NAMES = ['_lkFlowBucket', '_lkFlowShown', '_lkStepBlock', '_lkConsentWait', '_lkNotReceived', '_lkNotReceivedText', '_lkFlowFree', '_lkFlowAct', '_lkCap', '_lkCapOff', '_lkCanComplete',
  '_lkTickable', '_lkSelIds', '_lkFfGet', '_lkFfHtml', '_lkFlowVisible', '_lkFlowKind', '_lkFirstStep', '_lkHubOwned', '_lkFlowGroups', '_lkFlowRowHtml', '_lkFlowsHtml', '_lkMemOff', '_lkCanRemove', '_lkFlowRow', '_lkBulkOpen', '_lkBulkSend', '_lkStepHtml', '_lkStepBtns',
  '_lkTextHref', '_lkSmsHref', '_lkFirstName'];
const PRELUDE = `
  var ROLE = 'admin', MODALS = [], TOASTS = [], PUSHED = [];
  var localStorage = { getItem: () => null, setItem: () => {} };
  var S = { get user() { return { role: ROLE }; }, page: 'link-flows',
    settings: { ministryConfig: { elvanto: { peopleFlowPrefix: 'Brisbane - Youth - New People', consentFlowPrefix: 'Brisbane - Youth - Parent Consent' } } } };
  var LINK = { flows: [], fSteps: [], fres: {}, fsel: {}, fOpen: {}, status: null, ldrs: [] };
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
const f = loadFns(NAMES, PRELUDE, [...NAMES, 'set', 'out', 'LINK', 'S']);
const L = f.LINK;
const PEOPLE = 'Brisbane - Youth - New People', PARENT = 'Brisbane - Youth - Parent Consent';
let n = 0;
const R = (o: any) => ({ rowId: o.rowId ?? 'r' + (++n), flowId: 'F1', flowName: PEOPLE, stepId: 'S1', stepName: 'Welcome', stepOrder: 2,
  personId: 'p' + n, name: 'Amy Test ' + n, due: null, grade: 8, gender: 'female', mobile: '0412345678', consent: 'ok', dnc: false, consentStep: false, ...o });
const PAR = (o: any = {}) => R({ flowId: 'F2', flowName: PARENT, stepId: 'P1', stepName: 'Text parent', stepOrder: 1, grade: null, gender: null, ...o });

function load(role = 'admin', parents = 3) {
  f.set({ role });
  Object.assign(L, { fres: {}, fsel: {}, fOpen: {}, ff: undefined });
  L.flows = [R({ rowId: 'a' }), R({ rowId: 'b', stepId: 'S2', stepName: 'Follow up', stepOrder: 3 }),
    ...Array.from({ length: parents }, (_, i) => PAR({ rowId: 'pp' + i })), PAR({ rowId: 'p2nd', stepId: 'P2', stepName: 'Chase', stepOrder: 2 })];
  L.fSteps = [{ flowId: 'F1', flowName: PEOPLE, stepId: 'S1', stepName: 'Welcome', stepOrder: 2 }, { flowId: 'F1', flowName: PEOPLE, stepId: 'S2', stepName: 'Follow up', stepOrder: 3 },
    { flowId: 'F2', flowName: PARENT, stepId: 'P1', stepName: 'Text parent', stepOrder: 1 }, { flowId: 'F2', flowName: PARENT, stepId: 'P2', stepName: 'Chase', stepOrder: 2 }];
}
const strip = (h: string) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

// Consent hub (2026-10-23, Task 11): the tiles are gone. With New youth & consent on, New People step 0 and the Parent Consent
// flow's first step are read-only on Flow steps (no Complete, Remove or tick) and their sheet links to the hub.
describe('Flow steps: no tiles; step 0 and Parent Consent step 1 are the hub\'s', () => {
  beforeEach(() => load());
  it('admin: no "New Students ·" / "Parent text ·" tile buttons; every flow and step listed', () => {
    const h = f._lkFlowsHtml(), s = strip(h);
    expect(h).not.toContain('lk-tiles');
    expect(h).not.toContain('_lkFlowPick');
    expect(s).not.toContain('New Students ·');
    expect(s).not.toContain('Parent text ·');
    for (const step of ['Welcome', 'Follow up', 'Text parent', 'Chase']) expect(h).toContain(step);
    expect(h).toContain('Junior Guys');
  });
  it('module on, on link-flows: a step-0 row cannot be completed, removed or ticked; its sheet links to the hub', () => {
    const s0 = R({ rowId: 's0', consentStep: true, stepOrder: 1 });
    L.flows.push(s0);
    expect(f._lkCanComplete(s0)).toBe(false);
    expect(f._lkCanRemove(s0)).toBe(false);
    expect(f._lkTickable(s0)).toBe(false);
    L.fs = { rowId: 's0', note: '', priv: false };
    expect(f._lkStepHtml()).toContain('onclick="_lkStepConsents()">Open in New youth &amp; consent');
    expect(f._lkStepBtns()).not.toContain('_lkStepSend');
  });
  it('module on: a Parent Consent step-1 row is read-only too; its second step and New People steps are unchanged', () => {
    const p0 = L.flows.find((r: any) => r.rowId === 'pp0'), p2 = L.flows.find((r: any) => r.rowId === 'p2nd'), a = L.flows.find((r: any) => r.rowId === 'a');
    expect(f._lkCanComplete(p0)).toBe(false);
    expect(f._lkCanRemove(p0)).toBe(false);
    expect(f._lkCanComplete(p2)).toBe(true);
    expect(f._lkCanComplete(a)).toBe(true);
    L.fs = { rowId: 'pp0', note: '', priv: false };
    expect(f._lkStepHtml()).toContain('Open in New youth &amp; consent');
    expect(f._lkStepBtns()).not.toContain('Send parent text');
  });
  it('Service Visits line: shown for a number (including 0), hidden for null or missing', () => {
    const sheet = (extra: any) => { L.flows = [...L.flows.filter((r: any) => r.rowId !== 'sv'), { ...L.flows.find((r: any) => r.rowId === 'a'), rowId: 'sv', ...extra }]; L.fs = { rowId: 'sv', note: '', priv: false }; return f._lkStepHtml(); };
    expect(sheet({ serviceVisits: 2 })).toContain('<p class="lk-sub">Service Visits: 2</p>');
    expect(sheet({ serviceVisits: 0 })).toContain('<p class="lk-sub">Service Visits: 0</p>');
    expect(sheet({ serviceVisits: null })).not.toContain('Service Visits');
    expect(sheet({ serviceVisits: undefined })).not.toContain('Service Visits');
  });
  it('51 ticked: no sheet, toast "Up to 50 at a time. Untick some first."', () => {
    L.flows = Array.from({ length: 51 }, (_, i) => R({ rowId: 'c' + i }));
    L.fsel = Object.fromEntries(Array.from({ length: 51 }, (_, i) => ['c' + i, true]));
    f._lkBulkOpen();
    expect(f.out().MODALS).toEqual([]);
    expect(f.out().TOASTS).toEqual(['Up to 50 at a time. Untick some first.']);
  });
  it('bulk Complete: one sheet, Complete N, toast "N queued to complete"', () => {
    L.fsel = { a: true, b: true };
    f._lkBulkOpen();
    expect(f.out().MODALS[0]).toContain('Complete 2 steps');
    expect(f.out().MODALS[0]).not.toContain('parent text');
    f._lkBulkSend();
    expect(f.out().PUSHED.length).toBe(2);
    expect(f.out().TOASTS).toEqual(['2 queued to complete']);
  });
  it('onclicks hold no id or name', () => {
    const src = ['_lkBulkOpen', '_lkStepHtml'].map((x) => extractFn(loadIndexHtml(), x)).join('\n');
    const handlers = [...src.matchAll(/onclick="([^"]*)"/g)].map((m) => m[1]);
    expect(handlers.length).toBeGreaterThan(0);
    for (const h of handlers) expect(h).not.toMatch(/rowId|personId|name/);
  });
});

// Y2b: the flow kinds follow this location's two flow names (Youth Setup); an admin sees a banner while the New People flow is unknown.
describe('Y2b Flow step kinds from config', () => {
  const E = f.S.settings.ministryConfig.elvanto;
  const BRIS = { peopleFlowPrefix: E.peopleFlowPrefix, consentFlowPrefix: E.consentFlowPrefix };
  const BANNER = "This year's New People flow wasn't found, so step 0 can't be completed. In Admin > Youth Setup > Elvanto for this location, check the New People flow name. It must match the flow in Elvanto.";
  const named = (people: string, parent: string) => {
    L.flows = L.flows.map((r: any) => ({ ...r, flowName: r.flowId === 'F1' ? people : parent }));
    L.fSteps = L.fSteps.map((r: any) => ({ ...r, flowName: r.flowId === 'F1' ? people : parent }));
  };
  beforeEach(() => { Object.assign(E, BRIS); load(); });
  it('Brisbane prefixes give the same kinds as before', () => {
    expect(E).toMatchObject({ peopleFlowPrefix: 'Brisbane - Youth - New People', consentFlowPrefix: 'Brisbane - Youth - Parent Consent' });
    expect(f._lkFlowKind({ flowName: PEOPLE })).toBe('people');
    expect(f._lkFlowKind({ flowName: 'Brisbane - Youth - New People 2026' })).toBe('people');
    expect(f._lkFlowKind({ flowName: PARENT })).toBe('parent');
    expect(f._lkFlowKind({ flowName: 'Brisbane - Youth - Parent Consent 2026' })).toBe('parent');
    expect(f._lkFlowKind({ flowName: 'Brisbane - Youth - Connect' })).toBe('');
    expect(f._lkFlowKind({ flowName: 'brisbane - youth - new people' })).toBe(''); // case-sensitive, as before
    expect(f._lkFlowKind(null)).toBe('');
  });
  it('other prefixes: the kinds follow them, Brisbane names no longer match', () => {
    Object.assign(E, { peopleFlowPrefix: "St. Mark's (North) - New People", consentFlowPrefix: 'Logan - Parent Consent' });
    expect(f._lkFlowKind({ flowName: PEOPLE })).toBe('');
    expect(f._lkFlowKind({ flowName: PARENT })).toBe('');
    expect(f._lkFlowKind({ flowName: "St. Mark's (North) - New People 2026" })).toBe('people');
    expect(f._lkFlowKind({ flowName: "St Marks (North) - New People 2026" })).toBe('');
    expect(f._lkFlowKind({ flowName: 'Logan - Parent Consent 2026' })).toBe('parent');
    named("St. Mark's (North) - New People 2026", 'Logan - Parent Consent 2026');
    expect(strip(f._lkFlowsHtml())).not.toContain("This year's New People flow");
    expect(f._lkCanComplete(L.flows.find((r: any) => r.rowId === 'pp0'))).toBe(false); // the Parent Consent first step follows the prefix
  });
  it('blank prefixes: no kinds, every flow listed', () => {
    Object.assign(E, { peopleFlowPrefix: '', consentFlowPrefix: '  ' });
    expect(f._lkFlowKind({ flowName: PEOPLE })).toBe('');
    expect(f._lkFlowKind({ flowName: PARENT })).toBe('');
    const h = f._lkFlowsHtml();
    expect(h).toContain('Welcome');
    expect(h).toContain('Text parent');
  });
  it('an absent elvanto block (settings not loaded) reads as blank', () => {
    const keep = f.S.settings;
    f.S.settings = null;
    try { expect(f._lkFlowKind({ flowName: PEOPLE })).toBe(''); expect(f._lkFlowsHtml()).toContain('Welcome'); } finally { f.S.settings = keep; }
  });
  it('unknown New People flow: the admin sees the banner, a director and a leader do not', () => {
    const banner = (role: string) => { f.set({ role }); return f._lkFlowsHtml().includes(BANNER.replace(/>/g, '&gt;')); };
    named('Brisbane - Youth - New People 2026', 'Brisbane - Youth - Parent Consent 2026');
    expect(banner('admin')).toBe(false); // Brisbane prefix + this year's flow: known, no banner
    E.peopleFlowPrefix = ''; // blank
    expect(banner('admin')).toBe(true);
    expect(f._lkFlowsHtml()).toContain('class="lk-alert warn"');
    expect(banner('director')).toBe(false);
    expect(banner('leader')).toBe(false);
    E.peopleFlowPrefix = 'Logan - Youth - New People'; // unmatched
    expect(banner('admin')).toBe(true);
    expect(banner('leader')).toBe(false);
    E.peopleFlowPrefix = 'Brisbane - Youth - New People';
    named('Brisbane - Youth - New People', 'Brisbane - Youth - Parent Consent'); // no year: the server finds no flow either
    expect(banner('admin')).toBe(true);
    named('BRISBANE - YOUTH - NEW PEOPLE 2025', PARENT); // the server's test is case-insensitive
    expect(banner('admin')).toBe(false);
  });
  it('a refused step-0 Complete (CONSENT_FLOW_UNKNOWN) shows the plain sentence', () => {
    const t = loadFns(['_lkStatusText'], 'function _lkTime() { return ""; } function _lkOutsideWindow() { return false; }', ['_lkStatusText'])._lkStatusText;
    expect(t({ status: 'refused', code: 'CONSENT_FLOW_UNKNOWN', reason: null, message: '' }))
      .toBe("Can't check consent. This year's New People flow wasn't found. Ask your admin.");
  });
});
