import { describe, it, expect } from 'vitest';
import { MinistryConfigSchema, MINISTRY_CONFIG_DEFAULTS, mergeMinistryConfig } from '../core/ministry-config';
import { ELVANTO_0040_SQL as sql, brisbaneElvanto, brisbaneElvantoJson } from './helpers/brisbane-elvanto';
import { loadIndexHtml } from './helpers/extract-fn';
import { studentBody, parentBody, elvantoReady, formUrl, LABELS } from '../services/elvanto-forms';
import golden from './fixtures/elvanto-bodies-brisbane.json';

// The ids the old elvanto-forms.ts constants held (deleted in Y1b), kept here so the per-id check survives.
const GRADES: Record<string, string> = {
  '6': '807c9c80-3825-11e1-9229-ea942707ad51', '7': '807cac70-3825-11e1-9229-ea942707ad51',
  '8': '807cbbb6-3825-11e1-9229-ea942707ad51', '9': '807ccf48-3825-11e1-9229-ea942707ad51',
  '10': '807ce56e-3825-11e1-9229-ea942707ad51', '11': '807cfbf8-3825-11e1-9229-ea942707ad51',
  '12': '807d108e-3825-11e1-9229-ea942707ad51',
};
const ALLERGIES: Record<string, string> = {
  'Anaphylaxis': '5603d8b4-3736-11e1-9229-ea942707ad51', 'Asthmatic': 'de848312-366b-11e1-9229-ea942707ad51',
  'Dairy Intolerance': '56044380-3736-11e1-9229-ea942707ad51', 'Egg Allergy': 'd6b1eebb-7133-42fe-8615-23aaba311f4b',
  'Gluten Intolerance': 'de8474bc-366b-11e1-9229-ea942707ad51', 'Lactose Intolerance': '6bc1cea5-018b-404d-917a-38b4e3e24a54',
  'Nut Allergy': 'de84578e-366b-11e1-9229-ea942707ad51', 'Penicilin Allergy': 'de84677e-366b-11e1-9229-ea942707ad51',
  'Skin Allergy': '5604e90c-3736-11e1-9229-ea942707ad51', 'Sugar Allergy': 'ee28892c-9bba-4d70-9d40-331f47c73076',
  'Wheat Allergy': 'cd80a9cf-ed3b-4b45-8b96-f625ea618984',
};
const CONDITIONS: Record<string, string> = {
  'ADHD': '9e950f27-cc7e-4d52-8830-f571876478f5', 'Autism/Aspergers': 'b553987f-2a35-4192-b49e-2452741bd477',
  'Diabetes Type 1': '4b1c793c-c907-4acf-83d7-137c261109ff', 'Epilepsy': '37267e16-aaeb-4408-a7d3-f10dfd496555',
};

const parseMinistryConfig = (o: unknown) => MinistryConfigSchema.parse(o);

