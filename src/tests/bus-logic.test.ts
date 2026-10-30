import { describe, it, expect } from 'vitest';
import { MINISTRY_CONFIG_DEFAULTS, mergeMinistryConfig, DEFAULT_CONSENT_DECLARATION } from '../core/ministry-config';
import { can } from '../services/access-control';
import type { Actor } from '../core/entities/user';
import { currentRunDate, localDay, isServiceDay, addDays, eligibilityOf, capacityOf, nameMatches, suburbOf, riderKey, phoneKey, phoneMatches, suburbOnly, tidyName } from '../services/bus-logic';

const A = (role: string): Actor => ({ id: 'x', role: role as any, displayName: 'X', grade: null as any, quad: null as any });

describe('bus config defaults', () => {
  it('module off, no ministry-specific values', () => {
    expect(MINISTRY_CONFIG_DEFAULTS.modules.busMinistry).toBe(false);
    expect(MINISTRY_CONFIG_DEFAULTS.labels.busMinistry).toBe('Bus Ministry');
    expect(MINISTRY_CONFIG_DEFAULTS.busMinistry).toEqual({
      churchAddress: '', churchPlaceId: '', leaveTime: '21:00',
      targetRouteMin: 45, prefWeightMin: 10, genderWeightMin: 120,
      detourMin: 10, detourPct: 20, coordinatorLeaderIds: [],
      // bus consent (spec 2026-10-22): the drafted declaration is the one deliberate default (G1 approves it)
      consentDeclaration: DEFAULT_CONSENT_DECLARATION, consentLastChecked: '', consentLastNew: 0,
    });
  });
  it('merges a partial busMinistry patch', () => {
    const m = mergeMinistryConfig(MINISTRY_CONFIG_DEFAULTS, { busMinistry: { leaveTime: '20:30' } });
    expect(m.busMinistry.leaveTime).toBe('20:30');
    expect(m.busMinistry.targetRouteMin).toBe(45);
  });
});

describe('bus RBAC', () => {
  it('matches the spec matrix', () => {
    expect(['leader', 'grade', 'quad', 'oversight', 'admin'].map((r) => can(A(r), 'bus:use'))).toEqual([true, true, true, true, true]);
    expect(['leader', 'grade', 'quad', 'oversight', 'admin'].map((r) => can(A(r), 'bus:roster'))).toEqual([false, true, true, true, true]);
    expect(['leader', 'grade', 'quad', 'oversight', 'admin'].map((r) => can(A(r), 'bus:coordinate'))).toEqual([false, false, true, true, true]);
    expect(['leader', 'grade', 'quad', 'oversight', 'admin'].map((r) => can(A(r), 'bus:analysis'))).toEqual([false, false, false, true, true]);
  });
});

