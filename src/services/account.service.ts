import { z } from 'zod';
import { generateId } from '../utils/id';
import { hashPassword, verifyPassword } from '../utils/crypto';
import { assertCan } from './access-control';
import type { IUserRepository } from '../repositories/interfaces/entity-repositories';
import type { User, SafeUser } from '../core/entities/user';
import type { Actor } from '../core/entities/user';
import type { UserRole, Grade, Quad } from '../core/types/enums';
import { NotFoundError, BadRequestError, ConflictError, UnauthorizedError } from '../core/errors/app-error';

const CreateUserSchema = z.object({
  displayName: z.string().min(1),
  email: z.string().min(1),
  password: z.string().min(8),
  role: z.enum(['leader', 'grade', 'quad', 'director', 'admin']),
  // For a `leader` (junior leader) account — the Leader record it is bound to.
  leaderId: z.string().nullable().optional(),
  // Legacy single-grade field (back-compat). New account forms send `grades`.
  grade: z.number().int().min(7).max(12).nullable().optional(),
  // Multi-grade grade accounts (§5.1a): one or more grades. When present it is
  // authoritative and `grade` is derived from it.
  grades: z.array(z.number().int().min(7).max(12)).nullable().optional(),
  // Explicit gender scope for a grade login (null = both). Required in practice
  // for a >1-grade account; optional for single-grade ones (email convention).
  gender: z.enum(['male', 'female']).nullable().optional(),
  quad: z.enum(['g79', 'b79', 'g1012', 'b1012']).nullable().optional(),
});

/**
 * Normalise the incoming grade/grades pair into the stored representation:
 * `grades` is the full deduped, sorted set; `grade` is the single-grade
 * back-compat anchor (set only when exactly one grade, else null). Returns
 * undefined when neither field was supplied (so a partial update leaves them
 * untouched).
 */
function normaliseGrades(
  grade: number | null | undefined,
  grades: number[] | null | undefined,
): { grade: Grade | null; grades: Grade[] } | undefined {
  let list: number[] | undefined;
  if (grades !== undefined && grades !== null) list = grades;
  else if (grade !== undefined && grade !== null) list = [grade];
  else if (grades === null || grade === null) list = [];
  else return undefined;
  const uniq = [...new Set(list)].sort((a, b) => a - b) as Grade[];
  return { grade: (uniq.length === 1 ? uniq[0]! : null) as Grade | null, grades: uniq };
}

function toSafe(u: User): SafeUser {
  const { passwordHash: _pw, ...safe } = u;
  return safe as SafeUser;
}

export interface AccountService {
  list(actor: Actor): Promise<SafeUser[]>;
  create(actor: Actor, input: unknown): Promise<SafeUser>;
  update(actor: Actor, id: string, input: unknown): Promise<SafeUser>;
  setPassword(actor: Actor, id: string, newPassword: string): Promise<void>;
  // Self-service password change: any authenticated actor may change their OWN
  // password by proving they know the current one — no admin:manage permission
  // needed. Distinct from setPassword() above, which is the admin-managing-
  // another-account flow and is untouched by this.
  changeOwnPassword(actor: Actor, currentPassword: string, newPassword: string): Promise<void>;
  toggleStatus(actor: Actor, id: string): Promise<SafeUser>;
  remove(actor: Actor, id: string): Promise<void>;
}

