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
