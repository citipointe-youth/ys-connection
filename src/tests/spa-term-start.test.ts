import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn, countFn, loadFns } from './helpers/extract-fn';

// Runs the REAL function bodies extracted from public/index.html (see export-guide.test.ts).

describe('relative-time helpers do not collide', () => {
  const html = loadIndexHtml();
  it('exactly one _relTime (Prayers) and one _laRelTime (Login Activity)', () => {
    expect(countFn(html, '_relTime')).toBe(1);
    expect(countFn(html, '_laRelTime')).toBe(1);
  });
});

describe('Login Activity helpers', () => {
  const NOW = Date.parse('2026-10-02T05:05:00Z');
  const fns = loadFns([
    '_laLastMs', '_laOrder', '_laFilterUsers', '_laLoginsLast30', '_laFmtBrisbane', '_laRelTime', '_laGroup',
  ]);
  const u = (name: string, hist?: any, role = 'grade') => ({ displayName: name, role, loginHistory: hist });

  it('formats Brisbane time with year', () => {
    expect(fns._laFmtBrisbane('2026-10-02T05:05:00Z')).toBe('2 Oct 2026, 3:05 pm');
    expect(fns._laFmtBrisbane('garbage')).toBe('');
  });

  it('never-logged-in, undefined and garbage history sort first and count as never', () => {
    const users = [u('B', ['2026-10-01T00:00:00Z']), u('A', undefined), u('C', []), u('D', ['nope'])];
    expect(fns._laOrder(users).map((x: any) => x.displayName)).toEqual(['A', 'C', 'D', 'B']);
    expect(fns._laFilterUsers(users, 'never', NOW).map((x: any) => x.displayName).sort()).toEqual(['A', 'C', 'D']);
  });

  it('quiet filter = never or last login older than 30 days', () => {
    const users = [u('recent', ['2026-09-30T00:00:00Z']), u('old', ['2026-08-01T00:00:00Z']), u('never', [])];
    expect(fns._laFilterUsers(users, 'quiet', NOW).map((x: any) => x.displayName)).toEqual(['old', 'never']);
    expect(fns._laFilterUsers(users, 'all', NOW)).toHaveLength(3);
  });

  it('counts logins in the last 30 days, ignoring garbage and old entries', () => {
    const h = ['2026-10-01T00:00:00Z', '2026-09-20T00:00:00Z', '2026-08-01T00:00:00Z', 'x'];
    expect(fns._laLoginsLast30(u('a', h), NOW)).toEqual({ n: 2, capped: false });
    expect(fns._laLoginsLast30(u('a', undefined), NOW)).toEqual({ n: 0, capped: false });
  });

  it('flags 15 recent logins as capped (history keeps only 15)', () => {
    const h = Array.from({ length: 15 }, (_, i) => new Date(NOW - i * 3600_000).toISOString());
    expect(fns._laLoginsLast30(u('a', h), NOW)).toEqual({ n: 15, capped: true });
  });

  it('future timestamps do not crash and read as just now', () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    expect(fns._laRelTime(future)).toBe('just now');
    expect(fns._laRelTime('garbage')).toBe('');
  });

  it('relative time buckets', () => {
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
    expect(fns._laRelTime(ago(5 * 60000))).toBe('5m ago');
    expect(fns._laRelTime(ago(3 * 3600000))).toBe('3h ago');
    expect(fns._laRelTime(ago(2 * 86400000))).toBe('2d ago');
  });

  it('groups by role and drops empty groups', () => {
    const g = fns._laGroup([u('a', [], 'admin'), u('b', [], 'quad'), u('c', [], 'weird')]);
    expect(g.map((x: any) => x.key)).toEqual(['admin', 'quad', 'other']);
  });
});

