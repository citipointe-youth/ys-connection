import type { HttpRequest } from '../http/types';
import type { AtRiskService } from '../../services/atrisk.service';
import type { ImportService } from '../../services/import.service';
import { UnauthorizedError } from '../../core/errors/app-error';

export function makeAtRiskController(deps: {
  atRisk: AtRiskService;
  importService: ImportService;
}) {
  return {
    async list(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const grade = req.query['grade'] ? parseInt(req.query['grade']!, 10) : undefined;
      const gender = req.query['gender'];
      return deps.atRisk.list(req.ctx, { grade, gender });
    },

    async recompute(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return deps.atRisk.recompute(req.ctx);
    },
  };
}
