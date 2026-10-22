// Reconciliation after each groups import (spec 2026-10-17 §5). Reports only: never writes to Elvanto. Writes roster matches
// (approved), error_log rows (category reconcile, setCount; 0 deletes) and one reconcile_runs row (ids only). Never throws.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createLogger } from '../utils/logger';
import { addDays, brisbaneToday, dedupeKey } from './link-rules';
import { checkCheckins, checkLifegroups, checkMembers, checkUnmatched } from './reconcile-rules';
import { parseBody, rematchRoster } from './sync.service';
import { toView } from './error-log.service';
import { LINK_CONTRACT_VERSION, PAYLOAD_SCHEMAS, ReconcileLatestRequest, ReconcileLatestResponse } from '../core/link-contract';
import { BadRequestError } from '../core/errors';
import { LinkUnavailable } from '../core/errors/link-errors';
import type { ActionType, LinkRosterRow, OutboxRow } from '../core/link-types';
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
  link: Pick<ILinkRepository, 'roster' | 'setMatches' | 'listActions' | 'insertAction' | 'groups' | 'listConsoles'>; students: IStudentRepository;
  lifegroups: Pick<ILifegroupRepository, 'findAll' | 'findRoll'>; lifegroupWeeks: Pick<ILifegroupWeekRepository, 'findAll'>;
  lifegroupAttendance: Pick<ILifegroupAttendanceRepository, 'findAll'>; serviceSessions: Pick<IServiceSessionRepository, 'findAll'>;
  serviceAttendance: Pick<IServiceAttendanceRepository, 'findBySession'>; imports: Pick<IImportRepository, 'findByType'>;
  settings: Pick<ISettingsRepository, 'getSettings'>; errorLog: Pick<ErrorLogService, 'record'>;
  errorRows: Pick<IErrorLogRepository, 'list'>; runs: IReconcileRunRepository; now?: () => Date; budgetMs?: number;
  /** Spec 2026-10-22 §7: re-evaluates audit-feed-stale before the console reads the entries. A throw is swallowed. */
  auditFeed?: () => Promise<void>;
}
/** personId -> "First Last", or "(no longer on the roster)". The Who? rule; the audit build names matched people with it. */
export function rosterNameOf(roster: readonly Pick<LinkRosterRow, 'personId' | 'firstName' | 'lastName'>[]): (personId: string) => string {
  const person = new Map(roster.map((r) => [r.personId, r]));
  return (id) => { const p = person.get(id); return p ? `${p.firstName} ${p.lastName}`.trim() : '(no longer on the roster)'; };
}
export type ReconcileLatest = z.infer<typeof ReconcileLatestResponse>;
/** Names for the admin Who? view. Resolved at read time only: error_log and reconcile_runs hold ids. */
export interface WhoLatest { ranAt: string | null; ok: boolean | null;
  checkins: { name: string; date: string; personId: string }[]; unmatched: { name: string; grade: number | null }[];
  lifegroups: { group: string; date: string; missing: string[]; groupId: string }[];
  members: { group: string; name: string; op: 'add' | 'remove'; groupId: string; personId: string }[];
  noId: string[] }
export interface ReconcileService { rematch(): Promise<void>; run(): Promise<void>; latest(body: unknown): Promise<ReconcileLatest>; whoLatest(actor: Actor): Promise<WhoLatest>;
  resend(actor: Actor, body: unknown): Promise<{ ok: true; type: ActionType }> }

