// Friday night check, Task 27: the roster and people sections of POST /sync/night-summary. Fictional names only: Sample, Dummyton, Codeman.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { makeNightSummaryService, type NightSummaryDeps } from '../services/night-summary.service';
import { classifyHold } from '../services/night-summary-holds';
import { HOLD_CODES, LINK_CONTRACT_VERSION, NightPeople, NightRoster } from '../core/link-contract';
import { InMemoryLinkRepository } from '../repositories/in-memory/link.repository';
import { InMemoryLinkIntakeRepository } from '../repositories/in-memory/link-intake.repository';
import { InMemoryUnsentRepository } from '../repositories/in-memory/unsent.repository';
import { InMemoryNightSummaryRepository } from '../repositories/in-memory/night-summary.repository';
import { InMemoryErrorLogRepository } from '../repositories/in-memory/error-log.repository';
import { InMemoryReconcileRunRepository } from '../repositories/in-memory/reconcile-run.repository';
import { InMemoryImportRepository, InMemorySettingsRepository } from '../repositories/in-memory';
import type { IntakeMode, IntakeRowWrite, PlanStatus } from '../repositories/interfaces/link-intake.repository';
import type { UnsentReason } from '../repositories/interfaces/unsent.repository';

const NOW = new Date('2026-11-13T12:30:00.000Z');
const FROM = '2026-11-13T07:00:00.000Z', TO = '2026-11-13T20:00:00.000Z';
const ME = '8f5a1c2e-0000-4000-8000-000000000001';
const NAMES = /Sample|Dummyton|Codeman/;
const req = (section: string, o: Record<string, unknown> = {}) =>
  ({ contractVersion: LINK_CONTRACT_VERSION, consoleId: ME, section, from: FROM, to: TO, ...o });

async function harness() {
  const link = new InMemoryLinkRepository();
  const intake = new InMemoryLinkIntakeRepository();
  const unsent = new InMemoryUnsentRepository();
  const night = new InMemoryNightSummaryRepository(link, intake, unsent);
  const settings = new InMemorySettingsRepository(); await settings.init();
  const deps: NightSummaryDeps = { night, link, intake, errorRows: new InMemoryErrorLogRepository(), runs: new InMemoryReconcileRunRepository(),
    imports: new InMemoryImportRepository(), settings, now: () => NOW };
  return { link, intake, unsent, night, settings, deps, svc: makeNightSummaryService(deps) };
}
type H = Awaited<ReturnType<typeof harness>>;
const row = (status: PlanStatus, reason: string, o: Partial<IntakeRowWrite> = {}): IntakeRowWrite => ({ key: randomUUID(), status, title: 'Sample Dummyton', reason,
  fromApp: false, hasText: false, outcome: '', personId: null, family: null, detail: { firstName: 'Sample', lastName: 'Dummyton' }, ...o });
let tick = 0;
const push = (h: H, mode: IntakeMode, date: string, rows: IntakeRowWrite[]) =>
  h.intake.replace(mode, { date, takenAt: new Date(Date.UTC(2026, 10, 12, 0, 0, ++tick)).toISOString(), consoleId: ME, cut: false, inputs: null }, rows);
const people = async (h: H) => (await h.svc.get(req('people'))).data as any;
const WAIT_FIRST = "Sample's consent form must be approved first. Approve it in Elvanto, then Save this one again.";
const WAIT_FIRST_2 = 'The first child on this form must be approved first. Approve them in Elvanto, then Save this one again.';

describe('classifyHold (Appendix H)', () => {
  it('waitFirst wording never leaks: both wordings give first-child-pending and sum, and no name reaches the section', async () => {
    const h = await harness();
    await push(h, 'consent', '2026-11-13', [row('needs-you', WAIT_FIRST), row('needs-you', WAIT_FIRST_2), row('needs-you', WAIT_FIRST_2)]);
    expect(classifyHold(WAIT_FIRST)).toBe('first-child-pending');
    expect(classifyHold(WAIT_FIRST_2)).toBe('first-child-pending');
    const p = await people(h);
    expect(p.rows).toEqual([{ mode: 'consent', date: '2026-11-13', status: 'needs-you', code: 'first-child-pending', n: 3 }]);
    expect(JSON.stringify(p)).not.toMatch(NAMES);
  });

  it('unknown wording is other and its text is absent; a category name never reaches the output', async () => {
    const h = await harness();
    await push(h, 'intake', '2026-11-13', [row('needs-you', 'Codeman needs a look'), row('needs-you', 'Profile is in Dummyton Category: consent fields hidden until moved to New People')]);
    expect(classifyHold('Codeman needs a look')).toBe('other');
    expect(classifyHold('')).toBe('other');
    const p = await people(h);
    expect(p.rows.map((r: any) => r.code).sort()).toEqual(['other', 'profile-in']);
    expect(JSON.stringify(p)).not.toMatch(NAMES);
  });

  it('every string in hold-wording.json classifies to its code and none to other', () => {
    const list = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'night-summary', 'hold-wording.json'), 'utf8')) as { text: string; code: string }[];
    expect(list.length).toBeGreaterThan(40);
    for (const { text, code } of list) { expect(classifyHold(text), text).toBe(code); expect(code).not.toBe('other'); }
    expect(new Set(list.map((x) => x.code))).toEqual(new Set(HOLD_CODES));   // every code is exercised
  });

  it('a text cut to 200 characters still classifies by its start', () => {
    expect(classifyHold(('Profile is in Dummyton Category: ' + 'x'.repeat(300)).slice(0, 200))).toBe('profile-in');
  });
});

