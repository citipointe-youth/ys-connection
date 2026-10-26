// Modular-setup lane 2.3 (YS half): New person form (newYouthForms) + Intakes (intakeAdmin, off whenever newYouthForms is off).
//   OFF-nav     every role loses exactly the owned nav ids       OFF-api    the send and intake entry points refuse
//   OFF-routes  the page dispatcher sends the pages Home         OFF-text   Home attention / Youth Setup follow the module
//   BACK-ON     data rows and config keys survive an off/on      ON         live states: the golden file covers it (baseline-modules)
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadFns, loadIndexHtml, extractFn } from './helpers/extract-fn';
import { navWithModules, expectSubtraction } from './helpers/module-off';
import { MinistryConfigSchema } from '../core/ministry-config';
import { ModuleDisabledError } from '../core/errors/app-error';
import { makeNewYouthService } from '../services/new-youth.service';
import { makeLinkService } from '../services/link.service';
import { makeIntakeService } from '../services/link-intake.service';
import { InMemoryLinkRepository } from '../repositories/in-memory/link.repository';
import { InMemoryLinkIntakeRepository } from '../repositories/in-memory/link-intake.repository';
import {
  InMemorySettingsRepository, InMemoryStudentRepository, InMemoryLeaderRepository, InMemoryUserRepository,
  InMemoryServiceSessionRepository, InMemoryServiceAttendanceRepository,
} from '../repositories/in-memory';
import { brisbaneElvanto } from './helpers/brisbane-elvanto';
import LIVE_MODULES from './fixtures/live-modules.json';
import OWNERS from './fixtures/module-owners.json';
import type { Actor } from '../core/entities/user';

const ROLES = ['admin', 'director', 'grade', 'quad', 'leader'];
const actor = (role: string): Actor => ({ id: `a-${role}`, role: role as Actor['role'], displayName: role, grade: null, quad: null, gender: null, leaderId: null }) as Actor;
const ADMIN = actor('admin');
// Connection Audit needs New person (module tree), so its nav entry goes with it.
const CA_DEPENDENT = 'ca-week';

describe('OFF-nav', () => {
  it('New person off: every role loses New person (the admin also Intakes), nothing else but the Connection Audit entry that needs it', () => {
    expect(OWNERS.newYouthForms).toEqual(['new-youth']);
    for (const role of ROLES) {
      const b = navWithModules(role), o = navWithModules(role, { newYouthForms: 'off' });
      const caGone = b.nav.includes(CA_DEPENDENT);                        // admin and director only
      expectSubtraction(b, o, ['new-youth', ...(role === 'admin' ? ['link-intake'] : []), ...(caGone ? [CA_DEPENDENT] : [])]);
    }
  });
  it('Intakes off: the admin login loses link-intake only; the other roles never had it', () => {
    expect(OWNERS.intakeAdmin).toEqual(['link-intake']);
    for (const role of ROLES) {
      if (role === 'admin') expectSubtraction(navWithModules(role), navWithModules(role, { intakeAdmin: 'off' }), ['link-intake']);
      else expect(navWithModules(role, { intakeAdmin: 'off' })).toEqual(navWithModules(role));
    }
  });
  it('New person Admin only: a non-admin login loses it, the admin keeps it', () => {
    expect(navWithModules('admin', { newYouthForms: 'admin' })).toEqual(navWithModules('admin'));
    expectSubtraction(navWithModules('director'), navWithModules('director', { newYouthForms: 'admin' }), ['new-youth']);
  });
});

describe('OFF-routes (client page dispatcher)', () => {
  // The real render() and the real PAGE_MODULE line; every other name is stubbed. Returns the go() calls.
  const html = loadIndexHtml();
  const run = async (page: string, role: string, modules: Record<string, unknown>) => {
    const went: string[] = [];
    const NOOP: any = new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? undefined : NOOP), apply: () => '' });
    const env: Record<string, any> = {
      S: { user: { role }, page, settings: { ministryConfig: MinistryConfigSchema.parse({ modules: { ...LIVE_MODULES, ...modules } }) } },
      _shellReady: true, go: (p: string) => went.push(p),
    };
    const scope = new Proxy(env, {
      has: (_t, k) => typeof k === 'string' && !k.startsWith('__') && !(k in globalThis),
      get: (t, k) => (k === Symbol.unscopables ? undefined : k in t ? t[k as string] : NOOP),
    });
    const pm = html.match(/^const PAGE_MODULE = .*;$/m)![0];
    await new Function('__env', `with (__env) { ${pm}\n${extractFn(html, '_modOn')}\n${extractFn(html, 'render')}\n return render(); }`)(scope);
    return went;
  };
  it('names both pages', () => {
    expect(html).toMatch(/^const PAGE_MODULE = \{[^}]*'new-youth': 'newYouthForms'[^}]*\};/m);
    expect(html).toMatch(/^const PAGE_MODULE = \{[^}]*'link-intake': 'consentsHub'[^}]*\};/m);
  });
  it('New person off: both pages go Home (Intakes resolves off with it; the hub also needs Bus consent off)', async () => {
    expect(await run('new-youth', 'admin', { newYouthForms: 'off' })).toEqual(['home']);
    expect(await run('link-intake', 'admin', { newYouthForms: 'off', busConsentForm: false })).toEqual(['home']);
  });
  it('Intakes off: link-intake goes Home, New person stays', async () => {
    expect(await run('link-intake', 'admin', { intakeAdmin: 'off', busConsentForm: false })).toEqual(['home']);
    // Merged with 2.4: the page is the Consents hub, so Bus consent on keeps it (a bus-only hub).
    expect(await run('link-intake', 'admin', { intakeAdmin: 'off' })).toEqual([]);
    expect(await run('new-youth', 'admin', { intakeAdmin: 'off' })).toEqual([]);
  });
  it('live states: the dispatcher bounces neither page', async () => {
    expect(await run('new-youth', 'admin', {})).toEqual([]);
    expect(await run('link-intake', 'admin', {})).toEqual([]);
  });
});

