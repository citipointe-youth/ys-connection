import { describe, it, expect } from 'vitest';
import { nameKey } from '../services/name-key';
describe('nameKey', () => {
  it('nameKey folds case and inner spaces', () => {
    expect(nameKey('  Mary  Jane ', 'SMITH ')).toBe('mary jane smith');
    expect(nameKey('Mary Jane', 'Smith')).toBe(nameKey('mary  jane', ' smith'));
  });
});
