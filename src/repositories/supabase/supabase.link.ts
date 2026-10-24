// Supabase Elvanto link repo (spec 2026-10-12-elvanto-link-app-design.md §4.1). Tables from migration 0017, all RLS.
// Every time compare uses the DB clock (now()). jsonb is written only via sql.json(). Notes are encrypted at rest with
// the AAD 'link_outbox.note:' + id and decrypted only inside claim(), row by row. The one log line names a row id, never a value.
import type { SqlClient } from './client';
import { toIso } from './client';
import { chunk } from './bulk';
import { maybeEncrypt, maybeDecrypt } from '../../utils/field-crypto';
import type { ConsentLookupStored, ConsentSnapshotStored, ILinkRepository, LinkActionFilter, LinkRosterPushRow } from '../interfaces/link.repository';
import { putConsentLookup, readConsentLookup, putConsentSnapshot, readConsentSnapshots, consentSnapshotMeta, askConsentSnapshot, clearConsentSnapshots } from './supabase.link-consent';
import type { ActionType, Capabilities, ClaimArgs, ClaimedRow, ConsoleRow, LinkProgress, LinkFlowAssign, LinkFlowRow, LinkFlowStep, LinkGroupRow, LinkLogRow,
  LinkRosterRow, LinkServiceRow, LogEvent, Match, MirrorStateRow, NewOutboxRow, OutboxRow, MirrorKind, ResultItem,
  ResultReply, Status } from '../../core/link-types';
import { LinkIdExists, LinkOpenDuplicate } from '../../core/errors/link-errors';
import { applyOutcome } from '../../services/link-rules';
import { createLogger } from '../../utils/logger';

type Row = Record<string, any>;
const iso = (v: unknown) => (v == null ? null : toIso(v));
const ymd = (v: unknown) => (v == null ? null : typeof v === 'string' ? v.slice(0, 10) : toIso(v).slice(0, 10));
const logger = createLogger('link');
const noteAad = (id: string) => 'link_outbox.note:' + id;
/** T4: a flow person's mobile is encrypted at rest like students.mobile, bound to its row. */
const mobileAad = (rowId: string) => 'link_flow_people.mobile:' + rowId;
/** One mobile that cannot be decrypted (key change, bad row) reads as none; it must not fail every flows read. */
function readMobile(r: Row): string | null {
  try { return maybeDecrypt(r.mobile, mobileAad(r.row_id)); } catch { logger.warn('flow mobile unreadable', { rowId: r.row_id }); return null; }
}
/** The columns applyOutcome may change. Anything else in its patch is a bug, not a silent write. */
const RESULT_COLS: Partial<Record<keyof OutboxRow, string>> = { status: 'status', reason: 'reason', detail: 'detail',
  retryAt: 'retry_at', leaseOwner: 'lease_owner', leaseUntil: 'lease_until', resultAt: 'result_at',
  sentLogKey: 'sent_log_key', reportId: 'report_id', personId: 'person_id', updatedAt: 'updated_at',
  steps: 'steps', stop: 'stop' }; // X19: jsonb, written via sql.json()
const JSONB_COLS = new Set(['steps', 'stop']);
const fail = (k: string): never => { throw new Error(`applyResults: unexpected column ${k}`); };

