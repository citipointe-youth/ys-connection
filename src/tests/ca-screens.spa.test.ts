// Connection Audit screens (spec 2026-10-22 §6): the REAL ca* functions from public/index.html (extract-and-run).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadIndexHtml, loadFns, extractFn, countFn, SITE_TIME_SRC } from './helpers/extract-fn';

const HTML = loadIndexHtml();
const QUAD_SRC = HTML.match(/^const QUAD_LABELS = .*$/m)![0] + '\n' + HTML.match(/^const SIMPLE_QUAD_LABELS = .*$/m)![0];
const PRE = `${QUAD_SRC}
var S = { settings: { ministryConfig: { structure: { gradeMin: 7, gradeMax: 12, timeZone: 'Australia/Brisbane' }, logins: { simple: true } } } };`;
const NAMES = ['caNum', 'caCompare', 'caLabel', 'caWeekTiles', 'caHeadline', 'caSparkSvg', 'caLeak', 'caFlags', 'caFooter',
  'caFollowRows', 'caCsvRows', 'fmtDay', 'quadLabel', '_simpleLoginsOn', '_juniorMin', '_structure'];

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-22T00:00:00Z')); });
afterAll(() => { vi.useRealTimers(); });
const F = () => loadFns(NAMES, PRE);

// ── synthetic snapshot v2 (names are made up) ──
const Z = { youth: 0, lifegroup: 0, lgGroups: 0, connects: 0, decisions: 0 };
const w = (weekEnd: string, youth: number | null, o: Partial<typeof Z> = {}, byQuad: Record<string, Partial<typeof Z>> = {}) =>
  ({ weekEnd, ...Z, ...o, youth, byQuad });
const ok = (fedAt = '2026-10-16T11:14:00Z', exportedAt = '2026-10-16T11:10:00Z', fedBy = 'console'): any =>
  ({ status: 'ok', fedBy, fedAt, exportedAt, rows: 10, lastFailedAt: null, lastFailReason: null });
const TERMS = [
  { key: '2026-T3', label: 'Term 3 2026', year: 2026, ordinal: 3, startDate: '2026-07-17', endDate: '2026-09-18' },
  { key: '2026-T4', label: 'Term 4 2026', year: 2026, ordinal: 4, startDate: '2026-10-09', endDate: '2026-10-16' },
];
// Term 3: 40 a week on 4 nights; Term 4: 44 on 9 Oct, 48 on 16 Oct.
const T3 = ['2026-08-28', '2026-09-04', '2026-09-11', '2026-09-18'].map((d) => w(d, 40, { lifegroup: 20, lgGroups: 6, connects: 1, decisions: 2 }));
function snap(over: Record<string, unknown> = {}): any {
  return {
    version: 2, generatedAt: '2026-10-16T11:15:00Z', dataStartDate: '2026-07-17', dataEndDate: '2026-10-16', terms: TERMS,
    students: [], perTerm: {},
    lgStatsByTerm: { '2026-T4': Array.from({ length: 6 }, (_, i) => ({ lifegroupId: 'lg' + i, name: 'Group ' + i, grade: i < 3 ? 8 : 11,
      gender: i < 3 ? 'female' : 'male', quad: i < 3 ? 'g79' : 'b1012', members: 8, uniqueAttenders: 6, totalVisits: 10, weeksRan: 2, roster: [] })) },
    weekly: [...T3, w('2026-10-02', null), w('2026-10-09', 44, { lifegroup: 22, lgGroups: 6, connects: 2, decisions: 2 }),
      w('2026-10-16', 48, { lifegroup: 21, lgGroups: 6, connects: 3, decisions: 4 })],
    followUp: { drifting: [], decidedNoGroup: [], connectedNeverCame: [] }, signals: { quadDrop: null },
    sources: { service: ok(), group: ok(), team: ok(), connect: ok(), decision: ok() },
    quality: { skipped: [], notes: [], unmatched: [], duplicates: [] }, ...over,
  };
}

describe('caNum: one decimal below 10, whole numbers from 10', () => {
  const f = F();
  it('formats', () => {
    expect(f.caNum(1.44)).toBe('1.4');
    expect(f.caNum(2)).toBe('2');
    expect(f.caNum(41.3)).toBe('41');
    expect(f.caNum(9.96)).toBe('10');
    expect(f.caNum(null)).toBe('—');
  });
});

describe('caCompare: counts with a direction word, never a percentage', () => {
  const f = F();
  it('2 -> 4 decisions never produces "%"', () => {
    const c = f.caCompare(4, 2, 'week');
    expect(c).toEqual({ dir: 'up', diff: 2, kind: 'week', text: '▲ 2 on last week' });
    expect(c.text).not.toContain('%');
  });
  it('below a term average names the average', () => {
    expect(f.caCompare(38, 41, 'term').text).toBe('▼ 3 below term avg (41)');
    expect(f.caCompare(47, 41, 'term').text).toBe('▲ 6 above term avg (41)');
  });
  it('same band: at most max(1, 5% of the reference) reads "≈ same as"', () => {
    expect(f.caCompare(43, 41, 'week')).toMatchObject({ dir: 'same', text: '≈ same as last week' }); // 2 <= 2.05
    expect(f.caCompare(44, 41, 'week').dir).toBe('up');                                           // 3 > 2.05
    expect(f.caCompare(3, 2, 'week').dir).toBe('same');                                           // 1 <= max(1, 0.1)
    expect(f.caCompare(4, 2.6, 'term').text).toBe('▲ 1.4 above term avg (2.6)');                   // decimal rule
  });
  it('last-term average is labelled "last term avg"', () => {
    expect(f.caCompare(30, 40, 'lastterm').text).toBe('▼ 10 below last term avg (40)');
  });
  it('nothing to compare -> null', () => {
    expect(f.caCompare(5, null, 'week')).toBeNull();
    expect(f.caCompare(null, 5, 'week')).toBeNull();
  });
});

