import { assertCan, canAccessGrade, canAccessGender } from './access-control';
import type {
  IStudentRepository,
  IServiceSessionRepository,
  IServiceAttendanceRepository,
  ISettingsRepository,
} from '../repositories/interfaces/entity-repositories';
import type { Actor } from '../core/entities/user';
import type { Quad } from '../core/types/enums';
import { QUADS, QUAD_LABELS } from '../core/types/enums';

export interface SessionPoint {
  sessionId: string;
  sessionDate: string;
  sessionName: string;
  totalAttended: number;
  totalPresent: number;
  isOutlier: boolean;  // attendance < validThresholdPct% of recent average
}

export interface QuadTrend {
  quad: Quad;
  label: string;
  sessions: SessionPoint[];
  averageAttendance: number;
}

export interface GradeTrend {
  grade: number;
  sessions: SessionPoint[];
  averageAttendance: number;
}

export interface MinistryTrend {
  sessions: SessionPoint[];
  averageAttendance: number;
  peakAttendance: number;
  peakDate: string;
  recentTrend: 'up' | 'down' | 'stable';
}

export interface TrendsData {
  ministry: MinistryTrend;
  byQuad: QuadTrend[];
  byGrade: GradeTrend[];
  // Aggregated group attendance trend (derived from student grp fields, not session-level)
  groupSummary: {
    totalStudentsWithGroupData: number;
    avgGroupAttendance: number;
    studentsIncreasing: number;
    studentsDecreasing: number;
    studentsStable: number;
  };
  generatedAt: string;
}

export interface TrendsService {
  get(actor: Actor): Promise<TrendsData>;
}

function recentTrend(sessions: SessionPoint[]): 'up' | 'down' | 'stable' {
  const valid = sessions.filter((s) => !s.isOutlier);
  if (valid.length < 4) return 'stable';
  const half = Math.floor(valid.length / 2);
  const older = valid.slice(0, half);
  const newer = valid.slice(-half);
  const avgOlder = older.reduce((sum, s) => sum + s.totalAttended, 0) / older.length;
  const avgNewer = newer.reduce((sum, s) => sum + s.totalAttended, 0) / newer.length;
  const delta = (avgNewer - avgOlder) / Math.max(avgOlder, 1);
  if (delta > 0.05) return 'up';
  if (delta < -0.05) return 'down';
  return 'stable';
}

function markOutliers(points: { totalAttended: number }[], thresholdPct: number): boolean[] {
  if (points.length < 3) return points.map(() => false);
  // Compute rolling average of all points, then flag those below threshold% of the average
  const avg = points.reduce((sum, p) => sum + p.totalAttended, 0) / points.length;
  const threshold = avg * (thresholdPct / 100);
  return points.map((p) => p.totalAttended < threshold);
}

