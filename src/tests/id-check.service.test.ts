// ID Checks service (Task 10, spec 2026-10-30 §7.4-7.7a, §7.10). Memory repos, fictional names only.
import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  InMemoryLeaderRepository, InMemoryUserRepository, InMemoryConnectionRepository, InMemoryStudentRepository,
  InMemorySettingsRepository,
} from '../repositories/in-memory/in-memory.repositories';
import { InMemoryIdCheckRepository } from '../repositories/in-memory/id-checks.repository';
import { makeIdCheckService, type IdCheckService } from '../services/id-check.service';
import { MinistryConfigSchema } from '../core/ministry-config';
import type { Actor, User } from '../core/entities/user';
import type { Leader } from '../core/entities/leader';
import type { Student } from '../core/entities/student';
import { errorResponse } from '../api/middleware/error.middleware';

const NOW = new Date('2026-10-30T02:00:00Z'); // Fri 30 Oct in Brisbane
const SECRET = 'Sample private note about Dummyton money';
const T = '2026-01-01T00:00:00.000Z';

let leaders: InMemoryLeaderRepository, users: InMemoryUserRepository, conns: InMemoryConnectionRepository;
let students: InMemoryStudentRepository, settings: InMemorySettingsRepository, repo: InMemoryIdCheckRepository;
let svc: IdCheckService;
let admin: Actor, ov1: Actor, ov2: Actor, quad: Actor;
let girl: Leader, guy: Leader, plain: Leader;

const actorOf = (u: User): Actor => ({ id: u.id, role: u.role, displayName: u.displayName, grade: null, quad: u.quad ?? null });
async function addUser(name: string, role: User['role'], status: User['status'] = 'active'): Promise<User> {
  return users.save({ id: randomUUID(), displayName: name, email: name.toLowerCase().replace(/ /g, ''), role, status,
    quad: role === 'quad' ? 'b79' : null, createdAt: T, updatedAt: T });
}
async function addLeader(fullName: string, gender: Leader['gender']): Promise<Leader> {
  return leaders.save({ id: randomUUID(), fullName, gender, grades: [], active: true, createdByGrade: null, smsTemplate: null,
    createdAt: T, updatedAt: T });
}
async function connect(leader: Leader, grade: number, graduated = false) {
  const s = { id: randomUUID(), firstName: 'Kid', lastName: 'Codeman', gender: 'male', grade, quad: null, mobile: null,
    parentPhone: null, dateOfBirth: null, svcAttended: 0, svcTotal: 0, grpAttended: 0, grpTotal: 0, grpMetWeeks: 0,
    prevSvcAttended: 0, prevSvcTotal: 0, prevGrpAttended: 0, prevGrpTotal: 0, atRiskStatus: null, dataSource: null,
    graduatedAt: null, createdAt: T, updatedAt: T } as unknown as Student;
  await students.save(s);
  if (graduated) await students.setGraduated(s.id, T);
  await conns.save({ id: randomUUID(), studentId: s.id, leaderId: leader.id, assignedByRole: 'admin', createdAt: T });
}
async function setModule(on: boolean, idChecks: Record<string, unknown> = {}) {
  await settings.updateSettings({ ministryConfig: MinistryConfigSchema.parse({ modules: { idChecks: on ? 'on' : 'off' }, idChecks }) });
}
const check = (leaderId: string, over: Record<string, unknown> = {}) => ({
  leaderId, kind: 'check', heldOn: '2026-10-20', finished: false,
  content: { answers: { faith01: { asked: true, note: SECRET }, general06: { asked: true, note: '' } }, nextTime: 'Ask about camp' },
  ...over,
});
const note = (leaderId: string, over: Record<string, unknown> = {}) =>
  ({ leaderId, kind: 'note', heldOn: '2026-10-25', finished: true, content: { text: 'Random note' }, ...over });
const tick = (who: Actor, ls: Leader[], on = true) => svc.setAccess(admin, { userId: who.id, leaderIds: ls.map((l) => l.id), on });
const code = (p: Promise<unknown>) => p.then(() => 'OK', (e) => errorResponse(e).body.code);

