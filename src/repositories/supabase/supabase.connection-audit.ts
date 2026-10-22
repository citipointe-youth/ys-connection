import type { SqlClient } from './client';
import { toIso } from './client';
import type { IConnectionAuditRepository, AuditSummary } from '../interfaces/entity-repositories';
import type { ConnectionAudit, AuditSnapshot, StoredAuditSource, AuditSource, AuditFailReason } from '../../core/entities/connection-audit';

function toConnectionAudit(row: Record<string, unknown>): ConnectionAudit {
  return {
    id: row['id'] as string,
    year: row['year'] as number,
    label: row['label'] as string,
    uploadedBy: row['uploaded_by'] as string,
    uploadedAt: toIso(row['uploaded_at']),
    snapshot: row['snapshot'] as AuditSnapshot,
  };
}

const isoOrNull = (v: unknown): string | null => (v == null ? null : toIso(v));
function toSource(r: Record<string, unknown>): StoredAuditSource {
  return { year: r['year'] as number, source: r['source'] as AuditSource, headers: r['headers'] as string[], rows: r['rows'] as string[][],
    rowCount: r['row_count'] as number, takenAt: toIso(r['taken_at']), exportedAt: toIso(r['exported_at']), fedAt: isoOrNull(r['fed_at']),
    fedBy: (r['fed_by'] as 'console' | 'manual' | null) ?? null, lastFailedAt: isoOrNull(r['last_failed_at']),
    lastFailReason: (r['last_fail_reason'] as AuditFailReason | null) ?? null };
}

export class SupabaseConnectionAuditRepository implements IConnectionAuditRepository {
  constructor(private sql: SqlClient) {}

  async init(): Promise<void> {
    // No-op: Supabase table already exists (migration 009).
  }

  async findById(id: string): Promise<ConnectionAudit | null> {
    const rows = await this.sql`select * from connection_audits where id = ${id}`;
    return rows[0] ? toConnectionAudit(rows[0]) : null;
  }

  async findByYear(year: number): Promise<ConnectionAudit | null> {
    const rows = await this.sql`select * from connection_audits where year = ${year}`;
    return rows[0] ? toConnectionAudit(rows[0]) : null;
  }

  async findAll(): Promise<ConnectionAudit[]> {
    const rows = await this.sql`select * from connection_audits order by year desc`;
    return rows.map(toConnectionAudit);
  }

  async save(audit: ConnectionAudit): Promise<ConnectionAudit> {
    const rows = await this.sql`
      insert into connection_audits (id, year, label, uploaded_by, uploaded_at, snapshot)
      values (
        ${audit.id},
        ${audit.year},
        ${audit.label},
        ${audit.uploadedBy},
        ${audit.uploadedAt},
        ${this.sql.json(audit.snapshot as unknown as Parameters<typeof this.sql.json>[0])}
      )
      on conflict (id) do update set
        year        = excluded.year,
        label       = excluded.label,
        uploaded_by = excluded.uploaded_by,
        uploaded_at = excluded.uploaded_at,
        snapshot    = excluded.snapshot
      returning *
    `;
    return toConnectionAudit(rows[0]!);
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.sql`delete from connection_audits where id = ${id} returning id`;
    return rows.length > 0;
  }
  private j(v: unknown) { return this.sql.json(v as Parameters<typeof this.sql.json>[0]); }

  async findAllSummaries(): Promise<AuditSummary[]> {
    const rows = await this.sql`
      select year, label, uploaded_at, jsonb_path_query_array(snapshot, '$.terms[*].key') as term_keys
      from connection_audits order by year desc`;
    return rows.map((r) => ({ year: r['year'] as number, label: r['label'] as string, uploadedAt: toIso(r['uploaded_at']),
      termKeys: (r['term_keys'] as string[] | null) ?? [] }));
  }

  async saveSource(s: StoredAuditSource): Promise<void> {
    await this.sql`
      insert into connection_audit_sources (year, source, headers, rows, row_count, taken_at, exported_at, fed_at, fed_by,
        last_failed_at, last_fail_reason)
      values (${s.year}, ${s.source}, ${this.sql.json(s.headers)}, ${this.j(s.rows)}, ${s.rowCount}, ${s.takenAt}, ${s.exportedAt},
        ${s.fedAt}, ${s.fedBy}, ${s.lastFailedAt}, ${s.lastFailReason})
      on conflict (year, source) do update set headers = excluded.headers, rows = excluded.rows, row_count = excluded.row_count,
        taken_at = excluded.taken_at, exported_at = excluded.exported_at, fed_at = excluded.fed_at, fed_by = excluded.fed_by,
        last_failed_at = excluded.last_failed_at, last_fail_reason = excluded.last_fail_reason`;
  }

  async sources(year: number): Promise<StoredAuditSource[]> {
    return (await this.sql`select * from connection_audit_sources where year = ${year} order by source`).map(toSource);
  }

  async deleteAllSources(): Promise<void> {
    await this.sql`delete from connection_audit_sources`;
  }

  async withYearLock<T>(year: number, fn: (tx: IConnectionAuditRepository) => Promise<T>): Promise<T> {
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${'audit:' + year}))`;
      return fn(new SupabaseConnectionAuditRepository(tx as unknown as SqlClient));
    }) as Promise<T>;
  }
}
