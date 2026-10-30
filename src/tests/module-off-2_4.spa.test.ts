// Modular-setup lane 2.4 (YS): Live Elvanto link (modules.liveLink) and the Consents hub (consentsHub = consentsHubOn:
// the Public consent form or Intakes). OFF-nav / OFF-routes / OFF-api / HUB1 / BACK-ON / ON. The golden lives in
// baseline-modules.spa.test.ts and must stay byte-unchanged.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadFns, loadIndexHtml, extractFn } from './helpers/extract-fn';
import { navWithModules, expectSubtraction } from './helpers/module-off';
import { makeLinkService } from '../services/link.service';
import { makeIntakeService } from '../services/link-intake.service';
import { makeSyncService } from '../services/sync.service';
import { makeReconcileService } from '../services/reconcile.service';
import { makeErrorLogService } from '../services/error-log.service';
import { InMemoryLinkRepository } from '../repositories/in-memory/link.repository';
import { InMemoryLinkIntakeRepository } from '../repositories/in-memory/link-intake.repository';
import { InMemoryErrorLogRepository } from '../repositories/in-memory/error-log.repository';
import { InMemoryReconcileRunRepository } from '../repositories/in-memory/reconcile-run.repository';
import { InMemorySettingsRepository, InMemoryStudentRepository, InMemoryLeaderRepository, InMemoryUserRepository,
  InMemoryServiceSessionRepository, InMemoryServiceAttendanceRepository } from '../repositories/in-memory';
import { MinistryConfigSchema } from '../core/ministry-config';
import { ModuleDisabledError } from '../core/errors/app-error';
import { CONSENT_TYPES, INTAKE_TYPES } from '../core/link-contract';
import type { Actor } from '../core/entities/user';
import LIVE_MODULES from './fixtures/live-modules.json';
import OWNERS from './fixtures/module-owners.json';

const HTML = loadIndexHtml();
const ROLES = ['admin', 'oversight', 'grade', 'quad', 'leader'];
const fx = (f: string): any => JSON.parse(readFileSync(join(__dirname, 'fixtures', 'elvanto-link', f), 'utf8'));
const NOW = new Date('2026-10-23T01:00:00.000Z');
const ADMIN = { id: '00000000-0000-4000-8000-000000000001', role: 'admin', displayName: 'admin', grade: null, quad: null, gender: null, leaderId: null } as Actor;
const LINK_OFF = { liveLink: false };
const BUS_ONLY = { busMinistry: true, busConsentForm: true, intakeAdmin: 'off', newYouthForms: 'off' }; // HUB1
const HUB_OFF = { busConsentForm: false, intakeAdmin: 'off' };
const mods = (patch: Record<string, unknown> = {}) => MinistryConfigSchema.parse({ modules: { ...LIVE_MODULES, ...patch } }).modules;

// ---------- server harness (in-memory, the link-consent-snapshot.test.ts pattern) ----------
async function setup(patch: Record<string, unknown> = {}) {
  const now = () => NOW;
  const link = new InMemoryLinkRepository({ now });
  const intakeRepo = new InMemoryLinkIntakeRepository(now);
  const settings = new InMemorySettingsRepository();
  const users = new InMemoryUserRepository();
  const students = new InMemoryStudentRepository();
  const leaders = new InMemoryLeaderRepository();
  const sessions = new InMemoryServiceSessionRepository();
  const attendance = new InMemoryServiceAttendanceRepository();
  for (const r of [settings, users, students, leaders, sessions, attendance]) await r.init();
  const setMods = (p: Record<string, unknown>) => settings.updateSettings({ ministryConfig: MinistryConfigSchema.parse({ modules: { ...LIVE_MODULES, ...p } }) } as never);
  await setMods(patch);
  const errRepo = new InMemoryErrorLogRepository();
  const errorLog = makeErrorLogService({ repo: errRepo, link, settings, now });
  const svc = makeLinkService({ link, settings, students, leaders, users, serviceSessions: sessions, serviceAttendance: attendance,
    limiter: { isBlocked: () => false }, now, errorLog, intake: intakeRepo });
  const intake = makeIntakeService({ intake: intakeRepo, link, settings, status: (a) => svc.status(a), now, errorLog });
  const sync = makeSyncService({ link, settings, students, users, now, errorLog, intake });
  const runs = new InMemoryReconcileRunRepository();
  const reconcile = makeReconcileService({ link, students, lifegroups: { findAll: async () => [], findRoll: async () => [] } as never,
    lifegroupWeeks: { findAll: async () => [] }, lifegroupAttendance: { findAll: async () => [] }, serviceSessions: { findAll: async () => [] },
    serviceAttendance: { findBySession: async () => [] }, imports: { findByType: async () => [{ id: 'imp-1', importedAt: NOW.toISOString() } as never] },
    settings, errorLog, errorRows: errRepo, runs, now });
  // A rev 19 console that offers every intake + consent type (as the live console does).
  const caps = Object.fromEntries([...INTAKE_TYPES, ...CONSENT_TYPES].map((t) => [t, 'live']));
  const claim = () => sync.claim({ ...fx('claim-request.json'), linkRev: 19, capabilities: { ...fx('claim-request.json').capabilities, ...caps } });
  return { link, settings, setMods, svc, intake, sync, reconcile, runs, errRepo, errorLog, claim };
}
const leased = (spy: any) => spy.mock.calls.at(-1)[0] as { max: number; console: { capabilities: Record<string, string> } };
const SNAP = () => fx('push-consent-snapshot-rev19.json');

