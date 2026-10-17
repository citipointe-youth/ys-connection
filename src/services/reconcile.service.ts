// Reconciliation after each groups import (spec 2026-10-17 §5). Reports only: never writes to Elvanto. Writes roster matches
// (approved), error_log rows (category reconcile, setCount; 0 deletes) and one reconcile_runs row (ids only). Never throws.
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { createLogger } from '../utils/logger';
import { addDays, brisbaneToday } from './link-rules';
import { checkCheckins, checkLifegroups, checkMembers, checkUnmatched } from './reconcile-rules';
import { parseBody, rematchRoster } from './sync.service';
import { toView } from './error-log.service';
import { LINK_CONTRACT_VERSION, ReconcileLatestRequest, ReconcileLatestResponse } from '../core/link-contract';
import { nameKey } from './name-key';
import { assertCan } from './access-control';
import type { Actor } from '../core/entities/user';
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
export type ReconcileLatest = z.infer<typeof ReconcileLatestResponse>;
/** Names for the admin Who? view. Resolved at read time only: error_log and reconcile_runs hold ids. */
export interface WhoLatest { ranAt: string | null; ok: boolean | null;
  checkins: { name: string; date: string }[]; unmatched: { name: string; grade: number | null }[];
  lifegroups: { group: string; date: string; missing: string[] }[]; members: { group: string; name: string; op: 'add' | 'remove' }[];
  noId: string[] }
export interface ReconcileService { rematch(): Promise<void>; run(): Promise<void>; latest(body: unknown): Promise<ReconcileLatest>; whoLatest(actor: Actor): Promise<WhoLatest> }

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

  async function latest(body: unknown): Promise<ReconcileLatest> {
    parseBody(ReconcileLatestRequest, body);
    const [run, rows] = await Promise.all([d.runs.latest(), d.errorRows.list()]);
    const cut = now().getTime() - 7 * DAY_MS;
    const tierRank = { now: 0, later: 1 } as const;
    // Reconcile rows are the latest run's state (0 deletes them), so they are kept whatever their age: a setCount row's last_seen
    // only moves when its count changes (Review Focus 1). Every other row must have been seen in the last 7 days.
    // toView recomputes the tier and fills {n} (singular/plural) from the count; `counted` tells the console not to add (xN).
    const entries = rows.map(toView)
      .filter((r) => !r.ignored && (r.tier === 'now' || r.tier === 'later') && (r.category === 'reconcile' || Date.parse(r.lastSeen) >= cut))
      .map((r) => ({ tier: r.tier as 'now' | 'later', code: r.code, line1: r.line1, count: r.count, counted: r.counted, lastSeen: r.lastSeen }))
      .sort((a, b) => tierRank[a.tier] - tierRank[b.tier] || b.lastSeen.localeCompare(a.lastSeen))
      .slice(0, 200);
    return ReconcileLatestResponse.parse({ contractVersion: LINK_CONTRACT_VERSION,
      run: run ? { ranAt: run.ranAt, ok: run.ok, checks: run.checks } : null, entries });
  }

  async function whoLatest(actor: Actor): Promise<WhoLatest> {
    assertCan(actor, 'admin:manage');
    const run = await d.runs.latest();
    const empty: WhoLatest = { ranAt: null, ok: null, checkins: [], unmatched: [], lifegroups: [], members: [], noId: [] };
    if (!run) return empty;
    const [roster, lgs] = await Promise.all([d.link.roster(), d.lifegroups.findAll()]);
    const person = new Map(roster.map((r) => [r.personId, r]));
    const nm = (id: string) => { const p = person.get(id); return p ? `${p.firstName} ${p.lastName}`.trim() : '(no longer on the roster)'; };
    const byGroup = new Map(lgs.filter((g) => g.elvantoGroupId).map((g) => [g.elvantoGroupId as string, g.fullName]));
    const byLg = new Map(lgs.map((g) => [g.id, g.fullName]));
    const grp = (id: string) => byGroup.get(id) ?? '(group not in the last import)';
    return { ranAt: run.ranAt, ok: run.ok,
      checkins: run.items.checkins.map((x) => ({ name: nm(x.personId), date: x.date })),
      unmatched: run.items.unmatched.map((id) => ({ name: nm(id), grade: person.get(id)?.grade ?? null })),
      lifegroups: run.items.lifegroups.map((x) => ({ group: grp(x.groupId), date: x.date, missing: x.personIds.map(nm) })),
      members: run.items.members.map((x) => ({ group: grp(x.groupId), name: nm(x.personId), op: x.op })),
      noId: run.items.noId.map((id) => byLg.get(id) ?? '(gone)') };
  }

  return { rematch, run, latest, whoLatest };
}
