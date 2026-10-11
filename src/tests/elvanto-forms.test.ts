import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as EF from '../services/elvanto-forms';

const studentHtml = readFileSync(join(__dirname, 'fixtures/elvanto-student-form.html'), 'utf8');
const parentHtml = readFileSync(join(__dirname, 'fixtures/elvanto-parent-form.html'), 'utf8');

const SAMPLE: EF.NewYouth = {
  host: 'Sam Host', firstName: 'Alex', lastName: 'Test', dob: '03/04/2012',
  gender: 'f', grade: '8', school: 'Citipointe Christian College', mobile: '0412345678',
  address: { street: '1 Test St', suburb: 'Carindale', state: 'QLD', postcode: '4152' },
  allergies: ['Nut Allergy', 'Asthmatic'], conditions: ['ADHD'], medicalNotes: 'Carries a puffer',
  parentFirst: 'Pat', parentLast: 'Test', parentMobile: '0498765432', parentGender: 'm',
};

describe('toAuMobile', () => {
  it.each([
    ['0412 345 678', '0412345678'], ['+61 412 345 678', '0412345678'], ['61412345678', '0412345678'],
    ['412345678', '0412345678'], ['(04) 1234-5678', '0412345678'], ['+61 0412 345 678', '0412345678'],
  ])('%s → %s', (raw, want) => expect(EF.toAuMobile(raw)).toBe(want));
  it.each(['', '12345', '0298765432', '04123456789', '0061412345678'])('refuses %s', (raw) => expect(EF.toAuMobile(raw)).toBeNull());
});

// Same results as 11.1's capName (youth-plan.js), so 11.1 never offers a capital fix on these forms.
describe('tidyName', () => {
  it.each([
    ['smith', 'Smith'], ['SMITH', 'Smith'], ["o'brien", "O'Brien"], ['o’brien', 'O’Brien'], ['mary-jane', 'Mary-Jane'],
    ['  van   der berg ', 'Van Der Berg'], ['McDonald', 'McDonald'], ['mcDonald', 'McDonald'], ['de Souza', 'De Souza'],
    ['j.d.', 'J.D.'], ['Jo', 'Jo'],
  ])('%s → %s', (raw, want) => expect(EF.tidyName(raw)).toBe(want));
});

describe('isoToDmy', () => {
  const today = new Date('2026-10-11T00:00:00Z');
  it('converts a real date', () => expect(EF.isoToDmy('2012-04-03', today)).toBe('03/04/2012'));
  it.each(['2012-02-30', '12-04-2012', '', '2026-10-01', '1990-01-01'])('refuses %s', (iso) => expect(EF.isoToDmy(iso, today)).toBeNull());
});

describe('bodies match the real forms', () => {
  it('student body: every name and option id exists on the real student form', () => {
    const hp = EF.honeypotName(studentHtml)!;
    expect(hp).toMatch(/^elvanto\d+$/);
    expect(EF.shapeProblems(studentHtml, EF.studentBody(SAMPLE, hp))).toEqual([]);
    expect(EF.shapeProblems(studentHtml, EF.studentBody({ ...SAMPLE, allergies: [], conditions: [] }, hp))).toEqual([]);
  });
  it('parent body: every name and option id exists on the real parent form', () => {
    const hp = EF.honeypotName(parentHtml)!;
    expect(EF.shapeProblems(parentHtml, EF.parentBody(SAMPLE, hp))).toEqual([]);
  });
  it('student body carries the fixed answers, the parent once, and empty honeypots', () => {
    const b = EF.studentBody(SAMPLE, 'elvanto1');
    expect(b.get('submissions[0][people_custom_field][bab736a4-dbe8-4a0c-ae3e-7c2c5799f9a3]')).toBe('Pat Test');
    expect(b.get('submissions[0][people_custom_field][c184c020-76ce-11e5-9d36-06ba798128be]')).toBe('0498765432');
    expect(b.get('submissions[0][forms_custom_field][4c438bd3-d34e-4e21-bfa5-2ceeb60064bc]')).toBe('575602b7-2cfc-41be-a18a-4d37b9a006e4');
    expect(b.get('submissions[0][forms_custom_field][508f3b2c-58c9-4a96-b299-2666c706831b]')).toBe('a6004ba1-0199-4f77-b833-0fd99ab22d1f'); // always "regularly attend"
    expect(b.get('submissions[0][forms_custom_field][739c2f1d-19cb-442a-9d81-aa6b2de6e7a9]')).toBe('8270a2b8-76d3-426c-9ac7-a7ef632e07b0');
    expect(b.get('submissions[0][forms_custom_field][6da70308-7365-46d2-b30c-e91b275c1359]')).toBe('1c0d32b8-ef70-46e5-aa47-af4410c4219b');
    expect(b.get('submissions[0][school_grade]')).toBe('807cbbb6-3825-11e1-9229-ea942707ad51');
    expect(b.getAll('submissions[0][people_custom_field][de842f02-366b-11e1-9229-ea942707ad51][]')).toHaveLength(2);
    expect(b.get('submissions[0][email]')).toBe('');
    expect(b.get('elvanto1')).toBe('');
    expect(b.get('url')).toBe('');
  });
  it('no address: still "regularly attend", address fields posted empty', () => {
    const b = EF.studentBody({ ...SAMPLE, address: undefined }, 'elvanto1');
    expect(b.get('submissions[0][forms_custom_field][508f3b2c-58c9-4a96-b299-2666c706831b]')).toBe('a6004ba1-0199-4f77-b833-0fd99ab22d1f');
    expect(b.get('submissions[0][mailing_address]')).toBe('');
  });
  it('parent body: name, mobile, Adults, Brisbane', () => {
    const b = EF.parentBody(SAMPLE, 'elvanto1');
    expect(b.get('submissions[0][first_name]')).toBe('Pat');
    expect(b.get('submissions[0][mobile_number]')).toBe('0498765432');
    expect(b.get('submissions[0][demographic][]')).toBe('428c637c-090b-11e1-9229-ea942707ad51');
    expect(b.get('submissions[0][location][]')).toBe('33bec66a-20bb-11e1-9229-ea942707ad51');
  });
});

