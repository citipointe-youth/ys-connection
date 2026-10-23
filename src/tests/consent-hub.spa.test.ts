// Consent hub (2026-10-23, design.md): the pure helpers. One row per family, a stage per child; Needs action reasons; search per child.
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, loadFns } from './helpers/extract-fn';

const HTML = loadIndexHtml();
const STAGES = HTML.match(/^const HUB_STAGES = .*$/m)![0];
const NAMES = ['esc', '_hubFold', '_hubAddDays', '_hubFriday', '_hubStage', '_hubReasons', '_hubNext', '_hubFamilies', '_hubModel', '_hubSearch',
  '_ikAct', '_ikOpenAct', '_ikChip', '_ikReasons', '_ikAnd', '_ikFormName', 'tidyName', '_ikClSplit', '_ikFixText'];
const F = loadFns(NAMES, `${STAGES}\nconst _lkSeen = (x) => x; const IK_FIX_REASON = {};`, NAMES);
const P = (n: number) => `9e000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CUT = (y: string) => Date.parse(y + 'T06:30:00+10:00'); // Friday 06:30 Brisbane
const irow = (o: any = {}) => ({ key: P(100 + (o.n || 0)), status: 'done', title: 'Ava Sample', reason: '', outcome: '', hasText: false, personId: P(1), family: null, actions: [], ...o });
const crow = (o: any = {}) => ({ key: P(1), status: 'ready', title: 'Ava Sample', reason: '', outcome: '', actions: [], personId: P(1), family: null, ...o });
const flow = (o: any = {}) => ({ rowId: P(200), personId: P(1), name: 'Sample, Ava', consentStep: true, consentFriday: '2026-10-23', notReceivedOk: false, dnc: false, due: '2026-10-16', ...o });
const kid = (o: any = {}) => ({ name: 'Ava Sample', personId: P(1), intake: null, consent: null, flow: null, mis: null, ...o });

describe('stage of a child', () => {
  it('cut-off boundary: Consent week until Friday 06:30:00.000, Decided from that instant', () => {
    const c = kid({ intake: { date: '2026-10-16', row: irow() }, flow: flow() });
    expect(F._hubStage(c, CUT('2026-10-23') - 1, CUT, true)).toBe('consent');
    expect(F._hubStage(c, CUT('2026-10-23'), CUT, true)).toBe('decided');
  });
  it('no flow row and no consent row: the Friday is the intake date + 7', () => {
    expect(F._hubFriday(kid({ intake: { date: '2026-10-16', row: irow() } }))).toBe('2026-10-23');
  });
  it('Form in = needs-you; In Elvanto = ready or the parent text still to send; Decided = an outcome', () => {
    expect(F._hubStage(kid({ intake: { date: '2026-10-16', row: irow({ status: 'needs-you' }) } }), 0, CUT, true)).toBe('form');
    expect(F._hubStage(kid({ intake: { date: '2026-10-16', row: irow({ status: 'ready' }) } }), 0, CUT, true)).toBe('elvanto');
    expect(F._hubStage(kid({ intake: { date: '2026-10-16', row: irow({ hasText: true }) } }), 0, CUT, true)).toBe('elvanto');
    expect(F._hubStage(kid({ consent: { date: '2026-10-23', row: crow({ outcome: 'Contact allowed' }) } }), 0, CUT, true)).toBe('decided');
  });
  it('Done = step 0 complete: the consent row is done, or past the Friday the person is off step 0 (flows known)', () => {
    expect(F._hubStage(kid({ consent: { date: '2026-10-23', row: crow({ status: 'done', outcome: 'No contact' }) } }), 0, CUT, true)).toBe('done');
    const off = kid({ intake: { date: '2026-10-16', row: irow() } });
    expect(F._hubStage(off, CUT('2026-10-23'), CUT, true)).toBe('done');
    expect(F._hubStage(off, CUT('2026-10-23'), CUT, false)).toBe('decided'); // flows unknown: never assume done
    expect(F._hubStage(off, CUT('2026-10-23') - 1, CUT, true)).toBe('consent'); // before the Friday: just saved, flows may lag
  });
});

describe('Needs action reasons', () => {
  it('a hold (not "Waiting for parent form"), a mismatch, and a refused write with its real reason', () => {
    const st = {};
    expect(F._hubReasons(kid({ intake: { date: 'd', row: irow({ status: 'needs-you', reason: 'Waiting for parent form' }) } }), st, {})).toEqual([]);
    expect(F._hubReasons(kid({ intake: { date: 'd', row: irow({ status: 'needs-you', reason: 'Check the match' }) } }), st, {})).toEqual([['hold', 'Check the match']]);
    expect(F._hubReasons(kid({ mis: { row: {}, i: 0 } }), st, {})[0][0]).toBe('differs');
    const refused = crow({ actions: [{ type: 'consentSave', status: 'refused', reason: 'unknown', detail: 'The profile has no consent date field.' }] });
    expect(F._hubReasons(kid({ consent: { date: 'd', row: refused } }), st, {})).toEqual([['refused', 'The profile has no consent date field.']]);
  });
});

describe('families', () => {
  const src = {
    lists: {
      'intake|2026-10-16': { date: '2026-10-16', rows: [irow({ n: 1, title: 'Jo Sample', personId: P(1), family: P(9) }), irow({ n: 2, title: 'Bo Sample', personId: P(2), family: P(9) })] },
      'consent|2026-10-23': { date: '2026-10-23', rows: [crow({ key: P(1), title: 'Jo Sample', status: 'done', outcome: 'Contact allowed' }), crow({ key: P(2), title: 'Bo Sample', outcome: 'No contact' })] },
    },
    flows: [flow({ personId: P(2), name: 'Sample, Bo' }), flow({ rowId: P(201), personId: P(3), name: 'Other, Kim' })],
    mis: [{ personId: P(2) }, { personId: P(4) }],
  };
  it('mixed family: siblings sharing a parent form are one family in its earliest stage; each child keeps its own stage', () => {
    const M = F._hubModel(src, CUT('2026-10-23') - 1, CUT, {}, {});
    const f = M.fams.find((x: any) => x.kids.length === 2);
    expect(f.title).toBe('Jo Sample & Bo Sample');
    expect(f.kids.map((c: any) => c.stage)).toEqual(['done', 'decided']);
    expect(f.stage).toBe('decided');
    expect(f.needs).toBe(true); // Bo's profile differs
  });
  it('a step-0 person in no plan is a family of one ("Last, First" -> "First Last"); an unknown mismatch is loose', () => {
    const M = F._hubModel(src, 0, CUT, {}, {});
    expect(M.fams.some((f: any) => f.title === 'Kim Other' && f.kids[0].flow)).toBe(true);
    expect(M.loose).toEqual([1]);
  });
});

describe('next step', () => {
  it('one primary action per child', () => {
    expect(F._hubNext({ ...kid({ intake: { date: 'd', row: irow({ status: 'ready' }) } }), stage: 'elvanto' })).toEqual(['save', 'Save to Elvanto']);
    expect(F._hubNext({ ...kid({ intake: { date: 'd', row: irow({ hasText: true }) } }), stage: 'elvanto' })).toEqual(['text', 'Text parent']);
    expect(F._hubNext({ ...kid({ consent: { date: 'd', row: crow() } }), stage: 'decided' })).toEqual(['consent', 'Mark consent']);
    expect(F._hubNext({ ...kid({ flow: flow({ notReceivedOk: true }) }), stage: 'decided' })).toEqual(['mark', 'Mark consent']);
    expect(F._hubNext({ ...kid({ mis: { row: {}, i: 0 } }), stage: 'done' })).toEqual(['fix', 'Make profile match']);
    expect(F._hubNext({ ...kid(), stage: 'consent' })).toBeNull();
  });
});

describe('search per child', () => {
  it('a multi-child form gives one hit per child, found by either name, words in any order', () => {
    const M = { fams: [], loose: [] };
    const forms = [{ name: 'Jo & Bo Sample' }, { name: 'Sample, Kim', formName: '' }];
    expect(F._hubSearch(M, forms, 'bo').forms).toEqual([{ i: 0, name: 'Bo Sample' }]);
    expect(F._hubSearch(M, forms, 'sample').forms.map((h: any) => h.name)).toEqual(['Jo Sample', 'Bo Sample', 'Kim Sample']);
    expect(F._hubSearch(M, forms, 'sample kim').forms).toEqual([{ i: 1, name: 'Kim Sample' }]);
    expect(F._hubSearch(M, forms, '  ')).toBeNull();
  });
});

// Task 10 adds its bulk helpers to LANDING_NAMES (ruling R5).
const LANDING_NAMES = ['_hubSendHtml', 'esc', '_hubFold', '_hubAddDays', '_hubFriday', '_hubStage', '_hubReasons', '_hubNext', '_hubFamilies', '_hubModel', '_hubSearch',
  '_ikAct', '_ikOpenAct', '_ikChip', '_ikReasons', '_ikAnd', '_ikFormName', 'tidyName', '_ikClSplit', '_ikFixText',
  '_hubRows', '_hubM', '_hubSnapApply', '_hubChip', '_hubFamRow', '_hubBodyHtml', '_hubBulkRows', '_hubBulkHtml', '_ikReadyRows'];
describe('landing', () => {
  const env = (I: any) => loadFns(LANDING_NAMES,
    `${STAGES}\nconst IK_FIX_REASON = {}; const __I = ${JSON.stringify(I)}; const _ik = () => __I; const _ikSt = () => ({});
     const _lk = {}; const _ikLk = (k) => (_lk[k] = _lk[k] || { kind: k, st: 'idle', res: null }); const _ikLkBusy = () => false;
     const _lkSeen = (x) => x; const _lkDay = (x) => x; const icS = () => ''; const _ikFormRowEnd = () => '';
     const _ikClRow = (f, i) => '<div class="unl">' + i + '</div>'; const _ikMisRow = (m, i) => '<div class="mis">' + i + '</div>';
     const _usRows = [{ id: 'u1' }];`, // _siteDay / _siteInstant / _consentCutoff: loadFns brings the real site-time helpers itself
    ['_hubSnapApply', '_hubBodyHtml', '_ikLk']);
  const I = { hub: { lists: { 'intake|2026-10-16': { date: '2026-10-16', rows: [{ key: P(101), status: 'needs-you', title: 'Ava Sample', reason: 'Check the match', outcome: '', hasText: false, personId: null, family: null, actions: [] }] } }, flows: [] }, fixes: {}, hubQ: '' };
  it('Needs action counts families, unlinked forms, loose mismatches and unsent forms; stage groups show counts', () => {
    const F2 = env(I);
    F2._hubSnapApply({ live: true, kinds: { unlinked: { rows: [{ subId: P(5) }], total: 1, takenAt: 't' }, mismatches: { rows: [{ personId: P(77) }], total: 1, takenAt: 't' }, forms: null } });
    const h = F2._hubBodyHtml().replace(/<[^>]*>/g, '');
    expect(h).toContain('Needs action (4)');
    expect(h).toContain('Form in (1)');
    expect(h).toContain('Done (0)');
  });
  it('Needs action is a collapsed details by default (count in the summary), open when remembered', () => {
    const F2 = env(I);
    F2._hubSnapApply({ live: true, kinds: { unlinked: { rows: [{ subId: P(5) }], total: 1, takenAt: 't' }, mismatches: { rows: [], total: 0, takenAt: 't' }, forms: null } });
    expect(F2._hubBodyHtml()).toMatch(/<details class="lk-done" ontoggle="_hubToggle\('need', this.open\)"><summary>Needs action \(\d+\)/);
    const F3 = env({ ...I, hubOpen: { need: true } });
    F3._hubSnapApply({ live: true, kinds: { forms: null } });
    expect(F3._hubBodyHtml()).toContain(`<details class="lk-done" open ontoggle="_hubToggle('need'`);
  });
  it('fallback: a snapshot from an older console is not applied (the caller warms the on-demand lookups)', () => {
    const F2 = env(I);
    expect(F2._hubSnapApply({ live: false, kinds: {} })).toBe(false);
    expect(F2._hubSnapApply(null)).toBe(false);
    expect(F2._ikLk('unlinked').res).toBeNull();
  });
  it('search shows families and per-child form hits; nothing found says so', () => {
    const F2 = env({ ...I, hubQ: 'zz' });
    F2._hubSnapApply({ live: true, kinds: { forms: { rows: [{ name: 'Jo & Bo Sample' }], total: 1, takenAt: 't' } } });
    expect(F2._hubBodyHtml()).toContain('Nobody matches');
  });
});

