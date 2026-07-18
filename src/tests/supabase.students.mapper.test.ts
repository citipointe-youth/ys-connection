import { describe, it, expect, beforeAll } from 'vitest';
import { toStudent, encryptPhoneFields } from '../repositories/supabase/supabase.students';
import type { Student } from '../core/entities/student';

beforeAll(() => {
  process.env['FIELD_ENCRYPTION_KEY'] = Buffer.alloc(32, 1).toString('base64');
  process.env['FIELD_ENCRYPTION_KEY_ID'] = 'k1';
});

function sampleStudent(): Student {
  return {
    id: 's_enc1',
    firstName: 'Ivy', lastName: 'Sample', gender: 'female',
    grade: 9, quad: 'g79',
    mobile: '0400000000', parentPhone: '0411111111',
    dateOfBirth: '2010-05-01',
    svcAttended: 3, svcTotal: 4, grpAttended: 2, grpTotal: 3, grpMetWeeks: 3,
    prevSvcAttended: 0, prevSvcTotal: 0, prevGrpAttended: 0, prevGrpTotal: 0,
    atRiskStatus: null, dataSource: 'csv',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function rowFor(s: Student, mobile: unknown, parentPhone: unknown): Record<string, unknown> {
  return {
    id: s.id, first_name: s.firstName, last_name: s.lastName, gender: s.gender,
    grade: s.grade, quad: s.quad,
    mobile, parent_phone: parentPhone,
    date_of_birth: s.dateOfBirth,
    svc_attended: s.svcAttended, svc_total: s.svcTotal,
    grp_attended: s.grpAttended, grp_total: s.grpTotal, grp_met_weeks: s.grpMetWeeks,
    prev_svc_attended: s.prevSvcAttended, prev_svc_total: s.prevSvcTotal,
    prev_grp_attended: s.prevGrpAttended, prev_grp_total: s.prevGrpTotal,
    at_risk_status: s.atRiskStatus, data_source: s.dataSource,
    created_at: new Date(s.createdAt), updated_at: new Date(s.updatedAt),
  };
}

describe('students mapper encryption', () => {
  it('encryptPhoneFields returns v1.-prefixed ciphertext for both fields', () => {
    const enc = encryptPhoneFields(sampleStudent());
    expect(String(enc.mobile).startsWith('v1.')).toBe(true);
    expect(String(enc.parent_phone).startsWith('v1.')).toBe(true);
  });

  it('round-trips through toStudent (ciphertext row -> plaintext entity)', () => {
    const s = sampleStudent();
    const enc = encryptPhoneFields(s);
    const row = rowFor(s, enc.mobile, enc.parent_phone);
    const back = toStudent(row);
    expect(back.mobile).toBe('0400000000');
    expect(back.parentPhone).toBe('0411111111');
  });

  it('preserves null (never stores ciphertext for a null phone)', () => {
    const s = { ...sampleStudent(), mobile: null, parentPhone: null };
    const enc = encryptPhoneFields(s);
    expect(enc.mobile).toBeNull();
    expect(enc.parent_phone).toBeNull();
    const row = rowFor(s, enc.mobile, enc.parent_phone);
    const back = toStudent(row);
    expect(back.mobile).toBeNull();
    expect(back.parentPhone).toBeNull();
  });

  it('reads legacy plaintext rows when not yet encrypted (rollout tolerance)', () => {
    const s = sampleStudent();
    const row = rowFor(s, '0400111222', '0400333444'); // plaintext, no v1. prefix
    const back = toStudent(row);
    expect(back.mobile).toBe('0400111222');
    expect(back.parentPhone).toBe('0400333444');
  });

  it('binds ciphertext to the student id (AAD) — same plaintext, different ciphertext', () => {
    const a = encryptPhoneFields({ id: 's_a', mobile: '0400000000', parentPhone: null });
    const b = encryptPhoneFields({ id: 's_b', mobile: '0400000000', parentPhone: null });
    expect(a.mobile).not.toBe(b.mobile);
  });
});
