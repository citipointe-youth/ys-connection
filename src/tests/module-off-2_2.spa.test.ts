// Modular-setup Task 2.2 (YS half): Bus (busMinistry) and the Public consent form (busConsentForm) switch off cleanly.
// OFF-nav, OFF-api, OFF-routes (client guard), BACK-ON, ON. The console half is a separate lane.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, loadFns } from './helpers/extract-fn';
import { navWithModules, expectSubtraction } from './helpers/module-off';
import { setup } from './helpers/bus-setup';
import { makeBusService } from '../services/bus.service';
import { makeNewYouthService } from '../services/new-youth.service';
import { ingestBusConsentForms } from '../services/bus-consent';
import { InMemoryLinkRepository } from '../repositories/in-memory/link.repository';
import { InMemorySettingsRepository } from '../repositories/in-memory';
import { MINISTRY_CONFIG_DEFAULTS, MinistryConfigSchema, mergeMinistryConfig } from '../core/ministry-config';
import { ModuleDisabledError } from '../core/errors/app-error';
import type { BusConsentForm } from '../core/entities/bus';
import owners from './fixtures/module-owners.json';
import LIVE_MODULES from './fixtures/live-modules.json';

const ROLES = ['admin', 'director', 'grade', 'quad', 'leader'];
const HTML = loadIndexHtml();

const form = (over: Partial<BusConsentForm> = {}): BusConsentForm => ({ id: 'f1', submissionId: 'b5c10000-0000-4000-8000-000000000001', childIndex: 0,
  submittedAt: '2026-10-05T01:00:00.000Z', year: 2026, studentId: 's1', guestId: null, first: 'Jess', last: 'Tran', source: 'public', createdAt: '2026-10-05T01:05:00.000Z',
  data: { grade: 9, gender: 'female', mobile: '0400000001', school: 'Example High', address: { line1: '1 Test St', line2: '-', postcode: '4000', city: 'Brisbane City', state: 'QLD' },
    parentName: 'Alex Tran', parentPhone: '0400000003', pickup: true, pickupBy: '', filedBy: null }, ...over });

async function mk() {
  const t = await setup();
  const link = new InMemoryLinkRepository();
  const newYouth = { sendBusConsent: async () => ({ result: 'sent' as const, dropoff: null }) };
  const svc = makeBusService(t.bus, t.students, t.leaders, t.settings, undefined, t.connections, undefined, { link, newYouth });
  const set = async (modules: Record<string, unknown>) => {
    const c = (await t.settings.getSettings()).ministryConfig;
    await t.settings.updateSettings({ ministryConfig: mergeMinistryConfig(c, { modules }) });
  };
  await set({ busMinistry: true, busConsentForm: true, liveLink: true }); // the default config resolves the consent form off while Bus is off
  await t.bus.upsertConsentForms([form()]);
  await t.svc.addRider(t.ctx('admin'), { studentId: 's1', newAddress: { label: 'Home', address: '1 Test St, Brisbane City QLD 4000, Australia', placeId: 'fake:1' } });
  return { ...t, svc, set };
}
const CONSENT_CALLS = (t: Awaited<ReturnType<typeof mk>>) => [
  () => t.svc.consentStatus(t.ctx('admin')), () => t.svc.consentCheck(t.ctx('admin')), () => t.svc.consentForms(t.ctx('admin')),
  () => t.svc.consentPrefill(t.ctx('admin'), { studentId: 's1' }), () => t.svc.consentSubmit(t.ctx('admin'), { studentId: 's1', readOut: true }),
];

describe('OFF-nav', () => {
  it.each(ROLES)('Bus off removes exactly the Bus entries for %s', (role) => {
    expectSubtraction(navWithModules(role), navWithModules(role, { busMinistry: false }), owners.busMinistry);
  });
  it.each(ROLES)('Public consent form off changes no nav entry for %s', (role) => {
    expect(navWithModules(role, { busConsentForm: false })).toEqual(navWithModules(role));
  });
  it('the owned ids are recorded', () => {
    expect(owners.busMinistry).toEqual(['bus']);
    expect(owners.busConsentForm).toEqual(['forms']);
  });
});

