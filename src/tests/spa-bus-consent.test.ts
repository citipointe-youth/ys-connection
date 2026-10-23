import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadFns, loadIndexHtml } from './helpers/extract-fn';
import { MINISTRY_CONFIG_DEFAULTS, DEFAULT_CONSENT_DECLARATION } from '../core/ministry-config';

const PRE = "const esc = (s) => String(s == null ? '' : s).replace(/[&<>\"']/g, (c) => '&#' + c.charCodeAt(0) + ';'); const icS = (n) => '<i data-i=\"' + n + '\"></i>'; const fmtDay = (v) => 'Mon 5 Oct';";

describe('bus consent chip and details', () => {
  it('current = green "Consent 2026"; not current = warning "No consent 2026"; never a blocking class', () => {
    const { _busConsentChip } = loadFns(['_busChipRow', '_busConsentChip', '_busConsentHintHtml', '_busPickupChip'], PRE);
    expect(_busConsentChip({ consent: { year: 2026, current: true } })).toMatch(/pill ok[^]*Consent 2026/);
    expect(_busConsentChip({ consent: { year: 2026, current: false } })).toMatch(/c-warn[^]*No consent 2026/);
    expect(_busConsentChip({})).toBe('');
  });
  it('a coordinator tap on No consent opens the form; no tap by default', () => {
    const { _busConsentChip } = loadFns(['_busChipRow', '_busConsentChip', '_busConsentHintHtml', '_busPickupChip'], PRE);
    expect(_busConsentChip({ id: 'r1', consent: { year: 2026, current: false } }, true)).toContain("busConsentForm({riderId:'r1'})");
    expect(_busConsentChip({ id: 'r1', consent: { year: 2026, current: false } })).not.toContain('onclick');
  });
  it('details escape every value and show filed-by for an app form', () => {
    const { _busConsentDetailsHtml } = loadFns(['_busConsentDetailsHtml', '_busPickupLine'], PRE);
    const h = _busConsentDetailsHtml({ year: 2026, current: true, pickup: 'named', details: { formId: 'f1', submittedAt: '2026-10-05T01:00:00Z', source: 'app', filedBy: 'Pat <b>',
      parentName: 'Alex', parentPhone: null, address: { line1: '1 Test St', line2: '-', postcode: '4000', city: 'Brisbane City', state: 'QLD' }, pickup: false, pickupBy: 'Nan', school: 'X' } });
    expect(h).toContain('Pat &#60;b&#62;');
    expect(h).toMatch(/Filed from the app/);
    expect(h).toMatch(/Nan/);
    expect(h).not.toMatch(/null/);
  });
  it('the differs hint shows only with differs true', () => {
    const { _busConsentHintHtml } = loadFns(['_busConsentHintHtml'], PRE);
    expect(_busConsentHintHtml({ id: 'r1', consent: { current: true, differs: true, details: { formId: 'f1' } } })).toMatch(/Consent address differs/);
    expect(_busConsentHintHtml({ id: 'r1', consent: { current: true, differs: false } })).toBe('');
  });
});

describe('check button and status line', () => {
  it('never checked / last checked with new count / checking disables the button / unmatched line', () => {
    const { _busConsentStatusHtml } = loadFns(['_busConsentStatusHtml'], PRE);
    expect(_busConsentStatusHtml({ lastChecked: '', lastNew: 0, checking: false, canCheck: true, unmatched: [] })).toMatch(/Never checked/);
    const h = _busConsentStatusHtml({ lastChecked: '2026-10-23T04:00:20Z', lastNew: 2, checking: true, canCheck: true, unmatched: [{ name: 'Nobody Known', submittedAt: '2026-10-21T00:00:00Z' }] });
    expect(h).toMatch(/2 new/); expect(h).toMatch(/Checking/); expect(h).toMatch(/disabled/); expect(h).toMatch(/Forms we couldn.{1,6}t match: 1/);
    expect(_busConsentStatusHtml({ lastChecked: '', lastNew: 0, checking: false, canCheck: false, unmatched: null })).not.toMatch(/button/);
  });
});

