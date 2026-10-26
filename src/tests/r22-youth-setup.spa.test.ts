import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml, extractFn } from './helpers/extract-fn';

// Round 2026-10-22 lane L4 (Youth Setup). Fictional data only.
describe('A1 the Save confirm names what will be switched off', () => {
  const { _setupRiskyDiff } = loadFns(['_setupRiskyDiff']);
  it('flags each role that goes from on to off, after the older keys', () => {
    expect(_setupRiskyDiff({}, { roles: { enabled: { quad: false } } })).toEqual(['roles.quad']);
    expect(_setupRiskyDiff({ roles: { enabled: { quad: true, director: true } } }, { roles: { enabled: { quad: false, director: false } } }))
      .toEqual(['roles.director', 'roles.quad']);
    expect(_setupRiskyDiff({}, { logins: { simple: true }, roles: { enabled: { leader: false } } })).toEqual(['logins.simple']);
    expect(_setupRiskyDiff({ roles: { enabled: { leader: true } } }, { roles: { enabled: { leader: false } } })).toEqual(['roles.leader']);
  });
  it('Grade off is not flagged when the draft turns Junior/Senior on (that line says they come back)', () => {
    expect(_setupRiskyDiff({}, { logins: { simple: true }, roles: { enabled: { grade: false } } })).toEqual(['logins.simple']);
    expect(_setupRiskyDiff({ logins: { simple: true } }, { logins: { simple: true }, roles: { enabled: { grade: false } } })).toEqual([]);
    expect(_setupRiskyDiff({}, { roles: { enabled: { grade: false } } })).toEqual(['roles.grade']);
  });
  it('a role turned on, or unchanged, adds nothing', () => {
    expect(_setupRiskyDiff({ roles: { enabled: { quad: false } } }, { roles: { enabled: { quad: true } } })).toEqual([]);
    expect(_setupRiskyDiff({ roles: { enabled: { quad: false } } }, { roles: { enabled: { quad: false } } })).toEqual([]);
    expect(_setupRiskyDiff({}, { roles: { enabled: { director: true, grade: true, quad: true, leader: false } } })).toEqual([]);
  });
  it('flags New youth & consent going from on to off only', () => {
    expect(_setupRiskyDiff({ modules: { intakeAdmin: 'on' } }, { modules: { intakeAdmin: 'off' } })).toEqual(['modules.intakeAdmin']);
    expect(_setupRiskyDiff({ modules: { intakeAdmin: 'off' } }, { modules: { intakeAdmin: 'on' } })).toEqual([]);
    expect(_setupRiskyDiff({ modules: { intakeAdmin: 'on' } }, { modules: { intakeAdmin: 'on' } })).toEqual([]);
  });

  const confirm = (saved: object, draft: object) => {
    const f = loadFns(['_setupRiskyDiff', 'confirmSaveMinistrySetup'], `
      let _adminData = { settings: { ministryConfig: ${JSON.stringify(saved)} }, users: [
        { role: 'quad', status: 'active' }, { role: 'quad', status: 'active' }, { role: 'quad', status: 'active' }, { role: 'quad', status: 'active' },
        { role: 'quad', status: 'inactive' }, { role: 'director', status: 'active' }, { role: 'leader', status: 'active' }] };
      let _setupDraft = ${JSON.stringify(draft)};
      let html = ''; function modal(h) { html = h; } function __h() { return html; }`, ['confirmSaveMinistrySetup', '__h']);
    f.confirmSaveMinistrySetup();
    return f.__h() as string;
  };
  it('Simple cohort: names the Quad and Director logins and their counts', () => {
    const h = confirm({}, { structure: { cohortModel: 'none' }, roles: { enabled: { director: false, quad: false } } });
    expect(h).toContain('This switches off 1 Director login and 4 Quad logins. Turning the role back on does not switch them back on.');
  });
  it('a role with no active logins adds no line', () => {
    const h = confirm({ roles: { enabled: { grade: true } } }, { roles: { enabled: { grade: false } } });
    expect(h).not.toContain('This switches off');
  });
  it('New youth & consent off warns that the plans are deleted (modular setup wording), and Save sends the confirm', () => {
    const h = confirm({ modules: { intakeAdmin: 'on' } }, { modules: { intakeAdmin: 'off' } });
    expect(h).toContain('Turning Intakes off deletes waiting intake rows.');
    expect(h).toContain('saveMinistrySetup(true)');
    expect(confirm({}, {})).toContain('saveMinistrySetup(false)');
  });
  it('MC8: a save the server refuses with INTAKE_OFF_CONFIRM asks, then resends with the flag', () => {
    const html = loadIndexHtml();
    const save = extractFn(html, 'saveMinistrySetup');
    expect(save).toContain("...(confirmIntakeOff ? { confirmIntakeOff: true } : {})");
    expect(save).toContain("if (e.code === 'INTAKE_OFF_CONFIRM') _setupIntakeOffConfirm(); else toast(e.message);");
    const ask = extractFn(html, '_setupIntakeOffConfirm');
    expect(ask).toContain('Turning Intakes off deletes waiting intake rows.');
    expect(ask).toContain('saveMinistrySetup(true)');
  });
  it('MC8: turning New person form or Live Elvanto link off with Intakes on shows the warning too', () => {
    const saved = { modules: { newYouthForms: 'on', intakeAdmin: 'on', liveLink: true } };
    expect(_setupRiskyDiff(saved, { modules: { newYouthForms: 'off', intakeAdmin: 'on' } })).toEqual(['modules.intakeAdmin']);
    expect(_setupRiskyDiff(saved, { modules: { newYouthForms: 'on', intakeAdmin: 'on', liveLink: false } })).toEqual(['modules.intakeAdmin']);
    expect(_setupRiskyDiff(saved, saved)).toEqual([]);
    const h = confirm(saved, { modules: { newYouthForms: 'off', intakeAdmin: 'on' } });
    expect(h).toContain('Turning Intakes off deletes waiting intake rows.');
    expect(h).toContain('saveMinistrySetup(true)');
  });
});

