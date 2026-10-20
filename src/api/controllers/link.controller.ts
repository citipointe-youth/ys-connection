// Elvanto link, leader + admin routes (spec 2026-10-12-elvanto-link-app-design.md §10.1). Thin: all logic in link.service.
// Writes go through /link/batch only (X14 / T-42: the single POST and DELETE /link/actions routes are gone).
import type { HttpRequest } from '../http/types';
import type { LinkService } from '../../services/link.service';
import type { IntakeService } from '../../services/link-intake.service';
import type { Actor } from '../../core/entities/user';
import { UnauthorizedError } from '../../core/errors/app-error';

const actor = (r: HttpRequest): Actor => { if (!r.ctx) throw new UnauthorizedError(); return r.ctx; };

export function makeLinkController(deps: { link: LinkService; intake?: IntakeService }) {
  const L = deps.link;
  const I = () => { if (!deps.intake) throw new UnauthorizedError(); return deps.intake; };
  return {
    // T4 (X19): admin Intakes + Consents
    intakeList: (r: HttpRequest) => I().list(actor(r), r.query),
    intakeRow: (r: HttpRequest) => I().row(actor(r), r.query),
    intakeRefresh: (r: HttpRequest) => I().refresh(actor(r), r.body),
    status: (r: HttpRequest) => L.status(actor(r)),
    checkin: (r: HttpRequest) => L.checkin(actor(r), r.query['serviceTime']),
    listActions: (r: HttpRequest) => L.listActions(actor(r), r.query),
    batch: (r: HttpRequest) => L.batch(actor(r), r.body),
    lifegroups: (r: HttpRequest) => L.lifegroups(actor(r)),
    flows: (r: HttpRequest) => L.flows(actor(r)),
    consentLookup: (r: HttpRequest) => L.consentLookup(actor(r), r.query), // rev 6 (R2 b/c)
    groupMembers: (r: HttpRequest) => L.groupMembers(actor(r), r.params['groupId']!, r.query),
    youth: (r: HttpRequest) => L.youth(actor(r), r.query),
    assignFlow: (r: HttpRequest) => L.assignFlow(actor(r), r.body),
    roster: (r: HttpRequest) => L.rosterForMatching(actor(r), r.query),
    setMatch: (r: HttpRequest) => L.setMatch(actor(r), r.params['personId']!, r.body),
    createStudents: (r: HttpRequest) => L.createStudents(actor(r), r.body),
    resolveUnclear: (r: HttpRequest) => L.resolveUnclear(actor(r), r.params['id']!, r.body), // CY-A1
    recheckUnclear: (r: HttpRequest) => L.recheckUnclear(actor(r), r.params['id']!), // L7
    recheckState: (r: HttpRequest) => L.recheckState(actor(r), r.params['id']!), // L7
    log: (r: HttpRequest) => L.log(actor(r), r.query),
  };
}
