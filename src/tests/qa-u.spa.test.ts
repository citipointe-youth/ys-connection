import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml, extractFn } from './helpers/extract-fn';

// QA 2026-11-02 lane U: the "I am" pick belongs to one login (item 10).
describe('"I am" survives the same login, not a different one', () => {
  const mk = (store: Record<string, string>) =>
    loadFns(['setMyLeaderId', '_iamNewLogin'], `
      const store = ${JSON.stringify(store)};
      const localStorage = { getItem(k) { return k in store ? store[k] : null; }, setItem(k, v) { store[k] = String(v); }, removeItem(k) { delete store[k]; } };
      const S = { user: { id: 'u1', role: 'quad' } };
      function _vgSnap() {} function _linkOn() { return false; }
      const LINK = { iamPick: 'x', ldrs: [1] };`, ['setMyLeaderId', '_iamNewLogin', 'store', 'LINK']);
  it('the same login signing in again keeps its pick', () => {
    const f = mk({});
    f.setMyLeaderId('L1');
    f._iamNewLogin('u1');
    expect(f.store.yap_leader_id).toBe('L1');
  });
  it('a different login starts with no pick and no skip clock, and no cached name lists', () => {
    const f = mk({});
    f.setMyLeaderId('L1');
    f.store.yap_iam_skip = '123';
    f._iamNewLogin('u2');
    expect(f.store.yap_leader_id).toBeUndefined();
    expect(f.store.yap_iam_skip).toBeUndefined();
    expect(f.LINK.iamPick).toBeUndefined();
    f.setMyLeaderId('L2'); // u1 is still S.user here, so the stamp is u1 again
    expect(f.store.yap_iam_login).toBe('u1');
  });
  it('a pick made before logins were recorded is kept and given to the next login', () => {
    const f = mk({ yap_leader_id: 'L9' });
    f._iamNewLogin('u1');
    expect(f.store.yap_leader_id).toBe('L9');
    expect(f.store.yap_iam_login).toBe('u1');
  });
});

// Item 2: the shared error path turns the server's validation issues into plain words that name the field.
describe('validation errors in plain words', () => {
  const f = loadFns(['_validationText', '_acctProblems'], `const _FIELD_WORDS = { displayName: 'Display name', email: 'Username', password: 'Password', grades: 'Grade' };
    function esc(s) { return s; }`);
  it('names the field and rewrites zod wording', () => {
    expect(f._validationText([
      { code: 'too_small', type: 'string', minimum: 8, path: ['password'], message: 'String must contain at least 8 character(s)' },
      { code: 'too_big', type: 'string', maximum: 12, path: ['displayName'], message: 'String must contain at most 12 character(s)' },
      { code: 'invalid_type', expected: 'integer', received: 'float', path: ['grades', 0], message: 'Expected integer, received float' },
      { code: 'invalid_type', expected: 'string', received: 'undefined', path: ['email'], message: 'Required' },
    ])).toBe('Password needs at least 8 characters. Display name is too long (12 characters at most). Grade must be a whole number. Username is required.');
  });
  it('keeps a message the server wrote itself, and says nothing for no issues', () => {
    expect(f._validationText([{ code: 'custom', path: ['email'], message: 'Username is too long (40 characters at most).' }])).toBe('Username is too long (40 characters at most).');
    expect(f._validationText([])).toBe(null);
    expect(f._validationText(undefined)).toBe(null);
  });
  it('Add Account lists every problem at once', () => {
    const ok = { displayName: 'Grade 9', email: 'grade9', password: 'longenough1', role: 'admin' };
    expect(f._acctProblems(ok)).toEqual([]);
    expect(f._acctProblems({ role: 'grade', displayName: '', email: 'a b', password: 'short', grades: [] }))
      .toEqual(['Enter a display name.', 'Username can use letters, numbers and . _ - @ + only. No spaces.', 'Password needs at least 8 characters.', 'Select at least one grade.', 'Select a gender scope.']);
    expect(f._acctProblems({ ...ok, password: '        ' })).toEqual(["Password can't be only spaces."]);
  });
});

// Item 28: the About text is built from the settings, so branding, terminology and enabled roles show through.
describe('About page', () => {
  const mk = (user: any, roles: any) => loadFns(['_aboutHtml', '_roleLabel', '_roleDesc'], `
    const S = { user: ${JSON.stringify(user)}, settings: { ministryConfig: { roles: { enabled: ${JSON.stringify(roles)} } } } };
    const _ROLE_LABEL_DEFAULTS = { admin: 'Admin', oversight: 'Oversight', leader: 'Leader', grade: 'Grade', quad: 'Junior/Senior' };
    function esc(s) { return String(s); } function appName() { return 'Test App'; } function ministryName() { return 'Test Ministry'; }
    function _gradeWord() { return 'Year'; }`);
  const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  it('uses the configured names, lists only enabled roles, and tells the admin where to look', () => {
    const t = text(mk({ role: 'quad' }, { grade: false, quad: true, oversight: true, leader: false })._aboutHtml());
    expect(t).toContain('Test App is the Test Ministry app');
    expect(t).toContain('Junior/Senior : Sees only its own Junior or Senior group (boys');
    expect(t).not.toContain('Leader : Sees only');
    expect(t).not.toContain('Grade : Sees');
    expect(t).toContain('Ask your admin');
    expect(text(mk({ role: 'admin' }, null)._aboutHtml())).toContain('You are an admin');
  });
  it('makes no policy, retention or contact claims', () => {
    expect(text(mk(null, null)._aboutHtml())).not.toMatch(/privacy|policy|retain|retention|delete[sd]? after|days|years of|legal|@|\d{4}/i);
  });
});

// QA integrate: the two gaps the lanes left, and the merged buttons that must hand their button to _once.
describe('integration: first paint, About reach, busy buttons', () => {
  const html = loadIndexHtml();
  it('the first paint says Loading, in the static HTML (MOB-15)', () => {
    expect(html).toMatch(/<div id="app">[^<]*<p[^>]*>Loading…<\/p><\/div>/);
  });
  it('the login scope sheet links to About (a grade or quad login has no More)', () => {
    expect(extractFn(html, 'showScopeInfo')).toContain('closeModal();showAbout()');
  });
  it('Add Leader and Add Account pass their button to the save guard', () => {
    expect(html).toContain('onclick="submitAddLeader(this)"');
    expect(html).toContain('onclick="submitAddUser(this)"');
  });
});
