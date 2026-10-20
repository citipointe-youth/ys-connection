import { describe, it, expect } from 'vitest';
import { MinistryConfigSchema, MINISTRY_CONFIG_DEFAULTS } from '../core/ministry-config';
import { ELVANTO_0040_SQL as sql, brisbaneElvanto, brisbaneElvantoJson } from './helpers/brisbane-elvanto';
import { loadIndexHtml } from './helpers/extract-fn';
import { studentBody, parentBody, GRADES, ALLERGIES, CONDITIONS } from '../services/elvanto-forms';
import golden from './fixtures/elvanto-bodies-brisbane.json';

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
  it('the golden fixture is what the Brisbane body builders send today', () => {
    expect(golden).toHaveLength(3);
    for (const g of golden as any[]) {
      expect([...studentBody(g.youth, g.honeypot).entries()]).toEqual(g.student);
      expect([...parentBody(g.youth, g.honeypot).entries()]).toEqual(g.parent);
    }
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
