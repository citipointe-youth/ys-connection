import type { IRepository } from './base.repository';
import type { User } from '../../core/entities/user';
import type { Student } from '../../core/entities/student';
import type { Leader } from '../../core/entities/leader';
import type { PrayerRequest } from '../../core/entities/prayer';
import type { Connection } from '../../core/entities/connection';
import type {
  ServiceSession,
  ServiceAttendance,
  Lifegroup,
  LifegroupWeek,
  LifegroupAttendance,
  ImportRecord,
} from '../../core/entities/attendance';
import type { AppSettings, AdminAuditEntry } from '../../core/entities/settings';
import type { ConnectionAudit } from '../../core/entities/connection-audit';
import type { UserRole } from '../../core/types/enums';
import type {
  BusVehicle,
  BusLeaderPrefs,
  BusGuest,
  BusAddress,
  BusRun,
  BusRunVehicle,
  BusRunRider,
  BusConsent,
  BusUndoEntry,
} from '../../core/entities/bus';

export interface IUserRepository extends IRepository<User> {
  findByEmail(email: string): Promise<User | null>;
  findByRole(role: UserRole): Promise<User[]>;
}

export interface IStudentRepository extends IRepository<Student> {
  findByGrade(grade: number): Promise<Student[]>;
  findByGender(gender: string): Promise<Student[]>;
  search(query: string): Promise<Student[]>;
  saveMany(students: Student[]): Promise<void>;
  deleteAll(): Promise<void>;
}

export interface ILeaderRepository extends IRepository<Leader> {
  findByGrade(grade: number): Promise<Leader[]>;
  findActive(): Promise<Leader[]>;
  saveMany(leaders: Leader[]): Promise<void>;
  deleteAll(): Promise<void>;
}

export interface IPrayerRepository extends IRepository<PrayerRequest> {
  findByStudent(studentId: string): Promise<PrayerRequest[]>;
  // M1 (2026-07-19): cascade-delete a student's prayers when the student
  // itself is deleted, so they don't persist forever invisibly (list() skips
  // an orphan) and undeletably (edit/delete throws NotFound for one). No-op
  // if the student has no prayers.
  deleteByStudent(studentId: string): Promise<void>;
  deleteAll(): Promise<void>;
}

export interface IConnectionRepository extends IRepository<Connection> {
  findByStudent(studentId: string): Promise<Connection[]>;
  findByLeader(leaderId: string): Promise<Connection[]>;
  findByStudentAndLeader(studentId: string, leaderId: string): Promise<Connection | null>;
  deleteByStudentAndLeader(studentId: string, leaderId: string): Promise<boolean>;
  deleteAll(): Promise<void>;
}

export interface IServiceSessionRepository extends IRepository<ServiceSession> {
  findByImport(importId: string): Promise<ServiceSession[]>;
  findValid(): Promise<ServiceSession[]>;
  saveMany(sessions: ServiceSession[]): Promise<void>;
  deleteAll(): Promise<void>;
}

export interface IServiceAttendanceRepository {
  init(): Promise<void>;
  findByStudent(studentId: string): Promise<ServiceAttendance[]>;
  findBySession(sessionId: string): Promise<ServiceAttendance[]>;
  save(record: ServiceAttendance): Promise<ServiceAttendance>;
  saveMany(records: ServiceAttendance[]): Promise<void>;
  deleteByImport(importId: string): Promise<void>;
  deleteAll(): Promise<void>;
  findAll(): Promise<ServiceAttendance[]>;
}

export interface ILifegroupRepository extends IRepository<Lifegroup> {
  saveMany(lifegroups: Lifegroup[]): Promise<void>;
  deleteAll(): Promise<void>;
}

export interface ILifegroupWeekRepository extends IRepository<LifegroupWeek> {
  findByImport(importId: string): Promise<LifegroupWeek[]>;
  saveMany(weeks: LifegroupWeek[]): Promise<void>;
  deleteAll(): Promise<void>;
}