describe('final-review fixes', () => {
  it('I2: a snapshot with a null kind is not "applied", so the caller warms the lookup (no false all-clear)', () => {
    const F2 = loadFns(['_hubSnapApply'], `const _ikLk = (k) => (globalThis.__lk = globalThis.__lk || {})[k] || ((globalThis.__lk[k]) = { st: 'idle', res: null }); const _ikLkBusy = () => false;`, ['_hubSnapApply']);
    const k = { rows: [], total: 0, takenAt: 't' };
    expect(F2._hubSnapApply({ live: true, kinds: { unlinked: k, mismatches: k, forms: null } })).toBe(false);
    expect(F2._hubSnapApply({ live: true, kinds: { unlinked: k, mismatches: k, forms: k } })).toBe(true);
  });
  it('I1: the tick/flush reload goes to the hub on the landing and to the family page when one is open', () => {
    const calls: string[] = [];
    (globalThis as any).__calls = calls;
    const mk = (key: any) => loadFns(['_ikReload'], `const __I = { key: ${JSON.stringify(key)} }; const _ik = () => __I; const _ikLoad = () => globalThis.__calls.push('ik'); const _hubLoad = () => globalThis.__calls.push('hub');`, ['_ikReload']);
    mk(null)._ikReload(); mk('flow:abc')._ikReload(); mk('fam-1')._ikReload();
    expect(calls).toEqual(['hub', 'hub', 'ik']);
    expect(HTML).not.toMatch(/S\.page === 'link-intake'\) _ikLoad\(true\)/);
    expect(HTML).not.toMatch(/any && S\.page === 'link-intake'\) _ikLoad\(true\)/);
  });
});

