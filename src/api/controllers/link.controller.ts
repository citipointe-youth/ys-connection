// Elvanto link, leader + admin routes (spec 2026-10-12-elvanto-link-app-design.md §10.1). Thin: all logic in link.service.
// Writes go through /link/batch only (X14 / T-42: the single POST and DELETE /link/actions routes are gone).
import type { HttpRequest } from '../http/types';
import type { LinkService } from '../../services/link.service';
import type { Actor } from '../../core/entities/user';
import { UnauthorizedError } from '../../core/errors/app-error';

const actor = (r: HttpRequest): Actor => { if (!r.ctx) throw new UnauthorizedError(); return r.ctx; };

export function makeLinkController(deps: { link: LinkService }) {
  const L = deps.link;
  return {
    status: (r: HttpRequest) => L.status(actor(r)),
    checkin: (r: HttpRequest) => L.checkin(actor(r), r.query['serviceTime']),
    listActions: (r: HttpRequest) => L.listActions(actor(r), r.query),
    batch: (r: HttpRequest) => L.batch(actor(r), r.body),
    lifegroups: (r: HttpRequest) => L.lifegroups(actor(r)),
    flows: (r: HttpRequest) => L.flows(actor(r)),
    groupMembers: (r: HttpRequest) => L.groupMembers(actor(r), r.params['groupId']!, r.query),
    youth: (r: HttpRequest) => L.youth(actor(r)),
    assignFlow: (r: HttpRequest) => L.assignFlow(actor(r), r.body),
    roster: (r: HttpRequest) => L.rosterForMatching(actor(r), r.query),
    setMatch: (r: HttpRequest) => L.setMatch(actor(r), r.params['personId']!, r.body),
    shadowCheck: (r: HttpRequest) => L.shadowCheck(actor(r), r.query['date']),
    log: (r: HttpRequest) => L.log(actor(r), r.query),
  };
}
