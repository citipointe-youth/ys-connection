import type { AuthedRequest } from '../http/types';
import type { AdminService } from '../../services/admin.service';
import type { ErrorLogService } from '../../services/error-log.service';
import type { ReconcileService } from '../../services/reconcile.service';

export function makeAdminController(deps: { admin: AdminService; errorLog: ErrorLogService; reconcile: Pick<ReconcileService, 'whoLatest' | 'resend'> }) {
  return {
    async reset(req: AuthedRequest) {
      const body = req.body as { force?: boolean; confirmWipe?: string } | undefined;
      await deps.admin.reset(req.ctx, { force: body?.force, confirmWipe: body?.confirmWipe });
      return { ok: true };
    },

    async clearServiceGroupData(req: AuthedRequest) {
      const body = req.body as { force?: boolean; confirmWipe?: string } | undefined;
      await deps.admin.clearServiceGroupData(req.ctx, { force: body?.force, confirmWipe: body?.confirmWipe });
      return { ok: true };
    },

    // ----- T3 Error log -----
    async errors(req: AuthedRequest) {
      return deps.errorLog.list(req.ctx);
    },
    async reconcileLatest(req: AuthedRequest) {
      return deps.reconcile.whoLatest(req.ctx);
    },
    async reconcileResend(req: AuthedRequest) { // r21 L6b (T9): Who? > Send again
      return deps.reconcile.resend(req.ctx, req.body);
    },
    async reportError(req: AuthedRequest) {
      return deps.errorLog.reportClient(req.ctx, req.body);
    },
    async setErrorFlags(req: AuthedRequest) {
      return deps.errorLog.setFlags(req.ctx, req.params['id']!, req.body);
    },
    async deleteError(req: AuthedRequest) {
      return deps.errorLog.remove(req.ctx, req.params['id']!);
    },
    async deleteErrors(req: AuthedRequest) {
      return deps.errorLog.removeAll(req.ctx, req.query['category'], req.query['tier']);
    },
  };
}