describe('family page', () => {
  const NAMES2 = ['esc', '_hubNextHtml', '_ikTextOpen', '_hubKidMore', '_hubUnlinkIdx', '_ikTextStep', '_ikIsText', '_ikTodo', '_ikStepText'];
  const mk = (I: any) => loadFns(NAMES2, `const __I = ${JSON.stringify(I)}; const _ik = () => __I; const _ikSt = () => ({}); const icS = () => '';
    const _ikTextBlock = () => ''; const _ikSaveHtml = (det, list, st, label) => '<button>' + label + '</button>';
    let __m = ''; const modal = (h) => { __m = h; }; const _ikSheetHtml = (t) => t;
    const _ikLk = () => ({ res: { rows: [{ subId: 's', linked: { personId: 'p1' } }] } }); const _hubRows = (k) => _ikLk(k).res.rows;`,
    [...NAMES2, '__I']);
  const det = (steps: any[]) => ({ row: { key: 'k1', title: 'Ava Sample' }, detail: { steps }, actions: [] });
  const text = { key: 'complete:parent:x', state: 'todo', text: 'Text', sms: { name: 'Jo Sample', last3: '123' } };
  it('only the parent text left: the one primary button is Text parent; the sheet is an intakeText for that step', () => {
    const F2 = mk({ tab: 'intake', det: det([text]) });
    expect(F2._hubNextHtml(F2.__I.det, null, {})).toContain('Text parent');
    F2._ikTextOpen();
    expect(F2.__I.sheet).toEqual({ type: 'intakeText', key: 'k1', keys: ['complete:parent:x'], one: false });
  });
  it('steps still to save: the primary is Save to Elvanto (Mark consent on a consent row)', () => {
    expect(mk({ tab: 'intake' })._hubNextHtml(det([{ key: 'a', state: 'todo', text: 'Approve' }, text]), null, {})).toContain('Save to Elvanto');
    expect(mk({ tab: 'consent' })._hubNextHtml(det([{ key: 'a', state: 'todo', text: 'Approve' }]), null, {})).toContain('Mark consent');
  });
  it('More: Remove from New People for a step-0 child, Unlink for a console-linked form, Mark not received when it is not the next step', () => {
    const F2 = mk({});
    const h = F2._hubKidMore({ personId: 'p1', flow: { rowId: 'r', notReceivedOk: true, dnc: false }, next: ['consent', 'Mark consent'] });
    expect(h.join('')).toContain('Remove from New People');
    expect(h.join('')).toContain('_ikClUnlink(0)');
    expect(h.join('')).toContain('Mark not received');
  });
});

