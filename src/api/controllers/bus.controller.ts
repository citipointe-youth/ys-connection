import type { HttpRequest } from '../http/types';
import { RawResponse } from '../http/types';
import type { BusService, BusCtx } from '../../services/bus.service';
import { UnauthorizedError, BadRequestError } from '../../core/errors/app-error';

const NOW_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function ctxOf(req: HttpRequest): BusCtx {
  if (!req.ctx) throw new UnauthorizedError();
  const body = (req.body ?? {}) as Record<string, unknown>;
  const now = String(req.query['now'] ?? body['now'] ?? '');
  if (!NOW_RE.test(now)) throw new BadRequestError('Missing local time');
  // The browser's local time picks "tonight". Reject anything far from the server clock so a
  // crafted ?now= can't write to a past night (36 h covers every timezone + a slow phone clock).
  const skew = Math.abs(Date.parse(now.slice(0, 16) + 'Z') - Date.now());
  if (!(skew < 36 * 3600_000)) throw new BadRequestError('Your phone clock looks wrong — check the date and time');
  const as = (req.query['as'] ?? body['as'] ?? null) as string | null;
  return { actor: req.ctx, asLeaderId: as || null, localNow: now.slice(0, 16) };
}

export function makeBusController(deps: { bus: BusService }) {
  const b = deps.bus;
  const p = (req: HttpRequest, k: string) => req.params[k]!;
  return {
    run: (r: HttpRequest) => b.getRun(ctxOf(r)),
    version: (r: HttpRequest) => b.getVersion(ctxOf(r)),
    search: (r: HttpRequest) => b.search(ctxOf(r), String(r.query['q'] ?? '')),
    riderAddresses: (r: HttpRequest) => b.riderAddresses(ctxOf(r), p(r, 'id')),
    deleteRiderAddress: async (r: HttpRequest) => { await b.deleteRiderAddress(ctxOf(r), p(r, 'id'), p(r, 'addressId')); return { ok: true }; },
    personAddresses: (r: HttpRequest) => b.personAddresses(ctxOf(r), { studentId: r.query['studentId'] ? String(r.query['studentId']) : undefined, guestId: r.query['guestId'] ? String(r.query['guestId']) : undefined }),
    deletePastRider: async (r: HttpRequest) => {
      await b.deletePastRider(ctxOf(r), { studentId: r.query['studentId'] ? String(r.query['studentId']) : undefined, guestId: r.query['guestId'] ? String(r.query['guestId']) : undefined });
      return { ok: true };
    },
    saveMyCarStops: (r: HttpRequest) => b.saveMyCarStops(ctxOf(r), r.body),
    optimiseMyCar: (r: HttpRequest) => b.optimiseMyCar(ctxOf(r)),
    addRider: (r: HttpRequest) => b.addRider(ctxOf(r), r.body),
    updateRider: (r: HttpRequest) => b.updateRider(ctxOf(r), p(r, 'id'), r.body),
    removeRider: async (r: HttpRequest) => { await b.removeRider(ctxOf(r), p(r, 'id')); return { ok: true }; },
    moveRider: (r: HttpRequest) => b.moveRider(ctxOf(r), p(r, 'id'), r.body),
    setConsent: (r: HttpRequest) => b.setConsent(ctxOf(r), p(r, 'id'), r.body),
    setDropped: (r: HttpRequest) => b.setDropped(ctxOf(r), p(r, 'id'), r.body),
    createGuest: (r: HttpRequest) => b.createGuest(ctxOf(r), r.body),
    pendingGuests: (r: HttpRequest) => b.pendingGuests(ctxOf(r)),
    linkGuest: async (r: HttpRequest) => { await b.linkGuest(ctxOf(r), p(r, 'id'), r.body); return { ok: true }; },
    dismissGuest: async (r: HttpRequest) => { await b.dismissGuest(ctxOf(r), p(r, 'id')); return { ok: true }; },
    saveVehicle: (r: HttpRequest) => b.saveVehicle(ctxOf(r), r.body),
    updateVehicle: (r: HttpRequest) => b.saveVehicle(ctxOf(r), { ...(r.body as object), id: p(r, 'id') }),
    updateRunVehicle: (r: HttpRequest) => b.updateRunVehicle(ctxOf(r), p(r, 'id'), r.body),
    setPool: async (r: HttpRequest) => { await b.setPool(ctxOf(r), r.body); return { ok: true }; },
    setLeaderPrefs: async (r: HttpRequest) => { await b.setLeaderPrefs(ctxOf(r), p(r, 'leaderId'), r.body); return { ok: true }; },
    saveOwnCar: (r: HttpRequest) => b.saveOwnCar(ctxOf(r), r.body),
    removeOwnCar: async (r: HttpRequest) => { await b.removeOwnCar(ctxOf(r)); return { ok: true }; },
    myCar: (r: HttpRequest) => b.myCar(ctxOf(r)),
    runs: (r: HttpRequest) => b.listRuns(ctxOf(r)),
    pastRun: (r: HttpRequest) => b.getPastRun(ctxOf(r), p(r, 'id')),
    history: (r: HttpRequest) => b.history(ctxOf(r), r.query['from'] ? String(r.query['from']) : undefined),
    editPastRider: (r: HttpRequest) => b.editPastRider(ctxOf(r), p(r, 'id'), p(r, 'riderId'), r.body),
    autocomplete: (r: HttpRequest) => b.autocomplete(ctxOf(r), String(r.query['q'] ?? ''), String(r.query['session'] ?? '')),
    generate: (r: HttpRequest) => b.generate(ctxOf(r), r.body),
    undo: async (r: HttpRequest) => { await b.undo(ctxOf(r)); return { ok: true }; },
    unassignAll: (r: HttpRequest) => b.unassignAll(ctxOf(r)),
    analysis: (r: HttpRequest) => b.analysis(ctxOf(r)),
    extraCars: (r: HttpRequest) => b.extraCars(ctxOf(r), r.body),
    analysisMap: async (r: HttpRequest) => { const img = await b.analysisMap(ctxOf(r)); return new RawResponse(img.contentType, img.bytes); },
  };
}
