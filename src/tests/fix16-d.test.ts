// Fix round 16 Oct 2026, lane D: contract C-1 (LINK_REV 7), link-errors wording, the hurry hint.
import { describe, it, expect } from 'vitest';
import * as C from '../core/link-contract';
import { applyOutcome } from '../services/link-rules';

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('C-1: LINK_REV 7, optional linked + note', () => {
  it('LINK_REV is 7; the contract version stays 1', () => {
    expect(C.LINK_REV).toBe(7);
    expect(C.LINK_CONTRACT_VERSION).toBe(1);
  });
  it('a sent result may carry note sent|failed; anything else is refused; missing still parses', () => {
    const base = { id: u(1), outcome: 'sent', sentLogKey: 'k' };
    expect(C.ResultItem.parse(base)).not.toHaveProperty('note');
    expect((C.ResultItem.parse({ ...base, note: 'failed' }) as any).note).toBe('failed');
    expect(C.ResultItem.safeParse({ ...base, note: 'maybe' }).success).toBe(false);
  });
  it('a mismatch row may carry linked', () => {
    const side = { consentDate: '1/1/2026', total: '', optOuts: [] };
    const row = { subId: u(2), personId: u(3), name: 'A B', submitted: '2026-10-01', diffs: ['opt-outs'], form: side, profile: side };
    expect(C.ConsentMismatchRow.parse(row)).not.toHaveProperty('linked');
    expect(C.ConsentMismatchRow.parse({ ...row, linked: true }).linked).toBe(true);
  });
  it('note failed is kept on the row as NOTE_FAILED_DETAIL; note sent / none keeps detail null', () => {
    const row = { id: u(1), status: 'claimed', leaseOwner: u(9), reportId: null, personId: null } as any;
    const now = new Date('2026-10-16T09:00:00Z');
    const r1 = applyOutcome(row, { id: u(1), outcome: 'sent', sentLogKey: 'k', note: 'failed' } as any, u(9), now) as any;
    expect(r1.next.status).toBe('sent');
    expect(r1.next.detail).toBe(C.NOTE_FAILED_DETAIL);
    const r2 = applyOutcome(row, { id: u(1), outcome: 'sent', sentLogKey: 'k', note: 'sent' } as any, u(9), now) as any;
    expect(r2.next.detail).toBeNull();
  });
});
