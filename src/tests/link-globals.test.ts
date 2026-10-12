import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Regression guard for 2026-10-12: the link's Lifegroup report list called lgDisplayName, which was declared inside
// the Connection Audit IIFE (`const CA=(()=>{ ... })();`), so the first group drawn threw a ReferenceError and the
// screen stayed on "Loading..." for good.
describe('lgDisplayName is global', () => {
  it('is declared before the CA module, not inside it', () => {
    const html = readFileSync(join(__dirname, '../../public/index.html'), 'utf8');
    const fn = html.indexOf('function lgDisplayName(');
    expect(fn).toBeGreaterThan(-1);
    expect(fn).toBeLessThan(html.indexOf('const CA=(()=>{'));
  });
});
