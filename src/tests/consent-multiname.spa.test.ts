// Round 2026-10-21 L2: "Forms with no person" where the parent typed several children ("Luke, Daniel & Claire Seo").
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
const ROSTER = [{ personId: P(1), name: 'Luke Seo' }, { personId: P(2), name: 'Claire Seo' }, { personId: P(3), name: 'Daniel Seo' }, { personId: P(4), name: 'Daniel Seo' },
  { personId: P(5), name: 'Sam Smith' }, { personId: P(6), name: 'Jo Brown' }, { personId: P(7), name: 'Andrew Seo' }];
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
const ROW = (o: any = {}) => ({ subId: P(90), name: 'Seo, Luke, Daniel & Claire', submitted: '2026-10-09', status: 'approved', consentDate: '09/10/2026',
  contactOptOut: false, total: '', otherOptOuts: [], names: [], linked: null, formName: 'Luke, Daniel & Claire Seo', ...o });

describe('_ikClSplit: the name split (one pure function)', () => {
  const { fns } = env([]);
  const T: [string, string[] | null][] = [
    ['Luke, Daniel & Claire Seo', ['Luke Seo', 'Daniel Seo', 'Claire Seo']],
    ['Luke and Claire Seo', ['Luke Seo', 'Claire Seo']],
    ['Luke & Claire Seo', ['Luke Seo', 'Claire Seo']],
    ['Luke AND Claire Seo', ['Luke Seo', 'Claire Seo']],
    ['Anne-Marie Seo', null],
    ['Sam Smith & Jo Brown', ['Sam Smith', 'Jo Brown']],
    ['Andrew Seo', null],
    ['Alexandra Seo', null],
    ['Andrew and Alexandra Seo', ['Andrew Seo', 'Alexandra Seo']],
    ['  Luke ,   Daniel   &   Claire   Seo  ', ['Luke Seo', 'Daniel Seo', 'Claire Seo']],
    ['Luke, Daniel, and Claire Seo', ['Luke Seo', 'Daniel Seo', 'Claire Seo']],
    ['Luke,Daniel', ['Luke', 'Daniel']], // no surname anywhere: each stays one word, so each is "pick"
    ['Luke Seo & Claire', ['Luke Seo', 'Claire']], // the last part has no surname to lend
    ['', null], [null as any, null], ['Luke &', null],
  ];
  for (const [inp, out] of T) it(JSON.stringify(inp), () => expect(fns._ikClSplit(inp)).toEqual(out));
  it('at most 6 names', () => expect(fns._ikClSplit('A, B, C, D, E, F, G Seo')).toHaveLength(6));
});

describe('_ikClSuggest: exactly one match = a suggestion, else pick', () => {
  const { fns } = env([]);
  it('one, two and no matches; case, accents and spacing ignored', () => {
    const s = fns._ikClSuggest(['luke  SEO', 'Daniel Seo', 'Claire Séo', 'Luke'], ROSTER);
    expect(s.map((x: any) => [x.personId, x.n])).toEqual([[P(1), 1], [null, 2], [P(2), 1], [null, 0]]);
    expect(s[0].who).toBe('Luke Seo');
  });
});

describe('a multi-name unlinked row', () => {
  it('shows each name found / pick, Link all (n), Find person; nothing is linked without a tap', () => {
    const { fns, t } = env([ROW()]);
    const h = strip(fns._ikClRow(ROW(), 0, '', ST));
    expect(h).toContain('Luke Seo: found Luke Seo');
    expect(h).toContain('Daniel Seo: pick: 2 people have this name');
    expect(h).toContain('Claire Seo: found Claire Seo');
    expect(h).toContain('Link all (2)');
    expect(h).toContain('Find person');
    expect(h).not.toContain('Unlink');
    expect(t.posts).toHaveLength(0);
  });
  it('Link all: one confirm (DNC warned), then ONE batch with one consentLink per suggested person', async () => {
    const { fns, t, I } = env([ROW({ contactOptOut: true })]);
    fns._ikClAllOpen(0);
    expect(t.modal).toContain('Link this form to 2 people?');
    expect(strip(t.modal)).toContain('Luke Seo &amp; Claire Seo are DO NOT CONTACT');
    await fns._ikClAllGo();
    expect(t.posts).toHaveLength(1);
    expect(t.posts[0].map((x: any) => [x.type, x.payload])).toEqual([['consentLink', { subId: P(90), personId: P(1) }], ['consentLink', { subId: P(90), personId: P(2) }]]);
    expect(I.fixes['cn:' + P(90) + ':' + P(1)].status).toBe('pending');
    I.fixes['cn:' + P(90) + ':' + P(1)].status = 'sent';
    I.fixes['cn:' + P(90) + ':' + P(2)].status = 'sent';
    const h = strip(fns._ikClRow(ROW(), 0, '', ST));
    expect(h).toContain('Luke Seo: linked');
    expect(h).toContain('Linked to Luke Seo &amp; Claire Seo (not in Elvanto)');
    expect(h).not.toContain('Link all');
    expect(h).toContain('Find person'); // Daniel is still the operator's pick
    expect(h).toContain('Unlink');
  });
  it("the console's own links (linkedIds) count; Link all offers only the rest", () => {
    const { fns } = env([]);
    const h = strip(fns._ikClRow(ROW({ linked: { personId: P(1), name: 'Luke Seo' } }), 0, '', ST));
    expect(h).toContain('Luke Seo: linked');
    expect(h).toContain('Link all (1)');
  });
  it('Find person on a multi-name form adds that person (per-person key); Unlink undoes them all', async () => {
    const rows = [ROW({ linked: { personId: P(1), name: 'Luke Seo, Claire Seo' }, linkedIds: [P(1), P(2)] })];
    const { fns, t, I } = env(rows);
    I.clp = { i: 0, q: '', list: [ROSTER[2]] };
    fns._ikClPick(0);
    await fns._ikClGo();
    expect(t.posts[0][0].payload).toEqual({ subId: P(90), personId: P(3) });
    expect(I.fixes['cn:' + P(90) + ':' + P(3)].status).toBe('pending');
    fns._ikClUnlink(0);
    expect(t.modal).toContain('Unlink this form from Luke Seo &amp; Claire Seo?');
    await fns._ikClGo();
    expect(t.posts[1][0].payload).toEqual({ subId: P(90), personId: null });
    expect(Object.keys(I.fixes)).toEqual(['cn:' + P(90)]); // this phone's per-person links are gone with the unlink
    I.fixes['cn:' + P(90)].status = 'sent';
    expect(strip(fns._ikClRow(rows[0], 0, '', ST))).toContain('Link all (2)');
  });
  it('before the person list loads: names say checking, no Link all; the list is asked for once', () => {
    const { fns, t } = env([], null);
    const h = strip(fns._ikClRow(ROW(), 0, '', ST));
    expect(h).toContain('Luke Seo: checking…');
    expect(h).not.toContain('Link all');
    fns._ikClRow(ROW(), 0, '', ST);
    expect(t.fresh).toBe(1);
  });
  it('a one-name form (or an older console with no formName) is exactly as before', () => {
    const { fns } = env([]);
    for (const r of [ROW({ formName: 'Andrew Seo', name: 'Seo, Andrew' }), ROW({ formName: undefined })]) {
      const h = strip(fns._ikClRow(r, 0, '', ST));
      expect(h).not.toContain('Names on this form');
      expect(h).not.toContain('Link all');
      expect(h).toContain('Find person');
    }
  });
});
