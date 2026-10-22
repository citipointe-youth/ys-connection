import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadFns, loadIndexHtml } from './helpers/extract-fn';
import { MINISTRY_CONFIG_DEFAULTS, DEFAULT_CONSENT_DECLARATION } from '../core/ministry-config';

const PRE = "const esc = (s) => String(s == null ? '' : s).replace(/[&<>\"']/g, (c) => '&#' + c.charCodeAt(0) + ';'); const icS = (n) => '<i data-i=\"' + n + '\"></i>'; const fmtDay = (v) => 'Mon 5 Oct';";

describe('bus consent chip and details', () => {
  it('current = green "Consent 2026"; not current = warning "No consent 2026"; never a blocking class', () => {
    const { _busConsentChip } = loadFns(['_busConsentChip'], PRE);
    expect(_busConsentChip({ consent: { year: 2026, current: true } })).toMatch(/pill ok[^]*Consent 2026/);
    expect(_busConsentChip({ consent: { year: 2026, current: false } })).toMatch(/c-warn[^]*No consent 2026/);
    expect(_busConsentChip({})).toBe('');
  });
  it('a coordinator tap on No consent opens the form; no tap by default', () => {
    const { _busConsentChip } = loadFns(['_busConsentChip'], PRE);
    expect(_busConsentChip({ id: 'r1', consent: { year: 2026, current: false } }, true)).toContain("busConsentForm({riderId:'r1'})");
    expect(_busConsentChip({ id: 'r1', consent: { year: 2026, current: false } })).not.toContain('onclick');
  });
  it('details escape every value and show filed-by for an app form', () => {
    const { _busConsentDetailsHtml } = loadFns(['_busConsentDetailsHtml'], PRE);
    const h = _busConsentDetailsHtml({ year: 2026, current: true, details: { formId: 'f1', submittedAt: '2026-10-05T01:00:00Z', source: 'app', filedBy: 'Pat <b>',
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
    const { _bcFormHtml } = loadFns(['_bcFormHtml'], PRE);
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
    expect(readFileSync(join(__dirname, '..', '..', 'public', 'sw.js'), 'utf8')).toMatch(/const CACHE = 'ysc-v143'/);
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

describe('pickup-by visibility', () => {
  it('shown only when pickup is No; hidden on Yes and blank', () => {
    const { _bcPickupShown, row, sel } = loadFns(['_bcPickupShown'],
      "const row = { hidden: false }, sel = { value: '' }; const document = { getElementById: (id) => (id === 'bc-pickup' ? sel : row) };", ['_bcPickupShown', 'row', 'sel']);
    const hiddenFor = (v: string) => { sel.value = v; _bcPickupShown(); return row.hidden; };
    expect([hiddenFor('n'), hiddenFor('y'), hiddenFor(''), hiddenFor('n')]).toEqual([false, true, true, false]);
  });
});