describe('OFF-api', () => {
  it('Public consent form off: every consent entry point throws ModuleDisabledError; Bus itself still answers', async () => {
    const t = await mk();
    await t.set({ busConsentForm: false });
    for (const call of CONSENT_CALLS(t)) await expect(call()).rejects.toThrow(ModuleDisabledError);
    const run = await t.svc.getRun(t.ctx('admin'));
    expect(run.riders).toHaveLength(1);
    expect(run.riders[0]!.consent).toEqual({ year: 0, current: false }); // no chip, no details, no parent phone
  });
  it('Bus off: the consent entry points throw too (busConsentForm reads off with Bus)', async () => {
    const t = await mk();
    await t.set({ busMinistry: false });
    for (const call of CONSENT_CALLS(t)) await expect(call()).rejects.toThrow(ModuleDisabledError);
    await expect(t.svc.getRun(t.ctx('admin'))).rejects.toThrow(ModuleDisabledError);
  });
  // s2 has a consent form of their own (f2), so the pick is valid and only the module can refuse it.
  const pick = (t: Awaited<ReturnType<typeof mk>>) => t.svc.addRider(t.ctx('admin'), { studentId: 's2', consentFormId: 'f2' });
  const withS2Form = async () => {
    const t = await mk();
    await t.bus.upsertConsentForms([form({ id: 'f2', submissionId: 'b5c10000-0000-4000-8000-000000000002', studentId: 's2', first: 'Sam', last: 'Ode' })]);
    return t;
  };
  it('Public consent form off: a consent-form address pick is refused with ModuleDisabledError', async () => {
    const t = await withS2Form();
    await t.set({ busConsentForm: false });
    await expect(pick(t)).rejects.toThrow(ModuleDisabledError);
  });
  it('Public consent form on: the same pick adds the rider at the form address', async () => {
    const t = await withS2Form();
    const r = await pick(t);
    expect(r).toMatchObject({ studentId: 's2' });
  });
  it('Public consent form off: the new-person service refuses to send the bus form', async () => {
    const repo = new InMemorySettingsRepository();
    await repo.init();
    await repo.updateSettings({ ministryConfig: mergeMinistryConfig(MINISTRY_CONFIG_DEFAULTS, { modules: { busMinistry: true, busConsentForm: false } }) });
    const ny = makeNewYouthService(repo, { live: true });
    const leader = { id: 'a-leader', role: 'leader' as any, displayName: 'L', grade: null as any, quad: null as any };
    await expect(ny.sendBusConsent(leader, {})).rejects.toThrow(ModuleDisabledError);
  });
  it('Public consent form off: a console push of forms is not applied and stores nothing', async () => {
    const t = await mk();
    await t.set({ busConsentForm: false });
    const before = await t.bus.listConsentForms();
    const r = await ingestBusConsentForms(t, { checkedAt: '2026-10-23T04:00:00.000Z', rows: [{ ...form(), submissionId: 'b5c10000-0000-4000-8000-0000000000bb', pickup: true, pickupBy: '',
      parentName: 'X', parentPhone: '0400000003', address: form().data.address, school: '', mobile: '', grade: 9, gender: 'female' }] } as any, new Date('2026-10-23T04:00:30Z'));
    expect(r).toEqual({ applied: false, rows: 0, new: 0, unmatched: 0 });
    expect(await t.bus.listConsentForms()).toEqual(before);
  });
});

