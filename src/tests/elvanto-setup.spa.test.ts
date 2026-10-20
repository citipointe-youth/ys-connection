// Y1d: Youth Setup card "Elvanto for this location" + the New person State default. Runs the REAL page source.
import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml, extractFn } from './helpers/extract-fn';

const ID = '45803e81-0c8f-4398-9891-3287df77ab91';
const PID = 'a1b2c3d4-0000-4000-8000-000000000002';

describe('_elvSplitLink (Review Focus 5)', () => {
  const { _elvSplitLink } = loadFns(['_elvSplitLink']);
  it.each([
    [`https://your-org.elvanto.com.au/form/${ID}`, 'https://your-org.elvanto.com.au'],
    [`https://your-org.elvanto.com.au/form/${ID}/`, 'https://your-org.elvanto.com.au'],
    [`https://your-org.elvanto.com.au/form/${ID}?x=1`, 'https://your-org.elvanto.com.au'],
    [`  https://YOUR-ORG.elvanto.com.au/form/${ID.toUpperCase()} `, 'https://your-org.elvanto.com.au'],
  ])('splits %s', (u, base) => {
    expect(_elvSplitLink(u)).toEqual({ baseUrl: base, id: ID });
  });
  it.each([
    `https://evil.com/form/${ID}`,
    'https://your-org.elvanto.com.au/form/nope',
    '',
    `https://www.your-org.elvanto.com.au/form/${ID}`, // P24
    `http://your-org.elvanto.com.au/form/${ID}`,
    `https://your-org.elvanto.com.au.evil.com/form/${ID}`,
    `https://your-org.elvanto.com.au/form/${ID}x`,
  ])('refuses %s', (u) => expect(_elvSplitLink(u)).toBeNull());
});

describe('State default reads elvanto.state', () => {
  // The real expression from the New person form (Y1d: was addr.state || 'QLD').
  const src = extractFn(loadIndexHtml(), 'renderNewYouth');
  const expr = /id="ny-state" placeholder="State" value="\$\{esc\((.*?)\)\}">/.exec(src)![1];
  const state = (settings: unknown, addr: unknown = {}) => new Function('S', 'addr', `return ${expr};`)({ settings }, addr);
  it("'' when blank (a new install)", () => {
    expect(state({ ministryConfig: { elvanto: { state: '' } } })).toBe('');
    expect(state({ ministryConfig: {} })).toBe('');
    expect(state(null)).toBe('');
  });
  it("'QLD' for Brisbane (after 0040)", () => {
    expect(state({ ministryConfig: { elvanto: { state: 'QLD' } } })).toBe('QLD');
  });
  it('a kept address state still wins, and no fixed QLD is left', () => {
    expect(state({ ministryConfig: { elvanto: { state: 'QLD' } } }, { state: 'NSW' })).toBe('NSW');
    expect(src).not.toContain("'QLD'");
  });
});

describe('the card links', () => {
  const prelude = `
    let _setupDraft = { elvanto: { baseUrl: 'https://old.elvanto.com.au', studentFormId: '${ID}', parentFormId: '${PID}' } };
    let _setupElv = null;
    function _setupRerender() {}
    function state() { return { d: _setupDraft, s: _setupElv }; }`;
  const fns = () => loadFns(['_elvSplitLink', '_setupElvText', '_setupElvLink'], prelude, ['_setupElvLink', '_setupElvText', 'state']);

  it('shows the saved links', () => {
    const f = fns();
    expect(f._setupElvText('student')).toBe(`https://old.elvanto.com.au/form/${ID}`);
    expect(f._setupElvText('parent')).toBe(`https://old.elvanto.com.au/form/${PID}`);
  });
  it('a link on another address is refused in words and nothing is stored', () => {
    const f = fns();
    f._setupElvLink('student', `https://new-org.elvanto.com.au/form/${ID}`);
    expect(f.state().s.err).toBe('Both form links must be on the same Elvanto address.');
    expect(f.state().d.elvanto.baseUrl).toBe('https://old.elvanto.com.au');
  });
  it('both on the new address: split, stored, and shown clean', () => {
    const f = fns();
    f._setupElvLink('student', `https://new-org.elvanto.com.au/form/${ID}`);
    f._setupElvLink('parent', `https://new-org.elvanto.com.au/form/${PID}/?ref=1`);
    expect(f.state().s.err).toBe('');
    expect(f.state().d.elvanto).toEqual({ baseUrl: 'https://new-org.elvanto.com.au', studentFormId: ID, parentFormId: PID });
    expect(f._setupElvText('parent')).toBe(`https://new-org.elvanto.com.au/form/${PID}`);
  });
  it('a www link is refused in words, never stored raw', () => {
    const f = fns();
    f._setupElvLink('parent', `https://www.old.elvanto.com.au/form/${PID}`);
    expect(f.state().s.err).toBe('The parent form link is not a public Elvanto form link.');
    expect(f.state().d.elvanto.parentFormId).toBe(PID);
    expect(JSON.stringify(f.state().d)).not.toContain('www');
  });
  it('a blank link asks for it', () => {
    const f = fns();
    f._setupElvLink('student', ' ');
    expect(f.state().s.err).toBe('Paste the student form link.');
  });
});

