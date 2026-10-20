import { describe, it, expect, vi } from 'vitest';
import { InMemoryUserRepository, InMemorySettingsRepository } from '../repositories/in-memory/in-memory.repositories';
import { makeSetupService, codeMatches } from '../services/setup.service';
import type { AuthService } from '../services/auth.service';
import { LATEST_MIGRATION } from '../core/schema-version';

const fakeAuth = { issueTokenFor: vi.fn(async (id: string) => `tok-${id}`) } as unknown as AuthService;
const good = { PERSISTENCE: 'supabase', DATABASE_URL: 'postgresql://u:p@h.example.com:5432/postgres', SESSION_SECRET: 's'.repeat(64),
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'), APP_ORIGIN: 'https://church.vercel.app', SETUP_CODE: 'ABCD-EFGH-JKMN-PQRS-TUVW' };

function svc(env: Record<string, string | undefined> = good, over: Partial<Parameters<typeof makeSetupService>[0]> = {}) {
  const users = (over.users as InMemoryUserRepository | undefined) ?? new InMemoryUserRepository();
  const s = makeSetupService({ users, auth: fakeAuth, env, probeDb: async () => true, schemaVersion: async () => LATEST_MIGRATION, ...over });
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

describe('createFirstAdmin: new installs default to Simple logins', () => {
  const body = { code: good.SETUP_CODE, displayName: 'A', password: 'longenough' };
  it('stores logins.simple, gradeRoleWasOn and Grade off', async () => {
    const settings = new InMemorySettingsRepository();
    const { s } = svc(good, { settings });
    await s.createFirstAdmin(body);
    const cfg = (await settings.getSettings()).ministryConfig;
    expect(cfg.logins.simple).toBe(true);
    expect(cfg.logins.gradeRoleWasOn).toBe(true);
    expect(cfg.roles.enabled.grade).toBe(false);
  });
  it('writes the settings before the admin is created', async () => {
    const settings = new InMemorySettingsRepository();
    const users = new InMemoryUserRepository();
    const order: string[] = [];
    const upd = settings.updateSettings.bind(settings);
    settings.updateSettings = async (p) => { order.push('settings'); return upd(p); };
    const mk = users.createFirstAdmin.bind(users);
    users.createFirstAdmin = async (u) => { order.push('admin'); return mk(u); };
    const { s } = svc(good, { settings, users });
    await s.createFirstAdmin(body);
    expect(order).toEqual(['settings', 'admin']);
  });
  it('if the admin create throws, the settings write has happened and a retry succeeds', async () => {
    const settings = new InMemorySettingsRepository();
    const users = new InMemoryUserRepository();
    const mk = users.createFirstAdmin.bind(users);
    let fail = true;
    users.createFirstAdmin = async (u) => { if (fail) { fail = false; throw new Error('db down'); } return mk(u); };
    const { s } = svc(good, { settings, users });
    await expect(s.createFirstAdmin(body)).rejects.toThrow('db down');
    expect((await settings.getSettings()).ministryConfig.logins.simple).toBe(true);
    const r = await s.createFirstAdmin(body);
    expect(r.user.role).toBe('admin');
  });
  it('with no settings dep behaves as before', async () => {
    const { s } = svc();
    const r = await s.createFirstAdmin(body);
    expect(r.user.role).toBe('admin');
  });
});

describe('status', () => {
  const ids = ['persistence', 'database', 'databasePort', 'schema', 'sessionSecret', 'encryptionKey', 'appOrigin', 'setupCode', 'google', 'link'];
  it('all ok rows, in order, while needsAdmin', async () => {
    const { s } = svc();
    const r = await s.status(null, 'https://church.vercel.app');
    expect(r.needsAdmin).toBe(true);
    expect(r.checks.map((c) => c.id)).toEqual(ids);
    expect(r.checks.filter((c) => c.id !== 'google' && c.id !== 'link').every((c) => c.state === 'ok')).toBe(true);
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

describe('status: review fixes', () => {
  const byId = (checks: { id: string; state: string }[], id: string) => checks.find((c) => c.id === id)!;
  it('schema row is ok when the database is newer than the code (after a rollback)', async () => {
    const { s } = svc(good, { schemaVersion: async () => '0099' });
    expect(byId((await s.status(null, 'https://church.vercel.app')).checks, 'schema').state).toBe('ok');
  });
  it('schema row needs a fix when the database is older', async () => {
    const { s } = svc(good, { schemaVersion: async () => '0014' });
    expect(byId((await s.status(null, 'https://church.vercel.app')).checks, 'schema').state).toBe('fix');
  });
  it('setupCode row uses the normalised length (same rule as the endpoint)', async () => {
    const short = svc({ ...good, SETUP_CODE: 'ABCD-EFGH-JKMN-PQ' }).s;   // 17 raw, 14 normalised
    expect(byId((await short.status(null, 'https://church.vercel.app')).checks, 'setupCode').state).toBe('fix');
    const ok = svc({ ...good, SETUP_CODE: 'ABCD-EFGH-JKMN-PQRS' }).s;    // 16 normalised
    expect(byId((await ok.status(null, 'https://church.vercel.app')).checks, 'setupCode').state).toBe('ok');
  });
});

describe('status: Elvanto link token row', () => {
  const TOKEN = 'Lk' + 'q7'.repeat(20);
  const row = async (v: string | undefined) => byId((await svc({ ...good, LINK_SYNC_TOKEN: v }).s.status(null, 'https://church.vercel.app')).checks, 'link');
  it('set / not set / too short, always optional', async () => {
    expect(await row(TOKEN)).toEqual({ id: 'link', label: 'Elvanto link token: set', state: 'optional' });
    expect(await row(undefined)).toEqual({ id: 'link', label: 'Elvanto link token: not set', state: 'optional' });
    expect(await row('   ')).toMatchObject({ label: 'Elvanto link token: not set', state: 'optional' });
    expect(await row('a'.repeat(31))).toEqual({ id: 'link', label: 'Elvanto link token: too short (32+ characters)', state: 'optional' });
    expect(await row('a'.repeat(32))).toMatchObject({ label: 'Elvanto link token: set' });
  });
  it('never returns the value', async () => {
    for (const v of [TOKEN, 'shortsecretvalue']) {
      const text = JSON.stringify(await svc({ ...good, LINK_SYNC_TOKEN: v }).s.status(null, 'https://church.vercel.app'));
      expect(text).not.toContain(v);
    }
  });
});

describe('status: link token row is needed once a link screen is on (Y6c)', () => {
  const TOKEN = 'Lk' + 'q7'.repeat(20);
  const FIX = "In Vercel, add LINK_SYNC_TOKEN (Production), 32+ characters, the same value as the console's link settings. Then redeploy.";
  async function row(v: string | undefined, modules: Record<string, string>, o: { probeDb?: () => Promise<boolean> } = {}) {
    const settings = new InMemorySettingsRepository();
    await settings.init();
    const cur = await settings.getSettings();
    await settings.updateSettings({ ministryConfig: { ...cur.ministryConfig, modules: { ...cur.ministryConfig.modules, ...modules } } } as never);
    const { s } = svc({ ...good, LINK_SYNC_TOKEN: v }, { settings, ...(o.probeDb ? { probeDb: o.probeDb } : {}) });
    return byId((await s.status(null, 'https://church.vercel.app')).checks, 'link');
  }
  it('fix when New person, Check-in or Flows is on and the token is missing or short', async () => {
    const on: Record<string, string>[] = [{ newYouthForms: 'on' }, { checkin: 'admin' }, { flows: 'on' }];
    for (const m of on) {
      expect(await row(undefined, m)).toEqual({ id: 'link', label: 'Elvanto link token: not set', state: 'fix', fix: FIX });
      expect(await row('a'.repeat(31), m)).toMatchObject({ label: 'Elvanto link token: too short (32+ characters)', state: 'fix', fix: FIX });
    }
  });
  it('ok when a module is on and the token is set', async () => {
    expect(await row(TOKEN, { flows: 'on' })).toEqual({ id: 'link', label: 'Elvanto link token: set', state: 'ok' });
  });
  it('optional with every one of them off (Lifegroup report alone does not count)', async () => {
    expect(await row(undefined, {})).toEqual({ id: 'link', label: 'Elvanto link token: not set', state: 'optional' });
    expect(await row(undefined, { lifegroupReport: 'on' })).toMatchObject({ state: 'optional' });
  });
  it('optional when the database is down (the settings cannot be read)', async () => {
    expect(await row(undefined, { flows: 'on' }, { probeDb: async () => false })).toMatchObject({ state: 'optional' });
  });
});

describe('status: New People flow row (Y2a)', () => {
  const FIX = 'In Youth Setup, check the New People flow name. It must match Elvanto, and the console must be sending flows.';
  const admin = { id: 'a', role: 'admin' } as any;
  async function row(prefix: string | null, names: string[], o: { needs?: boolean; flows?: boolean | (() => Promise<{ flowName: string }[]>); probeDb?: () => Promise<boolean> } = {}) {
    const settings = new InMemorySettingsRepository();
    await settings.init();
    if (prefix !== null) {
      const cur = await settings.getSettings();
      await settings.updateSettings({ ministryConfig: { ...cur.ministryConfig, elvanto: { ...cur.ministryConfig.elvanto, peopleFlowPrefix: prefix } } } as never);
    }
    const flows = typeof o.flows === 'function' ? o.flows : async () => names.map((flowName) => ({ flowName }));
    const { s } = svc(good, { settings, ...(o.flows === false ? {} : { flows }), ...(o.probeDb ? { probeDb: o.probeDb } : {}) });
    if (!o.needs) await s.createFirstAdmin({ code: good.SETUP_CODE, displayName: 'A', password: 'longenough' });
    const r = await s.status(o.needs ? null : admin, 'https://church.vercel.app');
    return { r, peopleFlow: byId(r.checks, 'peopleFlow') };
  }
  it('fix when the prefix is blank or no pushed flow matches', async () => {
    expect((await row('', ['Brisbane - Youth - New People 2026'])).peopleFlow).toEqual({ id: 'peopleFlow', label: 'New People flow', state: 'fix', fix: FIX });
    expect((await row(null, ['Brisbane - Youth - New People 2026'])).peopleFlow).toMatchObject({ state: 'fix', fix: FIX }); // defaults: blank elvanto
    expect((await row('Logan - Youth - New People', ['Brisbane - Youth - New People 2026'])).peopleFlow).toMatchObject({ state: 'fix', fix: FIX });
    expect((await row('Brisbane - Youth - New People', [])).peopleFlow).toMatchObject({ state: 'fix', fix: FIX });
  });
  it('ok with the flow name', async () => {
    const { r, peopleFlow } = await row('Brisbane - Youth - New People', ['Follow up', 'Brisbane - Youth - New People 2026']);
    expect(peopleFlow).toEqual({ id: 'peopleFlow', label: 'New People flow: Brisbane - Youth - New People 2026', state: 'ok' });
    expect(r.checks.map((c) => c.id).slice(-2)).toEqual(['link', 'peopleFlow']);
  });
  it('DB down: no New People flow read, status still returns the Database fix row', async () => {
    let read = false;
    const { r, peopleFlow } = await row('Brisbane - Youth - New People', [], { probeDb: async () => false,
      flows: async () => { read = true; throw new Error('down'); } });
    expect(byId(r.checks, 'database').state).toBe('fix');
    expect(peopleFlow).toBeUndefined();
    expect(read).toBe(false);
  });
  it('flows read throws or hangs: the row is a fix row in plain words, status still returns', async () => {
    const READ = { id: 'peopleFlow', label: 'New People flow', state: 'fix', fix: 'The app could not read the flows. Select Check again.' };
    expect((await row('Brisbane - Youth - New People', [], { flows: async () => { throw new Error('boom'); } })).peopleFlow).toEqual(READ);
    const t0 = Date.now();
    expect((await row('Brisbane - Youth - New People', [], { flows: () => new Promise(() => {}) })).peopleFlow).toEqual(READ);
    expect(Date.now() - t0).toBeLessThan(4500); // bounded at 3 s
  }, 10_000);
  it('not while the first admin is still to be made (it would block Create your admin), nor without the flows source', async () => {
    expect((await row('', [], { needs: true })).peopleFlow).toBeUndefined();
    expect((await row('', [], { flows: false })).peopleFlow).toBeUndefined();
  });
});
