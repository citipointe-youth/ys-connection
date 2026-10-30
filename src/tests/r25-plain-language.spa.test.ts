// Leader plain-language pass (operator 2026-10-25): admin/oversight keep every technical word; leader, grade and quad
// logins get plain lines. Real functions from public/index.html.
import { describe, it, expect } from 'vitest';
import { loadFns } from './helpers/extract-fn';

const PRE = `var S = { user: { role: 'grade' } };
  function role(r) { S.user.role = r; }
  let LINK = { status: null, red: false, flash: false, people: {}, gres: {}, fres: {}, mres: {} };
  const LK_OFFLINE_MS = 15 * 60000; let Q = [];
  function _lkQGet() { return Q; } function setQ(q) { Q = q; }
  function esc(s) { return String(s); } function icS() { return ''; }
  function _lkTime() { return '7:05 pm'; } function _lkSeen() { return '7:02 pm'; } function _lkOutsideWindow() { return false; }`;
const f = loadFns(['_lkStatusText', '_lkStatusHtml', '_lkBanner', '_lkOfflineSince', '_lkPill', '_plainErr', '_lkStepBlock', '_lkPlainToast'],
  PRE + '\nfunction _lkPeopleFlowFound() { return true; } function _lkConsentWait() { return false; }',
  ['_lkStatusHtml', '_lkBanner', '_lkPill', '_plainErr', '_lkStepBlock', '_lkPlainToast', 'role', 'setQ', 'LINK']);
const as = (r: string) => f.role(r);
const line = (row: any) => f._lkStatusHtml(row).replace(/<[^>]+>/g, '').trim();

describe('door status lines', () => {
  const rows: [any, string, string][] = [
    [{ status: 'pending', reason: null }, 'Waiting for Elvanto.', 'Saving…'],
    [{ status: 'claimed', reason: null }, 'Sending to Elvanto…', 'Saving…'],
    [{ status: 'sent', reason: null, resultAt: '2026-10-23T09:05:00Z', type: 'checkIn' }, 'In Elvanto 7:05 pm', 'Saved'],
    [{ status: 'sent', reason: 'already', type: 'checkIn' }, 'Already in Elvanto', 'Saved'],
    [{ status: 'mirror', reason: null }, 'In Elvanto.', 'Checked in'],
    [{ status: 'refused', reason: 'lease-lost' }, 'Not sure it saved. The admin is checking Elvanto.', "Still checking. Don't tap again — tell the admin if it doesn't clear."],
    [{ status: 'refused', reason: 'no-room', type: 'checkIn' }, 'No check-in room found for this person. Tap again in a few minutes, or check in on the kiosk.', "Couldn't save. Try again, or tell the admin."],
    [{ status: 'unclear', reason: null }, 'Not sure it saved. The admin is checking Elvanto.', "Still checking. Don't tap again — tell the admin if it doesn't clear."],
    [{ status: 'refused', reason: 'weird-new', message: 'Elvanto said 500' }, 'Elvanto said 500', "Couldn't save. Try again, or tell the admin."],
  ];
  it('a grade, quad or leader login reads the plain line', () => {
    for (const r of ['grade', 'quad', 'leader']) { as(r); for (const [row, , plain] of rows) expect(line(row), r + ' ' + row.status).toBe(plain); }
  });
  it('admin and oversight keep the original line', () => {
    for (const r of ['admin', 'oversight']) { as(r); for (const [row, boss] of rows) expect(line(row), r + ' ' + row.status).toBe(boss); }
  });
  it('a plain refusal message passes through; the over-15-min pending line says Still saving', () => {
    as('grade');
    expect(line({ status: 'refused', reason: 'member-dup', message: 'Already in this group.' })).toBe('Already in this group.');
    f.LINK.status = { console: { online: true } };
    expect(line({ status: 'pending', reason: null, createdAt: new Date(Date.now() - 20 * 60000).toISOString() })).toBe('Still saving…');
    f.LINK.status = null;
  });
});

