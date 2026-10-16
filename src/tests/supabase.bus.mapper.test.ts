import { describe, it, expect, beforeAll } from 'vitest';
import { busCrypt, toPrefs, encSnapAddress, decSnapAddress, toRunVehicle } from '../repositories/supabase/supabase.bus';

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
  // Task D (owner, 2026-10-08): bus_run_riders.snap_address is `text not null`; busCrypt.enc('')
  // short-circuits to null (would violate that constraint), so an address-less rider's '' snap
  // address is encrypted via a one-space sentinel instead and must decrypt back to ''.
  it('snap_address round-trips an empty string via the one-space sentinel, never writing null', () => {
    const ct = encSnapAddress('', 'r1');
    expect(ct).not.toBeNull();
    expect(decSnapAddress(ct, 'r1')).toBe('');
    const normalCt = encSnapAddress('24 Wynnum Rd, Carina', 'r1');
    expect(decSnapAddress(normalCt, 'r1')).toBe('24 Wynnum Rd, Carina');
  });
});

describe('leader prefs prefGrades (int[] column, not encrypted)', () => {
  it('maps pref_grades onto prefGrades', () => {
    const row = { leader_id: 'L1', in_pool: true, own_car: null, last_own_rider_keys: [], pref_grades: [9, 10] };
    expect(toPrefs(row).prefGrades).toEqual([9, 10]);
  });
  it('defaults to [] when the column is absent (pre-migration row)', () => {
    const row = { leader_id: 'L1', in_pool: false, own_car: null, last_own_rider_keys: [] };
    expect(toPrefs(row).prefGrades).toEqual([]);
  });
});

describe('run vehicle locked (I11, migration 0034)', () => {
  const row = (over: Record<string, unknown> = {}) => ({ id: 'rv1', run_id: 'r1', vehicle_id: 'v1', owner_leader_id: null, name: 'Van',
    seats: 8, plate: null, running: true, leader_ids: [], ends_at: 'church', ends_address: null, ends_place_id: null, colour_index: 0,
    leader_snap: [], ...over });
  it('reads locked from the row', () => {
    expect(toRunVehicle(row({ locked: true })).locked).toBe(true);
    expect(toRunVehicle(row({ locked: false })).locked).toBe(false);
  });
  it('a row from before 0034 (no column) reads as unlocked', () => {
    expect(toRunVehicle(row()).locked).toBe(false);
  });
});
