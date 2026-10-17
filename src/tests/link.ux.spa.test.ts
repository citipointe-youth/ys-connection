// UX batch 2026-10-12 (Y2a): the pure parts of the link screens, run from the REAL page source (extract-and-evaluate).
import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml, extractFn } from './helpers/extract-fn';

const f = loadFns(['_lkAddDays', '_lkFirstName', '_lkSmsHref', '_lkFlowGroups', '_lkConsentWait', '_lkMyFlowRows', '_lkDay', 'fmtDay', '_lkLastReportLabel', '_lkWeekStart', '_lkWeeks',
  '_lkReports', '_lkWeekReports', '_lkWeekReport', '_lkReportDateFor', '_lkRevLine'], '');

const R = (o: any) => ({ rowId: o.rowId ?? 'r' + Math.random(), flowId: 'F1', flowName: 'Flow', stepId: 'S1', stepName: 'Step', stepOrder: 1,
  personId: 'p', name: 'Zed', due: null, ...o });

describe('T5 _lkFlowGroups: steps in Elvanto order, people A-Z, overdue = due before today', () => {
  const today = '2026-10-12';
  const rows = [
    R({ rowId: 'a', stepId: 'S2', stepName: 'Second', stepOrder: 2, name: 'Bea', due: '2026-10-01' }),
    R({ rowId: 'b', stepId: 'S1', stepName: 'First', stepOrder: 1, name: 'zoe', due: '2026-10-12' }),
    R({ rowId: 'c', stepId: 'S1', stepName: 'First', stepOrder: 1, name: 'Amy', due: '2026-10-11' }),
    R({ rowId: 'd', stepId: 'S1', stepName: 'First', stepOrder: 1, name: 'Mia', due: null }),
    R({ rowId: 'e', stepId: 'S2', stepName: 'Second', stepOrder: 2, name: 'Al', due: '2026-10-02' }),
    R({ rowId: 'g', flowId: 'F0', flowName: 'Alpha flow', stepId: 'S9', stepName: 'Only', stepOrder: 0, name: 'Cy', due: '2026-12-01' }),
  ];
  const g = f._lkFlowGroups(rows, today);
  it('flows A-Z, then steps by stepOrder', () => {
    expect(g.map((x: any) => x.flowName)).toEqual(['Alpha flow', 'Flow']);
    expect(g[1].steps.map((s: any) => s.stepName)).toEqual(['First', 'Second']);
  });
  it('people A-Z ignoring case', () => {
    expect(g[1].steps[0].rows.map((r: any) => r.name)).toEqual(['Amy', 'Mia', 'zoe']);
    expect(g[1].steps[1].rows.map((r: any) => r.name)).toEqual(['Al', 'Bea']);
  });
  it('overdue counts due < today only (today and no date are not overdue)', () => {
    expect(g[1].steps[0].overdue).toBe(1);
    expect(g[1].steps[1].overdue).toBe(2);
    expect(g[0].steps[0].overdue).toBe(0);
  });
});

