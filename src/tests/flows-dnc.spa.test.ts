// Run 2026-10-15 lane B: DO NOT CONTACT display, flow-step filters, bulk Complete exclusion, Remove from step and the
// console-offline banner, run from the REAL page source (extract-and-evaluate).
import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml, extractFn } from './helpers/extract-fn';
import { ACTION_TYPES } from '../core/link-contract';

const NAMES = ['_lkFlowBucket', '_lkFlowShown', '_lkStepBlock', '_lkConsentWait', '_lkNotReceived', '_lkNotReceivedText', '_lkDay', 'fmtDay', '_lkFlowFree', '_lkFlowAct', '_lkCap', '_lkCapOff', '_lkCanComplete',
  '_lkTickable', '_lkSelIds', '_lkTextHref', '_lkSmsHref', '_lkFirstName', '_lkOfflineSince', 'dncChip', 'dncBanner', '_lkFfGet',
  '_lkFfHtml', '_lkFlowVisible', '_lkFlowKind', '_lkFirstStep', '_lkTilesOn', '_lkTilesHtml', '_lkFlowPick', '_lkFlowGroups', '_lkFlowRowHtml', '_lkFlowsHtml', '_lkStatusText', '_lkFlowTypes',
  '_lkMemOff', '_lkCanRemove'];
const PRELUDE = `
  var STORE = {}, THROW = false, ROLE = 'admin', QUEUE = [];
  var localStorage = { getItem: (k) => { if (THROW) throw new Error('blocked'); return STORE[k] == null ? null : STORE[k]; },
    setItem: (k, v) => { if (THROW) throw new Error('blocked'); STORE[k] = String(v); } };
  var S = { get user() { return { role: ROLE }; } };
  var LINK = { flows: [], fSteps: [], fres: {}, fsel: {}, status: null };
  const LK_FLOW_TYPES = ['completeStep', 'removeFromFlowStep'];
  const LK_FF = [['jg', 'Junior Guys', 'boy'], ['jf', 'Junior Girls', 'girl'], ['sg', 'Senior Guys', 'boy'], ['sf', 'Senior Girls', 'girl']];
  const LK_OFFLINE_MS = 15 * 60000;
  function _lkQGet() { return QUEUE.slice(); }
  function _lkBoss() { return ROLE === 'admin' || ROLE === 'director'; }
  function _juniorMin() { return 7; }
  function _lkToday() { return '2026-10-15'; }
  function _lkFlowDue() { return ''; }
  function _lkStatusHtml(a) { return 'ST:' + a.status; }
  function _lkStatusTone() { return 'wait'; }
  function _lkLastSeen() { return ''; }
  function _lkTime() { return '7:02 pm'; }
  function _lkOutsideWindow() { return false; }
  function _busGradeChip(g) { return g ? '<chip>' : ''; }
  function icS(k) { return '<i:' + k + '>'; }
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function set(o) { if ('role' in o) ROLE = o.role; if ('queue' in o) QUEUE = o.queue; if ('throw' in o) THROW = o.throw; if ('store' in o) STORE = o.store; }
`;
const f = loadFns(NAMES, PRELUDE, [...NAMES, 'set', 'LINK']);
const L = f.LINK;
let n = 0;
const R = (o: any) => ({ rowId: o.rowId ?? 'r' + (++n), flowId: 'F1', flowName: 'New People', stepId: 'S1', stepName: 'Step 1', stepOrder: 2,
  personId: 'p' + n, name: 'Zed ' + n, due: null, grade: 8, gender: 'male', mobile: '0412345678', consent: 'ok', dnc: false, consentStep: false, ...o });
const reset = (o: any = {}) => { f.set({ role: 'admin', queue: [], throw: false, store: {}, ...o }); Object.assign(L, { flows: [], fSteps: [], fres: {}, fsel: {}, status: null, ff: undefined }); };

