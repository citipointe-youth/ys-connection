import type { AuthedRequest } from '../http/types';
import type { AtRiskService } from '../../services/atrisk.service';
import type { ImportService } from '../../services/import.service';

export function makeAtRiskController(deps: {
  atRisk: AtRiskService;
  importService: ImportService;
}) {
  return {
    async list(req: AuthedRequest) {
      const grade = req.query['grade'] ? parseInt(req.query['grade']!, 10) : undefined;
      const gender = req.query['gender'];
      return deps.atRisk.list(req.ctx, { grade, gender });
    },
  };
}