describe('caWeekTiles', () => {
  const f = F();
  it('latest week values; last week = the latest earlier youth night; < 3 term weeks -> last term avg', () => {
    const t = f.caWeekTiles(snap(), '', '2026-10-22');
    expect(t.weekEnd).toBe('2026-10-16');
    expect(t.tiles.youth.value).toBe(48);
    expect(t.tiles.youth.cmp.map((c: any) => c.text)).toEqual(['▲ 4 on last week', '▲ 8 above last term avg (40)']);
  });
  it('3+ term weeks -> term avg of the current term, excluding this week', () => {
    const s = snap({ terms: [{ ...TERMS[0], endDate: '2026-10-16' }] }); // one long term: 40,40,40,40,44 then 48
    const t = f.caWeekTiles(s, '', '2026-10-22');
    expect(t.tiles.youth.cmp[1].text).toBe('▲ 7.2 above term avg (41)'); // mean 40.8 -> "41"; the change 7.2 is below 10, so one decimal
  });
  it('small-number tiles show the comparison values, never a change or "%"', () => {
    const t = f.caWeekTiles(snap(), '', '2026-10-22');
    expect(t.tiles.decisions.value).toBe(4);
    expect(t.tiles.decisions.cmp).toEqual([]);
    expect(t.tiles.decisions.note).toBe('Last week 2 · last term avg 2 a week');
    expect(t.tiles.connects.note).toBe('Last week 2 · last term avg 1 a week');
    expect(JSON.stringify(t)).not.toContain('%');
  });
  it('a stale list gives "—" (null), not 0, with no comparisons and a gap at the latest spark point', () => {
    const s = snap();
    s.sources.decision = ok('2026-10-09T11:14:00Z', '2026-10-09T11:10:00Z');
    const d = f.caWeekTiles(s, '', '2026-10-22').tiles.decisions;
    expect(d).toMatchObject({ state: 'stale', value: null, note: 'Not updated since Fri 9 Oct', cmp: [] });
    expect(d.spark[d.spark.length - 1]).toBeNull();
  });
  it('the stale rule uses the site day of exportedAt: 23:59 and 00:00 Brisbane around a Friday are fresh, Thursday 23:59 is stale', () => {
    const at = (iso: string) => { const s = snap(); s.sources.decision = ok(iso, iso); return f.caWeekTiles(s, '', '2026-10-22').tiles.decisions.state; };
    expect(at('2026-10-16T13:59:00Z')).toBe('ok');    // Fri 16 Oct 23:59 Brisbane (13:59 UTC)
    expect(at('2026-10-16T14:00:00Z')).toBe('ok');    // Sat 17 Oct 00:00 Brisbane, still 16 Oct in UTC
    expect(at('2026-10-15T13:59:00Z')).toBe('stale'); // Thu 15 Oct 23:59 Brisbane
  });
  it('a list never received shows "No data yet"', () => {
    const s = snap();
    s.sources.connect = { ...ok(), status: 'missing', fedAt: null, exportedAt: null };
    expect(f.caWeekTiles(s, '', '2026-10-22').tiles.connects).toMatchObject({ state: 'nodata', value: null, note: 'No data yet', spark: [] });
  });
  it('youth null gives "No youth night"; its comparisons use the last week that had one', () => {
    const s = snap();
    s.weekly.push(w('2026-10-23', null, { lifegroup: 5, lgGroups: 2 }));
    s.sources = Object.fromEntries(Object.keys(s.sources).map((k) => [k, ok('2026-10-23T11:14:00Z', '2026-10-23T11:10:00Z')])) as any;
    const y = f.caWeekTiles(s, '', '2026-10-23').tiles.youth;
    expect(y).toMatchObject({ state: 'nonight', value: null, note: 'No youth night this week' });
    expect(y.cmp[0].text).toBe('▲ 4 on last week'); // 16 Oct (48) against 9 Oct (44)
    expect(y.spark[y.spark.length - 1]).toBeNull();
  });
  it('partial lifegroup count: "… marked so far", last-week comparison hidden, hollow latest dot', () => {
    const s = snap();
    s.weekly[s.weekly.length - 1] = w('2026-10-16', 48, { lifegroup: 9, lgGroups: 4, connects: 3, decisions: 4 });
    const lg = f.caWeekTiles(s, '', '2026-10-22').tiles.lifegroup;
    expect(lg.caption).toBe('4 of 6 groups marked so far');
    expect(lg.partial).toBe(true);
    expect(lg.cmp.some((c: any) => c.kind === 'week')).toBe(false);
    expect(f.caSparkSvg(lg.spark, lg.partial)).toMatch(/<circle[^>]*fill="none"/);
    const full = f.caWeekTiles(snap(), '', '2026-10-22').tiles.lifegroup;
    expect(full.caption).toBe('6 of 6 groups marked');
    expect(full.partial).toBe(false);
  });
  it('v1 snapshot (empty weekly) -> null', () => {
    expect(f.caWeekTiles(snap({ weekly: [] }), '', '2026-10-22')).toBeNull();
  });
});

describe('caHeadline', () => {
  const f = F();
  it('one sentence with youth, the last-week word and the forms', () => {
    expect(f.caHeadline(f.caWeekTiles(snap(), '', '2026-10-22'))).toBe('Fri 16 Oct: 48 at youth, 4 more than last week; 4 decisions and 3 new connects.');
  });
  it('same band says "about the same as last week"; singular words', () => {
    const s = snap();
    s.weekly[s.weekly.length - 1] = w('2026-10-16', 45, { connects: 1, decisions: 1, lgGroups: 6 });
    expect(f.caHeadline(f.caWeekTiles(s, '', '2026-10-22'))).toBe('Fri 16 Oct: 45 at youth, about the same as last week; 1 decision and 1 new connect.');
  });
  it('no youth night', () => {
    const s = snap();
    s.weekly.push(w('2026-10-23', null));
    s.sources = Object.fromEntries(Object.keys(s.sources).map((k) => [k, ok('2026-10-23T11:14:00Z', '2026-10-23T11:10:00Z')])) as any;
    expect(f.caHeadline(f.caWeekTiles(s, '', '2026-10-23'))).toBe('No youth night on Fri 23 Oct. Last: 16 Oct, 48 at youth.');
  });
  it('a stale list is left out of the sentence, not shown as 0', () => {
    const s = snap();
    s.sources.decision = ok('2026-10-09T11:14:00Z', '2026-10-09T11:10:00Z');
    expect(f.caHeadline(f.caWeekTiles(s, '', '2026-10-22'))).toBe('Fri 16 Oct: 48 at youth, 4 more than last week; 3 new connects.');
  });
  it('past year starts "Last recorded week of <year>:"', () => {
    expect(f.caHeadline(f.caWeekTiles(snap(), '', '2027-02-01'))).toMatch(/^Last recorded week of 2026: Fri 16 Oct, 48 at youth/);
  });
});

describe('caSparkSvg', () => {
  const f = F();
  it('null is a gap (a new segment), not a drop to 0', () => {
    const svg = f.caSparkSvg([10, null, 20]);
    expect((svg.match(/M/g) || []).length).toBe(2);
    expect(svg).not.toMatch(/L50\.0/);
  });
  it('the y scale starts at 0: 0 sits on the bottom, the max on the top', () => {
    expect(f.caSparkSvg([0, 5, 10])).toContain('d="M2.0 26.0 L50.0 14.0 L98.0 2.0"');
  });
  it('no axes; role=img with the values in the label; filled latest dot', () => {
    const svg = f.caSparkSvg([3, null, 4]);
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="Last 3 weeks: 3, no data, 4"');
    expect(svg).not.toMatch(/<line|<text|<rect/);
    expect(svg).toMatch(/<circle[^>]*fill="currentColor"/);
  });
});