describe('0040 site elvanto', () => {
  it('the Brisbane JSON has no single quote (it sits inside a SQL string literal)', () => {
    expect(brisbaneElvantoJson()).not.toContain("'");
  });
  it('fills only when users exist and never overwrites', () => {
    expect(sql).toMatch(/where\s+not\s+\(ministry_config\s+\?\s+'elvanto'\)/i);
    expect(sql).toMatch(/and\s+exists\s*\(select 1 from users\)/i);
  });
  it('touches only the global row, and only when it is a jsonb object (a legacy double-encoded string is left alone)', () => {
    expect(sql).toMatch(/and\s+id\s*=\s*'global'/i);
    expect(sql).toMatch(/and\s+jsonb_typeof\(ministry_config\)\s*=\s*'object'/i);
  });
  it('the Brisbane block parses through the schema unchanged', () => {
    const cfg = parseMinistryConfig({ elvanto: brisbaneElvanto() });
    expect(cfg.elvanto).toEqual(brisbaneElvanto());
  });
  it('the Brisbane block holds today\'s values', () => {
    const b = brisbaneElvanto();
    expect(b.baseUrl).toBe('https://citipointe.elvanto.com.au');
    expect(b.location).toBe('Brisbane');
    expect(b.state).toBe('QLD');
    expect(b.checkedAt).toBe('');
    expect(Object.keys(b.fields)).toHaveLength(11);
    expect(Object.keys(b.options)).toHaveLength(29);
    expect(b.options.location).toBe('33bec66a-20bb-11e1-9229-ea942707ad51');
    expect(b.options.locBrisbane).toBeUndefined();
    for (const [g, id] of Object.entries(GRADES)) expect(b.options[`grade${g}`]).toBe(id);
    for (const [l, id] of Object.entries(ALLERGIES)) expect(b.options[`allergy:${l}`]).toBe(id);
    for (const [l, id] of Object.entries(CONDITIONS)) expect(b.options[`condition:${l}`]).toBe(id);
  });
  it('defaults are blank', () => {
    const e = parseMinistryConfig({}).elvanto;
    expect(e).toEqual({ baseUrl: '', studentFormId: '', parentFormId: '', location: '', peopleFlowPrefix: '', consentFlowPrefix: '', state: '', fields: {}, options: {}, checkedAt: '' });
  });
  it.each(['http://x.elvanto.com.au', 'https://evil.com', 'https://a.elvanto.com.au/', 'https://a.elvanto.com.au.evil.com', 'https://169.254.169.254'])('baseUrl %s refused', (u) => {
    expect(() => parseMinistryConfig({ elvanto: { baseUrl: u } })).toThrow();
  });
  it('a form id that is not a uuid is refused', () => {
    expect(() => parseMinistryConfig({ elvanto: { studentFormId: 'abc' } })).toThrow();
  });
  it('golden: bodies built from the 0040 JSON equal the old constants\' bodies', () => {
    const e = brisbaneElvanto();
    expect(golden).toHaveLength(3);
    for (const g of golden as any[]) {
      expect([...studentBody(g.youth, g.honeypot, e).entries()]).toEqual(g.student);
      expect([...parentBody(g.youth, g.honeypot, e).entries()]).toEqual(g.parent);
    }
  });
  it('formUrl on the Brisbane block gives the old form URLs', () => {
    expect(formUrl(brisbaneElvanto(), 'student')).toBe('https://citipointe.elvanto.com.au/form/45803e81-0c8f-4398-9891-3287df77ab91');
    expect(formUrl(brisbaneElvanto(), 'parent')).toBe('https://citipointe.elvanto.com.au/form/f10f6d33-7dc1-440c-aa62-c7e407138ef6');
  });
  it('LABELS keeps the allergy and condition labels, in the form\'s order', () => {
    expect(LABELS.allergies).toEqual(Object.keys(ALLERGIES));
    expect(LABELS.conditions).toEqual(Object.keys(CONDITIONS));
  });
  it('elvantoReady: blank false, Brisbane true, grade6 only with Include Grade 6', () => {
    const B = brisbaneElvanto;
    const cfg = (elvanto: unknown, gradeMin = 7) => mergeMinistryConfig(MINISTRY_CONFIG_DEFAULTS, { elvanto, structure: { gradeMin } });
    expect(elvantoReady(MINISTRY_CONFIG_DEFAULTS)).toBe(false);
    expect(elvantoReady(cfg(B()))).toBe(true);
    expect(elvantoReady(cfg(B(), 6))).toBe(true);
    const { grade6: _g6, ...noG6 } = B().options;
    expect(elvantoReady(cfg({ ...B(), options: noG6 }))).toBe(true); // Include Grade 6 off: not read
    expect(elvantoReady(cfg({ ...B(), options: noG6 }, 6))).toBe(false); // Include Grade 6 on: read
    for (const k of ['baseUrl', 'studentFormId', 'parentFormId']) expect(elvantoReady(cfg({ ...B(), [k]: '' })), k).toBe(false);
    for (const k of Object.keys(B().fields)) expect(elvantoReady(cfg({ ...B(), fields: { ...B().fields, [k]: '' } })), k).toBe(false);
    for (const k of Object.keys(B().options).filter((k) => k !== 'grade6')) {
      const { [k]: _drop, ...options } = B().options;
      expect(elvantoReady(cfg({ ...B(), options })), k).toBe(false);
    }
    // not read by the body builders, so not required
    expect(elvantoReady(cfg({ ...B(), location: '', state: '', peopleFlowPrefix: '', consentFlowPrefix: '' }))).toBe(true);
  });
  it('client mirror has the same blank elvanto defaults', () => {
    const src = loadIndexHtml();
    const i = src.indexOf('const MINISTRY_CONFIG_DEFAULTS_CLIENT = {');
    const block = src.slice(i, src.indexOf('\n};', i) + 3);
    // eslint-disable-next-line no-new-func
    const client = new Function(`${block}\nreturn MINISTRY_CONFIG_DEFAULTS_CLIENT;`)();
    expect(client.elvanto).toEqual(MINISTRY_CONFIG_DEFAULTS.elvanto);
  });
});
