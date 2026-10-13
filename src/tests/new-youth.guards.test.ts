import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractFn } from './helpers/extract-fn';
import { toAuMobile, tidyName } from '../services/elvanto-forms';

const html = readFileSync('public/index.html', 'utf8');
const spa = new Function(`${['toAuMobile', 'tidyName', '_nyFieldMsgs'].map((n) => extractFn(html, n)).join('\n')}; return { toAuMobile, tidyName, _nyFieldMsgs };`)() as {
  toAuMobile: (s: string) => string | null; tidyName: (s: string) => string; _nyFieldMsgs: (p: any) => { block: Record<string, string>; warn: Record<string, string> };
};

describe('New person guards (T2)', () => {
  it('SPA toAuMobile matches the server', () => {
    for (const c of ['0412 345 678', '+61 412 345 678', '61412345678', '+61 0412 345 678', '412345678', '0312345678', '04123', '', 'abc', '0412-345-678'])
      expect(spa.toAuMobile(c)).toBe(toAuMobile(c));
    expect(spa.toAuMobile('+61 412 345 678')).toBe('0412345678');
    expect(spa.toAuMobile('0312345678')).toBeNull();
  });
  it('SPA tidyName matches the server', () => {
    for (const c of ['john', 'JOHN SMITH', 'McDonald', "o'brien", 'MARY-ANN', '  anna   lee ', 'Jo', 'X', 'élise', 'ÉLISE', '', 'de Souza'])
      expect(spa.tidyName(c)).toBe(tidyName(c));
    expect(spa.tidyName('McDonald')).toBe('McDonald');
    expect(spa.tidyName('JOHN')).toBe('John');
  });
  const ok = { firstName: 'Sam', lastName: 'Lee', mobile: '0412345678', parentFirst: 'Pat', parentLast: 'Lee', parentMobile: '0498765432', postcode: '4000' };
  it('a clean form has no messages', () => expect(spa._nyFieldMsgs(ok)).toEqual({ block: {}, warn: {} }));
  it('bad mobiles block, name the field, never echo the value', () => {
    const m = spa._nyFieldMsgs({ ...ok, mobile: '0312345678', parentMobile: '12345' });
    expect(m.block.mobile).toMatch(/student mobile/);
    expect(m.block.parentMobile).toMatch(/parent mobile/);
    expect(JSON.stringify(m)).not.toMatch(/0312345678|12345/);
  });
  it('postcode must be 4 digits (empty is fine)', () => {
    expect(spa._nyFieldMsgs({ ...ok, postcode: '400' }).block.postcode).toMatch(/postcode/);
    expect(spa._nyFieldMsgs({ ...ok, postcode: '4a00' }).block.postcode).toBeTruthy();
    expect(spa._nyFieldMsgs({ ...ok, postcode: '' }).block.postcode).toBeUndefined();
  });
  it('parent name equal to student name blocks (case/space-insensitive)', () => {
    expect(spa._nyFieldMsgs({ ...ok, parentFirst: ' sam ', parentLast: 'LEE' }).block.parentFirst).toMatch(/parent name/);
    expect(spa._nyFieldMsgs({ ...ok, parentFirst: 'Sam', parentLast: 'Kim' }).block.parentFirst).toBeUndefined();
  });
  it('same parent and student mobile only warns, in any typed format', () => {
    const m = spa._nyFieldMsgs({ ...ok, parentMobile: '+61 412 345 678' });
    expect(m.block).toEqual({});
    expect(m.warn.parentMobile).toMatch(/same/);
  });
  it('the wiring is in place: blur tidy, _nyRead normalises, send blocks, postcode keyboard', () => {
    expect(extractFn(html, '_nyRead')).toMatch(/tidyName\(g\('firstName'\)\)[\s\S]*toAuMobile\(g\('mobile'\)\)[\s\S]*toAuMobile\(g\('parentMobile'\)\)/);
    expect(html).toMatch(/id="ny-postcode"[^>]*inputmode="numeric"[^>]*maxlength="4"/);
    expect(extractFn(html, '_nyBlur')).toMatch(/tidyName[\s\S]*toAuMobile/);
  });
});