describe('caLeak + caFlags', () => {
  const f = F();
  const R = [{ n: 1, v: 40 }, { n: 2, v: 30 }, { n: 3, v: 14 }, { n: 4, v: 12 }, { n: 5, v: 4 }];
  it('caLeak picks the lowest step-to-step share (first on a tie)', () => {
    expect(f.caLeak(R)).toEqual({ n: 4, fromN: 12, lost: 8 }); // 75, 47, 86, 33 -> step 4 -> 5
    expect(f.caLeak([{ n: 1, v: 10 }, { n: 2, v: 5 }, { n: 3, v: 2 }])).toEqual({ n: 2, fromN: 5, lost: 3 }); // 50 vs 40
    expect(f.caLeak([{ n: 1, v: 0 }, { n: 2, v: 0 }])).toBeNull();
  });
  it('drifting first, the quad drop next, drop-off last; at most three', () => {
    const fl = f.caFlags({ quadDrop: { quad: 'g1012', recentAvg: 11, termAvg: 15.2, dropPct: 28 } }, { n: 2, fromN: 30, lost: 12 }, 6, '');
    expect(fl.map((x: any) => x.kind)).toEqual(['drift', 'quad', 'leak']);
    expect(fl[0].text).toBe('6 regulars stopped coming (none of them seen in the last 4 weeks).');
    expect(fl[1].text).toBe('Senior Girls are down to 11 a week, from a term average of 15, two weeks running.');
    expect(fl[2].text).toBe("Biggest drop-off this term: 12 of 30 who came to youth haven't become regulars.");
    expect(fl.map((x: any) => x.text).join(' ')).not.toContain('%');
  });
  it('drop-off alone starts "Nothing urgent this week."', () => {
    const fl = f.caFlags({ quadDrop: null }, { n: 3, fromN: 30, lost: 12 }, 0, '');
    expect(fl).toHaveLength(1);
    expect(fl[0].text).toBe("Nothing urgent this week. Biggest drop-off this term: 12 of 30 regulars haven't reached a lifegroup.");
  });
  it('the quad flag shows only for its own quad (and All); never for No quad', () => {
    const sig = { quadDrop: { quad: 'g1012', recentAvg: 11, termAvg: 15, dropPct: 27 } };
    expect(f.caFlags(sig, null, 0, 'g1012').map((x: any) => x.kind)).toEqual(['quad']);
    expect(f.caFlags(sig, null, 0, 'b79')).toEqual([]);
    expect(f.caFlags(sig, null, 0, 'none')).toEqual([]);
  });
});

describe('caFooter', () => {
  const f = F();
  it('up to date: time, 5 of 5 lists, unlinked count, arrow', () => {
    const s = snap({ quality: { skipped: [], notes: [], unmatched: Array.from({ length: 12 }, (_, i) => ({ id: 'n:' + i })), duplicates: [] } });
    expect(f.caFooter(s, '2026-10-16T12:00:00Z')).toEqual({ outOfDate: false, n: 5, k: 12, text: 'Updated Fri 16 Oct, 9:14pm · 5 of 5 lists · 12 unlinked →' });
  });
  it('"all linked" when none unlinked; "(4 days ago)" from 2 days; "by upload" for a manual Youth service copy', () => {
    const s = snap();
    s.sources.service = ok('2026-10-16T11:14:00Z', '2026-10-16T11:10:00Z', 'manual');
    expect(f.caFooter(s, '2026-10-20T12:00:00Z').text).toBe('Updated Fri 16 Oct, 9:14pm (4 days ago) by upload · 5 of 5 lists · all linked →');
  });
  it('out of date contains the words "Out of date" and the stale list name', () => {
    const s = snap();
    s.sources.group = { ...ok('2026-10-02T11:14:00Z', '2026-10-02T11:10:00Z'), status: 'failed', lastFailReason: 'timeout' };
    const r = f.caFooter(s, '2026-10-16T12:00:00Z');
    expect(r.outOfDate).toBe(true);
    expect(r.text).toBe('⚠ Out of date: Lifegroups last updated Fri 2 Oct · 4 of 5 lists →');
  });
  it('a list never received is named first; nothing at all is out of date', () => {
    const s = snap();
    s.sources.decision = { ...ok(), status: 'missing', fedAt: null, exportedAt: null };
    expect(f.caFooter(s, '2026-10-16T12:00:00Z').text).toBe('⚠ Out of date: Decision forms not received yet · 4 of 5 lists →');
    expect(f.caFooter(null, '2026-10-16T12:00:00Z').outOfDate).toBe(true);
  });
  it('all five fresh but the newest older than 8 days -> out of date', () => {
    expect(f.caFooter(snap(), '2026-10-25T12:00:00Z').outOfDate).toBe(true);
  });
});

