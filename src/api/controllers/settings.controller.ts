import type { HttpRequest } from '../http/types';
import type { SettingsService } from '../../services/settings.service';
import { UnauthorizedError } from '../../core/errors/app-error';

export function makeSettingsController(deps: { settings: SettingsService }) {
  return {
    async get(_req: HttpRequest) {
      return deps.settings.get();
    },

    async update(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      return deps.settings.update(req.ctx, req.body);
    },
  };
}