describe('door banner', () => {
  const st = { console: { online: false, lastSeenAt: '2026-10-23T09:02:00Z' } };
  it('non-boss: plain, no Elvanto', () => {
    as('grade');
    expect(f._lkBanner(['checkIn'], st).replace(/<[^>]+>/g, '')).toBe("Taps are saved on this phone and will send shortly. Use the kiosk if it's urgent.");
  });
  it('boss: the original line', () => {
    as('admin');
    expect(f._lkBanner(['checkIn'], st).replace(/<[^>]+>/g, '')).toContain('No link to Elvanto since 7:02 pm. Your taps send later. Use the kiosk too.');
  });
});

describe('pill', () => {
  it('non-boss reads saving / could not save; boss keeps the old words', () => {
    f.setQ([{ kind: 'action' }, { kind: 'action' }]);
    as('grade'); expect(f._lkPill()).toContain('2 saving…');
    as('admin'); expect(f._lkPill()).toContain('2 waiting to send');
    f.LINK.red = true;
    as('grade'); expect(f._lkPill()).toContain("Couldn't save. Tap to try again");
    as('admin'); expect(f._lkPill()).toContain('Not saved — tap to retry');
    f.LINK.red = false; f.setQ([]);
    f.LINK.people = { S: { people: [{ mine: true, action: { status: 'pending' } }], leaders: [] } };
    as('quad'); expect(f._lkPill()).toContain('Saving…');
    as('oversight'); expect(f._lkPill()).toContain('Sent. Waiting for Elvanto.');
    f.LINK.people = {};
  });
});

describe('API wrapper error text (_plainErr)', () => {
  it('non-boss: a 5xx or a technical code becomes plain; a 4xx business message passes', () => {
    as('grade');
    expect(f._plainErr('GET', 500, 'INTERNAL_ERROR', 'boom at line 4')).toBe("Couldn't load. Try again.");
    expect(f._plainErr('POST', 503, 'SERVICE_UNAVAILABLE', 'The service is temporarily unavailable.')).toBe("Couldn't save. Try again.");
    expect(f._plainErr('POST', 400, 'VALIDATION_ERROR', 'Validation failed')).toBe("Couldn't save. Try again.");
    expect(f._plainErr('POST', 409, 'LINK_UNAVAILABLE', 'Do this in Elvanto for now.')).toBe("Couldn't save. Try again.");
    expect(f._plainErr('POST', 409, 'LINK_BUSY_ROW', 'Something is already waiting...')).toBe('Already saving. Wait a moment.');
    expect(f._plainErr('POST', 409, 'CONFLICT', "There's already a report for that date. Edit it.")).toBe("There's already a report for that date. Edit it.");
    expect(f._plainErr('POST', 502, 'ELVANTO_UNREACHABLE', "Couldn't reach Elvanto, so nothing was sent.")).toBe("Couldn't reach the system, so nothing was sent.");
  });
  it('boss: the server words unchanged', () => {
    as('admin');
    expect(f._plainErr('GET', 500, 'INTERNAL_ERROR', 'boom at line 4')).toBe('boom at line 4');
    expect(f._plainErr('POST', 409, 'LINK_UNAVAILABLE', 'Do this in Elvanto for now.')).toBe('Do this in Elvanto for now.');
  });
});

describe('lifegroup / flow lines', () => {
  const r = { consentStep: true, consent: 'none', notReceivedOk: false, stepName: 'Step 2' };
  it('the consent block: non-boss "Tell the admin.", boss the original', () => {
    as('leader'); expect(f._lkStepBlock(r)).toBe('Tell the admin.');
    as('admin'); expect(f._lkStepBlock(r)).toBe('Do the consent check first (New youth & consent).');
  });
  it('a lifegroup report line keeps its meaning without Elvanto for non-boss', () => {
    as('grade'); expect(line({ status: 'refused', reason: 'report-changed' })).toBe('This report changed. Reload and try again.');
    expect(line({ status: 'refused', reason: 'multi-service' })).toBe('Tell the admin.');
    as('oversight'); expect(line({ status: 'refused', reason: 'report-changed' })).toBe('This report changed in Elvanto. Reload and try again.');
  });
  it('a batch toast: technical lines become plain, business lines stay', () => {
    expect(f._lkPlainToast('Still sending, try again in a minute.')).toBe('Still sending, try again in a minute.');
    expect(f._lkPlainToast('Already sent. Do it in Elvanto.')).toBe('Already sent. Tell the admin.');
    expect(f._lkPlainToast('Elvanto refused the check-out.')).toBe("Couldn't save. Try again.");
  });
});
