// L6a (round 2026-10-21, M7 T12 + T14): intake/consent holds point at the app's own tools, not Elvanto, where the app can do it.
import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml, SITE_TIME_FNS, SITE_TIME_CONSTS } from './helpers/extract-fn';

const HTML = loadIndexHtml();
const IK_HOLD = HTML.match(/^const IK_HOLD = \{[\s\S]*?\n\};/m)![0];
const f = loadFns([...SITE_TIME_FNS, 'esc', '_lkDay', '_lkAddDays', '_ikHoldText', '_ikNames', '_ikNm', '_ikVal', '_ikPoss'], `
  const S = { settings: null };
  const _ik = () => ({ tab: 'intake' });
  ${SITE_TIME_CONSTS}
  ${IK_HOLD}`);

describe('T12 parent mobile needs fixing', () => {
  const h = { text: 'Parent mobile needs fixing', role: 'parent' };
  it('with the Set mobile extra: press it here', () => {
    const d = { extras: [{ action: 'setField', field: 'mobile', value: '0412 345 678', state: 'todo', text: 'Set mobile' }] };
    const t = f._ikHoldText(h, d);
    expect(t).toBe("The parent's mobile in Elvanto isn't a valid 04 number, so the consent text can't be sent. Press Set mobile in Elvanto below to use 0412 345 678 from their form.");
  });
  it('without it (the form has no valid number either): ask the parent', () => {
    const t = f._ikHoldText(h, { extras: [] });
    expect(t).toContain("The parent's form has no valid 04 number either.");
    expect(t).not.toMatch(/Fix it on their profile/);
  });
});

describe('T14 consent form holds point at Tidy up', () => {
  const t = (text: string) => f._ikHoldText({ text, role: 'student' }, {});
  it('two, unsure and unmatched forms name Forms with no person', () => {
    for (const k of ['Two consent forms', 'Unsure consent form', 'Unmatched consent form']) expect(t(k)).toContain('Tidy up > Forms with no person');
    expect(t('Unsure consent form')).not.toContain('Elvanto');
    expect(t('Unmatched consent form')).not.toContain('Elvanto');
  });
});
