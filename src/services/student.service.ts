import { z } from 'zod';
import { generateId } from '../utils/id';
import { assertCan, can, canAccessGender, canAccessGrade, canAccessStudent, studentRecordVisible, type StructureScope } from './access-control';
import type { IStudentRepository, ISettingsRepository, IConnectionRepository, IPrayerRepository, IServiceSessionRepository, IServiceAttendanceRepository, ILifegroupWeekRepository, ILifegroupAttendanceRepository } from '../repositories/interfaces/entity-repositories';
import type { ILinkRepository } from '../repositories/interfaces/link.repository';
import type { Student } from '../core/entities/student';
import type { Actor } from '../core/entities/user';
import { computeQuad } from '../core/types/enums';
import { MINISTRY_CONFIG_DEFAULTS, assertGradesInRange } from '../core/ministry-config';
import { NotFoundError } from '../core/errors/app-error';
import { makeDnc, type Dnc } from './dnc';
import { isRealDob } from './terms';
import { offRoster } from './link-rules';

/** R1: every student read carries `dnc`; phones are null for a DNC student unless admin/oversight. */
export type StudentView = Student & { dnc: boolean };

const CreateStudentSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  gender: z.enum(['male', 'female', 'other']),
  grade: z.number().int().min(6).max(12).nullable().optional(),
  mobile: z.string().nullable().optional(),
  parentPhone: z.string().nullable().optional(),
  dateOfBirth: z.string().refine(isRealDob, 'Date of birth must be a real date').nullable().optional(),
  dataSource: z.string().nullable().optional(),
});

// Every bulk path caps at 50 (CLAUDE.md).
const GraduateOffRosterSchema = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(50) });

/** Import > Not on the Elvanto roster: what it reads. Absent (test constructors) = held, nobody listed. */
export interface OffRosterDeps {
  link: Pick<ILinkRepository, 'roster' | 'mirrorState'>;
  sessions: Pick<IServiceSessionRepository, 'findAll'>;
  serviceAttendance: Pick<IServiceAttendanceRepository, 'findAll'>;
  weeks: Pick<ILifegroupWeekRepository, 'findAll'>;
  lifegroupAttendance: Pick<ILifegroupAttendanceRepository, 'findAll'>;
}
export interface OffRosterRow { id: string; name: string; grade: number | null; lastAttended: string | null }

export interface StudentService {
  list(actor: Actor, filter?: { grade?: number; gender?: string; query?: string; unconnected?: boolean; crossGrade?: boolean }): Promise<StudentView[]>;
  get(actor: Actor, id: string): Promise<StudentView>;
  create(actor: Actor, input: unknown): Promise<Student>;
  update(actor: Actor, id: string, input: unknown): Promise<Student>;
  remove(actor: Actor, id: string): Promise<void>;
  /** r25: admin only. Graduated students (Elvanto blanked a Year 12's grade), newest first. */
  listGraduated(actor: Actor): Promise<{ id: string; name: string; graduatedAt: string }[]>;
  /** r25: admin only. Puts a graduated student back in every list. */
  ungraduate(actor: Actor, id: string): Promise<void>;
  /** Admin only. Students with no Elvanto link and not on the active roster, most recently attended first. `held` = no roster to trust, so none. */
  listOffRoster(actor: Actor): Promise<{ held: boolean; rosterAt: string | null; rows: OffRosterRow[] }>;
  /** Admin only. Graduates the ids that are still candidates now; the rest come back in `skipped`. */
  graduateOffRoster(actor: Actor, input: unknown): Promise<{ graduated: string[]; skipped: string[] }>;
}

function stripSensitive(s: Student): Student {
  return { ...s, mobile: null, parentPhone: null };
}

