import { describe, it, expect } from 'vitest';
import { loadFns } from './helpers/extract-fn';

// _fixViewportGap must not scroll while the iOS keyboard is open (it fights scroll-into-view), only once it has closed.
function run(vvHeight: number) {
  const prelude = `var scrolls = [];
var window = { innerHeight: 800, scrollY: 40, visualViewport: { height: ${vvHeight} }, scrollTo: (x, y) => scrolls.push([x, y]) };
var requestAnimationFrame = (f) => f();`;
  return loadFns(['_kbOpen', '_fixViewportGap'], prelude, ['scrolls', '_fixViewportGap']);
}

describe('_fixViewportGap', () => {
  it('does not scroll while the keyboard is open', () => {
    const f = run(450); f._fixViewportGap();
    expect(f.scrolls).toEqual([]);
  });
  it('nudges once the keyboard has closed', () => {
    const f = run(800); f._fixViewportGap();
    expect(f.scrolls).toEqual([[0, 40]]);
  });
});