describe('R4 filter buckets: junior Y7-9 (+Y6 with Include Grade 6), senior Y10-12, unknown always shows', () => {
  it('buckets by grade and gender', () => {
    expect(f._lkFlowBucket(R({ grade: 7, gender: 'male' }), 7)).toBe('jg');
    expect(f._lkFlowBucket(R({ grade: 9, gender: 'female' }), 7)).toBe('jf');
    expect(f._lkFlowBucket(R({ grade: 10, gender: 'male' }), 7)).toBe('sg');
    expect(f._lkFlowBucket(R({ grade: 12, gender: 'female' }), 7)).toBe('sf');
  });
  it('Grade 6 is junior only when includeGrade6 (jMin 6)', () => {
    expect(f._lkFlowBucket(R({ grade: 6, gender: 'female' }), 6)).toBe('jf');
    expect(f._lkFlowBucket(R({ grade: 6, gender: 'female' }), 7)).toBeNull();
  });
  it('unknown grade or gender -> null', () => {
    expect(f._lkFlowBucket(R({ grade: null }), 7)).toBeNull();
    expect(f._lkFlowBucket(R({ gender: null }), 7)).toBeNull();
    expect(f._lkFlowBucket(R({ gender: 'other' }), 7)).toBeNull();
  });
  it('filtering keeps the chips that are on plus every unknown row', () => {
    const rows = [R({ rowId: 'jg', grade: 8 }), R({ rowId: 'sf', grade: 11, gender: 'female' }), R({ rowId: 'u', grade: null })];
    expect(f._lkFlowShown(rows, ['sf'], 7).map((r: any) => r.rowId)).toEqual(['sf', 'u']);
    expect(f._lkFlowShown(rows, [], 7).map((r: any) => r.rowId)).toEqual(['u']);
    expect(f._lkFlowShown(rows, ['jg', 'jf', 'sg', 'sf'], 7)).toHaveLength(3);
  });
});

