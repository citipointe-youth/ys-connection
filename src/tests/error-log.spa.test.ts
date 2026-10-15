// T3 Error log, SPA side: the REAL functions from public/index.html (extract-and-run), against small stubs.
import { describe, it, expect, vi } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

const html = loadIndexHtml();
const EL_CATS_SRC = html.match(/^const EL_CATS = \{[^}]*\};/m)![0];
const EL_HELP_SRC = html.match(/^const EL_HELP = \{[\s\S]*?\n\};/m)![0];
const NAMES = ['esc', '_elHelp', '_laRelTime', '_laFmtBrisbane', '_elVisible', '_elIsNew', '_elRowHtml', '_elBodyHtml', '_errRoute', '_errReport'];

function load(token: string | null = 'tok') {
  const sent: any[] = [];
  const prelude = `${EL_CATS_SRC}
    ${EL_HELP_SRC}
    const API = { get token() { return ${JSON.stringify(token)}; } };
    const _errSent = new Set();
    const _errNet = { at: 0 };
    const fetch = (url, init) => { __sent.push({ url, init }); return Promise.resolve(); };`;
  const fns = new Function('__sent', `${prelude}\n${NAMES.map((n) => extractFn(html, n)).join('\n')}
    return { ${NAMES.join(', ')} };`)(sent);
  return { ...fns, sent };
}

const row = (over: Record<string, unknown> = {}) => ({ id: 'abc123', category: 'server', code: 'INTERNAL_ERROR', route: 'GET /x',
  status: 500, message: 'Unexpected server error', count: 3, firstSeen: '2026-10-01T00:00:00Z', lastSeen: '2026-10-13T00:00:00Z',
  lastRole: 'grade', minimised: false, ignored: false, ...over });

describe('Error log tab', () => {
  const f = load();
  it('the tab is in the admin tab list', () => {
    expect(html).toMatch(/const ADMIN_TABS = \[[^;]*\['errors','Error log'\]/);
    const g = new Function(`${html.match(/^const ADMIN_TABS = .*;$/m)![0]}
function esc(s) { return String(s); }
${extractFn(html, '_adminTabsHtml')}
return _adminTabsHtml;`)();
    expect(g('errors')).toMatch(/<option value="errors" selected>Error log<\/option>/);
  });
  it('filters by category and hides ignored unless asked', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', category: 'link' }), row({ id: 'c', ignored: true })];
    expect(f._elVisible(rows, '', false).map((r: any) => r.id)).toEqual(['a', 'b']);
    expect(f._elVisible(rows, 'link', false).map((r: any) => r.id)).toEqual(['b']);
    expect(f._elVisible(rows, '', true).map((r: any) => r.id)).toEqual(['a', 'b', 'c']);
  });
  it('New = seen since last visit, never for an ignored row', () => {
    const seen = Date.parse('2026-10-12T00:00:00Z');
    expect(f._elIsNew(row(), seen)).toBe(true);
    expect(f._elIsNew(row({ ignored: true }), seen)).toBe(false);
    expect(f._elIsNew(row({ lastSeen: '2026-10-11T00:00:00Z' }), seen)).toBe(false);
  });
  it('a minimised row has no action buttons; an open one has Minimise / Ignore / Delete', () => {
    expect(f._elRowHtml(row({ minimised: true }), 0)).not.toMatch(/Ignore|Delete/);
    const open = f._elRowHtml(row(), 0);
    expect(open).toMatch(/Minimise/); expect(open).toMatch(/>Ignore</); expect(open).toMatch(/Delete/); expect(open).toMatch(/×3/);
    expect(f._elRowHtml(row({ ignored: true }), 0)).toMatch(/Stop ignoring/);
  });
  it('escapes every server value', () => {
    const out = f._elBodyHtml([row({ message: '<img src=x onerror=1>', route: '<b>', code: '"x"' })], '', false, 0);
    expect(out).not.toMatch(/<img|<b>/);
    expect(out).toMatch(/&lt;img/);
  });
  it('Delete all names the filtered category; no rows = no Delete all', () => {
    expect(f._elBodyHtml([row({ category: 'link' })], 'link', false, 0)).toMatch(/Delete all in Elvanto link/);
    expect(f._elBodyHtml([], '', false, 0)).not.toMatch(/Delete all/);
  });
});

describe('client error reporting', () => {
  it('_errRoute drops the query and folds ids', () => {
    const f = load();
    expect(f._errRoute('GET', '/students/9e0a?q=Sam')).toBe('GET /students/:id');
    expect(f._errRoute('POST', '/link/batch')).toBe('POST /link/batch');
  });
  it('sends code/route/status only, once per kind, at most 10 per page load', () => {
    const f = load();
    f._errReport({ kind: 'api', code: 'INTERNAL_ERROR', route: 'GET /x', status: 500 });
    f._errReport({ kind: 'api', code: 'INTERNAL_ERROR', route: 'GET /x', status: 500 });
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0].url).toBe('/admin/errors/client');
    expect(JSON.parse(f.sent[0].init.body)).toEqual({ kind: 'api', code: 'INTERNAL_ERROR', route: 'GET /x', status: 500 });
    expect(f.sent[0].init.headers.Authorization).toBe('Bearer tok');
    for (let i = 0; i < 20; i++) f._errReport({ kind: 'js', code: 'E', route: `line ${i}:1` });
    expect(f.sent).toHaveLength(10);
  });
  it('logged out: nothing is sent', () => {
    const f = load(null);
    f._errReport({ kind: 'js', code: 'E', route: 'line 1:1' });
    expect(f.sent).toHaveLength(0);
  });
  it('API errors are marked so the rejection handler skips them; 5xx and network failures are reported', () => {
    expect(html).toMatch(/err\._errLogged = true/);
    expect(html).not.toMatch(/if \(res\.status >= 500\) _errReport\(/); // the server records 5xx itself
    expect(html).toMatch(/if \(x && x\._errLogged\) return;/);
  });
});

describe('Error log polish (R8)', () => {
  it('no-connection reports: one a minute per device, sent as route page', () => {
    const f = load();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    f._errReport({ kind: 'api', code: '', route: 'GET /a', status: 0 });
    f._errReport({ kind: 'api', code: '', route: 'GET /b', status: 0 });
    expect(f.sent).toHaveLength(1);
    expect(JSON.parse(f.sent[0].init.body).route).toBe('page');
    now.mockReturnValue(1_061_000);
    f._errReport({ kind: 'api', code: '', route: 'GET /c', status: 0 });
    expect(f.sent).toHaveLength(2);
    now.mockRestore();
  });
  it('client route masks hex and long token-like segments', () => {
    const f = load();
    expect(f._errRoute('GET', '/x/deadbeefcafe/y')).toBe('GET /x/:id/y');
    expect(f._errRoute('GET', '/x/someLongTokenValueHere')).toBe('GET /x/:id');
  });
  it('help line and Needs action / Safe to ignore chip per code, generic for unknown', () => {
    const f = load();
    const net = f._elRowHtml(row({ code: 'NETWORK', category: 'client', message: 'Request failed: no connection' }), 0);
    expect(net).toContain('Safe to ignore');
    expect(net).toContain('lost signal');
    expect(f._elRowHtml(row({ code: 'UNSENT_SAVE_FAILED' }), 0)).toContain('Needs action');
    const unk = f._elRowHtml(row({ code: 'WEIRD_NEW', status: 500 }), 0);
    expect(unk).toContain('no description');
    expect(unk).toContain('Needs action');
  });
});
