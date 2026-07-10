import type { SqlClient } from './client';
import { toIso } from './client';
import type { IUserRepository } from '../interfaces/entity-repositories';
import type { User } from '../../core/entities/user';
import type { UserRole, Grade, Quad } from '../../core/types/enums';

function toUser(row: Record<string, unknown>): User {
  return {
    id: row['id'] as string,
    displayName: row['display_name'] as string,
    email: row['email'] as string,
    role: row['role'] as UserRole,
    grade: (row['grade'] as Grade | null) ?? null,
    // jsonb column; postgres.js returns it already parsed (array) or null.
    grades: (row['grades'] as Grade[] | null) ?? null,
    gender: (row['gender'] as 'male' | 'female' | null) ?? null,
    quad: (row['quad'] as Quad | null) ?? null,
    status: row['status'] as 'active' | 'inactive',
    passwordHash: (row['password_hash'] as string | null) ?? undefined,
    mustChangePassword: (row['must_change_password'] as boolean | null) ?? false,
    createdAt: toIso(row['created_at']),
    updatedAt: toIso(row['updated_at']),
  };
}

export class SupabaseUserRepository implements IUserRepository {
  constructor(private sql: SqlClient) {}

  async init(): Promise<void> {
    // No-op: Supabase table already exists
  }

  async findAll(): Promise<User[]> {
    const rows = await this.sql`select * from users order by display_name`;
    return rows.map(toUser);
  }

  async findById(id: string): Promise<User | null> {
    const rows = await this.sql`select * from users where id = ${id}`;
    return rows[0] ? toUser(rows[0]) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const rows = await this.sql`select * from users where lower(email) = lower(${email})`;
    return rows[0] ? toUser(rows[0]) : null;
  }

  async findByRole(role: UserRole): Promise<User[]> {
    const rows = await this.sql`select * from users where role = ${role} order by display_name`;
    return rows.map(toUser);
  }

  async save(user: User): Promise<User> {
    // grades is a jsonb column (nullable) — null stays null; an array is
    // serialised and cast, mirroring ministry_config's write in the settings repo.
    const gradesJson = user.grades == null ? null : JSON.stringify(user.grades);
    const rows = await this.sql`
      insert into users (id, display_name, email, role, grade, grades, gender, quad, status, password_hash, must_change_password, created_at, updated_at)
      values (
        ${user.id},
        ${user.displayName},
        ${user.email},
        ${user.role},
        ${user.grade ?? null},
        ${gradesJson}::jsonb,
        ${user.gender ?? null},
        ${user.quad ?? null},
        ${user.status},
        ${user.passwordHash ?? null},
        ${user.mustChangePassword ?? false},
        ${user.createdAt},
        ${user.updatedAt}
      )
      on conflict (id) do update set
        display_name = excluded.display_name,
        email        = excluded.email,
        role         = excluded.role,
        grade        = excluded.grade,
        grades       = excluded.grades,
        gender       = excluded.gender,
        quad         = excluded.quad,
        status       = excluded.status,
        password_hash = excluded.password_hash,
        must_change_password = excluded.must_change_password,
        updated_at   = excluded.updated_at
      returning *
    `;
    return toUser(rows[0]!);
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.sql`delete from users where id = ${id} returning id`;
    return rows.length > 0;
  }
}
