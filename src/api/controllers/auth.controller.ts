import type { HttpRequest } from '../http/types';
import type { AuthService } from '../../services/auth.service';
import type { IUserRepository } from '../../repositories/interfaces/entity-repositories';
import { toSafeUser } from '../../services/auth.service';
import { UnauthorizedError } from '../../core/errors/app-error';

export function makeAuthController(deps: { auth: AuthService; users: IUserRepository }) {
  return {
    async login(req: HttpRequest) {
      return deps.auth.login(req.body);
    },

    async me(req: HttpRequest) {
      if (!req.ctx) throw new UnauthorizedError();
      const user = await deps.users.findById(req.ctx.id);
      if (!user) throw new UnauthorizedError();
      return toSafeUser(user);
    },

    async logout(req: HttpRequest) {
      const token = (req.body as any)?.token as string | undefined;
      if (token) await deps.auth.logout(token);
      return { ok: true };
    },
  };
}
