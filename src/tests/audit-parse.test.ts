import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { auditColumns, leaderTagRe, parseDateCell, parseDateHeader, parseSource, type AuditParseCtx } from '../services/audit-parse';
import { AUDIT_FORM_HEADERS, AuditPush } from '../core/link-contract';

const CTX: AuditParseCtx = { exportedAt: '2026-10-16T11:03:20.000Z', timeZone: 'Australia/Brisbane', dateOrder: 'DMY',
  leaderTag: leaderTagRe('leader'), gradeRange: { min: 7, max: 12 } };
const ok = (r: ReturnType<typeof parseSource>) => { if (r.shape) throw new Error('shape: ' + r.missing); return r; };
const fx = (f: string) => AuditPush.parse(JSON.parse(readFileSync(join(__dirname, 'fixtures', 'elvanto-link', f), 'utf8')));
const S1 = 'Brisbane - Youth Society - Fri 09/10 6:50 PM', S2 = 'Brisbane - Youth Society - Fri 16/10 6:50 PM';

describe('audit-parse: the rev-16 fixtures', () => {
  it('every ok fixture parses with no shape error, to the expected rows', () => {
    const tables = Object.fromEntries((['service', 'group', 'team', 'connect', 'decision'] as const).map((s) => {
      const b = fx(`push-audit-${s}.json`);
      if (b.status !== 'ok') throw new Error(s);
      return [s, ok(parseSource(s, { headers: b.headers, rows: b.rows }, { ...CTX, exportedAt: b.exportedAt }))];
    }));
    expect(tables.service!.rows.map((r) => [r.person.first, r.person.grade, r.dates])).toEqual([
      ['Alex', 9, ['2026-10-09', '2026-10-16']], ['Jamie', 9, ['2026-10-16']], ['Joanna', 10, ['2026-10-09']]]);
    expect(tables.service!.rows[2]!.person).toMatchObject({ preferred: 'Jo', gender: null });
    expect(tables.group!.rows.map((r) => [r.person.first, r.group, r.dates, r.marked])).toEqual([
      ['Jamie', 'Grade 9 Girls Lifegroup', ['2026-10-05'], ['2026-10-05', '2026-10-12']],
      ['Alex', 'Grade 9 Boys Lifegroup', ['2026-10-12'], ['2026-10-12']]]);
    expect(tables.team!.rows[0]).toMatchObject({ person: { first: 'Sam', grade: 11 }, dates: ['2026-10-11'] });
    expect(tables.connect!.rows[0]).toMatchObject({ person: { first: 'Riley', grade: 8, gender: 'female', phone: null }, submitted: '2026-10-14' });
    expect(tables.decision!.rows[0]).toMatchObject({ person: { first: 'Casey', grade: 10, gender: 'male', phone: null }, submitted: '2026-10-16' });
    for (const t of Object.values(tables)) expect(t.skipped).toEqual([]);
  });
});