describe('B8-B12 and B9 Youth Setup layout', () => {
  const html = loadIndexHtml();
  const body = extractFn(html, '_youthSetupBody');
  const structure = body.slice(body.indexOf("_setupCard('structure'"), body.indexOf("_setupCard('branding'"));
  it('the card titles are unchanged (error-log paths use them); Review is gone', () => {
    expect([...body.matchAll(/_setupCard\('(\w+)', '([^']+)'/g)].map((m) => m[2])).toEqual(
      ['Structure & Roles', 'Branding', 'Terminology', 'Modules & Import', 'Elvanto for this location', 'Use this setup at another location']);
  });
  it('B8: no Review card and no JSON dump of the draft', () => {
    expect(body).not.toContain("_setupCard('review'");
    expect(body).not.toContain('JSON.stringify(cfg');
  });
  it('B10: Apply account layout is drawn only when the accounts do not match, as one warn alert', () => {
    expect(body).not.toContain('already aligned');
    expect(body).not.toContain('SAVED Cohort');
    expect(body).toMatch(/aligned \? '' : `<div class="alert al-warn"[^`]*Accounts don't match the saved layout\.[^`]*previewCohortLayout\(/);
  });
  it('B11: preview shows the draft logo; Reset to defaults is gone', () => {
    expect(html).not.toContain('Reset to defaults');
    expect(html).not.toContain('_setupResetBranding');
    expect(body).not.toContain('only shows up here after you save');
    expect(body).toMatch(/bv\('logoImage'\) \? `<img src="\$\{esc\(bv\('logoImage'\)\)\}"[^`]*` : brandMark\(24, '#fff'\)/);
  });
  it('B12: Date order, Leader name tag, Export guides and the deploy-guide button are off the screen', () => {
    for (const s of ['import.dateOrder', 'import.leaderTag', 'modules.exportGuides', 'Open the deploy guide', 'DEPLOYING.md', 'follow the deploy guide']) expect(body).not.toContain(s);
    const elv = extractFn(html, '_setupElvCardHtml');
    expect(elv).toContain("text('state', 'State for new addresses (e.g. QLD)')");
    expect(elv).not.toContain('Default state');
    expect(elv).toContain("text('locationQuestion', 'Location question on the form')");
  });
  it('B12: the Admin only selects are untouched', () => {
    expect(extractFn(html, '_setupElvantoModulesHtml')).toContain("[['off', 'Off'], ['admin', 'Admin only'], ['on', 'On']]");
    expect(body).toContain('${_setupElvantoModulesHtml(md)}');
  });
  it('B9: presets are a "Start from" row inside Structure & Roles, with sub-headings', () => {
    expect(body).not.toContain('Pre-set Configurations');
    expect(structure).toContain('Start from');
    expect(structure).toContain('pickMinistryPreset(');
    const iRoles = structure.indexOf('>Roles</div>'), iSvc = structure.indexOf('>Service and attendance</div>');
    expect(iRoles).toBeGreaterThan(0);
    expect(iSvc).toBeGreaterThan(iRoles);
    expect(structure.indexOf('Service day')).toBeGreaterThan(iSvc);
    expect(structure.indexOf('Min attendance')).toBeGreaterThan(iSvc);
    expect(structure).not.toContain('>Attendance</div>');
    expect(structure).toContain('Admin is always on. Turning a role off switches off its logins when you save.');
  });
  it('B9: each preset has one short line, and no developer talk is left', () => {
    const info = new Function(/const MINISTRY_PRESETS_INFO = (\[[\s\S]*?\n\]);/.exec(html)![1]!.replace(/^/, 'return '))();
    expect(info.map((p: { id: string }) => p.id)).toEqual(['large-graded-au']); // B1: one preset
    for (const p of info) expect(p.desc.length).toBeLessThan(80);
    for (const s of ['unchanged — the default', '(the current setup)']) expect(html).not.toContain(s);
  });
});