// ---------- SPA harness ----------
const spa = (role: string, patch: Record<string, unknown>, names: string[], extra = '') =>
  loadFns(names, `var S = ${JSON.stringify({ user: { id: 'u1', role }, page: 'bus', settings: { ministryConfig: { modules: mods(patch) } } })};
    var esc = (x) => String(x), icS = (k) => '<i ' + k + '>', progBar = () => '<bar>', _busConsentStatusHtml = () => '', _busFormsListHtml = () => '';
    var BUS = { forms: { rows: [] }, formsQ: '' };${extra}`);

describe('OFF-nav: Live Elvanto link off subtracts exactly the link ids (its sub-modules follow it)', () => {
  // liveLink owns the Admin tab; the link screens, New person, the intake page and Connection Audit go with it because
  // resolveModules turns them off.
  const CASCADE = ['link-checkin', 'link-groups', 'link-flows', 'link-intake', 'new-youth'];
  it('module-owners.json records the liveLink and consentsHub ids', () => {
    expect((OWNERS as Record<string, string[]>).liveLink).toEqual(['link', 'link-admin']);
    expect((OWNERS as Record<string, string[]>).consentsHub).toEqual(['link-intake']);
  });
  for (const role of ROLES) {
    it(role, () => {
      const base = navWithModules(role);
      const present = new Set(Object.values(base).flat());
      // Connection Audit needs Flows, so its ca-* nav ids go too.
      const owned = ['link', ...CASCADE, ...[...present].filter((i) => i.startsWith('ca-'))].filter((i) => present.has(i));
      if (role === 'admin') expect(owned).toContain('link');
      expectSubtraction(base, navWithModules(role, LINK_OFF), owned);
    });
  }
  it('bus-only (HUB1) leaves the Elvanto link tab in place', () => {
    expect(navWithModules('admin', BUS_ONLY).adminTabs).toContain('link');
  });
});

describe('OFF-routes: the client dispatcher sends an off page Home', () => {
  const PAGE_MODULE = new Function(`${HTML.match(/^const PAGE_MODULE = .*$/m)![0]}; return PAGE_MODULE;`)();
  const run = async (page: string, modules: Record<string, unknown>) => {
    const went: string[] = [];
    const NOOP: any = new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? undefined : NOOP), apply: () => '' });
    const env: Record<string, any> = { S: { user: { role: 'admin' }, page, settings: { ministryConfig: { modules } } }, PAGE_MODULE, _shellReady: true, go: (p: string) => went.push(p) };
    const scope = new Proxy(env, {
      has: (_t, k) => typeof k === 'string' && !k.startsWith('__') && !(k in globalThis),
      get: (t, k) => (k === Symbol.unscopables ? undefined : k in t ? t[k as string] : NOOP),
    });
    // eslint-disable-next-line no-new-func
    await new Function('__env', `with (__env) { ${extractFn(HTML, '_modOn')}\n${extractFn(HTML, 'render')}\n return render(); }`)(scope);
    return went;
  };
  it('link-admin follows liveLink, link-intake follows consentsHub', async () => {
    expect(PAGE_MODULE).toMatchObject({ 'link-admin': 'liveLink', 'link-intake': 'consentsHub' });
    expect(await run('link-admin', mods(LINK_OFF))).toEqual(['home']);
    expect(await run('link-admin', mods())).toEqual([]);
    expect(await run('link-intake', mods(HUB_OFF))).toEqual(['home']);
    expect(await run('link-intake', mods(BUS_ONLY))).toEqual([]); // HUB1: the hub page opens with Intakes off
  });
});

