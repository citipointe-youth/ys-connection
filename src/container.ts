import { join } from 'node:path';
import { env } from './config/env';

import {
  InMemoryUserRepository,
  InMemoryStudentRepository,
  InMemoryLeaderRepository,
  InMemoryAllocationRepository,
  InMemoryServiceSessionRepository,
  InMemoryServiceAttendanceRepository,
  InMemoryLifegroupRepository,
  InMemoryLifegroupWeekRepository,
  InMemoryLifegroupAttendanceRepository,
  InMemoryImportRepository,
  InMemorySettingsRepository,
  InMemorySnapshotRepository,
  InMemoryAuditRepository,
} from './repositories/in-memory';
import { JsonFilePersistence } from './repositories/persistence';

import type {
  IUserRepository,
  IStudentRepository,
  ILeaderRepository,
  IAllocationRepository,
  IServiceSessionRepository,
  IServiceAttendanceRepository,
  ILifegroupRepository,
  ILifegroupWeekRepository,
  ILifegroupAttendanceRepository,
  IImportRepository,
  ISettingsRepository,
  ISnapshotRepository,
  IAuditRepository,
} from './repositories/interfaces';

import { makeAuthService, type AuthService } from './services/auth.service';
import { makeStudentService, type StudentService } from './services/student.service';
import { makeLeaderService, type LeaderService } from './services/leader.service';
import { makeAllocationService, type AllocationService } from './services/allocation.service';
import { makeOverviewService, type OverviewService } from './services/overview.service';
import { makeAtRiskService, type AtRiskService } from './services/atrisk.service';
import { makeImportService, type ImportService } from './services/import.service';
import { makeSettingsService, type SettingsService } from './services/settings.service';
import { makeAccountService, type AccountService } from './services/account.service';
import { makeAdminService, type AdminService } from './services/admin.service';
import { makeTrendsService, type TrendsService } from './services/trends.service';

export interface Repositories {
  users: IUserRepository;
  students: IStudentRepository;
  leaders: ILeaderRepository;
  allocations: IAllocationRepository;
  serviceSessions: IServiceSessionRepository;
  serviceAttendance: IServiceAttendanceRepository;
  lifegroups: ILifegroupRepository;
  lifegroupWeeks: ILifegroupWeekRepository;
  lifegroupAttendance: ILifegroupAttendanceRepository;
  imports: IImportRepository;
  settings: ISettingsRepository;
  snapshots: ISnapshotRepository;
  audit: IAuditRepository;
}

export interface Services {
  auth: AuthService;
  student: StudentService;
  leader: LeaderService;
  allocation: AllocationService;
  overview: OverviewService;
  atRisk: AtRiskService;
  trends: TrendsService;
  importService: ImportService;
  settings: SettingsService;
  account: AccountService;
  admin: AdminService;
  users: IUserRepository;
}

export interface Container {
  repos: Repositories;
  services: Services;
}

function makeJson<T>(filename: string): JsonFilePersistence<T> {
  return new JsonFilePersistence<T>(join(env.DATA_DIR, filename));
}

export async function buildContainer(): Promise<Container> {
  const useJson = env.PERSISTENCE === 'json';

  // ----- Repositories -----
  const users: IUserRepository = new InMemoryUserRepository(useJson ? makeJson('users.json') : undefined);
  const students: IStudentRepository = new InMemoryStudentRepository(useJson ? makeJson('students.json') : undefined);
  const leaders: ILeaderRepository = new InMemoryLeaderRepository(useJson ? makeJson('leaders.json') : undefined);
  const allocations: IAllocationRepository = new InMemoryAllocationRepository(useJson ? makeJson('allocations.json') : undefined);
  const serviceSessions: IServiceSessionRepository = new InMemoryServiceSessionRepository(useJson ? makeJson('service-sessions.json') : undefined);
  const serviceAttendance: IServiceAttendanceRepository = new InMemoryServiceAttendanceRepository(useJson ? makeJson('service-attendance.json') : undefined);
  const lifegroups: ILifegroupRepository = new InMemoryLifegroupRepository(useJson ? makeJson('lifegroups.json') : undefined);
  const lifegroupWeeks: ILifegroupWeekRepository = new InMemoryLifegroupWeekRepository(useJson ? makeJson('lifegroup-weeks.json') : undefined);
  const lifegroupAttendance: ILifegroupAttendanceRepository = new InMemoryLifegroupAttendanceRepository(useJson ? makeJson('lifegroup-attendance.json') : undefined);
  const imports: IImportRepository = new InMemoryImportRepository(useJson ? makeJson('imports.json') : undefined);
  const settings: ISettingsRepository = new InMemorySettingsRepository(useJson ? makeJson('settings.json') : undefined);
  const snapshots: ISnapshotRepository = new InMemorySnapshotRepository(useJson ? makeJson('snapshots.json') : undefined);
  const audit: IAuditRepository = new InMemoryAuditRepository(useJson ? makeJson('audit.json') : undefined);

  const repos: Repositories = {
    users, students, leaders, allocations,
    serviceSessions, serviceAttendance,
    lifegroups, lifegroupWeeks, lifegroupAttendance,
    imports, settings, snapshots, audit,
  };

  // Init all repos
  await Promise.all([
    users.init(), students.init(), leaders.init(), allocations.init(),
    serviceSessions.init(), serviceAttendance.init(),
    lifegroups.init(), lifegroupWeeks.init(), lifegroupAttendance.init(),
    imports.init(), settings.init(), snapshots.init(), audit.init(),
  ]);

  // ----- Services -----
  const auth = makeAuthService(users);
  const student = makeStudentService(students);
  const leader = makeLeaderService(leaders);
  const allocation = makeAllocationService(allocations, students, leaders, settings);
  const overview = makeOverviewService(students, leaders, allocations);
  const atRisk = makeAtRiskService(students, settings);
  const trends = makeTrendsService(students, serviceSessions, serviceAttendance, settings);
  const importService = makeImportService(students, serviceSessions, serviceAttendance, imports, settings);
  const settingsSvc = makeSettingsService(settings, audit);
  const account = makeAccountService(users);
  const admin = makeAdminService(users, students, leaders, allocations, imports, snapshots, audit);

  const services: Services = {
    auth, student, leader, allocation, overview, atRisk, trends,
    importService, settings: settingsSvc, account, admin,
    users,
  };

  return { repos, services };
}
