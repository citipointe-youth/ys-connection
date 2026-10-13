// X19 (T4): Supabase intake plans (migration 0021, RLS on). `detail` is the whole pushed row as JSON, encrypted with
// field-crypto (AAD 'link_intake_rows.detail:<mode>:<date>:<key>'); one blob covers the phones, the DOB and the step keys.
// A detail that will not decrypt reads as unreadable (logged with the row key only), never failing the whole read.
import type { SqlClient } from './client';
import { toIso } from './client';
import { chunk } from './bulk';
import { maybeDecrypt, maybeEncrypt } from '../../utils/field-crypto';
import type { ILinkIntakeRepository, IntakeDateRow, IntakeMode, IntakePushMeta, IntakeRowLite, IntakeRowWrite, PlanStatus }
  from '../interfaces/link-intake.repository';

type Row = Record<string, any>;
const iso = (v: unknown) => (v == null ? null : toIso(v));
const ymd = (v: unknown) => (typeof v === 'string' ? v.slice(0, 10) : toIso(v).slice(0, 10));
export const detailAad = (mode: string, date: string, key: string) => `link_intake_rows.detail:${mode}:${date}:${key}`;

function toLite(r: Row): IntakeRowLite {
  return { mode: r.mode as IntakeMode, date: ymd(r.date), key: r.key, status: r.status as PlanStatus, title: r.title,
    reason: r.reason ?? '', outcome: r.outcome ?? '', fromApp: r.from_app, hasText: r.has_text, takenAt: toIso(r.taken_at), doneAt: iso(r.done_at) };
}
function toDate(r: Row): IntakeDateRow {
  return { mode: r.mode as IntakeMode, date: ymd(r.date), takenAt: iso(r.taken_at), consoleId: r.console_id ?? null,
    rowCount: r.row_count, cut: r.cut, inputsFrom: r.inputs_from ?? null, inputsAt: iso(r.inputs_at),
    refreshAskedAt: iso(r.refresh_asked_at) };
}

export class SupabaseLinkIntakeRepository implements ILinkIntakeRepository {
  constructor(private sql: SqlClient) {}

  async replace(mode: IntakeMode, m: IntakePushMeta, rows: IntakeRowWrite[]) {
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`link_intake:${mode}:${m.date}`}))`;
      const [st] = await tx`
        select ${m.takenAt}::timestamptz <= taken_at as stale from link_intake_dates where mode = ${mode} and date = ${m.date}`;
      if (st?.stale) return { applied: false, rows: 0 };
      await tx`delete from link_intake_rows where mode = ${mode} and date = ${m.date}`;
      for (const b of chunk(rows)) {
        await tx`insert into link_intake_rows ${tx(b.map((x) => {
          const done = x.status === 'done';
          return { mode, date: m.date, key: x.key, status: x.status, title: x.title, reason: x.reason, outcome: x.outcome, from_app: x.fromApp,
            has_text: x.hasText, taken_at: m.takenAt, done_at: done ? new Date().toISOString() : null,
            detail: done ? null : maybeEncrypt(JSON.stringify(x.detail), detailAad(mode, m.date, x.key)) };
        }))}`;
      }
      await tx`
        insert into link_intake_dates (mode, date, taken_at, console_id, row_count, cut, inputs_from, inputs_at, refresh_asked_at, applied_at)
        values (${mode}, ${m.date}, ${m.takenAt}, ${m.consoleId}, ${rows.length}, ${m.cut}, ${m.inputs?.from ?? null},
                ${m.inputs?.at ?? null}, null, now())
        on conflict (mode, date) do update set taken_at = excluded.taken_at, console_id = excluded.console_id,
          row_count = excluded.row_count, cut = excluded.cut, inputs_from = excluded.inputs_from, inputs_at = excluded.inputs_at,
          refresh_asked_at = null, applied_at = now()`;
      return { applied: true, rows: rows.length };
    });
  }

  async dates(mode?: IntakeMode) {
    const s = this.sql;
    return (await s`select * from link_intake_dates ${mode ? s`where mode = ${mode}` : s``} order by date desc, mode`).map(toDate);
  }

  async rows(mode: IntakeMode, date?: string) {
    const s = this.sql;
    return (await s`
      select mode, date, key, status, title, reason, outcome, from_app, has_text, taken_at, done_at from link_intake_rows
      where mode = ${mode} ${date ? s`and date = ${date}` : s``} order by date, title, key`).map(toLite);
  }

  async detail(mode: IntakeMode, date: string, key: string) {
    const [r] = await this.sql`select * from link_intake_rows where mode = ${mode} and date = ${date} and key = ${key}`;
    if (!r) return null;
    try {
      const plain = maybeDecrypt(r.detail, detailAad(mode, date, key));
      return { row: toLite(r), detail: plain == null ? null : JSON.parse(plain), unreadable: false };
    } catch {
      return { row: toLite(r), detail: null, unreadable: true };
    }
  }

  async askRefresh(mode: IntakeMode, date: string) {
    const r = await this.sql`
      insert into link_intake_dates (mode, date, refresh_asked_at) values (${mode}, ${date}, now())
      on conflict (mode, date) do update set refresh_asked_at = now()
        where link_intake_dates.refresh_asked_at is null or link_intake_dates.refresh_asked_at < now() - interval '60 seconds'
      returning mode`;
    return r.length > 0;
  }

  async markViewed() {
    await this.sql`insert into link_intake_view (id, viewed_at) values (1, now()) on conflict (id) do update set viewed_at = now()`;
  }
  async viewedAt() {
    const [r] = await this.sql`select viewed_at from link_intake_view where id = 1`;
    return iso(r?.viewed_at);
  }

  async purge(before: string) {
    await this.sql`delete from link_intake_rows where date < ${before}`;
    await this.sql`delete from link_intake_dates where date < ${before}`;
  }

  async clear() {
    await this.sql.begin(async (tx) => {
      await tx`delete from link_intake_rows`;
      await tx`delete from link_intake_dates`;
      await tx`delete from link_intake_view`;
    });
  }
}
