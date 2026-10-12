// Supabase Elvanto link repo (spec 2026-10-12-elvanto-link-app-design.md §4.1). Tables from migration 0017, all RLS.
// Every time compare uses the DB clock (now()). jsonb is written only via sql.json(). Notes are encrypted at rest with
// the AAD 'link_outbox.note:' + id and decrypted only inside claim(), row by row. Nothing here logs.
import type { SqlClient } from './client';
import { toIso } from './client';
import { chunk } from './bulk';
import { maybeEncrypt, maybeDecrypt } from '../../utils/field-crypto';
import type { ILinkRepository, LinkActionFilter, LinkRosterPushRow } from '../interfaces/link.repository';
import type { ActionType, Capabilities, ClaimArgs, ClaimedRow, ConsoleRow, LinkFlowRow, LinkGroupRow, LinkLogRow,
  LinkRosterRow, LinkServiceRow, LogEvent, Match, MirrorStateRow, NewOutboxRow, OutboxRow, PushKind, ResultItem,
  ResultReply, Status } from '../../core/link-types';
import { LinkIdExists, LinkOpenDuplicate } from '../../core/errors/link-errors';
import { applyOutcome } from '../../services/link-rules';

type Row = Record<string, any>;
const iso = (v: unknown) => (v == null ? null : toIso(v));
const ymd = (v: unknown) => (v == null ? null : typeof v === 'string' ? v.slice(0, 10) : toIso(v).slice(0, 10));
const noteAad = (id: string) => 'link_outbox.note:' + id;
/** The columns applyOutcome may change. Anything else in its patch is a bug, not a silent write. */
const RESULT_COLS: Partial<Record<keyof OutboxRow, string>> = { status: 'status', reason: 'reason', detail: 'detail',
  retryAt: 'retry_at', leaseOwner: 'lease_owner', leaseUntil: 'lease_until', resultAt: 'result_at',
  sentLogKey: 'sent_log_key', reportId: 'report_id', personId: 'person_id', updatedAt: 'updated_at' };
const fail = (k: string): never => { throw new Error(`applyResults: unexpected column ${k}`); };

function toOutbox(r: Row, note: string | null): OutboxRow {
  return { id: r.id, type: r.type as ActionType, payload: r.payload ?? {}, note, hasNote: r.note != null, dedupeKey: r.dedupe_key,
    serviceDate: ymd(r.service_date)!, studentId: r.student_id ?? null, personId: r.person_id ?? null,
    createdBy: r.created_by, leaderId: r.leader_id ?? null, leaderName: r.leader_name, status: r.status as Status,
    reason: r.reason ?? null, detail: r.detail ?? null, attempts: r.attempts, retryAt: iso(r.retry_at),
    leaseOwner: r.lease_owner ?? null, leaseUntil: iso(r.lease_until), resultAt: iso(r.result_at),
    sentLogKey: r.sent_log_key ?? null, reportId: r.report_id ?? null, createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at) };
}
function toConsole(r: Row): ConsoleRow {
  return { consoleId: r.console_id, label: r.label, lastSeenAt: toIso(r.last_seen_at), contractVersion: r.contract_version,
    consoleVersion: r.console_version, inWindow: r.in_window, pollSeconds: r.poll_seconds,
    capabilities: r.capabilities as Capabilities };
}
function toRoster(r: Row): LinkRosterRow {
  return { personId: r.person_id, firstName: r.first_name, lastName: r.last_name, gender: r.gender ?? null,
    grade: r.grade ?? null, kind: r.kind, active: r.active, studentId: r.student_id ?? null, match: r.match as Match,
    updatedAt: toIso(r.updated_at) };
}
function toLog(r: Row): LinkLogRow {
  return { id: r.id, at: toIso(r.at), userId: r.user_id, login: r.login, deviceId: r.device_id ?? null,
    deviceLabel: r.device_label ?? null, event: r.event as LogEvent, leaderId: r.leader_id ?? null,
    leaderName: r.leader_name ?? null, prevLeaderId: r.prev_leader_id ?? null, prevLeaderName: r.prev_leader_name ?? null,
    targetKind: r.target_kind ?? null, targetId: r.target_id ?? null, targetName: r.target_name ?? null,
    outboxId: r.outbox_id ?? null, outcome: r.outcome };
}

