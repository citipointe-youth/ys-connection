import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeNewYouthService } from '../services/new-youth.service';
import * as EF from '../services/elvanto-forms';
import { InMemorySettingsRepository } from '../repositories/in-memory';
import { MINISTRY_CONFIG_DEFAULTS } from '../core/ministry-config';
import type { Actor } from '../core/entities/user';
import { APP_REF_RE } from '../core/link-contract';

const REF = expect.stringMatching(APP_REF_RE);

const studentHtml = readFileSync(join(__dirname, 'fixtures/elvanto-student-form.html'), 'utf8');
const parentHtml = readFileSync(join(__dirname, 'fixtures/elvanto-parent-form.html'), 'utf8');
const ADMIN: Actor = { id: 'a-admin', role: 'admin' as any, displayName: 'A', grade: null as any, quad: null as any };
const GRADE: Actor = { id: 'a-grade', role: 'grade' as any, displayName: 'G', grade: 9 as any, quad: null as any };
const LEADER: Actor = { id: 'a-leader', role: 'leader' as any, displayName: 'L', grade: null as any, quad: null as any };

const INPUT = {
  host: 'Sam Host', firstName: 'ALEX', lastName: 'test', dob: '2012-04-03',
  gender: 'f', grade: '8', school: 'CCC', mobile: '+61 412 345 678',
  address: { street: '1 Test St', suburb: 'Carindale', state: 'QLD', postcode: '4152' },
  allergies: ['Nut Allergy'], conditions: [], medicalNotes: '',
  parentFirst: 'pat', parentLast: 'test', parentMobile: '0498 765 432',
};

type Call = { method: string; url: string; body: string };
function fakeFetch(post: (url: string) => Response | Promise<Response> = () => new Response('<p>OK-TEST</p>', { status: 200 }), html = { student: studentHtml, parent: parentHtml }) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url), method = init?.method ?? 'GET';
    calls.push({ method, url: u, body: init?.body ? String(init.body) : '' });
    if (method === 'GET') return new Response(u.includes(EF.STUDENT_FORM_ID) ? html.student : html.parent, { status: 200 });
    return post(u);
  });
  return { fetchFn: fn as unknown as typeof fetch, calls, posts: () => calls.filter((c) => c.method === 'POST') };
}

async function settingsWith(mode: 'off' | 'admin' | 'on') {
  const repo = new InMemorySettingsRepository();
  await repo.init();
  await repo.updateSettings({ ministryConfig: { ...MINISTRY_CONFIG_DEFAULTS, modules: { ...MINISTRY_CONFIG_DEFAULTS.modules, newYouthForms: mode } } } as any);
  return repo;
}

const saved = { student: { ...EF.SUCCESS.student }, parent: { ...EF.SUCCESS.parent } };
beforeEach(() => {
  EF.SUCCESS.student.marker = 'OK-TEST';
  EF.SUCCESS.parent.marker = 'OK-TEST';
  vi.useFakeTimers({ toFake: ['Date'] }); // the DOB age check reads the clock; only Date is faked, so fetch timeouts still work
  vi.setSystemTime(new Date('2026-10-11T00:00:00Z'));
});
afterEach(() => {
  Object.assign(EF.SUCCESS.student, saved.student);
  Object.assign(EF.SUCCESS.parent, saved.parent);
  vi.useRealTimers();
});

