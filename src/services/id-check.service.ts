// ID Checks (spec 2026-10-30 §7.4-7.7a). Tick-only: a leader that is not ticked for the caller, missing or inactive
// answers 404 the same way, so the API never confirms who has records. Notes never go to any log (a privacy test pins
// this file), and validation issues are rewritten so they never carry a submitted value.
import { z } from 'zod';
import { assertCan, can, canSeeIdChecks, isIdCheckTickTarget } from './access-control';
import { dueOn, statusOf, sortRows, type IdCheckStatus } from './id-check-rhythm';
import { ID_CHECK_KEYS, ID_CHECK_SECTIONS, type IdCheckSection } from '../core/id-check-questions';
import type {
  IIdCheckRepository, ILeaderRepository, IUserRepository, IConnectionRepository, IStudentRepository, ISettingsRepository,
} from '../repositories/interfaces/entity-repositories';
import type { IdCheckEntry, IdCheckTick } from '../core/entities/id-check';
import type { Leader } from '../core/entities/leader';
import type { Actor } from '../core/entities/user';
import { BadRequestError, ForbiddenError, ModuleDisabledError, NotFoundError } from '../core/errors/app-error';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => { const t = Date.parse(`${v}T00:00:00Z`); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v; });
const Answer = z.object({ asked: z.boolean(), note: z.string().max(4000) }).strict();
const Base = { leaderId: z.string().uuid(), heldOn: day, finished: z.boolean() };
const UpsertSchema = z.discriminatedUnion('kind', [
  z.object({ ...Base, kind: z.literal('check'), content: z.object({
    answers: z.record(z.string().refine((k) => ID_CHECK_KEYS.has(k), 'Unknown question'), Answer),
    nextTime: z.string().max(8000),
  }).strict() }),
  z.object({ ...Base, kind: z.literal('note'), content: z.object({ text: z.string().max(8000) }).strict() }),
]);
const AccessSchema = z.object({ userId: z.string().uuid(), leaderIds: z.array(z.string().uuid()).min(1).max(500), on: z.boolean() });
const NameSchema = z.object({ name: z.string().max(200) });
const AttachSchema = z.object({ name: z.string().max(200), leaderId: z.string().uuid() });
const IdSchema = z.string().uuid();

/** safeParse, then a ZodError with only code-free fixed messages and the path: never `received`, never a value. */
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  throw new z.ZodError(r.error.issues.map((i) => ({
    code: z.ZodIssueCode.custom, path: i.path, message: i.code === 'too_big' ? 'Too long' : 'Invalid',
  })));
}

export type IdCheckListRow = {
  id: string; name: string; gender: string | null; grades: number[]; lastCheckOn: string | null; dueOn: string;
  status: IdCheckStatus; inProgress: { entryId: string; authorName: string; mine: boolean } | null;
};
export type IdCheckGridRow = { id: string; name: string; gender: string | null; grades: number[] };

export interface IdCheckService {
  list(a: Actor): Promise<{ leaders: IdCheckListRow[]; questions: readonly IdCheckSection[];
    rhythm: { cycleStart: string; intervalMonths: number }; today: string }>;
  leader(a: Actor, leaderId: string): Promise<{ leader: { id: string; name: string }; entries: (IdCheckEntry & { mine: boolean })[] }>;
  upsert(a: Actor, id: string, body: unknown): Promise<{ updatedAt: string; finished: boolean }>;
  remove(a: Actor, id: string): Promise<void>;
  grid(a: Actor): Promise<{ rows: IdCheckGridRow[]; columns: { id: string; name: string; role: string }[]; ticks: IdCheckTick[] }>;
  setAccess(a: Actor, body: unknown): Promise<void>;
  archived(a: Actor): Promise<{ name: string; count: number; lastOn: string }[]>;
  archivedDelete(a: Actor, body: unknown): Promise<{ deleted: number }>;
  archivedAttach(a: Actor, body: unknown): Promise<{ moved: number }>;
}