beforeEach(async () => {
  leaders = new InMemoryLeaderRepository(); users = new InMemoryUserRepository(); conns = new InMemoryConnectionRepository();
  students = new InMemoryStudentRepository(); settings = new InMemorySettingsRepository();
  repo = new InMemoryIdCheckRepository(async (id) => !!(await leaders.findById(id)));
  svc = makeIdCheckService({ repo, leaders, users, connections: conns, students, settings, now: () => NOW });
  admin = actorOf(await addUser('Admin Sample', 'admin'));
  ov1 = actorOf(await addUser('Ovie Codeman', 'oversight'));
  ov2 = actorOf(await addUser('Ree Dummyton', 'oversight'));
  quad = actorOf(await addUser('Quad Sample', 'quad'));
  girl = await addLeader('Gina Sample', 'female');
  guy = await addLeader('Sample Dummyton', 'male');
  plain = await addLeader('Alex Codeman', null);
  await setModule(true);
});

describe('module switch', () => {
  it('off = MODULE_DISABLED on every method', async () => {
    await setModule(false);
    const id = randomUUID();
    for (const p of [svc.list(admin), svc.leader(admin, girl.id), svc.upsert(admin, id, check(girl.id)), svc.remove(admin, id),
      svc.grid(admin), svc.setAccess(admin, { userId: ov1.id, leaderIds: [girl.id], on: true }), svc.archived(admin),
      svc.archivedDelete(admin, { name: 'x' }), svc.archivedAttach(admin, { name: 'x', leaderId: girl.id })]) {
      expect(await code(p)).toBe('MODULE_DISABLED');
    }
  });
});

describe('tick-only access', () => {
  it('oversight unticked = 404; quad = 403 on list', async () => {
    expect(await code(svc.leader(ov1, girl.id))).toBe('NOT_FOUND');
    expect((await svc.list(ov1)).leaders).toEqual([]);
    expect(await code(svc.list(quad))).toBe('FORBIDDEN');
  });
  it('admin unticked = 404 on the leader route and an empty list', async () => {
    await tick(ov1, [girl]);
    await svc.upsert(ov1, randomUUID(), check(girl.id));
    expect(await code(svc.leader(admin, girl.id))).toBe('NOT_FOUND');
    expect((await svc.list(admin)).leaders).toEqual([]);
    expect(await code(svc.upsert(admin, randomUUID(), check(girl.id)))).toBe('NOT_FOUND');
  });
  it('admin ticked = full read', async () => {
    await tick(ov1, [girl]); await tick(admin, [girl]);
    await svc.upsert(ov1, randomUUID(), check(girl.id));
    const r = await svc.leader(admin, girl.id);
    expect(r.leader).toEqual({ id: girl.id, name: 'Gina Sample' });
    expect(r.entries[0]!.content).toEqual(check(girl.id).content);
    expect(r.entries[0]!.mine).toBe(false);
  });
  it('inert tick: an account that became a quad login gets nothing, the tick stays', async () => {
    await tick(ov1, [girl]);
    const asQuad: Actor = { ...ov1, role: 'quad' };
    expect(await code(svc.leader(asQuad, girl.id))).toBe('NOT_FOUND');
    expect((await repo.ticksForLeader(girl.id)).map((t) => t.userId)).toEqual([ov1.id]);
  });
  it('list rows, questions, rhythm and today', async () => {
    await setModule(true, { cycleStart: '2026-07-01', intervalMonths: 6 });
    await tick(ov1, [girl, guy]);
    await connect(girl, 9); await connect(girl, 8);
    const r = await svc.list(ov1);
    expect(r.today).toBe('2026-10-30');
    expect(r.rhythm).toEqual({ cycleStart: '2026-07-01', intervalMonths: 6 });
    expect(r.questions.length).toBe(6);
    expect(r.leaders.map((l) => l.name)).toEqual(['Gina Sample', 'Sample Dummyton']);
    expect(r.leaders[0]).toEqual({ id: girl.id, name: 'Gina Sample', gender: 'female', grades: [8, 9], lastCheckOn: null,
      dueOn: '2026-09-01', status: 'overdue', inProgress: null });
  });
});

