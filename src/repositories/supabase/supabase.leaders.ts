import type { SqlClient } from './client';
import { toIso } from './client';
import type { ILeaderRepository } from '../interfaces/entity-repositories';
import type { Leader } from '../../core/entities/leader';
import type { Gender, Grade } from '../../core/types/enums';
import { chunk } from './bulk';

function toLeader(row: Record<string, unknown>): Leader {
  return {
    id: row['id'] as string,
    fullName: row['full_name'] as string,
    gender: (row['gender'] as Gender | null) ?? null,
    grades: ((row['grades'] as number[] | null) ?? []) as Grade[],
    active: row['active'] as boolean,
    createdByGrade: (row['created_by_grade'] as number | null) ?? null,
    smsTemplate: (row['sms_template'] as string | null) ?? null,
    createdAt: toIso(row['created_at']),
    updatedAt: toIso(row['updated_at']),
  };
}

export class SupabaseLeaderRepository implements ILeaderRepository {
  constructor(private sql: SqlClient) {}

  async init(): Promise<void> {
    // No-op: Supabase table already exists
  }

  async findAll(): Promise<Leader[]> {
    const rows = await this.sql`select * from leaders order by full_name`;
    return rows.map(toLeader);
  }

  async findById(id: string): Promise<Leader | null> {
    const rows = await this.sql`select * from leaders where id = ${id}`;
    return rows[0] ? toLeader(rows[0]) : null;
  }

  async findByGrade(grade: number): Promise<Leader[]> {
    const rows = await this.sql`
      select * from leaders
      where active = true
        and (grades = '{}' or ${grade} = any(grades))
      order by full_name
    `;
    return rows.map(toLeader);
  }

  async findActive(): Promise<Leader[]> {
    const rows = await this.sql`select * from leaders where active = true order by full_name`;
    return rows.map(toLeader);
  }

  async save(leader: Leader): Promise<Leader> {
    const rows = await this.sql`
      insert into leaders (id, full_name, gender, grades, active, created_by_grade, sms_template, created_at, updated_at)
      values (
        ${leader.id},
        ${leader.fullName},
        ${leader.gender ?? null},
        ${leader.grades as number[]},
        ${leader.active},
        ${leader.createdByGrade ?? null},
        ${leader.smsTemplate ?? null},
        ${leader.createdAt},
        ${leader.updatedAt}
      )
      on conflict (id) do update set
        full_name        = excluded.full_name,
        gender           = excluded.gender,
        grades           = excluded.grades,
        active           = excluded.active,
        created_by_grade = excluded.created_by_grade,
        sms_template     = excluded.sms_template,
        updated_at       = excluded.updated_at
      returning *
    `;
    return toLeader(rows[0]!);
  }

  async saveMany(leaders: Leader[]): Promise<void> {
    if (leaders.length === 0) return;
    for (const batch of chunk(leaders)) {
      await this.sql`
        insert into leaders ${this.sql(
          batch.map((l) => ({
            id:                l.id,
            full_name:         l.fullName,
            gender:            l.gender ?? null,
            grades:            l.grades as number[],
            active:            l.active,
            created_by_grade:  l.createdByGrade ?? null,
            sms_template:      l.smsTemplate ?? null,
            created_at:        l.createdAt,
            updated_at:        l.updatedAt,
          })),
        )}
        on conflict (id) do update set
          full_name        = excluded.full_name,
          gender           = excluded.gender,
          grades           = excluded.grades,
          active           = excluded.active,
          created_by_grade = excluded.created_by_grade,
          sms_template     = excluded.sms_template,
          updated_at       = excluded.updated_at
      `;
    }
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.sql`delete from leaders where id = ${id} returning id`;
    return rows.length > 0;
  }

  async deleteAll(): Promise<void> {
    await this.sql`truncate table leaders cascade`;
  }
}