export function makeIdCheckService(deps: {
  repo: IIdCheckRepository; leaders: ILeaderRepository; users: IUserRepository; connections: IConnectionRepository;
  students: IStudentRepository; settings: ISettingsRepository; now?: () => Date;
}): IdCheckService {
  const { repo, leaders } = deps;
  const now = deps.now ?? (() => new Date());
  const notFound = () => new NotFoundError('Leader not found');

  // Off by default: every route answers 404 (ModuleDisabledError) and stored entries are kept.
  async function assertOn() {
    const cfg = (await deps.settings.getSettings()).ministryConfig;
    if (cfg.modules.idChecks !== 'on') throw new ModuleDisabledError('ID Checks');
    return cfg;
  }
  /** Active leader or null: a deactivated leader is treated as not found everywhere (known limit, spec §7.1). */
  async function activeLeader(id: string): Promise<Leader | null> {
    const l = IdSchema.safeParse(id).success ? await leaders.findById(id) : null;
    return l && l.active ? l : null;
  }
  async function tickedFor(a: Actor, leaderId: string): Promise<boolean> {
    return canSeeIdChecks(a, new Set((await repo.ticksForLeader(leaderId)).map((t) => t.userId)));
  }
  /** The leader the caller is ticked for, else 404 (same as missing). */
  async function seenLeader(a: Actor, leaderId: string): Promise<Leader> {
    const l = await activeLeader(leaderId);
    if (!l || !(await tickedFor(a, l.id))) throw notFound();
    return l;
  }
  /** leaderId -> sorted grades of connected, not graduated students (findAll leaves graduated out). */
  async function gradesByLeader(): Promise<Map<string, number[]>> {
    const [conns, studs] = await Promise.all([deps.connections.findAll(), deps.students.findAll()]);
    const grade = new Map(studs.map((s) => [s.id, s.grade]));
    const m = new Map<string, Set<number>>();
    for (const c of conns) {
      const g = grade.get(c.studentId);
      if (g == null) continue;
      if (!m.has(c.leaderId)) m.set(c.leaderId, new Set());
      m.get(c.leaderId)!.add(g);
    }
    return new Map([...m].map(([k, v]) => [k, [...v].sort((x, y) => x - y)]));
  }

  return {
    async list(a) {
      const cfg = await assertOn();
      assertCan(a, 'idcheck:use');
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: cfg.structure.timeZone }).format(now());
      const { cycleStart, intervalMonths } = cfg.idChecks;
      const ticked = new Set((await repo.ticks()).filter((t) => t.userId === a.id).map((t) => t.leaderId));
      const mine = (await leaders.findActive()).filter((l) => ticked.has(l.id)); // own ticks only: no admin short-cut
      const ids = mine.map((l) => l.id);
      const [last, open, grades] = await Promise.all([repo.lastFinished(ids), repo.inProgress(ids), gradesByLeader()]);
      const rows = mine.map((l): IdCheckListRow => {
        const lastOn = last.get(l.id) ?? null;
        const due = dueOn(today, cycleStart, intervalMonths, lastOn);
        const p = open.get(l.id);
        return { id: l.id, name: l.fullName, gender: l.gender, grades: grades.get(l.id) ?? [], lastCheckOn: lastOn, dueOn: due,
          status: statusOf(today, due, lastOn),
          inProgress: p ? { entryId: p.id, authorName: p.authorName, mine: p.authorId === a.id } : null };
      });
      return { leaders: sortRows(rows), questions: ID_CHECK_SECTIONS, rhythm: { cycleStart, intervalMonths }, today };
    },

    async leader(a, leaderId) {
      await assertOn();
      const l = await seenLeader(a, leaderId);
      const entries = (await repo.listByLeader(l.id)).map((e) => ({ ...e, mine: e.authorId === a.id }));
      return { leader: { id: l.id, name: l.fullName }, entries };
    },

    async upsert(a, id, body) {
      await assertOn();
      parse(IdSchema, id);
      const d = parse(UpsertSchema, body);
      const l = await seenLeader(a, d.leaderId);
      const old = await repo.findEntry(id);
      if (old && old.leaderId !== l.id) throw new NotFoundError('Entry not found');
      if (old && old.authorId !== a.id) throw new ForbiddenError('Only the person who wrote this can change it.');
      if (old && old.kind !== d.kind) throw new BadRequestError('This entry is a different kind.');
      const at = now().toISOString();
      const saved = await repo.upsert({
        id, leaderId: l.id, leaderName: l.fullName, kind: d.kind, heldOn: d.heldOn, finished: d.kind === 'check' && d.finished,
        authorId: a.id, authorName: a.displayName, content: d.content, createdAt: at, updatedAt: at,
      });
      return { updatedAt: saved.updatedAt, finished: saved.finished };
    },

    async remove(a, id) {
      await assertOn();
      const e = IdSchema.safeParse(id).success ? await repo.findEntry(id) : null;
      const l = e?.leaderId ? await activeLeader(e.leaderId) : null;
      if (!e || !l) throw new NotFoundError('Entry not found');
      const author = can(a, 'idcheck:use') && e.authorId === a.id;
      if (!author && !(await tickedFor(a, l.id))) throw new NotFoundError('Entry not found');
      await repo.deleteEntry(id);
    },

    async grid(a) {
      await assertOn();
      assertCan(a, 'idcheck:assign');
      const [active, users, grades, ticks] = await Promise.all([leaders.findActive(), deps.users.findAll(), gradesByLeader(), repo.ticks()]);
      const gOrder = (g: string | null) => (g === 'female' ? 0 : g === 'male' ? 1 : 2);
      const low = (id: string) => grades.get(id)?.[0] ?? Infinity;
      const rows = active
        .map((l) => ({ id: l.id, name: l.fullName, gender: l.gender, grades: grades.get(l.id) ?? [] }))
        .sort((x, y) => gOrder(x.gender) - gOrder(y.gender) || low(x.id) - low(y.id) || x.name.localeCompare(y.name));
      const columns = users.filter(isIdCheckTickTarget)
        .map((u) => ({ id: u.id, name: u.displayName, role: u.role }))
        .sort((x, y) => x.name.localeCompare(y.name));
      const rowIds = new Set(rows.map((r) => r.id)), colIds = new Set(columns.map((c) => c.id));
      return { rows, columns, ticks: ticks.filter((t) => rowIds.has(t.leaderId) && colIds.has(t.userId)) };
    },

    async setAccess(a, body) {
      await assertOn();
      assertCan(a, 'idcheck:assign');
      const d = parse(AccessSchema, body);
      const u = await deps.users.findById(d.userId);
      if (!u || !isIdCheckTickTarget(u)) throw new BadRequestError('Pick an active oversight or admin account.');
      const active = new Set((await leaders.findActive()).map((l) => l.id));
      if (d.leaderIds.some((id) => !active.has(id))) throw new BadRequestError('Pick active leaders only.');
      await repo.setTicks(d.userId, [...new Set(d.leaderIds)], d.on);
    },

    async archived(a) {
      await assertOn();
      assertCan(a, 'idcheck:assign');
      return (await repo.archivedGroups()).map((g) => ({ name: g.name, count: g.count, lastOn: g.lastOn }));
    },

    async archivedDelete(a, body) {
      await assertOn();
      assertCan(a, 'idcheck:assign');
      return { deleted: await repo.deleteArchived(parse(NameSchema, body).name) };
    },

    async archivedAttach(a, body) {
      await assertOn();
      assertCan(a, 'idcheck:assign');
      const d = parse(AttachSchema, body);
      const l = await activeLeader(d.leaderId);
      if (!l) throw notFound();
      return { moved: await repo.attachArchived(d.name, l.id, l.fullName) };
    },
  };
}