describe('audit-parse: columns and values (spec §5.2)', () => {
  it('a missing Gender column keeps every row, gender null, one no-gender-column note', () => {
    const r = ok(parseSource('service', { headers: ['First Name', 'Last Name', S2], rows: [['Alex', 'Sample', 'Y'], ['Jamie', 'Test', 'Y']] }, CTX));
    expect(r.rows.map((x) => x.person.gender)).toEqual([null, null]);
    expect(r.notes).toEqual([{ note: 'no-gender-column', count: 2 }]);
  });
  it('grade: the first integer of the text ("Year 9", "Gr 9", "9"); out of range is null, kept, and noted', () => {
    const r = ok(parseSource('service', { headers: ['First Name', 'Last Name', 'Gender', 'Grade', S2],
      rows: [['A', 'Sample', 'M', 'Year 9', 'Y'], ['B', 'Sample', 'M', 'Gr 9', 'Y'], ['C', 'Sample', 'M', '9', 'Y'], ['D', 'Sample', 'M', '13', 'Y'], ['E', 'Sample', 'M', '', 'Y']] }, CTX));
    expect(r.rows.map((x) => x.person.grade)).toEqual([9, 9, 9, null, null]);
    expect(r.notes).toEqual([{ note: 'grade-out-of-range', count: 1 }]);
  });
  it('gradeRange decides grade 6: kept when the range starts at 6, else null + note', () => {
    const t = { headers: ['First Name', 'Last Name', 'Gender', 'Grade', S2], rows: [['Bo', 'Sample', 'M', '6', 'Y']] };
    expect(ok(parseSource('service', t, { ...CTX, gradeRange: { min: 6, max: 12 } })).rows[0]!.person.grade).toBe(6);
    const r = ok(parseSource('service', t, CTX));
    expect(r.rows[0]!.person.grade).toBeNull();
    expect(r.notes).toEqual([{ note: 'grade-out-of-range', count: 1 }]);
  });
  it('gender words', () => {
    const r = ok(parseSource('service', { headers: ['First Name', 'Last Name', 'Gender', S2],
      rows: ['F', 'female', 'Girl', 'M', 'Male', 'boy', 'X', ''].map((g, i) => [`P${i}`, 'Sample', g, 'Y']) }, CTX));
    expect(r.rows.map((x) => x.person.gender)).toEqual(['female', 'female', 'female', 'male', 'male', 'male', null, null]);
  });
  it('phone: digits only, 6-15; Mobile first, else Youth Parent Phone with the parent flag', () => {
    const r = ok(parseSource('service', { headers: ['First Name', 'Last Name', 'Mobile', 'Youth Parent Phone', S2],
      rows: [['A', 'Sample', '0400 000 001', '0400000009', 'Y'], ['B', 'Sample', '', '(07) 3000 0000', 'Y'], ['C', 'Sample', '12345', '', 'Y']] }, CTX));
    expect(r.rows.map((x) => [x.person.phone, x.person.phoneIsParent])).toEqual([['0400000001', false], ['0730000000', true], [null, false]]);
  });
  it('attended = Y / yes / true / 1 (any case); other marks are not attendance', () => {
    const r = ok(parseSource('service', { headers: ['First Name', 'Last Name', '2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23'],
      rows: [['Alex', 'Sample', 'y', 'TRUE', '1', 'N']] }, CTX));
    expect(r.rows[0]!.dates).toEqual(['2026-10-02', '2026-10-09', '2026-10-16']);
  });
  it('encoding residue: a BOM on the first header, a stray \\r in a cell and trailing empty columns change nothing', () => {
    const r = ok(parseSource('service', { headers: ['﻿First Name', 'Last Name ', S2, '', ''], rows: [['Alex', 'Sample', 'Y\r', '', '']] }, CTX));
    expect(r.rows).toEqual([{ person: { first: 'Alex', last: 'Sample', preferred: null, gender: null, grade: null, phone: null, phoneIsParent: false }, dates: ['2026-10-16'] }]);
    expect(r.notes).toEqual([{ note: 'no-gender-column', count: 1 }]); // the empty headers are not a bad-date-column
  });
  it('names: an empty first or last name is skipped as no-name (never silently lost)', () => {
    const r = ok(parseSource('service', { headers: ['First Name', 'Last Name', S2], rows: [['Alex', '', 'Y'], ['', '', 'Y'], ['Jamie', 'Test', 'Y']] }, CTX));
    expect(r.rows).toHaveLength(1);
    expect(r.skipped).toEqual([{ reason: 'no-name', name: 'Alex' }, { reason: 'no-name', name: null }]);
  });
});

