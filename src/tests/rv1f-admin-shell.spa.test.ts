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
