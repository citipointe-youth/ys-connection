import { describe, it, expect } from 'vitest';
import { loadFns } from './helpers/extract-fn';

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
  it('New youth & consent off warns that the plans are deleted', () => {
    const h = confirm({ modules: { intakeAdmin: 'on' } }, { modules: { intakeAdmin: 'off' } });
    expect(h).toContain('This turns New youth &amp; consent off. Its stored plans are deleted.');
  });
});
