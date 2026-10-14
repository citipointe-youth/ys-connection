// Elvanto link, the console's routes (spec 2026-10-12-elvanto-link-app-design.md §10.1). The adapter has already checked
// the sync token (route.sync); there is no session. Thin, and never logs a body.
import type { HttpRequest } from '../http/types';
import type { SyncService } from '../../services/sync.service';

export function makeSyncController(deps: { sync: SyncService }) {
  const S = deps.sync;
  return {
    claim: (r: HttpRequest) => S.claim(r.body),
    result: (r: HttpRequest) => S.result(r.body),
    push: (r: HttpRequest) => S.push(r.params['kind']!, r.body),
    leaders: (r: HttpRequest) => S.leaders(r.body), // T8 (rev 5)
  };
}
