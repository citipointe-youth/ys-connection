import { InMemoryBaseRepository } from './in-memory.base.repository';

import type { User } from '../../core/entities/user';
import type { Student } from '../../core/entities/student';
import type { Leader } from '../../core/entities/leader';
import type { PrayerRequest } from '../../core/entities/prayer';
import type { Notice, NoticePushSub } from '../../core/entities/notice';
import type { Connection } from '../../core/entities/connection';
import type {
  ServiceSession,
  ServiceAttendance,
  Lifegroup,
  LifegroupRollRow,
  LifegroupWeek,
  LifegroupAttendance,
  ImportRecord,
} from '../../core/entities/attendance';
import type { AppSettings, AdminAuditEntry } from '../../core/entities/settings';
import type { ConnectionAudit, StoredAuditSource } from '../../core/entities/connection-audit';
import type { Grade, UserRole } from '../../core/types/enums';
import { MINISTRY_CONFIG_DEFAULTS } from '../../core/ministry-config';

import type {
  IUserRepository,
  IStudentRepository,
  ILeaderRepository,
  IPrayerRepository,
  INoticeRepository,
  INoticePushRepository,
  IConnectionRepository,
  IServiceSessionRepository,
  IServiceAttendanceRepository,
  ILifegroupRepository,
  ILifegroupWeekRepository,
  ILifegroupAttendanceRepository,
  IImportRepository,
  ISettingsRepository,
  IAuditRepository,
  IConnectionAuditRepository,
  AuditSummary,
} from '../interfaces/entity-repositories';

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export class InMemoryUserRepository
  extends InMemoryBaseRepository<User>
  implements IUserRepository
{
  async findByEmail(email: string): Promise<User | null> {
    const lower = email.toLowerCase();
    for (const user of this.store.values()) {
      if (user.email.toLowerCase() === lower) return this.clone(user);
    }
    return null;
  }

  async findByRole(role: UserRole): Promise<User[]> {
    return Array.from(this.store.values())
      .filter((u) => u.role === role)
      .map((u) => this.clone(u));
  }

  async countActiveAdmins(): Promise<number> {
    return Array.from(this.store.values()).filter((u) => u.role === 'admin' && u.status === 'active').length;
  }

  // Synchronous check-and-insert: save() writes the store before its first await, so two
  // concurrent calls cannot both pass the check.
  async createFirstAdmin(user: User): Promise<User | null> {
    const exists = Array.from(this.store.values()).some((u) => (u.role === 'admin' && u.status === 'active') || u.email.toLowerCase() === user.email.toLowerCase());
    if (exists) return null;
    return this.save(user);
  }
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------
export class InMemoryStudentRepository
  extends InMemoryBaseRepository<Student>
  implements IStudentRepository
{
  async saveMany(students: Student[]): Promise<void> {
    for (const s of students) this.store.set(s.id, this.clone(s));
  }
}

// ---------------------------------------------------------------------------
// Leaders
// ---------------------------------------------------------------------------
export class InMemoryLeaderRepository
  extends InMemoryBaseRepository<Leader>
  implements ILeaderRepository
{
  async findActive(): Promise<Leader[]> {
    return Array.from(this.store.values())
      .filter((l) => l.active)
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
      .map((l) => this.clone(l));
  }

  // Mirrors the Supabase upsert, which never lists view_grades: a leader
  // saved without viewGrades keeps the stored value.
  private withStoredViewGrades(l: Leader): Leader {
    if (l.viewGrades !== undefined) return l;
    const stored = this.store.get(l.id)?.viewGrades;
    return stored === undefined ? l : { ...l, viewGrades: stored };
  }

  override async save(leader: Leader): Promise<Leader> {
    return super.save(this.withStoredViewGrades(leader));
  }

  async saveMany(leaders: Leader[]): Promise<void> {
    for (const l of leaders) this.store.set(l.id, this.clone(this.withStoredViewGrades(l)));
  }

  async setViewGrades(id: string, grades: Grade[] | null): Promise<void> {
    const l = this.store.get(id);
    if (!l) return;
    this.store.set(id, this.clone({ ...l, viewGrades: grades ? [...grades] : null }));
  }
}

// ---------------------------------------------------------------------------
// Prayers
// ---------------------------------------------------------------------------
export class InMemoryPrayerRepository
  extends InMemoryBaseRepository<PrayerRequest>
  implements IPrayerRepository
{
  async findByStudent(studentId: string): Promise<PrayerRequest[]> {
    return Array.from(this.store.values())
      .filter((p) => p.studentId === studentId)
      // L1 (2026-07-19): match SupabasePrayerRepository's `order by created_at
      // desc` so behavior is identical across memory and Supabase — in-memory
      // used to return unsorted.
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((p) => this.clone(p));
  }

  async deleteByStudent(studentId: string): Promise<void> {
    const idsToDelete = Array.from(this.store.values())
      .filter((p) => p.studentId === studentId)
      .map((p) => p.id);
    for (const id of idsToDelete) this.store.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------
export class InMemoryNoticeRepository extends InMemoryBaseRepository<Notice> implements INoticeRepository {
  async findSince(iso: string): Promise<Notice[]> {
    return Array.from(this.store.values()).filter((n) => n.createdAt >= iso)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((n) => this.clone(n));
  }
}
export class InMemoryNoticePushRepository extends InMemoryBaseRepository<NoticePushSub> implements INoticePushRepository {}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------
export class InMemoryConnectionRepository
  extends InMemoryBaseRepository<Connection>
  implements IConnectionRepository
{
  async findByStudent(studentId: string): Promise<Connection[]> {
    return Array.from(this.store.values())
      .filter((a) => a.studentId === studentId)
      .map((a) => this.clone(a));
  }

  async findByLeader(leaderId: string): Promise<Connection[]> {
    return Array.from(this.store.values())
      .filter((a) => a.leaderId === leaderId)
      .map((a) => this.clone(a));
  }

  async findByStudentAndLeader(studentId: string, leaderId: string): Promise<Connection | null> {
    for (const a of this.store.values()) {
      if (a.studentId === studentId && a.leaderId === leaderId) return this.clone(a);
    }
    return null;
  }

  async deleteByStudentAndLeader(studentId: string, leaderId: string): Promise<boolean> {
    for (const [id, a] of this.store.entries()) {
      if (a.studentId === studentId && a.leaderId === leaderId) {
        this.store.delete(id);
        return true;
      }
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Service Sessions
// ---------------------------------------------------------------------------
export class InMemoryServiceSessionRepository
  extends InMemoryBaseRepository<ServiceSession>
  implements IServiceSessionRepository
{
  async findValid(): Promise<ServiceSession[]> {
    return Array.from(this.store.values())
      .filter((s) => s.isValid && s.isRegular)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((s) => this.clone(s));
  }

  async saveMany(sessions: ServiceSession[]): Promise<void> {
    for (const s of sessions) this.store.set(s.id, this.clone(s));
  }
}

// ---------------------------------------------------------------------------
// Service Attendance
// ---------------------------------------------------------------------------
export class InMemoryServiceAttendanceRepository
  implements IServiceAttendanceRepository
{
  private store: ServiceAttendance[] = [];

  async init(): Promise<void> {
    this.store = [];
  }

  async findAll(): Promise<ServiceAttendance[]> {
    return [...this.store];
  }

  async findBySession(sessionId: string): Promise<ServiceAttendance[]> {
    return this.store.filter((r) => r.sessionId === sessionId);
  }

  async saveMany(records: ServiceAttendance[]): Promise<void> {
    for (const r of records) {
      const idx = this.store.findIndex(
        (x) => x.studentId === r.studentId && x.sessionId === r.sessionId,
      );
      if (idx >= 0) this.store[idx] = r;
      else this.store.push(r);
    }
  }

  async deleteAll(): Promise<void> {
    this.store = [];
  }
}

// ---------------------------------------------------------------------------
// Lifegroups
// ---------------------------------------------------------------------------
export class InMemoryLifegroupRepository
  extends InMemoryBaseRepository<Lifegroup>
  implements ILifegroupRepository
{
  async saveMany(lifegroups: Lifegroup[]): Promise<void> {
    for (const g of lifegroups) this.store.set(g.id, this.clone(g));
  }

  private roll = new Map<string, LifegroupRollRow>();
  async saveRoll(rows: LifegroupRollRow[]): Promise<void> { for (const r of rows) this.roll.set(`${r.lifegroupId}|${r.nameKey}`, { ...r }); }
  async findRoll(): Promise<LifegroupRollRow[]> { return [...this.roll.values()].map((r) => ({ ...r })); }
  override async deleteAll(): Promise<void> { this.roll.clear(); await super.deleteAll(); }   // mirrors truncate ... cascade
}

// ---------------------------------------------------------------------------
// Lifegroup Weeks
// ---------------------------------------------------------------------------
export class InMemoryLifegroupWeekRepository
  extends InMemoryBaseRepository<LifegroupWeek>
  implements ILifegroupWeekRepository
{
  async saveMany(weeks: LifegroupWeek[]): Promise<void> {
    for (const w of weeks) this.store.set(w.id, this.clone(w));
  }
}

// ---------------------------------------------------------------------------
// Lifegroup Attendance
// ---------------------------------------------------------------------------
export class InMemoryLifegroupAttendanceRepository
  implements ILifegroupAttendanceRepository
{
  private store: LifegroupAttendance[] = [];

  async init(): Promise<void> {
    this.store = [];
  }

  async findAll(): Promise<LifegroupAttendance[]> {
    return [...this.store];
  }

  async saveMany(records: LifegroupAttendance[]): Promise<void> {
    for (const r of records) {
      const idx = this.store.findIndex(
        (x) => x.studentId === r.studentId && x.weekId === r.weekId && x.lifegroupId === r.lifegroupId,
      );
      if (idx >= 0) this.store[idx] = r;
      else this.store.push(r);
    }
  }

  async deleteAll(): Promise<void> {
    this.store = [];
  }
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------
export class InMemoryImportRepository
  extends InMemoryBaseRepository<ImportRecord>
  implements IImportRepository
{
  async findByType(type: 'service' | 'lifegroup'): Promise<ImportRecord[]> {
    return Array.from(this.store.values())
      .filter((r) => r.type === type)
      .sort((a, b) => b.importedAt.localeCompare(a.importedAt))
      .map((r) => this.clone(r));
  }
}

// ---------------------------------------------------------------------------
// Settings (singleton-style)
// ---------------------------------------------------------------------------
export class InMemorySettingsRepository
  extends InMemoryBaseRepository<AppSettings>
  implements ISettingsRepository
{
  private static readonly SETTINGS_ID = 'global';


  async getSettings(): Promise<AppSettings> {
    let s = await this.findById(InMemorySettingsRepository.SETTINGS_ID);
    if (!s) {
      s = this.defaultSettings();
      await this.save(s);
    }
    return s;
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.getSettings();
    const updated: AppSettings = { ...current, ...patch, id: InMemorySettingsRepository.SETTINGS_ID };
    return this.save(updated);
  }

  private defaultSettings(): AppSettings {
    return {
      id: InMemorySettingsRepository.SETTINGS_ID,
      termGapDays: 14,
      validThresholdPct: 25,
      serviceMinAttendance: 100,
      ministryConfig: MINISTRY_CONFIG_DEFAULTS,
      updatedAt: new Date().toISOString(),
    };
  }
}

// ---------------------------------------------------------------------------
// Admin Audit Log
// ---------------------------------------------------------------------------
export class InMemoryAuditRepository
  extends InMemoryBaseRepository<AdminAuditEntry>
  implements IAuditRepository
{
}

// ---------------------------------------------------------------------------
// Connection Audits (year-keyed snapshots)
// ---------------------------------------------------------------------------
export class InMemoryConnectionAuditRepository
  extends InMemoryBaseRepository<ConnectionAudit>
  implements IConnectionAuditRepository
{
  private src = new Map<string, StoredAuditSource>();

  override async init(): Promise<void> { await super.init(); this.src.clear(); }

  async findByYear(year: number): Promise<ConnectionAudit | null> {
    for (const a of this.store.values()) if (a.year === year) return this.clone(a);
    return null;
  }

  async findAllSummaries(): Promise<AuditSummary[]> {
    return [...this.store.values()].sort((a, b) => b.year - a.year).map((a) => ({ year: a.year, label: a.label, uploadedAt: a.uploadedAt,
      termKeys: ((a.snapshot as { terms?: { key: string }[] } | null)?.terms ?? []).map((t) => t.key) }));
  }

  async saveSource(row: StoredAuditSource): Promise<void> { this.src.set(`${row.year}|${row.source}`, JSON.parse(JSON.stringify(row))); }

  async sources(year: number): Promise<StoredAuditSource[]> {
    return [...this.src.values()].filter((s) => s.year === year).map((s) => JSON.parse(JSON.stringify(s)) as StoredAuditSource);
  }

  async deleteAllSources(): Promise<void> { this.src.clear(); }

  // ponytail: memory mode (dev/test) has no rollback and no lock; Supabase does both (withYearLock above).
  async withYearLock<T>(_year: number, fn: (tx: IConnectionAuditRepository) => Promise<T>): Promise<T> { return fn(this); }
}

