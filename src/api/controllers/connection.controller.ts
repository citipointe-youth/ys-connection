import type { AuthedRequest } from '../http/types';
import type { ConnectionService } from '../../services/connection.service';

export function makeConnectionController(deps: { connection: ConnectionService }) {
  return {
    async listAll(req: AuthedRequest) {
      const crossGrade = req.query['crossGrade'] === '1' || req.query['crossGrade'] === 'true';
      return deps.connection.listAll(req.ctx, { crossGrade });
    },

    async listByStudent(req: AuthedRequest) {
      return deps.connection.listByStudent(req.ctx, req.params['studentId']!);
    },

    async listByLeader(req: AuthedRequest) {
      return deps.connection.listByLeader(req.ctx, req.params['leaderId']!);
    },

    async assign(req: AuthedRequest) {
      return deps.connection.assign(req.ctx, req.body);
    },

    async unassign(req: AuthedRequest) {
      const { studentId, leaderId } = req.params;
      await deps.connection.unassign(req.ctx, studentId!, leaderId!);
      return { ok: true };
    },

    async leaderSummary(req: AuthedRequest) {
      return deps.connection.leaderSummary(req.ctx, req.params['leaderId']!);
    },

    async exportCsv(req: AuthedRequest) {
      const rows = await deps.connection.exportCsv(req.ctx);
      // Returned as structured rows (not a CSV string) — the SPA builds an .xlsx
      // workbook client-side, grouping rows by leader.
      return { rows, rowCount: rows.length };
    },

    async exportAllocations(req: AuthedRequest) {
      const rows = await deps.connection.exportAllocations(req.ctx);
      const header = 'First Name,Last Name,Grade,Gender,Leader';
      const lines = rows.map((r) =>
        [r.firstName, r.lastName, r.grade ?? '', r.gender, r.leader]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(','),
      );
      return { csv: [header, ...lines].join('\n'), rowCount: rows.length };
    },

    async importAllocations(req: AuthedRequest) {
      const body = req.body as { rows?: unknown; autoCreateLeaders?: unknown };
      return deps.connection.importAllocations(req.ctx, body?.rows, body?.autoCreateLeaders === true);
    },
  };
}