describe('address picker consent row (R8)', () => {
  it('sits after the charter bus rows and before saved addresses; reads back as {consentFormId}', () => {
    const { _busAddressPicker } = loadFns(['_busAddressPicker', '_busAddrLabel', '_busAcField', '_busSuburb', '_busUuid'], PRE + " const window = {}; const BUS = { ac: {}, view: { vehicles: [{ id: 'v1', kind: 'bus', running: true, endsAddress: '5 Depot Rd, Carina', vehicleId: 'V' }] } };");
    const h = _busAddressPicker([{ id: 'a1', label: 'Home', street: '9 Other Rd', suburb: 'Carina' }], null, false, { formId: 'f1', line1: '1 Test St', city: 'Brisbane City' });
    const bus = h.indexOf('bus:v1'), consent = h.indexOf('consent:f1'), saved = h.indexOf('value="a1"');
    expect(bus).toBeGreaterThan(-1); expect(consent).toBeGreaterThan(bus); expect(saved).toBeGreaterThan(consent);
    expect(h).toMatch(/Consent form · 1 Test St, Brisbane City/);
  });
  it('a picked consent row is the only pre-checked row', () => {
    const { _busAddressPicker } = loadFns(['_busAddressPicker', '_busAddrLabel', '_busAcField', '_busSuburb', '_busUuid'], PRE + ' const window = {}; const BUS = { ac: {}, view: { vehicles: [] } };');
    const h = _busAddressPicker([{ id: 'a1', label: 'Home', street: '9 Other Rd', suburb: 'Carina' }], null, false, { formId: 'f1', line1: '1 Test St', city: 'B', pick: true });
    expect((h.match(/checked/g) || []).length).toBe(1);
    expect(h).toMatch(/value="consent:f1" checked/);
  });
  it('_busReadAddress returns {consentFormId} for the consent row', () => {
    const { _busReadAddress } = loadFns(['_busReadAddress'], "const document = { querySelector: () => ({ value: 'consent:f1' }) };");
    expect(_busReadAddress()).toEqual({ consentFormId: 'f1' });
  });
  it('an unmatched consent address fills New address from the form it already holds (F7)', () => {
    const { _busConsentUnmatched, els, radio, said } = loadFns(['_busConsentUnmatched'],
      "const els = { 'bus-addr-text': { value: '' } }; const radio = { checked: false }; const said = []; const document = { querySelector: () => radio, getElementById: (id) => els[id] }; const toast = (m) => said.push(m);",
      ['_busConsentUnmatched', 'els', 'radio', 'said']);
    expect(_busConsentUnmatched({ code: 'OTHER' }, null)).toBe(false);
    expect(_busConsentUnmatched({ code: 'CONSENT_ADDRESS_UNMATCHED', message: 'Pick it' }, { details: { address: { line1: '1 Test St', city: 'Brisbane City', state: 'QLD', postcode: '4000' } } })).toBe(true);
    expect(els['bus-addr-text'].value).toBe('1 Test St, Brisbane City QLD 4000');
    expect(radio.checked).toBe(true); expect(said).toEqual(['Pick it']);
  });
  it('no old consent table leftovers in the SPA', () => {
    const html = loadIndexHtml();
    for (const gone of ['_busConsentBox', 'busSaveConsent', "/consent'", 'bc-given', 'bc-note']) expect(html).not.toContain(gone);
  });
});

