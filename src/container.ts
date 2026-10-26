import { env } from './config/env';
import { dedupeReads } from './utils/inflight-dedupe';

import {
  InMemoryUserRepository,
  InMemoryStudentRepository,
  InMemoryLeaderRepository,
  InMemoryPrayerRepository,
  InMemoryNoticeRepository,
  InMemoryNoticePushRepository,
  InMemoryConnectionRepository,
  InMemoryServiceSessionRepository,
  InMemoryServiceAttendanceRepository,
  InMemoryLifegroupRepository,
  InMemoryLifegroupWeekRepository,
  InMemoryLifegroupAttendanceRepository,
  InMemoryImportRepository,
  InMemorySettingsRepository,
  InMemoryAuditRepository,
  InMemoryConnectionAuditRepository,
  InMemoryBusRepository,
  InMemoryLinkRepository,
  InMemoryErrorLogRepository, InMemoryUnsentRepository,
} from './repositories/in-memory';
import {
  SupabaseUserRepository,
  SupabaseStudentRepository,
  SupabaseLeaderRepository,
  SupabasePrayerRepository,
  SupabaseNoticeRepository,
  SupabaseNoticePushRepository,
  SupabaseConnectionRepository,
  SupabaseServiceSessionRepository,
  SupabaseServiceAttendanceRepository,
  SupabaseLifegroupRepository,
  SupabaseLifegroupWeekRepository,
  SupabaseLifegroupAttendanceRepository,
  SupabaseImportRepository,
  SupabaseSettingsRepository,
  SupabaseAuditRepository,
  SupabaseConnectionAuditRepository,
  SupabaseBusRepository,
  SupabaseLinkRepository,
  SupabaseErrorLogRepository, SupabaseUnsentRepository,
  getSqlClient,
} from './repositories/supabase/index';

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
  IBusRepository,
} from './repositories/interfaces';
import type { ILinkRepository } from './repositories/interfaces/link.repository';
import type { IErrorLogRepository } from './repositories/interfaces/error-log.repository';

import { makeAuthService, type AuthService } from './services/auth.service';
import { makeStudentService, type StudentService } from './services/student.service';
import { makeDnc } from './services/dnc';
import { makeLeaderService, type LeaderService } from './services/leader.service';
import { makePrayerService, type PrayerService } from './services/prayer.service';
import { makeNoticeService, type NoticeService } from './services/notice.service';
import { makeConnectionService, type ConnectionService } from './services/connection.service';
import { makeFollowupService, type FollowupService } from './services/followup.service';
import { makeOverviewService, type OverviewService } from './services/overview.service';
import { makeAtRiskService, type AtRiskService } from './services/atrisk.service';
import { makeImportService, type ImportService } from './services/import.service';
import { makeSettingsService, type SettingsService } from './services/settings.service';
import { makeAccountService, type AccountService } from './services/account.service';
import { makeAdminService, type AdminService } from './services/admin.service';
import { makeTrendsService, type TrendsService } from './services/trends.service';
import { makeLifegroupStatsService, type LifegroupStatsService } from './services/lifegroup-stats.service';
import { makeConnectionAuditService, type ConnectionAuditService } from './services/connection-audit.service';
import { makeNewYouthService, type NewYouthService } from './services/new-youth.service';
import { makeBusService, type BusService } from './services/bus.service';
import { ingestBusConsentForms } from './services/bus-consent';
import { makeSetupService, type SetupService } from './services/setup.service';
import { makeLinkService, LINK_RATE_MAX, LINK_RATE_WINDOW_MS, type LinkService } from './services/link.service';
import { makeSyncService, type SyncService } from './services/sync.service';
import { makeIntakeService, type IntakeService } from './services/link-intake.service';
import { InMemoryLinkIntakeRepository } from './repositories/in-memory/link-intake.repository';
import { SupabaseLinkIntakeRepository } from './repositories/supabase/supabase.link-intake';
import type { ILinkIntakeRepository } from './repositories/interfaces/link-intake.repository';
import { makeReconcileService, type ReconcileService } from './services/reconcile.service';
import { InMemoryReconcileRunRepository } from './repositories/in-memory/reconcile-run.repository';
import { SupabaseReconcileRunRepository } from './repositories/supabase/supabase.reconcile-run';
import type { IReconcileRunRepository } from './repositories/interfaces/reconcile-run.repository';
import { makeErrorLogService, type ErrorLogService } from './services/error-log.service';
import { RateLimiter } from './utils/rate-limiter';
import { cachedProbe } from './utils/cached-probe';
import { LATEST_MIGRATION } from './core/schema-version';
import { routingFromEnv } from './services/routing/google-routing-provider';

