// Reconciliation after each groups import (spec 2026-10-17 §5). Reports only: never writes to Elvanto. Writes roster matches
// (approved), error_log rows (category reconcile, setCount; 0 deletes) and one reconcile_runs row (ids only). Never throws.
import { randomUUID } from 'node:crypto';
import { createLogger } from '../utils/logger';
import { addDays, brisbaneToday } from './link-rules';
import { checkCheckins, checkLifegroups, checkMembers, checkUnmatched } from './reconcile-rules';
import { rematchRoster } from './sync.service';
import { nameKey } from './name-key';
import type { ErrorLogService } from './error-log.service';
import type { ILinkRepository } from '../repositories/interfaces/link.repository';
import type { IErrorLogRepository } from '../repositories/interfaces/error-log.repository';
import type { IImportRepository, ILifegroupAttendanceRepository, ILifegroupRepository, ILifegroupWeekRepository,
  IServiceAttendanceRepository, IServiceSessionRepository, ISettingsRepository, IStudentRepository } from '../repositories/interfaces/entity-repositories';
import type { CheckState, IReconcileRunRepository, ReconcileChecks, ReconcileItems } from '../repositories/interfaces/reconcile-run.repository';

const log = createLogger('reconcile');

export interface ReconcileDeps {
  link: Pick<ILinkRepository, 'roster' | 'setMatches' | 'listActions'>; students: IStudentRepository;
  lifegroups: Pick<ILifegroupRepository, 'findAll' | 'findRoll'>; lifegroupWeeks: Pick<ILifegroupWeekRepository, 'findAll'>;
  lifegroupAttendance: Pick<ILifegroupAttendanceRepository, 'findAll'>; serviceSessions: Pick<IServiceSessionRepository, 'findAll'>;
  serviceAttendance: Pick<IServiceAttendanceRepository, 'findBySession'>; imports: Pick<IImportRepository, 'findByType'>;
  settings: Pick<ISettingsRepository, 'getSettings'>; errorLog: Pick<ErrorLogService, 'record'>;
  errorRows: Pick<IErrorLogRepository, 'list'>; runs: IReconcileRunRepository; now?: () => Date; budgetMs?: number;
}
/** C3 adds latest(body), C4 adds whoLatest(actor). */
export interface ReconcileService { rematch(): Promise<void>; run(): Promise<void> }

type CheckName = keyof ReconcileChecks;
const CODE: Record<CheckName, string> = { checkins: 'recon-checkins', unmatched: 'recon-unmatched', lifegroups: 'recon-lifegroups', members: 'recon-members' };
const DAY_MS = 86_400_000;

/** p, or undefined once ms pass. p must never reject (a late result is ignored). */
async function within<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([p, new Promise<undefined>((res) => { timer = setTimeout(() => res(undefined), ms); })]); }
  finally { clearTimeout(timer); }
}