describe('caFollowRows + caCsvRows', () => {
  const f = F();
  const st = (id: string, last: string, o: Record<string, unknown> = {}) => ({ id, personId: null, firstName: 'Ava', lastName: last, gender: 'female',
    grade: 11, quad: 'g1012', caOnly: false, team: false, connect: null, decision: null, lastSeen: '2026-09-11', phone: '0400 000 001', phoneIsParent: false, ...o });
  const s = snap({
    students: [
      st('a', 'Zeta'), st('b', 'Alpha', { lastSeen: '2026-08-28' }), st('c', 'Beta', { phone: null }), st('d', 'Gamma', { dnc: true, phone: null }),
      st('e', 'Delta', { quad: 'b79', gender: 'male', grade: 8, phoneIsParent: true }), st('f', 'Echo', { quad: null, grade: null }),
      st('g', 'Fox', { decision: '2026-09-12' }), st('h', 'Golf', { connect: '2026-09-20', lastSeen: null }),
    ],
    followUp: { drifting: ['a', 'b', 'c', 'd', 'e', 'f'], decidedNoGroup: ['g'], connectedNeverCame: ['h'] },
  });
  it('sort: DNC and no-phone rows last; then newest first; ties by last name', () => {
    expect(f.caFollowRows(s, 'drifting', '').map((r: any) => r.id)).toEqual(['e', 'f', 'a', 'b', 'c', 'd']); // 11 Sep x3 by last name (Delta, Echo, Zeta), then 28 Aug, then no phone, DNC
  });
  it('why lines', () => {
    expect(f.caFollowRows(s, 'drifting', '').find((r: any) => r.id === 'a').why).toBe('Last seen 11 Sep (5 wks)');
    expect(f.caFollowRows(s, 'decidedNoGroup', '')[0].why).toBe('Decided 12 Sep, no lifegroup since');
    expect(f.caFollowRows(s, 'connectedNeverCame', '')[0].why).toBe('Connected 20 Sep, not at youth since');
  });
  it('quad filter: one quad, and "none" for people with no quad', () => {
    expect(f.caFollowRows(s, 'drifting', 'b79').map((r: any) => r.id)).toEqual(['e']);
    expect(f.caFollowRows(s, 'drifting', 'none').map((r: any) => r.id)).toEqual(['f']);
  });
  it('the CSV marks parent phones, says Do not contact, and adds Quad only for All', () => {
    const rows = f.caFollowRows(s, 'drifting', '');
    const csv = f.caCsvRows(rows, true);
    expect(csv[0]).toEqual(['Name', 'Quad', 'Grade', 'Gender', 'Phone', "Parent's phone", 'Reason', 'Last seen']);
    expect(csv.find((r: string[]) => r[0] === 'Ava Delta')).toEqual(['Ava Delta', 'Junior Guys', '8', 'Male', '0400 000 001', 'Yes', 'Stopped coming', '2026-09-11']);
    expect(csv.find((r: string[]) => r[0] === 'Ava Gamma')[4]).toBe('Do not contact');
    expect(csv.find((r: string[]) => r[0] === 'Ava Echo')[1]).toBe('No quad');
    expect(f.caCsvRows(f.caFollowRows(s, 'connectedNeverCame', ''), false)[1]).toEqual(['Ava Golf', '11', 'Female', '0400 000 001', 'No', 'Connected, not back yet', 'Not seen yet']);
  });
  it('the CSV defuses spreadsheet formulas (= + - @ tab CR at the start of a cell)', () => {
    const r = (name: string, phone: string | null = '0400 000 001') => ({ name, quad: 'g79', grade: 8, gender: 'female', phone, phoneIsParent: false, dnc: false, reason: 'Stopped coming', lastSeen: null });
    const csv = f.caCsvRows([r('=HYPERLINK("x")'), r('+1'), r('-1'), r('@SUM(A1)'), r('\tTab'), r('\rCr'), r('Ok', '+61 400 000 001')], false);
    expect(csv.slice(1).map((x: string[]) => x[0])).toEqual(["'=HYPERLINK(\"x\")", "'+1", "'-1", "'@SUM(A1)", "'\tTab", "'\rCr", 'Ok']);
    expect(csv[7][3]).toBe("'+61 400 000 001");
  });
});

describe('caLabel: the glossary words', () => {
  const f = F();
  it('sources, statuses, reasons, notes, quads', () => {
    expect(['service', 'group', 'team', 'connect', 'decision'].map((s) => f.caLabel('source', s))).toEqual(['Youth service', 'Lifegroups', 'Student team', 'Connect forms', 'Decision forms']);
    expect(f.caLabel('status', 'failed')).toBe("Didn't update (using the last copy that worked)");
    expect(f.caLabel('reason', 'budget')).toBe('Ran out of time on Friday');
    expect(f.caLabel('note', 'grade-out-of-range', { min: 7, max: 12 })).toBe('Grade outside Year 7–12, so grade is blank');
    expect(f.caLabel('quad', 'g79')).toBe('Junior Girls');
    expect(f.caLabel('quad', null)).toBe('No quad');
    expect(f.caLabel('upload', 'stale')).toBe('Not used: a newer copy is already here. Pick a later export date.');
  });
});

describe('quad filter consistency', () => {
  const f = F();
  const q = (g: number, b: number) => ({ g79: { youth: g, lifegroup: 1, lgGroups: 1, connects: 0, decisions: 0 }, b1012: { youth: b, lifegroup: 2, lgGroups: 2, connects: 1, decisions: 1 } });
  const s = snap({
    weekly: ['2026-09-25', '2026-10-02', '2026-10-09', '2026-10-16'].map((d, i) => ({ ...w(d, 30 + i, { lifegroup: 3, lgGroups: 3, connects: 1, decisions: 1 }), byQuad: q(10 + i, 20) })),
    signals: { quadDrop: { quad: 'b1012', recentAvg: 9, termAvg: 14, dropPct: 36 } },
    students: [{ id: 'x', firstName: 'Ava', lastName: 'Quad', quad: 'g79', lastSeen: '2026-09-11', phone: '0400 000 002' },
      { id: 'y', firstName: 'Noah', lastName: 'Quad', quad: 'b1012', lastSeen: '2026-09-11', phone: '0400 000 003' }],
    followUp: { drifting: ['x', 'y'], decidedNoGroup: [], connectedNeverCame: [] },
  });
  it('choosing a quad changes tiles, flags and follow-up rows together', () => {
    const all = f.caWeekTiles(s, '', '2026-10-22'), g = f.caWeekTiles(s, 'g79', '2026-10-22');
    expect(all.tiles.youth.value).toBe(33);
    expect(g.tiles.youth.value).toBe(13);
    expect(g.tiles.lifegroup.caption).toBe('1 of 3 groups marked so far'); // that quad's 3 lifegroups
    const drift = (quad: string) => f.caFollowRows(s, 'drifting', quad).length;
    expect([drift(''), drift('g79'), drift('b1012')]).toEqual([2, 1, 1]);
    expect(f.caFlags(s.signals, null, drift('g79'), 'g79').map((x: any) => x.kind)).toEqual(['drift']);
    expect(f.caFlags(s.signals, null, drift('b1012'), 'b1012').map((x: any) => x.kind)).toEqual(['drift', 'quad']);
  });
  it('the none bucket keeps a youth null as null', () => {
    const s2 = snap();
    s2.weekly.push(w('2026-10-23', null, {}, { none: { youth: 0 } }));
    s2.sources = Object.fromEntries(Object.keys(s2.sources).map((k) => [k, ok('2026-10-23T11:14:00Z', '2026-10-23T11:10:00Z')])) as any;
    expect(f.caWeekTiles(s2, 'none', '2026-10-23').tiles.youth.state).toBe('nonight');
  });
});