export function makeStudentService(
  repo: IStudentRepository,
  settingsRepo?: ISettingsRepository,
  connRepo?: IConnectionRepository,
  // M1 (2026-07-19): optional so existing test constructors (makeStudentService(repo)
  // / (repo, settingsRepo) / (repo, settingsRepo, connRepo)) keep working unchanged —
  // the container always supplies it in production. When absent, remove() simply
  // doesn't cascade-delete prayers (today's pre-M1 behaviour).
  prayerRepo?: IPrayerRepository,
  dnc: Dnc = makeDnc(), // R1: optional; absent = nobody is DNC
  offRosterDeps?: OffRosterDeps,
): StudentService {
  // Structure config for scoping (cohortModel/genderPolicy, §5). Optional repo so
  // existing test harnesses constructing makeStudentService(repo) keep today's
  // all-defaults behaviour; the container always supplies it in production.
  async function structureScope(): Promise<StructureScope> {
    if (!settingsRepo) return MINISTRY_CONFIG_DEFAULTS.structure;
    return (await settingsRepo.getSettings()).ministryConfig.structure;
  }
  // Junior leaders (§5.2) see ONLY students connected to their linked leader
  // record. Returns null for every other role (or when no connRepo is wired).
  async function leaderStudentIds(actor: Actor): Promise<Set<string> | null> {
    if (actor.role !== 'leader' || !connRepo) return null;
    if (!actor.leaderId) return new Set();
    const conns = await connRepo.findByLeader(actor.leaderId);
    return new Set(conns.map((c) => c.studentId));
  }
  // F3 (review 2026-10-16): the cross-grade connect exception shows a same-gender student of another grade — names only, no phones.
  const phonesHidden = (actor: Actor, s: Student, structure: StructureScope) =>
    !can(actor, 'student:read:sensitive') ||
    ((actor.role === 'grade' || actor.role === 'quad') && !canAccessGrade(actor, s.grade, structure));
  async function offRosterNow() {
    if (!offRosterDeps) return { rows: [] as Student[], held: true, rosterAt: null };
    const [mirrors, roster, students] = await Promise.all([offRosterDeps.link.mirrorState(), offRosterDeps.link.roster(), repo.findAll()]);
    const push = mirrors.find((m) => m.kind === 'roster');
    return { ...offRoster(!!push, roster, students), rosterAt: push?.takenAt ?? null };
  }
  // The newest attended date per candidate: services and lifegroups, from the imported attendance. Dates are YYYY-MM-DD.
  async function lastAttendedOf(ids: Set<string>) {
    const d = offRosterDeps!;
    const [sessions, svc, weeks, grp] = await Promise.all([d.sessions.findAll(), d.serviceAttendance.findAll(), d.weeks.findAll(), d.lifegroupAttendance.findAll()]);
    const dayOf = new Map<string, string>([...sessions.map((s) => [s.id, s.sessionDate] as const), ...weeks.map((w) => [w.id, w.weekStart] as const)]);
    const last = new Map<string, string>();
    const see = (studentId: string, day: string | undefined) => {
      if (day && ids.has(studentId) && day > (last.get(studentId) ?? '')) last.set(studentId, day);
    };
    for (const a of svc) if (a.attended) see(a.studentId, dayOf.get(a.sessionId));
    for (const a of grp) if (a.attended) see(a.studentId, dayOf.get(a.weekId));
    return last;
  }
  return {
    async list(actor, filter) {
      assertCan(actor, 'student:read');
      const [students0, structure, myIds] = await Promise.all([repo.findAll(), structureScope(), leaderStudentIds(actor)]);
      let students = students0;

      // Junior leader: only their own connected students (§5.2).
      if (myIds) students = students.filter((s) => myIds.has(s.id));
      // Role-based scoping (grade -> own grade(s) + own gender; quad -> bracket +
      // gender). cohortModel/genderPolicy from config relax this appropriately.
      // `crossGrade` widens this to "own gender only" — used by Connect Setup's Add
      // Students picker so a leader whose grades have been broadened (self-service,
      // see updateGrades) can actually be offered students from that other grade.
      else if (actor.role === 'grade' || actor.role === 'quad') {
        students = filter?.crossGrade
          ? students.filter((s) => canAccessGender(actor, s.gender, structure))
          : students.filter((s) => canAccessStudent(actor, s.grade, s.gender, structure));
      }

      // Optional filters
      if (filter?.grade != null) students = students.filter((s) => s.grade === filter.grade);
      if (filter?.gender) {
        students = students.filter(
          (s) => s.gender.toLowerCase() === filter.gender!.toLowerCase(),
        );
      }
      if (filter?.query) {
        const q = filter.query.toLowerCase();
        students = students.filter((s) =>
          `${s.firstName} ${s.lastName}`.toLowerCase().includes(q),
        );
      }

      students = students.map((s) => (phonesHidden(actor, s, structure) ? stripSensitive(s) : s));

      const mark = await dnc.forActor(actor);
      return students.map((s) => mark(s, s.id)).sort((a, b) => a.lastName.localeCompare(b.lastName));
    },

    async get(actor, id) {
      assertCan(actor, 'student:read');
      const s = await repo.findById(id);
      if (!s || (s.graduatedAt && !can(actor, 'admin:manage'))) throw new NotFoundError('Student not found'); // r25

      // Junior leader may only fetch a student connected to them.
      if (actor.role === 'leader') {
        const myIds = await leaderStudentIds(actor);
        if (!myIds || !myIds.has(s.id)) throw new NotFoundError('Student not found');
      }
      // Grade logins may fetch a student of ANY grade (the cross-grade connect
      // exception) but only of their OWN gender; quad stays on bracket + gender (studentRecordVisible, F3).
      const structure = await structureScope();
      if (actor.role !== 'leader' && !studentRecordVisible(actor, s, structure)) throw new NotFoundError('Student not found');

      const mark = await dnc.forActor(actor);
      return mark(phonesHidden(actor, s, structure) ? stripSensitive(s) : s, s.id);
    },

    async create(actor, input) {
      assertCan(actor, 'student:write');
      const data = CreateStudentSchema.parse(input);
      assertGradesInRange((settingsRepo ? (await settingsRepo.getSettings()).ministryConfig : MINISTRY_CONFIG_DEFAULTS).structure, [data.grade]);
      const now = new Date().toISOString();
      const student: Student = {
        id: generateId(),
        firstName: data.firstName,
        lastName: data.lastName,
        gender: data.gender,
        grade: data.grade ?? null,
        quad: computeQuad(data.grade ?? null, data.gender),
        mobile: data.mobile ?? null,
        parentPhone: data.parentPhone ?? null,
        dateOfBirth: data.dateOfBirth ?? null,
        svcAttended: 0,
        svcTotal: 0,
        grpAttended: 0,
        grpTotal: 0,
        grpMetWeeks: 0,
        prevSvcAttended: 0,
        prevSvcTotal: 0,
        prevGrpAttended: 0,
        prevGrpTotal: 0,
        atRiskStatus: 'new',
        dataSource: data.dataSource ?? null,
        createdAt: now,
        updatedAt: now,
      };
      return repo.save(student);
    },

    async update(actor, id, input) {
      assertCan(actor, 'student:write');
      const existing = await repo.findById(id);
      if (!existing) throw new NotFoundError('Student not found');
      const patch = CreateStudentSchema.partial().parse(input);
      assertGradesInRange((settingsRepo ? (await settingsRepo.getSettings()).ministryConfig : MINISTRY_CONFIG_DEFAULTS).structure, [patch.grade]);
      const gender = patch.gender ?? existing.gender;
      const grade = patch.grade !== undefined ? (patch.grade ?? null) : existing.grade;
      return repo.save({
        ...existing,
        ...patch,
        grade,
        gender,
        quad: computeQuad(grade, gender),
        updatedAt: new Date().toISOString(),
      });
    },


    async remove(actor, id) {
      assertCan(actor, 'student:write');
      const deleted = await repo.delete(id);
      if (!deleted) throw new NotFoundError('Student not found');
      // M1: cascade-delete this student's prayers — otherwise they persist
      // forever, invisible (list() skips an orphan) and undeletable (edit/
      // delete throws NotFound for one). General (null-student) prayers are
      // untouched — deleteByStudent's WHERE clause never matches them.
      if (prayerRepo) await prayerRepo.deleteByStudent(id);
    },

    async listGraduated(actor) {
      assertCan(actor, 'admin:manage');
      return (await repo.findAllWithGraduated()).filter((s) => s.graduatedAt)
        .map((s) => ({ id: s.id, name: `${s.firstName} ${s.lastName}`.trim(), graduatedAt: s.graduatedAt! }))
        .sort((a, b) => b.graduatedAt.localeCompare(a.graduatedAt) || a.name.localeCompare(b.name));
    },

    async ungraduate(actor, id) {
      assertCan(actor, 'admin:manage');
      if (!(await repo.setGraduated(id, null))) throw new NotFoundError('Student not found');
    },

    async listOffRoster(actor) {
      assertCan(actor, 'admin:manage');
      const { rows, held, rosterAt } = await offRosterNow();
      if (!rows.length) return { held, rosterAt, rows: [] };
      const last = await lastAttendedOf(new Set(rows.map((s) => s.id)));
      return { held, rosterAt, rows: rows
        .map((s) => ({ id: s.id, name: `${s.firstName} ${s.lastName}`.trim(), grade: s.grade ?? null, lastAttended: last.get(s.id) ?? null }))
        .sort((a, b) => (b.lastAttended ?? '').localeCompare(a.lastAttended ?? '') || a.name.localeCompare(b.name)) };
    },

    async graduateOffRoster(actor, input) {
      assertCan(actor, 'admin:manage');
      const { ids } = GraduateOffRosterSchema.parse(input);
      const still = new Set((await offRosterNow()).rows.map((s) => s.id));
      const at = new Date().toISOString(), graduated: string[] = [], skipped: string[] = [];
      for (const id of new Set(ids)) {
        if (still.has(id) && await repo.setGraduated(id, at)) graduated.push(id); else skipped.push(id);
      }
      return { graduated, skipped };
    },
  };
}