export function makeAccountService(users: IUserRepository): AccountService {
  async function guardAdmin(id: string, action: string) {
    const admins = await users.findByRole('admin');
    if (admins.length <= 1) {
      throw new BadRequestError(`Cannot ${action} the only admin account`);
    }
  }

  return {
    async list(actor) {
      assertCan(actor, 'admin:manage');
      const all = await users.findAll();
      return all
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
        .map(toSafe);
    },

    async create(actor, input) {
      assertCan(actor, 'admin:manage');
      const data = CreateUserSchema.parse(input);
      const existing = await users.findByEmail(data.email);
      if (existing) throw new ConflictError('Email already in use');

      const gradeSet = normaliseGrades(data.grade, data.grades);
      if (data.role === 'grade' && (!gradeSet || gradeSet.grades.length === 0)) {
        throw new BadRequestError('Grade login requires at least one grade');
      }
      if (data.role === 'quad' && data.quad == null) {
        throw new BadRequestError('Quad login requires a quad');
      }
      if (data.role === 'leader' && !data.leaderId) {
        throw new BadRequestError('Junior leader login requires a linked leader record');
      }

      const passwordHash = await hashPassword(data.password);
      const now = new Date().toISOString();
      const user: User = {
        id: generateId(),
        displayName: data.displayName,
        email: data.email,
        role: data.role as UserRole,
        grade: gradeSet ? gradeSet.grade : ((data.grade ?? null) as Grade | null),
        grades: gradeSet ? gradeSet.grades : null,
        gender: data.role === 'grade' ? (data.gender ?? null) : null,
        quad: (data.quad ?? null) as Quad | null,
        leaderId: data.role === 'leader' ? (data.leaderId ?? null) : null,
        status: 'active',
        passwordHash,
        mustChangePassword: false,
        createdAt: now,
        updatedAt: now,
      };
      const saved = await users.save(user);
      return toSafe(saved);
    },

    async update(actor, id, input) {
      assertCan(actor, 'admin:manage');
      const existing = await users.findById(id);
      if (!existing) throw new NotFoundError('User not found');
      if (existing.role === 'admin') await guardAdmin(id, 'modify');
      const patch = CreateUserSchema.omit({ password: true }).partial().parse(input);
      // Email is editable (so grade logins can be renamed, e.g. grade7g / grade7b),
      // but must stay unique across accounts.
      if (patch.email && patch.email !== existing.email) {
        const other = await users.findByEmail(patch.email);
        if (other && other.id !== id) throw new ConflictError('Email already in use');
      }
      const gradeSet = normaliseGrades(patch.grade, patch.grades);
      const nextRole = (patch.role ?? existing.role) as UserRole;
      const nextGrades = gradeSet ? gradeSet.grades : (existing.grades ?? (existing.grade != null ? [existing.grade] : []));
      if (nextRole === 'grade' && nextGrades.length === 0) {
        throw new BadRequestError('Grade login requires at least one grade');
      }
      const nextLeaderId = patch.leaderId !== undefined ? (patch.leaderId ?? null) : (existing.leaderId ?? null);
      if (nextRole === 'leader' && !nextLeaderId) {
        throw new BadRequestError('Junior leader login requires a linked leader record');
      }
      const updated: User = {
        ...existing,
        ...(patch.displayName ? { displayName: patch.displayName } : {}),
        ...(patch.email ? { email: patch.email } : {}),
        ...(patch.role ? { role: patch.role as UserRole } : {}),
        ...(gradeSet ? { grade: gradeSet.grade, grades: gradeSet.grades } : {}),
        ...(patch.gender !== undefined ? { gender: (patch.gender ?? null) } : {}),
        ...(patch.quad !== undefined ? { quad: patch.quad as Quad | null } : {}),
        // Bind/unbind the leader record; cleared when the role is no longer 'leader'.
        leaderId: nextRole === 'leader' ? nextLeaderId : null,
        updatedAt: new Date().toISOString(),
      };
      return toSafe(await users.save(updated));
    },

    async setPassword(actor, id, newPassword) {
      assertCan(actor, 'admin:manage');
      const existing = await users.findById(id);
      if (!existing) throw new NotFoundError('User not found');
      if (newPassword.length < 8) throw new BadRequestError('Password must be at least 8 characters');
      const passwordHash = await hashPassword(newPassword);
      await users.save({ ...existing, passwordHash, updatedAt: new Date().toISOString() });
    },

    async changeOwnPassword(actor, currentPassword, newPassword) {
      const existing = await users.findById(actor.id);
      if (!existing) throw new NotFoundError('User not found');
      if (!existing.passwordHash || !(await verifyPassword(currentPassword, existing.passwordHash))) {
        throw new UnauthorizedError('Current password is incorrect');
      }
      if (newPassword.length < 8) throw new BadRequestError('Password must be at least 8 characters');
      const passwordHash = await hashPassword(newPassword);
      // Proving the current password and choosing a new one yourself is what clears
      // mustChangePassword — an admin-set/seeded password never does.
      await users.save({ ...existing, passwordHash, mustChangePassword: false, updatedAt: new Date().toISOString() });
    },

    async toggleStatus(actor, id) {
      assertCan(actor, 'admin:manage');
      const existing = await users.findById(id);
      if (!existing) throw new NotFoundError('User not found');
      if (existing.role === 'admin' && existing.status === 'active') {
        await guardAdmin(id, 'deactivate');
      }
      const updated = await users.save({
        ...existing,
        status: existing.status === 'active' ? 'inactive' : 'active',
        updatedAt: new Date().toISOString(),
      });
      return toSafe(updated);
    },

    async remove(actor, id) {
      assertCan(actor, 'admin:manage');
      const existing = await users.findById(id);
      if (!existing) throw new NotFoundError('User not found');
      if (existing.role === 'admin') await guardAdmin(id, 'delete');
      await users.delete(id);
    },
  };
}
