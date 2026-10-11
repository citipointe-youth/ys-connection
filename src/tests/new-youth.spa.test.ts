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

// Runs the REAL nySend / _nyErrorText from index.html against minimal stubs.
function sendHarness(post: (path: string, body: any, ms?: number) => Promise<any>) {
  const S: any = { user: { role: "admin" } };
  const rendered: number[] = [];
  const body = { host: "H", firstName: "A", lastName: "T", dob: "2012-04-03", gender: "m", grade: "8", school: "S", mobile: "0412345678", parentFirst: "P", parentLast: "T", parentMobile: "0498765432" };
  const factory = new Function("S", "API", "toast", "document", "localStorage", "renderNewYouth", "_nyRead", "body",
    `let NY = { keep: null, sibling: false, sending: false, result: null, last: null, error: null };
    ${extractFn(html, "_nyErrorText")}
    ${extractFn(html, "nySend")}
    return { nySend, get NY() { return NY; }, set NY(v) { NY = v; } };`);
  const h = factory(S, { post }, () => {}, { getElementById: () => ({ disabled: false }) }, { setItem() {} }, () => rendered.push(1), () => ({ ...body }), body);
  return { h, S, rendered, body };
}

describe("nySend failure paths", () => {
  it("a 401 during send does not draw the form", async () => {
    const t = sendHarness(async () => { t.S.user = null; throw Object.assign(new Error("Session expired"), { status: 401 }); });
    await t.h.nySend({ preventDefault() {} });
    expect(t.rendered).toHaveLength(0);
    expect(t.h.NY.sending).toBe(false);
  });
  it("a failed parent-only retry stays on the result page", async () => {
    const t = sendHarness(async () => { throw Object.assign(new Error("X"), { status: 502 }); });
    const earlier = { student: "sent", parent: "failed", dryRun: false };
    t.h.NY = { keep: null, sibling: false, sending: false, result: earlier, last: { ...t.body }, error: null };
    await t.h.nySend(null, ["parent"]);
    expect(t.h.NY.result).toBe(earlier);
    expect(t.h.NY.error).toBe("X");
    expect(t.rendered).toHaveLength(1);
  });
  it("a failed full send keeps the inputs", async () => {
    const t = sendHarness(async () => { throw new Error("Can't reach the server"); });
    await t.h.nySend({ preventDefault() {} });
    expect(t.h.NY.result).toBeNull();
    expect(t.h.NY.keep).toEqual(t.body);
    expect(t.h.NY.error).toMatch(/Check the forms list in Elvanto/);
    expect(t.rendered).toHaveLength(1);
  });
  it("the result page shows the error card, and sign-out clears the form state", () => {
    const r = extractFn(html, "renderNewYouth");
    const resultBranch = r.slice(r.indexOf("if (NY.result)"), r.indexOf("const k = NY.keep"));
    expect(resultBranch.indexOf("NY.error ?")).toBeGreaterThan(-1);
    expect(resultBranch.indexOf("NY.error ?")).toBeLessThan(resultBranch.indexOf("border-left:4px solid ${colour}"));
    expect(extractFn(html, "doLogout")).toContain("nyReset()");
  });
});
