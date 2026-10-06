import { describe, it, expect, beforeAll } from 'vitest';
import { busCrypt, toPrefs } from '../repositories/supabase/supabase.bus';

beforeAll(() => {
  process.env['FIELD_ENCRYPTION_KEY'] = Buffer.alloc(32, 2).toString('base64');
  process.env['FIELD_ENCRYPTION_KEY_ID'] = 'k1';
});

describe('bus field encryption', () => {
  it('round-trips and is bound to its row', () => {
    const ct = busCrypt.enc('24 Wynnum Rd, Carina', 'bus_addresses:address:a1');
    expect(ct).toMatch(/^v1\./);
    expect(busCrypt.dec(ct, 'bus_addresses:address:a1')).toBe('24 Wynnum Rd, Carina');
    expect(() => busCrypt.dec(ct, 'bus_addresses:address:OTHER')).toThrow();
  });
  it('tolerates plaintext and null', () => {
    expect(busCrypt.dec('plain', 'x')).toBe('plain');
    expect(busCrypt.dec(null, 'x')).toBeNull();
    expect(busCrypt.enc(null, 'x')).toBeNull();
  });
  it('consent notes use their own AAD', () => {
    const ct = busCrypt.enc('Mum, text 7pm', 'bus_consents:note:c1');
    expect(busCrypt.dec(ct, 'bus_consents:note:c1')).toBe('Mum, text 7pm');
  });
});

describe('leader prefs prefGrades (int[] column, not encrypted)', () => {
  it('maps pref_grades onto prefGrades', () => {
    const row = { leader_id: 'L1', in_pool: true, fixed_vehicle_id: null, own_car: null, last_own_rider_keys: [], pref_grades: [9, 10] };
    expect(toPrefs(row).prefGrades).toEqual([9, 10]);
  });
  it('defaults to [] when the column is absent (pre-migration row)', () => {
    const row = { leader_id: 'L1', in_pool: false, fixed_vehicle_id: null, own_car: null, last_own_rider_keys: [] };
    expect(toPrefs(row).prefGrades).toEqual([]);
  });
});