// Fix round 1 (Task 8 review): Refresh waits only on the lists it asked for; an unreadable list (null) never holds it open.
describe('Refresh clears', () => {
  const KINDS = HTML.match(/^const IK_LK_KINDS = .*$/m)![0];
  const run = async (kinds: any, askAgo = 30e3) => {
    const ask = Date.now() - askAgo, toasts: string[] = [];
    const I: any = { gen: 0, hubAsk: ask, lkPre: 1 };
    const F2 = loadFns(['_hubLoad'], `${KINDS}
      const __I = ${JSON.stringify(I)}; const _ik = () => __I; const _ikSt = () => ({}); const LINK = {};
      const __snap = ${JSON.stringify({ live: true, kinds })};
      const API = { fresh: (u) => Promise.resolve(u.includes('snapshot') ? __snap : { dates: [] }) };
      const _linkOn = () => false; const _intakeOn = () => true; const _hubSnapApply = () => true; const _ikLkWarm = () => [];
      const _usLoad = () => Promise.resolve(); const _ikDraw = () => {}; const _ikSchedule = () => {};
      const toast = (m) => globalThis.__toasts.push(m);`, ['_hubLoad', '_ik']);
    (globalThis as any).__toasts = toasts;
    await F2._hubLoad(true);
    return { I: F2._ik(), toasts, ask };
  };
  const at = (ms: number) => ({ rows: [], total: 0, takenAt: new Date(ms).toISOString() });
  it('the asked lists newer, other and an unreadable list null: clears with "Checked just now."', async () => {
    const now = Date.now();
    const r = await run({ unlinked: null, mismatches: at(now), forms: at(now), other: null });
    expect(r.I.hubAsk).toBe(0);
    expect(r.toasts).toEqual(['Checked just now.']);
  });
  it('an old other list never holds it open', async () => {
    const now = Date.now();
    const r = await run({ unlinked: at(now), mismatches: at(now), forms: at(now), other: at(now - 864e5) });
    expect(r.I.hubAsk).toBe(0);
  });
  it('an asked list still older than the ask keeps waiting; nothing newer at all keeps waiting', async () => {
    const now = Date.now();
    expect((await run({ unlinked: at(now), mismatches: at(now - 864e5), forms: at(now), other: null })).I.hubAsk).not.toBe(0);
    expect((await run({ unlinked: null, mismatches: null, forms: null, other: null })).I.hubAsk).not.toBe(0);
  });
});