describe('currentRunDate (Friday = 5)', () => {
  it('Wednesday → coming Friday', () => expect(currentRunDate('2026-10-07T15:00', 5)).toBe('2026-10-09'));
  it('Friday evening → today', () => expect(currentRunDate('2026-10-09T19:05', 5)).toBe('2026-10-09'));
  it('Saturday 00:40 → still last night (drivers out late)', () => expect(currentRunDate('2026-10-10T00:40', 5)).toBe('2026-10-09'));
  it('Saturday 06:00 → next Friday', () => expect(currentRunDate('2026-10-10T06:00', 5)).toBe('2026-10-16'));
  it('works for a Sunday ministry', () => expect(currentRunDate('2026-10-07T10:00', 0)).toBe('2026-10-11'));
});
describe('eligibility + capacity', () => {
  it('from leader genders', () => {
    expect(eligibilityOf(['male'])).toEqual({ male: true, female: false, unknown: false });
    expect(eligibilityOf(['male', 'female'])).toEqual({ male: true, female: true, unknown: false });
    expect(eligibilityOf([null])).toEqual({ male: false, female: false, unknown: true });
    expect(eligibilityOf([])).toEqual({ male: false, female: false, unknown: true });
  });
  it('capacity never negative', () => { expect(capacityOf(12, 2)).toBe(10); expect(capacityOf(1, 3)).toBe(0); });
});
describe('names + suburb', () => {
  it('token prefix match, any order, accent-insensitive', () => {
    expect(nameMatches('kim ril', 'Riley', 'Kim')).toBe(true);
    expect(nameMatches('zoe', 'Zoë', 'Ng')).toBe(true);
    expect(nameMatches('ril x', 'Riley', 'Kim')).toBe(false);
  });
  it('suburb from a Google-style address', () => {
    expect(suburbOf('24 Wynnum Rd, Carina QLD 4152, Australia')).toBe('Carina');
    expect(suburbOf('12 Smith St')).toBe('12 Smith St');
  });
  it('rider key', () => expect(riderKey({ studentId: null, guestId: 'g1' })).toBe('g:g1'));
});
describe('phone matching (Task 2: guest↔student suggestions)', () => {
  it('leading 0 / 61 / +61 all normalise to the same key', () => {
    expect(phoneKey('0412 345 678')).toBe('412345678');
    expect(phoneKey('61412345678')).toBe('412345678');
    expect(phoneKey('+61 412 345 678')).toBe('412345678');
  });
  it('matches across formats, ignores short/garbage numbers', () => {
    expect(phoneMatches('0412345678', '+61 412 345 678')).toBe(true);
    expect(phoneMatches('0412345678', '0498765432')).toBe(false);
    expect(phoneMatches(null, null)).toBe(false);
    expect(phoneMatches('12345', '12345')).toBe(false); // too short to be real
  });
});
describe('suburbOnly (strict: blank when unsure, never a street)', () => {
  it('spec table', () => {
    expect(suburbOnly('Unit 3, 24 Wynnum Rd, Carina QLD 4152, Australia')).toBe('Carina');
    expect(suburbOnly('24 Wynnum Rd Carina QLD 4152')).toBe('');
    expect(suburbOnly('24 Wynnum Rd')).toBe('');
    expect(suburbOnly(' ')).toBe('');
  });
  it('normal Places address', () => expect(suburbOnly('8 Smith St, Carina QLD 4152, Australia')).toBe('Carina'));
  it('state is case-sensitive: lower-case state is unsure', () => expect(suburbOnly('8 Smith St, carina qld 4152')).toBe(''));
  it('multi-word suburb', () => expect(suburbOnly('8 Smith St, Mount Gravatt East QLD 4122, Australia')).toBe('Mount Gravatt East'));
  it('a part with a street word is rejected', () => expect(suburbOnly('Wynnum Rd QLD 4178')).toBe(''));
  // T11: the Places autocomplete text the app stores has no postcode (repo fixture
  // routing.google-requests.test.ts: '24 Wynnum Rd, Carina QLD, Australia').
  it.each([
    ['24 Wynnum Rd, Carina QLD, Australia', 'Carina'],
    ['3/24 Wynnum Rd, Carina QLD, Australia', 'Carina'],
    ['Wynnum Rd, Carina QLD, Australia', 'Carina'],
    ['Unit 3, 24 Wynnum Rd, Carina QLD, Australia', 'Carina'],
    ['8 Smith St, Mount Gravatt East QLD, Australia', 'Mount Gravatt East'],
    ['12 Hawken Dr, St Lucia QLD 4067, Australia', 'St Lucia'],
    ['12 Hawken Dr, St Lucia QLD, Australia', 'St Lucia'],
    ['5 Caxton St, Petrie Terrace QLD, Australia', 'Petrie Terrace'],
    ['5 Caxton St, Petrie Terrace QLD 4000, Australia', 'Petrie Terrace'],
  ])('no-postcode and street-word suburbs: %s -> %s', (addr, want) => expect(suburbOnly(addr)).toBe(want));
  it.each([
    '24 Wynnum Rd Carina QLD',
    'Wynnum Rd QLD',
    'Shop 2, Wynnum Rd QLD 4178, Australia',
    'Lot 4 QLD, Australia',
    '24 QLD, Australia',
    'St Kilda Rd QLD, Australia',
    'Australia',
  ])('never a number or a street: %s -> ""', (addr) => expect(suburbOnly(addr)).toBe(''));
});

describe('tidyName (I10)', () => {
  it.each([
    ['john', 'John'], ['SMITH', 'Smith'], ["o'brien", "O'Brien"], ['O’NEIL', 'O’Neil'], ['mary-jane', 'Mary-Jane'],
    ['mcdonald', 'McDonald'], ['MCKENZIE', 'McKenzie'], ['zoë', 'Zoë'], ['DeShawn', 'DeShawn'], ['  ann   lee ', 'Ann Lee'],
  ])('%s -> %s', (input, out) => expect(tidyName(input)).toBe(out));
});

describe('trip dates (BUS-1)', () => {
  it('localDay: before 06:00 is the previous day', () => {
    expect(localDay('2026-10-10T00:40')).toBe('2026-10-09');
    expect(localDay('2026-10-14T19:00')).toBe('2026-10-14');
  });
  it('isServiceDay: Friday=5', () => {
    expect(isServiceDay('2026-10-09', 5)).toBe(true);
    expect(isServiceDay('2026-10-14', 5)).toBe(false);
  });
  it('addDays crosses months', () => { expect(addDays('2026-10-30', 3)).toBe('2026-11-02'); });
});