describe('OFF-home: Needs attention reads no link route while the link is off', () => {
  const reads = async (patch: Record<string, unknown>) => {
    const f = loadFns(['_attnLoad', '_attnCounts', '_attnMine', '_modOn', '_linkOn', '_linkModeOf', '_nyModeOf', '_ikModuleOn'],
      `var S = ${JSON.stringify({ user: { id: 'u1', role: 'admin' }, settings: { ministryConfig: { modules: mods(patch) } } })};
       var _attn = null, _attnBusy = null, LINK = {}, paths = [];
       var API = { fresh: async (p) => { paths.push(p.replace(/[?].*/, '')); return null; } };
       function _siteDay() { return '2026-10-23'; } function _attnPaint() {}`, ['_attnLoad', 'paths']);
    await f._attnLoad(true);
    return f.paths as string[];
  };
  it('live reads the link status and actions; link off reads none of them', async () => {
    expect((await reads({})).filter((p) => p.startsWith('/link/'))).toEqual(['/link/actions', '/link/actions', '/link/status', '/link/intake']);
    const off = await reads(LINK_OFF);
    expect(off.filter((p) => p.startsWith('/link/'))).toEqual([]);
    expect(off).toEqual(['/admin/errors', '/admin/unsent', '/setup/status']);
  });
});

describe('OFF-api: Live Elvanto link off', () => {
  it('every link read refuses, admin included; the claim leases nothing', async () => {
    const h = await setup(LINK_OFF);
    await expect(h.svc.status(ADMIN)).rejects.toThrow(ModuleDisabledError);
    await expect(h.svc.listActions(ADMIN, {})).rejects.toThrow(ModuleDisabledError);
    await expect(h.svc.log(ADMIN, {})).rejects.toThrow(ModuleDisabledError);
    await expect(h.svc.consentSnapshot(ADMIN)).rejects.toThrow(ModuleDisabledError); // the hub needs the link (resolveModules)
    const spy = vi.spyOn(h.link, 'claim');
    await h.claim();
    expect(leased(spy).max).toBe(0);
  });
  it('reconcile: no run, no rematch; Who? and Send again refuse', async () => {
    const h = await setup(LINK_OFF);
    await h.reconcile.run();
    expect(await h.runs.latest()).toBeNull();
    await expect(h.reconcile.whoLatest(ADMIN)).rejects.toThrow(ModuleDisabledError);
    await expect(h.reconcile.resend(ADMIN, {})).rejects.toThrow(ModuleDisabledError);
  });
  it('the error log leaves out link and reconcile entries while off, and shows them again once on (kept)', async () => {
    const h = await setup();
    await h.errorLog.record({ category: 'link', code: 'too-old', route: 'checkIn', role: 'console' });
    await h.errorLog.record({ category: 'reconcile', code: 'recon-unmatched', route: '' }, 1);
    await h.errorLog.record({ category: 'server', code: 'X', route: 'r' });
    const cats = async () => (await h.errorLog.list(ADMIN)).rows.map((r) => r.code).sort();
    const on = await cats();
    expect(on).toEqual(['X', 'recon-unmatched', 'too-old']);
    await h.setMods(LINK_OFF);
    expect(await cats()).toEqual(['X']);
    await h.setMods({});
    expect(await cats()).toEqual(on);
  });
});

