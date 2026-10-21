// Round 2026-10-21 L2: "Forms with no person" where the parent typed several children ("Jamie, Riley & Morgan Sample").
// Operator ruling: suggest, one tap. Split on , & and; first-only parts borrow the last part's surname; one exact match each
// is a suggestion, none or 2+ is "pick"; one Link all tap posts one consentLink per suggested person. A one-name form is unchanged.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn, SITE_TIME_SRC } from './helpers/extract-fn';

const FNS = ['esc', 'tidyName', '_ikAnd', '_ikFormName', '_ikFormChip', '_ikFormLines', '_ikFormRowEnd', '_ikDmy', 'fmtDay',
  '_ikClCap', '_ikClNow', '_ikClText', '_ikClRow', '_ikClPick', '_ikClUnlink', '_ikClGo',
  '_ikClSplit', '_ikClSuggest', '_ikClRoster', '_ikClMulti', '_ikClBusy', '_ikClToLink', '_ikClWho', '_ikClMultiLines', '_ikClMultiAct', '_ikClAllOpen', '_ikClAllGo'];
const HTML = loadIndexHtml();
const BODY = SITE_TIME_SRC + '\n' + FNS.map((n) => extractFn(HTML, n)).join('\n');
const strip = (h: string) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const P = (n: number) => `9e000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ROSTER = [{ personId: P(1), name: 'Jamie Sample' }, { personId: P(2), name: 'Morgan Sample' }, { personId: P(3), name: 'Riley Sample' }, { personId: P(4), name: 'Riley Sample' },
  { personId: P(5), name: 'Sam Smith' }, { personId: P(6), name: 'Jo Brown' }, { personId: P(7), name: 'Andrew Sample' }];
const ST = { console: { online: true, capabilities: { consentLink: 'live' } } };

function env(rows: any[], roster: any = ROSTER) {
  const t: any = { posts: [], modal: '', draws: 0, fresh: 0, n: 0, answer: null };
  const I: any = { fixes: {} };
  const fns = new Function('__t', '__I', '__rows', '__roster', `
    const LINK = { cyouth: __roster };
    const API = { fresh: () => { __t.fresh++; return Promise.resolve({ rows: [] }); } };
    const _ik = () => __I; const _ikLk = () => ({ res: { rows: __rows } });
    const _ikDraw = () => { __t.draws++; }; const _ikFixPoll = () => {};
    const _lkDay = (d) => d; const _lkSeen = (d) => d; const _lkUuid = () => 'id-' + (++__t.n);
    const modal = (h) => { __t.modal = h; }; const closeModal = () => {};
    const _ikPost = async (items) => { __t.posts.push(items); return __t.answer ? __t.answer(items) : items.map((it) => ({ kind: 'action', id: it.id, outcome: 'saved' })); };
    const _ikOutcome = (results, id) => (results || []).find((r) => r && r.kind === 'action' && r.id === id) || null;
    ${BODY}
    return { ${FNS.join(', ')}, LINK };`)(t, I, rows, roster);
  return { fns, t, I };
}
const ROW = (o: any = {}) => ({ subId: P(90), name: 'Sample, Jamie, Riley & Morgan', submitted: '2026-10-09', status: 'approved', consentDate: '09/10/2026',
  contactOptOut: false, total: '', otherOptOuts: [], names: [], linked: null, formName: 'Jamie, Riley & Morgan Sample', ...o });

describe('_ikClSplit: the name split (one pure function)', () => {
  const { fns } = env([]);
  const T: [string, string[] | null][] = [
    ['Jamie, Riley & Morgan Sample', ['Jamie Sample', 'Riley Sample', 'Morgan Sample']],
    ['Jamie and Morgan Sample', ['Jamie Sample', 'Morgan Sample']],
    ['Jamie & Morgan Sample', ['Jamie Sample', 'Morgan Sample']],
    ['Jamie & Mary Jane Sample', ['Jamie Jane Sample', 'Mary Jane Sample']], // a middle name: "Jamie Jane Sample" matches nobody, so it goes to pick
    ['Jamie AND Morgan Sample', ['Jamie Sample', 'Morgan Sample']],
    ['Anne-Marie Sample', null],
    ['Sam Smith & Jo Brown', ['Sam Smith', 'Jo Brown']],
    ['Andrew Sample', null],
    ['Alexandra Sample', null],
    ['Andrew and Alexandra Sample', ['Andrew Sample', 'Alexandra Sample']],
    ['  Jamie ,   Riley   &   Morgan   Sample  ', ['Jamie Sample', 'Riley Sample', 'Morgan Sample']],
    ['Jamie, Riley, and Morgan Sample', ['Jamie Sample', 'Riley Sample', 'Morgan Sample']],
    ['Jamie,Riley', ['Jamie', 'Riley']], // no surname anywhere: each stays one word, so each is "pick"
    ['Jamie Sample & Morgan', ['Jamie Sample', 'Morgan']], // the last part has no surname to lend
    ['', null], [null as any, null], ['Jamie &', null],
  ];
  for (const [inp, out] of T) it(JSON.stringify(inp), () => expect(fns._ikClSplit(inp)).toEqual(out));
  it('every name comes back (the row shows 6 and says so)', () => expect(fns._ikClSplit('A, B, C, D, E, F, G Sample')).toHaveLength(7));
});

describe('_ikClSuggest: exactly one match = a suggestion, else pick', () => {
  const { fns } = env([]);
  it('one, two and no matches; case, accents and spacing ignored', () => {
    const s = fns._ikClSuggest(['jamie  SAMPLE', 'Riley Sample', 'Morgan Sámple', 'Jamie'], ROSTER);
    expect(s.map((x: any) => [x.personId, x.n])).toEqual([[P(1), 1], [null, 2], [P(2), 1], [null, 0]]);
    expect(s[0].who).toBe('Jamie Sample');
  });
});

describe('a multi-name unlinked row', () => {
  it('"Jamie & Mary Jane Sample": the middle-name split matches nobody -> pick (never a wrong person)', () => {
    const { fns } = env([]);
    const h = strip(fns._ikClRow(ROW({ formName: 'Jamie & Mary Jane Sample' }), 0, '', ST));
    expect(h).toContain('Jamie Jane Sample: pick: nobody has this name');
    expect(h).not.toContain('Link all');
  });
  it('more than 6 names: the first 6 are shown and the operator is told to use Find person for the rest', () => {
    const { fns } = env([]);
    const h = strip(fns._ikClRow(ROW({ formName: 'Jamie, Ann, Bo, Cy, Di, Ed, Fay Sample' }), 0, '', ST));
    expect(h).toContain('Ed Sample: pick');
    expect(h).not.toContain('Fay Sample');
    expect(h).toContain('Showing the first 6 names; use Find person for the rest.');
    expect(strip(fns._ikClRow(ROW(), 0, '', ST))).not.toContain('Showing the first');
  });
  it('after reopen (fixKey per person, cn:<sub>:<person>): each person keeps their own line; a one-name form shows its restored link', () => {
    const { fns, I } = env([]);
    I.fixes['cn:' + P(90) + ':' + P(1)] = { id: 'a', status: 'pending', since: Date.now() };
    I.fixes['cn:' + P(90) + ':' + P(2)] = { id: 'b', status: 'refused', detail: 'Only the admin can do this.' };
    const h = strip(fns._ikClRow(ROW(), 0, '', ST));
    expect(h).toContain('Jamie Sample: Waiting for the console.');
    expect(h).toContain('Morgan Sample: Not saved: Only the admin can do this.');
    expect(h).toContain('Link all'); // the refused one can be linked again
    const one = ROW({ formName: 'Andrew Sample', name: 'Sample, Andrew' });
    const h1 = strip(fns._ikClRow(one, 0, '', ST));
    expect(h1).toContain('Waiting for the console.');
    expect(h1).not.toContain('Find person'); // open: no second link while one is on the way
  });
  it('fix round 2 (N2): a one-name form shows the NEWEST restored line, and never a stale refused link to another person beside the current link', () => {
    const { fns, I } = env([]);
    const one = ROW({ formName: 'Andrew Sample', name: 'Sample, Andrew' });
    I.fixes['cn:' + P(90) + ':' + P(1)] = { id: 'a', status: 'refused', detail: 'Old try A.', createdAt: '2026-10-20T01:00:00Z' };
    I.fixes['cn:' + P(90) + ':' + P(7)] = { id: 'b', status: 'refused', detail: 'Newer try B.', createdAt: '2026-10-20T02:00:00Z' };
    expect(strip(fns._ikClRow(one, 0, '', ST))).toContain('Not saved: Newer try B.');
    expect(strip(fns._ikClRow(one, 0, '', ST))).not.toContain('Old try A.');
    const linked = { ...one, linked: { personId: P(7), name: 'Andrew Sample' } };
    I.fixes['cn:' + P(90) + ':' + P(7)] = { id: 'b', status: 'refused', detail: 'Newer try B.', createdAt: '2026-10-20T00:30:00Z' }; // now OLDER than A's
    const h = strip(fns._ikClRow(linked, 0, '', ST));
    expect(h).toContain('Linked to Andrew Sample (not in Elvanto)');
    expect(h).not.toContain('Old try A.'); // finished tries are stale next to the current link
    expect(h).not.toContain('Newer try B.');
  });
  it('shows each name found / pick, Link all (n), Find person; nothing is linked without a tap', () => {
    const { fns, t } = env([ROW()]);
    const h = strip(fns._ikClRow(ROW(), 0, '', ST));
    expect(h).toContain('Jamie Sample: found Jamie Sample');
    expect(h).toContain('Riley Sample: pick: 2 people have this name');
    expect(h).toContain('Morgan Sample: found Morgan Sample');
    expect(h).toContain('Link all (2)');
    expect(h).toContain('Find person');
    expect(h).not.toContain('Unlink');
    expect(t.posts).toHaveLength(0);
  });
  it('Link all: one confirm (DNC warned), then ONE batch with one consentLink per suggested person', async () => {
    const { fns, t, I } = env([ROW({ contactOptOut: true })]);
    fns._ikClAllOpen(0);
    expect(t.modal).toContain('Link this form to 2 people?');
    expect(strip(t.modal)).toContain('Jamie Sample &amp; Morgan Sample are DO NOT CONTACT');
    await fns._ikClAllGo();
    expect(t.posts).toHaveLength(1);
    expect(t.posts[0].map((x: any) => [x.type, x.payload])).toEqual([['consentLink', { subId: P(90), personId: P(1) }], ['consentLink', { subId: P(90), personId: P(2) }]]);
    expect(I.fixes['cn:' + P(90) + ':' + P(1)].status).toBe('pending');
    I.fixes['cn:' + P(90) + ':' + P(1)].status = 'sent';
    I.fixes['cn:' + P(90) + ':' + P(2)].status = 'sent';
    const h = strip(fns._ikClRow(ROW(), 0, '', ST));
    expect(h).toContain('Jamie Sample: linked');
    expect(h).toContain('Linked to Jamie Sample &amp; Morgan Sample (not in Elvanto)');
    expect(h).not.toContain('Link all');
    expect(h).toContain('Find person'); // Riley is still the operator's pick
    expect(h).toContain('Unlink');
  });
  it("the console's own links (linkedIds) count; Link all offers only the rest", () => {
    const { fns } = env([]);
    const h = strip(fns._ikClRow(ROW({ linked: { personId: P(1), name: 'Jamie Sample' } }), 0, '', ST));
    expect(h).toContain('Jamie Sample: linked');
    expect(h).toContain('Link all (1)');
  });
  it('Find person on a multi-name form adds that person (per-person key); Unlink undoes them all', async () => {
    const rows = [ROW({ linked: { personId: P(1), name: 'Jamie Sample, Morgan Sample' }, linkedIds: [P(1), P(2)] })];
    const { fns, t, I } = env(rows);
    I.clp = { i: 0, q: '', list: [ROSTER[2]] };
    fns._ikClPick(0);
    await fns._ikClGo();
    expect(t.posts[0][0].payload).toEqual({ subId: P(90), personId: P(3) });
    expect(I.fixes['cn:' + P(90) + ':' + P(3)].status).toBe('pending');
    fns._ikClUnlink(0);
    expect(t.modal).toContain('Unlink this form from Jamie Sample &amp; Morgan Sample?');
    await fns._ikClGo();
    expect(t.posts[1][0].payload).toEqual({ subId: P(90), personId: null });
    expect(Object.keys(I.fixes)).toEqual(['cn:' + P(90)]); // this phone's per-person links are gone with the unlink
    I.fixes['cn:' + P(90)].status = 'sent';
    expect(strip(fns._ikClRow(rows[0], 0, '', ST))).toContain('Link all (2)');
  });
  it('before the person list loads: names say checking, no Link all; the list is asked for once', () => {
    const { fns, t } = env([], null);
    const h = strip(fns._ikClRow(ROW(), 0, '', ST));
    expect(h).toContain('Jamie Sample: checking…');
    expect(h).not.toContain('Link all');
    fns._ikClRow(ROW(), 0, '', ST);
    expect(t.fresh).toBe(1);
  });
  it('a one-name form (or an older console with no formName) is exactly as before', () => {
    const { fns } = env([]);
    for (const r of [ROW({ formName: 'Andrew Sample', name: 'Sample, Andrew' }), ROW({ formName: undefined })]) {
      const h = strip(fns._ikClRow(r, 0, '', ST));
      expect(h).not.toContain('Names on this form');
      expect(h).not.toContain('Link all');
      expect(h).toContain('Find person');
    }
  });
});

describe('L2 consent plan step: consentFix result line', () => {
  const f = new Function(`${['_ikVal', '_ikNm', '_ikNames', '_ikPoss', '_ikResultLine'].map((n) => extractFn(HTML, n)).join('\n')}
    return { _ikResultLine };`)();
  const d = { forms: { student: { values: { first: 'Jamie', last: 'Sample' } }, parent: null } };
  it('reads Copied ..., present tense Copy ...', () => {
    expect(f._ikResultLine({ action: 'consentFix', role: 'student' }, d)).toBe("Copied the consent form to Jamie's profile");
    expect(f._ikResultLine({ action: 'consentFix', role: 'student' }, d, true)).toBe("Copy the consent form to Jamie's profile");
  });
});