describe('audit-parse: dates (closed set, spec §5.2)', () => {
  it('DD/MM session headers take the year of exportedAt (site time), minus 1 when more than 1 day after it', () => {
    const jan = { ...CTX, exportedAt: '2026-01-05T09:00:00.000Z' }; // Mon 5 Jan 19:00 Brisbane
    expect(parseDateHeader('Brisbane - Youth Society - Fri 19/12 6:50 PM', jan)).toBe('2025-12-19'); // December in a January export
    expect(parseDateHeader('Tue 06/01', jan)).toBe('2026-01-06'); // exactly 1 day after: this year
    expect(parseDateHeader('Wed 07/01', jan)).toBe('2025-01-07'); // 2 days after: last year
    // 1 Jan 01:00 in Brisbane is still 31 Dec in UTC: the site date decides
    expect(parseDateHeader('Fri 02/01', { ...CTX, exportedAt: '2025-12-31T15:00:00.000Z' })).toBe('2026-01-02');
    const r = ok(parseSource('service', { headers: ['First Name', 'Last Name', 'Fri 19/12 6:50 PM', 'Fri 02/01 6:50 PM'], rows: [['Alex', 'Sample', 'Y', 'Y']] }, jan));
    expect(r.rows[0]!.dates).toEqual(['2025-12-19', '2026-01-02']);
  });
  it('MDY config is honoured for D/M/YYYY, DD/MM headers and form cells', () => {
    const mdy = { ...CTX, dateOrder: 'MDY' as const };
    expect(parseDateHeader('12/19/2025', mdy)).toBe('2025-12-19');
    expect(parseDateHeader('Fri 10/16 6:50 PM', mdy)).toBe('2026-10-16');
    expect(parseDateCell('10/14/2026', 'MDY')).toBe('2026-10-14');
    expect(parseDateHeader('12/19/2025', CTX)).toBeNull(); // DMY: month 19
    const r = ok(parseSource('service', { headers: ['First Name', 'Last Name', 'Gender', S2, '12/19/2025'], rows: [['Alex', 'Sample', 'M', 'Y', 'Y']] }, CTX));
    expect(r.notes).toEqual([{ note: 'bad-date-column', count: 1 }]);
    expect(r.rows[0]!.dates).toEqual(['2026-10-16']);
  });
  it('ISO (xlsx) headers and cells, with or without a time', () => {
    expect(parseDateHeader('2026-10-16', CTX)).toBe('2026-10-16');
    expect(parseDateCell('2026-10-14', 'DMY')).toBe('2026-10-14');
    expect(parseDateCell('2026-10-14T00:00:00', 'DMY')).toBe('2026-10-14');
    expect(parseDateCell('16/10/2026 7:15 PM', 'DMY')).toBe('2026-10-16');
    expect(parseDateCell('16 Oct 2026', 'DMY')).toBeNull(); // not in the closed set
  });
  it('a trailing time after a form date is ignored; the date part still follows the closed rules (spec delta 36)', () => {
    expect(parseDateCell('22/10/2026 7:43 PM', 'DMY')).toBe('2026-10-22');
    expect(parseDateCell('2026-10-22 19:43', 'DMY')).toBe('2026-10-22');
    expect(parseDateCell('2026-10-22T19:43:00', 'DMY')).toBe('2026-10-22');
    expect(parseDateCell('10/22/2026 7:43 PM', 'MDY')).toBe('2026-10-22');
    expect(parseDateCell('22/10/2026 7:43 PM', 'MDY')).toBeNull(); // month 22: the time never rescues a bad date
    expect(parseDateCell('22 Oct 2026 7:43 PM', 'DMY')).toBeNull();
    const r = ok(parseSource('decision', { headers: ['Date Submitted', 'First Name', 'Last Name'], rows: [['22/10/2026 7:43 PM', 'Casey', 'Example']] }, CTX));
    expect(r.rows[0]!.submitted).toBe('2026-10-22');
  });
  it('a form row with an unreadable submission date is skipped as bad-date, with the name', () => {
    const r = ok(parseSource('connect', { headers: ['First Name', 'Last Name', 'Date Submitted'], rows: [['Riley', 'Sample', 'yesterday'], ['Jo', 'Sample', '14/10/2026']] }, CTX));
    expect(r.rows.map((x) => x.submitted)).toEqual(['2026-10-14']);
    expect(r.skipped).toEqual([{ reason: 'bad-date', name: 'Riley Sample' }]);
  });
});

describe('audit-parse: groups', () => {
  const G = ['', '05/10/2026', '12/10/2026'];
  it('group header rows, then "Last, First" member rows; an all "-" member is not a member', () => {
    const r = ok(parseSource('group', { headers: G, rows: [['Grade 9 Girls Lifegroup', '', ''], ['Test, Jamie', 'Y', 'N'],
      ['Sample, Jo', '-', '-'], ['Jamie Test', '', 'Y']] }, CTX));
    expect(r.rows.map((x) => [x.person.first, x.person.last, x.group, x.dates, x.marked])).toEqual([
      ['Jamie', 'Test', 'Grade 9 Girls Lifegroup', ['2026-10-05'], ['2026-10-05', '2026-10-12']],
      ['Jamie', 'Test', 'Grade 9 Girls Lifegroup', ['2026-10-12'], ['2026-10-12']]]);
  });
  it('import.leaderTag from config: "(Coach)" is excluded when the tag is coach, kept under the default', () => {
    const t = { headers: G, rows: [['Grade 9 Girls Lifegroup', '', ''], ['Sample, Mia (Coach)', 'Y', 'Y'], ['Sample, Ava (Assistant Coach)', 'Y', ''], ['Test, Jamie', 'Y', '']] };
    expect(ok(parseSource('group', t, { ...CTX, leaderTag: leaderTagRe('coach') })).rows.map((x) => x.person.first)).toEqual(['Jamie']);
    expect(ok(parseSource('group', t, CTX)).rows).toHaveLength(3);
    const lead = { headers: G, rows: [['Grade 9 Girls Lifegroup', '', ''], ['Sample, Mia (Leader)', 'Y', 'Y']] };
    expect(ok(parseSource('group', lead, CTX)).rows).toEqual([]);           // excluded, and not reported as skipped
    expect(ok(parseSource('group', lead, CTX)).skipped).toEqual([]);
    expect(ok(parseSource('group', lead, { ...CTX, leaderTag: null })).rows).toHaveLength(1);
  });
});

