// Rev 6 (R2 b/c, run 2026-10-15): one consentLookup answer per request (migration 0027 link_consent_lookup). The rows
// (names, consent dates) are a TEXT column encrypted with FIELD_ENCRYPTION_KEY (AAD link_consent_lookup.rows:<request_id>),
// never jsonb. Answers are kept 24 h. The one log line names a request id, never a value.
import type { SqlClient } from './client';
import { toIso } from './client';
import { maybeEncrypt, maybeDecrypt } from '../../utils/field-crypto';
import type { ConsentLookupStored, ConsentSnapshotStored } from '../interfaces/link.repository';
import { CONSENT_LOOKUP_KEEP_MS } from '../interfaces/link.repository';
import { createLogger } from '../../utils/logger';

const logger = createLogger('link');
const aad = (id: string) => 'link_consent_lookup.rows:' + id;
const keepS = CONSENT_LOOKUP_KEEP_MS / 1000;

export async function putConsentLookup(sql: SqlClient, r: ConsentLookupStored & { consoleId: string }): Promise<void> {
  await sql`delete from link_consent_lookup where created_at < now() - make_interval(secs => ${keepS})`;
  const rows = maybeEncrypt(JSON.stringify(r.rows), aad(r.requestId)) ?? '[]';
  await sql`
    insert into link_consent_lookup (request_id, kind, page, page_size, total, rows, taken_at, console_id)
    values (${r.requestId}, ${r.kind}, ${r.page}, ${r.pageSize}, ${r.total}, ${rows}, ${r.takenAt}, ${r.consoleId})
    on conflict (request_id) do update set kind = excluded.kind, page = excluded.page, page_size = excluded.page_size,
      total = excluded.total, rows = excluded.rows, taken_at = excluded.taken_at, console_id = excluded.console_id, created_at = now()`;
}

export async function readConsentLookup(sql: SqlClient, requestId: string): Promise<ConsentLookupStored | null> {
  const [r] = await sql`select * from link_consent_lookup where request_id = ${requestId}
    and created_at >= now() - make_interval(secs => ${keepS})`;
  if (!r) return null;
  let rows: unknown[] = [], unreadable = false;
  try { rows = JSON.parse(maybeDecrypt(r.rows, aad(requestId)) ?? '[]'); } catch { unreadable = true; logger.warn('consent lookup unreadable', { requestId }); }
  return { ...(unreadable && { unreadable: true as const }), requestId, kind: r.kind, page: r.page, pageSize: r.page_size, total: r.total ?? null, rows, takenAt: toIso(r.taken_at) };
}

// Rev 19 (consent hub): the standing copy per kind (0045). Encrypted like a lookup answer; a newer takenAt only.
const snapAad = (kind: string) => 'link_consent_snapshot.rows:' + kind;
export async function putConsentSnapshot(sql: SqlClient, r: ConsentSnapshotStored & { consoleId: string }): Promise<boolean> {
  const rows = maybeEncrypt(JSON.stringify(r.rows), snapAad(r.kind)) ?? '[]';
  const got = await sql`
    insert into link_consent_snapshot (kind, total, rows, taken_at, console_id, applied_at)
    values (${r.kind}, ${r.total}, ${rows}, ${r.takenAt}, ${r.consoleId}, now())
    on conflict (kind) do update set total = excluded.total, rows = excluded.rows, taken_at = excluded.taken_at,
      console_id = excluded.console_id, applied_at = now()
    where link_consent_snapshot.taken_at < excluded.taken_at
    returning kind`;
  return got.length > 0;
}
export async function readConsentSnapshots(sql: SqlClient): Promise<ConsentSnapshotStored[]> {
  return (await sql`select * from link_consent_snapshot`).map((r) => {
    try { return { kind: r.kind, total: r.total ?? null, rows: JSON.parse(maybeDecrypt(r.rows, snapAad(r.kind)) ?? '[]'), takenAt: toIso(r.taken_at) }; }
    catch { logger.warn('consent snapshot unreadable', { kind: r.kind }); return { kind: r.kind, total: null, rows: [], takenAt: toIso(r.taken_at), unreadable: true as const }; }
  });
}
export async function consentSnapshotMeta(sql: SqlClient) {
  const [a] = await sql`select asked_at from link_consent_snap_ask where id = 1`;
  const t = await sql`select kind, taken_at from link_consent_snapshot`;
  return { askedAt: a ? toIso(a.asked_at) : null, taken: t.map((r) => ({ kind: r.kind, takenAt: toIso(r.taken_at) })) };
}
export async function askConsentSnapshot(sql: SqlClient): Promise<boolean> {
  const r = await sql`
    insert into link_consent_snap_ask (id, asked_at) values (1, now())
    on conflict (id) do update set asked_at = now() where link_consent_snap_ask.asked_at < now() - interval '60 seconds'
    returning id`;
  return r.length > 0;
}
export async function clearConsentSnapshots(sql: SqlClient): Promise<void> {
  await sql`delete from link_consent_snapshot`;
  await sql`delete from link_consent_snap_ask`;
}
