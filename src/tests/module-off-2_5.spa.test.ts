// Modular-setup lane 2.5 (YS half): Flows, Check-in and Lifegroup report (Elvanto). Keys: flows, checkin, lifegroupReport.
// OFF-nav, OFF-api, OFF-routes (client page guard), the setup-check row, BACK-ON. ON = the baseline-modules golden (own file).
// /lifegroups/stats is Core (modules.lifegroups) and is not touched here.
import { describe, it, expect, vi } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';
import { navWithModules, expectSubtraction } from './helpers/module-off';
import OWNERS from './fixtures/module-owners.json';
import { makeLinkService, LINK_RATE_MAX, LINK_RATE_WINDOW_MS } from '../services/link.service';
import { makeSetupService } from '../services/setup.service';
import { InMemoryLinkRepository } from '../repositories/in-memory/link.repository';
import {
  InMemorySettingsRepository, InMemoryStudentRepository, InMemoryLeaderRepository, InMemoryUserRepository,
  InMemoryServiceSessionRepository, InMemoryServiceAttendanceRepository,
} from '../repositories/in-memory';
import { MINISTRY_CONFIG_DEFAULTS } from '../core/ministry-config';
import { ModuleDisabledError } from '../core/errors/app-error';
import { RateLimiter } from '../utils/rate-limiter';
import { LATEST_MIGRATION } from '../core/schema-version';
import type { AuthService } from '../services/auth.service';
import type { Actor } from '../core/entities/user';

const KEYS = ['flows', 'checkin', 'lifegroupReport'] as const;
const PAGE = { flows: 'link-flows', checkin: 'link-checkin', lifegroupReport: 'link-groups' } as const;
const ROLES = ['admin', 'director', 'quad', 'grade', 'leader'];
// connectionAudit is off in the nav baselines: it needs flows + lifegroupReport + newYouthForms, so it cascades off with them (lane 2.6 owns it).
const ON = { flows: 'on', checkin: 'on', lifegroupReport: 'on' };
const NAV_ON = { ...ON, connectionAudit: false };

describe('2.5 owners fixture', () => {
  it('records the page each module owns', () => {
    for (const k of KEYS) expect((OWNERS as Record<string, string[]>)[k], k).toEqual([PAGE[k]]);
  });
});

describe('2.5 OFF-nav', () => {
  for (const k of KEYS) {
    it(`${k} off: every role loses exactly ${PAGE[k]} (when it had it) and nothing else`, () => {
      let admin = false;
      for (const role of ROLES) {
        const base = navWithModules(role, NAV_ON);
        const owned = [PAGE[k]].filter((i) => Object.values(base).flat().includes(i));
        if (role === 'admin') admin = owned.length === 1;
        expectSubtraction(base, navWithModules(role, { ...NAV_ON, [k]: 'off' }), owned);
        if (!owned.length) expect(navWithModules(role, { ...NAV_ON, [k]: 'off' })).toEqual(base); // e.g. a junior leader has no Flow steps
      }
      expect(admin, 'the admin login had the owned page, so the test proves something').toBe(true);
    });
  }
  it('Connection Audit cascades off with flows or lifegroupReport (module tree rule), as it does today', () => {
    for (const k of ['flows', 'lifegroupReport']) {
      expect(navWithModules('admin', { ...ON, connectionAudit: true }).nav).toContain('ca-week');
      expect(navWithModules('admin', { ...ON, connectionAudit: true, [k]: 'off' }).nav).not.toContain('ca-week');
    }
  });
  it('Services (check-in) and Service Visits (flows) hang off those pages and add no nav ids of their own', () => {
    const base = navWithModules('admin', NAV_ON);
    expect(Object.values(base).flat().filter((i) => /service|visit/i.test(i))).toEqual([]);
  });
});

