import { createHash, timingSafeEqual } from 'node:crypto';
import type { IUserRepository } from '../repositories/interfaces/entity-repositories';
import type { Actor, User, SafeUser } from '../core/entities/user';
import { type AuthService, sessionSecretConfigured, toSafeUser } from './auth.service';
import { CreateUserSchema } from './account.service';
import { can } from './access-control';
import { hashPassword } from '../utils/crypto';
import { generateId } from '../utils/id';
import { isEncryptionKeyValid } from '../utils/field-crypto';
import { LATEST_MIGRATION } from '../core/schema-version';
import { googleConfigStatus, googleStatusText } from './routing/google-config';
import { BadRequestError, ConflictError, ForbiddenError, UnauthorizedError } from '../core/errors/app-error';

export interface SetupCheck {
  id: string; label: string; state: 'ok' | 'fix' | 'optional';
  fix?: string; generate?: 'hex32' | 'base64key' | 'setupCode'; link?: string;
}
export interface SetupStatus { needsAdmin: boolean; checks: SetupCheck[] }
export interface SetupService {
  needsAdmin(): Promise<boolean>;
  status(actor: Actor | null, requestOrigin: string | undefined): Promise<SetupStatus>;
  createFirstAdmin(input: unknown): Promise<{ token: string; user: SafeUser }>;
}

const GUIDE_GOOGLE = 'https://github.com/citipointe-youth/ys-connection/blob/master/docs/GOOGLE-SETUP.md';
const norm = (s: string) => s.replace(/[\s-]/g, '').toUpperCase();
const digest = (s: string) => createHash('sha256').update(s).digest();
export function codeMatches(input: string, expected: string): boolean {
  return timingSafeEqual(digest(norm(input)), digest(norm(expected)));
}
const normOrigin = (s: string) => s.trim().replace(/\/+$/, '').toLowerCase();

