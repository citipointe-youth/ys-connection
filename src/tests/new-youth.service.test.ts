import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeNewYouthService } from '../services/new-youth.service';
import * as EF from '../services/elvanto-forms';
import { InMemorySettingsRepository } from '../repositories/in-memory';
import { MINISTRY_CONFIG_DEFAULTS } from '../core/ministry-config';
import type { Actor } from '../core/entities/user';

const studentHtml = readFileSync(join(__dirname, 'fixtures/elvanto-student-form.html'), 'utf8');
const parentHtml = readFileSync(join(__dirname, 'fixtures/elvanto-parent-form.html'), 'utf8');
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

async function settingsWith(on: boolean) {
  const repo = new InMemorySettingsRepository();
  await repo.init();
  await repo.updateSettings({ ministryConfig: { ...MINISTRY_CONFIG_DEFAULTS, modules: { ...MINISTRY_CONFIG_DEFAULTS.modules, newYouthForms: on } } } as any);
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
    const svc = makeNewYouthService(await settingsWith(false), { fetchFn: f.fetchFn });
    await expect(svc.send(LEADER, INPUT)).rejects.toMatchObject({ statusCode: 404 });
    expect(f.calls).toHaveLength(0);
  });

  it('happy path: student then parent, normalised once for both', async () => {
    const f = fakeFetch();
    const svc = makeNewYouthService(await settingsWith(true), { fetchFn: f.fetchFn });
    expect(await svc.send(LEADER, INPUT)).toEqual({ student: 'sent', parent: 'sent', dryRun: false });
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
    const svc = makeNewYouthService(await settingsWith(true), { fetchFn: f.fetchFn });
    const err = await svc.send(LEADER, { ...INPUT, parentMobile: '12345' }).catch((e) => e);
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Check the parent mobile');
    expect(f.calls).toHaveLength(0);
  });

  it('a changed form refuses before any POST', async () => {
    const f = fakeFetch(undefined, { student: studentHtml.replace('name="submissions[0][birthday]"', 'name="x"'), parent: parentHtml });
    const svc = makeNewYouthService(await settingsWith(true), { fetchFn: f.fetchFn });
    await expect(svc.send(LEADER, INPUT)).rejects.toMatchObject({ code: 'ELVANTO_FORM_CHANGED', statusCode: 502 });
    expect(f.posts()).toHaveLength(0);
  });

  it('Elvanto unreachable on GET → 502, nothing posted', async () => {
    const fn = vi.fn(async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    const svc = makeNewYouthService(await settingsWith(true), { fetchFn: fn });
    await expect(svc.send(LEADER, INPUT)).rejects.toMatchObject({ code: 'ELVANTO_UNREACHABLE', statusCode: 502 });
  });

  it('a rejected student form skips the parent', async () => {
    const f = fakeFetch(() => new Response(studentHtml, { status: 200 }));
    const svc = makeNewYouthService(await settingsWith(true), { fetchFn: f.fetchFn });
    expect(await svc.send(LEADER, INPUT)).toEqual({ student: 'failed', parent: 'skipped', dryRun: false });
    expect(f.posts()).toHaveLength(1);
  });

  it('a POST that throws is unconfirmed and the parent still goes', async () => {
    const f = fakeFetch((url) => {
      if (url.includes(EF.STUDENT_FORM_ID)) throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
      return new Response('<p>OK-TEST</p>', { status: 200 });
    });
    const svc = makeNewYouthService(await settingsWith(true), { fetchFn: f.fetchFn });
    expect(await svc.send(LEADER, INPUT)).toEqual({ student: 'unconfirmed', parent: 'sent', dryRun: false });
  });

  it('send:["parent"] retries only the parent form', async () => {
    const f = fakeFetch();
    const svc = makeNewYouthService(await settingsWith(true), { fetchFn: f.fetchFn });
    expect(await svc.send(LEADER, { ...INPUT, send: ['parent'] })).toEqual({ student: 'skipped', parent: 'sent', dryRun: false });
    expect(f.posts().map((c) => c.url)).toEqual([EF.formUrl(EF.PARENT_FORM_ID)]);
  });

  it('identical send within 2 minutes is not posted again', async () => {
    const f = fakeFetch();
    const svc = makeNewYouthService(await settingsWith(true), { fetchFn: f.fetchFn });
    await svc.send(LEADER, INPUT);
    expect(await svc.send(LEADER, INPUT)).toEqual({ student: 'sent', parent: 'sent', dryRun: false, repeat: true });
    expect(f.posts()).toHaveLength(2);
  });

  it('a second tap while the first is still sending is not posted again', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const f = fakeFetch(async () => { await gate; return new Response('<p>OK-TEST</p>', { status: 200 }); });
    const svc = makeNewYouthService(await settingsWith(true), { fetchFn: f.fetchFn });
    const first = svc.send(LEADER, INPUT);
    await vi.waitFor(() => expect(f.posts()).toHaveLength(1)); // the first send is mid-POST
    expect(await svc.send(LEADER, INPUT)).toEqual({ student: 'unconfirmed', parent: 'unconfirmed', dryRun: false, repeat: true });
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
    const svc = makeNewYouthService(await settingsWith(true), { fetchFn });
    const first = svc.send(LEADER, INPUT);
    await vi.waitFor(() => expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2)); // mid-GET
    expect(await svc.send(LEADER, INPUT)).toEqual({ student: 'unconfirmed', parent: 'unconfirmed', dryRun: false, repeat: true });
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
    const svc = makeNewYouthService(await settingsWith(true), { fetchFn });
    await expect(svc.send(LEADER, INPUT)).rejects.toMatchObject({ code: 'ELVANTO_UNREACHABLE' });
    down = false;
    expect(await svc.send(LEADER, INPUT)).toEqual({ student: 'sent', parent: 'sent', dryRun: false });
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
    const svc = makeNewYouthService(await settingsWith(true), { fetchFn });
    await expect(svc.send(LEADER, INPUT)).rejects.toMatchObject({ code: 'ELVANTO_FORM_CHANGED' });
    changed = false;
    expect(await svc.send(LEADER, INPUT)).toEqual({ student: 'sent', parent: 'sent', dryRun: false });
  });

  it('a failed send is not remembered, so a fixed retry goes through', async () => {
    let reject = true;
    const f = fakeFetch(() => new Response(reject ? studentHtml : '<p>OK-TEST</p>', { status: 200 }));
    const svc = makeNewYouthService(await settingsWith(true), { fetchFn: f.fetchFn });
    await svc.send(LEADER, INPUT);
    reject = false;
    expect((await svc.send(LEADER, INPUT)).student).toBe('sent');
  });

  it('dry run fetches the forms but never POSTs', async () => {
    const f = fakeFetch();
    const svc = makeNewYouthService(await settingsWith(true), { fetchFn: f.fetchFn, dryRun: true });
    expect(await svc.send(LEADER, INPUT)).toEqual({ student: 'skipped', parent: 'skipped', dryRun: true });
    expect(f.posts()).toHaveLength(0);
  });

  it('rate limit: the 61st send in an hour from one login is refused', async () => {
    const f = fakeFetch();
    const svc = makeNewYouthService(await settingsWith(true), { fetchFn: f.fetchFn, dryRun: true });
    for (let i = 0; i < 60; i++) await svc.send(LEADER, { ...INPUT, firstName: `Kid${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}` });
    await expect(svc.send(LEADER, { ...INPUT, firstName: 'Last' })).rejects.toMatchObject({ statusCode: 429 });
  });
});
