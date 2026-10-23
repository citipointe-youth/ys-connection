// L6a (round 2026-10-21, M7 T12 + T14): intake/consent holds point at the app's own tools, not Elvanto, where the app can do it.
import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml, SITE_TIME_FNS, SITE_TIME_CONSTS } from './helpers/extract-fn';

const HTML = loadIndexHtml();
const IK_HOLD = HTML.match(/^const IK_HOLD = \{[\s\S]*?\n\};/m)![0];
const f = loadFns([...SITE_TIME_FNS, 'esc', '_lkDay', '_lkAddDays', '_ikHoldText', '_ikNames', '_ikNm', '_ikVal', '_ikPoss', 'fmtPhone'], `
  const S = { settings: null };
  const _ik = () => ({ tab: 'intake' });
  ${SITE_TIME_CONSTS}
  ${IK_HOLD}`);

describe('T12 parent mobile needs fixing', () => {
  const h = { text: 'Parent mobile needs fixing', role: 'parent' };
  it('with the Set mobile extra: press it here', () => {
    // as the console pushes it: IX.stepText's text, phoneFix's bare digits
    const d = { extras: [{ key: 'k1', action: 'setField', role: 'parent', field: 'mobile', value: '0412345678', state: 'todo', text: "Set Jane Smith's mobile to 0412 345 678" }] };
    const t = f._ikHoldText(h, d);
    expect(t).toBe("The parent's mobile in Elvanto isn't a valid 04 number, so the consent text can't be sent. Press the Set mobile button below to use " + f.fmtPhone('0412345678') + ' from their form.');
    expect(t).not.toContain('0412345678');
  });
  it('without it (the form has no valid number either): ask the parent', () => {
    const t = f._ikHoldText(h, { extras: [] });
    expect(t).toContain("The parent's form has no valid 04 number either.");
    expect(t).not.toMatch(/Fix it on their profile/);
  });
});

describe('T14 consent form holds keep the Elvanto wording (fix round 1: Tidy up links do not reach the planner)', () => {
  const t = (text: string) => f._ikHoldText({ text, role: 'student' }, {});
  it('two, unsure and unmatched', () => {
    expect(t('Two consent forms')).toBe('Two consent forms match this student. Pick the right one in Elvanto.');
    expect(t('Unsure consent form')).toBe("A consent form might be this student's. Check it in Elvanto.");
    expect(t('Unmatched consent form')).toBe("This form isn't for a new student this week. If it's an existing student, approve it to their profile.");
  });
});