export function makeSetupService(deps: {
  users: IUserRepository;
  auth: AuthService;
  env: Record<string, string | undefined>;
  /** `select 1` with a 3 s timeout; false on any error. */
  probeDb: () => Promise<boolean>;
  /** max(schema_migrations.version), or null when unknown. */
  schemaVersion: () => Promise<string | null>;
  sessionSecretOk?: () => boolean;
}): SetupService {
  const { users, auth, env } = deps;
  const secretOk = deps.sessionSecretOk ?? (() => sessionSecretConfigured(env));

  // Once an admin exists it stays so for this instance: cache the "false" so GET /settings
  // does not add a DB query to every page load. "true" is never cached.
  let adminSeen = false;
  async function needsAdmin(): Promise<boolean> {
    if (adminSeen) return false;
    try { const n = await users.countActiveAdmins(); if (n > 0) adminSeen = true; return n === 0; } catch { return true; }
  }

  return {
    needsAdmin,

    async status(actor, requestOrigin) {
      const needs = await needsAdmin();
      if (!needs) {
        if (!actor) throw new UnauthorizedError();
        if (!can(actor, 'admin:manage')) throw new ForbiddenError();
      }
      const ok = (id: string, label: string): SetupCheck => ({ id, label, state: 'ok' });
      const fix = (id: string, label: string, text: string, generate?: SetupCheck['generate']): SetupCheck =>
        ({ id, label, state: 'fix', fix: text, ...(generate ? { generate } : {}) });
      const url = env['DATABASE_URL'];
      let port: string | null = null;
      try { if (url) port = new URL(url).port || '5432'; } catch { port = null; }
      const [dbOk, version] = await Promise.all([deps.probeDb(), deps.schemaVersion().catch(() => null)]);
      const origin = requestOrigin ?? '';
      const checks: SetupCheck[] = [
        env['PERSISTENCE'] === 'supabase' ? ok('persistence', 'Storage') :
          fix('persistence', 'Storage', 'In Vercel, set PERSISTENCE to supabase. Then redeploy.'),
        dbOk ? ok('database', 'Database connection') :
          fix('database', 'Database connection', 'The app cannot reach the database. Copy the Session pooler connection string from Supabase again. Paste it as DATABASE_URL in Vercel. Then redeploy.'),
        port === '5432' ? ok('databasePort', 'Database port') :
          fix('databasePort', 'Database port', 'The connection string must use port 5432. Copy the Session pooler string. Do not use the Transaction pooler string (port 6543). Then redeploy.'),
        version !== null && version >= LATEST_MIGRATION ? ok('schema', 'Database version') :
          fix('schema', 'Database version', 'The database is not up to date. In Vercel, open Deployments. Select Redeploy on the top row.'),
        secretOk() && (env['SESSION_SECRET'] ?? '').length >= 32 ? ok('sessionSecret', 'SESSION_SECRET') :
          fix('sessionSecret', 'SESSION_SECRET', 'Select Generate. Select Copy. In Vercel, add the value as SESSION_SECRET. Then redeploy.', 'hex32'),
        isEncryptionKeyValid(env) ? ok('encryptionKey', 'FIELD_ENCRYPTION_KEY') :
          fix('encryptionKey', 'FIELD_ENCRYPTION_KEY', 'Select Generate. Select Copy. In Vercel, add the value as FIELD_ENCRYPTION_KEY. Then redeploy.\nWARNING: Save this key in a safe place. If you lose it, the app cannot read phone numbers. If the app already has data, do not replace this key.', 'base64key'),
        env['APP_ORIGIN'] && origin && normOrigin(env['APP_ORIGIN']) === normOrigin(origin) ? ok('appOrigin', 'APP_ORIGIN') :
          fix('appOrigin', 'APP_ORIGIN', `In Vercel, set APP_ORIGIN to ${normOrigin(origin) || 'the address of this page'}. Then redeploy.`),
      ];
      if (needs) {
        checks.push(norm(env['SETUP_CODE'] ?? '').length >= 16 ? ok('setupCode', 'SETUP_CODE') :
          fix('setupCode', 'SETUP_CODE', 'Select Generate. Select Copy. In Vercel, add the value as SETUP_CODE. Then redeploy.', 'setupCode'));
      }
      checks.push({ id: 'google', label: googleStatusText(googleConfigStatus(env as NodeJS.ProcessEnv)), state: 'optional', link: GUIDE_GOOGLE });
      return { needsAdmin: needs, checks };
    },

    async createFirstAdmin(input) {
      const body = (input ?? {}) as { code?: unknown; displayName?: unknown; password?: unknown };
      if (!(await needsAdmin())) throw new ConflictError('An admin already exists. Log in.');
      const expected = env['SETUP_CODE'] ?? '';
      if (norm(expected).length < 16) throw new BadRequestError('SETUP_CODE is missing or too short. In Vercel, add a SETUP_CODE of 16 or more characters. Then redeploy.');
      if (typeof body.code !== 'string' || !codeMatches(body.code, expected))
        throw new ForbiddenError('The setup code is wrong. In Vercel, open Settings > Environment Variables. Copy SETUP_CODE again.');
      if (!secretOk()) throw new BadRequestError('The app is missing SESSION_SECRET. In Vercel, add SESSION_SECRET. Then redeploy.');
      const displayName = typeof body.displayName === 'string' && body.displayName.trim() ? body.displayName.trim() : 'Admin';
      const data = CreateUserSchema.parse({ displayName, email: 'admin', password: body.password, role: 'admin' });
      const now = new Date().toISOString();
      const user: User = {
        id: generateId(), displayName: data.displayName, email: 'admin', role: 'admin',
        grade: null, grades: null, gender: null, quad: null, leaderId: null,
        status: 'active', passwordHash: await hashPassword(data.password), mustChangePassword: false,
        loginHistory: [], loginDevices: [],
        createdAt: now, updatedAt: now,
      };
      const saved = await users.createFirstAdmin(user);
      if (!saved) throw new ConflictError('An admin already exists. Log in.');
      const token = await auth.issueTokenFor(saved.id);
      if (!token) throw new ConflictError('An admin already exists. Log in.');
      return { token, user: toSafeUser(saved) };
    },
  };
}
