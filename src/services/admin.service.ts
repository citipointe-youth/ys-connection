import { assertCan } from './access-control';
import type {
  IUserRepository,
  IStudentRepository,
  ILeaderRepository,
  IAllocationRepository,
  IImportRepository,
  ISnapshotRepository,
  IAuditRepository,
} from '../repositories/interfaces/entity-repositories';
import type { Actor } from '../core/entities/user';
import type { AdminAuditEntry } from '../core/entities/settings';
import { generateId } from '../utils/id';

export interface AdminAuditRow {
  id: string;
  action: string;
  performedBy: string;
  performedAt: string;
  detail: string;
}

export interface AdminService {
  reset(actor: Actor): Promise<void>;
  saveDefaults(actor: Actor): Promise<void>;
  newYear(actor: Actor): Promise<void>;
  getAuditLog(actor: Actor, limit?: number): Promise<AdminAuditRow[]>;
}

async function writeAudit(
  repo: IAuditRepository,
  actor: Actor,
  action: AdminAuditEntry['action'],
  detail: string,
): Promise<void> {
  await repo.save({
    id: generateId(),
    action,
    performedBy: actor.displayName,
    performedAt: new Date().toISOString(),
    detail,
  });
}

export function makeAdminService(
  users: IUserRepository,
  students: IStudentRepository,
  leaders: ILeaderRepository,
  allocations: IAllocationRepository,
  imports: IImportRepository,
  snapshots: ISnapshotRepository,
  audit: IAuditRepository,
): AdminService {
  return {
    async reset(actor) {
      assertCan(actor, 'admin:manage');
      const all = await students.findAll();
      for (const s of all) await students.delete(s.id);
      const allLeaders = await leaders.findAll();
      for (const l of allLeaders) await leaders.delete(l.id);
      const allAllocs = await allocations.findAll();
      for (const a of allAllocs) await allocations.delete(a.id);
      const allImports = await imports.findAll();
      for (const i of allImports) await imports.delete(i.id);
      await writeAudit(audit, actor, 'reset', 'Full data reset — students, leaders, allocations and imports cleared');
    },

    async saveDefaults(actor) {
      assertCan(actor, 'admin:manage');
      const allUsers = await users.findAll();
      const allLeaders = await leaders.findAll();
      const now = new Date().toISOString();
      await snapshots.save({
        id: generateId(),
        snapshot: {
          users: allUsers.map(({ passwordHash: _pw, ...u }) => u),
          leaders: allLeaders,
        },
        createdAt: now,
      });
      await writeAudit(audit, actor, 'save-defaults', `Saved ${allUsers.length} accounts and ${allLeaders.length} leaders as defaults`);
    },

    async newYear(actor) {
      assertCan(actor, 'admin:manage');
      const now = new Date().toISOString();
      const all = await students.findAll();
      const studentCount = all.length;

      // Snapshot current-term attendance into prev* fields, then zero current-term stats.
      // Students are retained so the next import can update them and the at-risk screen
      // can show the decline trend (current term vs previous term).
      for (const s of all) {
        await students.save({
          ...s,
          prevSvcAttended: s.svcAttended,
          prevSvcTotal: s.svcTotal,
          prevGrpAttended: s.grpAttended,
          prevGrpTotal: s.grpTotal,
          svcAttended: 0,
          svcTotal: 0,
          grpAttended: 0,
          grpTotal: 0,
          grpMetWeeks: 0,
          atRiskStatus: 'new',
          updatedAt: now,
        });
      }

      // Clear allocations and import history — leaders and accounts are kept.
      const allAllocs = await allocations.findAll();
      for (const a of allAllocs) await allocations.delete(a.id);
      const allImports = await imports.findAll();
      for (const i of allImports) await imports.delete(i.id);

      await writeAudit(audit, actor, 'new-year', `New year started — ${studentCount} students retained with previous-term snapshot, all allocations cleared`);
    },

    async getAuditLog(actor, limit = 20) {
      assertCan(actor, 'admin:manage');
      return audit.findRecent(limit);
    },
  };
}