// r21 L6b (T9): one Who? row's "Send again" (ids of an item in the latest run).
const Id = z.string().uuid(), Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ResendBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('checkin'), personId: Id, date: Day }),
  z.object({ kind: z.literal('lifegroup'), groupId: Id, date: Day }),
  z.object({ kind: z.literal('member'), groupId: Id, personId: Id, op: z.enum(['add', 'remove']) }),
]);

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
      const at = now(); const today = brisbaneToday(at, (await d.settings.getSettings()).ministryConfig.structure.timeZone);
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
    await d.auditFeed?.().catch(() => undefined);
    const [run, rows] = await Promise.all([d.runs.latest(), d.errorRows.list()]);
    const cut = now().getTime() - 7 * DAY_MS;
    const tierRank = { now: 0, later: 1 } as const;
    // Reconcile and audit rows (spec 2026-10-22 §7) are current state (0 deletes them), so they are kept whatever their age: a setCount row's last_seen
    // only moves when its count changes (Review Focus 1). Every other row must have been seen in the last 7 days.
    // Legacy A12 (recon C3): code/line1 are clipped to the contract limits so one oversized row never 500s the whole answer.
    // toView recomputes the tier and fills {n} (singular/plural) from the count; `counted` tells the console not to add (xN).
    const entries = rows.map((r) => toView(r))
      .filter((r) => !r.ignored && (r.tier === 'now' || r.tier === 'later') && (r.category === 'reconcile' || r.category === 'audit' || Date.parse(r.lastSeen) >= cut))
      .map((r) => ({ tier: r.tier as 'now' | 'later', code: r.code.slice(0, 80), line1: r.line1.slice(0, 300), count: r.count, counted: r.counted, lastSeen: r.lastSeen }))
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
    const nm = rosterNameOf(roster);
    const byGroup = new Map(lgs.filter((g) => g.elvantoGroupId).map((g) => [g.elvantoGroupId as string, g.fullName]));
    const byLg = new Map(lgs.map((g) => [g.id, g.fullName]));
    const grp = (id: string) => byGroup.get(id) ?? '(group not in the last import)';
    return { ranAt: run.ranAt, ok: run.ok,
      checkins: run.items.checkins.map((x) => ({ name: nm(x.personId), date: x.date, personId: x.personId })),
      unmatched: run.items.unmatched.map((id) => ({ name: nm(id), grade: person.get(id)?.grade ?? null })),
      lifegroups: run.items.lifegroups.map((x) => ({ group: grp(x.groupId), date: x.date, missing: x.personIds.map(nm), groupId: x.groupId })),
      members: run.items.members.map((x) => ({ group: grp(x.groupId), name: nm(x.personId), op: x.op, groupId: x.groupId, personId: x.personId })),
      noId: run.items.noId.map((id) => byLg.get(id) ?? '(gone)') };
  }

  /**
   * r21 L6b (T9): queue the item's newest sent row again, same type, as a new outbox row (no note: notes are never read back).
   * No double write: the console reads Elvanto first (checked in / already in or out of the group -> `already`, nothing sent);
   * a report Elvanto has goes as an editReport whose base is the groups mirror (Elvanto's state), so a changed report is refused.
   */
  async function resend(actor: Actor, body: unknown): Promise<{ ok: true; type: ActionType }> {
    assertCan(actor, 'admin:manage');
    const parsed = ResendBody.safeParse(body);
    if (!parsed.success) throw new BadRequestError('Pick a row to send again.');
    const b = parsed.data;
    const run = await d.runs.latest();
    const inRun = !!run && (b.kind === 'checkin' ? run.items.checkins.some((x) => x.personId === b.personId && x.date === b.date)
      : b.kind === 'lifegroup' ? run.items.lifegroups.some((x) => x.groupId === b.groupId && x.date === b.date)
      : run.items.members.some((x) => x.groupId === b.groupId && x.personId === b.personId && x.op === b.op));
    if (!inRun) throw new BadRequestError('This row is not in the last check. Reload.');
    const pay = (r: OutboxRow) => r.payload as Record<string, unknown>;
    const byResult = (a: OutboxRow, c: OutboxRow) => (c.resultAt ?? '').localeCompare(a.resultAt ?? '');
    let src: OutboxRow | undefined; let type: ActionType; let payload: Record<string, unknown>;
    if (b.kind === 'checkin') {
      // review fix 5: a first-timer check-in (its person known once sent) goes again as a plain checkIn of that person.
      const rows = await d.link.listActions({ types: ['checkIn', 'firstTimerCheckIn', 'checkOut'], personId: b.personId, serviceDateFrom: b.date, serviceDateTo: b.date });
      src = rows.filter((r) => (r.type === 'checkIn' || r.type === 'firstTimerCheckIn') && r.status === 'sent' && r.personId === b.personId && r.serviceDate === b.date).sort(byResult)[0];
      // F1 (2026-10-22): a check-out after it means the child left; sending the check-in again would check them back in.
      if (src && rows.some((r) => r.type === 'checkOut' && r.status !== 'cancelled' && r.status !== 'refused' && r.personId === b.personId
        && pay(r)['serviceTimeId'] === pay(src!)['serviceTimeId'] && r.createdAt > (src!.createdAt ?? ''))) {
        throw new BadRequestError('They were checked out after this, so it is not sent again. Fix it in Elvanto if needed.');
      }
      type = 'checkIn';
      payload = !src ? {} : src.type === 'checkIn' ? pay(src) : { serviceTimeId: pay(src)['serviceTimeId'], serviceId: pay(src)['serviceId'], personId: b.personId };
    } else if (b.kind === 'member') {
      const t: ActionType = b.op === 'add' ? 'addGroupMember' : 'removeGroupMember';
      type = t;
      src = (await d.link.listActions({ types: [t], statuses: ['sent'], groupId: b.groupId }))
        .filter((r) => r.type === t && r.status === 'sent' && pay(r)['groupId'] === b.groupId && pay(r)['personId'] === b.personId).sort(byResult)[0];
      payload = src ? pay(src) : {};
    } else {
      src = (await d.link.listActions({ types: ['submitReport', 'editReport'], statuses: ['sent'], groupId: b.groupId }))
        .filter((r) => (r.type === 'submitReport' || r.type === 'editReport') && r.status === 'sent' && pay(r)['groupId'] === b.groupId && pay(r)['date'] === b.date)
        .sort(byResult)[0];
      const g = (await d.link.groups()).find((x) => x.groupId === b.groupId);
      if (src && !g) throw new BadRequestError("This group isn't in the app's list now. Reload.");
      const p = src ? pay(src) : {};
      const rid = src?.type === 'editReport' ? p['reportId'] : src?.reportId;
      const reps = g ? [g.lastReport, ...g.history].filter((x): x is NonNullable<typeof x> => !!x) : [];
      const have = reps.find((x) => x.reportId === rid) ?? reps.find((x) => x.date === b.date);
      const fields = { groupId: p['groupId'], date: p['date'], didNotMeet: p['didNotMeet'], attendees: p['attendees'], guests: p['guests'],
        notesPrivate: p['notesPrivate'], serviceTimeId: p['serviceTimeId'] };
      if (src && have && !have.editable) throw new BadRequestError('Edit this report in Elvanto.');
      type = have ? 'editReport' : 'submitReport';
      payload = have ? { ...fields, reportId: have.reportId, base: { date: have.date, didNotMeet: have.didNotMeet, attendees: have.attendees,
        guests: have.guests, serviceTimeId: have.serviceTimeId } } : fields;
    }
    if (!src) throw new BadRequestError('The app has no sent copy of this to send again.');
    const ok = PAYLOAD_SCHEMAS[type].safeParse(payload);
    if (!ok.success) throw new BadRequestError("This can't be sent again from here. Do it in Elvanto.");
    const con = [...(await d.link.listConsoles())].sort((a, c) => c.lastSeenAt.localeCompare(a.lastSeenAt))[0];
    if (con && (con.capabilities[type] ?? 'off') === 'off') throw new LinkUnavailable();
    const data = ok.data as Record<string, unknown>;
    // ponytail: no link_log line (the row's createdBy is the admin); add one if the activity log must list resends.
    await d.link.insertAction({ id: randomUUID(), type, payload: data, note: null, dedupeKey: dedupeKey(type, data),
      serviceDate: src.serviceDate, studentId: src.studentId, personId: src.personId, createdBy: actor.id, leaderId: src.leaderId, leaderName: src.leaderName });
    return { ok: true, type };
  }

  return { rematch, run, latest, whoLatest, resend };
}
