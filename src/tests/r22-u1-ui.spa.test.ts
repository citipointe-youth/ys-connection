// r22 U1 (RV2): Trends fixes, Home Import tile, My Connections restyle.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn, loadFns } from './helpers/extract-fn';

const html = loadIndexHtml();

function trends(sessions: string[], noTerm = false) {
  const prelude = `
    var S = { user: { role: 'admin' }, page: 'trends', settings: { ministryConfig: { modules: {} } } };
    let _trTab = 'svc'; var out = '';
    const TREND_PATHS = ['/students', '/overview', '/trends', '/lifegroups/stats'];
    var data = {
      '/students': [], '/overview': {},
      '/trends': { terms: ${noTerm ? '{}' : "{ current: { startDate: '2026-10-03', endDate: '2026-10-10' } }"},
        ministry: { uniqueAttenders: 335, averageAttendance: 247, prevUniqueAttenders: 300, prevAverageAttendance: 206,
          peakAttendance: 264, recentTrend: 'stable',
          sessions: ${JSON.stringify(sessions)}.map((d, i) => ({ sessionDate: d, totalAttended: 230 + i, totalPresent: 240, isOutlier: false })) } },
      '/lifegroups/stats': { overall: { current: { uniqueAttenders: 5, avgPerWeek: 4, weeksRan: 1 }, previous: { weeksRan: 0 },
        weekly: [{ weekStart: '2026-10-03', attended: 4 }] }, byQuad: [] },
    };
    var Cache = { get: (p) => data[p], getStale: (p) => data[p] };
    function _revalidateTrends() {} function _allCached() { return true; }
    function setApp(h) { out = h; } function shell(x) { return x; }
    function L(k) { return k; } function esc(x) { return String(x); } function icS() { return ''; }
    function _gradeList() { return []; } function quadLabel(q) { return q; }
    function setTab(t) { _trTab = t; } function html() { return out; }`;
  return loadFns(['renderTrends', 'colChart', 'trendBadge', 'statCard', 'fmtDay', 'fmtDM', '_fridayLabel'], prelude,
    ['renderTrends', 'setTab', 'html']);
}

describe('Trends (RV2 A)', () => {
  it('SEEN prev reads prevUniqueAttenders', async () => {
    const t = trends(['2026-10-09', '2026-10-16']);
    await t.renderTrends();
    expect(t.html()).toContain('prev: 300');
    expect(html).not.toContain('prevSeenAttenders');
  });

  it('the term label shows the first and last service dates, not week starts', async () => {
    const t = trends(['2026-10-09', '2026-10-16']);
    await t.renderTrends();
    expect(t.html()).toMatch(/Fri 9 Oct( 2026)? – Fri 16 Oct/);
    expect(t.html()).not.toContain('Sat 3 Oct');
  });

  it('no sessions and no term: the label says "this term" once', async () => {
    const t = trends([], true);
    await t.renderTrends();
    expect(t.html()).toContain('Whole-ministry service attendance · this term</div>');
    expect(t.html()).not.toContain('this term (this term)');
  });

  it('plain wording; the Stable badge only shows with 4+ services', async () => {
    const t2 = trends(['2026-10-09', '2026-10-16']);
    await t2.renderTrends();
    expect(t2.html()).toContain('2 Fridays this term · average 247 · highest 264');
    expect(t2.html()).not.toContain('tr-st');
    expect(t2.html()).not.toContain('valid services');
    const t4 = trends(['2026-09-25', '2026-10-02', '2026-10-09', '2026-10-16']);
    await t4.renderTrends();
    expect(t4.html()).toContain('tr-st');
  });

  it('Lifegroups bars are labelled by their Friday', async () => {
    const t = trends(['2026-10-09']);
    t.setTab('grp');
    await t.renderTrends();
    expect(t.html()).toContain('>9/10<');
    expect(t.html()).not.toContain('>3/10<');
  });

  it('bars are capped at 28px and centred', () => {
    expect(html).toMatch(/\.ccol-bar\{[^}]*max-width:28px/);
    expect(html).toMatch(/\.ccol\{[^}]*align-items:center/);
  });
});

describe('Import tile (RV2 B)', () => {
  const nav = (role: string, mods: { prayers: boolean; bus: boolean }) => loadFns(
    ['moreItems', '_navSlots', '_navItemsBase', 'navItems', 'quickActionItems', '_homeTiles'],
    `var S = { user: { role: '${role}' }, settings: { ministryConfig: { modules: {} } } };
     function L(k) { return k; } function _prayersOn() { return ${mods.prayers}; } function _busOn() { return ${mods.bus}; }
     function _nyOn() { return false; } function _linkOn() { return false; }`,
    ['moreItems', 'navItems', '_homeTiles']);
  const ids = (xs: any[]) => xs.map((x) => x.id);

  for (const role of ['admin', 'director']) {
    it(`${role}: no Import tile on Home, but navItems (the sidebar the console clicks) keeps Import`, () => {
      const n = nav(role, { prayers: true, bus: true });
      expect(ids(n._homeTiles({ role }))).not.toContain('import');
      expect(ids(n._homeTiles({ role }))).toContain('students');
      expect(n.navItems().find((x: any) => x.id === 'import')).toMatchObject({ id: 'import', label: 'Import' });
    });
  }

  it("director's More sheet always has Import, and a director always gets More; admin's has no Import", () => {
    expect(nav('director', { prayers: true, bus: true }).moreItems().find((x: any) => x.id === 'import'))
      .toMatchObject({ label: 'Import', open: "go('import')" });
    expect(ids(nav('director', { prayers: true, bus: false }).moreItems())).toEqual(['prayers', 'import']);
    expect(ids(nav('director', { prayers: false, bus: false }).moreItems())).toEqual(['import']);
    for (const m of [{ prayers: false, bus: false }, { prayers: true, bus: false }, { prayers: false, bus: true }])
      expect(nav('director', m).navItems().find((x: any) => x.id === 'more'), JSON.stringify(m)).toMatchObject({ action: 'openMore()' });
    expect(nav('director', { prayers: false, bus: false }).navItems().filter((x: any) => x.id === 'import')).toHaveLength(1);
    expect(ids(nav('admin', { prayers: true, bus: true }).moreItems())).not.toContain('import');
  });

  it('the import route and the drop-zone ids are unchanged', () => {
    expect(html).toContain("else if (p==='import') await renderImport();");
    expect(html).toContain('<div id="drop-zone"');
  });
});

