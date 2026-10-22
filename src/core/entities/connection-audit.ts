import type { ID, ISODateString } from '../types/common';
import type { LabeledTerm } from '../../services/year-terms';
import type { AuditLgStat } from '../../services/attendance-build';
import type { Quad } from '../types/enums';
import type { AUDIT_SOURCES } from '../link-contract';

// One CRM-upload overlay row (Student Team / Connect / Decision / People Flow).
// Stored verbatim and rendered client-side. Team/Connect/Decision use {name,date};
// People Flow uses {person,step,status,entered,days,admin} — hence the open shape.
export interface AuditUploadRow { name?: string; date?: string | null; [key: string]: unknown; }

export interface AuditStudentRow {
  id: string;
  firstName: string;
  lastName: string;
  gender: 'male' | 'female' | 'other';
  grade: number | null;
  quad: string | null;
}

// Per-term frozen figures for one term.
export interface AuditTermSnapshot {
  key: string;            // matches LabeledTerm.key
  svcTotal: number;       // valid services in the term
  inProgress: boolean;    // true for the latest term of a mid-term (YTD) upload
  // studentId -> attendance in this term
  byStudent: Record<string, { svcAttended: number; grpAttended: number; grpTotal: number }>;
}

export interface AuditSnapshot {
  generatedAt: ISODateString;
  dataStartDate: string | null; // earliest valid service date in the upload
  dataEndDate: string | null;   // latest valid service date in the upload
  terms: LabeledTerm[];
  students: AuditStudentRow[];
  perTerm: Record<string, AuditTermSnapshot>;
  // Per-named-lifegroup stats keyed by term — powers the Lifegroup Health tab.
  lgStatsByTerm: Record<string, AuditLgStat[]>;
  uploads: {
    team: AuditUploadRow[];
    connect: AuditUploadRow[];
    decision: AuditUploadRow[];
    flows: AuditUploadRow[];
  };
}

export interface ConnectionAudit {
  id: ID;          // we use the year string as the id, e.g. "2026" — one row per year
  year: number;
  label: string;   // e.g. "2026 (year-to-date)"
  uploadedBy: string;
  uploadedAt: ISODateString;
  snapshot: AuditSnapshot | AuditSnapshotV2; // v1 rows stay until that year is re-fed (read through upgradeSnapshot)
}

// ---- v2 (spec ys-connection/2026-10-22-connection-audit §5.4, §5.5, §9)
export type AuditSource = (typeof AUDIT_SOURCES)[number];
export type AuditFailReason = 'read' | 'timeout' | 'budget' | 'empty' | 'shape';
export interface SourceMeta {
  status: 'ok' | 'failed' | 'missing'; fedBy: 'console' | 'manual' | null;
  fedAt: string | null;      // when YS stored the last GOOD copy
  exportedAt: string | null; // of that good copy
  rows: number; lastFailedAt: string | null; lastFailReason: AuditFailReason | null;
}
export interface AuditTable { headers: string[]; rows: string[][] }
/** One connection_audit_sources row (0043): the pushed table itself, never parsed rows. */
export interface StoredAuditSource {
  year: number; source: AuditSource; headers: string[]; rows: string[][]; rowCount: number;
  takenAt: string; exportedAt: string; fedAt: string | null; fedBy: 'console' | 'manual' | null;
  lastFailedAt: string | null; lastFailReason: AuditFailReason | null;
}
export interface AuditStudent {
  id: string; personId: string | null; firstName: string; lastName: string;
  gender: 'male' | 'female' | 'other'; grade: number | null; quad: Quad | null; caOnly: boolean;
  team: boolean; connect: string | null; decision: string | null; lastSeen: string | null;
  phone: string | null; phoneIsParent: boolean;
}
export interface AuditWeekCounts { youth: number | null /* null = no valid session */; lifegroup: number; lgGroups: number; connects: number; decisions: number }
export interface AuditWeek extends AuditWeekCounts { weekEnd: string; byQuad: Record<Quad | 'none', AuditWeekCounts> }
export interface AuditQuality {
  skipped: { source: AuditSource; reason: 'no-name' | 'bad-date'; name: string | null; count: number }[];   // grouped, <= 500
  notes: { source: AuditSource; note: 'no-gender-column' | 'bad-date-column' | 'grade-out-of-range'; count: number }[];
  unmatched: { id: string; name: string; sources: AuditSource[]; grade: number | null; ambiguous: boolean }[]; // <= 500
  duplicates: { a: string; b: string; why: 'short-name' | 'matched-and-unmatched' }[];                         // <= 200
}
export interface AuditSnapshotV2 {
  version: 2; generatedAt: string; dataStartDate: string | null; dataEndDate: string | null;
  terms: LabeledTerm[];
  students: AuditStudent[];
  perTerm: Record<string, AuditTermSnapshot>;           // unchanged shape, fixed inProgress
  lgStatsByTerm: Record<string, AuditLgStat[]>;         // unchanged
  weekly: AuditWeek[];
  followUp: { drifting: string[]; decidedNoGroup: string[]; connectedNeverCame: string[] };
  signals: { quadDrop: { quad: Quad; recentAvg: number; termAvg: number; dropPct: number } | null };
  sources: Record<AuditSource, SourceMeta>;
  quality: AuditQuality;
}