describe('OFF-text (Home attention, Youth Setup)', () => {
  const mc = (modules: Record<string, unknown>) => MinistryConfigSchema.parse({ modules: { ...LIVE_MODULES, ...modules } });
  const lines = (modules: Record<string, unknown>, a: Record<string, unknown>) => {
    const f = loadFns(['_modOn', '_attnLines'], `var S = ${JSON.stringify({ user: { role: 'admin' }, settings: { ministryConfig: mc(modules) } })};
      var _lkDncText = () => 'dnc'; var _lkSeen = () => 'x';`);
    return f._attnLines({ role: 'admin', errors: 0, unsent: 0, unclear: 0, waiting: 0, offlineAt: null, dnc: false, fix: [], needsYou: 0, ...a }).map((l: string[]) => l[0]);
  };
  it('the "families need you" line goes with Intakes; the "not sent" line stays while New person or the bus consent form is on', () => {
    expect(lines({}, { needsYou: 2 })).toHaveLength(1);
    expect(lines({ intakeAdmin: 'off' }, { needsYou: 2 })).toEqual([]);
    expect(lines({}, { unsent: 2 })).toHaveLength(1);
    expect(lines({ newYouthForms: 'off' }, { unsent: 2 })).toHaveLength(1);            // the bus consent form is still on: its failed sends are in the same list
    expect(lines({ newYouthForms: 'off', busConsentForm: false }, { unsent: 2 })).toEqual([]);
  });
  it('Youth Setup: the Intakes switch is greyed out with a reason while New person is off, plain when it is on', () => {
    const setup = (md: Record<string, unknown>) => loadFns(['_setupIntakeHtml', '_setupModuleMode', '_nyModeOf'], 'const helpTip = () => "";')._setupIntakeHtml(md);
    const off = setup({ newYouthForms: 'off', intakeAdmin: 'on' });
    expect(off).toContain('disabled');
    expect(off).toContain('Needs New person');
    expect(off).toMatch(/<option value="off" selected>/);
    const on = setup({ newYouthForms: 'on', intakeAdmin: 'on' });
    expect(on).not.toContain('disabled');
    expect(on).not.toContain('Needs New person');
    expect(on).toMatch(/<option value="on" selected>/);
  });
});

// ---------------------------------------------------------------- server
const BRIS = brisbaneElvanto();
const fx = (f: string): any => JSON.parse(readFileSync(join(__dirname, 'fixtures', 'elvanto-link', f), 'utf8'));
const NEW_PERSON = { host: 'Sam Host', firstName: 'ALEX', lastName: 'test', dob: '2012-04-03', gender: 'f', grade: '8', school: 'CCC', mobile: '+61 412 345 678',
  parentFirst: 'pat', parentLast: 'test', parentMobile: '0498 765 432' };
const T0 = '2026-10-01T00:00:00.000Z';
const NOW = new Date('2026-10-16T09:50:00.000Z');
const ADMIN_ID = ADMIN.id;
const CONSOLE = fx('push-intake.json').consoleId as string;
const modsOf = (patch: Record<string, unknown>) => ({ ...LIVE_MODULES, ...patch });
const ROW_KEY = '5b000000-0000-4000-8000-000000000001';