describe('consent form sheet (R2, R3, R6)', () => {
  it('banner first, declaration shows the saved text with both links, the child name filled in', () => {
    const { _bcFormHtml } = loadFns(['_bcFormHtml', '_busAcField', '_busUuid'], PRE + ' const window = {}; const BUS = { ac: {} };');
    const h = _bcFormHtml({ first: 'Jess', last: 'Tran', grade: 9, gender: 'f', declaration: 'May [child] ride?' });
    expect(h.indexOf('on the parent')).toBeLessThan(h.indexOf('bc-first'));
    expect(h).toContain('May Jess Tran ride?');
    expect(h).toContain('https://citipointechurch.com/privacypolicy'); expect(h).toContain('https://citipointechurch.com/parent-info');
  });
  it('every required field is named when missing; line 2 is optional', () => {
    const { _bcMissing } = loadFns(['_bcMissing']);
    const ok = { first: 'J', last: 'T', grade: '9', gender: 'f', mobile: '0400000001', school: 'X', address: { line1: '1 A St', line2: '', postcode: '4000', city: 'B', state: 'QLD' },
      parentName: 'A', parentPhone: '0400000003', pickup: true };
    expect(_bcMissing(ok)).toBeNull();
    for (const [k, label] of [['school', 'school'], ['parentPhone', 'parent phone'], ['pickup', 'picking up']] as const) expect(_bcMissing({ ...ok, [k]: k === 'pickup' ? null : '' })).toMatch(label);
    expect(_bcMissing({ ...ok, address: { ...ok.address, postcode: '' } })).toMatch(/postcode/);
  });
  it('the confirm gate: Submit stays disabled until the tick (R2)', () => {
    const { _bcConfirmHtml } = loadFns(['_bcConfirmHtml'], PRE);
    const h = _bcConfirmHtml('Alex Tran');
    expect(h).toMatch(/I read the declaration to Alex Tran and they agreed/);
    expect(h).toMatch(/id="bc-submit"[^>]*disabled/);
  });
  it('result text: sent with drop-off; unconfirmed says check Elvanto, never "try again"', () => {
    const { _bcResultText } = loadFns(['_bcResultText']);
    expect(_bcResultText({ result: 'sent', dropoff: 'Carindale stop' }).lines.join(' ')).toMatch(/Carindale stop/);
    const u = _bcResultText({ result: 'unconfirmed', dropoff: null, queued: true }).lines.join(' ');
    expect(u).toMatch(/Elvanto/); expect(u).not.toMatch(/try again/i);
  });
  it('a rider opens the form by riderId so a redacted login still works (F6)', () => {
    const src = loadIndexHtml();
    expect(src).toContain("'riderId=' + encodeURIComponent(who.riderId)");
  });
  it('SW bumped; reset text no longer promises to delete bus consents', () => {
    const html = loadIndexHtml();
    expect(html).not.toMatch(/deletes bus parent consents/);
    expect(html).toContain('Bus consent forms and the record of who filed them are deleted too (Elvanto keeps the original forms).');
    expect(html).toContain('Bus consent forms count for one calendar year');
    expect(readFileSync(join(__dirname, '..', '..', 'public', 'sw.js'), 'utf8')).toMatch(/const CACHE = 'ysc-v148'/);
  });
});

// F5: the "client default = server default" pin landed at the Task 10 merge.
describe('declaration editor and client defaults', () => {
  it('Bus settings has the declaration textarea, a reset and the patch key; defaults carry the new keys', () => {
    const html = loadIndexHtml();
    expect(html).toContain('id="bus-decl"');
    expect(html).toContain('consentDeclaration: document.getElementById(\'bus-decl\').value.trim()');
    expect(html).toMatch(/consentDeclaration: '[^']+', consentLastChecked: '', consentLastNew: 0/);
  });
  it('client default = server default (F5, Task 10): the whole busMinistry block, declaration included', () => {
    const src = loadIndexHtml();
    const i = src.indexOf('const MINISTRY_CONFIG_DEFAULTS_CLIENT = {');
    const block = src.slice(i, src.indexOf('\n};', i) + 3);
    // eslint-disable-next-line no-new-func
    const client = new Function(`${block}\nreturn MINISTRY_CONFIG_DEFAULTS_CLIENT;`)();
    expect(client.busMinistry.consentDeclaration).toBe(DEFAULT_CONSENT_DECLARATION);
    expect(client.busMinistry).toEqual(MINISTRY_CONFIG_DEFAULTS.busMinistry);
    expect(client.elvanto.busConsentFormId).toBe(MINISTRY_CONFIG_DEFAULTS.elvanto.busConsentFormId);
  });
  it('Youth Setup has the Bus consent form link input (F11)', () => {
    expect(loadIndexHtml()).toContain('setup-elv-bus');
  });
});

