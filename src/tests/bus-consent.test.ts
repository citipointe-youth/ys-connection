// Bus consent via the Elvanto form (spec 2026-10-22 §5.2-5.4): year rule, matching, ingest, purge, view, address hint.
import { describe, it, expect } from 'vitest';
import { yearOf, matchOwner, consentView, sameAddress, ingestBusConsentForms } from '../services/bus-consent';
import { InMemoryBusRepository, InMemoryStudentRepository, InMemorySettingsRepository } from '../repositories/in-memory';
import { MINISTRY_CONFIG_DEFAULTS, mergeMinistryConfig } from '../core/ministry-config';
import { student } from './helpers/bus-setup';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const fixture = () => JSON.parse(readFileSync(join(__dirname, 'fixtures', 'elvanto-link', 'push-bus-consent-forms.json'), 'utf8'));
async function deps() {
  const bus = new InMemoryBusRepository(), students = new InMemoryStudentRepository(), settings = new InMemorySettingsRepository();
  await Promise.all([bus.init(), students.init(), settings.init()]);
  await settings.updateSettings({ ministryConfig: mergeMinistryConfig(MINISTRY_CONFIG_DEFAULTS, { modules: { busMinistry: true } }) });
  return { bus, students, settings };
}

describe('year rule (R4): calendar year of the submission in the site zone', () => {
  it('31 Dec 23:30 Brisbane is that year; 1 Jan 00:10 Brisbane is the next', () => {
    expect(yearOf('2026-12-31T13:30:00.000Z', 'Australia/Brisbane')).toBe(2026);
    expect(yearOf('2026-12-31T14:10:00.000Z', 'Australia/Brisbane')).toBe(2027);
  });
});

describe('matching (R5)', () => {
  const S = [{ id: 's1', firstName: 'Jamie', lastName: 'Sample' }, { id: 's2', firstName: 'Casey', lastName: 'Test' }, { id: 's3', firstName: 'Casey', lastName: 'Test' }];
  const G = [{ id: 'g1', firstName: 'Morgan', lastName: 'Walkin', linkedStudentId: null }, { id: 'g2', firstName: 'Jamie', lastName: 'Sample', linkedStudentId: 's1' }];
  it('exactly one (folded: case, accents, spaces) attaches; a linked guest is the student, not a second hit', () => {
    expect(matchOwner(' JAMIE ', 'sample', S, G)).toEqual({ studentId: 's1', guestId: null });
  });
  it('a bus guest matches', () => expect(matchOwner('Morgan', 'Walkin', S, G)).toEqual({ studentId: null, guestId: 'g1' }));
  it('none and ambiguous stay unattached', () => {
    expect(matchOwner('Nobody', 'Here', S, G)).toBeNull();
    expect(matchOwner('Casey', 'Test', S, G)).toBeNull();
  });
});

describe('ingest', () => {
  it('a 2-child submission: one matches, one stays unmatched; a re-push adds nothing; a rename re-matches next push', async () => {
    const d = await deps();
    await d.students.save(student('s1', 'Jamie', 'Sample', 8, 'female'));
    const r1 = await ingestBusConsentForms(d, fixture(), new Date('2026-10-23T04:00:30Z'));
    expect(r1).toEqual({ applied: true, rows: 2, new: 2, unmatched: 1 });
    expect(await ingestBusConsentForms(d, fixture(), new Date('2026-10-23T04:05:00Z'))).toEqual({ applied: true, rows: 2, new: 0, unmatched: 1 });
    await d.students.save(student('s2', 'Riley', 'Sample', 10, 'male'));
    const r3 = await ingestBusConsentForms(d, { ...fixture(), rows: [] }, new Date('2026-10-23T05:00:00Z'));
    expect(r3.unmatched).toBe(0);
    const forms = await d.bus.listConsentForms();
    expect(forms.map((f) => f.studentId).sort()).toEqual(['s1', 's2']);
    const cfg = (await d.settings.getSettings()).ministryConfig.busMinistry;
    expect([cfg.consentLastChecked, cfg.consentLastNew]).toEqual([fixture().checkedAt, 0]);
  });
  it('purge keeps last year and this year only', async () => {
    const d = await deps();
    const old = fixture(); old.rows = [{ ...old.rows[0], submissionId: 'b5c10000-0000-4000-8000-0000000000aa', submittedAt: '2024-06-01T00:00:00.000Z' }];
    await ingestBusConsentForms(d, old, new Date('2024-06-02T00:00:00Z'));
    expect(await d.bus.listConsentForms()).toHaveLength(1);
    await ingestBusConsentForms(d, fixture(), new Date('2026-10-23T04:00:30Z'));
    const forms = await d.bus.listConsentForms();
    expect(forms).toHaveLength(2); // F15: the 2024 row is gone, both 2026 rows stay
    expect(forms.every((f) => f.year >= 2025)).toBe(true);
  });
  it('a form paired with an in-app submit (same name, within 15 min before) is source app, filed by that leader', async () => {
    const d = await deps();
    await d.bus.insertConsentSubmit({ id: 'x1', studentId: null, guestId: null, leaderId: null, leaderName: 'Pat Leader',
      submittedAt: '2026-10-21T09:10:00.000Z', readOutConfirmed: true, elvantoResult: 'sent', first: 'Jamie', last: 'Sample' });
    await ingestBusConsentForms(d, fixture(), new Date('2026-10-23T04:00:30Z'));
    const f = (await d.bus.listConsentForms()).find((x) => x.childIndex === 0)!;
    expect([f.source, f.data.filedBy]).toEqual(['app', 'Pat Leader']);
    expect((await d.bus.listConsentForms()).find((x) => x.childIndex === 1)!.source).toBe('public');
  });
});

describe('view and address', () => {
  const f = (year: number, at: string, studentId = 's1') => ({ id: `f${year}`, submissionId: 'x', childIndex: 0, submittedAt: at, year, studentId, guestId: null,
    first: 'Jamie', last: 'Sample', source: 'public' as const, createdAt: at,
    data: { grade: 8, gender: 'female' as const, mobile: '0400000001', school: 'Example High', address: { line1: '1 Test St', line2: '-', postcode: '4000', city: 'Brisbane City', state: 'QLD' },
      parentName: 'Alex Sample', parentPhone: '0400000003', pickup: true, pickupBy: '', filedBy: null } });
  it('only last year: not current; current year: details for a full view only', () => {
    expect(consentView([f(2025, '2025-12-20T00:00:00.000Z')], { studentId: 's1', guestId: null }, 2026, true)).toEqual({ year: 2026, current: false });
    const v = consentView([f(2026, '2026-02-01T00:00:00.000Z')], { studentId: 's1', guestId: null }, 2026, true);
    expect(v).toMatchObject({ year: 2026, current: true, details: { parentName: 'Alex Sample', school: 'Example High', pickup: true } });
    expect(consentView([f(2026, '2026-02-01T00:00:00.000Z')], { studentId: 's1', guestId: null }, 2026, false)).toEqual({ year: 2026, current: true });
  });
  it('sameAddress ignores case, spacing, state, postcode and Australia', () => {
    const a = { line1: '1 Test St', line2: '-', postcode: '4000', city: 'Brisbane City', state: 'QLD' };
    expect(sameAddress(a, '1  test st, Brisbane City QLD 4000, Australia')).toBe(true);
    expect(sameAddress(a, '9 Other Rd, Carina QLD 4152, Australia')).toBe(false);
  });
});
