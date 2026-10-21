// Round 2026-10-22 lane L1 (RV1 consolidated A3/A5/B1-B4): the Admin shell. Extract-and-run against public/index.html.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

const HTML = loadIndexHtml();

describe('A3: switching to New Year never re-locks the wizard', () => {
  it('switchAdminTab does not call _wizReset', () => {
    expect(extractFn(HTML, 'switchAdminTab')).not.toContain('_wizReset');
  });
});