describe('HUB1: a bus-only location (Public consent form on, Intakes off) has a working Consents hub', () => {
  it('server: the snapshot is stored and served, Refresh asks, the consent types lease; intake stays refused', async () => {
    const h = await setup(BUS_ONLY);
    expect(await h.sync.push('consentSnapshot', SNAP())).toEqual({ applied: true, rows: 1 });
    expect(((await h.svc.consentSnapshot(ADMIN)) as any).kinds.unlinked).toMatchObject({ total: 1 });
    expect((await h.svc.consentSnapshotRefresh(ADMIN)).asked).toBeTruthy();
    const spy = vi.spyOn(h.link, 'claim');
    const reply = await h.claim();
    const caps = leased(spy).console.capabilities;
    for (const t of CONSENT_TYPES) expect(caps[t], t).toBe('live');
    for (const t of INTAKE_TYPES) expect(caps[t], t).toBeUndefined();
    expect(reply).toHaveProperty('consentSnap');
    await expect(h.intake.list(ADMIN, { mode: 'intake' })).rejects.toThrow(ModuleDisabledError);
  });
  it('hub off (no consent form, no Intakes): refused, nothing stored, consent types stripped', async () => {
    const h = await setup(HUB_OFF);
    await expect(h.svc.consentSnapshot(ADMIN)).rejects.toThrow(ModuleDisabledError);
    await expect(h.svc.consentSnapshotRefresh(ADMIN)).rejects.toThrow(ModuleDisabledError);
    await expect(h.svc.youth(ADMIN, { scope: 'consents' })).rejects.toThrow(ModuleDisabledError);
    expect(await h.sync.push('consentSnapshot', SNAP())).toEqual({ applied: false });
    const spy = vi.spyOn(h.link, 'claim');
    const reply = await h.claim();
    for (const t of CONSENT_TYPES) expect(leased(spy).console.capabilities[t], t).toBeUndefined();
    expect(reply).not.toHaveProperty('consentSnap');
  });
  it('SPA: Bus > Forms links the admin to the hub (only while Intakes is off); the page is titled Consents', () => {
    const NAMES = ['_busFormsHtml', '_hubModuleOn', '_ikModuleOn', '_modOn', '_hubTitle'];
    const bus = spa('admin', BUS_ONLY, NAMES);
    expect(bus._hubModuleOn()).toBe(true);
    expect(bus._hubTitle()).toBe('Consents');
    expect(bus._busFormsHtml()).toContain(`go('link-intake')`);
    const live = spa('admin', {}, NAMES);
    expect(live._busFormsHtml()).not.toContain(`go('link-intake')`); // live reaches it from More, as today
    expect(live._hubTitle()).toBe('New youth & consent');
    expect(spa('oversight', BUS_ONLY, NAMES)._busFormsHtml()).not.toContain(`go('link-intake')`);
    expect(spa('admin', HUB_OFF, NAMES)._hubModuleOn()).toBe(false);
  });
});

describe('BACK-ON: turning Live Elvanto link off and on again keeps the data and the config', () => {
  it('the stored consent copy and the modules come back byte-equal', async () => {
    const h = await setup();
    await h.sync.push('consentSnapshot', SNAP());
    const before = JSON.stringify(await h.svc.consentSnapshot(ADMIN));
    const cfgBefore = JSON.stringify((await h.settings.getSettings()).ministryConfig.modules);
    await h.setMods(LINK_OFF);
    await expect(h.svc.consentSnapshot(ADMIN)).rejects.toThrow(ModuleDisabledError);
    await h.setMods({});
    expect(JSON.stringify(await h.svc.consentSnapshot(ADMIN))).toBe(before);
    expect(JSON.stringify((await h.settings.getSettings()).ministryConfig.modules)).toBe(cfgBefore);
  });
});

describe('ON: live (everything on but Notices) is unchanged', () => {
  it('the claim leases every intake and consent type and asks for the consent copy', async () => {
    const h = await setup();
    const spy = vi.spyOn(h.link, 'claim');
    const reply = await h.claim();
    expect(leased(spy).max).toBe(6);
    for (const t of [...INTAKE_TYPES, ...CONSENT_TYPES]) expect(leased(spy).console.capabilities[t], t).toBe('live');
    expect(reply).toHaveProperty('consentSnap');
    expect(((await h.svc.status(ADMIN)) as any).appLinkRev).toBeGreaterThan(0);
  });
});