describe('2.5 OFF-routes: the client page guard', () => {
  const HTML = loadIndexHtml();
  const pageModule = new Function(`${HTML.match(/^const PAGE_MODULE = .*$/m)![0]}\n${HTML.match(/^Object\.assign\(PAGE_MODULE, .*$/m)![0]}\nreturn PAGE_MODULE;`)() as never;
  const run = async (page: string, role: string, modules: Record<string, unknown>) => {
    const went: string[] = [];
    const NOOP: any = new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? undefined : NOOP), apply: () => '' });
    const env: Record<string, any> = { S: { user: { role }, page, settings: { ministryConfig: { modules } } }, PAGE_MODULE: pageModule, _shellReady: true, go: (p: string) => went.push(p) };
    const scope = new Proxy(env, {
      has: (_t, k) => typeof k === 'string' && !k.startsWith('__') && !(k in globalThis),
      get: (t, k) => (k === Symbol.unscopables ? undefined : k in t ? t[k as string] : NOOP),
    });
    await new Function('__env', `with (__env) { ${extractFn(HTML, '_modOn')}\n${extractFn(HTML, 'render')}\n return render(); }`)(scope);
    return went;
  };
  it('maps the three pages', () => expect(pageModule).toMatchObject({ 'link-flows': 'flows', 'link-checkin': 'checkin', 'link-groups': 'lifegroupReport' }));
  for (const k of KEYS) {
    it(`${PAGE[k]}: Home when ${k} is off, through when on, through for the admin in Admin only`, async () => {
      expect(await run(PAGE[k], 'admin', { ...ON, [k]: 'off' })).toEqual(['home']);
      expect(await run(PAGE[k], 'admin', ON)).toEqual([]);
      expect(await run(PAGE[k], 'admin', { ...ON, [k]: 'admin' })).toEqual([]);
    });
  }
});

// ---- OFF-api: the real link service on in-memory repos
const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = '2026-10-01T00:00:00.000Z';
const ADMIN: Actor = { id: u(1), role: 'admin', displayName: 'admin', grade: null, quad: null, gender: null, leaderId: null } as Actor;
const DIRECTOR: Actor = { ...ADMIN, id: u(2), role: 'director' } as Actor;
const NOW = new Date('2026-10-16T09:00:00.000Z');
const FLOW_ROW = { rowId: u(501), flowId: u(511), flowName: 'Bravo', stepId: u(521), stepName: 'Welcome call', stepOrder: 2, personId: u(101), name: 'Amy Adams', due: null, assignedTo: 'Admin' };

async function harness(modes: Record<string, string>) {
  const link = new InMemoryLinkRepository({ now: () => NOW });
  const settings = new InMemorySettingsRepository();
  const rest = [new InMemoryStudentRepository(), new InMemoryLeaderRepository(), new InMemoryUserRepository(),
    new InMemoryServiceSessionRepository(), new InMemoryServiceAttendanceRepository()] as const;
  for (const r of [settings, ...rest]) await r.init();
  const set = (m: Record<string, string>) => settings.updateSettings({ ministryConfig: { ...MINISTRY_CONFIG_DEFAULTS, modules: { ...MINISTRY_CONFIG_DEFAULTS.modules, newYouthForms: 'on', ...m } } } as never);
  await set(modes);
  await link.replaceMirror('flows', [FLOW_ROW], { takenAt: '2026-10-16T08:00:00.000Z', consoleId: u(601) });
  const svc = makeLinkService({ link, settings, students: rest[0], leaders: rest[1], users: rest[2], serviceSessions: rest[3], serviceAttendance: rest[4],
    limiter: new RateLimiter(LINK_RATE_MAX, LINK_RATE_WINDOW_MS), now: () => NOW });
  return { svc, link, set };
}

