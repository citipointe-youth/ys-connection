// Past years (spec ys-connection/2026-10-22-connection-audit §6.2): a stored v1 snapshot is read as v2. The stored row
// is never rewritten; an admin rebuilds a past year with "Upload manually" and a date in that year.
import { computeQuad, type Quad } from '../core/types/enums';
import { AUDIT_SOURCES } from '../core/link-contract';
import type { AuditSnapshot, AuditSnapshotV2, AuditSource, AuditStudent, SourceMeta } from '../core/entities/connection-audit';

const norm = (n: unknown) => String(n ?? '').toLowerCase().replace(/\s+/g, ' ').trim(); // the v1 SPA rule (index.html:8622)
const genderOf = (g: unknown): 'male' | 'female' | null => { const s = norm(g); return s === 'f' || s === 'female' ? 'female' : s === 'm' || s === 'male' ? 'male' : null; };
const MISSING: SourceMeta = { status: 'missing', fedBy: null, fedAt: null, exportedAt: null, rows: 0, lastFailedAt: null, lastFailReason: null };
type V1Row = { name?: unknown; date?: unknown; grade?: unknown; gender?: unknown };

export function upgradeSnapshot(snap: unknown): AuditSnapshotV2 {
  if ((snap as { version?: unknown }).version === 2) return snap as AuditSnapshotV2;
  const v1 = snap as AuditSnapshot;
  const students: AuditStudent[] = v1.students.map((s) => ({ ...s, quad: s.quad as Quad | null, personId: null, caOnly: false,
    team: false, connect: null, decision: null, lastSeen: null, phone: null, phoneIsParent: false }));
  const byName = new Map(students.map((s) => [norm(`${s.firstName} ${s.lastName}`), s]));
  // ponytail: a caOnly person's grade/gender come from their first row only (v1 took the first non-empty one)
  const find = (r: V1Row): AuditStudent | null => {
    const k = norm(r.name);
    if (!k) return null;
    let s = byName.get(k);
    if (!s) {
      const parts = String(r.name).trim().split(/\s+/), gender = genderOf(r.gender);
      const grade = typeof r.grade === 'number' ? r.grade : null;
      s = { id: `n:${k}`, personId: null, firstName: parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0]!,
        lastName: parts.length > 1 ? parts.at(-1)! : '', gender: gender ?? 'other', grade, quad: gender ? computeQuad(grade, gender) : null,
        caOnly: true, team: false, connect: null, decision: null, lastSeen: null, phone: null, phoneIsParent: false };
      byName.set(k, s);
      students.push(s);
    }
    return s;
  };
  const day = (d: unknown) => (typeof d === 'string' && d ? d : null);
  for (const r of (v1.uploads?.team ?? []) as V1Row[]) { const s = find(r); if (s) s.team = true; }
  for (const r of (v1.uploads?.connect ?? []) as V1Row[]) {
    const s = find(r), d = day(r.date);
    if (s && d && (!s.connect || d < s.connect)) s.connect = d;
  }
  for (const r of (v1.uploads?.decision ?? []) as V1Row[]) {
    const s = find(r), d = day(r.date);
    if (s && d && (!s.decision || d > s.decision)) s.decision = d;
  }
  return {
    version: 2, generatedAt: v1.generatedAt, dataStartDate: v1.dataStartDate, dataEndDate: v1.dataEndDate,
    terms: v1.terms, students, perTerm: v1.perTerm, lgStatsByTerm: v1.lgStatsByTerm ?? {},
    weekly: [], followUp: { drifting: [], decidedNoGroup: [], connectedNeverCame: [] }, signals: { quadDrop: null },
    sources: Object.fromEntries(AUDIT_SOURCES.map((k) => [k, { ...MISSING }])) as Record<AuditSource, SourceMeta>,
    quality: { skipped: [], notes: [], unmatched: [], duplicates: [] },
  };
}
