import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The logo crop tool (public/index.html, Youth Setup -> Branding -> "Upload
// image") is vanilla inline JS with no build step and no module system, so
// its DOM/canvas-driving functions can't be unit tested directly. But the
// crop-rectangle math is deliberately factored into small pure functions
// (_cropDispSizeFor / _cropClampPan / _cropRectFor) that take plain numbers
// and return plain numbers — this test extracts THOSE exact function
// definitions out of the real HTML source (by name, via regex) and evaluates
// them, so it's testing the actual shipped code, not a re-implementation
// that could drift out of sync.
function extractFn(source: string, name: string): string {
  const re = new RegExp(`function ${name}\\([^)]*\\)\\s*\\{`);
  const m = re.exec(source);
  if (!m) throw new Error(`could not find function ${name} in index.html`);
  const start = m.index;
  // Brace-match from the opening '{' to find the matching close.
  let depth = 0;
  let i = start + m[0].length - 1; // at the opening '{'
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) break; }
  }
  return source.slice(start, i + 1);
}

let _cropDispSizeFor: (natW: number, natH: number, zoom: number, vp: number) => { scale: number; w: number; h: number };
let _cropClampPan: (panX: number, panY: number, dispW: number, dispH: number, vp: number) => { x: number; y: number };
let _cropRectFor: (imgW: number, imgH: number, panX: number, panY: number, zoom: number, vp: number) => { sx: number; sy: number; sw: number; sh: number };

beforeAll(() => {
  const html = readFileSync(join(__dirname, '../../public/index.html'), 'utf8');
  const src = [
    extractFn(html, '_cropDispSizeFor'),
    extractFn(html, '_cropClampPan'),
    extractFn(html, '_cropRectFor'),
  ].join('\n');
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(`${src}\nreturn { _cropDispSizeFor, _cropClampPan, _cropRectFor };`);
  ({ _cropDispSizeFor, _cropClampPan, _cropRectFor } = factory());
});

describe('logo crop math (extracted from public/index.html)', () => {
  it('at zoom 1, a square image maps 1:1 onto the full viewport-sized square', () => {
    const rect = _cropRectFor(1000, 1000, 0, 0, 1, 280);
    expect(rect.sx).toBeCloseTo(0);
    expect(rect.sy).toBeCloseTo(0);
    expect(rect.sw).toBeCloseTo(1000);
    expect(rect.sh).toBeCloseTo(1000);
  });

  it('at zoom 1, a landscape image centred by _cropClampPan-style centering crops the middle square', () => {
    const natW = 2000, natH = 1000, vp = 280;
    const { w, h } = _cropDispSizeFor(natW, natH, 1, vp);
    // Centre pan (as _cropCenter() computes): (vp-w)/2, (vp-h)/2
    const panX = (vp - w) / 2, panY = (vp - h) / 2;
    const rect = _cropRectFor(natW, natH, panX, panY, 1, vp);
    expect(rect.sw).toBeCloseTo(1000); // min(natW,natH)
    expect(rect.sh).toBeCloseTo(1000);
    expect(rect.sx).toBeCloseTo(500); // (2000-1000)/2 — horizontally centred
    expect(rect.sy).toBeCloseTo(0);
  });

  it('the source rect is always square (sw === sh) regardless of image aspect ratio or zoom', () => {
    const dims: Array<[number, number]> = [[2000, 1000], [1000, 2000], [1500, 1500], [3000, 900]];
    for (const [w, h] of dims) {
      for (const zoom of [1, 1.7, 3]) {
        const rect = _cropRectFor(w, h, -5, -5, zoom, 280);
        expect(rect.sw).toBeCloseTo(rect.sh);
      }
    }
  });

  it('zooming in shrinks the source rect proportionally to zoom (sw = min(natW,natH)/zoom at pan 0)', () => {
    const rect1 = _cropRectFor(1000, 1000, 0, 0, 1, 280);
    const rect2 = _cropRectFor(1000, 1000, 0, 0, 2, 280);
    const rect3 = _cropRectFor(1000, 1000, 0, 0, 3, 280);
    expect(rect1.sw).toBeCloseTo(1000);
    expect(rect2.sw).toBeCloseTo(500);
    expect(rect3.sw).toBeCloseTo(1000 / 3);
  });

  it('_cropClampPan prevents revealing empty space past any edge', () => {
    const vp = 280, dispW = 400, dispH = 350;
    // Dragging way past the top-left should clamp to the max valid pan (0,0).
    expect(_cropClampPan(999, 999, dispW, dispH, vp)).toEqual({ x: 0, y: 0 });
    // Dragging way past the bottom-right should clamp to (vp-dispW, vp-dispH).
    expect(_cropClampPan(-999, -999, dispW, dispH, vp)).toEqual({ x: vp - dispW, y: vp - dispH });
    // A pan already in-range is left untouched.
    const inRange = _cropClampPan(-40, -30, dispW, dispH, vp);
    expect(inRange).toEqual({ x: -40, y: -30 });
  });

  it('_cropDispSizeFor covers the viewport exactly on the smaller dimension at zoom 1', () => {
    const { w, h } = _cropDispSizeFor(2000, 1000, 1, 280);
    expect(Math.min(w, h)).toBeCloseTo(280);
    expect(w).toBeGreaterThanOrEqual(280);
    expect(h).toBeGreaterThanOrEqual(280);
  });
});
