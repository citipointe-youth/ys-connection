// Consent hub (2026-10-23): Bus > Forms, a searchable list of bus consent forms (one row per child, the console's cached copy).
import { describe, it, expect } from 'vitest';
import { loadFns } from './helpers/extract-fn';

const F = loadFns(['esc', '_busFormHits', '_busFormsListHtml'], `
  const fmtDay = (v) => String(v).slice(0, 10); const BUS = { forms: null, formsQ: '' };`, ['_busFormHits', '_busFormsListHtml', 'BUS']);
const ROWS = [{ name: 'Jo Sample', submittedAt: '2026-10-06T01:00:00.000Z', year: 2026, matched: false },
  { name: 'Bo <Sample>', submittedAt: '2026-10-05T01:00:00.000Z', year: 2026, matched: true }];

describe('Bus Forms', () => {
  it('search matches every word, any order, any case', () => {
    expect(F._busFormHits(ROWS, 'sample jo').map((r: any) => r.name)).toEqual(['Jo Sample']);
    expect(F._busFormHits(ROWS, '').length).toBe(2);
  });
  it('rows are escaped; an unmatched form says so', () => {
    F.BUS.forms = { rows: ROWS }; F.BUS.formsQ = '';
    const h = F._busFormsListHtml();
    expect(h).toContain('Bo &lt;Sample&gt;');
    expect(h).toContain('Not matched');
    F.BUS.formsQ = 'zz';
    expect(F._busFormsListHtml()).toContain('No forms match');
  });
});