async function harness(modules: Record<string, unknown> = {}) {
  const now = () => NOW;
  const link = new InMemoryLinkRepository({ now });
  const intakeRepo = new InMemoryLinkIntakeRepository(now);
  const settings = new InMemorySettingsRepository();
  const users = new InMemoryUserRepository();
  const students = new InMemoryStudentRepository(), leaders = new InMemoryLeaderRepository();
  const sessions = new InMemoryServiceSessionRepository(), attendance = new InMemoryServiceAttendanceRepository();
  for (const r of [settings, users, students, leaders, sessions, attendance]) await r.init();
  // Stored the way the live repo returns it: parsed, so the module rules have run.
  const setModules = (m: Record<string, unknown>) => settings.updateSettings({ ministryConfig: MinistryConfigSchema.parse({ elvanto: BRIS, modules: m }) } as never);
  await setModules(modsOf(modules));
  await users.save({ id: ADMIN_ID, email: 'admin', displayName: 'admin name', role: 'admin', status: 'active', createdAt: T0, updatedAt: T0 } as never);
  const errorLog = { record: vi.fn(async () => {}) };
  const svc = makeLinkService({ link, settings, students, leaders, users, serviceSessions: sessions, serviceAttendance: attendance,
    limiter: { isBlocked: () => false }, now, errorLog, intake: intakeRepo });
  const intake = makeIntakeService({ intake: intakeRepo, link, settings, status: (a) => svc.status(a), now, errorLog });
  const fetchFn = vi.fn(async () => new Response('', { status: 200 })) as unknown as typeof fetch;
  const newYouth = makeNewYouthService(settings, { fetchFn });
  return { link, intakeRepo, settings, svc, intake, newYouth, fetchFn, setModules };
}
const intakeDate = () => ({ date: '2026-10-16', takenAt: '2026-10-16T09:41:00.000Z', consoleId: CONSOLE, cut: false, inputs: null });
const rowW = () => ({ key: ROW_KEY, status: 'needs-you' as const, title: 'A family', reason: '', outcome: '', fromApp: false,
  hasText: false, personId: null, family: null, detail: { hello: 'plan' } });

describe('OFF-api', () => {
  it('New person off: send (and so the admin resend of an unsent row, which runs the same code) refuses with ModuleDisabledError and never reaches Elvanto', async () => {
    const h = await harness({ newYouthForms: 'off' });
    await expect(h.newYouth.send(ADMIN, NEW_PERSON)).rejects.toThrow(ModuleDisabledError);
    await expect(h.newYouth.send(ADMIN, NEW_PERSON)).rejects.toMatchObject({ statusCode: 404 });
    expect(h.fetchFn).not.toHaveBeenCalled();
  });
  it('Intakes off: list, row and refresh refuse', async () => {
    const h = await harness({ intakeAdmin: 'off' });
    await expect(h.intake.list(ADMIN, { mode: 'intake' })).rejects.toThrow(ModuleDisabledError);
    await expect(h.intake.row(ADMIN, { mode: 'intake', date: '2026-10-16', key: ROW_KEY })).rejects.toThrow(ModuleDisabledError);
    await expect(h.intake.refresh(ADMIN, { mode: 'intake', date: '2026-10-16' })).rejects.toThrow(ModuleDisabledError);
  });
  it('New person off turns Intakes off with it: entry points refuse, the console hint says off, a push stores nothing', async () => {
    const h = await harness({ newYouthForms: 'off', intakeAdmin: 'on' });
    const s = (await h.settings.getSettings()) as never;
    await expect(h.intake.list(ADMIN, { mode: 'intake' })).rejects.toThrow(ModuleDisabledError);
    expect((await h.intake.hint(s)).mode).toBe('off');
    expect(await h.intake.push('intakePlan', fx('push-intake.json'), s)).toEqual({ applied: false });
  });
  it('Intakes off: texting a family (intakeText) and saving or answering an intake are refused as a disabled module', async () => {
    const h = await harness({ intakeAdmin: 'off' });
    let n = 0;
    const item = (type: string, payload: unknown) => ({ kind: 'action', id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, type, payload, note: null, leaderId: null });
    const res = await h.svc.batch(ADMIN, { device: { id: 'd1', label: 'iPhone' }, sentAt: NOW.toISOString(), items: [
      item('intakeText', { date: '2026-10-16', row: ROW_KEY }),
      item('intakeSave', { date: '2026-10-16', row: ROW_KEY, confirmed: [], one: false }),
      item('intakeAnswer', { date: '2026-10-16', row: ROW_KEY, answers: {} }),
    ] });
    expect(res.results.map((r: any) => [r.outcome, r.code])).toEqual([['refused', 'MODULE_DISABLED'], ['refused', 'MODULE_DISABLED'], ['refused', 'MODULE_DISABLED']]);
  });
});

describe('BACK-ON', () => {
  it('turning the modules off and on again keeps the intake rows and the config byte for byte', async () => {
    const h = await harness();
    await h.intakeRepo.replace('intake', intakeDate(), [rowW()]);
    const before = JSON.stringify((await h.settings.getSettings()).ministryConfig);
    const rowsBefore = JSON.stringify(await h.intakeRepo.rows('intake'));
    await h.setModules(modsOf({ newYouthForms: 'off' }));                 // a config change only: the delete-on-off cleanup is the settings save, which the wizard warns before
    await expect(h.intake.list(ADMIN, { mode: 'intake' })).rejects.toThrow(ModuleDisabledError);
    expect(JSON.stringify(await h.intakeRepo.rows('intake'))).toBe(rowsBefore);
    await h.setModules(modsOf({}));
    expect(JSON.stringify((await h.settings.getSettings()).ministryConfig)).toBe(before);
    expect(await h.intake.list(ADMIN, { mode: 'intake' })).toMatchObject({ dates: [{ date: '2026-10-16' }] });
    expect(JSON.stringify(await h.intakeRepo.rows('intake'))).toBe(rowsBefore);
  });
});
