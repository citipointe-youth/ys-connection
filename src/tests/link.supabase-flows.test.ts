// RFIX: one flow mobile that cannot be decrypted must not fail the whole flows read.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { SupabaseLinkRepository } from '../repositories/supabase/supabase.link';
import { encryptField } from '../utils/field-crypto';

beforeAll(() => {
  process.env['FIELD_ENCRYPTION_KEY'] = Buffer.alloc(32, 1).toString('base64');
  process.env['FIELD_ENCRYPTION_KEY_ID'] = 'k1';
});

const row = (id: string, mobile: string | null) => ({ row_id: id, flow_id: 'f', flow_name: 'F', step_id: 's', step_name: 'S',
  step_order: 1, person_id: null, name: 'N', due: null, assigned_to: '', grade: null, gender: null, mobile, mobile_is_parent: false });

describe('SupabaseLinkRepository.flows', () => {
  it('a mobile that fails to decrypt reads as null (row id logged, never the value); the other rows survive', async () => {
    const good = encryptField('0411111111', 'link_flow_people.mobile:r1');
    const bad = encryptField('0422222222', 'link_flow_people.mobile:other-row'); // wrong AAD for r2
    const sql = (async () => [row('r1', good), row('r2', bad), row('r3', null)]) as never;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rows = await new SupabaseLinkRepository(sql).flows();
    expect(rows.map((r) => r.mobile)).toEqual(['0411111111', null, null]);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('r2');
    expect(logged).not.toContain('0422222222');
    expect(logged).not.toContain(bad);
    warn.mockRestore();
  });
});