export interface SupabaseLinkOptions {
  /** Decrypts a stored note at claim time. Default maybeDecrypt with the outbox AAD; a test can throw. */
  decrypt?: (note: string, id: string) => string;
}

export class SupabaseLinkRepository implements ILinkRepository {
  private decrypt: (note: string, id: string) => string;
  constructor(private sql: SqlClient, opts: SupabaseLinkOptions = {}) {
    this.decrypt = opts.decrypt ?? ((n, id) => maybeDecrypt(n, noteAad(id)) ?? '');
  }
  private j(v: unknown) { return this.sql.json(v as Parameters<typeof this.sql.json>[0]); }

  async insertAction(n: NewOutboxRow): Promise<OutboxRow> {
    const sql = this.sql;
    try {
      const [r] = await sql`
        insert into link_outbox (id, type, payload, note, dedupe_key, service_date, student_id, person_id, created_by,
                                 leader_id, leader_name)
        values (${n.id}, ${n.type}, ${this.j(n.payload)}, ${maybeEncrypt(n.note, noteAad(n.id))}, ${n.dedupeKey},
                ${n.serviceDate}, ${n.studentId}, ${n.personId}, ${n.createdBy}, ${n.leaderId}, ${n.leaderName})
        on conflict (id) do nothing
        returning *`;
      if (!r) throw new LinkIdExists(n.id); // the caller re-reads and runs the replay check (APP-72)
      return toOutbox(r, n.note);
    } catch (err) {
      if (err instanceof LinkIdExists) throw err;
      const e = err as { code?: string; constraint_name?: string; message?: string };
      if (e.code === '23505' && (e.constraint_name === 'link_outbox_open_uq' || String(e.message).includes('link_outbox_open_uq'))) {
        const [o] = await sql`
          select id from link_outbox where dedupe_key = ${n.dedupeKey} and status in ('pending','claimed','unclear') limit 1`;
        if (o) throw new LinkOpenDuplicate(o.id as string);
      }
      throw err;
    }
  }

  async getAction(id: string): Promise<OutboxRow | null> {
    const [r] = await this.sql`select * from link_outbox where id = ${id}`;
    return r ? toOutbox(r, null) : null;
  }

  async listActions(f: LinkActionFilter): Promise<OutboxRow[]> {
    if ((f.ids && !f.ids.length) || (f.types && !f.types.length) || (f.statuses && !f.statuses.length)) return [];
    const s = this.sql; const none = s``;
    const rows = await s`
      select * from link_outbox where true
        ${f.ids ? s`and id in ${s(f.ids)}` : none}
        ${f.createdBy ? s`and created_by = ${f.createdBy}` : none}
        ${f.serviceDateFrom ? s`and service_date >= ${f.serviceDateFrom}` : none}
        ${f.serviceDateTo ? s`and service_date <= ${f.serviceDateTo}` : none}
        ${f.types ? s`and type in ${s(f.types)}` : none}
        ${f.statuses ? s`and status in ${s(f.statuses)}` : none}
        ${f.personId ? s`and person_id = ${f.personId}` : none}
        ${f.serviceTimeId ? s`and payload->>'serviceTimeId' = ${f.serviceTimeId}` : none}
        ${f.groupId ? s`and payload->>'groupId' = ${f.groupId}` : none}
      order by created_at desc, id desc`;
    return rows.map((r) => toOutbox(r, null));
  }

  async cancelPending(id: string): Promise<boolean> {
    const r = await this.sql`
      update link_outbox set status = 'cancelled', updated_at = now() where id = ${id} and status = 'pending' returning id`;
    return r.length > 0;
  }

