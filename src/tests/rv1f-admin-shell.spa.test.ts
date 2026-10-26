// Round 2026-10-22 lane L1 (RV1 consolidated A3/A5/B1-B4): the Admin shell. Extract-and-run against public/index.html.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn, loadFns } from './helpers/extract-fn';

const HTML = loadIndexHtml();

describe('A3: switching to New Year never re-locks the wizard', () => {
  it('switchAdminTab does not call _wizReset', () => {
    expect(extractFn(HTML, 'switchAdminTab')).not.toContain('_wizReset');
  });
});

describe('A5: the ungated Full Reset and Clear Service/Group Data are gone from Admin', () => {
  it('renderAdminView offers neither wipe; the wizard keeps the one gated reset', () => {
    const v = extractFn(HTML, 'renderAdminView');
    expect(v).not.toContain('/admin/clear-service-group');
    expect(v).not.toContain('/admin/reset');
    expect(v).not.toContain('Clear Service/Group Data');
    expect(HTML).toContain("API.post('/admin/reset'"); // the New Year wizard's step 4
  });
});

describe('B4: Accounts tidy', () => {
  it('the Username tip is plain; no dead rl in the Accounts loop', () => {
    const add = extractFn(HTML, 'showAddUser');
    expect(add).toContain('The name used to log in. For a grade login, also set Gender scope below.');
    expect(add).not.toContain('grade7g');
    expect(extractFn(HTML, 'renderAdminView')).not.toContain('const rl =');
  });
});

describe('B2: the Data tab body is gone; the wizard keeps its import/export helpers', () => {
  it('no Data block, no adminAction; the helpers the wizard calls stay', () => {
    const v = extractFn(HTML, 'renderAdminView');
    expect(v).not.toContain("_adminTab === 'data'");
    expect(v).not.toContain('alloc-auto-leaders');
    expect(HTML).not.toMatch(/function adminAction\(/);
    for (const fn of ['exportAllocationsCSV', 'processAllocationImport', 'exportPrayersCSV', 'handlePrayerImportFile']) {
      expect(HTML, fn).toContain(`function ${fn}(`);
    }
  });
});

describe('B1: 6 Admin tabs, pills on every width, old ids as aliases', () => {
  const TABS = HTML.match(/^const ADMIN_TABS = .*$/m)![0];
  const HOME = HTML.match(/^const ADMIN_TAB_HOME = .*$/m)![0];
  const esc = 'function esc(s) { return String(s); }';
  it('the tab list is the operator ruling, in this order', () => {
    expect(TABS).toBe("const ADMIN_TABS = [['link','Elvanto link'],['problems','Problems'],['import','Import'],['accounts','Accounts'],['youthsetup','Youth Setup'],['newyear','New Year']];");
  });
  it('an old id lights the pill of the tab that holds it; no <select>', () => {
    const f = loadFns(['_adminTabsHtml', '_modOn'], `var S = {};\n${TABS}\n${HOME}\n${esc}`);
    for (const [old, home] of [['errors', 'problems'], ['unsent', 'problems'], ['system', 'problems'], ['loginActivity', 'accounts'], ['data', 'newyear']]) {
      const h = f._adminTabsHtml(old);
      expect(h, old).toContain(`tbbtn on" onclick="switchAdminTab('${home}')"`);
      expect(h.match(/tbbtn on/g), old).toHaveLength(1);
    }
    expect(f._adminTabsHtml('import')).not.toContain('<select');
    expect(HTML).not.toContain('admin-tabsel');
    expect(HTML).toContain('.tbbar.admin-tabs{-webkit-mask-image:none;mask-image:none}');
  });
  function sw(page = 'admin') {
    const log: string[] = [];
    const t = new Function('log', `${TABS}\n${HOME}\nconst S = { page: '${page}' }; let _adminTab = 'import', _adminScroll = null, _adminData = null;
      let _setupFlowSteps, _setupDraft, _setupServiceMinAttendance, _setupTermGapDays, _setupOpen;
      const go = (p) => log.push('go:' + p); const API = { get: async (p) => (p === '/accounts/users' ? [] : {}) };
      async function renderAdminView() { log.push('render:' + _adminTab + ':' + _adminScroll); }
      ${extractFn(HTML, 'switchAdminTab')}
      return { sw: switchAdminTab, st: () => [_adminTab, _adminScroll] };`)(log);
    return { ...t, log };
  }
  it('errors, unsent and system open Problems and ask for their section; data opens New Year; loginActivity stays a sub-view', async () => {
    for (const [id, tab, sec] of [['errors', 'problems', 'err-log'], ['unsent', 'problems', 'unsent-list'], ['system', 'problems', 'sys-check'],
      ['data', 'newyear', null], ['loginActivity', 'loginActivity', null], ['accounts', 'accounts', null]] as [string, string, string | null][]) {
      const t = sw();
      await t.sw(id);
      expect(t.log, id).toEqual([`render:${tab}:${sec}`]);
    }
  });
  it('from Home, a deep link goes to Admin with the tab and section already set', async () => {
    const t = sw('home');
    await t.sw('unsent');
    expect(t.log).toEqual(['go:admin']);
    expect(t.st()).toEqual(['problems', 'unsent-list']);
  });
  it('Problems stacks Unsent, Error log and System check and calls the three loaders', () => {
    const v = extractFn(HTML, 'renderAdminView');
    const i = v.indexOf('id="unsent-list"'), j = v.indexOf('id="err-log"'), k = v.indexOf('id="sys-check"');
    expect(i).toBeGreaterThan(-1); expect(j).toBeGreaterThan(i); expect(k).toBeGreaterThan(j);
    for (const call of ['_usLoad()', '_elLoad()', 'renderSystemCheck()', 'scrollIntoView']) expect(v).toContain(call);
  });
  it('Accounts opens Login activity from a row with its counts', () => {
    const v = extractFn(HTML, 'renderAdminView');
    expect(v).toContain(`onclick="switchAdminTab('loginActivity')"`);
    expect(v).toContain("_laFilterUsers(users, 'never'");
  });
  it('the Problems badge sums errors, unsent and System check fixes', () => {
    const { _attnBadges } = loadFns(['_attnBadges'], '');
    expect(_attnBadges({ errors: 3, unsent: 2, fix: ['a', 'b'], unclear: 1, waiting: 2 })).toEqual({ problems: 7, link: 3 });
  });
});