describe('edit, read, delete rights', () => {
  it('author-only edit; another ticked account reads but gets 403 on edit', async () => {
    await tick(ov1, [girl]); await tick(ov2, [girl]);
    const id = randomUUID();
    await svc.upsert(ov1, id, check(girl.id));
    expect(await code(svc.upsert(ov2, id, check(girl.id, { finished: true })))).toBe('FORBIDDEN');
    expect((await svc.leader(ov2, girl.id)).entries).toHaveLength(1);
  });
  it('an existing entry keeps its leader and kind', async () => {
    await tick(ov1, [girl, guy]);
    const id = randomUUID();
    await svc.upsert(ov1, id, check(girl.id));
    expect(await code(svc.upsert(ov1, id, check(guy.id)))).toBe('NOT_FOUND');
    expect(await code(svc.upsert(ov1, id, note(girl.id)))).toBe('BAD_REQUEST');
  });
  it('delete by author and by another ticked account; unticked = 404', async () => {
    await tick(ov1, [girl]); await tick(ov2, [girl]);
    const a = randomUUID(), b = randomUUID();
    await svc.upsert(ov1, a, check(girl.id));
    await svc.upsert(ov1, b, note(girl.id));
    expect(await code(svc.remove(admin, a))).toBe('NOT_FOUND');
    await svc.remove(ov1, a);
    await svc.remove(ov2, b);
    expect((await svc.leader(ov1, girl.id)).entries).toEqual([]);
    expect(await code(svc.remove(ov1, randomUUID()))).toBe('NOT_FOUND');
  });
});

describe('finish, due date, in progress', () => {
  it('finished never goes back (late autosave after Finish)', async () => {
    await tick(ov1, [girl]);
    const id = randomUUID();
    expect(await svc.upsert(ov1, id, check(girl.id, { finished: true }))).toMatchObject({ finished: true });
    expect(await svc.upsert(ov1, id, check(girl.id, { finished: false }))).toMatchObject({ finished: true });
    const row = (await svc.list(ov1)).leaders[0]!;
    expect(row.lastCheckOn).toBe('2026-10-20');
    expect(row.inProgress).toBeNull();
  });
  it('an unfinished check leaves lastCheckOn null and shows inProgress (mine / not mine)', async () => {
    await tick(ov1, [girl]); await tick(ov2, [girl]);
    const id = randomUUID();
    await svc.upsert(ov1, id, check(girl.id));
    expect((await svc.list(ov1)).leaders[0]).toMatchObject({ lastCheckOn: null, status: 'never',
      inProgress: { entryId: id, authorName: 'Ovie Codeman', mine: true } });
    expect((await svc.list(ov2)).leaders[0]!.inProgress).toEqual({ entryId: id, authorName: 'Ovie Codeman', mine: false });
  });
  it('a note never moves dueOn and is stored unfinished', async () => {
    await tick(ov1, [girl]);
    const before = (await svc.list(ov1)).leaders[0]!.dueOn;
    const id = randomUUID();
    expect(await svc.upsert(ov1, id, note(girl.id))).toMatchObject({ finished: false });
    expect((await svc.list(ov1)).leaders[0]!.dueOn).toBe(before);
  });
  it('upsert is idempotent (same body twice = one entry)', async () => {
    await tick(ov1, [girl]);
    const id = randomUUID();
    await svc.upsert(ov1, id, check(girl.id));
    await svc.upsert(ov1, id, check(girl.id));
    expect((await svc.leader(ov1, girl.id)).entries).toHaveLength(1);
  });
});

describe('validation never echoes a value', () => {
  it('unknown question key = 400 and the details hold no note text', async () => {
    await tick(ov1, [girl]);
    const body = check(girl.id, { content: { answers: { faith99: { asked: true, note: SECRET } }, nextTime: '' } });
    const err = await svc.upsert(ov1, randomUUID(), body).catch((e) => e);
    const r = errorResponse(err);
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).not.toContain(SECRET);
  });
  it('a bad kind or too-long note = 400 without the value', async () => {
    await tick(ov1, [girl]);
    for (const body of [check(girl.id, { kind: SECRET }),
      check(girl.id, { content: { answers: { faith01: { asked: true, note: SECRET.repeat(200) } }, nextTime: '' } }),
      note(girl.id, { content: { text: SECRET.repeat(400) } })]) {
      const r = errorResponse(await svc.upsert(ov1, randomUUID(), body).catch((e) => e));
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.body)).not.toContain('Sample private');
    }
  });
});