describe('T5/T6 sms link', () => {
  it('first name', () => {
    expect(f._lkFirstName('  Sam   Lee ')).toBe('Sam');
    expect(f._lkFirstName('')).toBe('');
  });
  it('the body starts "Hey <first name> "; iOS joins with & and everything else with ?', () => {
    expect(f._lkSmsHref('0412345678', 'Hey Sam ', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari')).toBe('sms:0412345678&body=Hey%20Sam%20');
    expect(f._lkSmsHref('0412345678', 'Hey Sam ', 'Mozilla/5.0 (Linux; Android 14) Chrome')).toBe('sms:0412345678?body=Hey%20Sam%20');
    expect(f._lkSmsHref('0412345678', "Hey D'Angelo ", '')).toBe('sms:0412345678?body=Hey%20D%27Angelo%20');
  });
});

describe('T6 _lkMyFlowRows: only my assigned people, overdue first', () => {
  it('filters by assignedLeaderId and sorts overdue, then due, then name', () => {
    const rows = [
      R({ rowId: '1', name: 'Zara', due: '2026-10-20', assignedLeaderId: 'me' }),
      R({ rowId: '2', name: 'Amy', due: '2026-10-01', assignedLeaderId: 'me' }),
      R({ rowId: '3', name: 'Bob', due: '2026-10-05', assignedLeaderId: 'other' }),
      R({ rowId: '4', name: 'Cal', due: null, assignedLeaderId: 'me' }),
      R({ rowId: '5', name: 'Dan', due: '2026-10-03', assignedLeaderId: 'me' }),
      R({ rowId: '6', name: 'Eve' }),
    ];
    expect(f._lkMyFlowRows(rows, 'me', '2026-10-12').map((r: any) => r.name)).toEqual(['Amy', 'Dan', 'Zara', 'Cal']);
    expect(f._lkMyFlowRows(rows, null, '2026-10-12')).toEqual([]);
    expect(f._lkMyFlowRows(null, 'me', '2026-10-12')).toEqual([]);
  });
});

describe('T8 last-report label', () => {
  const rep = (o: any) => ({ reportId: 'x', date: '2026-10-09', time: '7:00 pm', didNotMeet: false, attendees: ['a', 'b', 'c'], guests: 2, serviceTimeId: null, editable: true, blocked: null, ...o });
  it('date and attendees plus guests', () => { expect(f._lkLastReportLabel({ lastReport: rep({}) })).toBe('Last report Fri 9 Oct · Attendance: 5'); });
  it('guests arriving as a string still add, not concatenate', () => { expect(f._lkLastReportLabel({ lastReport: rep({ guests: '2' }) })).toBe('Last report Fri 9 Oct · Attendance: 5'); });
  it('did not meet', () => { expect(f._lkLastReportLabel({ lastReport: rep({ didNotMeet: true, attendees: [], guests: 0 }) })).toBe('Last report Fri 9 Oct · Did not meet'); });
  it('no reports yet', () => { expect(f._lkLastReportLabel({ lastReport: null })).toBe('No reports yet'); expect(f._lkLastReportLabel({})).toBe('No reports yet'); });
});

describe('T8 week maths (Monday to Sunday, 8 weeks, newest first)', () => {
  it('week start is the Monday on or before the day', () => {
    expect(f._lkWeekStart('2026-10-12')).toBe('2026-10-12'); // Mon
    expect(f._lkWeekStart('2026-10-18')).toBe('2026-10-12'); // Sun
    expect(f._lkWeekStart('2026-10-14')).toBe('2026-10-12'); // Wed
    expect(f._lkWeekStart('2026-10-11')).toBe('2026-10-05'); // Sun of the week before
  });
  it('eight weeks, index 0 is this week, each seven days', () => {
    const w = f._lkWeeks('2026-10-14');
    expect(w).toHaveLength(8);
    expect(w[0]).toEqual({ start: '2026-10-12', end: '2026-10-18' });
    expect(w[1]).toEqual({ start: '2026-10-05', end: '2026-10-11' });
    expect(w[7]).toEqual({ start: '2026-08-24', end: '2026-08-30' });
  });
  it('a week finds its report from history, or the last report when it is newer than the push', () => {
    const rep = (id: string, date: string) => ({ reportId: id, date, attendees: [], guests: 0, didNotMeet: false });
    const g = { lastReport: rep('new', '2026-10-13'), history: [rep('h1', '2026-10-09'), rep('h2', '2026-10-02')] };
    const w = f._lkWeeks('2026-10-14');
    expect(f._lkWeekReport(g, w[0]).reportId).toBe('new');
    expect(f._lkWeekReport(g, w[1]).reportId).toBe('h1');
    expect(f._lkWeekReport(g, w[2]).reportId).toBe('h2');
    expect(f._lkWeekReport(g, w[3])).toBeNull();
    expect(f._lkWeekReport({ lastReport: rep('h1', '2026-10-09'), history: [rep('h1', '2026-10-09')] }, w[1]).reportId).toBe('h1');
    expect(f._lkWeekReport({}, w[0])).toBeNull();
  });
  it('the date to submit for an empty week: the meeting day, clipped to today, and only within 14 days', () => {
    const w = f._lkWeeks('2026-10-14'); // Wed 14 Oct
    expect(f._lkReportDateFor('Monday 7:00 pm', w[1], '2026-10-14')).toEqual({ state: 'ok', date: '2026-10-05' });
    expect(f._lkReportDateFor('Mon 6:30 PM', w[0], '2026-10-14')).toEqual({ state: 'ok', date: '2026-10-12' });
    expect(f._lkReportDateFor('Friday', w[0], '2026-10-14')).toEqual({ state: 'later', date: null });
    expect(f._lkReportDateFor('Monday', w[3], '2026-10-14')).toEqual({ state: 'old', date: null });
    expect(f._lkReportDateFor('', w[1], '2026-10-14')).toEqual({ state: 'ok', date: '2026-10-11' }); // no day named: the week's last day
  });
  it('RFIX: Tues, Weds, Thur and Thurs name their day, not the last day of the week', () => {
    const w = f._lkWeeks('2026-10-18'); // Sun 18 Oct; w[0] = Mon 12 .. Sun 18
    const day = (m: string) => f._lkReportDateFor(m, w[0], '2026-10-18').date;
    expect([day('Tues 7pm'), day('Weds 7pm'), day('Thur 7pm'), day('Thurs 7pm'), day('Tuesday'), day('Wednesday'), day('Thursday'), day('Sat 5pm'), day('Sunday')])
      .toEqual(['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-15', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-17', '2026-10-18']);
  });
});

describe('T9 console out of date line', () => {
  it('only when the console rev is lower than the app rev', () => {
    expect(f._lkRevLine({ consoleLinkRev: 1, appLinkRev: 2 })).toBe('Console out of date (rev 1, app expects 2): update and restart the console');
    expect(f._lkRevLine({ consoleLinkRev: 2, appLinkRev: 2 })).toBe('');
    expect(f._lkRevLine({ consoleLinkRev: null, appLinkRev: 2 })).toBe('');
    expect(f._lkRevLine(null)).toBe('');
  });
});

describe('the source keeps its rules', () => {
  const html = loadIndexHtml();
  it('the removed warning lines are gone from the whole page', () => {
    expect(html).not.toContain('Elvanto will show:');
    expect(html).not.toContain("Completing may send Elvanto");
  });
});

describe('T9 admin page source', () => {
  const html = loadIndexHtml();
  it('Matching, Shadow check and Activity each have a one-sentence tooltip', () => {
    for (const t of ['Pairs each Elvanto student with their YS student so check-ins and reports land on the right person; most pair themselves by name.',
      'Compares what the app would send with what Elvanto already shows, without sending anything.',
      'Every check-in, report and flow step sent from the app, newest first, with who did it.']) expect(html).toContain(`helpTip("${t}")`);
  });
  it('the first heading in a card has no top margin', () => { expect(html).toContain('.card>.lk-sec:first-child{margin-top:0}'); });
  it('each link page is guarded by its own feature, and the admin page by _linkAdminOn', () => {
    const f = extractFn(html, 'renderLink');
    expect(f).toContain("'link-checkin': 'checkin', 'link-groups': 'lifegroupReport', 'link-flows': 'flows'");
    expect(f).toContain("p === 'link-admin' ? !_linkAdminOn() : !_linkOn(feature)");
  });
});

describe('T12 _lkFlowGroups: the pushed steps seed every step, so an empty one shows', () => {
  it('an empty step is listed with no rows, in order', () => {
    const steps = [{ flowId: 'F1', flowName: 'Flow', stepId: 'S0', stepName: 'Empty', stepOrder: 3 },
      { flowId: 'F1', flowName: 'Flow', stepId: 'S1', stepName: 'Step', stepOrder: 1 }];
    const g = f._lkFlowGroups([R({ rowId: 'a', name: 'Amy' })], '2026-10-12', steps);
    expect(g[0].steps.map((s: any) => [s.stepName, s.rows.length])).toEqual([['Step', 1], ['Empty', 0]]);
    expect(f._lkFlowGroups([], '2026-10-12', steps)[0].steps.length).toBe(2);
  });
});
