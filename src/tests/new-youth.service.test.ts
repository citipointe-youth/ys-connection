import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeNewYouthService } from '../services/new-youth.service';
import * as EF from '../services/elvanto-forms';
import { brisbaneElvanto } from './helpers/brisbane-elvanto';
const BRIS = brisbaneElvanto();
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
    if (method === 'GET') return new Response(u.includes(BRIS.studentFormId) ? html.student : html.parent, { status: 200 });
    return post(u);
  });
  return { fetchFn: fn as unknown as typeof fetch, calls, posts: () => calls.filter((c) => c.method === 'POST') };
}

async function settingsWith(mode: 'off' | 'admin' | 'on') {
  const repo = new InMemorySettingsRepository();
  await repo.init();
  await repo.updateSettings({ ministryConfig: { ...MINISTRY_CONFIG_DEFAULTS, elvanto: BRIS, modules: { ...MINISTRY_CONFIG_DEFAULTS.modules, newYouthForms: mode } } } as any);
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

  it('T4 (X19), 2026-10-24: neither posted form carries the returned ref', async () => {
    const f = fakeFetch();
    const svc = makeNewYouthService(await settingsWith('on'), { fetchFn: f.fetchFn, live: true });
    const r = await svc.send(LEADER, INPUT);
    expect(r.ref).toMatch(APP_REF_RE);
    const [student, parent] = f.posts().map((c) => new URLSearchParams(c.body));
    expect(student!.get('submissions[0][forms_custom_field][70d2227e-1a78-47c0-be6d-4fd8ddc12735]')).toBe('Sam Host');
    expect(student!.toString()).not.toContain(r.ref!);
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
    expect(s!.url).toContain(BRIS.studentFormId);
    expect(p!.url).toContain(BRIS.parentFormId);
    const sb = new URLSearchParams(s!.body), pb = new URLSearchParams(p!.body);
    expect(sb.get('submissions[0][first_name]')).toBe('Alex');
    expect(sb.get('submissions[0][birthday]')).toBe('03/04/2012');
    expect(sb.get('submissions[0][mobile_number]')).toBe('0412345678');
    expect(sb.get('submissions[0][people_custom_field][bab736a4-dbe8-4a0c-ae3e-7c2c5799f9a3]')).toBe('Pat Test');
    expect(sb.get('submissions[0][people_custom_field][c184c020-76ce-11e5-9d36-06ba798128be]')).toBe('0498765432');
    expect(pb.get('submissions[0][first_name]')).toBe('Pat');
    expect(pb.get('submissions[0][mobile_number]')).toBe('0498765432');
  });

  it('blank config -> 409 ELVANTO_NOT_SET and no fetch', async () => {
    const f = fakeFetch();
    const repo = await settingsWith('on');
    const cur = (await repo.getSettings()).ministryConfig;
    await repo.updateSettings({ ministryConfig: { ...cur, elvanto: MINISTRY_CONFIG_DEFAULTS.elvanto } } as any);
    const svc = makeNewYouthService(repo, { fetchFn: f.fetchFn, live: true });
    const err: any = await svc.send(LEADER, INPUT).catch((e) => e);
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('ELVANTO_NOT_SET');
    expect(err.message).toBe("New person isn't set up here yet. Ask your admin.");
    expect(f.fetchFn).not.toHaveBeenCalled();
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
      if (url.includes(BRIS.studentFormId)) throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
      return new Response('<p>OK-TEST</p>', { status: 200 });
    });
    const svc = makeNewYouthService(await settingsWith('on'), { fetchFn: f.fetchFn, live: true });
    expect(await svc.send(LEADER, INPUT)).toEqual({ student: 'unconfirmed', parent: 'sent', dryRun: false, ref: REF });
  });

  it('T3: an unconfirmed form goes to the Error log (form + outcome + role, never the person)', async () => {
    const f = fakeFetch((url) => {
      if (url.includes(BRIS.studentFormId)) throw new Error('timed out');
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
    expect(f.posts().map((c) => c.url)).toEqual([EF.formUrl(BRIS, 'parent')]);
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
        return new Response(u.includes(BRIS.studentFormId) ? studentHtml : parentHtml, { status: 200 });
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
      if (changed && (init?.method ?? 'GET') === 'GET' && String(url).includes(BRIS.studentFormId)) {
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

describe('sendBusConsent', () => {
  const BUS_HTML = readFileSync(join(__dirname, 'fixtures/elvanto-bus-consent-form.html'), 'utf8');
  const chk = EF.checkBusForm(BUS_HTML, [7, 8, 9, 10, 11, 12]);
  const BUS_ELV = { ...BRIS, busConsentFormId: '8c9f0929-5b36-4ab7-b9bd-8b4082b013dc',
    fields: { ...BRIS.fields, ...chk.fields }, options: { ...BRIS.options, ...chk.options } };
  const BUS_INPUT = { first: 'jamie', last: 'sample', grade: '8', gender: 'f', mobile: '0400 000 001', school: 'Example High',
    address: { line1: '1 Test St', postcode: '4000', city: 'Brisbane City' }, parentName: 'Alex Sample', parentPhone: '0400 000 003', pickup: false, pickupBy: '' };

  async function busSettings(over: { busMinistry?: boolean; elvanto?: object } = {}) {
    const repo = new InMemorySettingsRepository();
    await repo.init();
    await repo.updateSettings({ ministryConfig: { ...MINISTRY_CONFIG_DEFAULTS, elvanto: over.elvanto ?? BUS_ELV,
      modules: { ...MINISTRY_CONFIG_DEFAULTS.modules, busMinistry: over.busMinistry ?? true } } } as any);
    return repo;
  }
  function busFetch(post: () => Response, html = BUS_HTML) {
    const calls: { method: string; url: string }[] = [];
    const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url: String(url) });
      return method === 'GET' ? new Response(html, { status: 200 }) : post();
    });
    return { fetchFn: fn as unknown as typeof fetch, posts: () => calls.filter((c) => c.method === 'POST') };
  }

  it('posts the bus form once; a double tap is a repeat; a refused form is failed; a 500 is unconfirmed', async () => {
    const f = busFetch(() => new Response(null, { status: 302, headers: { location: '/thanks' } }));
    const svc = makeNewYouthService(await busSettings(), { fetchFn: f.fetchFn, live: true });
    expect(await svc.sendBusConsent(LEADER, BUS_INPUT)).toMatchObject({ result: 'sent', dropoff: null });
    expect(f.posts()).toHaveLength(1);
    expect(f.posts()[0]!.url).toContain(BUS_ELV.busConsentFormId);
    expect(await svc.sendBusConsent(LEADER, BUS_INPUT)).toMatchObject({ result: 'sent', repeat: true });
    expect(f.posts()).toHaveLength(1);
    const bad = makeNewYouthService(await busSettings(), { fetchFn: busFetch(() => new Response('<form><input name="save"></form>', { status: 200 })).fetchFn, live: true });
    expect((await bad.sendBusConsent(LEADER, BUS_INPUT)).result).toBe('failed');
    const down = makeNewYouthService(await busSettings(), { fetchFn: busFetch(() => new Response('', { status: 500 })).fetchFn, live: true });
    expect((await down.sendBusConsent(LEADER, BUS_INPUT)).result).toBe('unconfirmed');
  });

  it('a success page without the marker is unconfirmed and a second tap never posts again', async () => {
    const f = busFetch(() => new Response('<p>Unknown page</p>', { status: 200 }));
    const svc = makeNewYouthService(await busSettings(), { fetchFn: f.fetchFn, live: true });
    expect((await svc.sendBusConsent(LEADER, BUS_INPUT)).result).toBe('unconfirmed');
    expect(await svc.sendBusConsent(LEADER, BUS_INPUT)).toMatchObject({ result: 'unconfirmed', repeat: true });
    expect(f.posts()).toHaveLength(1);
    const ok = busFetch(() => new Response('<p>Thank you so much for completing this form!</p>', { status: 200 }));
    expect(await makeNewYouthService(await busSettings(), { fetchFn: ok.fetchFn, live: true }).sendBusConsent(LEADER, BUS_INPUT)).toMatchObject({ result: 'sent', dropoff: null });
  });

  it('module off -> MODULE_DISABLED; blank form id or option id -> ELVANTO_NOT_SET; changed form -> ELVANTO_FORM_CHANGED; nothing posted', async () => {
    const f = busFetch(() => new Response(null, { status: 302 }));
    const off = makeNewYouthService(await busSettings({ busMinistry: false }), { fetchFn: f.fetchFn, live: true });
    await expect(off.sendBusConsent(LEADER, BUS_INPUT)).rejects.toMatchObject({ code: 'MODULE_DISABLED' });
    const blank = makeNewYouthService(await busSettings({ elvanto: { ...BUS_ELV, busConsentFormId: '' } }), { fetchFn: f.fetchFn, live: true });
    await expect(blank.sendBusConsent(LEADER, BUS_INPUT)).rejects.toMatchObject({ code: 'ELVANTO_NOT_SET', statusCode: 409 });
    const noOpt = makeNewYouthService(await busSettings({ elvanto: { ...BUS_ELV, options: { ...BUS_ELV.options, bcGrade8: '' } } }), { fetchFn: f.fetchFn, live: true });
    await expect(noOpt.sendBusConsent(LEADER, BUS_INPUT)).rejects.toMatchObject({ code: 'ELVANTO_NOT_SET' });
    const cf = busFetch(() => new Response(null, { status: 302 }), BUS_HTML.replace('name="submissions[0][home_city]"', 'name="x"'));
    const changed = makeNewYouthService(await busSettings(), { fetchFn: cf.fetchFn, live: true });
    await expect(changed.sendBusConsent(LEADER, BUS_INPUT)).rejects.toMatchObject({ code: 'ELVANTO_FORM_CHANGED', statusCode: 502 });
    expect(cf.posts()).toHaveLength(0);
    expect(f.posts()).toHaveLength(0);
  });

  it('a bad detail is BAD_REQUEST naming the field, never the value', async () => {
    const svc = makeNewYouthService(await busSettings(), { fetchFn: busFetch(() => new Response(null, { status: 302 })).fetchFn, live: true });
    await expect(svc.sendBusConsent(LEADER, { ...BUS_INPUT, parentPhone: 'nope' })).rejects.toMatchObject({ statusCode: 400, message: 'Check the parent phone' });
  });

  it('an unconfirmed bus consent is queued, lists with forms ["busConsent"], and its retry posts the bus form and clears the row', async () => {
    const { InMemoryUnsentRepository } = await import('../repositories/in-memory');
    const { randomBytes } = await import('node:crypto');
    const old = [process.env.FIELD_ENCRYPTION_KEY, process.env.FIELD_ENCRYPTION_KEY_ID];
    process.env.FIELD_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    process.env.FIELD_ENCRYPTION_KEY_ID = 't1';
    try {
      const unsent = new InMemoryUnsentRepository();
      let status = 500;
      const f = busFetch(() => new Response(status === 500 ? '' : null, { status }));
      const svc = makeNewYouthService(await busSettings(), { fetchFn: f.fetchFn, live: true, unsent });
      expect(await svc.sendBusConsent(LEADER, BUS_INPUT)).toMatchObject({ result: 'unconfirmed', queued: true });
      const rows = (await svc.unsentList(ADMIN)).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ forms: ['busConsent'], name: 'jamie sample', host: null, grade: '8' });
      status = 302;
      const r = await svc.unsentRetry(ADMIN, rows[0]!.id, { confirm: true });
      expect((r as unknown as { result: string }).result).toBe('sent');
      expect(f.posts().every((c) => c.url.includes(BUS_ELV.busConsentFormId))).toBe(true);
      expect((await svc.unsentList(ADMIN)).rows).toHaveLength(0);
    } finally {
      for (const [k, v] of [['FIELD_ENCRYPTION_KEY', old[0]], ['FIELD_ENCRYPTION_KEY_ID', old[1]]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });
});
