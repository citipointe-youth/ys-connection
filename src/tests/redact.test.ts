import { describe, it, expect } from 'vitest';
import { redactSecrets, safeErrorText } from '../utils/redact';
import { checkDatabaseUrl } from '../migrate/url-check';
import { isProductionEnv } from '../config/is-production';

describe('redactSecrets', () => {
  it('hides a connection string with symbols in the password', () => {
    const out = redactSecrets('bad input postgresql://postgres.abc:SECRETpa#ss@host:5432/postgres here');
    expect(out).not.toMatch(/SECRET|pa#ss|host/);
    expect(out).toContain('postgres://[hidden]');
  });
  it('safeErrorText never includes an input property or the password', () => {
    const err = Object.assign(new Error('Invalid URL'), { code: 'ERR_INVALID_URL', input: 'postgresql://u:SECRETpa#ss@h/db' });
    const out = safeErrorText(err);
    expect(out).toContain('ERR_INVALID_URL');
    expect(out).not.toContain('SECRET');
  });
  it('redacts a URL inside a message', () => {
    expect(safeErrorText(new Error('failed postgres://u:SECRET@h/db'))).not.toContain('SECRET');
  });
});

describe('checkDatabaseUrl', () => {
  it('accepts a normal session pooler string and returns only the host', () => {
    expect(checkDatabaseUrl('postgresql://u:p@aws.pooler.supabase.com:5432/postgres')).toEqual({ ok: true, host: 'aws.pooler.supabase.com' });
    expect(checkDatabaseUrl('postgresql://u:p@h/postgres')).toEqual({ ok: true, host: 'h' });
  });
  it('stops on port 6543 without the URL', () => {
    const r = checkDatabaseUrl('postgresql://u:SECRET@h:6543/postgres');
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.message).toMatch(/6543/); expect(r.message).not.toContain('SECRET'); }
  });
  it('stops on an unparseable string without the password', () => {
    const r = checkDatabaseUrl('postgresql://postgres.abc:SECRETpa#ss@h:5432/postgres');
    // '#' ends the authority, so the password is cut and the host part is invalid
    if (!r.ok) { expect(r.message).not.toContain('SECRET'); expect(r.message).toMatch(/not a valid connection string/); }
    const bad = checkDatabaseUrl('not a url SECRET');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).not.toContain('SECRET');
  });
});

describe('isProductionEnv', () => {
  it('is false locally and true on NODE_ENV, VERCEL or VERCEL_ENV', () => {
    expect(isProductionEnv({})).toBe(false);
    expect(isProductionEnv({ NODE_ENV: 'development' })).toBe(false);
    expect(isProductionEnv({ NODE_ENV: 'production' })).toBe(true);
    expect(isProductionEnv({ VERCEL: '1' })).toBe(true);
    expect(isProductionEnv({ VERCEL_ENV: 'preview' })).toBe(true);
  });
});
