import { describe, it, expect, vi } from 'vitest';
import { InMemoryUserRepository } from '../repositories/in-memory/in-memory.repositories';
import { makeSetupService, codeMatches } from '../services/setup.service';
import type { AuthService } from '../services/auth.service';

const fakeAuth = { issueTokenFor: vi.fn(async (id: string) => `tok-${id}`) } as unknown as AuthService;
const good = { PERSISTENCE: 'supabase', DATABASE_URL: 'postgresql://u:p@h.example.com:5432/postgres', SESSION_SECRET: 's'.repeat(64),
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'), APP_ORIGIN: 'https://church.vercel.app', SETUP_CODE: 'ABCD-EFGH-JKMN-PQRS-TUVW' };

function svc(env: Record<string, string | undefined> = good, over: Partial<Parameters<typeof makeSetupService>[0]> = {}) {
  const users = new InMemoryUserRepository();
  const s = makeSetupService({ users, auth: fakeAuth, env, probeDb: async () => true, schemaVersion: async () => '0015', ...over });
  return { s, users };
}
const byId = (checks: { id: string }[], id: string) => checks.find((c) => c.id === id) as any;

describe('codeMatches', () => {
  it('ignores spaces, dashes and case', () => {
    expect(codeMatches(' abcd-efgh-jkmn-pqrs-tuvw ', 'ABCD-EFGH-JKMN-PQRS-TUVW')).toBe(true);
    expect(codeMatches('ABCDEFGHJKMNPQRSTUVW', 'ABCD-EFGH-JKMN-PQRS-TUVW')).toBe(true);
    expect(codeMatches('ABCD-EFGH-JKMN-PQRS-TUVX', 'ABCD-EFGH-JKMN-PQRS-TUVW')).toBe(false);
  });
});

describe('needsAdmin', () => {
  it('true with no users, false once an active admin exists, true when the DB throws', async () => {
    const { s } = svc();
    expect(await s.needsAdmin()).toBe(true);
    await s.createFirstAdmin({ code: good.SETUP_CODE, displayName: 'Pat', password: 'longenough' });
    expect(await s.needsAdmin()).toBe(false);
    const broken = new InMemoryUserRepository();
    broken.countActiveAdmins = async () => { throw new Error('down'); };
    expect(await makeSetupService({ users: broken, auth: fakeAuth, env: good, probeDb: async () => false, schemaVersion: async () => null }).needsAdmin()).toBe(true);
  });
});

describe('createFirstAdmin', () => {
  it('creates username admin and returns { token, user } without a password hash', async () => {
    const { s, users } = svc();
    const r = await s.createFirstAdmin({ code: good.SETUP_CODE, displayName: '', password: 'longenough' });
    expect(r.token).toMatch(/^tok-/);
    expect(r.user).toMatchObject({ email: 'admin', role: 'admin', displayName: 'Admin', mustChangePassword: false, status: 'active' });
    expect((r.user as any).passwordHash).toBeUndefined();
    expect((await users.findByEmail('admin'))!.grade).toBeNull();
  });
  it('409 when an admin exists', async () => {
    const { s } = svc();
    await s.createFirstAdmin({ code: good.SETUP_CODE, displayName: 'A', password: 'longenough' });
    await expect(s.createFirstAdmin({ code: good.SETUP_CODE, displayName: 'B', password: 'longenough' }))
      .rejects.toMatchObject({ statusCode: 409, message: 'An admin already exists. Log in.' });
  });
  it('concurrent second call -> exactly one admin, the other 409', async () => {
    const { s, users } = svc();
    const res = await Promise.allSettled([
      s.createFirstAdmin({ code: good.SETUP_CODE, displayName: 'A', password: 'longenough' }),
      s.createFirstAdmin({ code: good.SETUP_CODE, displayName: 'B', password: 'longenough' }),
    ]);
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await users.findByRole('admin'))).toHaveLength(1);
  });
  it('400 when SETUP_CODE is missing or short', async () => {
    for (const code of [undefined, 'short-code']) {
      const { s } = svc({ ...good, SETUP_CODE: code });
      await expect(s.createFirstAdmin({ code: 'anything', displayName: 'A', password: 'longenough' })).rejects.toMatchObject({
        statusCode: 400, message: 'SETUP_CODE is missing or too short. In Vercel, add a SETUP_CODE of 16 or more characters. Then redeploy.' });
    }
  });
  it('403 on a wrong code', async () => {
    const { s } = svc();
    await expect(s.createFirstAdmin({ code: 'WRONG-WRONG-WRONG-WRON', displayName: 'A', password: 'longenough' })).rejects.toMatchObject({
      statusCode: 403, message: 'The setup code is wrong. In Vercel, open Settings > Environment Variables. Copy SETUP_CODE again.' });
  });
  it('rejects a short password with the existing validation', async () => {
    const { s } = svc();
    await expect(s.createFirstAdmin({ code: good.SETUP_CODE, displayName: 'A', password: 'short' })).rejects.toThrow();
  });
  it('400 when SESSION_SECRET is not usable (no admin is created)', async () => {
    const { s, users } = svc({ ...good, SESSION_SECRET: undefined, NODE_ENV: 'production' }, { sessionSecretOk: () => false });
    await expect(s.createFirstAdmin({ code: good.SETUP_CODE, displayName: 'A', password: 'longenough' })).rejects.toMatchObject({ statusCode: 400 });
    expect(await users.findByEmail('admin')).toBeNull();
  });
});