export interface Repositories {
  users: IUserRepository;
  students: IStudentRepository;
  leaders: ILeaderRepository;
  prayers: IPrayerRepository;
  notices: INoticeRepository;
  connections: IConnectionRepository;
  serviceSessions: IServiceSessionRepository;
  serviceAttendance: IServiceAttendanceRepository;
  lifegroups: ILifegroupRepository;
  lifegroupWeeks: ILifegroupWeekRepository;
  lifegroupAttendance: ILifegroupAttendanceRepository;
  imports: IImportRepository;
  settings: ISettingsRepository;
  audit: IAuditRepository;
  connectionAudits: IConnectionAuditRepository;
  bus: IBusRepository;
  link: ILinkRepository;
  errorLog: IErrorLogRepository;
}

export interface Services {
  auth: AuthService;
  student: StudentService;
  leader: LeaderService;
  prayer: PrayerService;
  notice: NoticeService;
  connection: ConnectionService;
  followup: FollowupService;
  overview: OverviewService;
  atRisk: AtRiskService;
  trends: TrendsService;
  lifegroupStats: LifegroupStatsService;
  importService: ImportService;
  settings: SettingsService;
  account: AccountService;
  admin: AdminService;
  connectionAudit: ConnectionAuditService;
  bus: BusService;
  newYouth: NewYouthService;
  link: LinkService;
  sync: SyncService;
  /** T4 (X19): admin Intakes + Consents (GET /link/intake*, POST /link/intake/refresh). */
  intake: IntakeService;
  /** T3 admin Error log. `errorLog.record(...)` is the helper to log an error from server code. */
  errorLog: ErrorLogService;
  /** Part 2 reconciliation: runs after each import; POST /sync/reconcile/latest and the admin Who? view. */
  reconcile: ReconcileService;
  users: IUserRepository;
  setup: SetupService;
  /** Cached (30 s) db + schema probe for GET /health. */
  health: () => Promise<Record<string, unknown>>;
}

export interface Container {
  repos: Repositories;
  services: Services;
}

