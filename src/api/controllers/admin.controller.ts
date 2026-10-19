import type { HttpRequest } from '../http/types';
import type { AdminService } from '../../services/admin.service';
import type { ErrorLogService } from '../../services/error-log.service';
import type { ReconcileService } from '../../services/reconcile.service';
import { UnauthorizedError } from '../../core/errors/app-error';

export function makeAdminController(deps: { admin: AdminService; errorLog: ErrorLogService; reconcile: Pick<ReconcileService, 'whoLatest'> }) {
  return {
    async reset(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const body = req.body as { force?: boolean; confirmWipe?: string } | undefined;
      await deps.admin.reset(req.ctx, { force: body?.force, confirmWipe: body?.confirmWipe });
      return { ok: true };
    },

    async clearServiceGroupData(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const body = req.body as { force?: boolean; confirmWipe?: string } | undefined;
      await deps.admin.clearServiceGroupData(req.ctx, { force: body?.force, confirmWipe: body?.confirmWipe });
      return { ok: true };
    },

    // ----- T3 Error log -----
    async errors(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return deps.errorLog.list(req.ctx);
    },
    async reconcileLatest(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return deps.reconcile.whoLatest(req.ctx);
    },
    async reportError(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return deps.errorLog.reportClient(req.ctx, req.body);
    },
    async setErrorFlags(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return deps.errorLog.setFlags(req.ctx, req.params['id']!, req.body);
    },
    async deleteError(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return deps.errorLog.remove(req.ctx, req.params['id']!);
    },
    async deleteErrors(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return deps.errorLog.removeAll(req.ctx, req.query['category'], req.query['tier']);
    },
  };
}
