import { isProductionEnv } from '../config/is-production';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { verifyPassword, hashPassword, needsRehash } from '../utils/crypto';
import type { IUserRepository } from '../repositories/interfaces/entity-repositories';
import type { Actor, User, SafeUser } from '../core/entities/user';
import { MAX_LOGIN_HISTORY, MAX_LOGIN_DEVICES } from '../core/entities/user';
import type { LoginDevice } from '../core/entities/user';
import type { Grade, Quad } from '../core/types/enums';
import { UnauthorizedError, SetupIncompleteError } from '../core/errors/app-error';
import { LoginInputSchema } from '../core/validation/auth.schema';
import { quadGenderOf } from './access-control';

// Derive a grade/quad login's gender scope. Quad logins come from their quad;
// grade logins from the email convention (grade7g -> female, grade7b -> male,
// or a "girls"/"boys" word). Anything else (incl. an ungendered grade account
// or director/admin) returns null = no gender restriction.
export function deriveActorGender(user: User): 'male' | 'female' | null {
  if (user.role === 'quad') return quadGenderOf(user.quad);
  if (user.role === 'grade') {
    // Explicit gender field wins when set (§5.1a — multi-grade accounts can't
    // encode gender in a single-grade email regex). Falls through to the email
    // convention for existing single-grade accounts that never set it.
    if (user.gender === 'male' || user.gender === 'female') return user.gender;
    const local = (user.email || '').split('@')[0]?.toLowerCase() ?? '';
    if (!local.startsWith('grade')) return null;
    if (/^grade\s*\d+\s*g$/.test(local) || local.includes('girl')) return 'female';
    if (/^grade\s*\d+\s*b$/.test(local) || local.includes('boy') || local.includes('guy')) return 'male';
  }
  return null;
}

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
// Admin account-preview tokens (see the `preview` param on issueTokenFor below)
// get a much shorter TTL than a normal login. A preview is meant to be a quick
// admin QA check, and every preview mints a full, real session token for the
// target account that sits in the admin's browser localStorage alongside their
// own — bounding its lifetime to an hour meaningfully shrinks that exposure
// window without needing server-side token revocation (tokens stay stateless).
export const PREVIEW_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const INSECURE_FALLBACK = 'cms-dev-secret-change-in-production';
function rawSecret(): string { return process.env['SESSION_SECRET'] ?? INSECURE_FALLBACK; }

// Fail closed, not open: a missing SESSION_SECRET in production means every
// session token is forgeable with a publicly-known string. The app still STARTS
// (so the setup checklist can tell the owner what to add) but never signs or
// accepts a token while the secret is unusable.
/** True when a session secret is usable. In production a missing secret is never usable (fail closed).
 *  Same rule as the old import-time check: set and not the fallback. The >= 32 rule lives ONLY in the
 *  setup checklist row, never here - a shorter existing secret must not lock out a live deployment. */
export function sessionSecretConfigured(env: Record<string, string | undefined> = process.env): boolean {
  const s = env['SESSION_SECRET'];
  if (!s || s === INSECURE_FALLBACK) return !isProductionEnv(env);
  return true;
}

function secretOrThrow(): string {
  if (!sessionSecretConfigured()) {
    throw new SetupIncompleteError('The app is missing SESSION_SECRET. In Vercel, add SESSION_SECRET. Then redeploy.');
  }
  return rawSecret();
}

