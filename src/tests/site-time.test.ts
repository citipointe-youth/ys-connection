import { describe, it, expect } from 'vitest';
import {
  brisbaneToday, serviceDay, brisbaneHHMM, instantOf, consentFriday, consentFridayPassed, weekdayOf,
} from '../services/link-rules';
import { MINISTRY_CONFIG_DEFAULTS, mergeMinistryConfig } from '../core/ministry-config';

// Y3a: the location's time zone, youth night and consent cut-off. Same samples and DST cases as console C4a (Z1-Z5).
const BNE = 'Australia/Brisbane', SYD = 'Australia/Sydney';
// The old fixed +10 code, verbatim.
const old = {
  today: (now: Date) => new Date(now.getTime() + 10 * 3_600_000).toISOString().slice(0, 10),
  serviceDay: (now: Date) => old.today(new Date(now.getTime() - 3 * 3_600_000)),
  hhmm: (iso: string) => new Date(Date.parse(iso) + 10 * 3_600_000).toISOString().slice(11, 16),
  passed: (friday: string, now: Date) => now.getTime() >= Date.parse(`${friday}T09:00:00+10:00`),
};

describe('Y3a site time', () => {
  it('Z1 a year of Brisbane samples equals the old +10 code (03:00 roll-back kept)', () => {
    let bad = 0;
    for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 3 * 3600e3 + 17 * 60e3) {
      const d = new Date(t), iso = d.toISOString();
      if (brisbaneToday(d, BNE) !== old.today(d) || serviceDay(d, BNE) !== old.serviceDay(d) || brisbaneHHMM(iso, BNE) !== old.hhmm(iso)) bad++;
    }
    expect(bad).toBe(0);
  });

  it('Z2-Z5 instantOf: Brisbane, the Sydney gap and repeat, Sydney summer', () => {
    expect(instantOf('2026-10-23', '09:00', BNE)).toBe(Date.parse('2026-10-23T09:00:00+10:00'));
    expect(instantOf('2026-10-04', '02:30', SYD)).toBe(Date.parse('2026-10-04T03:30:00+11:00')); // gap: the instant after it
    expect(instantOf('2026-04-05', '02:30', SYD)).toBe(Date.parse('2026-04-05T02:30:00+11:00')); // repeat: the first one
    expect(instantOf('2026-12-04', '09:00', SYD)).toBe(Date.parse('2026-12-04T09:00:00+11:00'));
    expect(instantOf('2026-06-05', '09:00', SYD)).toBe(Date.parse('2026-06-05T09:00:00+10:00'));
  });

  it('Sydney local day, time and service day follow daylight saving', () => {
    expect(brisbaneHHMM('2026-12-04T08:30:00Z', SYD)).toBe('19:30');
    expect(brisbaneHHMM('2026-06-05T08:30:00Z', SYD)).toBe('18:30');
    expect(brisbaneToday(new Date('2026-12-04T13:30:00Z'), SYD)).toBe('2026-12-05'); // 00:30 +11
    expect(serviceDay(new Date('2026-12-04T15:59:00Z'), SYD)).toBe('2026-12-04'); // Sat 02:59 +11
    expect(serviceDay(new Date('2026-12-04T16:00:00Z'), SYD)).toBe('2026-12-05'); // Sat 03:00 +11
    expect(serviceDay(new Date('2026-10-03T16:30:00Z'), SYD)).toBe('2026-10-04'); // DST start: 03:30 +11, local rule
  });

  it('consentFriday follows serviceDayOfWeek: 6 gives a Saturday, 5 the old Friday', () => {
    for (const d of ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']) {
      const sat = consentFriday(d, undefined, 6)!;
      expect(weekdayOf(sat)).toBe(6);
      expect(sat > d).toBe(true);
    }
    expect(consentFriday('2026-10-17', undefined, 6)).toBe('2026-10-24'); // a Saturday -> the next one
    expect(consentFriday('2026-10-16', undefined, 5)).toBe('2026-10-23');
    expect(consentFriday('2026-10-15', undefined, 5)).toBe('2026-10-16');
  });

  it('consentFridayPassed with the Brisbane defaults equals the old 9:00 +10:00 rule', () => {
    const { consentCutoff, timeZone } = MINISTRY_CONFIG_DEFAULTS.structure;
    expect([consentCutoff, timeZone]).toEqual(['09:00', BNE]);
    let bad = 0;
    for (let t = Date.UTC(2026, 9, 22, 20); t < Date.UTC(2026, 9, 23, 2); t += 60e3) {
      if (consentFridayPassed('2026-10-23', new Date(t), consentCutoff, timeZone) !== old.passed('2026-10-23', new Date(t))) bad++;
    }
    expect(bad).toBe(0);
    // Sydney summer: the cut-off is 9:00 +11:00
    expect(consentFridayPassed('2026-12-04', new Date('2026-12-03T21:59:00Z'), '09:00', SYD)).toBe(false);
    expect(consentFridayPassed('2026-12-04', new Date('2026-12-03T22:00:00Z'), '09:00', SYD)).toBe(true);
    // A Sunday night whose cut-off falls in the DST gap (02:30 Sun 4 Oct 2026 Sydney): it closes at 03:30 +11, on that night
    const sun = consentFriday('2026-09-30', undefined, 0)!;
    expect(sun).toBe('2026-10-04');
    expect(consentFridayPassed(sun, new Date('2026-10-03T16:29:00Z'), '02:30', SYD)).toBe(false);
    expect(consentFridayPassed(sun, new Date('2026-10-03T16:30:00Z'), '02:30', SYD)).toBe(true);
  });

  it('PATCH refuses an unknown time zone in plain words', () => {
    expect(() => mergeMinistryConfig(MINISTRY_CONFIG_DEFAULTS, { structure: { timeZone: 'Mars/Base' } }))
      .toThrow(expect.objectContaining({ statusCode: 400, message: 'Time zone not recognised.' }));
    expect(mergeMinistryConfig(MINISTRY_CONFIG_DEFAULTS, { structure: { timeZone: SYD, consentCutoff: '08:30' } }).structure)
      .toMatchObject({ timeZone: SYD, consentCutoff: '08:30', serviceDayOfWeek: 5 });
    const CUTOFF = 'Consent closes at must be a 24-hour time such as 09:00 (Youth Setup).';
    for (const bad of ['9am', '99:99', '24:00', '25:00', '23:60']) {
      expect(() => mergeMinistryConfig(MINISTRY_CONFIG_DEFAULTS, { structure: { consentCutoff: bad } }))
        .toThrow(expect.objectContaining({ statusCode: 400, message: CUTOFF }));
    }
    expect(mergeMinistryConfig(MINISTRY_CONFIG_DEFAULTS, { structure: { consentCutoff: '23:59' } }).structure.consentCutoff).toBe('23:59');
  });
});
