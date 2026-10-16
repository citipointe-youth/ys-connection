// Lane n2 (nav/save fix round 2026-10-16): intake queue, per-family busy, late-reply guards, wording.
// Extract-and-run: the REAL functions from public/index.html run against small stubs.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

const HTML = loadIndexHtml();
const P = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('B01 Tick Youth result line', () => {
  const f = new Function(`${['_ikVal', '_ikNm', '_ikNames', '_ikPoss', '_ikResultLine'].map((n) => extractFn(HTML, n)).join('\n')}
    return { _ikResultLine };`)();
  const d = { forms: { student: { values: { first: 'Ava', last: 'Nguyen' } }, parent: null } };
  it('youthDemo reads Ticked ..., present tense Tick ...', () => {
    expect(f._ikResultLine({ action: 'youthDemo', role: 'student' }, d)).toBe("Ticked Ava's Youth");
    expect(f._ikResultLine({ action: 'youthDemo', role: 'student' }, d, true)).toBe("Tick Ava's Youth");
  });
});