  async claim(a: ClaimArgs): Promise<ClaimedRow[]> {
    const c = a.console;
    return this.sql.begin(async (tx) => {
      // console upsert
      await tx`
        insert into link_console (console_id, label, last_seen_at, contract_version, console_version, in_window,
                                  poll_seconds, capabilities)
        values (${c.consoleId}, ${c.label}, now(), ${c.contractVersion}, ${c.consoleVersion}, ${c.inWindow},
                ${c.pollSeconds}, ${this.j(c.capabilities)})
        on conflict (console_id) do update set label = excluded.label, last_seen_at = now(),
          contract_version = excluded.contract_version, console_version = excluded.console_version,
          in_window = excluded.in_window, poll_seconds = excluded.poll_seconds, capabilities = excluded.capabilities`;
      // sweep: lock in id order and skip rows another transaction holds (no deadlock with applyResults; APP-2).
      // lease-lost skips this console's own rows: it reclaims them below and its sent-log decides (B1 / X6).
      await tx`
        update link_outbox set status = 'refused', reason = 'too-old', result_at = now(), updated_at = now()
        where id in (
          select id from link_outbox where status = 'pending' and created_at < now() - make_interval(days => ${a.cutoffDays})
          order by id for update skip locked)`;
      await tx`
        update link_outbox set status = 'unclear', reason = 'lease-lost', result_at = now(), updated_at = now()
        where id in (
          select id from link_outbox where status = 'claimed' and lease_until < now() - make_interval(secs => ${a.leaseLostMs / 1000})
            and lease_owner <> ${c.consoleId}
          order by id for update skip locked)`;
      // purge (§4.3)
      await tx`
        delete from link_roster
        where active = false and match in ('none','ignored') and updated_at < now() - interval '90 days'`;
      await tx`
        update link_outbox set note = null
        where status in ('sent','refused','shadowed','cancelled') and note is not null
          and created_at < now() - interval '30 days'`;
      await tx`delete from link_log where at < now() - interval '400 days'`;
      // lease
      const types = (Object.keys(c.capabilities) as ActionType[]).filter((t) => c.capabilities[t] !== 'off');
      if (a.max <= 0 || !types.length) return [];
      // A checkOut waits while an older checkIn for the same person and service is pending or claimed (B4 / APP-3).
      const picked = await tx`
        select id, status from link_outbox o
        where type in ${tx(types)} and (
          (status = 'pending' and (retry_at is null or retry_at <= now()))
          or (status = 'claimed' and lease_until < now() and lease_owner = ${c.consoleId}))
          and not (o.type = 'checkOut' and exists (
            select 1 from link_outbox i
            where i.type = 'checkIn' and i.person_id = o.person_id
              and i.payload->>'serviceTimeId' = o.payload->>'serviceTimeId'
              and i.status in ('pending','claimed') and (i.created_at, i.id) < (o.created_at, o.id)))
        order by created_at, id
        limit ${a.max}
        for update skip locked`;
      if (!picked.length) return [];
      const leased = await tx`
        update link_outbox set status = 'claimed', lease_owner = ${c.consoleId},
          lease_until = now() + make_interval(secs => ${a.leaseSeconds}), attempts = attempts + 1, updated_at = now()
        where id in ${tx(picked.map((p) => p.id as string))}
        returning *`;
      const byId = new Map(leased.map((r) => [r.id as string, r]));
      const out: ClaimedRow[] = [];
      for (const p of picked) {
        const r = byId.get(p.id as string)!;
        const reclaimed = p.status === 'claimed';
        let note: string | null = null;
        try {
          note = r.note == null ? null : this.decrypt(r.note as string, r.id as string);
        } catch {
          const [u] = await tx`
            update link_outbox set status = 'refused', reason = 'note-unreadable', lease_owner = null, lease_until = null,
              result_at = now(), updated_at = now()
            where id = ${r.id as string} and lease_owner = ${c.consoleId}
            returning *`;
          out.push({ row: toOutbox(u!, null), reclaimed, noteUnreadable: true });
          continue;
        }
        out.push({ row: toOutbox(r, note), reclaimed, noteUnreadable: false });
      }
      return out;
    });
  }

