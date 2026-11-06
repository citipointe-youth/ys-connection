// Elvanto link, the console's routes (spec 2026-10-12-elvanto-link-app-design.md §10.1). The adapter has already checked
// the sync token (route.sync); there is no session. Thin, and never logs a body.
import type { HttpRequest } from '../http/types';
import type { SyncService } from '../../services/sync.service';
import type { ReconcileService } from '../../services/reconcile.service';
import type { NightSummaryService } from '../../services/night-summary.service';
import type { AlertRun } from '../../services/alert-run.service';
import { parseBody } from '../../services/sync.service';
import { LeadersRequest } from '../../core/link-contract';

export function makeSyncController(deps: { sync: SyncService; reconcile: Pick<ReconcileService, 'latest'>; nightSummary: NightSummaryService;
  alerts: AlertRun }) {
  const S = deps.sync;
  return {
    claim: (r: HttpRequest) => S.claim(r.body),
    result: (r: HttpRequest) => S.result(r.body),
    push: (r: HttpRequest) => S.push(r.params['kind']!, r.body),
    leaders: (r: HttpRequest) => S.leaders(r.body), // T8 (rev 5)
    reconcileLatest: (r: HttpRequest) => deps.reconcile.latest(r.body),
    nightSummary: (r: HttpRequest) => deps.nightSummary.get(r.body), // Friday night check: read only, counts only
    // F4 leader alerts: the console's 15-min trigger runs every kind. Body is { contractVersion, consoleId } (same shape as /sync/leaders).
    // Never ModuleDisabledError and not gated on liveLink: an off module is a 200 with skipped: 'module-off'.
    alerts: async (r: HttpRequest) => { parseBody(LeadersRequest, r.body); return deps.alerts.run(new Date(), ['bday', 'lgrem']); },
    // The Vercel cron catch-up (cron secret, checked in the adapter): birthdays only (Hobby is daily).
    alertsCron: () => deps.alerts.run(new Date(), ['bday']),
  };
}