describe('fix round 1', () => {
  it('the differs button stops the tap reaching the row', () => {
    const { _busConsentHintHtml } = loadFns(['_busConsentHintHtml'], PRE);
    expect(_busConsentHintHtml({ id: 'r1', consent: { differs: true, details: { formId: 'f1' } } })).toContain("onclick=\"event.stopPropagation();busEditRider('r1', 'consent:f1')");
  });
  const POLL = (page: string, editing = false) => `
    const S = { page: '${page}' }; const BUS = { consentStatus: null, pendingRepaint: false }; const calls = { render: 0, toast: [], get: 0 };
    let reply = { checking: true }, offline = false, tmr = null, _busConsentPoll = null;
    const setInterval = (f) => { calls.intervals = (calls.intervals || 0) + 1; tmr = f; return calls.intervals; }; const clearInterval = () => { calls.cleared = (calls.cleared || 0) + 1; tmr = null; };
    const renderBus = () => { calls.render++; }; const _busEditing = () => ${editing}; const toast = (m) => calls.toast.push(m);
    const _busSend = async () => ({}); const _busGet = async () => { calls.get++; if (offline) throw new Error('x'); return reply; };`;
  const NAMES = ['_busConsentRepaint', 'busConsentCheck', '_busConsentPollTick'];
  const RET = [...NAMES, 'calls', 'BUS', 'S', '_pollSet'];
  const load = (page: string, editing = false) => loadFns(NAMES, POLL(page, editing) + ' const _pollSet = (o) => { if (o.reply) reply = o.reply; if ("offline" in o) offline = o.offline; };', RET);
  it('stops polling and repaints once checking is false', async () => {
    const f = load('bus'); f._pollSet({ reply: { checking: false, lastNew: 1 } });
    await f._busConsentPollTick(Date.now() + 1000);
    expect(f.calls.cleared).toBe(1); expect(f.calls.render).toBe(1); expect(f.BUS.consentStatus.lastNew).toBe(1);
  });
  it('times out with the toast, even while offline, and re-enables the button', async () => {
    const f = load('bus'); f._pollSet({ offline: true });
    await f._busConsentPollTick(Date.now() - 1);
    expect(f.calls.toast).toEqual(["Console didn't respond, try again later"]); expect(f.BUS.consentStatus.checking).toBe(false); expect(f.calls.cleared).toBe(1);
  });
  it('two taps leave one live interval; a tap off the Bus page does not repaint', async () => {
    const f = load('bus'); await f.busConsentCheck(); await f.busConsentCheck();
    expect(f.calls.intervals).toBe(2); expect(f.calls.cleared).toBe(2); // each tap clears the previous before setting its own
    const g = load('home'); await g.busConsentCheck();
    expect(g.calls.render).toBe(0);
    await g._busConsentPollTick(Date.now() + 1000); expect(g.calls.cleared).toBeGreaterThan(1);
  });
  it('typing in a field defers the repaint', async () => {
    const f = load('bus', true); await f.busConsentCheck();
    expect(f.calls.render).toBe(0); expect(f.BUS.pendingRepaint).toBe(true);
  });
  it('a late _bcRelookup reply is dropped when the sheet was replaced (house late-reply rule)', async () => {
    let sheet: any = { id: 1 };
    const { _bcRelookup, BUS } = loadFns(['_bcRelookup', '_bcQuery'], `
      const BUS = { bc: { p: { declaration: 'd' }, who: { riderId: 'r' } } };
      const _bcRead = () => ({ first: 'Jess', last: 'Tran', address: {} });
      const _here = () => ({ mo: 1 }); const _stillSheet = (h) => globalThis.__sheetSame;
      const _busGet = async (p) => p.includes('search') ? [{ kind: 'student', id: 's1' }] : { address: {}, declaration: 'd2' };
      const busConsentForm = () => { globalThis.__rendered = true; };`, ['_bcRelookup', 'BUS']);
    (globalThis as any).__sheetSame = false; (globalThis as any).__rendered = false;
    await _bcRelookup(); expect((globalThis as any).__rendered).toBe(false); expect(BUS.bc.who).toEqual({ riderId: 'r' });
    (globalThis as any).__sheetSame = true; await _bcRelookup(); expect((globalThis as any).__rendered).toBe(true); expect(BUS.bc.who).toEqual({ studentId: 's1' });
    void sheet;
  });
  it('a blank declaration saves as the default', () => {
    expect(loadIndexHtml()).toMatch(/bus-decl'\)\.value\.trim\(\) \|\| MINISTRY_CONFIG_DEFAULTS_CLIENT\.busMinistry\.consentDeclaration/);
  });
});

describe('consent form Address search (operator 2026-10-23)', () => {
  const DOC = `const els = {}; for (const id of ['bc-line1', 'bc-line2', 'bc-city', 'bc-postcode', 'bc-state']) els[id] = { value: 'old', focused: false, focus() { this.focused = true; } };
    const document = { getElementById: (id) => els[id] || null }; const toasts = []; const toast = (m) => toasts.push(m);
    let reply = null, fail = false, same = true, gate = null; const asked = [];
    const BUS = { ac: {} }; const _here = () => ({ mo: 1 }); const _stillSheet = () => same;
    const _busGet = async (p, q) => { asked.push([p, q]); const g = gate; const r = reply; if (g) await g; if (fail) throw new Error('Address search is unavailable'); return r; };
    const _set = (o) => { if ('reply' in o) reply = o.reply; if ('fail' in o) fail = o.fail; if ('same' in o) same = o.same; if ('gate' in o) gate = o.gate; };`;
  const load = () => loadFns(['_bcFillFromPlace'], DOC, ['_bcFillFromPlace', 'els', 'toasts', 'asked', '_set', 'BUS']);
  const LINES = ['bc-line1', 'bc-line2', 'bc-city', 'bc-postcode', 'bc-state'];
  it('the sheet has one Address search at the top of the block, the five lines below it, and a type-it-in path', () => {
    const { _bcFormHtml } = loadFns(['_bcFormHtml', '_busAcField', '_busUuid'], PRE + ' const window = {}; const BUS = { ac: {} };');
    const h = _bcFormHtml({ first: 'J', last: 'T', address: { line1: '1 <b> St', line2: '-', city: 'B', postcode: '4000', state: 'QLD' } });
    const ac = h.indexOf('id="bc-addr"'), l1 = h.indexOf('id="bc-line1"');
    expect(ac).toBeGreaterThan(-1); expect(l1).toBeGreaterThan(ac);
    for (const id of LINES.slice(1)) expect(h.indexOf('id="' + id + '"')).toBeGreaterThan(l1);
    expect(h).toContain("Can't find it? Type it in"); expect(h).toContain("getElementById('bc-line1').focus()");
    expect(h).toContain('1 &#60;b&#62; St'); // prefill unchanged and escaped
    expect(h).toMatch(/id="bc-line2"[^>]*value=""/); // '-' shows blank
  });
  it('picking a suggestion fills all five lines: a unit case and a no-unit case', async () => {
    const f = load();
    f._set({ reply: { line1: '12 Test St', line2: 'Unit 3', city: 'Carina', postcode: '4152', state: 'QLD' } });
    await f._bcFillFromPlace('pl1', 'sess-0001');
    expect(f.asked[0]).toEqual(['/bus/places/details', 'placeId=pl1&session=sess-0001']);
    expect(LINES.map((id) => f.els[id].value)).toEqual(['12 Test St', 'Unit 3', 'Carina', '4152', 'QLD']);
    f._set({ reply: { line1: '5 Other Rd', line2: '', city: 'Testville', postcode: '4000', state: 'QLD' } });
    await f._bcFillFromPlace('pl2', 'sess-0002');
    expect(LINES.map((id) => f.els[id].value)).toEqual(['5 Other Rd', '', 'Testville', '4000', 'QLD']);
  });
  it('a late details reply is dropped: sheet replaced, or a newer pick', async () => {
    const f = load();
    f._set({ reply: { line1: '12 Test St', line2: '', city: 'C', postcode: '4152', state: 'QLD' }, same: false });
    await f._bcFillFromPlace('pl1', 's');
    expect(f.els['bc-line1'].value).toBe('old');
    let release: () => void = () => {};
    f._set({ same: true, reply: { line1: 'STALE', line2: '', city: 'S', postcode: '1', state: 'QLD' }, gate: new Promise<void>((r) => { release = r; }) });
    const first = f._bcFillFromPlace('pl1', 's');
    f._set({ gate: null, reply: { line1: '2 New St', line2: '', city: 'N', postcode: '4001', state: 'QLD' } });
    await f._bcFillFromPlace('pl2', 's');
    release(); await first;
    expect(f.els['bc-line1'].value).toBe('2 New St');
  });
  it('a Google error leaves manual entry: a toast and line 1 focused, nothing overwritten', async () => {
    const f = load(); f._set({ fail: true });
    await f._bcFillFromPlace('pl1', 's');
    expect(f.toasts).toEqual(['Could not fill in that address. Type it in below.']);
    expect(f.els['bc-line1'].focused).toBe(true); expect(f.els['bc-line1'].value).toBe('old');
  });
  it('manual entry still submits: typed lines with no search pass the check and reach the confirm step', () => {
    const vals: Record<string, string> = { 'bc-first': 'Jess', 'bc-last': 'Tran', 'bc-grade': '9', 'bc-gender': 'f', 'bc-mobile': '0400000001', 'bc-school': 'X',
      'bc-line1': '7 Typed St', 'bc-line2': '', 'bc-city': 'Carina', 'bc-postcode': '4152', 'bc-state': 'QLD', 'bc-addr': '', 'bc-pname': 'Alex', 'bc-pphone': '0400000003', 'bc-pickup': 'y' };
    const f = loadFns(['busConsentSubmit', '_bcRead', '_bcMissing'], `const __v = ${JSON.stringify(vals)}; const document = { getElementById: (id) => ({ value: __v[id] || '' }) };
      const BUS = { bc: { p: { declaration: 'd' } } }; const toasts = []; const toast = (m) => toasts.push(m); let shown = ''; const modal = (h) => { shown = h; };
      const _bcConfirmHtml = (p) => 'confirm ' + p; const _shown = () => shown;`, ['busConsentSubmit', 'BUS', 'toasts', '_shown']);
    f.busConsentSubmit();
    expect(f.toasts).toEqual([]); expect(f._shown()).toBe('confirm Alex');
    expect(f.BUS.bc.f.address).toEqual({ line1: '7 Typed St', line2: '', postcode: '4152', city: 'Carina', state: 'QLD' });
  });
  it('busAcPick on the consent field asks for details with the session the suggestions used', () => {
    const f = loadFns(['busAcPick'], `const BUS = { ac: { 'bc-addr': { session: 'sess-old1' } }, acHits: { 'bc-addr': [{ placeId: 'pl9', text: '9 A St' }] } };
      const document = { getElementById: () => null }; const _busUuid = () => 'sess-new1'; const calls = []; const _bcFillFromPlace = (p, s) => calls.push([p, s]);`, ['busAcPick', 'calls', 'BUS']);
    f.busAcPick('bc-addr', 0);
    expect(f.calls).toEqual([['pl9', 'sess-old1']]); expect(f.BUS.ac['bc-addr'].session).toBe('sess-new1');
  });
});

describe('pickup-by visibility', () => {
  it('shown only when pickup is No; hidden on Yes and blank', () => {
    const { _bcPickupShown, row, sel } = loadFns(['_bcPickupShown'],
      "const row = { hidden: false }, sel = { value: '' }; const document = { getElementById: (id) => (id === 'bc-pickup' ? sel : row) };", ['_bcPickupShown', 'row', 'sel']);
    const hiddenFor = (v: string) => { sel.value = v; _bcPickupShown(); return row.hidden; };
    expect([hiddenFor('n'), hiddenFor('y'), hiddenFor(''), hiddenFor('n')]).toEqual([false, true, true, false]);
  });
});

describe('pickup chip and profile line (operator 2026-10-23)', () => {
  const chip = () => loadFns(['_busChipRow', '_busConsentChip', '_busConsentHintHtml', '_busPickupChip'], PRE)._busConsentChip;
  it('parent and named = green Pickup; dropHome = orange Drop home with the aria-label; no chip without a current form or a pickup', () => {
    const c = chip();
    for (const p of ['parent', 'named']) expect(c({ consent: { year: 2026, current: true, pickup: p } })).toMatch(/Consent 2026<\/span><span class="pill ok bus-chip"[^>]*><i data-i="users"><\/i>Pickup<\/span>/);
    const dh = c({ consent: { year: 2026, current: true, pickup: 'dropHome' } });
    expect(dh).toMatch(/<span class="chip c-warn bus-chip"[^>]*aria-label="No pickup named, probably needs a drop home"[^>]*><i data-i="home"><\/i>Drop home<\/span>/);
    expect(c({ consent: { year: 2026, current: false, pickup: 'parent' } })).not.toMatch(/Pickup|Drop home/);
    expect(c({ consent: { year: 2026, current: true } })).not.toMatch(/Pickup|Drop home/); // a junior leader view carries no pickup
  });
  it('profile line text for the three states, escaped; nothing without a pickup', () => {
    const { _busConsentDetailsHtml } = loadFns(['_busConsentDetailsHtml', '_busPickupLine'], PRE);
    const det = { formId: 'f1', submittedAt: '2026-10-05T01:00:00Z', source: 'public', parentName: 'Alex', address: {}, school: 'X' };
    expect(_busConsentDetailsHtml({ year: 2026, current: true, pickup: 'parent', details: { ...det, pickup: true, pickupBy: '' } })).toContain('Pickup: parent at bus spot');
    expect(_busConsentDetailsHtml({ year: 2026, current: true, pickup: 'named', details: { ...det, pickup: false, pickupBy: 'Nan <b>' } })).toContain('Pickup: Nan &#60;b&#62;');
    expect(_busConsentDetailsHtml({ year: 2026, current: true, pickup: 'dropHome', details: { ...det, pickup: false, pickupBy: '' } })).toContain('No pickup named: probably needs a drop home');
    expect(_busConsentDetailsHtml({ year: 2026, current: true, details: det })).not.toMatch(/Pickup|pickup/);
  });
});

describe('compact differs chip (operator 2026-10-23)', () => {
  it('is a one-line chip button, not a btn-sm block, and keeps the stopPropagation tap to the picker with the consent row', () => {
    const { _busConsentHintHtml } = loadFns(['_busConsentHintHtml'], PRE);
    const h = _busConsentHintHtml({ id: 'r1', consent: { differs: true, details: { formId: 'f1' } } });
    expect(h).toMatch(/^<button type="button" class="chip c-warn bus-chip bus-hit bus-differs" onclick="event\.stopPropagation\(\);busEditRider\('r1', 'consent:f1'\)"/);
    expect(h).not.toContain('btn-sm'); expect(h).toContain('Consent address differs');
    expect(loadIndexHtml()).toMatch(/\.bus-differs\{border:0;cursor:pointer;font-family:inherit/);
  });
});

describe('bus chip row (operator 2026-10-23 spacing)', () => {
  const load = () => loadFns(['_busChipRow', '_busConsentChip', '_busConsentHintHtml', '_busPickupChip'], PRE)._busChipRow;
  it('puts consent, pickup, differs in one .bus-chips row, every chip sharing .bus-chip', () => {
    const h = load()({ id: 'r1', consent: { year: 2026, current: true, pickup: 'parent', differs: true, details: { formId: 'f1' } } }, false, true);
    expect(h).toMatch(/^<div class="bus-chips">/);
    expect(h.split(' bus-chip').length - 1).toBe(3);
    expect(h.indexOf('Consent 2026')).toBeLessThan(h.indexOf('Pickup'));
    expect(h.indexOf('Pickup')).toBeLessThan(h.indexOf('Consent address differs'));
  });
  it('one chip for a junior leader; no wrapper at all with none', () => {
    const f = load();
    expect(f({ consent: { year: 2026, current: true } }, false, true).split(' bus-chip').length - 1).toBe(1);
    expect(f({}, false, true)).toBe('');
  });
  it('CSS: flex-wrap row with 6px gap, shared 24px chip', () => {
    const css = loadIndexHtml();
    expect(css).toMatch(/\.bus-chips\{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px\}/);
    expect(css).toMatch(/\.bus-chip\{gap:4px;height:24px;padding:2px 8px;font-size:13px/);
  });
});
