import { describe, it, expect } from 'vitest';
import { QUAD_LABELS, QUADS, quadLabelFor } from '../core/types/enums';

describe('quadLabelFor', () => {
  it('returns QUAD_LABELS when Simple logins is off', () => {
    for (const q of QUADS) expect(quadLabelFor(q, false)).toBe(QUAD_LABELS[q]);
  });

  it('returns the Junior/Senior names when Simple logins is on', () => {
    expect(quadLabelFor('g79', true)).toBe('Junior Girls');
    expect(quadLabelFor('b79', true)).toBe('Junior Guys');
    expect(quadLabelFor('g1012', true)).toBe('Senior Girls');
    expect(quadLabelFor('b1012', true)).toBe('Senior Guys');
  });

  it('QUAD_LABELS use exactly one en dash and no hyphen-minus range', () => {
    for (const label of Object.values(QUAD_LABELS)) {
      expect(label.split('–').length - 1).toBe(1);
      expect(label).not.toMatch(/\d-\d/);
      expect(label).not.toContain('-');
    }
  });
});
