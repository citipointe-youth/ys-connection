import { describe, it, expect } from 'vitest';
import { loadFns } from './helpers/extract-fn';

describe('#19 Terminology labels cannot carry markup', () => {
  const world = (service: string) => `const DEFAULT_LABELS = { service: 'Youth' };
    const S = { settings: { ministryConfig: { labels: { service: ${JSON.stringify(service)} }, structure: { gradeLabel: ${JSON.stringify(service)} } } } };
    function _structure() { return S.settings.ministryConfig.structure; }`;
  it('a stored script label renders with no tag, keeps plain words and apostrophes', () => {
    const bad = loadFns(['L', '_gradeWord'], world('<img src=x onerror=__xss=1>'));
    expect(bad.L('service')).not.toMatch(/[<>"]/);
    expect(bad._gradeWord()).not.toMatch(/[<>"]/);
    expect(loadFns(['L'], world("Kids' & Youth")).L('service')).toBe("Kids' & Youth");
    expect(loadFns(['L'], world('<>')).L('service')).toBe('Youth');
  });
});
