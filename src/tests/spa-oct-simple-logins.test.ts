import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml } from './helpers/extract-fn';

const QL = `const QUAD_LABELS = { g79:'Girls Yr 7–9', b79:'Boys Yr 7–9', g1012:'Girls Yr 10–12', b1012:'Boys Yr 10–12' };
const SIMPLE_QUAD_LABELS = { g79:'Junior Girls', b79:'Junior Guys', g1012:'Senior Girls', b1012:'Senior Guys' };`;

describe('S1.1 quadLabel and _simpleLoginsOn', () => {
  it('_simpleLoginsOn is false with an empty config', () => {
    const f = loadFns(['_simpleLoginsOn'], `const S = { settings: { ministryConfig: {} } };`);
    expect(f._simpleLoginsOn()).toBe(false);
  });
  it('quadLabel uses the old label when Simple is off', () => {
    const f = loadFns(['_simpleLoginsOn', 'quadLabel'], `${QL} const S = { settings: { ministryConfig: { logins: { simple: false } } } };`);
    expect(f.quadLabel('b1012')).toBe('Boys Yr 10–12');
  });
  it('quadLabel uses Senior Guys when Simple is on', () => {
    const f = loadFns(['_simpleLoginsOn', 'quadLabel'], `${QL} const S = { settings: { ministryConfig: { logins: { simple: true } } } };`);
    expect(f.quadLabel('b1012')).toBe('Senior Guys');
    expect(f.quadLabel('g79')).toBe('Junior Girls');
  });
  it('client defaults mirror logins.simple only, and modules.prayers', () => {
    const src = loadIndexHtml();
    const i = src.indexOf('const MINISTRY_CONFIG_DEFAULTS_CLIENT = {');
    const block = src.slice(i, src.indexOf('\n};', i));
    expect(block).toMatch(/logins: \{ simple: false \}/);
    expect(block).toMatch(/prayers: true/);
    expect(block).not.toMatch(/retiredGradeIds|gradeRoleWasOn/);
  });
  it('no hard-coded quad label maps remain outside QUAD_LABELS', () => {
    const src = loadIndexHtml();
    expect(src).not.toMatch(/QUAD_LABELS_LOCAL/);
    expect(src).not.toMatch(/QLBL\[/);
  });
});
