import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadIndexHtml, extractFn, loadFns } from './helpers/extract-fn';
import { QUADS, QUAD_USERNAMES, quadLabelFor } from '../core/types/enums';

const html = loadIndexHtml();

describe('T4 "Who are you?" on quad login', () => {
  it('doLogin offers the prompt after a successful login', () => {
    const body = extractFn(html, 'doLogin');
    expect(body).toContain('_quadIamPrompt');
    expect(body.indexOf('S.user = res.user')).toBeLessThan(body.indexOf('_quadIamPrompt'));
  });
  it('the setup-admin path does not call it (admin is never a quad)', () => {
    expect(extractFn(html, 'submitCreateAdmin')).not.toContain('_quadIamPrompt');
  });
  it('doLogout keeps the "I am" pick (yap_leader_id persists across logout)', () => {
    expect(extractFn(html, 'doLogout')).not.toMatch(/removeItem\('yap_leader_id'\)|setMyLeaderId\(/);
  });
});

describe('migration 0025 (quad rename keyed on users.quad)', () => {
  const sql = readFileSync(join(__dirname, '..', '..', 'supabase', 'migrations', '0025_rename_quad_accounts_by_quad.sql'), 'utf8');
  it('maps every quad to its new login and display name, keyed on users.quad not the old username', () => {
    for (const q of QUADS) expect(sql).toContain(`('${q}','${QUAD_USERNAMES[q]}','${quadLabelFor(q, true)}')`);
    expect(sql).toMatch(/u\.quad\s*=\s*m\.quad/);
    expect(sql).not.toMatch(/lower\(u\.email\)\s*=\s*m\.old/);
    expect(sql).not.toMatch(/password_hash/);
  });
});

describe('Junior/Senior Home grade buttons', () => {
  const mk = (saved: string | null, vg: number[] | null, user: any = { id: 'q1', role: 'quad', quad: 'g79' }) =>
    loadFns(['_homeGradeKey', '_homeGrade', '_homeViewUser', '_homeGradeBar'], `
      const S = { user: ${JSON.stringify(user)} };
      const store = ${JSON.stringify(saved == null ? {} : { 'yap_home_grade.q1': saved })};
      const localStorage = { getItem(k) { return k in store ? store[k] : null; } };
      function quadGrades(q) { return q === 'g79' ? [7, 8, 9] : [10, 11, 12]; }
      function quadGender(q) { return q[0] === 'g' ? 'female' : 'male'; }
      function _vgGrades() { return ${JSON.stringify(vg)}; }`);
  it('default: All, unless the "I am" filter is exactly one grade', () => {
    expect(mk(null, null)._homeGrade()).toBe(null);
    expect(mk(null, [7, 8])._homeGrade()).toBe(null);
    expect(mk(null, [8])._homeGrade()).toBe(8);
  });
  it('the saved pick wins; a grade outside the bracket is ignored', () => {
    expect(mk('all', [8])._homeGrade()).toBe(null);
    expect(mk('9', null)._homeGrade()).toBe(9);
    expect(mk('11', [8])._homeGrade()).toBe(8);
  });
  it('only quad logins get it', () => {
    expect(mk('8', [8], { id: 'q1', role: 'grade', grade: 8 })._homeGrade()).toBe(null);
  });
  it('a grade draws the grade-N login of the quad gender; All draws the quad', () => {
    const f = mk(null, null);
    const u = { id: 'q1', role: 'quad', quad: 'b1012' };
    expect(f._homeViewUser(u, null)).toBe(u);
    expect(f._homeViewUser(u, 11)).toMatchObject({ role: 'grade', grade: 11, grades: [11], gender: 'male', quad: 'b1012' });
  });
  it('the bar lists All then the bracket, from quadGrades', () => {
    const h = mk(null, null, { id: 'q1', role: 'quad', quad: 'b1012' })._homeGradeBar(11);
    expect([...h.matchAll(/>(All|\d+)<\/button>/g)].map((m) => m[1])).toEqual(['All', '10', '11', '12']);
    expect(h).toContain('class="fc on" aria-pressed="true" onclick="_setHomeGrade(11)"');
  });
  it('Home renders from the view user and puts the bar under the hero', () => {
    const body = extractFn(html, '_renderHomeInner');
    expect(body).toContain('const u = _homeViewUser(qu, _hg)');
    expect(body).toContain('quickActionItems(u)');
    expect(body.indexOf('_homeGradeBar(_hg)')).toBeLessThan(body.indexOf('_busHomeTile()'));
  });
});

describe('R5 leader switch / login snaps the grade filter to the leader\'s own grades', () => {
  const mk = (stale: any, local: any = {}) => {
    const calls: string[] = ((globalThis as any).__calls = []);
    const f = loadFns(['getMyLeaderId', '_vgActive', 'setMyLeaderId', '_vgSnap', '_vgLeader', '_vgGrades', '_vgSave'], `
      const store = { yap_leader_id: 'old' };
      const localStorage = { getItem(k) { return store[k] ?? null; }, setItem(k, v) { store[k] = v; }, removeItem(k) { delete store[k]; } };
      const S = { user: { role: 'quad', quad: 'g79' } };
      const _previewStash = null;
      let _vgLocal = ${JSON.stringify(local)};
      const Cache = { getStale() { return ${JSON.stringify(stale)}; } };
      const calls = globalThis.__calls; const API = { patch(u, b) { calls.push(u + JSON.stringify(b)); return Promise.resolve(); }, get() { calls.push('GET'); return Promise.resolve([]); } };
      function _linkOn() { return false; } function _vgRepaint() {} function toast() {}
      function quadGrades() { return [7, 8, 9]; }`, ['setMyLeaderId', '_vgGrades', '_vgSnap']);
    return { f, calls };
  };
  it('switching "I am" clears a remembered viewGrades and uses the leader\'s grades', () => {
    const { f, calls } = mk([{ id: 'y8', grades: [8], viewGrades: [7, 8, 9] }]);
    f.setMyLeaderId('y8');
    expect(f._vgGrades()).toEqual([8]);
    expect(calls.some((c) => c.startsWith('/leaders/y8/view-grades'))).toBe(true);
  });
  it('cold /leaders cache: no filter and a fetch, not a silent full-bracket fallback', () => {
    const { f, calls } = mk(null, { y8: null });
    expect(f._vgGrades()).toBe(null);
    expect(calls).toContain('GET');
  });
  it('doLogin snaps after S.user is set', () => {
    const body = extractFn(html, 'doLogin');
    expect(body.indexOf('S.user = res.user')).toBeLessThan(body.indexOf('_vgSnap()'));
  });
});
