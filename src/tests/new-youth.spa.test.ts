import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractFn } from './helpers/extract-fn';
import { ALLERGIES, CONDITIONS } from '../services/elvanto-forms';

const html = readFileSync('public/index.html', 'utf8');
const listOf = (name: string) => JSON.parse(new RegExp(`const ${name} = (\\[[^\\]]*\\]);`).exec(html)![1]!);
const nyMessage = new Function(`${extractFn(html, '_nyMessage')}; return _nyMessage;`)() as (r: any) => { tone: string; retryParent: boolean; lines: string[] };
const nyErrorText = new Function(`${extractFn(html, '_nyErrorText')}; return _nyErrorText;`)() as (e: any) => { unsent: boolean; text: string };

describe('New youth SPA', () => {
  it('checkbox labels match the server lists exactly', () => {
    expect(listOf('NY_ALLERGIES')).toEqual(Object.keys(ALLERGIES));
    expect(listOf('NY_CONDITIONS')).toEqual(Object.keys(CONDITIONS));
  });
  it('both sent → good, no retry', () => {
    const m = nyMessage({ student: 'sent', parent: 'sent', dryRun: false });
    expect(m).toEqual({ tone: 'good', retryParent: false, lines: ['Student form is in Elvanto.', 'Parent form is in Elvanto.'] });
  });
  it('student rejected → bad, says nothing else was sent', () => {
    const m = nyMessage({ student: 'failed', parent: 'skipped', dryRun: false });
    expect(m.tone).toBe('bad');
    expect(m.retryParent).toBe(false);
    expect(m.lines[1]).toMatch(/Nothing else was sent/);
  });
  it('parent rejected → offers a parent-only retry', () => {
    expect(nyMessage({ student: 'sent', parent: 'failed', dryRun: false }).retryParent).toBe(true);
  });
  it('unconfirmed → warn, tells the host to check Elvanto, no retry', () => {
    const m = nyMessage({ student: 'unconfirmed', parent: 'sent', dryRun: false });
    expect(m.tone).toBe('warn');
    expect(m.retryParent).toBe(false);
    expect(m.lines[0]).toMatch(/Check the forms list in Elvanto/);
  });
  it('repeat and dry run say so', () => {
    expect(nyMessage({ student: 'sent', parent: 'sent', dryRun: false, repeat: true }).lines[0]).toMatch(/already sent/);
    expect(nyMessage({ student: 'skipped', parent: 'skipped', dryRun: true }).lines).toEqual(['Test mode: nothing was sent to Elvanto.']);
  });
  it('a refusal before sending says nothing was sent and shows the server message', () => {
    for (const status of [400, 404, 429, 502]) {
      expect(nyErrorText(Object.assign(new Error('Check the parent mobile'), { status }))).toEqual({ unsent: true, text: 'Check the parent mobile' });
    }
  });
  it('a lost reply or timeout never says "try again": check Elvanto first', () => {
    for (const e of [new Error("Can't reach the server"), Object.assign(new Error('Please try again'), { status: 503 }), Object.assign(new Error('x'), { status: 500 })]) {
      const r = nyErrorText(e);
      expect(r.unsent).toBe(false);
      expect(r.text).toMatch(/Check the forms list in Elvanto before sending again/);
      expect(r.text).not.toMatch(/try again/i);
    }
  });
  it('junior leaders may open the page', () => {
    expect(html).toMatch(/\['home','my-students','at-risk','prayers','birthdays','bus','new-youth'\]/);
  });
});
