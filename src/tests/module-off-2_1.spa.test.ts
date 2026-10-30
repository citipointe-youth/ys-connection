// Modular-setup Task 2.1 (YS side): the Prayer and Notices lane. Off = hidden and stopped; the data stays and comes back
// byte-equal when the module is turned on again. Owned ids come from fixtures/module-owners.json.
import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml, extractFn } from './helpers/extract-fn';
import { navWithModules, expectSubtraction } from './helpers/module-off';
import { makePrayerService } from '../services/prayer.service';
import { makeNoticeService } from '../services/notice.service';
import { ModuleDisabledError } from '../core/errors/app-error';
import { InMemoryPrayerRepository, InMemoryStudentRepository, InMemoryConnectionRepository, InMemorySettingsRepository,
  InMemoryNoticeRepository } from '../repositories/in-memory/in-memory.repositories';
import type { Actor } from '../core/entities/user';
import OWNERS from './fixtures/module-owners.json';

const HTML = loadIndexHtml();
const owned = (key: 'prayers' | 'notices'): string[] => OWNERS[key];
const ROLES = ['admin', 'oversight', 'grade', 'quad', 'leader'] as const;
const actor = (role: string, quad: string | null = null): Actor =>
  ({ id: `${role}-${quad}`, role: role as any, displayName: role, grade: null as any, quad: quad as any, leaderId: null });
const ADMIN = actor('admin');

/** Writes module keys into the stored settings (as the Youth Setup save does), keeping everything else. */
async function setModules(settings: InMemorySettingsRepository, patch: Record<string, unknown>) {
  const c = await settings.getSettings();
  await settings.updateSettings({ ministryConfig: { ...c.ministryConfig, modules: { ...c.ministryConfig.modules, ...patch } } });
}
const modulesOf = async (settings: InMemorySettingsRepository) => JSON.stringify((await settings.getSettings()).ministryConfig.modules);

// ---------- OFF-nav ----------
describe('OFF-nav: Prayers and Notices leave every nav surface for every role', () => {
  for (const role of ROLES) {
    it(role, () => {
      const base = navWithModules(role, { prayers: true, notices: 'on' });
      const off = navWithModules(role, { prayers: false, notices: 'off' });
      const present = new Set(Object.values(base).flat());
      expectSubtraction(base, off, owned('prayers').concat(owned('notices')).filter((id) => present.has(id)));
    });
  }
});

// ---------- ON ----------
describe('ON: with both modules on the nav is offered as before', () => {
  it('admin sees Prayers and the Notices More entry', () => {
    const base = navWithModules('admin', { prayers: true, notices: 'on' });
    expect(new Set(Object.values(base).flat()).has('prayers')).toBe(true);
    expect(base.more).toContain('notices');
  });
  it('a grade login never gets Notices (quad, admin and oversight only)', () => {
    expect(navWithModules('grade', { notices: 'on' }).more).not.toContain('notices');
  });
});

// ---------- OFF-api ----------
async function prayerHarness() {
  const prayers = new InMemoryPrayerRepository();
  const students = new InMemoryStudentRepository();
  const conns = new InMemoryConnectionRepository();
  const settings = new InMemorySettingsRepository();
  await prayers.init(); await students.init(); await conns.init();
  return { s: makePrayerService(prayers, students, settings, conns), settings };
}
describe('OFF-api: every Prayer service entry point refuses when off; the rows come back on', () => {
  it('refuses all seven, keeps the rows, and the modules config round trips byte-equal', async () => {
    const { s, settings } = await prayerHarness();
    const seeded = await s.create(ADMIN, { studentId: null, text: 'Pray for the camp' });   // seeded while on
    const before = await s.list(ADMIN);
    const modsOn = await modulesOf(settings);

    await setModules(settings, { prayers: false });
    await expect(s.list(ADMIN)).rejects.toThrow(ModuleDisabledError);
    await expect(s.create(ADMIN, { studentId: null, text: 'x' })).rejects.toThrow(ModuleDisabledError);
    await expect(s.update(ADMIN, seeded.id, { text: 'x' })).rejects.toThrow(ModuleDisabledError);
    await expect(s.setStatus(ADMIN, seeded.id, { status: 'answered' })).rejects.toThrow(ModuleDisabledError);
    await expect(s.remove(ADMIN, seeded.id)).rejects.toThrow(ModuleDisabledError);
    await expect(s.exportCsv(ADMIN)).rejects.toThrow(ModuleDisabledError);
    await expect(s.importCsv(ADMIN, [])).rejects.toThrow(ModuleDisabledError);

    await setModules(settings, { prayers: true });                          // back on: nothing was dropped while off
    expect(await s.list(ADMIN)).toEqual(before);
    expect(await modulesOf(settings)).toBe(modsOn);
  });
});