describe('R4 filter persistence (localStorage in try/catch)', () => {
  it('all four on by default; a stored pick wins; junk keys are dropped', () => {
    reset();
    expect(f._lkFfGet()).toEqual(['jg', 'jf', 'sg', 'sf']);
    reset({ store: { yap_lk_flowf: JSON.stringify(['sg', 'nope']) } });
    expect(f._lkFfGet()).toEqual(['sg']);
  });
  it('a blocked localStorage still gives all four', () => {
    reset({ throw: true });
    expect(f._lkFfGet()).toEqual(['jg', 'jf', 'sg', 'sf']);
  });
  it('chips show for admin/director only; leaders see every row unfiltered', () => {
    reset({ store: { yap_lk_flowf: '[]' } });
    L.flows = [R({ rowId: 'a' }), R({ rowId: 'b', grade: null })];
    expect(f._lkFlowVisible().map((r: any) => r.rowId)).toEqual(['b']);
    expect(f._lkFlowsHtml()).toContain('Junior Guys');
    f.set({ role: 'quad' });
    expect(f._lkFlowVisible()).toHaveLength(2);
    expect(f._lkFlowsHtml()).not.toContain('Junior Guys');
  });
  it('chip colours: guys blue, girls pink, aria-pressed follows the pick', () => {
    const h = f._lkFfHtml(['jf']);
    expect(h).toMatch(/lk-ff-boy" aria-pressed="false"[^>]*aria-label="Junior Guys"[^>]*>Jr Guys</);
    expect(h).toMatch(/lk-ff-girl on" aria-pressed="true"[^>]*aria-label="Junior Girls"[^>]*>Jr Girls</);
  });
});

describe('R1 DNC on flow rows: no number, no Text, Complete blocked, Remove only', () => {
  it('no Text link on a DNC row even when admin still has the number', () => {
    expect(f._lkTextHref(R({ dnc: true, mobile: '0412345678' }))).toBe('');
    expect(f._lkTextHref(R({ dnc: false }))).toContain('sms:0412345678');
  });
  it('Complete blocked with a reason on DNC and on the consent step until consent is ok', () => {
    reset();
    expect(f._lkStepBlock(R({ dnc: true }))).toMatch(/Do not contact/);
    expect(f._lkCanComplete(R({ dnc: true }))).toBe(false);
    expect(f._lkStepBlock(R({ consentStep: true, consent: 'unknown' }))).toMatch(/^Do the consent check first/);
    expect(f._lkCanComplete(R({ consentStep: true, consent: 'ok' }))).toBe(true);
    expect(f._lkCanComplete(R({}))).toBe(true);
  });
  it('Remove: admin/director only, allowed on DNC rows, not while an action is open', () => {
    reset();
    const r = R({ dnc: true });
    expect(f._lkCanRemove(r)).toBe(true);
    f.set({ role: 'director' }); expect(f._lkCanRemove(r)).toBe(true);
    f.set({ role: 'grade' }); expect(f._lkCanRemove(r)).toBe(false);
    f.set({ role: 'admin', queue: [{ kind: 'action', type: 'removeFromFlowStep', id: 'x', payload: { rowId: r.rowId } }] });
    expect(f._lkCanRemove(r)).toBe(false);
    expect(f._lkCanComplete(r)).toBe(false);
  });
  it('an older console that does not list removeFromFlowStep hides Remove', () => {
    reset();
    L.status = { console: { lastSeenAt: '2026-10-15T00:00:00Z', capabilities: { completeStep: 'live' } } };
    expect(f._lkCanRemove(R({}))).toBe(false);
    L.status.console.capabilities.removeFromFlowStep = 'live';
    expect(f._lkCanRemove(R({}))).toBe(true);
  });
  it('DNC row renders red with the badge and no tick box', () => {
    reset();
    const h = f._lkFlowRowHtml(R({ rowId: 'd1', dnc: true }), '2026-10-15', true);
    expect(h).toContain('lk-row lk-dnc');
    expect(h).toContain('DO NOT CONTACT');
    expect(h).not.toContain('lk-tick"');
  });
});

describe('R4 bulk selection: DNC, consent-blocked, busy and hidden rows are never selected', () => {
  it('_lkSelIds drops untickable rows even when ticked', () => {
    reset();
    const ok = R({ rowId: 'ok' }), dnc = R({ rowId: 'dnc', dnc: true }), cs = R({ rowId: 'cs', consentStep: true, consent: 'contact' });
    const busy = R({ rowId: 'busy' });
    f.set({ queue: [{ kind: 'action', type: 'completeStep', id: 'q', payload: { rowId: 'busy' } }] });
    const sel = { ok: true, dnc: true, cs: true, busy: true };
    expect(f._lkSelIds([ok, dnc, cs, busy], sel)).toEqual(['ok']);
  });
  it('a refused earlier action frees the row again', () => {
    reset();
    const r = R({ rowId: 'rf' });
    L.fres.rf = { status: 'refused', type: 'completeStep' };
    expect(f._lkSelIds([r], { rf: true })).toEqual(['rf']);
  });
  it('the list shows the bulk bar + select-all for the visible tickable rows only', () => {
    reset({ store: { yap_lk_flowf: JSON.stringify(['jg']) } });
    L.flows = [R({ rowId: 'a' }), R({ rowId: 'b' }), R({ rowId: 'c', dnc: true }), R({ rowId: 'g', gender: 'female' })];
    L.fsel = { a: true, c: true, g: true }; // g is filtered out, c is DNC
    const h = f._lkFlowsHtml();
    expect(h).toContain('1 selected');
    expect(h).toContain('Complete 1');
    expect(h).toContain('Select all shown here (2 of 3 - the rest are Do Not Contact');
    expect(h).not.toContain("_lkSel('g'"); // filtered out: not on the screen at all
    expect(h).not.toContain("_lkSel('c'"); // DNC: no tick box
  });
});

describe('L5 flow rows', () => {
  it('select-all says how many of the step it covers; equal counts stay plain', () => {
    reset();
    L.flows = [R({ rowId: 'a' }), R({ rowId: 'b' })];
    expect(f._lkFlowsHtml()).toContain('Select all shown here (2)</label>');
  });
  it('two same-name rows in one step are both marked', () => {
    reset();
    L.flows = [R({ rowId: 'a', name: 'Sam Lee' }), R({ rowId: 'b', name: 'sam lee' }), R({ rowId: 'c', name: 'Other One' })];
    expect((f._lkFlowsHtml().match(/same name as another row/g) || []).length).toBe(2);
  });
});

describe('Remove / consent refusal lines', () => {
  it('locked remove reads as the plain locked line (r21 L6b T5: remove with a note is live, never "not switched on")', () => {
    expect(f._lkStatusText({ status: 'refused', reason: 'locked', type: 'removeFromFlowStep' })).toBe("This isn't connected yet. Do it in Elvanto.");
    expect(f._lkStatusText({ status: 'sent', type: 'removeFromFlowStep', reason: 'already' })).toBe('Not in this step any more.');
    expect(f._lkStatusText({ status: 'sent', type: 'removeFromFlowStep', resultAt: 'x' })).toBe('Removed from the step in Elvanto 7:02 pm');
  });
  it('CONSENT_CHECK_FIRST shows "Do the consent check first"', () => {
    expect(f._lkStatusText({ status: 'refused', code: 'CONSENT_CHECK_FIRST', message: 'x', type: 'completeStep' })).toMatch(/^Do the consent check first/);
  });
  it('the flows banner covers Remove only for admin/director', () => {
    reset(); expect(f._lkFlowTypes()).toEqual(['completeStep', 'removeFromFlowStep']);
    f.set({ role: 'quad' }); expect(f._lkFlowTypes()).toEqual(['completeStep']);
  });
});

describe('R1 student badge + banner', () => {
  it('only when dnc is true', () => {
    expect(f.dncChip({ dnc: true })).toContain('DO NOT CONTACT');
    expect(f.dncChip({ dnc: false })).toBe('');
    expect(f.dncChip(null)).toBe('');
    expect(f.dncBanner({ dnc: true })).toContain('role="alert"');
    expect(f.dncBanner({})).toBe('');
  });
  it('every student screen calls the badge (detail banner, follow-up, birthdays, My students, Health, search, bus)', () => {
    const src = loadIndexHtml();
    expect(extractFn(src, 'showStudentDetail')).toContain('${dncBanner(s)}');
    expect(extractFn(src, '_followupListHtml')).toContain('dncChip(s)');
    expect(extractFn(src, '_scopedWeeklyBirthdays')).toContain('dnc: !!s.dnc');
    expect((src.match(/dncChip\(s\)/g) || []).length).toBeGreaterThanOrEqual(7);
  });
});

describe('R8 console offline: over 15 minutes since the last check-in', () => {
  const now = Date.parse('2026-10-15T09:00:00Z');
  it('returns lastSeenAt only past 15 min; never seen = nothing', () => {
    expect(f._lkOfflineSince({ console: { lastSeenAt: '2026-10-15T08:44:00Z' } }, now)).toBe('2026-10-15T08:44:00Z');
    expect(f._lkOfflineSince({ console: { lastSeenAt: '2026-10-15T08:46:00Z' } }, now)).toBe('');
    expect(f._lkOfflineSince({ console: { lastSeenAt: null } }, now)).toBe('');
    expect(f._lkOfflineSince(null, now)).toBe('');
  });
});

// Consents run 2026-10-17 (R4, R6): step 0 past the consent Friday with no reply -> Complete records consent not received;
// before that Friday the row is "Waiting (consent Fri …)", never Overdue. Fridays far from today keep the test clock-free.
describe('R4/R6 step 0: waiting for consent, then Complete records consent not received', () => {
  const S0 = (o: any) => R({ consentStep: true, consent: 'unknown', due: '2020-01-02', ...o });
  it('before the consent Friday: waiting, not blocked as "check first", no Complete', () => {
    reset();
    const r = S0({ consentFriday: '2099-01-02', notReceivedOk: false });
    expect(f._lkConsentWait(r)).toBe(true);
    expect(f._lkStepBlock(r)).toBe('Waiting for the consent reply. Complete opens after Fri 2 Jan 2099 9am.');
    expect(f._lkCanComplete(r)).toBe(false);
  });
  it('past the Friday with notReceivedOk (server): Complete opens and says what it records', () => {
    reset();
    const r = S0({ consentFriday: '2020-01-03', notReceivedOk: true });
    expect(f._lkConsentWait(r)).toBe(false);
    expect(f._lkStepBlock(r)).toBe('');
    expect(f._lkCanComplete(r)).toBe(true);
    expect(f._lkNotReceived(r)).toBe(true);
    expect(f._lkNotReceivedText(r)).toBe('No consent reply by Fri 3 Jan 2020 9am. Complete marks "Consent not received" (dated today) on their Elvanto profile, then completes step 0.');
    expect(f._lkNotReceived(S0({ consentFriday: '2020-01-03', notReceivedOk: true, consent: 'ok' }))).toBe(false); // the ordinary Complete
  });
  it('past the Friday without notReceivedOk (older console, no due date): still "Do the consent check first"', () => {
    reset();
    expect(f._lkStepBlock(S0({ consentFriday: '2020-01-03', notReceivedOk: false }))).toMatch(/^Do the consent check first/);
    expect(f._lkStepBlock(S0({ consentFriday: null, notReceivedOk: false }))).toMatch(/^Do the consent check first/);
    expect(f._lkStepBlock(S0({ consentFriday: '2020-01-03', notReceivedOk: true, dnc: true }))).toMatch(/Do not contact/);
  });
  it('a waiting row is not counted overdue; the due line reads "Waiting (consent Fri …)"', () => {
    reset();
    const g = f._lkFlowGroups([S0({ consentFriday: '2099-01-02' }), S0({ consentFriday: '2020-01-03' })], '2026-10-15', []);
    expect(g[0].steps[0].overdue).toBe(1);
    const d = loadFns(['_lkFlowDue', '_lkConsentWait', '_lkDay', 'fmtDay'], 'function esc(v) { return String(v); }');
    expect(d._lkFlowDue(S0({ consentFriday: '2099-01-02' }), '2026-10-15')).toBe('<span>Waiting (consent Fri 2 Jan 2099)</span>');
    expect(d._lkFlowDue(S0({ consentFriday: '2020-01-03' }), '2026-10-15')).toContain('Overdue');
  });
});

// ── Y6c (multisite SPEC Y6): the DNC banner on Flow steps and Home, the "Assigned to" hint, the assignee-needed line
// and the unclear list's intake / consent verbs. Own loads, so the lane B fixtures above are untouched.
const Y6_HTML = loadIndexHtml();
const DNC = "Do not contact isn't fully on yet. Finish Matching in Admin > Elvanto link.";
const y6strip = (h: string) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const LK_CONSTS = Y6_HTML.match(/^const LK_DOOR_TYPES = .*$/m)![0] + '\n' + Y6_HTML.match(/^const LK_FLOW_TYPES = .*$/m)![0];
const banner = (role: string) => loadFns(['_lkBanner', '_lkBoss', '_lkDncText', '_lkOfflineSince', '_lkSeen', '_lkTime', '_lkAt', 'fmtDay'], `
    var S = { user: { id: 'u', role: ${JSON.stringify(role)} }, settings: { ministryConfig: { structure: { timeZone: 'Australia/Brisbane' } } } };
    var LINK = { status: null };
    const LK_OFFLINE_MS = 15 * 60000;
    ${LK_CONSTS}
    const icS = () => '';
    const esc = (v) => String(v == null ? '' : v);
  `, ['_lkBanner', 'LK_DOOR_TYPES', 'LK_FLOW_TYPES']);
const st = (dncReady?: boolean) => ({ console: { online: true, lastSeenAt: new Date().toISOString(), consoles: 1 }, mirrors: {},
  ...(dncReady === undefined ? {} : { dncReady }) });

describe('Y6c DNC banner on Flow steps', () => {
  it('admin and director see it when DNC is not fully on', () => {
    for (const role of ['admin', 'director']) {
      const b = banner(role);
      expect(y6strip(b._lkBanner(b.LK_FLOW_TYPES, st(false)))).toContain(DNC);
      expect(y6strip(b._lkBanner(['completeStep'], st(false)))).toContain(DNC);
    }
  });
  it('hidden when fully matched, when the server does not say (older reply), and for every other login', () => {
    const a = banner('admin');
    expect(a._lkBanner(a.LK_FLOW_TYPES, st(true))).not.toContain('Do not contact');
    expect(a._lkBanner(a.LK_FLOW_TYPES, st())).not.toContain('Do not contact');
    for (const role of ['leader', 'grade', 'quad']) {
      const b = banner(role);
      expect(b._lkBanner(['completeStep'], st(false))).not.toContain('Do not contact');
    }
  });
  it('only on Flow steps: not on Check-in, Lifegroups or the admin page', () => {
    const b = banner('admin');
    expect(b._lkBanner(b.LK_DOOR_TYPES, st(false))).not.toContain('Do not contact');
    expect(b._lkBanner(['submitReport', 'editReport'], st(false))).not.toContain('Do not contact');
    expect(b._lkBanner([], st(false))).not.toContain('Do not contact');
  });
  it('the Flow steps list itself (with the Y2b New People banner) is unchanged by it', () => {
    reset({ role: 'admin' });
    L.status = st(false);
    expect(f._lkFlowsHtml()).not.toContain('Do not contact');
  });
});

describe('Y6c DNC line on Home (Needs attention)', () => {
  const lines = (role: string, dncReady?: boolean) => {
    const h = loadFns(['_attnCounts', '_attnLines', '_lkDncText', '_lkSeen', '_lkTime', '_lkAt', 'fmtDay'], 'var S = {};');
    return h._attnLines(h._attnCounts({ uid: 'u', role, st: st(dncReady) }, Date.now())).map((l: [string, string]) => l);
  };
  it('admin (opens Admin > Elvanto link) and director (plain text) see it when DNC is not fully on', () => {
    expect(lines('admin', false)).toContainEqual([DNC, "go('link-admin')"]);
    expect(lines('director', false)).toContainEqual([DNC, '']);
  });
  it('hidden when fully matched or unknown', () => {
    expect(lines('admin', true)).toEqual([]);
    expect(lines('director')).toEqual([]);
  });
  it('the words name no console (leader-friction rule)', () => { expect(DNC).not.toMatch(/console/i); });
  it('fix round: a System check fix row reads as one plain sentence (no second colon)', () => {
    const h = loadFns(['_attnCounts', '_attnLines', '_lkDncText', '_lkSeen', '_lkTime', '_lkAt', 'fmtDay'], 'var S = {};');
    const setup = { checks: [{ id: 'link', label: 'Elvanto link token: not set', state: 'fix' }, { id: 'appOrigin', label: 'APP_ORIGIN', state: 'fix' }] };
    expect(h._attnLines(h._attnCounts({ uid: 'u', role: 'admin', setup }, Date.now())).map((l: string[]) => l[0]))
      .toEqual(['System check: Elvanto link token needs fixing.', 'System check: APP_ORIGIN needs fixing.']);
  });
  it('fix round: Home makes one /link/status read a minute (Needs attention and the offline line share it)', async () => {
    const calls: string[] = [];
    (globalThis as any).__y6 = calls;
    const h = loadFns(['_attnLoad', '_attnCounts', '_attnMine', '_lkHomeFlows', '_lkBoss', '_lkOfflineHtml', '_lkOfflineSince', '_lkSeen', '_lkTime', '_lkAt', 'fmtDay'], `
      var S = { user: { id: 'u', role: 'admin' }, page: 'home', settings: { ministryConfig: { structure: { timeZone: 'Australia/Brisbane' }, modules: {} } } };
      var LINK = { status: null, statusAt: 0, flowsAt: 0 };
      let _attn = null, _attnBusy = null;
      const LK_OFFLINE_MS = 15 * 60000;
      const API = { fresh: async (p) => { globalThis.__y6.push(p); return p === '/link/status' ? { console: { online: true }, dncReady: false } : null; } };
      const _linkOn = () => true, _ikModuleOn = () => false, _attnPaint = () => {}, getMyLeaderId = () => null;
      const icS = () => '', esc = (v) => String(v);
      const document = { getElementById: () => null };
    `, ['_attnLoad', '_lkHomeFlows', 'LINK']);
    const p = h._attnLoad(); await h._lkHomeFlows(); await p;
    expect(calls.filter((c) => c === '/link/status')).toEqual(['/link/status']);
    expect(h.LINK.status).toMatchObject({ dncReady: false });
    await h._attnLoad(); await h._lkHomeFlows();
    expect(calls.filter((c) => c === '/link/status').length).toBe(1);
  });
});

describe('Y6c Flow step wording', () => {
  it('the "Assigned to" select has the hint under it', () => {
    const src = extractFn(Y6_HTML, '_lkStepHtml');
    const i = src.indexOf('id="lk-assign"');
    expect(i).toBeGreaterThan(0);
    expect(src.slice(i)).toMatch(/<\/select>[^]*?Saved in this app only\. Elvanto isn't changed\./);
  });
  it('assignee-needed says what to do', () => {
    expect(f._lkStatusText({ status: 'refused', reason: 'assignee-needed' })).toBe("Pick who gets the next step, or Elvanto's usual pick, then Complete again.");
  });
});

describe('Y6c _lkVerb', () => {
  it('names every intake and consent type in words', () => {
    const v = loadFns(['_lkVerb']);
    const types = ACTION_TYPES.filter((t) => /^(intake|consent)/.test(t));
    expect(types.length).toBe(7);
    for (const t of types) expect(v._lkVerb(t)).toMatch(/^[A-Z][a-z]+ [a-z]+$/);
    expect(v._lkVerb('checkIn')).toBe('Check in'); // the old ones unchanged
  });
});
