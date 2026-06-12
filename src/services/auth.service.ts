import { randomBytes } from 'node:crypto';
import { verifyPassword } from '../utils/crypto';
import type { IUserRepository } from '../repositories/interfaces/entity-repositories';
import type { Actor, User, SafeUser } from '../core/entities/user';
import type { Grade, Quad } from '../core/types/enums';
import { UnauthorizedError } from '../core/errors/app-error';
import { LoginInputSchema } from '../core/validation/auth.schema';

const tokenStore = new Map<string, { userId: string; expiresAt: number }>();
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export function toActor(user: User): Actor {
  return {
    id: user.id,
    role: user.role,
    displayName: user.displayName,
    grade: (user.grade ?? null) as Grade | null,
    quad: (user.quad ?? null) as Quad | null,
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
}

export function makeAuthService(users: IUserRepository): AuthService {
  return {
    async login(input: unknown) {
      const parsed = LoginInputSchema.safeParse(input);
      if (!parsed.success) throw new UnauthorizedError('Invalid credentials');

      const { email, password } = parsed.data;
      const user = await users.findByEmail(email);
      if (!user || user.status !== 'active') throw new UnauthorizedError('Invalid credentials');
      if (!user.passwordHash) throw new UnauthorizedError('Account has no password set');

      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) throw new UnauthorizedError('Invalid credentials');

      const token = randomBytes(32).toString('hex');
      tokenStore.set(token, { userId: user.id, expiresAt: Date.now() + TOKEN_TTL_MS });
      return { token, user: toSafeUser(user) };
    },

    async resolveToken(token: string) {
      const entry = tokenStore.get(token);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        tokenStore.delete(token);
        return null;
      }
      const user = await users.findById(entry.userId);
      if (!user || user.status !== 'active') return null;
      return toActor(user);
    },

    async logout(token: string) {
      tokenStore.delete(token);
    },
  };
}
