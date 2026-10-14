import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml, extractFn } from './helpers/extract-fn';

const mk = (cached: any) => loadFns(['_inactiveLeadersHtml'], `
  let _inactiveLdrsLoading = false; const gets = [];
  const S = { page: 'leaders' };
  const Cache = { getStale(p) { return p === '/leaders?inactive=1' ? ${JSON.stringify(cached)} : null; } };
  const API = { get(p) { gets.push(p); return new Promise(() => {}); } };
  function esc(s) { return String(s).replace(/</g, '&lt;'); } function icS() { return ''; } function renderConnectView() {}
  function __g() { return gets; }`, ['_inactiveLeadersHtml', '__g']);

describe('Setup: Inactive leaders', () => {
  it('not loaded yet: fetches once, shows nothing', () => {
    const f = mk(null);
    expect(f._inactiveLeadersHtml()).toBe('');
    f._inactiveLeadersHtml();
    expect(f.__g()).toEqual(['/leaders?inactive=1']);
  });
  it('none: hidden', () => {
    expect(mk([])._inactiveLeadersHtml()).toBe('');
  });
  it('lists them collapsed, A-Z, with grades and an Edit link', () => {
    const h = mk([{ id: 'b', fullName: 'Zed <x>', grades: [8] }, { id: 'a', fullName: 'Amy', grades: [] }])._inactiveLeadersHtml();
    expect(h).toMatch(/^<details /);
    expect(h).not.toContain('<details open');
    expect(h).toContain('Inactive leaders (2)');
    expect(h.indexOf('Amy')).toBeLessThan(h.indexOf('Zed'));
    expect(h).toContain('Zed &lt;x>');
    expect(h).toContain('Gr 8');
    expect(h).toContain("showEditLeader('a')");
  });
  it('Setup renders it at the bottom', () => {
    const body = extractFn(loadIndexHtml(), 'renderConnectView');
    expect(body.indexOf('_inactiveLeadersHtml()')).toBeLessThan(body.indexOf('setApp(shell(body))'));
  });
});
