// r22 U1 (RV2): Trends fixes, Home Import tile, My Connections restyle.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn, loadFns } from './helpers/extract-fn';

const html = loadIndexHtml();

function trends(sessions: string[]) {
  const prelude = `
    var S = { user: { role: 'admin' }, page: 'trends', settings: { ministryConfig: { modules: {} } } };
    let _trTab = 'svc'; var out = '';
    const TREND_PATHS = ['/students', '/overview', '/trends', '/lifegroups/stats'];
    var data = {
      '/students': [], '/overview': {},
      '/trends': { terms: { current: { startDate: '2026-10-03', endDate: '2026-10-10' } },
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
