import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildContainer, type Services } from '../container';
import { buildRoutes } from '../api/http/router';
import { MinistryConfigSchema, MINISTRY_CONFIG_DEFAULTS, mergeMinistryConfig, gradeRange } from '../core/ministry-config';
import { ELVANTO_0040_SQL as sql, brisbaneElvanto, brisbaneElvantoJson } from './helpers/brisbane-elvanto';
import { loadIndexHtml } from './helpers/extract-fn';
import { studentBody, parentBody, elvantoReady, formUrl, LABELS, readFormFields, checkForms } from '../services/elvanto-forms';
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

// Y1c: Check forms. Tests never call live Elvanto: fetch is stubbed with the two fixtures.
const FIX = (f: string) => readFileSync(join(__dirname, 'fixtures', `elvanto-${f}-form.html`), 'utf8');
const STUDENT = FIX('student'), PARENT = FIX('parent');

describe('readFormFields', () => {
  it('reads each question: label, input name, option labels', () => {
    const f = readFormFields(STUDENT);
    expect(f.find((q) => q.label === 'Name of Host filling out form')).toEqual({
      label: 'Name of Host filling out form', name: brisbaneElvanto().fields.host, options: [] });
    expect(f.find((q) => q.label.startsWith('Are you intending'))!.options).toEqual([
      { label: 'I would like to regularly attend', value: 'a6004ba1-0199-4f77-b833-0fd99ab22d1f' },
      { label: 'I am just visiting', value: '37fd21c5-3862-451e-91a0-24affbe1447b' }]);
    expect(f.find((q) => q.label === 'Medical Conditions')!.options.map((o) => o.label)).toEqual([...LABELS.conditions]);
    expect(f.some((q) => q.name.startsWith('multi_select_filter_'))).toBe(false);
    expect(readFormFields(PARENT).map((q) => q.label)).toContain('Parent First Name');
  });
  it('both fixtures map every key in the Brisbane block', () => {
    const r = checkForms(STUDENT, PARENT, 'Brisbane', [7, 8, 9, 10, 11, 12]);
    expect(r.fields).toEqual(brisbaneElvanto().fields);
    expect(r.options).toEqual(brisbaneElvanto().options);
    expect(r).toMatchObject({ ok: true, n: 39, missing: [], extra: [] });
  });
  it('a location label with regex characters matches literally, and entities decode', () => {
    const html = STUDENT.replace('>Redcliffe</label>', '>St. Mark&#039;s (North)</label>');
    expect(checkForms(html, PARENT, "St. Mark's (North)", [7]).options.location).toBe('6c3e1500-6b5f-11e2-9eb8-3170a1d64e04');
  });
  it('a missing option reads "<question>, option <option>" (one colon only)', () => {
    const r = checkForms(STUDENT, PARENT, 'Nowhere', [7]);
    expect(r.missing).toEqual(['Citipointe Location, option Nowhere']);
    expect(r.lines[0]).toBe('Not found: Citipointe Location, option Nowhere. Make the question match, or type its id.');
  });
  it('missingKeys names the draft key of each missing row, in the same order (the card types an id there)', () => {
    expect(checkForms(STUDENT, PARENT, 'Nowhere', [7]).missingKeys).toEqual(['options.location']);
    expect(checkForms(STUDENT, PARENT, 'Brisbane', [7, 8, 9, 10, 11, 12]).missingKeys).toEqual([]);
  });
});