// The signed token carries the full actor so authenticated requests don't need
// a DB lookup to resolve the caller — the HMAC guarantees it wasn't tampered
// with. (Trade-off: a role/status change only takes effect on the user's next
// login, within the 12h token TTL.)
function signSession(actor: Actor, expiresAt: number): string {
  const payload = Buffer.from(JSON.stringify({ userId: actor.id, expiresAt, actor })).toString('base64url');
  const sig = createHmac('sha256', secretOrThrow()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function parseSession(token: string): { userId: string; expiresAt: number; actor?: Actor } | null {
  if (!sessionSecretConfigured()) return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  try {
    const expected = createHmac('sha256', rawSecret()).update(payload).digest('base64url');
    const a = Buffer.from(sig, 'base64url');
    const b = Buffer.from(expected, 'base64url');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return JSON.parse(Buffer.from(payload, 'base64url').toString()) as { userId: string; expiresAt: number; actor?: Actor };
  } catch {
    return null;
  }
}

export function toActor(user: User): Actor {
  return {
    id: user.id,
    role: user.role,
    displayName: user.displayName,
    grade: (user.grade ?? null) as Grade | null,
    // Multi-grade grade accounts (§5.1a): carry the full set. Falls back to the
    // single grade for legacy accounts so old tokens/behaviour are unchanged.
    grades: (user.grades && user.grades.length > 0
      ? user.grades
      : user.grade != null
        ? [user.grade]
        : []) as Grade[],
    quad: (user.quad ?? null) as Quad | null,
    leaderId: user.leaderId ?? null,
    gender: deriveActorGender(user),
    mustChangePassword: user.mustChangePassword ?? false,
  };
}

export function toSafeUser(user: User): SafeUser {
  const { passwordHash: _pw, ...safe } = user;
  return safe as SafeUser;
}

export interface AuthService {
  login(input: unknown): Promise<{ token: string; user: SafeUser }>;
  resolveToken(token: string): Promise<Actor | null>;
  logout(token: string): Promise<void>;
  // Mint a fresh session token from the user's CURRENT DB state. Needed after
  // any change that flips a claim baked into the token at login (right now:
  // mustChangePassword) — resolveToken() trusts the token's embedded actor and
  // never re-reads the DB, so without this the old token keeps enforcing the
  // stale claim for the rest of its 12h TTL. Returns null if the user no
  // longer exists/is inactive. `actorOverrides` layers additional fields onto
  // the freshly-derived actor before signing (used by the admin account-
  // preview feature to force mustChangePassword:false on a minted token
  // without touching the target account's real DB state). `ttlMs` overrides
  // the default 12h TTL (used by preview to mint a short-lived token — see
  // PREVIEW_TOKEN_TTL_MS above).
  issueTokenFor(userId: string, actorOverrides?: Partial<Actor>, ttlMs?: number): Promise<string | null>;
}

// Upsert one device into an account's device list: bump count/last if the id is known,
// else add it; most recently seen first; capped. Pure, so it is unit-tested directly.
export function recordDevice(
  devices: LoginDevice[] | undefined,
  id: string,
  label: string,
  nowIso: string,
): LoginDevice[] {
  const list = devices ?? [];
  const existing = list.find((d) => d.id === id);
  const updated: LoginDevice = existing
    ? { ...existing, label: label || existing.label, last: nowIso, count: existing.count + 1 }
    : { id, label, first: nowIso, last: nowIso, count: 1 };
  return [updated, ...list.filter((d) => d.id !== id)].slice(0, MAX_LOGIN_DEVICES);
}

export function makeAuthService(users: IUserRepository): AuthService {
  return {
    async login(input: unknown) {
      secretOrThrow();
      const parsed = LoginInputSchema.safeParse(input);
      if (!parsed.success) throw new UnauthorizedError('Invalid credentials');

      const { email, password, deviceId, deviceLabel } = parsed.data;
      const user = await users.findByEmail(email);
      if (!user || user.status !== 'active') throw new UnauthorizedError('Invalid credentials');
      if (!user.passwordHash) throw new UnauthorizedError('Account has no password set');

      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) throw new UnauthorizedError('Invalid credentials');

      // Silently upgrade legacy SHA-256 hashes to bcrypt on first login
      if (needsRehash(user.passwordHash)) {
        const newHash = await hashPassword(password);
        await users.save({ ...user, passwordHash: newHash, updatedAt: new Date().toISOString() });
      }

      // Login activity tracking (ported from the Youth Camp Platform, 2026-09-20): a short
      // per-account history so the admin can see who hasn't logged in yet. Fail-open — a
      // write failure here must never block or fail an otherwise-successful login. Uses the
      // ordinary read-modify-write save() every other account mutation in this file already
      // uses, not a dedicated atomic method.
      try {
        const nowIso = new Date().toISOString();
        const history = [nowIso, ...(user.loginHistory ?? [])].slice(0, MAX_LOGIN_HISTORY);
        const devices = deviceId ? recordDevice(user.loginDevices, deviceId, deviceLabel ?? '', nowIso) : user.loginDevices;
        await users.save({ ...user, loginHistory: history, loginDevices: devices });
      } catch {
        // Never let a tracking failure block a successful login.
      }

      const token = signSession(toActor(user), Date.now() + TOKEN_TTL_MS);
      return { token, user: toSafeUser(user) };
    },

    async resolveToken(token: string) {
      const session = parseSession(token);
      if (!session) return null;
      if (Date.now() > session.expiresAt) return null;
      // Trusted actor embedded in the signed token — no DB round-trip needed.
      if (session.actor) return session.actor;
      // Legacy token without an embedded actor: fall back to a lookup.
      const user = await users.findById(session.userId);
      if (!user || user.status !== 'active') return null;
      return toActor(user);
    },

    async logout(_token: string) {
      // Stateless tokens — logout is handled client-side by discarding the token
    },

    async issueTokenFor(userId: string, actorOverrides?: Partial<Actor>, ttlMs?: number) {
      const user = await users.findById(userId);
      if (!user || user.status !== 'active') return null;
      const actor = actorOverrides ? { ...toActor(user), ...actorOverrides } : toActor(user);
      return signSession(actor, Date.now() + (ttlMs ?? TOKEN_TTL_MS));
    },
  };
}