describe('device helpers', () => {
  it('labels common user agents', () => {
    const { _deviceLabel } = loadFns(['_deviceLabel']);
    expect(_deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Version/17 Mobile Safari/604')).toBe('iPhone · Safari');
    expect(_deviceLabel('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537 Chrome/120 Mobile Safari/537')).toBe('Android · Chrome');
    expect(_deviceLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537 Edg/120')).toBe('Windows · Edge');
    expect(_deviceLabel('')).toBe('Unknown device');
  });

  it('_deviceId is stable per browser and survives storage failure', () => {
    const ok = loadFns(
      ['_deviceId'],
      'const __s = {}; const localStorage = { getItem: k => (k in __s ? __s[k] : null), setItem: (k, v) => { __s[k] = v; } }; const window = {};',
    );
    const a = ok._deviceId();
    expect(a).toBeTruthy();
    expect(ok._deviceId()).toBe(a);
    const broken = loadFns(
      ['_deviceId'],
      'const localStorage = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); } }; const window = {};',
    );
    expect(broken._deviceId()).toBeUndefined();
  });
});

describe('student search', () => {
  const { _matchesQuery } = loadFns(['_matchesQuery']);
  it('matches tokens in any order, ignoring extra spaces and case', () => {
    expect(_matchesQuery('Emma Watson', 'watson emma')).toBe(true);
    expect(_matchesQuery('Emma Watson', '  EMMA   wat ')).toBe(true);
    expect(_matchesQuery('Emma Watson', 'emma smith')).toBe(false);
    expect(_matchesQuery('Emma Watson', '   ')).toBe(true);
  });
});

describe('auth expiry handling', () => {
  const mk = (stash: unknown) => {
    const prelude = `
      let _previewStash = ${JSON.stringify(stash)};
      let _shellReady = true;
      let _authExpiring = false;
      const calls = [];
      const API = { setToken: t => calls.push('token:' + t) };
      const S = { user: { id: 'preview' }, page: 'x' };
      const Cache = { clear: () => calls.push('cache') };
      const localStorage = { removeItem: k => calls.push('rm:' + k) };
      const toast = () => calls.push('toast');
      const go = p => calls.push('go:' + p);
      const render = () => calls.push('render');
      function __state() { return { S, calls, stash: _previewStash }; }
    `;
    return loadFns(['_isAuthExpired', '_handleAuthExpired'], prelude, ['_isAuthExpired', '_handleAuthExpired', '__state']);
  };

  it('only a 401 counts as expired', () => {
    const { _isAuthExpired } = mk(null);
    expect(_isAuthExpired({ status: 401 })).toBe(true);
    expect(_isAuthExpired({ status: 503 })).toBe(false);
    expect(_isAuthExpired(new Error('Failed to fetch'))).toBe(false);
    expect(_isAuthExpired(undefined)).toBe(false);
  });

  it('plain expiry logs out, once within the guard window', () => {
    const { _handleAuthExpired, __state } = mk(null);
    _handleAuthExpired();
    _handleAuthExpired();
    const st = __state();
    expect(st.S.user).toBeNull();
    expect(st.calls.filter((c: string) => c === 'token:null')).toHaveLength(1);
  });

  it('an expired preview token restores the admin session instead of logging out', () => {
    const { _handleAuthExpired, __state } = mk({ token: 'admin-tok', user: { id: 'admin' } });
    _handleAuthExpired();
    const st = __state();
    expect(st.S.user).toEqual({ id: 'admin' });
    expect(st.calls).toContain('token:admin-tok');
    expect(st.calls).toContain('go:home');
    expect(st.stash).toBeNull();
  });
});

describe('boot keeps the token on transient failures', () => {
  it.each([
    ['503', { status: 503 }, false],
    ['network error', new Error('network'), false],
    ['401', { status: 401 }, true],
  ])('%s -> token cleared: %s', async (_label, err, clears) => {
    (globalThis as any).__ERR = err;
    const prelude = `
      const ERR = globalThis.__ERR;
      const calls = [];
      const localStorage = { getItem: () => 'tok' };
      const API = { setToken: t => calls.push('token:' + t), get: async p => { if (p === '/auth/me') throw ERR; return {}; } };
      const S = { user: null, settings: null };
      let _previewStash = null;
      const restoreConnectFilters = () => {}, restoreArFilter = () => {}, restorePrayerFilter = () => {}, applyTheme = () => {}, render = () => {};
      function _isAuthExpired(e) { return !!e && e.status === 401; }
      function __calls() { return calls; }
    `;
    const f = loadFns(['boot'], prelude, ['boot', '__calls']);
    await f.boot();
    expect(f.__calls().includes('token:null')).toBe(clears);
  });
});

describe('import busy flag', () => {
  it('a missing status element never wedges _importBusy', async () => {
    const html = loadIndexHtml();
    const body = ['_setImportStatus', 'uploadServiceImport'].map((n) => extractFn(html, n)).join('\n');
    const prelude = `
      let _importBusy = false;
      let _lastImportReport = null;
      const document = { getElementById: () => null };
      const toast = () => {};
      const Cache = { clear() {} };
      const icS = () => '';
      const API = { post: async () => { throw new Error('boom'); } };
      function __busy() { return _importBusy; }
    `;
    // eslint-disable-next-line no-new-func
    const f = new Function('window', `${prelude}\n${body}\nreturn { uploadServiceImport, __busy };`)({
      _pendingServiceRows: [{ a: 1 }],
    });
    await f.uploadServiceImport('x.csv');
    expect(f.__busy()).toBe(false);
  });
});

describe('Prayers CSV export', () => {
  const { _prayerExportHeader, _prayerExportCells } = loadFns(['_prayerExportHeader', '_prayerExportCells']);
  it('includes the round-trip columns the importer accepts', () => {
    const h = _prayerExportHeader().map((x: string) => x.toLowerCase());
    for (const c of ['created by grades', 'created by gender', 'created at', 'answered at']) expect(h).toContain(c);
  });
  it('every row has one cell per header, with blanks for missing values', () => {
    const cells = _prayerExportCells({ firstName: 'A', prayer: 'p', grade: null, createdByGrades: '7,8' });
    expect(cells).toHaveLength(_prayerExportHeader().length);
    expect(cells).toContain('7,8');
    expect(cells).not.toContain('undefined');
  });
});

describe('SW registration and logout', () => {
  const html = loadIndexHtml();
  it('guards the controllerchange reload against first install and loops', () => {
    expect(html).toMatch(/_swHadController/);
    expect(html).toMatch(/_swReloading/);
  });
  it('logout clears per-user filters but keeps the device id', () => {
    const fn = extractFn(html, 'doLogout');
    for (const k of ['yap_ar_filter', 'yap_prayer_filter', 'yap_connect_filters', 'yap_leader_id']) expect(fn).toContain(k);
    expect(fn).not.toContain('yap_device_id');
  });
});
