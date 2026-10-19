import type { AuthedRequest } from '../http/types';
import type { LeaderService } from '../../services/leader.service';

export function makeLeaderController(deps: { leader: LeaderService }) {
  return {
    async list(req: AuthedRequest) {
      return deps.leader.list(req.ctx, { inactive: req.query['inactive'] === '1', pick: req.query['pick'] === '1' });
    },

    async get(req: AuthedRequest) {
      return deps.leader.get(req.ctx, req.params['id']!);
    },

    async create(req: AuthedRequest) {
      return deps.leader.create(req.ctx, req.body);
    },

    async update(req: AuthedRequest) {
      return deps.leader.update(req.ctx, req.params['id']!, req.body);
    },

    async remove(req: AuthedRequest) {
      await deps.leader.remove(req.ctx, req.params['id']!);
      return { ok: true };
    },

    async updateSmsTemplate(req: AuthedRequest) {
      const body = req.body as { smsTemplate?: unknown };
      return deps.leader.updateSmsTemplate(req.ctx, req.params['id']!, body?.smsTemplate ?? null);
    },

    async updateGrades(req: AuthedRequest) {
      const body = req.body as { grades?: unknown };
      return deps.leader.updateGrades(req.ctx, req.params['id']!, body?.grades ?? []);
    },

    // PATCH /leaders/:id/view-grades — body { grades: number[] | null }.
    async setViewGrades(req: AuthedRequest) {
      return deps.leader.setViewGrades(req.ctx, req.params['id']!, req.body);
    },
  };
}
