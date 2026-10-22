import { describe, it, expect } from 'vitest';
import { upgradeSnapshot } from '../services/audit-upgrade';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
// A v1 snapshot as the old 6-slot upload stored it (connection-audit.ts AuditSnapshot).
const V1 = {
  generatedAt: '2026-06-21T00:00:00.000Z', dataStartDate: '2026-01-30', dataEndDate: '2026-06-12',
  terms: [{ key: '2026-T1', label: 'Term 1 2026', year: 2026, ordinal: 1, startDate: '2026-01-24', endDate: '2026-04-04' }],
  students: [{ id: 'u1', firstName: 'Alex', lastName: 'Sample', gender: 'male', grade: 9, quad: 'b79' }],
  perTerm: { '2026-T1': { key: '2026-T1', svcTotal: 10, inProgress: false, byStudent: { u1: { svcAttended: 8, grpAttended: 3, grpTotal: 4 } } } },
  lgStatsByTerm: { '2026-T1': [] },
  uploads: {
    team: [{ name: 'alex  SAMPLE' }],
    connect: [{ name: 'Alex Sample', date: '2026-03-01' }, { name: 'Alex Sample', date: '2026-02-01' },
      { name: 'Riley Sample', date: '2026-03-05', grade: 8, gender: 'female' }],
    decision: [{ name: 'Alex Sample', date: '2026-02-10' }, { name: 'Alex Sample', date: '2026-04-10' }],
    flows: [{ person: 'Alex Sample', step: 'Call', status: 'open' }],
  },
};

describe('upgradeSnapshot (spec 2026-10-22 §6.2)', () => {
  it('passes a v2 snapshot through unchanged', () => {
    const v2 = upgradeSnapshot(clone(V1));
    expect(upgradeSnapshot(v2)).toBe(v2);
    expect(v2.version).toBe(2);
  });
  it('joins team/connect/decision rows to students by the old norm(name) rule; earliest connect, latest decision', () => {
    const alex = upgradeSnapshot(clone(V1)).students.find((s) => s.id === 'u1')!;
    expect(alex).toEqual({ id: 'u1', personId: null, firstName: 'Alex', lastName: 'Sample', gender: 'male', grade: 9, quad: 'b79',
      caOnly: false, team: true, connect: '2026-02-01', decision: '2026-04-10', lastSeen: null, phone: null, phoneIsParent: false });
  });
  it('a name that matches no student becomes a caOnly student, quad from its own grade/gender', () => {
    const riley = upgradeSnapshot(clone(V1)).students.find((s) => s.caOnly)!;
    expect(riley).toMatchObject({ id: 'n:riley sample', firstName: 'Riley', lastName: 'Sample', grade: 8, gender: 'female',
      quad: 'g79', connect: '2026-03-05', decision: null, team: false });
  });
  it('the v2-only parts are empty: weekly, followUp, quadDrop, every source missing, quality; uploads (and flows) are gone', () => {
    const s = upgradeSnapshot(clone(V1));
    expect(s.weekly).toEqual([]);
    expect(s.followUp).toEqual({ drifting: [], decidedNoGroup: [], connectedNeverCame: [] });
    expect(s.signals).toEqual({ quadDrop: null });
    expect(Object.keys(s.sources).sort()).toEqual(['connect', 'decision', 'group', 'service', 'team']);
    for (const m of Object.values(s.sources)) expect(m).toEqual({ status: 'missing', fedBy: null, fedAt: null, exportedAt: null, rows: 0, lastFailedAt: null, lastFailReason: null });
    expect(s.quality).toEqual({ skipped: [], notes: [], unmatched: [], duplicates: [] });
    expect('uploads' in s).toBe(false);
  });
  it('keeps terms, perTerm and lgStatsByTerm as stored and never mutates the stored row', () => {
    const raw = clone(V1), before = JSON.stringify(raw);
    const s = upgradeSnapshot(raw);
    expect(JSON.stringify(raw)).toBe(before);
    expect(s.terms).toEqual(V1.terms);
    expect(s.perTerm).toEqual(V1.perTerm);
    expect(s.lgStatsByTerm).toEqual(V1.lgStatsByTerm);
  });
  it('a v1 snapshot with no uploads still upgrades', () => {
    const { uploads: _u, ...bare } = clone(V1);
    expect(upgradeSnapshot(bare).students).toHaveLength(1);
  });
});
