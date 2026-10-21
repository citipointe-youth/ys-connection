// Error log tab (Part 1 rework 2026-10-17), SPA side: the REAL functions from public/index.html (extract-and-run).
import { describe, it, expect, vi } from 'vitest';
import { loadIndexHtml, extractFn, SITE_TIME_SRC } from './helpers/extract-fn';

const html = loadIndexHtml();
const EL_GROUPS_SRC = html.match(/^const EL_GROUPS = \[[\s\S]*?\];/m)![0];
// _laFmtBrisbane stays: the real _laRelTime calls it for dates 7 or more days old.
const NAMES = ['esc', '_laFmtBrisbane', '_laRelTime', '_elVisible', '_elIsNew', '_elRowHtml', '_elBodyHtml', '_errRoute', '_errReport'];

function load(token: string | null = 'tok') {
  const sent: any[] = [];
  const prelude = `${EL_GROUPS_SRC}
    const S = {};
    ${SITE_TIME_SRC}
    const API = { get token() { return ${JSON.stringify(token)}; } };
    const _errSent = new Set();
    const _errNet = { at: 0 };
    const fetch = (url, init) => { __sent.push({ url, init }); return Promise.resolve(); };`;
  const fns = new Function('__sent', `${prelude}\n${NAMES.map((n) => extractFn(html, n)).join('\n')}
    return { ${NAMES.join(', ')} };`)(sent);
  return { ...fns, sent };
}

const row = (over: Record<string, unknown> = {}) => ({ id: 'abc123', category: 'server', code: 'INTERNAL_ERROR', route: 'GET /x',
  status: 500, message: 'old', count: 3, firstSeen: '2026-10-01T00:00:00Z', lastSeen: '2026-10-13T00:00:00Z', lastRole: 'grade',
  minimised: false, ignored: false, tier: 'later', foldKey: 'INTERNAL_ERROR|500', counted: false,
  line1: 'A screen failed with a server error (GET /x)', line2: 'Find the stack in Vercel runtime logs.', ...over });

describe('Error log tab', () => {
  const f = load();
  it('the tab is in the admin tab list', () => {
    expect(html).toMatch(/const ADMIN_TABS = \[[^;]*\['errors','Error log'\]/);
  });
  it('the old category filter, help table and Minimise are gone', () => {
    expect(html).not.toMatch(/const EL_CATS|const EL_HELP|function _elHelp|function elSetCat|>Minimise</);
  });
  it('groups in order with counts; FYI is a closed <details>; empty Act later and FYI are hidden', () => {
    const out = f._elBodyHtml([row({ id: 'f', tier: 'fyi' }), row({ id: 'l', tier: 'later' }), row({ id: 'n', tier: 'now' })], false, 0, '', false);
    const iNow = out.indexOf('Act now (1)'), iLater = out.indexOf('Act later (1)'), iFyi = out.indexOf('FYI (1)');
    expect(iNow).toBeGreaterThan(-1); expect(iLater).toBeGreaterThan(iNow); expect(iFyi).toBeGreaterThan(iLater);
    expect(out).toMatch(/<details class="el-grp" ontoggle="_elFyiOpen=this\.open"><summary class="el-h">FYI \(1\)<\/summary>/);
    const one = f._elBodyHtml([row({ id: 'n', tier: 'now' })], false, 0, '', false);
    expect(one).not.toMatch(/Act later|FYI \(0\)|Nothing here/);
    const fyiOnly = f._elBodyHtml([row({ id: 'f', tier: 'fyi' })], false, 0, '', false);
    expect(fyiOnly).toContain('Act now (0)'); expect(fyiOnly).toContain('Nothing to act on now.');
  });
  it('(r22 B6) a clean log is one line under the Error log heading', () => {
    const out = f._elBodyHtml([], false, 0, '', false);
    expect(out).toContain('Error log');
    expect(out).toContain('No errors. All clear.');
    expect(out).not.toMatch(/Act now|Act later|FYI|Show ignored|class="card"/);
  });
  it('(r22 B6) everything ignored and hidden: Show ignored (n), no all-clear line', () => {
    const out = f._elBodyHtml([row({ ignored: true })], false, 0, '', false);
    expect(out).toContain('Show ignored (1)');
    expect(out).not.toContain('All clear');
  });
  it('fyi stays open: a repaint with fyiOpen keeps the FYI group open', () => {
    expect(f._elBodyHtml([row({ tier: 'fyi' })], false, 0, '', true)).toMatch(/<details class="el-grp" open ontoggle=/);
  });
  it('an entry is two lines: line 1 (with ×N and time), line 2; no code, route, status or role lines', () => {
    const out = f._elRowHtml(row(), 0, false);
    expect(out).toContain('A screen failed with a server error (GET /x)');
    expect(out).toContain('Find the stack in Vercel runtime logs.');
    expect(out).toMatch(/×3/);
    expect(out).not.toMatch(/INTERNAL_ERROR|· 500|First |grade/);
    expect(f._elRowHtml(row({ count: 1 }), 0, false)).not.toMatch(/×/);
    expect(f._elRowHtml(row({ counted: true, count: 96 }), 0, false)).not.toMatch(/×96/);
  });
  it('tap toggles the action row: closed has no buttons; open has Ignore / Delete; ignored says Stop ignoring', () => {
    expect(f._elRowHtml(row(), 0, false)).not.toMatch(/Ignore|Delete/);
    const open = f._elRowHtml(row(), 0, true);
    expect(open).toMatch(/aria-expanded="true"/); expect(open).toMatch(/>Ignore</); expect(open).toMatch(/Delete/);
    expect(f._elRowHtml(row({ ignored: true }), 0, true)).toMatch(/Stop ignoring/);
  });
  it('one open entry at a time: only the openId row shows actions', () => {
    const out = f._elBodyHtml([row({ id: 'a' }), row({ id: 'b' })], false, 0, 'b', false);
    expect((out.match(/>Ignore</g) ?? []).length).toBe(1);
    expect(out).toContain(`id="el-del-b"`);
  });
  it('hides ignored unless asked; New = seen since last visit, never for an ignored row', () => {
    const rows = [row({ id: 'a' }), row({ id: 'c', ignored: true })];
    expect(f._elVisible(rows, false).map((r: any) => r.id)).toEqual(['a']);
    expect(f._elVisible(rows, true).map((r: any) => r.id)).toEqual(['a', 'c']);
    const seen = Date.parse('2026-10-12T00:00:00Z');
    expect(f._elIsNew(row(), seen)).toBe(true);
    expect(f._elIsNew(row({ ignored: true }), seen)).toBe(false);
  });
  it('header: Show ignored (n) only when n > 0, Clear FYI only with FYI rows; no Delete all, no privacy line', () => {
    const out = f._elBodyHtml([row({ tier: 'fyi' }), row({ id: 'i', ignored: true })], false, 0, '', false);
    expect(out).toContain('Show ignored (1)'); expect(out).toContain('Clear FYI');
    expect(out).not.toMatch(/Delete all|el-delall|No names or details/);
    const plain = f._elBodyHtml([row()], false, 0, '', false);
    expect(plain).not.toMatch(/Clear FYI|Show ignored|class="card"/); // nothing left in the top card: no card
    expect(html).not.toMatch(/function elDeleteAll|el-delall/);
  });
  it('escapes every server value', () => {
    const out = f._elBodyHtml([row({ line1: '<img src=x onerror=1>', line2: '<b>' })], false, 0, '', false);
    expect(out).not.toMatch(/<img|<b>/);
    expect(out).toMatch(/&lt;img/);
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
});
