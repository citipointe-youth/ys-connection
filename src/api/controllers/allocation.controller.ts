import type { HttpRequest } from '../http/types';
import type { AllocationService } from '../../services/allocation.service';
import { UnauthorizedError } from '../../core/errors/app-error';

export function makeAllocationController(deps: { allocation: AllocationService }) {
  return {
    async listAll(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return deps.allocation.listAll(req.ctx);
    },

    async listByStudent(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return deps.allocation.listByStudent(req.ctx, req.params['studentId']!);
    },

    async listByLeader(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return deps.allocation.listByLeader(req.ctx, req.params['leaderId']!);
    },

    async assign(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return deps.allocation.assign(req.ctx, req.body);
    },

    async unassign(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const { studentId, leaderId } = req.params;
      await deps.allocation.unassign(req.ctx, studentId!, leaderId!);
      return { ok: true };
    },

    async leaderSummary(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return deps.allocation.leaderSummary(req.ctx, req.params['leaderId']!);
    },

    async exportCsv(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const rows = await deps.allocation.exportCsv(req.ctx);
      // Return as CSV string
      const header = 'Leader,Leader Gender,Leader Grades,Student,Grade,Gender,Svc Attended,Svc Total,Svc %,At Risk';
      const lines = rows.map((r) =>
        [r.leaderName, r.leaderGender ?? '', r.leaderGrades, r.studentName, r.studentGrade ?? '', r.studentGender, r.svcAttended, r.svcTotal, r.svcPct, r.atRiskStatus ?? '']
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(','),
      );
      return { csv: [header, ...lines].join('\n'), rowCount: rows.length };
    },
  };
}