describe('audit-parse: form allowlist headers', () => {
  it('every AUDIT_FORM_HEADERS entry maps to exactly one field', () => {
    for (const h of AUDIT_FORM_HEADERS) expect(Object.keys(auditColumns([h])), h).toHaveLength(1);
  });
  it('the Elvanto spellings map to the same fields', () => {
    const a = ok(parseSource('decision', { headers: ['First Name', 'Last Name', 'Preferred Name', 'Date Submitted', 'Grade', 'Gender'],
      rows: [['Joanna', 'Sample', 'Jo', '14/10/2026', 'Year 9', 'Female']] }, CTX));
    const b = ok(parseSource('decision', { headers: ['first  name', 'LAST NAME', 'Submitted', 'School Grade'],
      rows: [['Joanna', 'Sample', '14/10/2026', '9']] }, CTX));
    const c = ok(parseSource('connect', { headers: ['First Name', 'Last Name', 'Submitted', 'Year'], rows: [['Joanna', 'Sample', '14/10/2026', '9']] }, CTX));
    expect(a.rows[0]).toEqual({ person: { first: 'Joanna', last: 'Sample', preferred: 'Jo', gender: 'female', grade: 9, phone: null, phoneIsParent: false }, dates: [], submitted: '2026-10-14' });
    expect(b.rows[0]!.person).toMatchObject({ first: 'Joanna', grade: 9, phone: null });
    expect(c.rows[0]!.person.grade).toBe(9);
  });
  it('the real Decision form headers (Brisbane - Youth - Decision Form, operator sample 2026-10-22) -> grade 10, male, the submitted day', () => {
    const r = ok(parseSource('decision', { headers: ['Date Submitted', 'First Name', 'Gender', 'Last Name', 'What grade are you in?'],
      rows: [['16/10/2026', 'Casey', 'Male', 'Example', '10']] }, CTX));
    expect(r.rows).toEqual([{ person: { first: 'Casey', last: 'Example', preferred: null, gender: 'male', grade: 10, phone: null, phoneIsParent: false }, dates: [], submitted: '2026-10-16' }]);
    expect(r.notes).toEqual([]);
    // any header starting "what grade" is the grade (case-insensitive, spaces collapsed)
    expect(auditColumns(['WHAT  GRADE are you in?', 'What grade will you be in 2027?'])).toEqual({ grade: 0 });
  });
  it('the decision-date free text is never read as the submitted date: only Date Submitted / Submitted count', () => {
    const Q = "When did you make a decision to follow Jesus? (Hint: it's today's date)";
    const r = ok(parseSource('decision', { headers: [Q, 'Date Submitted', 'First Name', 'Last Name'], rows: [['01/01/2026', '16/10/2026', 'Casey', 'Example']] }, CTX));
    expect(r.rows[0]!.submitted).toBe('2026-10-16');
    expect(auditColumns([Q])).toEqual({});
    expect(parseSource('decision', { headers: [Q, 'First Name', 'Last Name'], rows: [] }, CTX)).toEqual({ shape: true, missing: 'Date Submitted' });
  });
});

describe('audit-parse: a required column missing -> shape', () => {
  it('service/team: First Name, Last Name, and at least one date column', () => {
    expect(parseSource('service', { headers: ['First Name', S2], rows: [] }, CTX)).toEqual({ shape: true, missing: 'Last Name' });
    expect(parseSource('team', { headers: ['Last Name', S2], rows: [] }, CTX)).toEqual({ shape: true, missing: 'First Name' });
    expect(parseSource('service', { headers: ['First Name', 'Last Name', 'Gender'], rows: [] }, CTX)).toEqual({ shape: true, missing: 'a session date column' });
  });
  it('group: a date column, a group header row and member rows', () => {
    expect(parseSource('group', { headers: ['', 'Notes'], rows: [['Grade 9 Girls Lifegroup', '']] }, CTX)).toEqual({ shape: true, missing: 'a meeting date column' });
    expect(parseSource('group', { headers: ['', '05/10/2026'], rows: [['Test, Jamie', 'Y']] }, CTX)).toEqual({ shape: true, missing: 'a group header row' });
    expect(parseSource('group', { headers: ['', '05/10/2026'], rows: [['Grade 9 Girls Lifegroup', '']] }, CTX)).toEqual({ shape: true, missing: 'member rows' });
  });
  it('connect/decision: First Name, Last Name and a submission date', () => {
    expect(parseSource('connect', { headers: ['First Name', 'Last Name', 'Gender'], rows: [] }, CTX)).toEqual({ shape: true, missing: 'Date Submitted' });
    expect(parseSource('decision', { headers: ['First Name', 'Submitted'], rows: [] }, CTX)).toEqual({ shape: true, missing: 'Last Name' });
  });
});
