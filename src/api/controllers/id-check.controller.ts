import type { AuthedRequest } from '../http/types';
import type { IdCheckService } from '../../services/id-check.service';

// ID Checks (spec 2026-10-30 §7.5). Thin: the service does every check. Nothing here logs (privacy test).
export function makeIdCheckController(deps: { idCheck: IdCheckService }) {
  const s = deps.idCheck;
  return {
    list: (req: AuthedRequest) => s.list(req.ctx),
    leader: (req: AuthedRequest) => s.leader(req.ctx, req.params['id']!),
    upsert: (req: AuthedRequest) => s.upsert(req.ctx, req.params['id']!, req.body),
    async remove(req: AuthedRequest) { await s.remove(req.ctx, req.params['id']!); return { ok: true }; },
    grid: (req: AuthedRequest) => s.grid(req.ctx),
    async setAccess(req: AuthedRequest) { await s.setAccess(req.ctx, req.body); return { ok: true }; },
    archived: (req: AuthedRequest) => s.archived(req.ctx),
    archivedDelete: (req: AuthedRequest) => s.archivedDelete(req.ctx, req.body),
    archivedAttach: (req: AuthedRequest) => s.archivedAttach(req.ctx, req.body),
  };
}
