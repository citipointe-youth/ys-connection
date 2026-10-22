import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadFns, loadIndexHtml } from './helpers/extract-fn';

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
  it('no bus_consents leftovers in the SPA', () => {
    const html = loadIndexHtml();
    for (const gone of ['_busConsentBox', 'busSaveConsent', "/consent'", 'bc-given', 'bc-note']) expect(html).not.toContain(gone);
  });
});

