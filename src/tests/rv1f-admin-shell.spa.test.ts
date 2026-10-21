// Round 2026-10-22 lane L1 (RV1 consolidated A3/A5/B1-B4): the Admin shell. Extract-and-run against public/index.html.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

const HTML = loadIndexHtml();

describe('A3: switching to New Year never re-locks the wizard', () => {
  it('switchAdminTab does not call _wizReset', () => {
    expect(extractFn(HTML, 'switchAdminTab')).not.toContain('_wizReset');
  });
});

describe('A5: the ungated Full Reset and Clear Service/Group Data are gone from Admin', () => {
  it('renderAdminView offers neither wipe; the wizard keeps the one gated reset', () => {
    const v = extractFn(HTML, 'renderAdminView');
    expect(v).not.toContain('/admin/clear-service-group');
    expect(v).not.toContain('/admin/reset');
    expect(v).not.toContain('Clear Service/Group Data');
    expect(HTML).toContain("API.post('/admin/reset'"); // the New Year wizard's step 4
  });
});

describe('B4: Accounts tidy', () => {
  it('the Username tip is plain; no dead rl in the Accounts loop', () => {
    const add = extractFn(HTML, 'showAddUser');
    expect(add).toContain('The name used to log in. For a grade login, also set Gender scope below.');
    expect(add).not.toContain('grade7g');
    expect(extractFn(HTML, 'renderAdminView')).not.toContain('const rl =');
  });
});

describe('B2: the Data tab body is gone; the wizard keeps its import/export helpers', () => {
  it('no Data block, no adminAction; the helpers the wizard calls stay', () => {
    const v = extractFn(HTML, 'renderAdminView');
    expect(v).not.toContain("_adminTab === 'data'");
    expect(v).not.toContain('alloc-auto-leaders');
    expect(HTML).not.toMatch(/function adminAction\(/);
    for (const fn of ['exportAllocationsCSV', 'processAllocationImport', 'exportPrayersCSV', 'handlePrayerImportFile']) {
      expect(HTML, fn).toContain(`function ${fn}(`);
    }
  });
});
