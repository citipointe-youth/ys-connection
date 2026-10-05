import { describe, it, expect, beforeAll } from 'vitest';
import { busCrypt } from '../repositories/supabase/supabase.bus';

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
});
