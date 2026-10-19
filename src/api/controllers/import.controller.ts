import type { AuthedRequest } from '../http/types';
import type { ImportService } from '../../services/import.service';
import { UnauthorizedError } from '../../core/errors/app-error';

export function makeImportController(deps: { importService: ImportService }) {
  return {
    async importCsv(req: AuthedRequest) {
      const body = req.body as { rows?: unknown[]; filename?: string };
      return deps.importService.importServiceCsv(
        req.ctx,
        body.rows ?? [],
        body.filename ?? 'upload.csv',
      );
    },

    async importGroupCsv(req: AuthedRequest) {
      const body = req.body as { groups?: unknown; filename?: string };
      return deps.importService.importGroupCsv(
        req.ctx,
        { groups: body.groups ?? [] },
        body.filename ?? 'upload.csv',
      );
    },

    async history(req: AuthedRequest) {
      return deps.importService.listHistory(req.ctx);
    },

    async deleteImport(req: AuthedRequest) {
      const id = req.params?.['id'];
      if (!id) throw new UnauthorizedError();
      await deps.importService.deleteImport(req.ctx, id);
      return { ok: true };
    },

    async clearHistory(req: AuthedRequest) {
      await deps.importService.clearHistory(req.ctx);
      return { ok: true };
    },
  };
}
