// Elvanto link, leader + admin routes (spec 2026-10-12-elvanto-link-app-design.md §10.1). Thin: all logic in link.service.
import type { HttpRequest } from '../http/types';
import { StatusResponse } from '../http/types';
import type { ItemResult, LinkService } from '../../services/link.service';
import type { Actor } from '../../core/entities/user';
import { AppError, UnauthorizedError } from '../../core/errors/app-error';
import { LinkOpenDuplicate } from '../../core/errors/link-errors';

const actor = (r: HttpRequest): Actor => { if (!r.ctx) throw new UnauthorizedError(); return r.ctx; };
const device = (r: HttpRequest) => ({ id: r.headers?.deviceId ?? null, label: r.headers?.deviceLabel ?? null });

/** A single-route item result: 2xx → the result with its status; otherwise the usual error body. */
function single({ httpStatus, ...res }: ItemResult): StatusResponse {
  if (res.outcome === 'duplicate') throw new LinkOpenDuplicate(res.existingId ?? '');
  if (httpStatus >= 400) {
    throw new AppError(res.code ?? 'CONFLICT', res.message ?? 'Refused', httpStatus, res.reason ? { reason: res.reason } : undefined);
  }
  return new StatusResponse(httpStatus, res);
}

export function makeLinkController(deps: { link: LinkService }) {
  const L = deps.link;
  return {
    status: (r: HttpRequest) => L.status(actor(r)),
    checkin: (r: HttpRequest) => L.checkin(actor(r), r.query['serviceTime']),
    enqueue: async (r: HttpRequest) => single(await L.enqueue(actor(r), r.body, device(r))),
    listActions: (r: HttpRequest) => L.listActions(actor(r), r.query),
    cancel: async (r: HttpRequest) => single(await L.cancel(actor(r), r.params['id']!, r.query['leaderId'] ?? null, device(r))),
    batch: (r: HttpRequest) => L.batch(actor(r), r.body),
    lifegroups: (r: HttpRequest) => L.lifegroups(actor(r)),
    flows: (r: HttpRequest) => L.flows(actor(r)),
    roster: (r: HttpRequest) => L.rosterForMatching(actor(r), r.query),
    setMatch: (r: HttpRequest) => L.setMatch(actor(r), r.params['personId']!, r.body),
    shadowCheck: (r: HttpRequest) => L.shadowCheck(actor(r), r.query['date']),
    log: (r: HttpRequest) => L.log(actor(r), r.query),
  };
}