export function makeReconcileService(d: ReconcileDeps): ReconcileService {
  const now = d.now ?? (() => new Date());
  const budgetMs = d.budgetMs ?? 10_000;
  // The last part of the budget is kept for the recon-failed rows and the run row, so run() as a whole stays within budgetMs.
  const finishMs = Math.min(1_000, budgetMs / 5);
  const put = (code: string, n: number, route = '') => d.errorLog.record({ category: 'reconcile', code, route }, n);

  async function rematch(): Promise<void> {
    try { await rematchRoster(d.link, d.students); } catch (e) { log.warn(`reconcile rematch failed: ${(e as Error).name}`); }
  }

  async function run(): Promise<void> {
    let closed = false;  // set when the budget is spent: late work then writes nothing
    const rec = (code: string, n: number, route = '') => (closed ? Promise.resolve() : put(code, n, route));
    let imp: { id: string } | undefined;
    const checks: Partial<ReconcileChecks> = {};
    const items: ReconcileItems = { checkins: [], unmatched: [], lifegroups: [], noId: [], members: [] };

    const work = async () => {
      await rematch();
      const at = now(); const today = brisbaneToday(at);
      const [latest] = await d.imports.findByType('lifegroup');
      imp = latest;
      const beforeIso = latest?.importedAt ?? at.toISOString();
      const sinceIso = new Date(Date.parse(beforeIso) - 14 * DAY_MS).toISOString();
      const roster = await d.link.roster();

      const one = async (name: CheckName, f: () => Promise<CheckState>) => {
        try { const r = await f(); if (!closed) checks[name] = r; await rec('recon-failed', 0, name); }
        catch (e) { log.warn(`reconcile ${name} failed: ${(e as Error).name}`); if (!closed) checks[name] = { error: true }; await rec('recon-failed', 1, name); }
      };
      await Promise.all([
        one('checkins', async () => {
          const from = addDays(today, -6);
          const sessions = (await d.serviceSessions.findAll()).filter((s) => { const x = s.sessionDate.slice(0, 10); return x >= from && x <= today; });
          const [attendance, rows] = await Promise.all([
            Promise.all(sessions.map((s) => d.serviceAttendance.findBySession(s.id))).then((x) => x.flat()),
            d.link.listActions({ types: ['checkIn'], statuses: ['sent'], serviceDateFrom: from, serviceDateTo: today })]);
          const r = checkCheckins({ sessions, attendance, roster, rows });
          items.checkins = r.items; await rec(CODE.checkins, r.count); return { count: r.count };
        }),
        one('unmatched', async () => {
          const r = checkUnmatched(roster); items.unmatched = r.items; await rec(CODE.unmatched, r.count); return { count: r.count };
        }),
        one('lifegroups', async () => {
          const [lifegroups, weeks, attendance, actions, settings] = await Promise.all([d.lifegroups.findAll(), d.lifegroupWeeks.findAll(),
            d.lifegroupAttendance.findAll(), d.link.listActions({ types: ['submitReport', 'editReport'], statuses: ['sent'] }), d.settings.getSettings()]);
          const r = checkLifegroups({ actions, lifegroups, weeks, attendance, roster, today, sinceIso, beforeIso,
            serviceDayOfWeek: settings.ministryConfig.structure.serviceDayOfWeek });
          items.lifegroups = r.items; items.noId = r.noId;
          await rec(CODE.lifegroups, r.count); await rec('recon-lifegroup-noid', r.noId.length);
          return { count: r.count, noId: r.noId.length };
        }),
        one('members', async () => {
          const [lifegroups, roll, actions] = await Promise.all([d.lifegroups.findAll(), d.lifegroups.findRoll(),
            d.link.listActions({ types: ['addGroupMember', 'removeGroupMember'], statuses: ['sent'] })]);
          const r = checkMembers({ actions, lifegroups, roll, roster, keyOf: (p) => nameKey(p.firstName, p.lastName), sinceIso, beforeIso });
          items.members = r.items; await rec(CODE.members, r.count); return { count: r.count };
        }),
      ]);
    };

    const finish = async () => {
      const names = Object.keys(CODE) as CheckName[];
      const missing = names.filter((k) => !checks[k]);   // cut off by the budget, or never started (rematch / roster failed)
      await Promise.all(missing.map((k) => put('recon-failed', 1, k)));
      const done = names.reduce((o, k) => ({ ...o, [k]: checks[k] ?? { error: true } }), {} as ReconcileChecks);
      const ok = Object.values(done).every((c) => !('error' in c));
      await d.runs.save({ id: randomUUID(), ranAt: now().toISOString(), importId: imp?.id ?? null, ok, checks: done, items: { ...items } });
    };

    // ponytail: work cut off by the budget keeps running in the background (writes are blocked by `closed`); the next run corrects it.
    await within(work().catch((e) => log.warn(`reconcile failed: ${(e as Error).name}`)), budgetMs - finishMs);
    closed = true;
    await within(finish().catch((e) => log.warn(`reconcile run save failed: ${(e as Error).name}`)), finishMs);
  }

  return { rematch, run };
}