export interface ILifegroupAttendanceRepository {
  init(): Promise<void>;
  findByStudent(studentId: string): Promise<LifegroupAttendance[]>;
  findByWeek(weekId: string): Promise<LifegroupAttendance[]>;
  saveMany(records: LifegroupAttendance[]): Promise<void>;
  deleteByImport(importId: string): Promise<void>;
  deleteAll(): Promise<void>;
  findAll(): Promise<LifegroupAttendance[]>;
}

export interface IImportRepository extends IRepository<ImportRecord> {
  findByType(type: 'service' | 'lifegroup'): Promise<ImportRecord[]>;
  deleteAll(): Promise<void>;
}

export interface ISettingsRepository extends IRepository<AppSettings> {
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
}

export interface IAuditRepository extends IRepository<AdminAuditEntry> {
  findRecent(limit: number): Promise<AdminAuditEntry[]>;
}

export interface IConnectionAuditRepository extends IRepository<ConnectionAudit> {
  findByYear(year: number): Promise<ConnectionAudit | null>;
}

export interface IBusRepository {
  init(): Promise<void>;
  listVehicles(): Promise<BusVehicle[]>;
  getVehicle(id: string): Promise<BusVehicle | null>;
  saveVehicle(v: BusVehicle): Promise<BusVehicle>;
  listLeaderPrefs(): Promise<BusLeaderPrefs[]>;
  getLeaderPrefs(leaderId: string): Promise<BusLeaderPrefs | null>;
  saveLeaderPrefs(p: BusLeaderPrefs): Promise<BusLeaderPrefs>;
  listGuests(): Promise<BusGuest[]>;
  getGuest(id: string): Promise<BusGuest | null>;
  saveGuest(g: BusGuest): Promise<BusGuest>;
  deleteGuest(id: string): Promise<void>;           // also deletes the guest's addresses
  listAddresses(owner: { studentId?: string; guestId?: string }): Promise<BusAddress[]>; // newest lastUsedAt first
  listAllAddresses(): Promise<BusAddress[]>; // every saved address, any order — "Past riders" groups these by owner
  getAddress(id: string): Promise<BusAddress | null>;
  saveAddress(a: BusAddress): Promise<BusAddress>;
  reassignGuestAddresses(guestId: string, studentId: string): Promise<void>;
  getRunByDate(serviceDate: string): Promise<BusRun | null>;
  getRun(id: string): Promise<BusRun | null>;
  listRuns(): Promise<BusRun[]>;                    // newest serviceDate first
  insertRunIfAbsent(r: BusRun): Promise<{ run: BusRun; created: boolean }>;
  bumpRun(runId: string, by: string, atIso: string): Promise<BusRun>; // version+1, lastChange*
  listRunVehicles(runId: string): Promise<BusRunVehicle[]>;
  saveRunVehicle(v: BusRunVehicle): Promise<BusRunVehicle>;
  deleteRunVehicle(id: string): Promise<void>;
  listRunRiders(runId: string): Promise<BusRunRider[]>;
  getRunRider(id: string): Promise<BusRunRider | null>;
  saveRunRider(r: BusRunRider): Promise<BusRunRider>;
  deleteRunRider(id: string): Promise<void>;
  listConsents(): Promise<BusConsent[]>;
  getConsent(owner: { studentId?: string; guestId?: string }): Promise<BusConsent | null>;
  saveConsent(c: BusConsent): Promise<BusConsent>;
  reassignGuestConsent(guestId: string, studentId: string): Promise<void>; // only if the student has none; else drop the guest's
  /** Atomic: sets lock_by/lock_until only if the run is unlocked or the lock has expired; null = someone else holds it. */
  tryLock(runId: string, by: string, nowIso: string, untilIso: string): Promise<BusRun | null>;
  /** M1: only clears the lock if `by` still holds it — a generate that overran LOCK_MS must
   *  never clear a lock a second generate has since legitimately taken over. */
  releaseLock(runId: string, by: string): Promise<void>;
  setUndo(runId: string, snapshot: BusUndoEntry[] | null, untilIso: string | null): Promise<void>;
  /** Writes ONLY available_pool_leader_ids — must not clobber a live lock or other run fields. */
  setPoolIds(runId: string, ids: string[]): Promise<void>;
}