describe('night-summary people and roster sections', () => {
  it('reason in the response schema is a closed z.enum; an added field fails', () => {
    const ok = { siteToday: '2026-11-13', rows: [], dates: [], notFoundHeldInIntake: 0, unsent: [{ reason: 'failed', n: 1, nearPurge: 0, oldestS: 5 }] };
    expect(NightPeople.safeParse(ok).success).toBe(true);
    expect(NightPeople.safeParse({ ...ok, unsent: [{ reason: 'Sample text', n: 1, nearPurge: 0, oldestS: 5 }] }).success).toBe(false);
    expect(NightPeople.safeParse({ ...ok, rows: [{ mode: 'intake', date: '2026-11-13', status: 'needs-you', code: 'Sample text', n: 1 }] }).success).toBe(false);
    expect(NightPeople.safeParse({ ...ok, rows: [{ mode: 'intake', date: '2026-11-13', status: 'needs-you', code: 'other', n: 1, reason: 'x' }] }).success).toBe(false);
    expect(NightPeople.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(NightRoster.safeParse({ groups: [{ kind: 'student', match: 'auto', active: true, hasGrade: true, n: 1, gender: 'male' }] }).success).toBe(false);
  });

  it('PII: title, first_name, last_name, person_id, family, created_by, detail, rows, payload absent from both sections', async () => {
    const h = await harness();
    await push(h, 'intake', '2026-11-13', [row('needs-you', 'Waiting for parent form', { personId: randomUUID(), family: randomUUID() })]);
    await h.link.replaceMirror('roster', [{ personId: randomUUID(), firstName: 'Sample', lastName: 'Dummyton', gender: 'male', grade: 9, kind: 'student', consent: 'ok' }] as any,
      { takenAt: NOW.toISOString(), consoleId: ME });
    await h.unsent.save({ id: 'u1', reason: 'failed', payload: 'Sample Dummyton secret', createdAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z' });
    for (const s of ['roster', 'people']) {
      const out = JSON.stringify((await h.svc.get(req(s))).data);
      expect(out, s).not.toMatch(NAMES);
      expect(out, s).not.toMatch(/"(title|first_name|last_name|firstName|lastName|person_id|personId|family|created_by|detail|payload|gender|consent|student_id|studentId)"/);
      expect(out, s).not.toMatch(/Waiting for parent form/);
    }
    expect(Object.keys(await people(h)).sort()).toEqual(['dates', 'notFoundHeldInIntake', 'rows', 'siteToday', 'unsent']);
  });

  it('roster: predicate fields only; gender, consent, student_id absent', async () => {
    const h = await harness();
    const r = (kind: string, grade: number | null) => ({ personId: randomUUID(), firstName: 'Sample', lastName: 'Dummyton', gender: 'female', grade, kind, consent: 'contact' });
    await h.link.replaceMirror('roster', [r('student', 9), r('student', 10), r('student', null), r('leader', null)] as any, { takenAt: NOW.toISOString(), consoleId: ME });
    const d = (await h.svc.get(req('roster'))).data as any;
    expect(d.groups).toHaveLength(3);
    expect(d.groups).toEqual(expect.arrayContaining([
      { kind: 'student', match: 'none', active: true, hasGrade: true, n: 2 },
      { kind: 'student', match: 'none', active: true, hasGrade: false, n: 1 },
      { kind: 'leader', match: 'none', active: true, hasGrade: false, n: 1 }]));
    for (const g of d.groups) expect(Object.keys(g).sort()).toEqual(['active', 'hasGrade', 'kind', 'match', 'n']);
    expect(JSON.stringify(d)).not.toMatch(/gender|consent|student_id|studentId|female|contact/);
  });

  it('unsent: nearPurge is created_at older than 6 days; oldestS; reason is the DB enum', async () => {
    const h = await harness();
    const DAY = 86_400_000;
    const at = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
    const save = (id: string, reason: UnsentReason, createdAt: string) => h.unsent.save({ id, reason, payload: 'Sample secret', createdAt, updatedAt: createdAt });
    await save('a', 'failed', at(7)); await save('b', 'failed', at(5.9)); await save('c', 'unreachable', at(13)); await save('d', 'failed', at(6.01));
    const d = await people(h);
    const by = Object.fromEntries(d.unsent.map((u: any) => [u.reason, u]));
    expect(by.failed).toEqual({ reason: 'failed', n: 3, nearPurge: 2, oldestS: 7 * 86_400 });
    expect(by.unreachable).toEqual({ reason: 'unreachable', n: 1, nearPurge: 1, oldestS: 13 * 86_400 });
    expect(d.unsent).toHaveLength(2);
    expect(JSON.stringify(d)).not.toMatch(/secret|Sample/);
  });

  it('notFoundHeldInIntake: twin agrees with the SQL rule (exact reason, same person_id, intake row needs-you)', async () => {
    const h = await harness();
    const a = randomUUID(), b = randomUUID(), c = randomUUID(), e = randomUUID();
    await push(h, 'consent', '2026-11-13', [
      row('needs-you', 'Not found in consent step', { key: a, personId: a }),     // counted: intake row needs-you for a
      row('needs-you', 'Not found in consent step', { key: b, personId: b }),     // intake row b is ready: not counted
      row('needs-you', 'Not found in consent step 2', { key: c, personId: c }),   // other wording: not counted
      row('needs-you', 'Not found in consent step', { key: e, personId: e })]);   // no intake row: not counted
    await push(h, 'intake', '2026-11-13', [row('needs-you', 'Waiting for parent form', { personId: a }), row('ready', '', { personId: b }),
      row('needs-you', 'Waiting for parent form', { personId: c })]);
    expect((await people(h)).notFoundHeldInIntake).toBe(1);
    expect(await h.night.notFoundHeldInIntake()).toBe(1);
  });

  it('siteToday in site time', async () => {
    const h = await harness();
    const at = (timeZone: string, now: Date) => makeNightSummaryService({ ...h.deps, now: () => now,
      settings: { getSettings: async () => ({ ministryConfig: { structure: { timeZone } } }) as any } }).get(req('people'));
    const late = new Date('2026-11-13T15:00:00.000Z');   // 01:00 on the 14th in Brisbane
    expect(((await at('Australia/Brisbane', late)).data as any).siteToday).toBe('2026-11-14');
    expect(((await at('UTC', late)).data as any).siteToday).toBe('2026-11-13');
  });

  it('dates: a row with taken_at null is reported, with no console_id', async () => {
    const h = await harness();
    await h.intake.askRefresh('consent', '2026-11-13');   // asked, nothing pushed yet
    await push(h, 'intake', '2026-11-12', [row('ready', '')]);
    const d = (await people(h)).dates as any[];
    expect(d).toContainEqual({ mode: 'consent', date: '2026-11-13', takenAt: null, rowCount: 0, cut: false, refreshAsked: true });
    const pushed = d.find((x) => x.mode === 'intake');
    expect(pushed).toMatchObject({ date: '2026-11-12', rowCount: 1, cut: false, refreshAsked: false });
    expect(typeof pushed.takenAt).toBe('string');
    for (const x of d) expect(Object.keys(x).sort()).toEqual(['cut', 'date', 'mode', 'refreshAsked', 'rowCount', 'takenAt']);
    expect(JSON.stringify(d)).not.toMatch(/consoleId|console_id|inputs/);
  });

  it('rows group by mode, date, status and code; ready and done rows are counted too', async () => {
    const h = await harness();
    await push(h, 'intake', '2026-11-13', [row('needs-you', 'Waiting for parent form'), row('needs-you', 'Waiting for parent form'), row('ready', ''), row('done', '')]);
    const p = await people(h);
    expect(p.rows).toEqual(expect.arrayContaining([
      { mode: 'intake', date: '2026-11-13', status: 'needs-you', code: 'waiting-parent-form', n: 2 },
      { mode: 'intake', date: '2026-11-13', status: 'ready', code: 'other', n: 1 },
      { mode: 'intake', date: '2026-11-13', status: 'done', code: 'other', n: 1 }]));
    expect(p.rows).toHaveLength(3);
  });
});

describe('night-summary people (supabase source)', () => {
  const src = readFileSync(join(__dirname, '..', 'repositories', 'supabase', 'supabase.night-summary.ts'), 'utf8');
  it('no select *; none of title, detail, first_name, last_name, person_id in a select list (person_id only inside the one exists)', () => {
    expect(src).not.toMatch(/select\s+\*/i);
    for (const c of ['title', 'detail', 'first_name', 'last_name', 'family', 'created_by', 'payload', 'gender', 'student_id']) {
      expect(src, c).not.toMatch(new RegExp(String.raw`\b${c}\b`));
    }
    const lists = [...src.matchAll(/select\s([\s\S]*?)\sfrom\s/gi)].map((m) => m[1]!);
    expect(lists.length).toBeGreaterThanOrEqual(7);
    for (const l of lists) expect(l, l).not.toMatch(/\bperson_id\b/);
    expect(src.match(/\bperson_id\b/g)!.length).toBe(2);   // both inside the one exists: c.person_id and i.person_id
    expect(src).toMatch(/select mode, date, status, reason, count\(\*\)::int n\s+from link_intake_rows\s+group by 1, ?2, ?3, ?4/);
    expect(src).toMatch(/select reason, created_at\s+from newperson_unsent/);
    expect(src).toMatch(/select kind, match, active, grade is not null as has_grade, count\(\*\)::int n\s+from link_roster\s+group by 1, ?2, ?3, ?4/);
  });
});
