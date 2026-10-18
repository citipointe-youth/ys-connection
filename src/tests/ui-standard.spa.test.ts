// UI standard 2026-10-18 (ux-run-2026-10-18/REVIEW.md F): fmtDay is the one date format.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadFns, loadIndexHtml } from './helpers/extract-fn';

describe('fmtDay', () => {
  afterEach(() => vi.useRealTimers());
  const at = (iso: string) => { vi.useFakeTimers(); vi.setSystemTime(new Date(iso)); };
  it('"Fri 16 Oct"; the year only when not this year (Brisbane); time only when asked and only for an instant', () => {
    at('2026-10-18T00:00:00Z');
    const { fmtDay } = loadFns(['fmtDay']);
    expect(fmtDay('2026-10-16')).toBe('Fri 16 Oct');
    expect(fmtDay('2025-10-16')).toBe('Thu 16 Oct 2025');
    expect(fmtDay('2026-10-16', true)).toBe('Fri 16 Oct'); // a calendar day never gets a time
    expect(fmtDay('2026-09-18T09:00:00+10:00', true)).toBe('Fri 18 Sep, 9am');
    expect(fmtDay('2026-10-16T06:31:00Z', true)).toBe('Fri 16 Oct, 4:31pm'); // UTC instant shown in Brisbane
    expect(fmtDay('2026-10-16T14:05:00Z')).toBe('Sat 17 Oct'); // past midnight in Brisbane
    expect(fmtDay(new Date('2026-10-16T00:00:00Z'), true)).toBe('Fri 16 Oct, 10am');
    expect(fmtDay('')).toBe('');
    expect(fmtDay(null)).toBe('');
    expect(fmtDay('16/10/2026')).toBe('');
  });
  it('the year rule follows Brisbane New Year, not UTC', () => {
    at('2026-12-31T15:00:00Z'); // 1 Jan 2027 01:00 Brisbane
    expect(loadFns(['fmtDay']).fmtDay('2026-12-31')).toBe('Thu 31 Dec 2026');
  });
});

describe('shared markup', () => {
  const html = loadIndexHtml();
  it('no hand-rolled dd/mm/yyyy, no lk-row-act spacer, no ik-srch search', () => {
    expect(html).not.toContain("split('-').reverse().join('/')");
    expect(html).not.toContain('lk-row-act');
    expect(html).not.toContain('ik-srch');
  });
  it('ux18 P9: the Mismatches diff is capped; an .rc-foot empty area falls through to the card link', () => {
    expect(html).toMatch(/\.ik-mis2\{[^}]*max-width:560px/);
    expect(html).toContain('.rc-foot{pointer-events:none}.rc-foot>*{pointer-events:auto}');
  });
  it('ux18 P9: the empty states no longer say the lists load only "when you ask"', () => {
    expect(html).not.toContain('when you ask');
  });
  it('.pg clears the nav from --nav-h, not a literal', () => {
    expect(html).toMatch(/\.pg\{[^}]*calc\(var\(--nav-h\) \+ var\(--s3\) \+ var\(--safe-b\)\)/);
  });
  it('bl18 Y3: touch .btn-sm stays 44px; health/admin rows are .rc; one pill base', () => {
    expect(html).not.toMatch(/\.btn-sm[^{}]*\{min-height:40px\}/);
    expect(html).not.toContain('position:absolute;bottom:8px;right:8px');
    expect(html).not.toContain('class="el-row');
    expect(html).toContain('<div class="li rc ar-rc">');
    expect(html).toMatch(/\.pill,\.chip,\.lk-tag,\.lk-nl,\.lk-od,\.lk-chip,\.badge\{/);
    // Fix 2: Accounts rows are one line (name left, pill + icons right), no icon-only footer band
    expect(html).toContain('<div class="li rc rc-row${acctGenderClass}">');
    expect(html).toMatch(/\.rc\.rc-row\{display:flex;flex-wrap:wrap;align-items:center/);
  });
  it('fix19 deadspace: a lone card action shares the last meta row; Health cards open on tap; Admin tabs wrap', () => {
    expect(html).toMatch(/\.rc\{display:flex;flex-wrap:wrap;[^}]*padding:var\(--s3\) var\(--s4\)/);
    expect(html).toContain('.rc>.rc-foot:has(>:only-child){flex:0 1 auto;margin-left:auto}');
    expect(html).toContain('.rc:has(>.rc-foot>:only-child):not(:has(.ik-mis))>.rc-foot{grid-column:2;');
    // Health: the name is the whole-card button (same handler + aria); no Profile-only footer band
    expect(html).toContain(`<button type="button" class="lk-nm rc-go" onclick="showStudentDetail('\${s.id}')" title="View profile" aria-label="View profile for`);
    expect(html).not.toContain(`\${icS('id')} Profile</button></div>`);
    expect(html).toContain('.rc-icons>.chip{order:9}');
    expect(html).toContain('.admin-tabs{flex-wrap:wrap}');
  });
});
