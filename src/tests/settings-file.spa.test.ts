// Y4: the settings file never carries Elvanto or the Elvanto module modes; ship.sh reads the Vercel project name.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadFns } from './helpers/extract-fn';

const ELV_KEYS = ['newYouthForms', 'checkin', 'lifegroupReport', 'flows', 'flowHiddenStep'];
const BRIS = () => ({
  branding: { appName: 'YS Connection', primaryColor: '#123456' },
  labels: { groupNameStrip: 'Brisbane - Youth - ' },
  structure: { timeZone: 'Australia/Brisbane', consentCutoff: { day: 5, time: '12:00' } },
  elvanto: { peopleFlowPrefix: 'Brisbane - Youth - New People', newPersonFormId: 'abc' },
  modules: { prayers: true, newYouthForms: 'on', checkin: 'on', lifegroupReport: 'admin', flows: 'on', flowHiddenStep: 'Welcome' },
});
const PRELUDE = `
  let _setupDraft = null, _setupServiceMinAttendance = 100, _setupTermGapDays = 14, __out = null, TOASTS = [];
  function _downloadText(n, t) { __out = t; } function __o() { return JSON.parse(__out); }
  function _setupRerender() {} function toast(t) { TOASTS.push(t); }
  function setDraft(d) { _setupDraft = d; } function draft() { return _setupDraft; }
`;
const f = loadFns(['_stripServerOwnedLogins', '_parseSettingsFile', 'exportSettingsFile', 'loadSettingsFile'], PRELUDE,
  ['_parseSettingsFile', 'exportSettingsFile', 'loadSettingsFile', '__o', 'setDraft', 'draft', 'TOASTS']);

describe('Y4 settings file', () => {
  it('an export has no elvanto and no Elvanto module mode', () => {
    f.setDraft(BRIS());
    f.exportSettingsFile();
    const cfg = f.__o().ministryConfig;
    expect(cfg.elvanto).toBeUndefined();
    for (const k of ELV_KEYS) expect(cfg.modules, k).not.toHaveProperty(k);
    expect(cfg.modules.prayers).toBe(true);
    expect(f.draft().elvanto).toBeDefined(); // the draft itself is untouched
  });

  it('branding, groupNameStrip, timeZone and consentCutoff survive export and parse', () => {
    f.setDraft(BRIS());
    f.exportSettingsFile();
    const r = f._parseSettingsFile(JSON.stringify(f.__o()));
    expect(r.ministryConfig.branding).toEqual(BRIS().branding);
    expect(r.ministryConfig.labels.groupNameStrip).toBe('Brisbane - Youth - ');
    expect(r.ministryConfig.structure).toEqual(BRIS().structure);
  });

  it('loading an old Brisbane file keeps this draft’s module modes and elvanto', async () => {
    const mine = { elvanto: { peopleFlowPrefix: 'Sydney - Youth - New People' },
      modules: { prayers: false, newYouthForms: 'off', checkin: 'off', lifegroupReport: 'off', flows: 'off' } };
    f.setDraft(JSON.parse(JSON.stringify(mine)));
    const text = JSON.stringify({ kind: 'ys-connection-settings', version: 1, ministryConfig: BRIS() });
    f.loadSettingsFile({ value: 'x', files: [{ text: () => Promise.resolve(text) }] });
    await new Promise((r) => setTimeout(r, 0));
    const d = f.draft();
    expect(d.elvanto).toEqual(mine.elvanto);
    for (const k of ['newYouthForms', 'checkin', 'lifegroupReport', 'flows']) expect(d.modules[k], k).toBe('off');
    expect(d.modules).not.toHaveProperty('flowHiddenStep');
    expect(d.modules.prayers).toBe(true); // a non-Elvanto module still loads
    expect(d.branding.appName).toBe('YS Connection');
    expect(f.TOASTS.at(-1)).toBe('Settings loaded. Elvanto screens stay off. Set up Elvanto for this location, then turn them on.');
  });
});

describe('Y4 ship.sh project name', () => {
  const sh = readFileSync(join(__dirname, '..', '..', 'scripts', 'ship.sh'), 'utf8');
  it('the vercel ls line has no fixed project name, and the name comes from .vercel/project.json', () => {
    const ls = sh.split('\n').filter((l) => /vercel ls/.test(l));
    expect(ls.length).toBeGreaterThan(0);
    for (const l of ls) { expect(l).not.toContain('ys-connection'); expect(l).toContain('$PROJ'); }
    expect(sh).toContain(".vercel/project.json");
    expect(sh).toMatch(/projectName/);
  });
});