function toOutbox(r: Row, note: string | null): OutboxRow {
  return { id: r.id, type: r.type as ActionType, payload: r.payload ?? {}, note, hasNote: r.note != null, dedupeKey: r.dedupe_key,
    serviceDate: ymd(r.service_date)!, studentId: r.student_id ?? null, personId: r.person_id ?? null,
    createdBy: r.created_by, leaderId: r.leader_id ?? null, leaderName: r.leader_name, status: r.status as Status,
    reason: r.reason ?? null, detail: r.detail ?? null, attempts: r.attempts, retryAt: iso(r.retry_at),
    leaseOwner: r.lease_owner ?? null, leaseUntil: iso(r.lease_until), resultAt: iso(r.result_at),
    sentLogKey: r.sent_log_key ?? null, reportId: r.report_id ?? null, createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at), steps: r.steps ?? null, stop: r.stop ?? null };
}
function toConsole(r: Row): ConsoleRow {
  return { consoleId: r.console_id, label: r.label, lastSeenAt: toIso(r.last_seen_at), contractVersion: r.contract_version,
    consoleVersion: r.console_version, inWindow: r.in_window, pollSeconds: r.poll_seconds,
    capabilities: r.capabilities as Capabilities, linkRev: r.link_rev ?? 1, progress: r.progress ?? {} };
}
function toRoster(r: Row): LinkRosterRow {
  return { personId: r.person_id, firstName: r.first_name, lastName: r.last_name, gender: r.gender ?? null,
    grade: r.grade ?? null, kind: r.kind, active: r.active, studentId: r.student_id ?? null, match: r.match as Match,
    updatedAt: toIso(r.updated_at), consent: r.consent ?? null };
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
    // The insert statement is unchanged; S-4 only decides which client runs it (the shared one, or the supersede tx).
    const insert = async (q: SqlClient): Promise<Row> => {
      const [r] = await q`
        insert into link_outbox (id, type, payload, note, dedupe_key, service_date, student_id, person_id, created_by,
                                 leader_id, leader_name)
        values (${n.id}, ${n.type}, ${this.j(n.payload)}, ${maybeEncrypt(n.note, noteAad(n.id))}, ${n.dedupeKey},
                ${n.serviceDate}, ${n.studentId}, ${n.personId}, ${n.createdBy}, ${n.leaderId}, ${n.leaderName})
        on conflict (id) do nothing
        returning *`;
      if (!r) throw new LinkIdExists(n.id); // the caller re-reads and runs the replay check (APP-72)
      return r;
    };
    const s = n.supersede;
    try {
      // S-4 / D5, D8: cancel the matching pending rows and insert in ONE transaction; a failed insert (id exists, open
      // duplicate) rolls the cancel back. A claimed row is not touched (its insert then answers duplicate, as before).
      const r = !s ? await insert(sql) : await sql.begin(async (tx) => {
        const none = tx``;
        await tx`
          update link_outbox set status = 'cancelled', updated_at = now(), detail = ${'cancelled-by:' + n.id}
          where status = 'pending' and type = ${s.type}
            ${s.dedupeKey !== undefined ? tx`and dedupe_key = ${s.dedupeKey}` : none}
            ${s.createdBy !== undefined ? tx`and created_by = ${s.createdBy}` : none}
            ${s.kind !== undefined ? tx`and payload->>'kind' = ${s.kind}` : none}`;
        return insert(tx as unknown as SqlClient);
      });
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
      order by created_at desc, id desc
      ${f.limit ? s`limit ${f.limit}` : none}`;
    return rows.map((r) => toOutbox(r, null));
  }

  async cancelPending(id: string, by?: string): Promise<boolean> {
    const r = await this.sql`
      update link_outbox set status = 'cancelled', updated_at = now(),
        detail = coalesce(${by ? `cancelled-by:${by}` : null}::text, detail) where id = ${id} and status = 'pending' returning id`;
    return r.length > 0;
  }

  async cancelDeadRecheck(id: string): Promise<boolean> {
    const r = await this.sql`
      update link_outbox set status = 'cancelled', updated_at = now() where id = ${id} and type = 'recheck' and status = 'unclear' returning id`;
    return r.length > 0;
  }

  async claim(a: ClaimArgs): Promise<ClaimedRow[]> {
    const c = a.console;
    return this.sql.begin(async (tx) => {
      // console upsert
      await tx`
        insert into link_console (console_id, label, last_seen_at, contract_version, console_version, in_window,
                                  poll_seconds, capabilities, link_rev)
        values (${c.consoleId}, ${c.label}, now(), ${c.contractVersion}, ${c.consoleVersion}, ${c.inWindow},
                ${c.pollSeconds}, ${this.j(c.capabilities)}, ${c.linkRev})
        on conflict (console_id) do update set label = excluded.label, last_seen_at = now(),
          contract_version = excluded.contract_version, console_version = excluded.console_version,
          in_window = excluded.in_window, poll_seconds = excluded.poll_seconds, capabilities = excluded.capabilities,
          link_rev = excluded.link_rev`;
      // sweep: lock in id order and skip rows another transaction holds (no deadlock with applyResults; APP-2).
      // lease-lost skips this console's own rows: it reclaims them below and its sent-log decides (B1 / X6).
      const tooOld = await this.sweepTooOld(a.cutoffDays, tx as unknown as SqlClient);
      const lost = await tx`
        update link_outbox set status = 'unclear', reason = 'lease-lost', result_at = now(), updated_at = now()
        where id in (
          select id from link_outbox where status = 'claimed' and lease_until < now() - make_interval(secs => ${a.leaseLostMs / 1000})
            and lease_owner <> ${c.consoleId}
          order by id for update skip locked)
        returning type`;
      a.swept?.push(...tooOld,
        ...lost.map((r) => ({ type: r.type as ActionType, reason: 'lease-lost' as const })));
      // purge (§4.3)
      await tx`
        delete from link_roster
        where active = false and match in ('none','ignored') and updated_at < now() - interval '90 days'`;
      await tx`
        update link_outbox set note = null
        where status in ('sent','refused','shadowed','cancelled') and note is not null
          and created_at < now() - interval '30 days'`;
      await tx`delete from link_log where at < now() - interval '400 days'`;
      // 'shadowed' (retired practice mode, PY-P3) stays in these two purges: old rows still carry it until they go.
      // X19: an intake row's note (fixes, keeps) goes as soon as it is final; the row itself after 14 days.
      await tx`
        update link_outbox set note = null
        where type in ('intakeAnswer','intakeSave','consentSave','intakeText') and note is not null
          and status in ('sent','refused','shadowed','cancelled','unclear')`;
      await tx`
        delete from link_outbox
        where type in ('intakeAnswer','intakeSave','consentSave','intakeText') and created_at < now() - interval '14 days'
          and status not in ('pending','claimed')`;
      // lease
      const types = (Object.keys(c.capabilities) as ActionType[]).filter((t) => c.capabilities[t] !== 'off');
      if (a.max <= 0 || !types.length) return [];
      // H1: pending rows first, so re-handed own leases (C01) a console keeps refusing can't fill every slot.
      // A checkOut waits while an older checkIn for the same person and service is pending or claimed (B4 / APP-3).
      const picked = await tx`
        select id, status from link_outbox o
        where type in ${tx(types)} and (
          (status = 'pending' and (retry_at is null or retry_at <= now()))
          or (status = 'claimed' and lease_owner = ${c.consoleId}))
          and not (o.type = 'checkOut' and exists (
            select 1 from link_outbox i
            where i.type = 'checkIn' and i.person_id = o.person_id
              and i.payload->>'serviceTimeId' = o.payload->>'serviceTimeId'
              and i.status in ('pending','claimed') and (i.created_at, i.id) < (o.created_at, o.id)))
        order by (status = 'claimed'), created_at, id
        limit ${a.max}
        for update skip locked`;
      if (!picked.length) return [];
      const leased = await tx`
        update link_outbox set status = 'claimed', lease_owner = ${c.consoleId},
          lease_until = now() + make_interval(secs => ${a.leaseSeconds}), updated_at = now(),
          -- R19-L4: re-handing its own LIVE lease (a lost claim reply, C01) is the same attempt
          attempts = case when status = 'claimed' and lease_until >= now() then attempts else attempts + 1 end
        where id in ${tx(picked.map((p) => p.id as string))}
        returning *`;
      const byId = new Map(leased.map((r) => [r.id as string, r]));
      const out: ClaimedRow[] = [];
      for (const p of picked) {
        const r = byId.get(p.id as string)!;
        const reclaimed = p.status === 'claimed';
        let note: string | null = null;
        try {
          // L7: a recheck row carries its ref row's note (decrypted with that row's own AAD; still kept while it is unclear).
          const src = r.type === 'recheck'
            ? (await tx`select id, note from link_outbox where id = ${String((r.payload as { ref?: unknown } | null)?.ref)}`)[0] ?? null : r;
          note = src?.note == null ? null : this.decrypt(src.note as string, src.id as string);
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

  /** S-2 / D6: the too-old sweep, run by claim (in its transaction) and by the link read path (sweepIfDue). */
  async sweepTooOld(cutoffDays: number, q: SqlClient = this.sql): Promise<{ type: ActionType; reason: 'too-old' }[]> {
    const tooOld = await q`
      update link_outbox set status = 'refused', reason = 'too-old', result_at = now(), updated_at = now()
      where id in (
        select id from link_outbox where status = 'pending' and created_at < now() - make_interval(days => ${cutoffDays})
        order by id for update skip locked)
      returning type`;
    // X19: an intake row waits at most 24 h (a plan that old is no use; the admin re-decides from a fresh one).
    const tooOldIntake = await q`
      update link_outbox set status = 'refused', reason = 'too-old', result_at = now(), updated_at = now()
      where id in (
        select id from link_outbox where status = 'pending' and created_at < now() - interval '24 hours'
          and type in ('intakeAnswer','intakeSave','consentSave','intakeText')
        order by id for update skip locked)
      returning type`;
    return [...tooOld, ...tooOldIntake].map((r) => ({ type: r.type as ActionType, reason: 'too-old' as const }));
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
        for (const [k, v] of Object.entries(res.next)) {
          set[RESULT_COLS[k as keyof OutboxRow] ?? fail(k)] = JSONB_COLS.has(k) && v != null ? this.j(v) : v;
        }
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

  /** S5 (migration 0030): merge one key into the console row's progress, dropping entries over 10 min old. */
  async setProgress(consoleId: string, key: string, p: Omit<LinkProgress, 'at'>): Promise<void> {
    await this.sql`
      update link_console set progress = coalesce((select jsonb_object_agg(k, v) from jsonb_each(progress) e(k, v)
          where (v->>'at')::timestamptz > now() - interval '10 minutes'), '{}')
        || ${this.j({ [key]: { ...p, at: new Date().toISOString() } })}
      where console_id = ${consoleId}`;
  }

  /** Rev 20 (door search): upsert only, under the roster push's own lock (never interleaves a full replace). */
  async addRoster(rows: LinkRosterPushRow[]): Promise<number> {
    if (!rows.length) return 0;
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${'link_mirror:roster'}))`;
      await tx`
        insert into link_roster ${tx(rows.map((p) => ({ person_id: p.personId, first_name: p.firstName, last_name: p.lastName,
          gender: p.gender, grade: p.grade, kind: p.kind, active: true, consent: p.consent ?? null })))}
        on conflict (person_id) do update set first_name = excluded.first_name, last_name = excluded.last_name,
          gender = excluded.gender, grade = excluded.grade,
          kind = case when link_roster.active then link_roster.kind else excluded.kind end, active = true, updated_at = now()`;
      return rows.length;
    });
  }

  async replaceMirror(kind: MirrorKind, rows: unknown[], meta: { takenAt: string; consoleId: string; steps?: LinkFlowStep[] }) {
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
              last_name: p.lastName, gender: p.gender, grade: p.grade, kind: p.kind, active: true, consent: p.consent ?? null })))}
            on conflict (person_id) do update set first_name = excluded.first_name, last_name = excluded.last_name,
              gender = excluded.gender, grade = excluded.grade, kind = excluded.kind, active = true,
              -- resilience H3 (stickyConsent): an unknown/missing flag never clears a known DO NOT CONTACT
              consent = case when (excluded.consent is null or excluded.consent = 'unknown')
                and link_roster.consent in ('contact', 'all') then link_roster.consent else excluded.consent end,
              updated_at = now()`;
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
            this_week: g.thisWeek, last_report: g.lastReport == null ? null : this.j(g.lastReport),
            history: this.j(g.history ?? []) })))}`;
        }
      } else {
        await tx`delete from link_flow_people`;
        for (const b of chunk(rows as LinkFlowRow[])) {
          await tx`insert into link_flow_people ${tx(b.map((f) => ({ row_id: f.rowId, flow_id: f.flowId,
            flow_name: f.flowName, step_id: f.stepId, step_name: f.stepName, step_order: f.stepOrder,
            person_id: f.personId, name: f.name, due: f.due, assigned_to: f.assignedTo, grade: f.grade ?? null,
            gender: f.gender ?? null, mobile: maybeEncrypt(f.mobile ?? null, mobileAad(f.rowId)),
            mobile_is_parent: f.mobileIsParent ?? false, consent: f.consent ?? null, texted_on: f.textedOn ?? null, service_visits: f.serviceVisits ?? null })))}`;
        }
        // T6: an assignment lasts while its person is still in that flow.
        await tx`
          delete from link_flow_assign a where not exists (
            select 1 from link_flow_people f where f.flow_id = a.flow_id and f.person_id = a.person_id)`;
      }
      const steps = kind === 'flows' && meta.steps ? this.j(meta.steps) : null; // T12 (0024)
      await tx`
        insert into link_mirror_state (kind, taken_at, console_id, row_count, applied_at, steps)
        values (${kind}, ${meta.takenAt}, ${meta.consoleId}, ${rows.length}, now(), ${steps})
        on conflict (kind) do update set taken_at = excluded.taken_at, console_id = excluded.console_id,
          row_count = excluded.row_count, applied_at = now(), steps = excluded.steps`;
      return { applied: true, rows: rows.length };
    });
  }

  async mirrorState(): Promise<MirrorStateRow[]> {
    return (await this.sql`select * from link_mirror_state order by kind`).map((r) => ({ kind: r.kind as MirrorKind,
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
      thisWeek: r.this_week, lastReport: r.last_report ?? null, history: r.history ?? [] }));
  }
  async flows(): Promise<LinkFlowRow[]> {
    return (await this.sql`select * from link_flow_people order by flow_name, step_order, name, row_id`).map((r) => ({
      rowId: r.row_id, flowId: r.flow_id, flowName: r.flow_name, stepId: r.step_id, stepName: r.step_name,
      stepOrder: r.step_order, personId: r.person_id ?? null, name: r.name, due: ymd(r.due), assignedTo: r.assigned_to,
      grade: r.grade ?? null, gender: r.gender ?? null, mobile: readMobile(r),
      mobileIsParent: r.mobile_is_parent ?? false, consent: r.consent ?? null, textedOn: ymd(r.texted_on), serviceVisits: r.service_visits ?? null }));
  }

  // Rev 6 (R2 b/c): an encrypted TEXT store, kept in supabase.link-consent.ts.
  putConsentLookup(r: ConsentLookupStored & { consoleId: string }): Promise<void> { return putConsentLookup(this.sql, r); }
  consentLookup(requestId: string): Promise<ConsentLookupStored | null> { return readConsentLookup(this.sql, requestId); }
  putConsentSnapshot(r: ConsentSnapshotStored & { consoleId: string }): Promise<boolean> { return putConsentSnapshot(this.sql, r); }
  consentSnapshots(): Promise<ConsentSnapshotStored[]> { return readConsentSnapshots(this.sql); }
  consentSnapshotMeta() { return consentSnapshotMeta(this.sql); }
  askConsentSnapshot(): Promise<boolean> { return askConsentSnapshot(this.sql); }
  clearConsentSnapshots(): Promise<void> { return clearConsentSnapshots(this.sql); }

  async flowSteps(): Promise<LinkFlowStep[] | null> {
    const [r] = await this.sql`select steps from link_mirror_state where kind = 'flows'`;
    return (r?.steps as LinkFlowStep[] | null | undefined) ?? null;
  }

  async flowAssignments(): Promise<LinkFlowAssign[]> {
    return (await this.sql`select * from link_flow_assign order by flow_id, person_id`).map((r) => ({ flowId: r.flow_id,
      personId: r.person_id, leaderId: r.leader_id, assignedBy: r.assigned_by, assignedAt: toIso(r.assigned_at) }));
  }
  async setFlowAssign(a: { flowId: string; personId: string; leaderId: string | null; assignedBy: string }): Promise<void> {
    if (a.leaderId === null) {
      await this.sql`delete from link_flow_assign where flow_id = ${a.flowId} and person_id = ${a.personId}`;
      return;
    }
    await this.sql`
      insert into link_flow_assign (flow_id, person_id, leader_id, assigned_by, assigned_at)
      values (${a.flowId}, ${a.personId}, ${a.leaderId}, ${a.assignedBy}, now())
      on conflict (flow_id, person_id) do update set leader_id = excluded.leader_id, assigned_by = excluded.assigned_by,
        assigned_at = now()`;
  }

  async setMatches(changes: { personId: string; studentId: string | null; match: Match }[]): Promise<void> {
    if (!changes.length) return;
    await this.sql.begin(async (tx) => {
      // CY-A2: link_roster_student_uq is not deferrable, so release every changed row first; a move or swap
      // within one push then never sees the student on two rows. A student held by a row outside the push still fails.
      await tx`update link_roster set student_id = null
               where person_id in ${tx(changes.map((c) => c.personId))} and student_id is not null`;
      for (const c of changes) {
        await tx`update link_roster set student_id = ${c.studentId}, match = ${c.match}, updated_at = now()
                 where person_id = ${c.personId}`;
      }
    });
  }

  async claimCreate(personId: string): Promise<boolean> {
    // F1 review: a claim with no student after 5 minutes (a create that died mid-way) can be taken again.
    const r = await this.sql`insert into link_created_students (person_id) values (${personId})
      on conflict (person_id) do update set created_at = now()
      where link_created_students.student_id is null and link_created_students.created_at < now() - interval '5 minutes'
      returning person_id`;
    return r.length === 1;
  }

  async settleCreate(personId: string, studentId: string | null): Promise<void> {
    if (studentId) await this.sql`update link_created_students set student_id = ${studentId} where person_id = ${personId}`;
    else await this.sql`delete from link_created_students where person_id = ${personId} and student_id is null`;
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

  async listLog(f: { from: string; to: string; userId?: string; event?: LogEvent; outboxId?: string; limit: number }): Promise<LinkLogRow[]> {
    const s = this.sql; const none = s``;
    return (await s`
      select * from link_log where at >= ${f.from} and at < ${f.to}
        ${f.userId ? s`and user_id = ${f.userId}` : none}
        ${f.event ? s`and event = ${f.event}` : none}
        ${f.outboxId ? s`and outbox_id = ${f.outboxId}` : none}
      order by at desc, id desc limit ${f.limit}`).map(toLog);
  }
}