describe('POST /settings/elvanto-check', () => {
  const B = brisbaneElvanto();
  const DRAFT = { baseUrl: B.baseUrl, studentFormId: B.studentFormId, parentFormId: B.parentFormId, location: 'Brisbane' };
  const act = (role: string) => ({ id: 'a-test', role, displayName: 'T', grade: null, quad: null }) as any;
  let services: Services;
  let fetchStub: ReturnType<typeof vi.fn>;
  const stub = (student: string | number = STUDENT, parent: string | number = PARENT) => {
    fetchStub = vi.fn(async (url: string) => {
      const page = url.endsWith(B.studentFormId) ? student : url.endsWith(B.parentFormId) ? parent : 404;
      return typeof page === 'number' ? new Response('', { status: page }) : new Response(page, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchStub);
  };
  const check = (body: unknown, role = 'admin') =>
    buildRoutes(services).find((r) => r.method === 'POST' && r.path === '/settings/elvanto-check')!
      .handler({ ctx: act(role), params: {}, query: {}, body } as any) as Promise<any>;
  beforeAll(async () => { ({ services } = await buildContainer()); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('Brisbane: "All <n> found." with n = the keys checked, and nothing is saved', async () => {
    stub();
    const before = (await services.settings.get()).ministryConfig.elvanto;
    const cfg = (await services.settings.get()).ministryConfig;
    const n = 11 + 7 + LABELS.allergies.length + LABELS.conditions.length + gradeRange(cfg.structure).length;
    const r = await check(DRAFT);
    expect(r).toMatchObject({ ok: true, n, missing: [], extra: [], lines: [`All ${n} found.`] });
    expect(r.fields).toEqual(B.fields);
    expect(r.options).toEqual(B.options);
    expect((await services.settings.get()).ministryConfig.elvanto).toEqual(before);
  });
  it('a missing label is named', async () => {
    stub(STUDENT.replace('>Name of Host filling out form <', '>Host name<'));
    const r = await check(DRAFT);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['Name of Host filling out form']);
    expect(r.fields.host).toBeUndefined();
    expect(r.lines).toContain('Not found: Name of Host filling out form. Make the question match, or type its id.');
  });
  it('an extra question is named', async () => {
    const extra = '<div class="form-group"><label class="control-label">Favourite colour</label>'
      + '<input type="text" name="submissions[0][forms_custom_field][11111111-2222-3333-4444-555555555555]" value=""></div>';
    stub(STUDENT, PARENT.replace('<label class="control-label">Parent Email Address', `${extra}<label class="control-label">Parent Email Address`));
    const r = await check(DRAFT);
    expect(r).toMatchObject({ ok: false, missing: [], extra: ['Favourite colour'] });
    expect(r.lines).toContain("This form asks something the app doesn't fill: Favourite colour.");
  });
  it.each([
    [500, PARENT, "Can't open the student form. Check the link."],
    [302, PARENT, "Can't open the student form. Check the link."],
    [STUDENT, 404, "Can't open the parent form. Check the link."],
  ])('an unreachable form is named (%#)', async (s, p, msg) => {
    stub(s, p);
    await expect(check(DRAFT)).rejects.toMatchObject({ message: msg, statusCode: 502 });
  });
  it('a fetch that throws is unreachable too', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));
    await expect(check(DRAFT)).rejects.toMatchObject({ message: "Can't open the student form. Check the link." });
  });
  it("fetches both draft links with redirect: 'manual' and an 8 s abort", async () => {
    stub();
    const t = vi.spyOn(AbortSignal, 'timeout');
    await check(DRAFT);
    expect(fetchStub.mock.calls.map((c) => c[0]).sort()).toEqual([formUrl(B, 'parent'), formUrl(B, 'student')].sort());
    for (const [, init] of fetchStub.mock.calls) {
      expect(init.redirect).toBe('manual');
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
    expect(t.mock.calls).toEqual([[8000], [8000]]);
  });
  it.each(['https://evil.com', 'http://citipointe.elvanto.com.au', 'https://citipointe.elvanto.com.au.evil.com', 'https://169.254.169.254', ''])(
    'a baseUrl outside the allow-list (%s) is never fetched', async (baseUrl) => {
      stub();
      await expect(check({ ...DRAFT, baseUrl })).rejects.toMatchObject({ statusCode: 400 });
      expect(fetchStub).not.toHaveBeenCalled();
    });
  it('a form id that is not a uuid is never fetched', async () => {
    stub();
    await expect(check({ ...DRAFT, studentFormId: '../admin' })).rejects.toMatchObject({ statusCode: 400,
      message: "Paste each form's public link in Youth Setup, Elvanto for this location." });
    expect(fetchStub).not.toHaveBeenCalled();
  });
  it('a non-admin gets 403 and nothing is fetched', async () => {
    stub();
    await expect(check(DRAFT, 'leader')).rejects.toMatchObject({ statusCode: 403 });
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