describe('status', () => {
  const ids = ['persistence', 'database', 'databasePort', 'schema', 'sessionSecret', 'encryptionKey', 'appOrigin', 'setupCode', 'google'];
  it('all ok rows, in order, while needsAdmin', async () => {
    const { s } = svc();
    const r = await s.status(null, 'https://church.vercel.app');
    expect(r.needsAdmin).toBe(true);
    expect(r.checks.map((c) => c.id)).toEqual(ids);
    expect(r.checks.filter((c) => c.id !== 'google').every((c) => c.state === 'ok')).toBe(true);
    expect(byId(r.checks, 'google').state).toBe('optional');
  });
  it('never returns env values or the DB host', async () => {
    const { s } = svc();
    const text = JSON.stringify(await s.status(null, 'https://church.vercel.app'));
    for (const v of [good.SESSION_SECRET, good.FIELD_ENCRYPTION_KEY, good.SETUP_CODE, 'h.example.com', good.DATABASE_URL]) expect(text).not.toContain(v);
  });
  it('fix rows with generate hints', async () => {
    const { s } = svc({ PERSISTENCE: 'memory' }, { probeDb: async () => false, schemaVersion: async () => null });
    const r = await s.status(null, 'https://church.vercel.app');
    expect(byId(r.checks, 'persistence')).toMatchObject({ state: 'fix', fix: 'In Vercel, set PERSISTENCE to supabase. Then redeploy.' });
    expect(byId(r.checks, 'database').state).toBe('fix');
    expect(byId(r.checks, 'schema').state).toBe('fix');
    expect(byId(r.checks, 'sessionSecret')).toMatchObject({ state: 'fix', generate: 'hex32' });
    expect(byId(r.checks, 'encryptionKey')).toMatchObject({ state: 'fix', generate: 'base64key' });
    expect(byId(r.checks, 'encryptionKey').fix).toContain('WARNING: Save this key in a safe place.');
    expect(byId(r.checks, 'setupCode')).toMatchObject({ state: 'fix', generate: 'setupCode' });
    expect(byId(r.checks, 'appOrigin').fix).toBe('In Vercel, set APP_ORIGIN to https://church.vercel.app. Then redeploy.');
  });
  it('databasePort: empty port and query string are ok; 6543 and garbage are fix', async () => {
    const port = async (url: string | undefined) => byId((await svc({ ...good, DATABASE_URL: url }).s.status(null, 'https://church.vercel.app')).checks, 'databasePort').state;
    expect(await port('postgresql://u:p@h/postgres')).toBe('ok');
    expect(await port('postgresql://u:p@h:5432/postgres?pgbouncer=true')).toBe('ok');
    expect(await port('postgresql://u:p@h:6543/postgres')).toBe('fix');
    expect(await port('not a url')).toBe('fix');
    expect(await port(undefined)).toBe('fix');
  });
  it('appOrigin ignores case and a trailing slash', async () => {
    const st = async (appOrigin: string, req: string) => byId((await svc({ ...good, APP_ORIGIN: appOrigin }).s.status(null, req)).checks, 'appOrigin').state;
    expect(await st('https://Church.vercel.app/', 'https://church.vercel.app')).toBe('ok');
    expect(await st('https://church.vercel.app', 'https://other.vercel.app')).toBe('fix');
  });
  it('setupCode row only while needsAdmin; then admin-only access', async () => {
    const { s } = svc();
    await s.createFirstAdmin({ code: good.SETUP_CODE, displayName: 'A', password: 'longenough' });
    await expect(s.status(null, 'https://church.vercel.app')).rejects.toMatchObject({ statusCode: 401 });
    const grade = { id: 'g', role: 'grade' } as any;
    await expect(s.status(grade, 'https://church.vercel.app')).rejects.toMatchObject({ statusCode: 403 });
    const admin = { id: 'a', role: 'admin' } as any;
    const r = await s.status(admin, 'https://church.vercel.app');
    expect(r.needsAdmin).toBe(false);
    expect(r.checks.map((c) => c.id)).not.toContain('setupCode');
  });
  it('public when the DB is down (needsAdmin cannot be determined)', async () => {
    const users = new InMemoryUserRepository();
    users.countActiveAdmins = async () => { throw new Error('down'); };
    const s = makeSetupService({ users, auth: fakeAuth, env: good, probeDb: async () => false, schemaVersion: async () => null });
    const r = await s.status(null, 'https://church.vercel.app');
    expect(r.needsAdmin).toBe(true);
    expect(byId(r.checks, 'database').state).toBe('fix');
  });
  it('google row text', async () => {
    const r = await svc().s.status(null, 'https://church.vercel.app');
    expect(byId(r.checks, 'google')).toMatchObject({ state: 'optional', label: 'Google: not set up. Bus uses test routes.' });
  });
});