describe('Check forms puts its result into the draft', () => {
  const prelude = (res: unknown, fail = false) => `
    let _setupDraft = { elvanto: { baseUrl: 'https://your-org.elvanto.com.au', studentFormId: '${ID}', parentFormId: '${PID}', location: 'North',
      fields: { host: 'old-host', school: 'old-school' }, options: { location: 'old-loc' }, checkedAt: '2026-10-09' } };
    let _setupElv = null;
    const calls = [];
    const API = { post: async (p, b) => { calls.push([p, b]); if (${fail}) throw new Error("Can't open the student form. Check the link."); return ${JSON.stringify(res)}; } };
    function _setupRerender() {}
    function state() { return { d: _setupDraft, s: _setupElv, calls }; }`;
  const load = (res: unknown, fail = false) => loadFns(['_setupElvCheck'], prelude(res, fail), ['_setupElvCheck', 'state']);

  it('sends the draft links and location; merges, never replaces; checkedAt stays when a row is missing', async () => {
    const f = load({ ok: false, n: 3, fields: { school: 'new-school' }, options: {}, missing: ['Name of Host filling out form'], extra: [],
      lines: ['Not found: Name of Host filling out form. Make the question match, or type its id.'] });
    await f._setupElvCheck();
    const { d, s, calls } = f.state();
    expect(calls).toEqual([['/settings/elvanto-check', { baseUrl: 'https://your-org.elvanto.com.au', studentFormId: ID, parentFormId: PID, location: 'North' }]]);
    expect(d.elvanto.fields).toEqual({ host: 'old-host', school: 'new-school' });
    expect(d.elvanto.options).toEqual({ location: 'old-loc' });
    expect(d.elvanto.checkedAt).toBe('2026-10-09');
    expect(s.lines).toEqual(['Not found: Name of Host filling out form. Make the question match, or type its id.']);
    expect(s.busy).toBe(false);
  });
  it('every row found: checkedAt is set', async () => {
    const f = load({ ok: true, n: 2, fields: { host: 'h' }, options: { location: 'l' }, missing: [], extra: [], lines: ['All 2 found.'] });
    await f._setupElvCheck();
    const { d, s } = f.state();
    expect(d.elvanto.fields).toEqual({ host: 'h', school: 'old-school' });
    expect(d.elvanto.options).toEqual({ location: 'l' });
    expect(d.elvanto.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(s.lines).toEqual(['All 2 found.']);
  });
  it('a form it cannot open: the words show and nothing changes', async () => {
    const f = load(null, true);
    await f._setupElvCheck();
    const { d, s } = f.state();
    expect(s.lines).toEqual(["Can't open the student form. Check the link."]);
    expect(d.elvanto.fields).toEqual({ host: 'old-host', school: 'old-school' });
    expect(d.elvanto.checkedAt).toBe('2026-10-09');
  });
});

describe('the card copy', () => {
  const src = loadIndexHtml();
  it('the card and its fields', () => {
    const body = extractFn(src, '_setupElvCardHtml');
    for (const s of ['Student form link', 'Parent form link', 'Location to tick', 'New People flow name starts with',
      'Parent Consent flow name starts with', 'Default state', 'Check forms',
      'New person sends these two Elvanto forms. Paste each form\'s public link.']) expect(body).toContain(s);
    expect(extractFn(src, '_youthSetupBody')).toContain("_setupCard('elvanto', 'Elvanto for this location', _setupElvCardHtml(cfg))");
  });
  it('help text no longer names Brisbane forms or flows', () => {
    expect(src).not.toContain('Brisbane - Youth - Decision Form');
    expect(src).not.toContain('<b>Brisbane - Youth - New People</b>');
    expect(src).not.toContain('Locations <b>Brisbane</b>');
    expect(src).not.toContain('("Brisbane - Youth - 3.")');
  });
});