describe('deactivated and deleted leaders', () => {
  it('a deactivated leader is 404 and hidden; reactivating restores it intact', async () => {
    await tick(ov1, [girl]);
    await svc.upsert(ov1, randomUUID(), check(girl.id));
    await leaders.save({ ...girl, active: false });
    expect(await code(svc.leader(ov1, girl.id))).toBe('NOT_FOUND');
    expect((await svc.list(ov1)).leaders).toEqual([]);
    expect((await svc.grid(admin)).rows.map((r) => r.id)).not.toContain(girl.id);
    expect(await code(svc.archivedAttach(admin, { name: 'x', leaderId: girl.id }))).toBe('NOT_FOUND');
    await leaders.save({ ...girl, active: true });
    expect((await svc.leader(ov1, girl.id)).entries).toHaveLength(1);
  });
  for (const how of ['delete', 'deleteAll'] as const) {
    it(`leaders.${how} archives entries with the name, drops ticks, archive has no text; delete + attach are admin only`, async () => {
      await tick(ov1, [guy]);
      await svc.upsert(ov1, randomUUID(), check(guy.id, { heldOn: '2026-10-01', finished: true }));
      await svc.upsert(ov1, randomUUID(), note(guy.id, { heldOn: '2026-10-20', content: { text: SECRET } }));
      if (how === 'delete') await leaders.delete(guy.id); else await leaders.deleteAll();
      expect(await repo.ticks()).toEqual([]);
      const list = await svc.archived(admin);
      expect(list).toEqual([{ name: 'Sample Dummyton', count: 2, lastOn: '2026-10-20' }]);
      expect(JSON.stringify(list)).not.toMatch(/"(content|text)"/);
      expect(JSON.stringify(list)).not.toContain(SECRET);
      expect(await code(svc.archived(ov1))).toBe('FORBIDDEN');
      expect(await code(svc.archivedDelete(ov1, { name: 'Sample Dummyton' }))).toBe('FORBIDDEN');
      expect(await code(svc.archivedAttach(ov1, { name: 'Sample Dummyton', leaderId: randomUUID() }))).toBe('FORBIDDEN');
      const back = await addLeader('Sample Dummyton', 'male');
      expect(await svc.archivedAttach(admin, { name: 'Sample Dummyton', leaderId: back.id })).toEqual({ moved: 2 });
      await tick(ov1, [back]);
      expect((await svc.leader(ov1, back.id)).entries).toHaveLength(2);
      await leaders.delete(back.id);
      expect(await svc.archivedDelete(admin, { name: 'Sample Dummyton' })).toEqual({ deleted: 2 });
      expect(await svc.archived(admin)).toEqual([]);
    });
  }
});

describe('grid', () => {
  it('rows: Girls, Guys, unset; then lowest grade (none last); then name. Columns: active oversight + admin', async () => {
    const guy2 = await addLeader('Bert Codeman', 'male');
    const guy3 = await addLeader('Aaron Sample', 'male');
    await connect(guy, 11); await connect(guy2, 8); await connect(guy2, 12); await connect(guy3, 7, true); // graduated ignored
    await addUser('Gone Oversight', 'oversight', 'inactive');
    await tick(ov1, [girl, guy]);
    const g = await svc.grid(admin);
    expect(g.rows.map((r) => r.name)).toEqual(['Gina Sample', 'Bert Codeman', 'Sample Dummyton', 'Aaron Sample', 'Alex Codeman']);
    expect(g.rows[1]).toEqual({ id: guy2.id, name: 'Bert Codeman', gender: 'male', grades: [8, 12] });
    expect(g.columns.map((c) => c.name).sort()).toEqual(['Admin Sample', 'Ovie Codeman', 'Ree Dummyton']);
    expect(g.ticks).toHaveLength(2);
    expect(await code(svc.grid(ov1))).toBe('FORBIDDEN');
  });
  it('setAccess refuses a quad target, an inactive leader and an unknown leader (400); admin only', async () => {
    expect(await code(tick(quad, [girl]))).toBe('BAD_REQUEST');
    await leaders.save({ ...plain, active: false });
    expect(await code(tick(ov1, [plain]))).toBe('BAD_REQUEST');
    expect(await code(svc.setAccess(admin, { userId: ov1.id, leaderIds: [randomUUID()], on: true }))).toBe('BAD_REQUEST');
    expect(await code(svc.setAccess(admin, { userId: ov1.id, leaderIds: [], on: true }))).toBe('VALIDATION_ERROR');
    expect(await code(svc.setAccess(ov1, { userId: ov1.id, leaderIds: [girl.id], on: true }))).toBe('FORBIDDEN');
    await tick(ov1, [girl]);
    await tick(ov1, [girl], false);
    expect(await repo.ticks()).toEqual([]);
  });
});
