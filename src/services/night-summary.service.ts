// Friday night check: POST /sync/night-summary (spec 2026-11-05). Read only; counts and closed values only, never a name or text.
// One section per call, one query at a time (a plain await each, so the connection pool is never fanned out). Every section's
// result is parsed through its schema before it is returned, so an added field or a bad format fails the section, not the privacy rule.
import { LINK_CONTRACT_VERSION, NightSummaryRequest, NightOutbox, NightTaps, NightErrors, NightImports, NightReconcile, NightConsole, NightServices,
  type NIGHT_SECTIONS } from '../core/link-contract';
import { parseBody } from './sync.service';
import { toView } from './error-log.service';
import { brisbaneToday } from './link-rules';
import { aggregateOutbox, aggregateTaps, aggregateErrors, aggregateImports, aggregateConsole, aggregateServices } from './night-summary-aggregate';
import type { ILinkRepository } from '../repositories/interfaces/link.repository';
import type { IErrorLogRepository } from '../repositories/interfaces/error-log.repository';
import type { IReconcileRunRepository } from '../repositories/interfaces/reconcile-run.repository';
import type { IImportRepository, ISettingsRepository } from '../repositories/interfaces/entity-repositories';
import type { INightSummaryRepository } from '../repositories/interfaces/night-summary.repository';

/** The most link_log rows one taps read returns; more than this sets `truncated`. */
export const NIGHT_TAPS_MAX = 5000;

export interface NightSummaryDeps {
  night: INightSummaryRepository;
  link: Pick<ILinkRepository, 'listConsoles' | 'mirrorState' | 'services'>;
  errorRows: Pick<IErrorLogRepository, 'list'>;
  runs: Pick<IReconcileRunRepository, 'latest'>;
  imports: Pick<IImportRepository, 'findByType'>;
  settings: Pick<ISettingsRepository, 'getSettings'>;
  now?: () => Date;
}
export interface NightSummaryService {
  get(body: unknown): Promise<{ contractVersion: 1; section: string; data: unknown }>;
}
type Section = (typeof NIGHT_SECTIONS)[number];

export function makeNightSummaryService(d: NightSummaryDeps): NightSummaryService {
  const now = d.now ?? (() => new Date());
  // The site's calendar days for the window: the outbox and the service rows are dated in site time.
  const days = async (from: string, to: string) => {
    const tz = (await d.settings.getSettings()).ministryConfig.structure.timeZone;
    return { fromYmd: brisbaneToday(new Date(from), tz), toYmd: brisbaneToday(new Date(to), tz) };
  };
  const iso = (s: string) => new Date(s).toISOString();

  const sections: Record<Section, (r: { consoleId: string; from: string; to: string }) => Promise<unknown>> = {
    outbox: async (r) => {
      const { fromYmd, toYmd } = await days(r.from, r.to);
      return NightOutbox.parse(aggregateOutbox(await d.night.outbox(fromYmd, toYmd), now()));
    },
    taps: async (r) => NightTaps.parse(aggregateTaps(await d.night.taps(r.from, r.to, NIGHT_TAPS_MAX), NIGHT_TAPS_MAX)),
    errors: async (r) => {
      const rows = await d.errorRows.list();
      // The tier is the one the Error log shows (computed from the code at read time), not the stored column.
      return NightErrors.parse(aggregateErrors(rows.map((x) => toView(x)), rows.length, r.from, r.to));
    },
    imports: async (r) => {
      const service = await d.imports.findByType('service');
      const lifegroup = await d.imports.findByType('lifegroup');
      return NightImports.parse(aggregateImports(service, lifegroup, r.from, r.to));
    },
    // The latest run's counts only: its items (ids) are never read out.
    reconcile: async () => {
      const run = await d.runs.latest();
      return NightReconcile.parse(run ? { ranAt: iso(run.ranAt), ok: run.ok, checks: run.checks } : null);
    },
    console: async (r) => {
      const consoles = await d.link.listConsoles();
      const mirror = await d.link.mirrorState();
      return NightConsole.parse(aggregateConsole(consoles, mirror, r.consoleId));
    },
    services: async (r) => {
      const { fromYmd, toYmd } = await days(r.from, r.to);
      return NightServices.parse(aggregateServices(await d.link.services(), fromYmd, toYmd));
    },
  };

  return {
    async get(body) {
      const req = parseBody(NightSummaryRequest, body);
      return { contractVersion: LINK_CONTRACT_VERSION, section: req.section, data: await sections[req.section](req) };
    },
  };
}