describe('bulk buttons', () => {
  const B = loadFns(['esc', '_hubBulkRows', '_hubBulkHtml', '_ikReadyRows', '_ikOpenAct'], `const _ik = () => ({ saBusy: false });`, ['_hubBulkRows', '_hubBulkHtml']);
  const fam = (kids: any[]) => ({ kids });
  const M = { fams: [fam([
    { stage: 'elvanto', intake: { date: 'd', row: { key: 'a', status: 'ready', actions: [] } } },
    { stage: 'elvanto', intake: { date: 'd', row: { key: 'b', status: 'done', hasText: true, actions: [] } } },
    { stage: 'elvanto', intake: { date: 'd', row: { key: 'c', status: 'done', hasText: true, actions: [{ status: 'pending' }] } } }]),
    fam([{ stage: 'decided', consent: { date: 'e', row: { key: 'p', status: 'ready', actions: [] } } }])] };
  it('Save all takes ready rows with nothing open; Text all takes rows whose save is done and text still to send', () => {
    expect(B._hubBulkRows(M, 'save').map((x: any) => x[1].row.key)).toEqual(['a']);
    expect(B._hubBulkRows(M, 'text').map((x: any) => x[1].row.key)).toEqual(['b']);
    expect(B._hubBulkRows(M, 'consent').map((x: any) => x[1].row.key)).toEqual(['p']);
  });
  it('the In Elvanto group shows both buttons; Decided shows Save all; the others none', () => {
    const h = B._hubBulkHtml('elvanto', M).replace(/<[^>]*>/g, '|');
    expect(h).toContain('Save all 1'); expect(h).toContain('Text all 1 parent');
    expect(B._hubBulkHtml('decided', M)).toContain('Save all 1');
    expect(B._hubBulkHtml('consent', M)).toBe('');
  });
});
describe('one way in: Flow steps', () => {
  const mk = (page: string, on: boolean) => loadFns(['_lkHubOwned'], `const S = { page: '${page}' }; const _ikModuleOn = () => ${on};
    const _lkFirstStep = (k) => (k === 'parent' ? { flowId: 'pf', stepId: 'p1' } : null);`, ['_lkHubOwned']);
  it('step 0 and Parent Consent step 1 are the hub\'s on Flow steps; the hub itself and other flows are not', () => {
    const F2 = mk('link-flows', true);
    expect(F2._lkHubOwned({ consentStep: true })).toBe(true);
    expect(F2._lkHubOwned({ flowId: 'pf', stepId: 'p1' })).toBe(true);
    expect(F2._lkHubOwned({ flowId: 'other', stepId: 'x' })).toBe(false);
    expect(mk('link-intake', true)._lkHubOwned({ consentStep: true })).toBe(false); // the hub's own Remove / Mark consent use the sheet
  });
  it('without New youth & consent (module off) step 0 stays completable on Flow steps', () => {
    expect(mk('link-flows', false)._lkHubOwned({ consentStep: true })).toBe(false);
  });
});