  /**
   * ONE transaction. Per item, in order: lock the row, run applyOutcome, then a guarded update (the status it was read
   * with, plus the lease owner for a claimed row). A guarded update that hits 0 rows is ignored with the reason
   * applyOutcome gives for the row as it now is. Only the result columns are written (never note or attempts).
   */
  async applyResults(consoleId: string, items: ResultItem[], now: Date): Promise<ResultReply> {
    return this.sql.begin(async (tx) => {
      const none = tx``;
      const reply: ResultReply = { applied: [], ignored: [] };
      for (const item of items) {
        const [r] = await tx`select * from link_outbox where id = ${item.id} for update`;
        const old = r ? toOutbox(r, null) : null;
        const res = applyOutcome(old, item, consoleId, now);
        if ('ignored' in res) { reply.ignored.push({ id: item.id, why: res.ignored }); continue; }
        const set: Row = {};
        for (const [k, v] of Object.entries(res.next)) set[RESULT_COLS[k as keyof OutboxRow] ?? fail(k)] = v;
        const done = await tx`
          update link_outbox set ${tx(set)}
          where id = ${item.id} and status = ${old!.status}
            ${old!.status === 'claimed' ? tx`and lease_owner = ${consoleId}` : none}
          returning id`;
        if (done.length) { reply.applied.push(item.id); continue; }
        const [now2] = await tx`select * from link_outbox where id = ${item.id}`;
        const again = applyOutcome(now2 ? toOutbox(now2, null) : null, item, consoleId, now);
        reply.ignored.push({ id: item.id, why: 'ignored' in again ? again.ignored : 'bad-transition' });
      }
      return reply;
    });
  }

  async listConsoles(): Promise<ConsoleRow[]> {
    return (await this.sql`select * from link_console order by last_seen_at desc`).map(toConsole);
  }