describe('My Connections restyle (RV2 C)', () => {
  const ms = (picked: string | null) => loadFns(
    ['renderMyStudents', 'tLvF', '_smsTemplateBoxHtml', 'termRow', 'dncChip', 'riskChip'],
    `var S = { user: { role: 'admin' }, page: 'my-students' }; var out = ''; var gets = [];
     let _msLeader = ${JSON.stringify(picked)}; let _lvF = { year: new Set(), gender: new Set() };
     const MYSTUDENTS_PATHS = ['/leaders?pick=1', '/students'];
     var data = { '/leaders?pick=1': [{ id: 'l1', fullName: 'Lee <Fictional>', grades: [9], gender: 'male', smsTemplate: 'Hi' }], '/students': [] };
     var Cache = { get: (p) => data[p], getStale: (p) => data[p] };
     var API = { get: (p) => { gets.push(p); return Promise.resolve(p === '/prayers'
       ? [{ student: { id: 's1' }, text: 'Exams <soon>', status: 'open' }]
       : { students: [{ id: 's1', firstName: 'Zed', fullName: 'Zed <b>Fictional</b>', grade: 9, gender: 'male', dateOfBirth: null,
           mobile: '0400000000', parentPhone: '0400000001', svcAttended: 1, svcTotal: 2, prevSvcAttended: 0, prevSvcTotal: 0, grpTotal: 0, prevGrpTotal: 0, atRiskStatus: null }] }); } };
     function _revalidateMyStudents() {} function setApp(h) { out = h; } function shell(x) { return x; }
     function esc(x) { return String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
     function icS(k) { return '<i>' + k + '</i>'; } function icN(k) { return '<i>' + k + '</i>'; } function icEmpty() { return ''; }
     function helpTip() { return ''; } function L(k) { return k; } function _gradeList() { return [7, 8, 9]; } function quadGrades() { return []; }
     function getMyLeaderId() { return null; } function _prayersOn() { return true; } function fmtBday() { return ''; }
     function phoneLink(n, f, parent) { return '<a>' + n + (parent ? ' parent' : '') + '</a>'; }
     function html() { return out; } function lvF() { return _lvF; } function renderMyStudentsSpy() {}`,
    ['renderMyStudents', 'tLvF', 'html', 'gets', 'lvF']);

  it('the header is My Connections; the sub line only before a leader is picked', async () => {
    const a = ms(null); await a.renderMyStudents();
    expect(a.html()).toContain('My Connections');
    expect(a.html()).not.toContain('My Students');
    expect(a.html()).toContain('Select a leader to view their students');
    const b = ms('l1'); await b.renderMyStudents();
    expect(b.html()).not.toContain('Select a leader to view their students');
  });

  it('filters are Health-style .fc chips with Grade:/Gender: labels and All', async () => {
    const a = ms(null); await a.renderMyStudents();
    const h = a.html();
    expect(h).toContain('class="filter-row"');
    expect(h).toContain('Grade:');
    expect(h).toContain('Gender:');
    expect(h).toContain(`class="fc on" aria-pressed="true" onclick="tLvF('year',null)">All</button>`);
    expect(h).toContain(`onclick="tLvF('year','9')">9</button>`);
    expect(h).not.toContain('class="chip c-');
  });

  it('All clears a filter', () => {
    const a = ms(null);
    a.tLvF('year', '9'); expect([...a.lvF().year]).toEqual([9]);
    a.tLvF('year', null); expect(a.lvF().year.size).toBe(0);
  });

  it('rows are Health cards: name opens the profile, Gr line, both phones, prayers; template box below the list, collapsed', async () => {
    const a = ms('l1'); await a.renderMyStudents();
    const h = a.html();
    expect(h).toContain('Students (1)');
    expect(h).toContain('class="li rc ar-rc"');
    expect(h).toContain(`class="lk-nm rc-go" onclick="showStudentDetail('s1')"`);
    expect(h).toContain('Zed &lt;b&gt;Fictional&lt;/b&gt;');
    expect(h).not.toContain('<b>Fictional</b>');
    expect(h).toContain('Gr 9 · male');
    expect(h).toMatch(/class="rc-foot"[\s\S]*0400000000[\s\S]*0400000001 parent/);
    expect(h).toContain('Exams &lt;soon&gt;');
    expect(h).toContain(`openPrayerModal('s1')`);
    const tpl = h.indexOf('ms-sms-tpl');
    expect(tpl).toBeGreaterThan(h.indexOf('showStudentDetail'));
    expect(h).toMatch(/<div class="drop" id="ms-tpl-drop"[\s\S]*Message template[\s\S]*ms-sms-tpl/);
  });

  it('the summary and prayers load together', async () => {
    const src = extractFn(html, 'renderMyStudents');
    expect(src).toMatch(/Promise\.all\(\[\s*API\.get\(`\/connections\/leader\/\$\{_msLeader\}\/summary`\)/);
    const a = ms('l1'); await a.renderMyStudents();
    expect(a.gets).toEqual(['/connections/leader/l1/summary', '/prayers']);
  });
});