describe('Sending X of N (fix round 24 Oct, Task 5)', () => {
  const STG = STAGES, KINDS = HTML.match(/^const IK_LK_KINDS = .*$/m)![0];
  const mkGo = (type: string, outcomes: string[], key: any = null, page = 'link-intake') => {
    const F2 = loadFns(['_ikSaveAllGo', '_ikOutcome'], `
      const S = { page: '${page}' };
      const __I = { key: ${JSON.stringify(key)}, sa: { type: '${type}', items: ${JSON.stringify(outcomes.map((o, i) => ({ key: 'k' + i, title: 'T' + i, payload: { date: 'd', row: 'k' + i } })))} } };
      const _ik = () => __I; const closeModal = () => {}; const _ikQFind = () => null;
      let __n = 0; const _lkUuid = () => 'id' + (__n++);
      const __out = ${JSON.stringify(outcomes)};
      const _ikPost = (items) => Promise.resolve(items.map((it, i) => ({ kind: 'action', id: it.id, outcome: __out[Number(it.id.slice(2))] })));
      const _ikLocal = () => {}; const toast = () => {}; const _ikDraw = () => {}; const _ikLoad = () => {}; const _hubLoad = () => {};`, ['_ikSaveAllGo', '_ik']);
    return F2;
  };
  const body = (hubSend: any) => loadFns(['esc', '_hubBodyHtml', '_hubSendHtml', '_hubAddDays'], `${STG}
    const __I = { hubSend: ${JSON.stringify(hubSend)}, hubQ: '' }; const _ik = () => __I; const _ikSt = () => ({});
    const _hubM = () => ({ fams: [], loose: [] }); const _hubRows = () => []; const _hubBulkHtml = () => '';
    const _hubSearch = () => ({ fams: [], forms: [] }); const _hubFamRow = () => ''; const icS = () => '';`, ['_hubBodyHtml', '_ik']);
  it('Save all from the hub records the saved ids; the strip reads "Saving 1 of 3…"; Text all says Sending', async () => {
    const F2 = mkGo('consentSave', ['saved', 'replay', 'saved', 'duplicate']);
    await F2._ikSaveAllGo();
    expect(F2._ik().hubSend).toEqual({ verb: 'Saving', ids: ['id0', 'id1', 'id2'], done: 0 });
    const b = body(F2._ik().hubSend);
    expect(b._hubBodyHtml().startsWith('<div class="strip" role="status">Saving 1 of 3…</div>')).toBe(true);
    const t = mkGo('intakeText', ['saved']);
    await t._ikSaveAllGo();
    expect(t._ik().hubSend.verb).toBe('Sending');
    // not from the hub (a row page) or nothing saved: no strip
    const r = mkGo('consentSave', ['saved'], 'some-row'); await r._ikSaveAllGo(); expect(r._ik().hubSend).toBeUndefined();
    const z = mkGo('consentSave', ['duplicate']); await z._ikSaveAllGo(); expect(z._ik().hubSend).toBeUndefined();
  });
  const poll = (hubSend: any, fresh: string) => loadFns(['_hubSendPoll'], `const __I = { hubSend: ${JSON.stringify(hubSend)} };
    globalThis.__urls = []; const API = { fresh: (u) => { globalThis.__urls.push(u); return ${fresh}; } };`, ['_hubSendPoll', '__I']);
  it('a poll counts final rows from one /link/actions?ids= read; X = done + 1, capped at N', async () => {
    const P2 = poll({ verb: 'Saving', ids: ['a', 'b', 'c'], done: 0 }, `Promise.resolve([{ id: 'a', status: 'sent' }, { id: 'b', status: 'cancelled' }, { id: 'c', status: 'claimed' }])`);
    await P2._hubSendPoll(P2.__I);
    expect((globalThis as any).__urls).toEqual(['/link/actions?ids=a,b,c']);
    expect(P2.__I.hubSend.done).toBe(2);
    expect(body(P2.__I.hubSend)._hubBodyHtml()).toContain('Saving 3 of 3…');
  });
  it('all final: "Done: 3 of 3." once, then the strip clears; a refused or unclear row says why to open it', async () => {
    const P2 = poll({ verb: 'Saving', ids: ['a', 'b', 'c'], done: 0 }, `Promise.resolve([{ id: 'a', status: 'sent' }, { id: 'b', status: 'sent' }, { id: 'c', status: 'sent' }])`);
    await P2._hubSendPoll(P2.__I);
    const b = body(P2.__I.hubSend);
    expect(b._hubBodyHtml()).toContain('<div class="strip" role="status">Done: 3 of 3.</div>');
    expect(b._hubBodyHtml()).not.toContain('role="status"');
    expect(b._ik().hubSend).toBeNull();
    const Q = poll({ verb: 'Saving', ids: ['a', 'b', 'c'], done: 0 }, `Promise.resolve([{ id: 'a', status: 'sent' }, { id: 'b', status: 'refused' }, { id: 'c', status: 'sent' }])`);
    await Q._hubSendPoll(Q.__I);
    expect(body(Q.__I.hubSend)._hubBodyHtml()).toContain('Done: 3 of 3, 1 not saved: open it to see why.');
  });
  it('a failed actions read keeps the last count', async () => {
    const P2 = poll({ verb: 'Saving', ids: ['a', 'b'], done: 1 }, `Promise.reject(new Error('down'))`);
    await P2._hubSendPoll(P2.__I);
    expect(P2.__I.hubSend.done).toBe(1);
  });
  it('a fresh hub (no hubSend) shows no strip; search results never show it', () => {
    expect(body(undefined)._hubBodyHtml()).not.toContain('role="status"');
    const b = body({ verb: 'Saving', ids: ['a'], done: 0 }); b._ik().hubQ = 'zz';
    expect(b._hubBodyHtml()).not.toContain('role="status"');
  });
  it('_ikSchedule stays busy while the batch is open, not once it is done', () => {
    const sch = (hubSend: any) => {
      const F2 = loadFns(['_ikSchedule'], `${KINDS}
        const S = { page: 'link-intake' }; const __I = { resend: {}, hubSend: ${JSON.stringify(hubSend)}, fixPoll: 1 }; const _ik = () => __I;
        const _ikOpenAct = () => false; const _ikLkPoll = () => {}; const _ikFixPoll = () => {};`, ['_ikSchedule', '_ik']);
      F2._ikSchedule();
      const on = !!F2._ik().poll; clearTimeout(F2._ik().poll); return on;
    };
    expect(sch({ verb: 'Saving', ids: ['a', 'b'], done: 1 })).toBe(true);
    expect(sch({ verb: 'Saving', ids: ['a', 'b'], done: 2 })).toBe(false);
    expect(sch(undefined)).toBe(false);
    expect(sch({ verb: 'Saving', ids: ['a', 'b'], done: 1, stale: true })).toBe(false); // review #3: polling stops
  });
  it('review #3: no change for 3 min = "Still saving — check back later." and the poll stops; a change resets the clock', async () => {
    const old = Date.now() - 4 * 60e3, one = `Promise.resolve([{ id: 'a', status: 'sent' }, { id: 'b', status: 'claimed' }])`;
    const P2 = poll({ verb: 'Saving', ids: ['a', 'b'], done: 1, at: old }, one);
    await P2._hubSendPoll(P2.__I);
    expect(P2.__I.hubSend.stale).toBe(true);
    expect(body(P2.__I.hubSend)._hubBodyHtml()).toContain('<div class="strip" role="status">Still saving — check back later.</div>');
    const Q = poll({ verb: 'Sending', ids: ['a', 'b'], done: 0, at: old }, one); // a row finished: not stale, clock reset
    await Q._hubSendPoll(Q.__I);
    expect(Q.__I.hubSend.stale).toBeFalsy();
    expect(Q.__I.hubSend.at).toBeGreaterThan(old);
    const R = poll({ verb: 'Saving', ids: ['a', 'b'], done: 1 }, one); // first poll stamps the clock
    await R._hubSendPoll(R.__I);
    expect(R.__I.hubSend.stale).toBeFalsy();
  });
});
