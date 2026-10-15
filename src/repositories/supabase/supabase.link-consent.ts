// Rev 6 (R2 b/c, run 2026-10-15): one consentLookup answer per request (migration 0027 link_consent_lookup). The rows
// (names, consent dates) are a TEXT column encrypted with FIELD_ENCRYPTION_KEY (AAD link_consent_lookup.rows:<request_id>),
// never jsonb. Answers are kept 24 h. The one log line names a request id, never a value.
import type { SqlClient } from './client';
import { toIso } from './client';
import { maybeEncrypt, maybeDecrypt } from '../../utils/field-crypto';
import type { ConsentLookupStored } from '../interfaces/link.repository';
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
  let rows: unknown[] = [];
  try { rows = JSON.parse(maybeDecrypt(r.rows, aad(requestId)) ?? '[]'); } catch { logger.warn('consent lookup unreadable', { requestId }); }
  return { requestId, kind: r.kind, page: r.page, pageSize: r.page_size, total: r.total ?? null, rows, takenAt: toIso(r.taken_at) };
}
