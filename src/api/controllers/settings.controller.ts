import type { HttpRequest, AuthedRequest } from '../http/types';
import type { SettingsService } from '../../services/settings.service';
import type { SetupService } from '../../services/setup.service';
import { gradeBands } from '../../core/types/enums';

export function makeSettingsController(deps: { settings: SettingsService; setup?: SetupService }) {
  return {
    async get(_req: HttpRequest) {
      const s = await deps.settings.get();
      // Console contract (additive): the Junior/Senior grades, from the one helper.
      return { ...s, gradeBands: gradeBands(s.ministryConfig?.structure), needsAdmin: deps.setup ? await deps.setup.needsAdmin() : false };
    },

    async update(req: AuthedRequest) {
      return deps.settings.update(req.ctx, req.body);
    },

    async elvantoCheck(req: AuthedRequest) {
      return deps.settings.elvantoCheck(req.ctx, req.body);
    },
  };
}
