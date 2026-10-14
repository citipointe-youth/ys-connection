// Transient DB / connection failures — surface as 503 (retryable) rather than 500
// so logs and monitoring separate infra hiccups (cold/exhausted pooler, dropped
// connection, statement timeout) from real bugs. The SPA treats both as a failed
// fetch, so user-facing behaviour is unchanged. Codes cover Node socket errors,
// the porsager driver's connection codes, and Postgres SQLSTATE class 08 + a few
// transient server states.
export const TRANSIENT_DB_CODES = new Set([
  'CONNECTION_CLOSED', 'CONNECTION_ENDED', 'CONNECTION_DESTROYED', 'CONNECT_TIMEOUT',
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE',
  '08000', '08001', '08003', '08004', '08006', // class 08 — connection exception
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '53300', // too_many_connections (pool/connection-limit exhaustion)
  '57014', // query_canceled (statement_timeout)
  '57P01', // admin_shutdown
]);

// Supavisor refuses a new client with SQLSTATE XX000 (internal_error) and a message
// like "(EMAXCONNSESSION) max clients reached in session mode" / "(EMAXCONN) ...".
// XX000 alone is too broad, so match the pooler's own tag.
const POOLER_FULL_RE = /\(EMAXCONN\w*\)/;

export function isTransientDbError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = e?.code;
  if (typeof code !== 'string') return false;
  if (TRANSIENT_DB_CODES.has(code)) return true;
  return code === 'XX000' && typeof e?.message === 'string' && POOLER_FULL_RE.test(e.message);
}

/** Any error from the database or its connection: a transient code, a Postgres SQLSTATE, or the driver's error class. */
export function isDbError(err: unknown): boolean {
  if (isTransientDbError(err)) return true;
  const e = err as { code?: unknown; name?: unknown } | null;
  return e?.name === 'PostgresError' || (typeof e?.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code));
}
