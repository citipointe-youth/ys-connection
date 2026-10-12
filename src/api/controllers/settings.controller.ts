import type { HttpRequest } from '../http/types';
import type { SettingsService } from '../../services/settings.service';
import type { SetupService } from '../../services/setup.service';
import { UnauthorizedError } from '../../core/errors/app-error';

export function makeSettingsController(deps: { settings: SettingsService; setup?: SetupService }) {
  return {
    async get(req: HttpRequest) {
      return { ...(await deps.settings.get(req.ctx)), needsAdmin: deps.setup ? await deps.setup.needsAdmin() : false };
    },

    async update(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return deps.settings.update(req.ctx, req.body);
    },
  };
}