export async function buildContainer(): Promise<Container> {
  const useSupabase = env.PERSISTENCE === 'supabase';
  const sql = useSupabase ? getSqlClient() : null!;

  // ----- Repositories -----
  const users: IUserRepository = useSupabase
    ? new SupabaseUserRepository(sql)
    : new InMemoryUserRepository();
  const students: IStudentRepository = useSupabase
    ? new SupabaseStudentRepository(sql)
    : new InMemoryStudentRepository();
  const leaders: ILeaderRepository = useSupabase
    ? new SupabaseLeaderRepository(sql)
    : new InMemoryLeaderRepository();
  const prayers: IPrayerRepository = useSupabase
    ? new SupabasePrayerRepository(sql)
    : new InMemoryPrayerRepository();
  const notices: INoticeRepository = useSupabase
    ? new SupabaseNoticeRepository(sql)
    : new InMemoryNoticeRepository();
  const noticePush: INoticePushRepository = useSupabase
    ? new SupabaseNoticePushRepository(sql)
    : new InMemoryNoticePushRepository();
  const connections: IConnectionRepository = useSupabase
    ? new SupabaseConnectionRepository(sql)
    : new InMemoryConnectionRepository();
  const serviceSessions: IServiceSessionRepository = useSupabase
    ? new SupabaseServiceSessionRepository(sql)
    : new InMemoryServiceSessionRepository();
  const serviceAttendance: IServiceAttendanceRepository = useSupabase
    ? new SupabaseServiceAttendanceRepository(sql)
    : new InMemoryServiceAttendanceRepository();
  const lifegroups: ILifegroupRepository = useSupabase
    ? new SupabaseLifegroupRepository(sql)
    : new InMemoryLifegroupRepository();
  const lifegroupWeeks: ILifegroupWeekRepository = useSupabase
    ? new SupabaseLifegroupWeekRepository(sql)
    : new InMemoryLifegroupWeekRepository();
  const lifegroupAttendance: ILifegroupAttendanceRepository = useSupabase
    ? new SupabaseLifegroupAttendanceRepository(sql)
    : new InMemoryLifegroupAttendanceRepository();
  const imports: IImportRepository = useSupabase
    ? new SupabaseImportRepository(sql)
    : new InMemoryImportRepository();
  const settings: ISettingsRepository = useSupabase
    ? new SupabaseSettingsRepository(sql)
    : new InMemorySettingsRepository();
  const audit: IAuditRepository = useSupabase
    ? new SupabaseAuditRepository(sql)
    : new InMemoryAuditRepository();
  const connectionAudits: IConnectionAuditRepository = useSupabase
    ? new SupabaseConnectionAuditRepository(sql)
    : new InMemoryConnectionAuditRepository();
  // Memory mode is dev/test only.
  const bus: IBusRepository = useSupabase ? new SupabaseBusRepository(sql) : new InMemoryBusRepository();
  // Elvanto link.
  const link: ILinkRepository = useSupabase ? new SupabaseLinkRepository(sql) : new InMemoryLinkRepository();
  const errorLogRepo: IErrorLogRepository = useSupabase ? new SupabaseErrorLogRepository(sql) : new InMemoryErrorLogRepository();
  const reconcileRuns: IReconcileRunRepository = useSupabase ? new SupabaseReconcileRunRepository(sql) : new InMemoryReconcileRunRepository();
  const intakeRepo: ILinkIntakeRepository = useSupabase ? new SupabaseLinkIntakeRepository(sql) : new InMemoryLinkIntakeRepository();

  // Home/Trends fan out to several endpoints in parallel that each independently
  // re-fetch the same full tables (e.g. studentRepo.findAll() runs 4x for one Home
  // load). Coalesce concurrent callers of these no-arg reads into a single query —
  // safe because none of them vary by caller; actor-scoping happens in the service
  // layer after the fetch. Supabase-only: in-memory repos (tests) are already
  // instant and don't need it.
  if (useSupabase) {
    dedupeReads(students, 'students', ['findAll', 'findAllWithGraduated']);
    dedupeReads(leaders, 'leaders', ['findActive']);
    dedupeReads(prayers, 'prayers', ['findAll']);
    dedupeReads(connections, 'connections', ['findAll']);
    dedupeReads(serviceSessions, 'serviceSessions', ['findAll']);
    dedupeReads(lifegroups, 'lifegroups', ['findAll']);
    dedupeReads(lifegroupWeeks, 'lifegroupWeeks', ['findAll']);
    dedupeReads(lifegroupAttendance, 'lifegroupAttendance', ['findAll']);
    dedupeReads(settings, 'settings', ['getSettings']);
    dedupeReads(link, 'link', ['roster', 'services', 'groups', 'flows', 'mirrorState', 'listConsoles']);
  }

  const repos: Repositories = {
    users, students, leaders, prayers, notices, connections,
    serviceSessions, serviceAttendance,
    lifegroups, lifegroupWeeks, lifegroupAttendance,
    imports, settings, audit, connectionAudits, bus, link, errorLog: errorLogRepo,
  };

  // Init all repos
  await Promise.all([
    users.init(), students.init(), leaders.init(), prayers.init(), notices.init(), noticePush.init(), connections.init(),
    serviceSessions.init(), serviceAttendance.init(),
    lifegroups.init(), lifegroupWeeks.init(), lifegroupAttendance.init(),
    imports.init(), settings.init(), audit.init(), connectionAudits.init(), bus.init(),
  ]);

  // ----- Services -----
  const auth = makeAuthService(users);
  const dnc = makeDnc(link); // R1: one shared DO NOT CONTACT cache for every student read
  const student = makeStudentService(students, settings, connections, prayers, dnc);
  const leader = makeLeaderService(leaders, settings);
  const prayer = makePrayerService(prayers, students, settings, connections);
  const connection = makeConnectionService(connections, students, leaders, settings, dnc);
  const followup = makeFollowupService(
    connections, students, leaders,
    serviceSessions, serviceAttendance,
    lifegroupWeeks, lifegroupAttendance, dnc,
  );
  const overview = makeOverviewService(students, leaders, connections, settings);
  const atRisk = makeAtRiskService(students, settings, connections, dnc);
  const trends = makeTrendsService(students, serviceSessions, serviceAttendance, settings);
  const lifegroupStats = makeLifegroupStatsService(students, lifegroups, lifegroupWeeks, lifegroupAttendance, serviceSessions, settings);
  // Bound after `reconcile` is built below; read at call time (same late binding as intake.off).
  let afterImport: (kind: 'service' | 'lifegroup') => Promise<void> = async () => {};
  const busSvc = makeBusService(bus, students, leaders, settings, routingFromEnv(), connections, dnc, { link,
    // F4: newYouth is built below; the arrow reads it at call time (same late binding as afterImport).
    newYouth: { sendBusConsent: (actor, input) => newYouth.sendBusConsent(actor, input) } });
  const importService = makeImportService(students, serviceSessions, serviceAttendance, imports, settings, lifegroups, lifegroupWeeks, lifegroupAttendance, leaders, useSupabase ? sql : null,
    (kind) => afterImport(kind),
    async () => new Map((await link.groups()).map((g) => [g.name.trim().toLowerCase(), g.groupId])));
  const settingsSvc = makeSettingsService(settings, audit, users, () => intake.off());
  const account = makeAccountService(users, settings);
  const admin = makeAdminService(
    students, leaders, connections,
    serviceSessions, serviceAttendance,
    lifegroups, lifegroupWeeks, lifegroupAttendance,
    imports, audit, connectionAudits,
  );
  // Always live (owner 2026-10-12: the ELVANTO_FORMS_LIVE gate was removed; test sends are deleted in Elvanto).
  // Local dev and preview deployments send real forms too.
  // auditFeed arrows run at request time, after connectionAudit exists (spec 2026-10-22 §7: feed check on /admin/errors and latest).
  const errorLog = makeErrorLogService({ repo: errorLogRepo, link, settings, auditFeed: () => connectionAudit.checkFeed() });
  const connectionAudit = makeConnectionAuditService(connectionAudits, settings, { link, errorLog,
    consentRows: () => intakeRepo.rows('consent') }); // consent audit B: get() reads a failed read as [] (link.service lets it throw)
  const notice = makeNoticeService(notices, settings, undefined, { subs: noticePush, users, errorLog });
  // T10: failed or unconfirmed New person sends are kept (encrypted) for the admin to resend.
  const unsent = useSupabase ? new SupabaseUnsentRepository(sql) : new InMemoryUnsentRepository();
  const newYouth = makeNewYouthService(settings, { live: true, errorLog, unsent });
  const linkSvc = makeLinkService({ link, settings, students, leaders, users, serviceSessions, serviceAttendance,
    limiter: new RateLimiter(LINK_RATE_MAX, LINK_RATE_WINDOW_MS), errorLog, intake: intakeRepo });
  const intake = makeIntakeService({ intake: intakeRepo, link, settings, status: (a) => linkSvc.status(a), errorLog });
  const sync = makeSyncService({ link, settings, students, users, errorLog, intake, leaders, audit: connectionAudit,
    busConsent: (req) => ingestBusConsentForms({ bus, students, settings }, req) });
  const reconcile = makeReconcileService({ link, students, lifegroups, lifegroupWeeks, lifegroupAttendance, serviceSessions,
    serviceAttendance, imports, settings, errorLog, errorRows: errorLogRepo, runs: reconcileRuns,
    auditFeed: () => connectionAudit.checkFeed() });
  // Never throws: the bus step is caught here, rematch/run catch internally and run() is bounded (10 s).
  afterImport = async (kind) => {
    await busSvc.linkGuestsAfterImport().catch(() => undefined);
    if (kind === 'lifegroup') await reconcile.run(); else await reconcile.rematch();
  };

  const probeDb = async (): Promise<boolean> => {
    if (!useSupabase) return true;
    try {
      await Promise.race([sql`select 1`, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))]);
      return true;
    } catch { return false; }
  };
  const schemaVersion = async (): Promise<string | null> => {
    if (!useSupabase) return LATEST_MIGRATION;
    try {
      const q = sql<{ v: string | null }[]>`select max(version) as v from schema_migrations`;
      const [r] = await Promise.race([q, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))]);
      return r?.v ?? null;
    }
    catch { return null; }
  };
  const setup = makeSetupService({ users, auth, settings, env: process.env, probeDb, schemaVersion, flows: () => link.flows() }); // Y2a: New People flow row
  const health = cachedProbe(async (): Promise<Record<string, unknown>> => {
    const [db, current] = await Promise.all([probeDb(), schemaVersion()]);
    return { db: db ? 'ok' : 'down', schema: { current, expected: LATEST_MIGRATION } };
  }, 30_000);

  const services: Services = {
    auth, student, leader, prayer, notice, connection, followup, overview, atRisk, trends, lifegroupStats,
    importService, settings: settingsSvc, account, admin, connectionAudit,
    bus: busSvc,
    newYouth,
    link: linkSvc,
    sync,
    intake,
    reconcile,
    errorLog,
    users,
    setup,
    health,
  };

  return { repos, services };
}
