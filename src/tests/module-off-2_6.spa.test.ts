// Modular-setup Task 2.6 (YS): Connection Audit follows modules.connectionAudit everywhere on this side.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';
import { navWithModules, expectSubtraction } from './helpers/module-off';
import OWNERS from './fixtures/module-owners.json';
import { makeConnectionAuditService } from '../services/connection-audit.service';
import { makeErrorLogService } from '../services/error-log.service';
import { MinistryConfigSchema } from '../core/ministry-config';
import { InMemoryConnectionAuditRepository, InMemorySettingsRepository, InMemoryLinkRepository, InMemoryErrorLogRepository } from '../repositories/in-memory';
import { ModuleDisabledError } from '../core/errors/app-error';
import type { AuditPushBody } from '../core/link-contract';
import type { Actor } from '../core/entities/user';

const OWNED_PAGES = ['ca-week', 'ca-follow', 'ca-term', 'ca-quality'];
const ROLES = ['admin', 'oversight', 'grade', 'quad', 'leader'];

describe('2.6 OFF-nav: the Connection Audit nav item', () => {
  it.each(ROLES)('%s: off removes exactly ca-week (admin and oversight had it)', (role) => {
    const base = navWithModules(role);
    const off = navWithModules(role, { connectionAudit: false });
    if (role === 'admin' || role === 'oversight') expectSubtraction(base, off, ['ca-week']);
    else expect(off).toEqual(base);
  });
  it('resolved off (Flows, Lifegroups or New person form off) hides it too', () => {
    for (const patch of [{ flows: 'off' }, { lifegroupReport: 'off' }, { newYouthForms: 'off' }]) {
      expect(Object.values(navWithModules('admin', patch)).flat(), JSON.stringify(patch)).not.toContain('ca-week');
    }
  });
  it('ON: the live states still show it', () => {
    expect(navWithModules('admin').nav).toContain('ca-week');
  });
});

describe('2.6 OFF-routes: the client page guard', () => {
  const pageModule = new Function(`return ${loadIndexHtml().match(/^const PAGE_MODULE = (\{.*\});/m)![1]}`)() as Record<string, string>;
  // Runs the real render() with the real PAGE_MODULE; every other name is stubbed. Returns the go() calls and CA.render calls.
  const run = async (page: string, modules: Record<string, unknown>) => {
    const went: string[] = [];
    const NOOP: any = new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? undefined : NOOP), apply: () => '' });
    const env: Record<string, any> = {
      window: { CA: true }, S: { user: { role: 'admin' }, page, settings: { ministryConfig: { modules } } }, PAGE_MODULE: pageModule, _shellReady: true, go: (p: string) => went.push(p),
      CA: { render: async (p: string) => { went.push(`CA:${p}`); } },
    };
    const scope = new Proxy(env, {
      has: (t, k) => k in t || (typeof k === 'string' && !k.startsWith('__') && !(k in globalThis)),
      get: (t, k) => (k === Symbol.unscopables ? undefined : k in t ? t[k as string] : NOOP),
    });
    const html = loadIndexHtml();
    await new Function('__env', `with (__env) { ${extractFn(html, '_modOn')}\n${extractFn(html, 'render')}\n return render(); }`)(scope);
    return went;
  };
  it('the map names the four Connection Audit pages and the owners file agrees', () => {
    expect(Object.keys(pageModule).filter((p) => pageModule[p] === 'connectionAudit').sort()).toEqual([...OWNED_PAGES].sort());
    expect([...(OWNERS as any).connectionAudit].sort()).toEqual([...OWNED_PAGES].sort());
  });
  it.each(OWNED_PAGES)('%s: off goes Home and never reaches the Audit screen; on opens it', async (p) => {
    expect(await run(p, { connectionAudit: false })).toEqual(['home']);
    expect(await run(p, { connectionAudit: true })).toEqual([`CA:${p}`]);
  });
});

// ---- service side: OFF-api, alerts, BACK-ON ----
const FIX = join(__dirname, 'fixtures/elvanto-link');
const SVC: Extract<AuditPushBody, { status: 'ok' }> = JSON.parse(readFileSync(join(FIX, 'push-audit-service.json'), 'utf8'));
const GRP: Extract<AuditPushBody, { status: 'ok' }> = JSON.parse(readFileSync(join(FIX, 'push-audit-group.json'), 'utf8'));
const NOW = new Date(Date.parse(SVC.exportedAt) + 3_600_000);
const DAY = 86_400_000;
const YEAR = Number(SVC.exportedAt.slice(0, 4));
const ADMIN = { id: 'u-admin', role: 'admin', displayName: 'T', grade: null, quad: null } as unknown as Actor;
const failedGroup = (mins = 0): AuditPushBody =>
  ({ contractVersion: 1, consoleId: SVC.consoleId, takenAt: new Date(Date.parse(GRP.takenAt) + mins * 60_000).toISOString(), exportedAt: SVC.exportedAt, source: 'group', status: 'failed', reason: 'read' }) as AuditPushBody;