// ── Y10: the screens, run as the real CA module block with stubbed globals ──
const CA_BLOCK = HTML.slice(HTML.indexOf('/* ── CA MODULE START ── */'), HTML.indexOf('/* ── CA MODULE END ── */'));
const XLSX_SRC = readFileSync(join(__dirname, '..', '..', 'public', 'vendor', 'xlsx.full.min.js'), 'utf8');
const loadXlsx = () => new Function(`var module, define, window; ${XLSX_SRC}; return XLSX;`)();
const HELPERS = ['esc', 'fmtDay', 'quadLabel', '_simpleLoginsOn', '_juniorMin', '_gradeList', '_gradeWord', 'rowsToCsv', 'readXlsx'];
function caWorld(audit: any, o: { role?: string; gradeMin?: number } = {}) {
  const env: any = { audit, app: '', posts: [] as any[], toasts: [] as string[], downloads: [] as any[], went: [] as string[], dom: {} as any, reply: null, X: loadXlsx() };
  const { CA, S } = new Function('env', `
    var S = { user: { id: 'u1', role: ${JSON.stringify(o.role || 'director')} }, page: 'ca-week',
      settings: { ministryConfig: { structure: { gradeMin: ${o.gradeMin || 7}, gradeMax: 12 }, logins: { simple: true } } } };
    ${QUAD_SRC}
    ${SITE_TIME_SRC}
    ${HELPERS.map((n) => extractFn(HTML, n)).join('\n')}
    var L = (k) => ({ service: 'Youth', smallGroup: 'Lifegroup', smallGroupPlural: 'Lifegroups' })[k] || k;
    var Cache = { del() {} }, XLSX = env.X, _ensureXlsx = () => Promise.resolve();
    var API = {
      get: async (p) => p === '/audits' ? (env.audit ? [{ year: env.audit.year, label: String(env.audit.year), uploadedAt: '', termKeys: [] }] : [])
        : p.indexOf('/audits/') === 0 ? env.audit : {},
      post: async (p, b) => { env.posts.push({ p, b }); if (env.reply instanceof Error) throw env.reply; return env.reply; } };
    var setApp = (h) => { env.app = h; }, go = (p) => { env.went.push(p); }, toast = (m) => env.toasts.push(m), modal = () => {}, closeModal = () => {};
    var icS = () => '', helpTip = () => '', lgDisplayName = (n) => n;
    var accentRamp = () => ['#111', '#222', '#333', '#444', '#555'], accentRampPairs = () => accentRamp().map((c) => [c, c]);
    var _here = () => ({}), _still = () => true, _downloadText = (n, t, m) => env.downloads.push({ n, t, m });
    var document = { getElementById: (id) => env.dom[id] || null, querySelector: () => null }, window = {};
    ${CA_BLOCK}
    return { CA, S };`)(env);
  // go() is stubbed: a test sets S.page the way go() would, then renders.
  const show = async (p: string) => { S.page = p; await CA.render(p); return env.app; };
  return { CA, S, env, show };
}

const st2 = (id: string, o: Record<string, unknown> = {}) => ({ id, personId: id, firstName: 'Ava', lastName: 'L' + id, gender: 'female', grade: 11,
  quad: 'g1012', caOnly: false, team: false, connect: null, decision: null, lastSeen: '2026-10-16', phone: '0400 000 00' + id.length, phoneIsParent: false, ...o });
function audit26(over: Record<string, unknown> = {}) {
  const s: any = snap({
    students: [st2('a'), st2('b', { phoneIsParent: true, lastSeen: '2026-09-11' }), st2('c', { dnc: true, phone: null, lastSeen: '2026-09-11' }),
      st2('d', { connect: '2026-10-09', lastSeen: null }), st2('e', { caOnly: true, personId: null, decision: '2026-10-16', quad: 'b79', grade: 8, gender: 'male' }),
      st2('f', { grade: 6, quad: 'g79', lastSeen: '2026-09-04', phone: null })],
    perTerm: { '2026-T3': { key: '2026-T3', svcTotal: 4, inProgress: false, byStudent: { a: { svcAttended: 4, grpAttended: 2, grpTotal: 4 }, b: { svcAttended: 3, grpAttended: 0, grpTotal: 0 } } },
      '2026-T4': { key: '2026-T4', svcTotal: 2, inProgress: true, byStudent: { a: { svcAttended: 2, grpAttended: 1, grpTotal: 2 }, f: { svcAttended: 1, grpAttended: 0, grpTotal: 1 } } } },
    followUp: { drifting: ['b', 'c', 'f'], decidedNoGroup: ['e'], connectedNeverCame: ['d'] },
    ...over,
  });
  return { year: 2026, snapshot: s };
}