  async replaceMirror(kind: PushKind, rows: unknown[], meta: { takenAt: string; consoleId: string }) {
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${'link_mirror:' + kind}))`;
      const [st] = await tx`
        select ${meta.takenAt}::timestamptz <= taken_at as stale from link_mirror_state where kind = ${kind}`;
      if (st?.stale) return { applied: false, rows: 0 };
      if (kind === 'roster') {
        const push = rows as LinkRosterPushRow[];
        for (const b of chunk(push)) {
          await tx`
            insert into link_roster ${tx(b.map((p) => ({ person_id: p.personId, first_name: p.firstName,
              last_name: p.lastName, gender: p.gender, grade: p.grade, kind: p.kind, active: true })))}
            on conflict (person_id) do update set first_name = excluded.first_name, last_name = excluded.last_name,
              gender = excluded.gender, grade = excluded.grade, kind = excluded.kind, active = true, updated_at = now()`;
        }
        const ids = push.map((p) => p.personId);
        if (ids.length) {
          await tx`update link_roster set active = false, updated_at = now() where active and person_id not in ${tx(ids)}`;
        } else {
          await tx`update link_roster set active = false, updated_at = now() where active`;
        }
      } else if (kind === 'services') {
        await tx`delete from link_services`;
        for (const b of chunk(rows as LinkServiceRow[])) {
          await tx`insert into link_services ${tx(b.map((s) => ({ service_time_id: s.serviceTimeId,
            service_id: s.serviceId, name: s.name, starts_at: s.startsAt, ymd: s.ymd, rooms: this.j(s.rooms),
            checked_in: this.j(s.checkedIn) })))}`;
        }
      } else if (kind === 'groups') {
        await tx`delete from link_groups`;
        for (const b of chunk(rows as LinkGroupRow[])) {
          await tx`insert into link_groups ${tx(b.map((g) => ({ group_id: g.groupId, name: g.name,
            grade: g.grade ?? null, gender: g.gender ?? null, meets: g.meets, members: this.j(g.members),
            this_week: g.thisWeek, last_report: g.lastReport == null ? null : this.j(g.lastReport) })))}`;
        }
      } else {
        await tx`delete from link_flow_people`;
        for (const b of chunk(rows as LinkFlowRow[])) {
          await tx`insert into link_flow_people ${tx(b.map((f) => ({ row_id: f.rowId, flow_id: f.flowId,
            flow_name: f.flowName, step_id: f.stepId, step_name: f.stepName, step_order: f.stepOrder,
            person_id: f.personId, name: f.name, due: f.due, assigned_to: f.assignedTo })))}`;
        }
      }
      await tx`
        insert into link_mirror_state (kind, taken_at, console_id, row_count, applied_at)
        values (${kind}, ${meta.takenAt}, ${meta.consoleId}, ${rows.length}, now())
        on conflict (kind) do update set taken_at = excluded.taken_at, console_id = excluded.console_id,
          row_count = excluded.row_count, applied_at = now()`;
      return { applied: true, rows: rows.length };
    });
  }

  async mirrorState(): Promise<MirrorStateRow[]> {
    return (await this.sql`select * from link_mirror_state order by kind`).map((r) => ({ kind: r.kind as PushKind,
      takenAt: toIso(r.taken_at), consoleId: r.console_id, rowCount: r.row_count, appliedAt: toIso(r.applied_at) }));
  }
  async roster(): Promise<LinkRosterRow[]> {
    return (await this.sql`select * from link_roster order by last_name, first_name, person_id`).map(toRoster);
  }
  async services(): Promise<LinkServiceRow[]> {
    return (await this.sql`select * from link_services order by starts_at, service_time_id`).map((r) => ({
      serviceTimeId: r.service_time_id, serviceId: r.service_id, name: r.name, startsAt: toIso(r.starts_at),
      ymd: ymd(r.ymd)!, rooms: r.rooms ?? [], checkedIn: r.checked_in ?? [] }));
  }
  async groups(): Promise<LinkGroupRow[]> {
    return (await this.sql`select * from link_groups order by name, group_id`).map((r) => ({ groupId: r.group_id,
      name: r.name, grade: r.grade ?? null, gender: r.gender ?? null, meets: r.meets, members: r.members ?? [],
      thisWeek: r.this_week, lastReport: r.last_report ?? null }));
  }
  async flows(): Promise<LinkFlowRow[]> {
    return (await this.sql`select * from link_flow_people order by flow_name, step_order, name, row_id`).map((r) => ({
      rowId: r.row_id, flowId: r.flow_id, flowName: r.flow_name, stepId: r.step_id, stepName: r.step_name,
      stepOrder: r.step_order, personId: r.person_id ?? null, name: r.name, due: ymd(r.due), assignedTo: r.assigned_to }));
  }

  async setMatches(changes: { personId: string; studentId: string | null; match: Match }[]): Promise<void> {
    if (!changes.length) return;
    await this.sql.begin(async (tx) => {
      for (const c of changes) {
        await tx`update link_roster set student_id = ${c.studentId}, match = ${c.match}, updated_at = now()
                 where person_id = ${c.personId}`;
      }
    });
  }

  async addLog(rows: LinkLogRow[]): Promise<void> {
    for (const b of chunk(rows)) {
      await this.sql`insert into link_log ${this.sql(b.map((l) => ({ id: l.id, at: l.at, user_id: l.userId,
        login: l.login, device_id: l.deviceId, device_label: l.deviceLabel, event: l.event, leader_id: l.leaderId,
        leader_name: l.leaderName, prev_leader_id: l.prevLeaderId, prev_leader_name: l.prevLeaderName,
        target_kind: l.targetKind, target_id: l.targetId, target_name: l.targetName, outbox_id: l.outboxId,
        outcome: l.outcome })))}
        on conflict (id) do nothing`;
    }
  }

  async listLog(f: { from: string; to: string; userId?: string; event?: LogEvent; limit: number }): Promise<LinkLogRow[]> {
    const s = this.sql; const none = s``;
    return (await s`
      select * from link_log where at >= ${f.from} and at < ${f.to}
        ${f.userId ? s`and user_id = ${f.userId}` : none}
        ${f.event ? s`and event = ${f.event}` : none}
      order by at desc, id desc limit ${f.limit}`).map(toLog);
  }
}
