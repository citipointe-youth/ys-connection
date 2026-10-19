import type { AuthedRequest } from '../http/types';
import type { ConnectionAuditService } from '../../services/connection-audit.service';
import { BadRequestError } from '../../core/errors/app-error';

export function makeConnectionAuditController(deps: { connectionAudit: ConnectionAuditService }) {
  return {
    async upload(req: AuthedRequest) {
      return deps.connectionAudit.upload(req.ctx, req.body);
    },
    async list(req: AuthedRequest) {
      return deps.connectionAudit.list(req.ctx);
    },
    async get(req: AuthedRequest) {
      const year = Number(req.params?.['year']);
      if (!Number.isInteger(year)) throw new BadRequestError('Invalid year');
      return deps.connectionAudit.get(req.ctx, year);
    },
    async remove(req: AuthedRequest) {
      const year = Number(req.params?.['year']);
      if (!Number.isInteger(year)) throw new BadRequestError('Invalid year');
      await deps.connectionAudit.remove(req.ctx, year);
      return { ok: true };
    },
    async exportAll(req: AuthedRequest) {
      return deps.connectionAudit.exportAll(req.ctx);
    },
    async importAll(req: AuthedRequest) {
      return deps.connectionAudit.importAll(req.ctx, req.body);
    },
  };
}
