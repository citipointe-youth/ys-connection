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
