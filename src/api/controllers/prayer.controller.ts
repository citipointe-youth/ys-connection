import type { AuthedRequest } from '../http/types';
import type { PrayerService } from '../../services/prayer.service';

export function makePrayerController(deps: { prayer: PrayerService }) {
  return {
    async list(req: AuthedRequest) {
      return deps.prayer.list(req.ctx);
    },
    async create(req: AuthedRequest) {
      return deps.prayer.create(req.ctx, req.body);
    },
    async update(req: AuthedRequest) {
      return deps.prayer.update(req.ctx, req.params['id']!, req.body);
    },
    async setStatus(req: AuthedRequest) {
      return deps.prayer.setStatus(req.ctx, req.params['id']!, req.body);
    },
    async remove(req: AuthedRequest) {
      await deps.prayer.remove(req.ctx, req.params['id']!);
      return { ok: true };
    },
    async exportCsv(req: AuthedRequest) {
      return deps.prayer.exportCsv(req.ctx);
    },
    async importCsv(req: AuthedRequest) {
      const body = req.body as { rows?: unknown };
      return deps.prayer.importCsv(req.ctx, body?.rows ?? []);
    },
  };
}