describe('Y10 screens', () => {
  it('This week: three tabs with the Follow up total, quad chips with counts, headline, tiles, sparklines, footer', async () => {
    const w = caWorld(audit26());
    const html = await w.show('ca-week');
    expect(html).toMatch(/class="ca-tab on" onclick="go\('ca-week'\)">This week</);
    expect(html).toContain('>Follow up · 5<');
    expect(html).toContain('>Term report<');
    expect(html).toContain('>All (6)<');
    expect(html).toContain('>Junior Girls (1)<');
    expect(html).toContain('>No quad (0)<');
    expect(html).toContain('Fri 16 Oct: 48 at youth, 4 more than last week; 4 decisions and 3 new connects.');
    expect((html.match(/class="ca-spark"/g) || []).length).toBe(4);
    expect(html).toContain('Updated Fri 16 Oct, 9:14pm (5 days ago) · 5 of 5 lists · all linked →');
    expect(html).toContain('onclick="go(\'ca-quality\');return false"');
    expect(html).not.toMatch(/Period/); // the term picker lives on the Term report
  });
  it('flags: drifting first with a Call list link into Follow up; the drop-off flag last', async () => {
    const w = caWorld(audit26());
    const html = await w.show('ca-week');
    const iDrift = html.indexOf('3 regulars stopped coming'), iLeak = html.indexOf('Biggest drop-off this term');
    expect(iDrift).toBeGreaterThan(-1);
    expect(iLeak).toBeGreaterThan(iDrift);
    expect(html).toContain(`CA.follow('drifting');return false">Call list →`);
  });
  it('choosing a quad repaints This week for that quad', async () => {
    const w = caWorld(audit26());
    await w.show('ca-week');
    w.CA.setQuad('b79');
    await new Promise((r) => setTimeout(r, 0));
    expect(w.env.app).toMatch(/class="ca-chip2 on"[^>]*>Junior Guys \(1\)</);
    expect(w.env.app).not.toContain('regulars stopped coming'); // nobody in b79 drifted
  });
  it('no row for the year, but stored lists: the footer still shows each list\'s status (Y8 sources-only reply)', async () => {
    const sources: any = { service: { status: 'missing', fedBy: null, fedAt: null, exportedAt: null, rows: 0, lastFailedAt: null, lastFailReason: null },
      group: ok(), team: { status: 'missing', fedAt: null }, connect: { status: 'missing', fedAt: null }, decision: { status: 'missing', fedAt: null } };
    const html = await caWorld({ year: 2026, snapshot: null, sources }).show('ca-week');
    expect(html).toContain('No data for 2026 yet. The console fills this after the first Friday sync.');
    expect(html).toContain('⚠ Out of date: Youth service not received yet · 1 of 5 lists →');
    // Fix round 1: Data check reads the same per-list status as the footer.
    const q = await caWorld({ year: 2026, snapshot: null, sources }).show('ca-quality');
    expect(q).toContain('1 of 5 lists up to date.');
    expect(q).toMatch(/<td>Lifegroups<\/td><td>Up to date/);
  });
  it('empty states: no row for the year; v1 snapshot', async () => {
    expect(await caWorld(null).show('ca-week')).toContain('No data for 2026 yet. The console fills this after the first Friday sync.');
    expect(await caWorld(null).show('ca-follow')).toContain('No data for 2026 yet.');
    const v1 = audit26({ weekly: [] });
    expect(await caWorld(v1).show('ca-week')).toContain("Weekly numbers aren't available for 2026. See Term report.");
    expect(await caWorld(v1).show('ca-follow')).toContain('Follow-up lists start with data from the console.');
  });
  it('Follow up: three <details>, the first non-empty open; Call/Text, parent wording, DNC, no phone', async () => {
    const html = await caWorld(audit26()).show('ca-follow');
    expect((html.match(/<details class="card ca-fu"/g) || []).length).toBe(3);
    expect(html).toMatch(/<details class="card ca-fu" open><summary><b>Stopped coming<\/b> · 3/);
    expect(html).toContain('href="tel:0400000001">Call parent</a>');
    expect(html).toContain('href="sms:0400000001">Text parent</a>');
    expect(html).toContain('Do not contact');
    expect(html).toContain('No phone on file');
    expect(html).toContain("<span class=\"chip c-neutral\">Parent's phone</span>");
    expect(html).toContain('Download list (CSV)');
  });
  it('Follow up CSV: the selected quad, or all quads with a Quad column; parent phones marked', async () => {
    const w = caWorld(audit26());
    await w.show('ca-follow');
    w.CA.followCsv();
    expect(w.env.downloads[0].n).toMatch(/^follow-up-all-2026-10-22\.csv$/);
    expect(w.env.downloads[0].m).toBe('text/csv');
    expect(w.env.downloads[0].t.split('\r\n')[0]).toBe('"Name","Quad","Grade","Gender","Phone","Parent\'s phone","Reason","Last seen"');
    expect(w.env.downloads[0].t).toContain('"Ava Lb","Senior Girls","11","Female","0400 000 001","Yes","Stopped coming","2026-09-11"');
    w.CA.setQuad('b79');
    w.CA.followCsv();
    expect(w.env.downloads[1].t.split('\r\n')[0]).not.toContain('Quad');
  });
  it('Term report: story order, Open slides, Year so far, What to do counts', async () => {
    const html = await caWorld(audit26()).show('ca-term');
    const order = ['Open slides', 'Where we are', 'id="ca-drop"', 'Junior &amp; Senior', 'id="ca-lg"', 'What to do', 'id="ca-people"'].map((s) => html.indexOf(s));
    expect(order.every((x) => x > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('>Year so far<');
    expect(html).toContain('2026 so far: ');
    expect(html).toContain('3 stopped coming</a>');
    expect(html).toContain('1 decided, not in a lifegroup</a>');
    expect(html).toContain('1 connected, not back yet</a>');
    expect(html).toContain('No quad (0)');
  });
  it('Data check: summary, the lists table words; Upload a file for admins only', async () => {
    const a = audit26();
    a.snapshot.sources.group = { ...a.snapshot.sources.group, status: 'failed', lastFailedAt: '2026-10-16T11:12:00Z', lastFailReason: 'timeout' };
    const html = await caWorld(a).show('ca-quality');
    expect(html).toContain('4 of 5 lists up to date. 0 entries left out, 0 unlinked names, 0 might be the same person.');
    expect(html).toContain('Didn&#39;t update (using the last copy that worked)');
    expect(html).toContain('Fri 16 Oct: Elvanto took too long');
    expect(html).not.toContain('Upload a file');
    expect(await caWorld(audit26(), { role: 'admin' }).show('ca-quality')).toContain('Upload a file');
  });
  it('model(): marks by id (connect / form-only decision), phones from students, cohorts over gradeRange, weekly sessions', async () => {
    const w = caWorld(audit26(), { gradeMin: 6 });
    await w.show('ca-term'); // loads the year
    const m = await w.CA.model();
    const d = m.people.find((p: any) => p.id === 'd'), e = m.people.find((p: any) => p.id === 'e');
    expect(d).toMatchObject({ stage: 1, conn: true, connect: '2026-10-09' });
    expect(e).toMatchObject({ caOnly: true, stage: 1, dec: true, quad: 'b79' });
    expect(m.people.find((p: any) => p.id === 'b').s).toMatchObject({ ph: '0400 000 001', pp: true });
    expect(m.groups.some((g: any) => g.grade === 6)).toBe(true);
    expect(m.kpis.avgFri).toBe(42); // mean of the 6 youth nights: 40,40,40,40,44,48 -> 42 (the old /trends read gave 0)
  });
});

describe('Y10 Upload a file', () => {
  const csv = (s: string) => new TextEncoder().encode(s).buffer;
  const up = async (reply: any, file: { name: string; buf: ArrayBuffer }, day = '2026-10-22', src = 'group') => {
    const w = caWorld(audit26(), { role: 'admin' });
    await w.show('ca-quality');
    w.env.reply = reply;
    w.env.dom = { 'ca-up-src': { value: src }, 'ca-up-day': { value: day }, 'ca-up-file': { files: [{ name: file.name, arrayBuffer: async () => file.buf }] } };
    await w.CA.uploadSource();
    return w.env;
  };
  it('posts the cell table to /audits/sources/:source; stored -> "Uploaded. The audit has been updated."', async () => {
    const env = await up({ applied: true, source: 'group', status: 'stored' }, { name: 'g.csv', buf: csv('Name,03/10/2026\nAlpha,Y\n') });
    expect(env.posts[0].p).toBe('/audits/sources/group');
    expect(env.posts[0].b).toEqual({ headers: ['Name', '03/10/2026'], rows: [['Alpha', 'Y']], exportedAt: '2026-10-22T00:00:00.000Z' });
    expect(env.toasts).toContain('Uploaded. The audit has been updated.');
  });
  it('stale, shape and 400 messages', async () => {
    expect((await up({ applied: false, source: 'group', status: 'stale' }, { name: 'g.csv', buf: csv('A\nb\n') })).toasts)
      .toContain('Not used: a newer copy is already here. Pick a later export date.');
    expect((await up({ applied: false, source: 'group', status: 'shape' }, { name: 'g.csv', buf: csv('A\nb\n') })).toasts)
      .toContain('This file is missing a column the audit needs (names or dates). Check you exported the right Elvanto list.');
    expect((await up(Object.assign(new Error('bad'), { status: 400 }), { name: 'g.csv', buf: csv('A\nb\n') })).toasts)
      .toContain("This file couldn't be used. It may be too big or have unexpected columns.");
  });
  it('a past date is sent as noon on that day at the location (31 Dec stays in its year)', async () => {
    const env = await up({ applied: false, source: 'group', status: 'stale' }, { name: 'g.csv', buf: csv('A\nb\n') }, '2025-12-31');
    expect(env.posts[0].b.exportedAt).toBe('2025-12-31T02:00:00.000Z');
  });
  // Spec delta 38: a raw Elvanto form export is trimmed to the allowlist before it is posted (same rule as console C4 toTable).
  const q = (rows: string[][]) => rows.map((r) => r.map((c) => '"' + c.replace(/"/g, '""') + '"').join(',')).join('\n') + '\n';
  // ALL 12 real headers of "Brisbane - Youth - Decision Form" (P0, operator sample 2026-10-22), synthetic values.
  const DEC_HEADERS = ['Date Submitted', 'Submission Status', 'Person', 'Person Status', 'First Name', 'Gender', "What's your phone number?",
    "Citipointe Location (Hint: Click 'Brisbane')", 'Last Name', 'What grade are you in?',
    "When did you make a decision to follow Jesus? (Hint: it's today's date)", 'Who invited you to Youth Society? (eg. My friend John Smith invited me)'];
  const DEC_ROW = ['16/10/2026 7:43 PM', 'Completed', 'Marlowe Finch', 'Visitor', 'Marlowe', 'Male', '0400 000 003',
    'Brisbane', 'Finch', '10', 'Tonight at youth', 'My friend Sawyer Lang invited me'];
  it('decision: the 12 real headers -> the 5 allowlisted, in the export order; no dropped value is posted', async () => {
    const env = await up({ applied: true, source: 'decision', status: 'stored' }, { name: 'd.csv', buf: csv(q([DEC_HEADERS, DEC_ROW])) }, '2026-10-22', 'decision');
    expect(env.posts[0].p).toBe('/audits/sources/decision');
    expect(env.posts[0].b.headers).toEqual(['Date Submitted', 'First Name', 'Gender', 'Last Name', 'What grade are you in?']);
    expect(env.posts[0].b.rows).toEqual([['16/10/2026 7:43 PM', 'Marlowe', 'Male', 'Finch', '10']]);
    const body = JSON.stringify(env.posts[0].b);
    for (const v of ['Completed', 'Marlowe Finch', 'Visitor', '0400 000 003', 'Brisbane', 'Tonight at youth', 'Sawyer Lang', 'phone number']) expect(body, v).not.toContain(v);
  });
  it('connect: a file with no name or date column left after the filter -> the server says shape -> the missing-column message', async () => {
    const env = await up({ applied: false, source: 'connect', status: 'shape' },
      { name: 'c.csv', buf: csv(q([['Gender', 'Prayer request'], ['F', 'Pray for my exam']])) }, '2026-10-22', 'connect');
    expect(env.posts[0].b).toMatchObject({ headers: ['Gender'], rows: [['F']] });
    expect(JSON.stringify(env.posts[0].b)).not.toContain('Pray for my exam');
    expect(env.toasts).toContain('This file is missing a column the audit needs (names or dates). Check you exported the right Elvanto list.');
  });
});

// The SPA's copy of the form allowlist can't drift from the contract (the console's byte copy is pinned by Y1/C4 the same way).
// A top-level const, so it is pulled out the way QUAD_SRC is (one line, run in a Function), not with extractFn.
import { AUDIT_FORM_HEADERS } from '../core/link-contract';
describe('CA_FORM_HEADERS', () => {
  it('equals link-contract AUDIT_FORM_HEADERS, in order', () => {
    const line = HTML.match(/^const CA_FORM_HEADERS=.*$/m)![0];
    expect(new Function(`${line}\nreturn CA_FORM_HEADERS;`)()).toEqual([...AUDIT_FORM_HEADERS]);
  });
});

describe('caReadTable', () => {
  const X = loadXlsx();
  const f = () => new Function('X', `var XLSX = X; var _ensureXlsx = () => Promise.resolve();
    ${extractFn(HTML, 'readXlsx')}\n${extractFn(HTML, 'caReadTable')}\nreturn caReadTable;`)(X);
  it('UTF-8 CSV: BOM dropped, quoted multi-line cell, dates kept as text, every row as wide as the sheet, blank rows dropped', async () => {
    const t = await f()(new TextEncoder().encode('\uFEFFFirst Name,Date Submitted,Note\n"Zoë","03/10/2026","two\nlines"\n,,\nNoah,2026-10-03\nMia,1,2,3\n').buffer, 'connect.csv');
    expect(t.headers).toEqual(['First Name', 'Date Submitted', 'Note', '']); // a header may be empty (contract §3.2)
    expect(t.rows).toEqual([['Zoë', '03/10/2026', 'two\nlines', ''], ['Noah', '2026-10-03', '', ''], ['Mia', '1', '2', '3']]);
  });
  it('windows-1252 CSV falls back from UTF-8', async () => {
    const t = await f()(new Uint8Array([0x4e, 0x61, 0x6d, 0x65, 0x0a, 0x5a, 0x6f, 0xeb, 0x0a]).buffer, 'x.csv');
    expect(t.rows).toEqual([['Zoë']]);
  });
  it('xlsx: date cells come out yyyy-mm-dd', async () => {
    const ws = X.utils.aoa_to_sheet([['First Name', 'Date Submitted'], ['Ava', new Date(2026, 9, 3)]], { cellDates: true });
    const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, 'S');
    const t = await f()(X.write(wb, { type: 'array', bookType: 'xlsx' }), 'connect.xlsx');
    expect(t).toEqual({ headers: ['First Name', 'Date Submitted'], rows: [['Ava', '2026-10-03']] });
    // The Elvanto Decision export (operator sample 2026-10-22) stores Date Submitted as a NUMERIC cell with a date format
    // (Excel serial 46317 = 22 Oct 2026, a fraction = the time). readXlsx reads with cellDates, so it is yyyy-mm-dd too.
    const ns = X.utils.aoa_to_sheet([['Date Submitted', 'First Name'], [46317, 'Casey'], [46317.82, 'Riley']]);
    ns['A2'].z = 'dd/mm/yyyy'; ns['A3'].z = 'dd/mm/yyyy hh:mm';
    const nb = X.utils.book_new(); X.utils.book_append_sheet(nb, ns, 'S');
    const n = await f()(X.write(nb, { type: 'array', bookType: 'xlsx' }), 'Form-Submissions_Decision.xlsx');
    expect(n).toEqual({ headers: ['Date Submitted', 'First Name'], rows: [['2026-10-22', 'Casey'], ['2026-10-22', 'Riley']] });
  });
});

describe('Y10 structure', () => {
  it('nav item is ca-week and tagged as a CA hook', () => {
    expect(HTML).toContain("const caItem = { id:'ca-week', ic:'link', label:'Connection Audit', mbl:'Connection Audit' }; /*CA-HOOK*/");
  });
  it('call/text buttons are at least 44x44 with an 8px gap', () => {
    expect(HTML).toContain('.ca-act{min-width:44px;min-height:44px;');
    expect(HTML).toContain('.ca-acts{display:flex;gap:8px;');
  });
  it('deck currency text has single spaces around the date', () => {
    const b = extractFn(HTML, '_buildDeckBody');
    expect(b).toContain("was last updated '+upDate");
    expect(b).toContain("was last saved on '+upDate");
    expect(b).not.toContain("const upDate=' '+");
  });
  it('the cohort loop uses the grade range, not 7..12', () => {
    expect(extractFn(HTML, 'model')).toContain('for(const gr of _gradeList())');
    expect(extractFn(HTML, 'model')).not.toMatch(/gr<=12|norm\(r\.name\)|st\.uploads/);
  });
});

// ── Y11: what the SPA no longer has (spec §6.3), what it keeps, and the module-removal contract ──
describe('Y11 deletions and contract', () => {
  const start = HTML.indexOf('/* ── CA MODULE START ── */'), end = HTML.indexOf('/* ── CA MODULE END ── */');
  const block = HTML.slice(start, end);
  it('three tab ids, no ca-data / ca-overview anywhere', () => {
    expect(block).toContain("const T=[['ca-week','This week'],['ca-follow','Follow up'+(n?' · '+n:'')],['ca-term','Term report']];");
    expect(HTML).not.toMatch(/ca-data|ca-overview|ca-funnel'|ca-groups'|ca-people'/);
  });
  it('flows, the Data tab and the localStorage shim are gone', () => {
    for (const fn of ['flowStats', 'parseFlows', 'saveAudit', 'isoDate', 'parseRows', 'parseMatrixRows', 'fmtAdmin', 'emptyUploads', 'restore',
      'stale', 'dismissWarn', 'gfilter', 'lgfilter', 'pquad', 'fopen', 'rOverview', 'rData', 'pick', 'upload', 'exportMenu', 'exportQuad', 'h32'])
      expect(countFn(HTML, fn), fn).toBe(0);
    expect(HTML).not.toMatch(/carry\(|ca_audit_v4|PENDING|New-person follow-up|\bst\.uploads/);
  });
  it('the Import screen parsers stay (detectAndPreview), and so does computeQuad (spa-ux-y2b)', () => {
    for (const fn of ['parseCSV', 'parseGroupCSV', 'splitCSVLine', '_extractHeaderDate', 'detectAndPreview', 'computeQuad']) expect(countFn(HTML, fn), fn).toBe(1);
  });
  it('every ca* function sits inside the CA module markers; the tested ones are top-level, before the IIFE', () => {
    const iife = HTML.indexOf('const CA=(()=>{');
    for (const m of HTML.matchAll(/function (ca[A-Z]\w*)\(/g)) { expect(m.index!, m[1]).toBeGreaterThan(start); expect(m.index!, m[1]).toBeLessThan(end); }
    for (const fn of ['caNum', 'caCompare', 'caLabel', 'caWeekTiles', 'caHeadline', 'caSparkSvg', 'caLeak', 'caFlags', 'caFooter', 'caFollowRows',
      'caCsvRows', 'caReadTable', 'caExportedAt']) {
      expect(countFn(HTML, fn), fn).toBe(1);
      expect(HTML.indexOf('function ' + fn + '('), fn).toBeLessThan(iife);
    }
  });
  it('outside the module, every line that touches CA carries /*CA-HOOK*/', () => {
    const outside = (HTML.slice(0, start) + HTML.slice(end)).split('\n').filter((l) => /\bCA\.|'ca-[a-z]/.test(l));
    expect(outside.length).toBeGreaterThan(3);
    for (const l of outside) expect(l).toContain('/*CA-HOOK*/');
  });
});

describe('Y11 Error log Who? for audit codes', () => {
  it('audit- codes open Data check for the current year, without calling /admin/reconcile/latest', async () => {
    const calls: string[] = [];
    const elWho = new Function('env', `var window = { CA: 1 }, CA = { reset: () => env.push('reset') }, go = (p) => env.push('go ' + p);
      var API = { fresh: async (p) => { env.push('fresh ' + p); return {}; } };
      ${extractFn(HTML, 'elWho')}; return elWho;`)(calls);
    await elWho('audit-source-failed');
    expect(calls).toEqual(['reset', 'go ca-quality']);
  });
  it('an audit error row has a Who? button; reconcile rows keep theirs', () => {
    const f = loadFns(['esc', 'fmtDay', '_laFmtBrisbane', '_laRelTime', '_elIsNew', '_elRowHtml'], 'var S = {};');
    const row = (category: string, code: string) => ({ id: 'x', category, code, route: 'group', count: 1, counted: true, lastSeen: '2026-10-16T11:15:00Z', ignored: false, line1: 'l1', line2: 'l2' });
    expect(f._elRowHtml(row('audit', 'audit-rows-skipped'), 0, false)).toContain(`onclick="elWho('audit-rows-skipped')">Who?</button>`);
    expect(f._elRowHtml(row('reconcile', 'recon-unmatched'), 0, false)).toContain('Who?');
    expect(f._elRowHtml(row('server', 'INTERNAL_ERROR'), 0, false)).not.toContain('Who?');
  });
});

describe('sessSeries + fuPhone (final review I2, M4)', () => {
  it('a picked term keeps its last youth night: term dates are week starts, weekEnd = start + 6', () => {
    const A = { terms: [{ key: 'T', startDate: '2026-10-03', endDate: '2026-10-10' }],
      weekly: [w('2026-10-02', 30), w('2026-10-09', 44), w('2026-10-16', 48), w('2026-10-23', 50)] };
    const f = loadFns(['sessSeries'], `var AUDIT = ${JSON.stringify(A)}; var TERM = 'T';`);
    expect(f.sessSeries()).toEqual([{ date: '2026-10-09', v: 44 }, { date: '2026-10-16', v: 48 }]);
  });
  it('+61 phones dial as 04 in tel:/sms:, the shown text is unchanged', () => {
    const { fuPhone } = loadFns(['fuPhone', 'esc']);
    const html = fuPhone({ phone: '61400000001' }, true);
    expect(html).toContain('href="tel:0400000001"');
    expect(html).toContain('>61400000001<');
    expect(fuPhone({ phone: '+61 400 000 001' }, false)).toContain('href="sms:0400000001"');
  });
});
