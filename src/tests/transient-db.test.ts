import { describe, it, expect } from 'vitest';
import { isTransientDbError } from '../utils/transient-db';
import { errorResponse } from '../api/middleware/error.middleware';

// 2026-10-14: after a deploy the Supavisor session pool (15) filled and GET /bus/run
// returned 500 "An unexpected error occurred" instead of a retryable 503.
const poolerFull = Object.assign(
  new Error('(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15'),
  { code: 'XX000', name: 'PostgresError' },
);

describe('isTransientDbError: pooler full', () => {
  it('treats Supavisor EMAXCONNSESSION / EMAXCONN as transient', () => {
    expect(isTransientDbError(poolerFull)).toBe(true);
    expect(isTransientDbError(Object.assign(new Error('(EMAXCONN) max client connections reached, limit: 200'), { code: 'XX000' }))).toBe(true);
  });
  it('leaves other XX000 errors as real errors', () => {
    expect(isTransientDbError(Object.assign(new Error('could not open relation'), { code: 'XX000' }))).toBe(false);
  });
  it('maps the pooler-full error to 503 SERVICE_UNAVAILABLE (SPA retries a GET once)', () => {
    const r = errorResponse(poolerFull);
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('SERVICE_UNAVAILABLE');
  });
});