describe('shapeProblems', () => {
  it('names a removed field', () => {
    const hp = EF.honeypotName(studentHtml)!;
    const edited = studentHtml.replace('name="submissions[0][birthday]"', 'name="submissions[0][dob]"');
    expect(EF.shapeProblems(edited, EF.studentBody(SAMPLE, hp))).toContain('submissions[0][birthday]');
  });
  it('names a removed option id', () => {
    const hp = EF.honeypotName(studentHtml)!;
    const edited = studentHtml.replace('value="807cbbb6-3825-11e1-9229-ea942707ad51"', 'value="gone"');
    expect(EF.shapeProblems(edited, EF.studentBody(SAMPLE, hp))).toContain('submissions[0][school_grade]=807cbbb6-3825-11e1-9229-ea942707ad51');
  });
  it('names a field the church added (a new question or a second honeypot)', () => {
    const hp = EF.honeypotName(studentHtml)!;
    const edited = studentHtml.replace('<input type="hidden" name="save" value="1">', '<input type="hidden" name="save" value="1"><input type="text" name="submissions[0][new_question]">');
    expect(EF.shapeProblems(edited, EF.studentBody(SAMPLE, hp))).toContain('new:submissions[0][new_question]');
  });
});

describe('classifyPost', () => {
  const saved = { student: { ...EF.SUCCESS.student }, parent: { ...EF.SUCCESS.parent } };
  afterEach(() => { Object.assign(EF.SUCCESS.student, saved.student); Object.assign(EF.SUCCESS.parent, saved.parent); });
  it('4xx is failed; 5xx is unconfirmed (Elvanto may have saved it before erroring)', () => {
    expect(EF.classifyPost('student', { status: 403, location: null, body: '' })).toBe('failed');
    expect(EF.classifyPost('student', { status: 500, location: null, body: '' })).toBe('unconfirmed');
  });
  it('the form came back (Elvanto refused it) is failed', () => {
    expect(EF.classifyPost('student', { status: 200, location: null, body: studentHtml })).toBe('failed');
  });
  it('the success marker wins, even if the page also holds a form', () => {
    EF.SUCCESS.student.marker = 'Thanks-TEST';
    expect(EF.classifyPost('student', { status: 200, location: null, body: `<p>Thanks-TEST</p>${studentHtml}` })).toBe('sent');
  });
  it('a 3xx is sent only when it matches that form\'s success redirect', () => {
    EF.SUCCESS.student.redirect = /\?success/;
    expect(EF.classifyPost('student', { status: 302, location: '/form/x/?success', body: '' })).toBe('sent');
    expect(EF.classifyPost('student', { status: 302, location: '/login', body: '' })).toBe('unconfirmed');
    expect(EF.classifyPost('parent', { status: 302, location: '/form/x/?success', body: '' })).toBe('sent');
  });
  it('with no success rule, a redirect or a 200 that is not the form is sent', () => {
    expect(EF.classifyPost('student', { status: 200, location: null, body: '<p>hello</p>' })).toBe('sent');
    expect(EF.classifyPost('student', { status: 302, location: '/x', body: '' })).toBe('sent');
  });
});
