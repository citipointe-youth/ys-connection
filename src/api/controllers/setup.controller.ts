import type { HttpRequest } from '../http/types';
import type { SetupService } from '../../services/setup.service';
import { can } from '../../services/access-control';
import { ForbiddenError, UnauthorizedError, TooManyRequestsError, BadRequestError } from '../../core/errors/app-error';
import { googleConfigFromEnv, googleConfigStatus, googleStatusText } from '../../services/routing/google-config';
import { checkGoogleConnection } from '../../services/routing/google-check';

let lastGoogleCheck = 0; // per instance: at most once per 10 s

export function makeSetupController(deps: { setup: SetupService }) {
  return {
    status: (r: HttpRequest) => deps.setup.status(r.ctx, r.origin),
    createAdmin: (r: HttpRequest) => deps.setup.createFirstAdmin(r.body),
    async googleCheck(r: HttpRequest) {
      if (!r.ctx) throw new UnauthorizedError();
      if (!can(r.ctx, 'admin:manage')) throw new ForbiddenError();
      if (Date.now() - lastGoogleCheck < 10_000) throw new TooManyRequestsError('Wait 10 seconds. Then test again.');
      lastGoogleCheck = Date.now();
      const cfg = googleConfigFromEnv();
      if (!cfg) throw new BadRequestError(googleStatusText(googleConfigStatus()));
      return { rows: await checkGoogleConnection(cfg) };
    },
  };
}