describe('2.5 OFF-api', () => {
  const off = { flows: 'off', checkin: 'off', lifegroupReport: 'off' };
  it('every owned entry point throws ModuleDisabledError for the admin, director and a junior login', async () => {
    const h = await harness(off);
    for (const a of [ADMIN, DIRECTOR, { ...ADMIN, id: u(5), role: 'leader' } as Actor]) {
      await expect(h.svc.checkin(a)).rejects.toThrow(ModuleDisabledError);
      await expect(h.svc.lifegroups(a)).rejects.toThrow(ModuleDisabledError);
      await expect(h.svc.groupMembers(a, u(401), {})).rejects.toThrow(ModuleDisabledError);
      await expect(h.svc.youth(a)).rejects.toThrow(ModuleDisabledError);
      await expect(h.svc.flows(a)).rejects.toThrow(ModuleDisabledError);
      await expect(h.svc.assignFlow(a, { flowId: u(511), personId: u(101), leaderId: null })).rejects.toThrow(ModuleDisabledError);
    }
  });
  it('a batch item of an off screen is refused, not queued', async () => {
    const h = await harness(off);
    const items = [
      { kind: 'action', id: u(9001), type: 'checkIn', payload: { serviceTimeId: u(201), serviceId: u(211), personId: u(101) }, note: null, leaderId: null },
      { kind: 'action', id: u(9002), type: 'completeStep', payload: { rowId: u(501), flowId: u(511), stepId: u(521), personId: u(101), notePrivate: false }, note: null, leaderId: null },
      { kind: 'action', id: u(9003), type: 'addGroupMember', payload: { groupId: u(401), personId: u(101) }, note: null, leaderId: null },
    ];
    const r = await h.svc.batch(ADMIN, { items });
    expect(r.results.map((x: any) => x.outcome)).toEqual(['refused', 'refused', 'refused']);
    expect(await h.link.listActions({})).toEqual([]);
  });
  it('one screen off leaves the others working (only that module is stopped)', async () => {
    const h = await harness({ ...off, checkin: 'on' });
    await expect(h.svc.checkin(ADMIN)).resolves.toBeTruthy();
    await expect(h.svc.flows(ADMIN)).rejects.toThrow(ModuleDisabledError);
    await expect(h.svc.lifegroups(ADMIN)).rejects.toThrow(ModuleDisabledError);
  });
  it('BACK-ON: the mirror rows are untouched by the off period, and the screens answer again', async () => {
    const h = await harness({ ...ON });
    const before = JSON.stringify(await h.link.flows());
    expect((await h.svc.flows(ADMIN)).rows).toHaveLength(1);
    await h.set(off);
    await expect(h.svc.flows(ADMIN)).rejects.toThrow(ModuleDisabledError);
    expect(JSON.stringify(await h.link.flows())).toBe(before);
    await h.set(ON);
    expect(JSON.stringify(await h.link.flows())).toBe(before);
    expect((await h.svc.flows(ADMIN)).rows).toHaveLength(1);
  });
});

describe('2.5 System check: the New People flow row follows flows', () => {
  const fakeAuth = { issueTokenFor: vi.fn(async (id: string) => `tok-${id}`) } as unknown as AuthService;
  const env = { PERSISTENCE: 'supabase', DATABASE_URL: 'postgresql://u:p@h.example.com:5432/postgres', SESSION_SECRET: 's'.repeat(64),
    FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'), APP_ORIGIN: 'https://church.vercel.app', SETUP_CODE: 'ABCD-EFGH-JKMN-PQRS-TUVW' };
  async function ids(flows: string) {
    const settings = new InMemorySettingsRepository();
    await settings.init();
    await settings.updateSettings({ ministryConfig: { ...MINISTRY_CONFIG_DEFAULTS, modules: { ...MINISTRY_CONFIG_DEFAULTS.modules, newYouthForms: 'on', flows } } } as never);
    const s = makeSetupService({ users: new InMemoryUserRepository(), auth: fakeAuth, env, probeDb: async () => true, schemaVersion: async () => LATEST_MIGRATION,
      settings, flows: async () => [] });
    await s.createFirstAdmin({ code: env.SETUP_CODE, displayName: 'A', password: 'longenough' });
    return (await s.status({ id: 'a', role: 'admin' } as any, 'https://church.vercel.app')).checks.map((c) => c.id);
  }
  it('absent when flows is off, present when Admin only or On (the live state)', async () => {
    expect(await ids('off')).not.toContain('peopleFlow');
    expect(await ids('admin')).toContain('peopleFlow');
    expect(await ids('on')).toContain('peopleFlow');
  });
});