async function noticeHarness() {
  const settings = new InMemorySettingsRepository();
  const svc = makeNoticeService(new InMemoryNoticeRepository(), settings, () => new Date('2026-10-27T10:00:00Z'));
  return { svc, settings };
}
describe('OFF-api: Notices refuses when off; turning alerts off always works', () => {
  it('refuses list, send, remove, pushConfig and subscribe; unsubscribe still answers ok', async () => {
    const { svc, settings } = await noticeHarness();
    await setModules(settings, { notices: 'on' });
    const sent = await svc.send(ADMIN, { title: 'Camp', body: 'Bring a hat', recipients: ['b79'] });
    const before = await svc.list(ADMIN);
    const modsOn = await modulesOf(settings);

    await setModules(settings, { notices: 'off' });
    await expect(svc.list(ADMIN)).rejects.toThrow(ModuleDisabledError);
    await expect(svc.send(ADMIN, { title: 'x', body: 'y', recipients: ['b79'] })).rejects.toThrow(ModuleDisabledError);
    await expect(svc.remove(ADMIN, sent.id)).rejects.toThrow(ModuleDisabledError);
    await expect(svc.pushConfig(ADMIN)).rejects.toThrow(ModuleDisabledError);
    await expect(svc.subscribe(ADMIN, {})).rejects.toThrow(ModuleDisabledError);
    // Deliberate exception (notice.service.ts: "Not module-gated: turning alerts off always works").
    await expect(svc.unsubscribe(ADMIN, { endpoint: 'https://push.example/x' })).resolves.toEqual({ ok: true });

    await setModules(settings, { notices: 'on' });                          // back on: the stored notice is still there
    expect(await svc.list(ADMIN)).toEqual(before);
    expect(await modulesOf(settings)).toBe(modsOn);
  });
});

// ---------- OFF-routes (client) ----------
const PAGE_MODULE_LINE = (HTML.match(/^const PAGE_MODULE = (\{[^\n]*\});$/m) ?? [])[1] ?? '';

// Runs the real render() with the real PAGE_MODULE literal and the Prayers/Notices guards; returns the go() calls.
async function renderGo(page: string, modules: Record<string, unknown>) {
  const went: string[] = [];
  const NOOP: any = new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? undefined : NOOP), apply: () => '' });
  const env: Record<string, any> = {
    S: { user: { role: 'admin' }, page, settings: { ministryConfig: { modules } } }, PAGE_MODULE: new Function(`return ${PAGE_MODULE_LINE || '{}'}`)(),
    _shellReady: true, go: (p: string) => went.push(p),
  };
  const scope = new Proxy(env, {
    has: (_t, k) => typeof k === 'string' && !k.startsWith('__') && !(k in globalThis),
    get: (t, k) => (k === Symbol.unscopables ? undefined : k in t ? t[k as string] : NOOP),
  });
  // eslint-disable-next-line no-new-func
  await new Function('__env', `with (__env) { ${['_modOn', '_prayersOn', '_noticesOn', 'render'].map((n) => extractFn(HTML, n)).join('\n')}\n return render(); }`)(scope);
  return went;
}
describe('OFF-routes (client): the page dispatcher sends an off page Home', () => {
  it('declares the Prayers and Notices pages in PAGE_MODULE', () => {
    expect(PAGE_MODULE_LINE).toContain("prayers: 'prayers'");
    expect(PAGE_MODULE_LINE).toContain("notices: 'notices'");
  });
  it('prayers and notices go Home when off, and stay when on', async () => {
    expect(await renderGo('prayers', { prayers: false, notices: 'off' })).toEqual(['home']);
    expect(await renderGo('notices', { prayers: true, notices: 'off' })).toEqual(['home']);
    expect(await renderGo('prayers', { prayers: true, notices: 'on' })).toEqual([]);
    expect(await renderGo('notices', { prayers: true, notices: 'on' })).toEqual([]);
  });
});

describe('OFF-routes (client): a refused /prayers or /notices call never names the module', () => {
  // Runs the real helper. The settings refresh it triggers is a counter, so the test sees whether the page was left.
  const hit = (path: string, msg: string) => {
    (globalThis as any).__refresh = 0;
    const { _moduleOffHit } = loadFns(['_moduleOffHit'],
      'var S = { user: { role: "admin" } };\nvar _moduleDisabledRefresh = () => { globalThis.__refresh++; };');
    const err: any = new Error(msg);
    _moduleOffHit(path, err);
    return { message: err.message as string, refreshed: (globalThis as any).__refresh as number };
  };
  it('a /prayers refusal is plain words and refreshes settings', () => {
    const r = hit('/prayers', 'Prayers is disabled for this deployment');
    expect(r.message).not.toMatch(/prayer|disabled/i);
    expect(r.refreshed).toBe(1);
  });
  it('a /notices refusal is plain words and refreshes settings', () => {
    const r = hit('/notices/push', 'Notices is disabled for this deployment');
    expect(r.message).not.toMatch(/notice|disabled/i);
    expect(r.refreshed).toBe(1);
  });
  it('any other path keeps its own message and does not refresh', () => {
    const r = hit('/bus/run', 'Bus Ministry is disabled for this deployment');
    expect(r.message).toBe('Bus Ministry is disabled for this deployment');
    expect(r.refreshed).toBe(0);
  });
});