describe('OFF-routes (client)', () => {
  it('PAGE_MODULE sends the Bus page Home when Bus is off', () => {
    expect(HTML).toMatch(/^const PAGE_MODULE = \{[^}]*\bbus: 'busMinistry'[^}]*\};\r?$/m);
  });
  const chip = (modules: Record<string, unknown>, role = 'admin') => {
    const F = loadFns(['_modOn', 'esc', '_busConsentChip', '_busPickupChip', '_busConsentHintHtml', '_busConsentStatusHtml'],
      `var S = ${JSON.stringify({ user: { role }, settings: { ministryConfig: { modules } } })}; const icS = (k) => '<i ' + k + '>'; const fmtDay = (v) => String(v).slice(0, 10);`,
      ['_busConsentChip', '_busConsentHintHtml', '_busConsentStatusHtml']);
    const row = { id: 'r1', consent: { year: 2026, current: false, differs: true, details: { formId: 'f1' } } };
    return { chip: F._busConsentChip(row, true), hint: F._busConsentHintHtml(row), strip: F._busConsentStatusHtml({ canCheck: true, lastChecked: '', lastNew: 0 }) };
  };
  it('consent chips, differs hint and the Check strip hide with the Public consent form, and show when it is on', () => {
    const off = chip({ busMinistry: true, busConsentForm: false });
    expect(off).toEqual({ chip: '', hint: '', strip: '' });
    const on = chip({ busMinistry: true, busConsentForm: true });
    expect(on.chip).toContain('No consent 2026');
    expect(on.hint).toContain('Consent address differs');
    expect(on.strip).toContain('Check for new consent forms');
  });
  it('the Forms tab button, the Consent form buttons and the declaration field are behind busConsentForm', () => {
    expect(HTML).toMatch(/const seesForms = \(isAdmin \|\| !!v\.canCoordinate\) && _modOn\('busConsentForm'\)/);
    expect(HTML.match(/_modOn\('busConsentForm'\) \? `<button type="button" class="btn btn-secondary btn-sm" onclick="busConsent/g)).toHaveLength(2);
    expect(HTML).toContain(`<div \${_modOn('busConsentForm') ? '' : 'hidden'}><label class="fl" for="bus-decl">`); // hidden, not removed: a save keeps the stored declaration
    expect(HTML).toMatch(/_modOn\('busConsentForm'\) \? `<div class="fg"><label class="fl" for="setup-elv-bus">/);
    expect(HTML).toMatch(/async function busConsentForm\(who, keep\) \{\r?\n  if \(!_modOn\('busConsentForm'\)\) return;/);
  });
});

describe('BACK-ON', () => {
  it('turning the Public consent form off and on again keeps every row and brings the chip back', async () => {
    const t = await mk();
    const rows = await t.bus.listConsentForms();
    const view = await t.svc.getRun(t.ctx('admin'));
    await t.set({ busConsentForm: false });
    await t.set({ busConsentForm: true });
    expect(await t.bus.listConsentForms()).toEqual(rows);
    expect(await t.svc.getRun(t.ctx('admin'))).toEqual(view);
    expect(view.riders[0]!.consent).toMatchObject({ year: 2026, current: true });
  });
  it('turning Bus off and on again keeps the run and its riders', async () => {
    const t = await mk();
    const view = await t.svc.getRun(t.ctx('admin'));
    await t.set({ busConsentForm: false, busMinistry: false }); // the save refuses a child left on, so the wizard turns it off first
    await t.set({ busMinistry: true });
    await t.set({ busConsentForm: true });
    expect(await t.svc.getRun(t.ctx('admin'))).toEqual(view);
  });
});

describe('ON (live states)', () => {
  it('the live module states keep Bus and the Public consent form on', () => {
    const m = MinistryConfigSchema.parse({ modules: LIVE_MODULES }).modules;
    expect([m.busMinistry, m.busConsentForm]).toEqual([true, true]);
  });
  it('on: the consent entry points answer', async () => {
    const t = await mk();
    expect(await t.svc.consentStatus(t.ctx('admin'))).toMatchObject({ year: 2026 });
    expect((await t.svc.consentForms(t.ctx('admin'))).rows).toHaveLength(1);
  });
});