describe('NewYouthService.send', () => {
  it('module off → 404 ModuleDisabled, nothing fetched', async () => {
    const f = fakeFetch();
    const svc = makeNewYouthService(await settingsWith('off'), { fetchFn: f.fetchFn });
    await expect(svc.send(LEADER, INPUT)).rejects.toMatchObject({ statusCode: 404 });
    expect(f.calls).toHaveLength(0);
  });

  it('admin-only mode: the admin login can send (dry run here)', async () => {
    const f = fakeFetch();
    const svc = makeNewYouthService(await settingsWith('admin'), { fetchFn: f.fetchFn });
    expect(await svc.send(ADMIN, INPUT)).toMatchObject({ student: 'skipped', parent: 'skipped', dryRun: true });
    expect(f.posts()).toHaveLength(0);
  });

  it('admin-only mode: the admin login sends live when live is set (admin only does not change sending)', async () => {
    const f = fakeFetch();
    const svc = makeNewYouthService(await settingsWith('admin'), { fetchFn: f.fetchFn, live: true });
    expect(await svc.send(ADMIN, INPUT)).toEqual({ student: 'sent', parent: 'sent', dryRun: false, ref: REF });
  });

  it('T4 (X19): the posted student form carries the returned ref on its host answer; the parent form does not', async () => {
    const f = fakeFetch();
    const svc = makeNewYouthService(await settingsWith('on'), { fetchFn: f.fetchFn, live: true });
    const r = await svc.send(LEADER, INPUT);
    expect(r.ref).toMatch(APP_REF_RE);
    const [student, parent] = f.posts().map((c) => new URLSearchParams(c.body));
    expect(student!.get('submissions[0][forms_custom_field][70d2227e-1a78-47c0-be6d-4fd8ddc12735]')).toBe(`Sam Host (${r.ref})`);
    expect(parent!.toString()).not.toContain(r.ref!);
    expect((await svc.send(LEADER, INPUT)).ref).toBe(r.ref); // a repeat answers with the same send
  });

  it.each([['leader', LEADER], ['grade', GRADE]] as const)('admin-only mode: %s gets 404 ModuleDisabled and nothing is fetched', async (_n, who) => {
    const f = fakeFetch();
    const svc = makeNewYouthService(await settingsWith('admin'), { fetchFn: f.fetchFn, live: true });
    await expect(svc.send(who, INPUT)).rejects.toMatchObject({ statusCode: 404 });
    expect(f.calls).toHaveLength(0);
  });

  it.each([['off', LEADER], ['admin', LEADER], ['admin', GRADE]] as const)('the refusal (%s mode, actor %#) names the screen New person, never New youth', async (mode, who) => {
    const f = fakeFetch();
    const svc = makeNewYouthService(await settingsWith(mode), { fetchFn: f.fetchFn, live: true });
    const err: any = await svc.send(who, INPUT).catch((e) => e);
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('MODULE_DISABLED');
    expect(err.message).toContain('New person');
    expect(err.message).not.toMatch(/New youth/i);
  });

  it('happy path: student then parent, normalised once for both', async () => {
    const f = fakeFetch();
    const svc = makeNewYouthService(await settingsWith('on'), { fetchFn: f.fetchFn, live: true });
    expect(await svc.send(LEADER, INPUT)).toEqual({ student: 'sent', parent: 'sent', dryRun: false, ref: REF });
    const [s, p] = f.posts();
    expect(s!.url).toContain(EF.STUDENT_FORM_ID);
    expect(p!.url).toContain(EF.PARENT_FORM_ID);
    const sb = new URLSearchParams(s!.body), pb = new URLSearchParams(p!.body);
    expect(sb.get('submissions[0][first_name]')).toBe('Alex');
    expect(sb.get('submissions[0][birthday]')).toBe('03/04/2012');
    expect(sb.get('submissions[0][mobile_number]')).toBe('0412345678');
    expect(sb.get('submissions[0][people_custom_field][bab736a4-dbe8-4a0c-ae3e-7c2c5799f9a3]')).toBe('Pat Test');
    expect(sb.get('submissions[0][people_custom_field][c184c020-76ce-11e5-9d36-06ba798128be]')).toBe('0498765432');
    expect(pb.get('submissions[0][first_name]')).toBe('Pat');
    expect(pb.get('submissions[0][mobile_number]')).toBe('0498765432');
  });

  it('bad input → 400 with a field label and no submitted value; nothing fetched', async () => {
    const f = fakeFetch();
    const svc = makeNewYouthService(await settingsWith('on'), { fetchFn: f.fetchFn });
    const err = await svc.send(LEADER, { ...INPUT, parentMobile: '12345' }).catch((e) => e);
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Check the parent mobile');
    expect(f.calls).toHaveLength(0);
  });

  it('a changed form refuses before any POST', async () => {
    const f = fakeFetch(undefined, { student: studentHtml.replace('name="submissions[0][birthday]"', 'name="x"'), parent: parentHtml });
    const svc = makeNewYouthService(await settingsWith('on'), { fetchFn: f.fetchFn, live: true });
    await expect(svc.send(LEADER, INPUT)).rejects.toMatchObject({ code: 'ELVANTO_FORM_CHANGED', statusCode: 502 });
    expect(f.posts()).toHaveLength(0);
  });

  it('Elvanto unreachable on GET → 502, nothing posted', async () => {
    const fn = vi.fn(async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    const svc = makeNewYouthService(await settingsWith('on'), { fetchFn: fn, live: true });
    await expect(svc.send(LEADER, INPUT)).rejects.toMatchObject({ code: 'ELVANTO_UNREACHABLE', statusCode: 502 });
  });

  it('a rejected student form skips the parent', async () => {
    const f = fakeFetch(() => new Response(studentHtml, { status: 200 }));
    const svc = makeNewYouthService(await settingsWith('on'), { fetchFn: f.fetchFn, live: true });
    expect(await svc.send(LEADER, INPUT)).toEqual({ student: 'failed', parent: 'skipped', dryRun: false, ref: REF });
    expect(f.posts()).toHaveLength(1);
  });

  it('a POST that throws is unconfirmed and the parent still goes', async () => {
    const f = fakeFetch((url) => {
      if (url.includes(EF.STUDENT_FORM_ID)) throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
      return new Response('<p>OK-TEST</p>', { status: 200 });
    });
    const svc = makeNewYouthService(await settingsWith('on'), { fetchFn: f.fetchFn, live: true });
    expect(await svc.send(LEADER, INPUT)).toEqual({ student: 'unconfirmed', parent: 'sent', dryRun: false, ref: REF });
  });

  it('T3: an unconfirmed form goes to the Error log (form + outcome + role, never the person)', async () => {
    const f = fakeFetch((url) => {
      if (url.includes(EF.STUDENT_FORM_ID)) throw new Error('timed out');
      return new Response('<p>OK-TEST</p>', { status: 200 });
    });
    const record = vi.fn(async () => {});
    const svc = makeNewYouthService(await settingsWith('on'), { fetchFn: f.fetchFn, live: true, errorLog: { record } });
    await svc.send(LEADER, INPUT);
    expect(record.mock.calls).toEqual([[{ category: 'elvanto-form', code: 'STUDENT_FORM_UNCONFIRMED', route: 'POST /intake/new-youth', role: 'leader' }]]);
  });

  it('send:["parent"] retries only the parent form', async () => {
    const f = fakeFetch();
    const svc = makeNewYouthService(await settingsWith('on'), { fetchFn: f.fetchFn, live: true });
    expect(await svc.send(LEADER, { ...INPUT, send: ['parent'] })).toEqual({ student: 'skipped', parent: 'sent', dryRun: false, ref: REF });
    expect(f.posts().map((c) => c.url)).toEqual([EF.formUrl(EF.PARENT_FORM_ID)]);
  });

  it('identical send within 2 minutes is not posted again', async () => {
    const f = fakeFetch();
    const svc = makeNewYouthService(await settingsWith('on'), { fetchFn: f.fetchFn, live: true });
    await svc.send(LEADER, INPUT);
    expect(await svc.send(LEADER, INPUT)).toEqual({ student: 'sent', parent: 'sent', dryRun: false, ref: REF, repeat: true });
    expect(f.posts()).toHaveLength(2);
  });

  it('a second tap while the first is still sending is not posted again', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const f = fakeFetch(async () => { await gate; return new Response('<p>OK-TEST</p>', { status: 200 }); });
    const svc = makeNewYouthService(await settingsWith('on'), { fetchFn: f.fetchFn, live: true });
    const first = svc.send(LEADER, INPUT);
    await vi.waitFor(() => expect(f.posts()).toHaveLength(1)); // the first send is mid-POST
    expect(await svc.send(LEADER, INPUT)).toEqual({ student: 'unconfirmed', parent: 'unconfirmed', dryRun: false, ref: REF, repeat: true });
    release();
    await first;
    expect(f.posts()).toHaveLength(2); // one student + one parent, from the first send only
  });

  it('a second tap while the first is still fetching the forms is not posted again', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const calls: Call[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url), method = init?.method ?? 'GET';
      calls.push({ method, url: u, body: init?.body ? String(init.body) : '' });
      if (method === 'GET') {
        await gate; // the form pages are slow
        return new Response(u.includes(EF.STUDENT_FORM_ID) ? studentHtml : parentHtml, { status: 200 });
      }
      return new Response('<p>OK-TEST</p>', { status: 200 });
    }) as unknown as typeof fetch;
    const svc = makeNewYouthService(await settingsWith('on'), { fetchFn, live: true });
    const first = svc.send(LEADER, INPUT);
    await vi.waitFor(() => expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2)); // mid-GET
    expect(await svc.send(LEADER, INPUT)).toEqual({ student: 'unconfirmed', parent: 'unconfirmed', dryRun: false, ref: REF, repeat: true });
    release();
    await first;
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2); // one student + one parent, from the first send only
  });

  it('a GET failure clears the in-flight mark, so a retry goes through', async () => {
    let down = true;
    const f = fakeFetch();
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (down && (init?.method ?? 'GET') === 'GET') throw new Error('ECONNRESET');
      return f.fetchFn(url, init);
    }) as unknown as typeof fetch;
    const svc = makeNewYouthService(await settingsWith('on'), { fetchFn, live: true });
    await expect(svc.send(LEADER, INPUT)).rejects.toMatchObject({ code: 'ELVANTO_UNREACHABLE' });
    down = false;
    expect(await svc.send(LEADER, INPUT)).toEqual({ student: 'sent', parent: 'sent', dryRun: false, ref: REF });
  });

  it('a changed form clears the in-flight mark', async () => {
    let changed = true;
    const f = fakeFetch();
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (changed && (init?.method ?? 'GET') === 'GET' && String(url).includes(EF.STUDENT_FORM_ID)) {
        return new Response(studentHtml.replace('name="submissions[0][birthday]"', 'name="x"'), { status: 200 });
      }
      return f.fetchFn(url, init);
    }) as unknown as typeof fetch;
    const svc = makeNewYouthService(await settingsWith('on'), { fetchFn, live: true });
    await expect(svc.send(LEADER, INPUT)).rejects.toMatchObject({ code: 'ELVANTO_FORM_CHANGED' });
    changed = false;
    expect(await svc.send(LEADER, INPUT)).toEqual({ student: 'sent', parent: 'sent', dryRun: false, ref: REF });
  });

  it('a failed send is not remembered, so a fixed retry goes through', async () => {
    let reject = true;
    const f = fakeFetch(() => new Response(reject ? studentHtml : '<p>OK-TEST</p>', { status: 200 }));
    const svc = makeNewYouthService(await settingsWith('on'), { fetchFn: f.fetchFn, live: true });
    await svc.send(LEADER, INPUT);
    reject = false;
    expect((await svc.send(LEADER, INPUT)).student).toBe('sent');
  });

  it('dry run (the default when `live` is omitted) fetches the forms but never POSTs', async () => {
    const f = fakeFetch();
    const svc = makeNewYouthService(await settingsWith('on'), { fetchFn: f.fetchFn });
    expect(await svc.send(LEADER, INPUT)).toEqual({ student: 'skipped', parent: 'skipped', dryRun: true });
    expect(f.posts()).toHaveLength(0);
    expect(f.calls.filter((c) => c.method === 'GET')).toHaveLength(2);
  });

  it('live: false is also a dry run; only live: true posts', async () => {
    const f = fakeFetch();
    const off = makeNewYouthService(await settingsWith('on'), { fetchFn: f.fetchFn, live: false });
    expect((await off.send(LEADER, INPUT)).dryRun).toBe(true);
    expect(f.posts()).toHaveLength(0);
    const on = makeNewYouthService(await settingsWith('on'), { fetchFn: f.fetchFn, live: true });
    expect((await on.send(LEADER, INPUT)).dryRun).toBe(false);
    expect(f.posts()).toHaveLength(2);
  });

  it('form GETs use an 8 s timeout and never follow a redirect', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    const inits: RequestInit[] = [];
    const base = fakeFetch();
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') inits.push(init ?? {});
      return base.fetchFn(url, init);
    }) as unknown as typeof fetch;
    const svc = makeNewYouthService(await settingsWith('on'), { fetchFn });
    await svc.send(LEADER, INPUT);
    expect(inits).toHaveLength(2);
    for (const i of inits) expect(i.redirect).toBe('manual');
    expect(spy.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining([8000]));
    expect(spy.mock.calls.filter((c) => c[0] === 5000)).toHaveLength(0);
    spy.mockRestore();
  });

  it('a 30x on a form GET is Elvanto unreachable, nothing posted', async () => {
    const fn = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/' } })) as unknown as typeof fetch;
    const svc = makeNewYouthService(await settingsWith('on'), { fetchFn: fn, live: true });
    await expect(svc.send(LEADER, INPUT)).rejects.toMatchObject({ code: 'ELVANTO_UNREACHABLE' });
  });

  it('rate limit: the 61st send in an hour from one login is refused', async () => {
    const f = fakeFetch();
    const svc = makeNewYouthService(await settingsWith('on'), { fetchFn: f.fetchFn });
    for (let i = 0; i < 60; i++) await svc.send(LEADER, { ...INPUT, firstName: `Kid${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}` });
    await expect(svc.send(LEADER, { ...INPUT, firstName: 'Last' })).rejects.toMatchObject({ statusCode: 429 });
  });
});
