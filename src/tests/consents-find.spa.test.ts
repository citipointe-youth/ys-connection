// I6 (R2-G3), consent hub (2026-10-23, Task 11): the step-0 / Parent Consent sheet's button opens the hub, searched for the
// student (R5: First Last); a parent's row opens it unsearched. The old Consents tab hand-off (_ikFind) is gone.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

const FNS = ['_lkStepConsents', '_ikFormName', '_ikAnd', 'tidyName'];
const HTML = loadIndexHtml();
const BODY = FNS.map((n) => extractFn(HTML, n)).join('\n');

function env(row: any) {
  const t = { pushes: 0, draws: 0, went: [] as string[] };
  const I: any = { hubQ: 'old' };
  const fns = new Function('__t', '__I', '__row', `
    const S = { page: 'link-flows' };
    const LINK = { fs: __row ? { rowId: 'r1' } : null, ik: __I };
    const _lkFlowRow = (id) => (id === 'r1' ? __row : null);
    const _ik = () => __I;
    const navPush = () => { __t.pushes++; };
    const closeModal = () => { LINK.fs = null; };
    const go = (p) => { __t.went.push(p); if (p !== S.page) navPush(); S.page = p; __I.hubQ = ''; }; // _navLanding clears the search
    const _ikDraw = () => { __t.draws++; };
    ${BODY}
    return { _lkStepConsents, LINK };`)(t, I, row);
  return { fns, t, I };
}

describe('step 0 / Parent Consent: Open in New youth & consent', () => {
  it('the sheet button onclick is exactly _lkStepConsents(), shown only for a hub-owned row', () => {
    const h = extractFn(HTML, '_lkStepHtml');
    expect(h).toContain('onclick="_lkStepConsents()">Open in New youth &amp; consent');
    expect(h).toContain('_lkHubOwned(r) ?');
    expect(h).not.toContain('>Consents</button>');
  });
  it('a step-0 row: one navPush (go), the hub searched for "First Last", the sheet closed', () => {
    const { fns, t, I } = env({ rowId: 'r1', consentStep: true, personId: 'p1', name: 'Notlisted, Kit' });
    fns._lkStepConsents();
    expect(t.went).toEqual(['link-intake']);
    expect(t.pushes).toBe(1);
    expect(I.hubQ).toBe('Kit Notlisted');
    expect(fns.LINK.fs).toBeNull();
    expect(t.draws).toBe(1);
  });
  it('a Parent Consent row: the hub opens unsearched', () => {
    const { fns, I } = env({ rowId: 'r1', consentStep: false, personId: 'p2', name: 'Pat Parent' });
    fns._lkStepConsents();
    expect(I.hubQ).toBe('');
  });
  it('no flow row open: nothing happens', () => {
    const { fns, t } = env(null);
    fns._lkStepConsents();
    expect(t.went).toEqual([]);
  });
});
