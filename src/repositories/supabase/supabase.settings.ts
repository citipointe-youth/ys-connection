import type { SqlClient } from './client';
import { toIso } from './client';
import type {
  ISettingsRepository,
  IAuditRepository,
} from '../interfaces/entity-repositories';
import type { AppSettings, AdminAuditEntry } from '../../core/entities/settings';
import { MinistryConfigSchema, MINISTRY_CONFIG_DEFAULTS } from '../../core/ministry-config';

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

const SETTINGS_ID = 'global';

// Parse the stored ministry_config resiliently. A corrupt/misencoded blob must
// NEVER throw here: this row is read on essentially every request, so a throw
// takes down the WHOLE app — including the Admin → Setup screen needed to fix
// it (this exact lockout happened 2026-07-11 when a legacy write double-encoded
// the config as a jsonb *string*). So: unwrap a stringified value (legacy
// double-encode) with JSON.parse, then schema-parse; on any failure fall back
// to defaults (current YS Brisbane behaviour) rather than bricking the app.
export function parseMinistryConfig(raw: unknown) {
  let v: unknown = raw ?? {};
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { v = {}; }
  }
  try {
    return MinistryConfigSchema.parse(v);
  } catch {
    return MINISTRY_CONFIG_DEFAULTS;
  }
}

function toAppSettings(row: Record<string, unknown>): AppSettings {
  return {
    id: (row['id'] as string | undefined) ?? SETTINGS_ID,
    termGapDays: row['term_gap_days'] as number,
    validThresholdPct: row['valid_threshold_pct'] as number,
    serviceMinAttendance: (row['service_min_attendance'] as number | null) ?? 100,
    ministryConfig: parseMinistryConfig(row['ministry_config']),
    updatedAt: toIso(row['updated_at']),
  };
}

function toAdminAuditEntry(row: Record<string, unknown>): AdminAuditEntry {
  return {
    id: row['id'] as string,
    action: row['action'] as AdminAuditEntry['action'],
    performedBy: row['performed_by'] as string,
    performedAt: toIso(row['performed_at']),
    detail: row['detail'] as string,
  };
}

const DEFAULT_SETTINGS: Omit<AppSettings, 'id' | 'updatedAt'> = {
  termGapDays: 14,
  validThresholdPct: 25,
  serviceMinAttendance: 100,
  // Not written by the first-row INSERT below (that relies on the column's own
  // SQL default `'{}'::jsonb`) — only present so this const satisfies the
  // AppSettings type.
  ministryConfig: MINISTRY_CONFIG_DEFAULTS,
};

// ---------------------------------------------------------------------------
// SupabaseSettingsRepository
// ---------------------------------------------------------------------------

export class SupabaseSettingsRepository implements ISettingsRepository {
  constructor(private sql: SqlClient) {}

  async init(): Promise<void> {
    // No-op: Supabase table already exists
  }

  async findById(id: string): Promise<AppSettings | null> {
    const rows = await this.sql`select * from app_settings where id = ${id}`;
    return rows[0] ? toAppSettings(rows[0]) : null;
  }

  async findAll(): Promise<AppSettings[]> {
    const rows = await this.sql`select * from app_settings where id = ${SETTINGS_ID}`;
    return rows.map(toAppSettings);
  }