export function makeTrendsService(
  studentRepo: IStudentRepository,
  sessionRepo: IServiceSessionRepository,
  attendanceRepo: IServiceAttendanceRepository,
  settingsRepo: ISettingsRepository,
): TrendsService {
  return {
    async get(actor) {
      assertCan(actor, 'overview:read');

      const settings = await settingsRepo.getSettings();
      const thresholdPct = settings.validThresholdPct;

      const allStudents = await studentRepo.findAll();
      const allSessions = await sessionRepo.findAll();
      const allAttendance = await attendanceRepo.findAll();

      // Scope students to actor
      const scopedStudents = allStudents.filter((s) => {
        if (actor.role === 'grade') return s.grade === actor.grade;
        if (actor.role === 'quad') {
          return canAccessGrade(actor, s.grade) && canAccessGender(actor, s.gender);
        }
        return true;
      });

      const scopedIds = new Set(scopedStudents.map((s) => s.id));

      // Sort sessions chronologically
      const sortedSessions = [...allSessions].sort(
        (a, b) => a.sessionDate.localeCompare(b.sessionDate),
      );

      // Build attendance index: sessionId -> Set<studentId>
      const attendedBySession = new Map<string, Set<string>>();
      for (const rec of allAttendance) {
        if (!rec.attended) continue;
        if (!attendedBySession.has(rec.sessionId)) attendedBySession.set(rec.sessionId, new Set());
        attendedBySession.get(rec.sessionId)!.add(rec.studentId);
      }

      // ── Ministry-level trend ──
      const ministryPoints = sortedSessions.map((sess) => {
        const attendedSet = attendedBySession.get(sess.id) ?? new Set<string>();
        const totalAttended = [...attendedSet].filter((id) => scopedIds.has(id)).length;
        return { sessionId: sess.id, sessionDate: sess.sessionDate, sessionName: sess.sessionName, totalAttended, totalPresent: scopedStudents.length, isOutlier: false };
      });

      const outlierFlags = markOutliers(ministryPoints, thresholdPct);
      const ministryWithOutliers: SessionPoint[] = ministryPoints.map((p, i) => ({ ...p, isOutlier: outlierFlags[i] ?? false }));

      const validMinistry = ministryWithOutliers.filter((p) => !p.isOutlier);
      const avgMinistry = validMinistry.length > 0
        ? Math.round(validMinistry.reduce((s, p) => s + p.totalAttended, 0) / validMinistry.length)
        : 0;
      const peakPoint = validMinistry.reduce((max, p) => p.totalAttended > (max?.totalAttended ?? 0) ? p : max, validMinistry[0]);

      const ministry: MinistryTrend = {
        sessions: ministryWithOutliers,
        averageAttendance: avgMinistry,
        peakAttendance: peakPoint?.totalAttended ?? 0,
        peakDate: peakPoint?.sessionDate ?? '',
        recentTrend: recentTrend(ministryWithOutliers),
      };

      // ── Per-quad trend ──
      const byQuad: QuadTrend[] = QUADS.map((quad) => {
        const quadStudentIds = new Set(
          scopedStudents.filter((s) => s.quad === quad).map((s) => s.id),
        );
        const quadPoints = sortedSessions.map((sess) => {
          const attendedSet = attendedBySession.get(sess.id) ?? new Set<string>();
          const totalAttended = [...attendedSet].filter((id) => quadStudentIds.has(id)).length;
          return { sessionId: sess.id, sessionDate: sess.sessionDate, sessionName: sess.sessionName, totalAttended, totalPresent: quadStudentIds.size, isOutlier: false };
        });
        const flags = markOutliers(quadPoints, thresholdPct);
        const withOutliers: SessionPoint[] = quadPoints.map((p, i) => ({ ...p, isOutlier: flags[i] ?? false }));
        const valid = withOutliers.filter((p) => !p.isOutlier);
        const avg = valid.length > 0 ? Math.round(valid.reduce((s, p) => s + p.totalAttended, 0) / valid.length) : 0;
        return { quad, label: QUAD_LABELS[quad], sessions: withOutliers, averageAttendance: avg };
      });

      // ── Per-grade trend ──
      const byGrade: GradeTrend[] = [7, 8, 9, 10, 11, 12].map((grade) => {
        const gradeStudentIds = new Set(
          scopedStudents.filter((s) => s.grade === grade).map((s) => s.id),
        );
        const gradePoints = sortedSessions.map((sess) => {
          const attendedSet = attendedBySession.get(sess.id) ?? new Set<string>();
          const totalAttended = [...attendedSet].filter((id) => gradeStudentIds.has(id)).length;
          return { sessionId: sess.id, sessionDate: sess.sessionDate, sessionName: sess.sessionName, totalAttended, totalPresent: gradeStudentIds.size, isOutlier: false };
        });
        const flags = markOutliers(gradePoints, thresholdPct);
        const withOutliers: SessionPoint[] = gradePoints.map((p, i) => ({ ...p, isOutlier: flags[i] ?? false }));
        const valid = withOutliers.filter((p) => !p.isOutlier);
        const avg = valid.length > 0 ? Math.round(valid.reduce((s, p) => s + p.totalAttended, 0) / valid.length) : 0;
        return { grade, sessions: withOutliers, averageAttendance: avg };
      });

      // ── Group attendance summary (derived from student aggregate fields) ──
      // We don't have session-level group data yet, so compute summary from student totals.
      const withGroupData = scopedStudents.filter((s) => s.grpTotal > 0);
      const avgGroupPct = withGroupData.length > 0
        ? withGroupData.reduce((sum, s) => sum + (s.grpAttended / s.grpTotal), 0) / withGroupData.length
        : 0;

      // Classify each student's group trend vs prev term
      let increasing = 0, decreasing = 0, stable = 0;
      for (const s of withGroupData) {
        const currRate = s.grpTotal > 0 ? s.grpAttended / s.grpTotal : 0;
        const prevRate = s.prevGrpTotal > 0 ? s.prevGrpAttended / s.prevGrpTotal : null;
        if (prevRate === null) { stable++; continue; }
        const delta = currRate - prevRate;
        if (delta > 0.05) increasing++;
        else if (delta < -0.05) decreasing++;
        else stable++;
      }

      return {
        ministry,
        byQuad,
        byGrade,
        groupSummary: {
          totalStudentsWithGroupData: withGroupData.length,
          avgGroupAttendance: Math.round(avgGroupPct * 100),
          studentsIncreasing: increasing,
          studentsDecreasing: decreasing,
          studentsStable: stable,
        },
        generatedAt: new Date().toISOString(),
      };
    },
  };
}