async function harness() {
  const repo = new InMemoryConnectionAuditRepository(); await repo.init();
  const settings = new InMemorySettingsRepository(); await settings.init();
  await settings.updateSettings({ serviceMinAttendance: 1, ministryConfig: MinistryConfigSchema.parse({ modules: { newYouthForms: 'on' } }) });
  const errRepo = new InMemoryErrorLogRepository();
  let t = NOW;
  const svc = makeConnectionAuditService(repo, settings, { link: new InMemoryLinkRepository(), errorLog: makeErrorLogService({ repo: errRepo, now: () => t }), now: () => t, consentRows: async () => [] });
  const setCa = async (on: boolean) => {
    const c = await settings.getSettings();
    await settings.updateSettings({ ministryConfig: { ...c.ministryConfig, modules: { ...c.ministryConfig.modules, connectionAudit: on } } });
  };
  return { svc, repo, settings, setCa, setNow: (d: Date) => { t = d; }, errs: async () => Object.fromEntries((await errRepo.list()).map((x) => [`${x.code}:${x.route}`, x.count])) };
}

describe('2.6 OFF-api and alerts', () => {
  it('every owned entry point throws ModuleDisabledError when off', async () => {
    const h = await harness(); await h.setCa(false);
    await expect(h.svc.uploadSource(ADMIN, 'service', { headers: SVC.headers, rows: SVC.rows, exportedAt: SVC.exportedAt })).rejects.toThrow(ModuleDisabledError);
    await expect(h.svc.list(ADMIN)).rejects.toThrow(ModuleDisabledError);
    await expect(h.svc.get(ADMIN, YEAR)).rejects.toThrow(ModuleDisabledError);
    await expect(h.svc.remove(ADMIN, YEAR)).rejects.toThrow(ModuleDisabledError);
    await expect(h.svc.exportAll(ADMIN)).rejects.toThrow(ModuleDisabledError);
    await expect(h.svc.importAll(ADMIN, [])).rejects.toThrow(ModuleDisabledError);
  });
  it('resolved off (Flows off) refuses too', async () => {
    const h = await harness();
    await h.settings.updateSettings({ ministryConfig: MinistryConfigSchema.parse({ modules: { newYouthForms: 'on', flows: 'off' } }) });
    await expect(h.svc.list(ADMIN)).rejects.toThrow(ModuleDisabledError);
  });
  it('checkFeed: a stale alert is cleared and not raised while off, and returns when turned on again (BACK-ON)', async () => {
    const h = await harness();
    await h.svc.ingest(SVC, 'console');
    h.setNow(new Date(NOW.getTime() + 9 * DAY));
    await h.svc.checkFeed();
    expect((await h.errs())['audit-feed-stale:']).toBe(1);
    await h.setCa(false);
    await h.svc.checkFeed();
    expect((await h.errs())['audit-feed-stale:']).toBeUndefined();
    await h.setCa(true);
    await h.svc.checkFeed();
    expect((await h.errs())['audit-feed-stale:']).toBe(1);
  });
  it('a console push while off is stored but raises no alert naming Connection Audit', async () => {
    const h = await harness(); await h.setCa(false);
    expect((await h.svc.ingest(SVC, 'console')).status).toBe('stored');
    expect((await h.svc.ingest(failedGroup(), 'console')).status).toBe('failed-recorded');
    expect(Object.keys(await h.errs()).filter((k) => k.startsWith('audit-'))).toEqual([]);
    await h.setCa(true);                                   // BACK-ON: the alert works again for the next failed push
    await h.svc.ingest(failedGroup(1), 'console');
    expect((await h.errs())['audit-source-failed:group']).toBe(1);
  });
  it('BACK-ON: the stored audit and the config are unchanged after an off and on round trip', async () => {
    const h = await harness();
    await h.svc.ingest(SVC, 'console');
    const before = JSON.stringify(await h.repo.findByYear(YEAR)), cfg = JSON.stringify((await h.settings.getSettings()).ministryConfig);
    await h.setCa(false); await h.svc.checkFeed(); await h.setCa(true);
    expect(JSON.stringify(await h.repo.findByYear(YEAR))).toBe(before);
    expect(JSON.stringify((await h.settings.getSettings()).ministryConfig)).toBe(cfg);
    expect((await h.svc.list(ADMIN)).length).toBe(1);
  });
});