  async getSettings(): Promise<AppSettings> {
    // Hot path is a pure READ. The settings row effectively always exists after the
    // first-ever call, so we must NOT run a write (upsert) on every request: getSettings
    // is called by every stats/batch load, and an INSERT opens a heavier transaction that,
    // if the serverless function is killed mid-flight (route timeout), orphans a Supavisor
    // backend for minutes in ClientRead and leaks pooler slots — the real mechanism behind
    // the 2026-07-05 503 incident (see CLAUDE.md). Only fall through to an insert of the
    // defaults if the row is genuinely missing (first-ever call), staying race-safe via
    // on-conflict for concurrent cold starts.
    const existing = await this.sql`select * from app_settings where id = ${SETTINGS_ID}`;
    if (existing[0]) return toAppSettings(existing[0]);

    const now = new Date().toISOString();
    const rows = await this.sql`
      insert into app_settings (
        id,
        term_gap_days,
        valid_threshold_pct,
        service_min_attendance,
        updated_at
      )
      values (
        ${SETTINGS_ID},
        ${DEFAULT_SETTINGS.termGapDays},
        ${DEFAULT_SETTINGS.validThresholdPct},
        ${DEFAULT_SETTINGS.serviceMinAttendance},
        ${now}
      )
      on conflict (id) do update set id = app_settings.id
      returning *
    `;
    return toAppSettings(rows[0]!);
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.getSettings();
    const merged: AppSettings = { ...current, ...patch };
    return this.save(merged);
  }

  async save(settings: AppSettings): Promise<AppSettings> {
    // Write jsonb via sql.json() (the porsager-native json Parameter, OID 3802) —
    // NOT `${JSON.stringify(cfg)}::jsonb`. postgres.js detects the ::jsonb cast,
    // types the parameter as jsonb, and runs its own JSON.stringify serializer;
    // handing it an already-stringified string double-encodes it into a jsonb
    // *string* (the 2026-07-11 config-lockout bug). This mirrors the audit repo.
    const ministryConfigParam = this.sql.json(
      (settings.ministryConfig ?? MINISTRY_CONFIG_DEFAULTS) as unknown as Parameters<typeof this.sql.json>[0],
    );
    const rows = await this.sql`
      insert into app_settings (
        id,
        term_gap_days,
        valid_threshold_pct,
        service_min_attendance,
        ministry_config,
        updated_at
      )
      values (
        ${SETTINGS_ID},
        ${settings.termGapDays},
        ${settings.validThresholdPct},
        ${settings.serviceMinAttendance},
        ${ministryConfigParam},
        ${settings.updatedAt}
      )
      on conflict (id) do update set
        term_gap_days          = excluded.term_gap_days,
        valid_threshold_pct    = excluded.valid_threshold_pct,
        service_min_attendance = excluded.service_min_attendance,
        ministry_config        = excluded.ministry_config,
        updated_at             = excluded.updated_at
      returning *
    `;
    return toAppSettings(rows[0]!);
  }

  async delete(_id: string): Promise<boolean> {
    // Settings row should never be deleted — no-op
    return false;
  }
}

// ---------------------------------------------------------------------------
// SupabaseAuditRepository
// ---------------------------------------------------------------------------

export class SupabaseAuditRepository implements IAuditRepository {
  constructor(private sql: SqlClient) {}

  async init(): Promise<void> {
    // No-op: Supabase table already exists
  }

  async findById(id: string): Promise<AdminAuditEntry | null> {
    const rows = await this.sql`select * from admin_audit where id = ${id}`;
    return rows[0] ? toAdminAuditEntry(rows[0]) : null;
  }

  async findAll(): Promise<AdminAuditEntry[]> {
    const rows = await this.sql`select * from admin_audit order by performed_at desc`;
    return rows.map(toAdminAuditEntry);
  }

  async findRecent(limit: number): Promise<AdminAuditEntry[]> {
    const rows =
      await this.sql`select * from admin_audit order by performed_at desc limit ${limit}`;
    return rows.map(toAdminAuditEntry);
  }

  async save(entry: AdminAuditEntry): Promise<AdminAuditEntry> {
    const rows = await this.sql`
      insert into admin_audit (id, action, performed_by, performed_at, detail)
      values (
        ${entry.id},
        ${entry.action},
        ${entry.performedBy},
        ${entry.performedAt},
        ${entry.detail}
      )
      on conflict (id) do update set
        action       = excluded.action,
        performed_by = excluded.performed_by,
        performed_at = excluded.performed_at,
        detail       = excluded.detail
      returning *
    `;
    return toAdminAuditEntry(rows[0]!);
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.sql`delete from admin_audit where id = ${id} returning id`;
    return rows.length > 0;
  }
}
