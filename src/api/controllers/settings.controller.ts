import type { HttpRequest, AuthedRequest } from '../http/types';
import type { SettingsService } from '../../services/settings.service';
import type { SetupService } from '../../services/setup.service';

export function makeSettingsController(deps: { settings: SettingsService; setup?: SetupService }) {
  return {
    async get(_req: HttpRequest) {
      return { ...(await deps.settings.get()), needsAdmin: deps.setup ? await deps.setup.needsAdmin() : false };
    },

    async update(req: AuthedRequest) {
      return deps.settings.update(req.ctx, req.body);
    },
  };
}
