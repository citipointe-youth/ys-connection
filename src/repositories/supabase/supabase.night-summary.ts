// Supabase reads for POST /sync/night-summary. Read-only; every column is named, none carries a name or free text.
import type { SqlClient } from './client';
import { toIso } from './client';
import type { INightSummaryRepository, NightOutboxRow, NightTapRow, NightIntakeRow, NightUnsentRow, NightRosterRow } from '../interfaces/night-summary.repository';
import type { ActionType, LogEvent } from '../../core/link-types';

const ymd = (v: unknown) => (typeof v === 'string' ? v.slice(0, 10) : toIso(v).slice(0, 10));
const iso = (v: unknown) => (v == null ? null : toIso(v));

export class SupabaseNightSummaryRepository implements INightSummaryRepository {
  constructor(private readonly sql: SqlClient) {}

  async outbox(fromYmd: string, toYmd: string): Promise<NightOutboxRow[]> {
    // Window on service_date (link_outbox_date_idx); created_at's index is partial, so it is not used.
    const inWin = await this.sql`
      select type, status, reason, service_date, created_at, result_at, attempts from link_outbox
      where service_date between ${fromYmd} and ${toYmd} order by created_at`;
    // Open rows of any other date.
    const open = await this.sql`
      select type, status, reason, service_date, created_at, result_at, attempts from link_outbox
      where status in ('pending','claimed','unclear') and (service_date < ${fromYmd} or service_date > ${toYmd}) order by created_at`;
    const map = (inWindow: boolean) => (r: any): NightOutboxRow => ({ type: r.type as ActionType, status: r.status, reason: r.reason ?? null,
      serviceDate: ymd(r.service_date), createdAt: toIso(r.created_at), resultAt: iso(r.result_at), attempts: r.attempts, inWindow });
    return [...inWin.map(map(true)), ...open.map(map(false))];
  }

  async taps(fromIso: string, toIso_: string, limit: number): Promise<NightTapRow[]> {
    const rows = await this.sql`
      select at, event, outcome, device_id from link_log where at >= ${fromIso} and at < ${toIso_} order by at desc, id desc limit ${limit}`;
    return rows.map((r: any) => ({ at: toIso(r.at), event: r.event as LogEvent, outcome: r.outcome, deviceId: r.device_id ?? null }));
  }

  // The plan rows, grouped: the first hold's text is read here and goes only to the classifier, never to the response.
  async intakeRows(): Promise<NightIntakeRow[]> {
    const rows = await this.sql`
      select mode, date, status, reason, count(*)::int n
      from link_intake_rows
      group by 1, 2, 3, 4`;
    return rows.map((r: any) => ({ mode: r.mode, date: ymd(r.date), status: r.status, reason: r.reason ?? '', n: r.n }));
  }

  async notFoundHeldInIntake(siteToday: string): Promise<number> {
    const rows = await this.sql`
      select count(*)::int n from link_intake_rows c
      where c.mode = 'consent' and c.status = 'needs-you' and c.date <= ${siteToday} and c.reason = 'Not found in consent step'
        and exists (select 1 from link_intake_rows i where i.mode = 'intake' and i.person_id = c.person_id and i.status = 'needs-you')`;
    return rows[0]?.n ?? 0;
  }

  async unsent(): Promise<NightUnsentRow[]> {
    const rows = await this.sql`
      select reason, created_at
      from newperson_unsent`;
    return rows.map((r: any) => ({ reason: r.reason, createdAt: toIso(r.created_at) }));
  }

  async roster(): Promise<NightRosterRow[]> {
    const rows = await this.sql`
      select kind, match, active, grade is not null as has_grade, count(*)::int n
      from link_roster
      group by 1, 2, 3, 4`;
    return rows.map((r: any) => ({ kind: r.kind, match: r.match, active: r.active, hasGrade: r.has_grade, n: r.n }));
  }
}
