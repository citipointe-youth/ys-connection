// sync.service (spec 2026-10-12-elvanto-link-app-design.md §8.1; plan tasks C1, C2).
// Replays the frozen fixtures in src/tests/fixtures/elvanto-link/ (read only, never edited).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeSyncService, rematchRoster } from '../services/sync.service';
import { InMemoryLinkRepository } from '../repositories/in-memory/link.repository';
import { InMemoryLeaderRepository, InMemorySettingsRepository, InMemoryStudentRepository, InMemoryUserRepository } from '../repositories/in-memory';
import { MINISTRY_CONFIG_DEFAULTS } from '../core/ministry-config';
import { ClaimResponse, INTAKE_TYPES, PAYLOAD_SCHEMAS, PushResponse, ResultResponse } from '../core/link-contract';
import { dedupeKey } from '../services/link-rules';
import type { ActionType, NewOutboxRow } from '../core/link-types';
// Static, so the cold app-graph load is in the untimed collect phase, not a test's 5 s (pre-existing flake, UI diff review B).
import { buildContainer } from '../container';

// Every logger call made while this file runs (the service must make none with a body or a note).
const logCalls = vi.hoisted(() => [] as unknown[][]);
vi.mock('../utils/logger', () => {
  const rec = (...a: unknown[]) => { logCalls.push(a); };
  return { createLogger: () => ({ info: rec, warn: rec, error: rec }) };
});

const FIX = join(__dirname, 'fixtures/elvanto-link');
const fx = (name: string) => JSON.parse(readFileSync(join(FIX, name), 'utf8'));
const claimReq = fx('claim-request.json');
const claimRes = fx('claim-response.json');
const resultReq = fx('result-request.json');
const resultRes = fx('result-response.json');
const pushRes = fx('push-response.json');
const CONSOLE = claimReq.consoleId as string;
const CREATOR = 'c0000000-0000-4000-8000-0000000000aa';

type Mode = 'off' | 'shadow' | 'on';

async function setup(opts: { mode?: Mode; modules?: Record<string, Mode>; decrypt?: (n: string, id: string) => string } = {}) {
  const m = opts.mode ?? 'on';
  const link = new InMemoryLinkRepository({ decrypt: opts.decrypt });
  const settings = new InMemorySettingsRepository();
  await settings.init();
  await settings.updateSettings({ ministryConfig: { ...MINISTRY_CONFIG_DEFAULTS,
    modules: { ...MINISTRY_CONFIG_DEFAULTS.modules, newYouthForms: m, checkin: m, lifegroupReport: m, flows: m, ...opts.modules } } } as any);
  const users = new InMemoryUserRepository();
  await users.save({ id: CREATOR, displayName: 'Grade 9 Girls', email: 'grade9g', role: 'grade', status: 'active' } as any);
  const students = new InMemoryStudentRepository();
  const svc = makeSyncService({ link, settings, students, users });
  return { link, settings, users, students, svc };
}

/** One outbox row per fixture claim row (same id, type, payload, note, serviceDate). */
function rowFromFixture(r: any): NewOutboxRow {
  return { id: r.id, type: r.type, payload: r.payload, note: r.note, dedupeKey: dedupeKey(r.type, r.payload),
    serviceDate: r.serviceDate, studentId: null, personId: r.payload.personId ?? null, createdBy: CREATOR,
    leaderId: null, leaderName: r.by.leaderName };
}

let spies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => { spies.forEach((s) => s.mockRestore()); });

// ---------------- C1: version gate ----------------

describe('sync.service version gate', () => {
  const bodies = (v: unknown) => ({ ...claimReq, contractVersion: v });

  it('contractVersion 2 → LinkContractMismatch (409, expected: 1), nothing applied', async () => {
    const { svc, link } = await setup();
    for (const call of [
      () => svc.claim(bodies(2)),
      () => svc.result({ ...resultReq, contractVersion: 2 }),
      () => svc.push('roster', { ...fx('push-roster.json'), contractVersion: 2 }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'LINK_CONTRACT_MISMATCH', statusCode: 409, extra: { expected: 1 } });
    }
    expect(await link.listConsoles()).toEqual([]);
    expect(await link.mirrorState()).toEqual([]);
  });

  it('missing or string contractVersion → SyncValidation (400)', async () => {
    const { svc, link } = await setup();
    const { contractVersion: _drop, ...noVersion } = claimReq;
    for (const b of [noVersion, bodies('1'), null, 'x', []]) {
      await expect(svc.claim(b)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
    }
    expect(await link.listConsoles()).toEqual([]);
  });

  it('a Zod failure → SyncValidation (400), nothing applied', async () => {
    const { svc, link } = await setup();
    await expect(svc.claim({ ...claimReq, consoleId: 'not-a-uuid' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
    await expect(svc.result({ ...resultReq, results: [] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const roster = fx('push-roster.json');
    await expect(svc.push('roster', { ...roster, rows: [...roster.rows, { personId: 'bad' }] }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await link.listConsoles()).toEqual([]);
    expect(await link.mirrorState()).toEqual([]);
    expect(await link.roster()).toEqual([]);
  });
});

// ---------------- C1: claim ----------------

describe('sync.service claim', () => {
  it('leases one row per type; reply parses; raw note; by.login = users.email; by.leaderName = snapshot', async () => {
    const { svc, link } = await setup();
    for (const r of claimRes.rows) await link.insertAction(rowFromFixture(r));
    const reply = await svc.claim({ ...claimReq, max: 20 });
    expect(ClaimResponse.parse(reply)).toBeTruthy();
    expect(reply.contractVersion).toBe(1);
    // X19: the intake types are in claim-response-rev4.json (this console lists no intake capability).
    expect(reply.rows.map((r) => r.type).sort()).toEqual(Object.keys(PAYLOAD_SCHEMAS).filter((t) => !(INTAKE_TYPES as readonly string[]).includes(t) && !['removeFromFlowStep', 'consentLookup', 'consentFix', 'consentLink', 'recheck', 'busConsentCheck'].includes(t)).sort()); // rev 6 types (rev 15 recheck: claim-response-rev15.json; rev 18 busConsentCheck: claim-response-rev18.json): claim-response-rev6.json
    for (const row of reply.rows) {
      expect(PAYLOAD_SCHEMAS[row.type as ActionType].safeParse(row.payload).success).toBe(true);
    }
    // Same as the fixture, apart from the clock fields and the leader prefix on the note (X1, ledger 25 D2).
    const strip = (r: any) => { const { createdAt: _c, ...rest } = r; return rest; };
    // 2026-10-24 (ruling Q2): flow notes read `<name>: "<note>"`; reports keep the label.
    const prefixed = (r: any) => (r.type === 'completeStep' ? { ...r, note: r.note ? `${r.by.leaderName}: "${r.note}"` : r.by.leaderName }
      : ['submitReport', 'editReport'].includes(r.type)
      ? { ...r, note: `Self identified leader: ${r.by.leaderName}` + (r.note ? ` — ${r.note}` : '') } : r);
    expect(reply.rows.map(strip)).toEqual(claimRes.rows.map(strip).map(prefixed));
    expect((await link.listConsoles()).map((c) => c.consoleId)).toEqual([CONSOLE]);
  });

  it('X1: the app puts the leader name in front of the note for report, edit and flow step; others stay null', async () => {
    const { svc, link } = await setup();
    const byType = Object.fromEntries(claimRes.rows.map((r: any) => [r.type, r]));
    const ids: Record<string, string> = {};
    let n = 0;
    for (const t of ['submitReport', 'editReport', 'completeStep']) {
      for (const note of ['Called, left a message.', null]) {
        const id = `d0000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
        const p = { ...byType[t].payload, ...(t === 'completeStep' ? { rowId: `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}` }
          : { date: `2026-10-${String(n).padStart(2, '0')}` }) };
        await link.insertAction({ ...rowFromFixture({ ...byType[t], id, payload: p, note }), leaderName: 'Cody Codeman' });
        ids[`${t}:${note ? 'note' : 'none'}`] = id;
      }
    }
    const ci = rowFromFixture(byType.checkIn);
    await link.insertAction({ ...ci, leaderName: 'Cody Codeman' });
    const reply = await svc.claim({ ...claimReq, max: 20 });
    expect(ClaimResponse.parse(reply)).toBeTruthy();
    const note = (id: string) => reply.rows.find((r) => r.id === id)!.note;
    for (const t of ['submitReport', 'editReport']) {
      expect(note(ids[`${t}:note`]!)).toBe('Self identified leader: Cody Codeman — Called, left a message.');
      expect(note(ids[`${t}:none`]!)).toBe('Self identified leader: Cody Codeman');
    }
    // 2026-10-24 (ruling Q2, Q7): a flow note is `<name>: "<note>"`, or the name alone.
    expect(note(ids['completeStep:note']!)).toBe('Cody Codeman: "Called, left a message."');
    expect(note(ids['completeStep:none']!)).toBe('Cody Codeman');
    expect(note(ci.id)).toBeNull();
    // The stored note stays the leader's own words.
    expect(link._peekNote(ids['completeStep:note']!)).toBe('Called, left a message.');
  });

  it('mode off → nothing leased, but the console row is upserted and the sweep ran', async () => {
    const { svc, link } = await setup({ mode: 'off' });
    const fresh = rowFromFixture(claimRes.rows[0]);
    const old = rowFromFixture(claimRes.rows[1]);
    await link.insertAction(fresh);
    await link.insertAction(old);
    link._backdate('link_outbox', old.id, 'created_at', new Date(Date.now() - 4 * 86_400_000).toISOString());
    const reply = await svc.claim(claimReq);
    expect(reply.rows).toEqual([]);
    expect((await link.listConsoles()).map((c) => c.consoleId)).toEqual([CONSOLE]);
    expect((await link.getAction(fresh.id))!.status).toBe('pending');
    expect(await link.getAction(old.id)).toMatchObject({ status: 'refused', reason: 'too-old' });
  });

  it('T10: off means every link screen off: New person on alone leases nothing; one screen on leases', async () => {
    const off = await setup({ mode: 'off', modules: { newYouthForms: 'on' } });
    await off.link.insertAction(rowFromFixture(claimRes.rows[0]));
    expect((await off.svc.claim(claimReq)).rows).toEqual([]);
    const one = await setup({ mode: 'off', modules: { flows: 'shadow' } });
    await one.link.insertAction(rowFromFixture(claimRes.rows[0]));
    expect((await one.svc.claim(claimReq)).rows).toHaveLength(1);
  });

  it('shadow mode still leases (the /sync side ignores the switch except off)', async () => {
    const { svc, link } = await setup({ mode: 'shadow' });
    await link.insertAction(rowFromFixture(claimRes.rows[0]));
    expect((await svc.claim(claimReq)).rows).toHaveLength(1);
  });

  it('an unreadable note → that row is left out and refused; the others are fine', async () => {
    const bad = claimRes.rows[2].id as string; // submitReport, has a note
    const { svc, link } = await setup({ decrypt: (n, id) => { if (id === bad) throw new Error('bad key'); return n; } });
    for (const r of claimRes.rows) await link.insertAction(rowFromFixture(r));
    const reply = await svc.claim(claimReq);
    expect(reply.rows.map((r) => r.id)).not.toContain(bad);
    expect(reply.rows).toHaveLength(5);
    expect(await link.getAction(bad)).toMatchObject({ status: 'refused', reason: 'note-unreadable' });
  });

  it('never logs the note or the body', async () => {
    logCalls.length = 0;
    const { svc, link } = await setup();
    for (const r of claimRes.rows) await link.insertAction(rowFromFixture(r));
    await svc.claim(claimReq);
    await svc.claim({ ...claimReq, contractVersion: 2 }).catch(() => {});
    await svc.claim({ ...claimReq, consoleId: 'x' }).catch(() => {});
    for (const calls of [...spies.map((s) => s.mock.calls), logCalls]) {
      const text = JSON.stringify(calls);
      expect(text).not.toContain('parable of the sower');
      expect(text).not.toContain('Called, left a message');
      expect(text).not.toContain(CONSOLE);
    }
  });
});

// ---------------- C1: result ----------------

describe('sync.service result', () => {
  it('replays result-request.json after leasing the fixture ids → result-response.json', async () => {
    const { svc, link } = await setup();
    const ids = resultReq.results.map((r: any) => r.id as string);
    const byId = new Map<string, any>(claimRes.rows.map((r: any) => [r.id, r]));
    let n = 0x20;
    for (const id of ids) {
      const f = byId.get(id);
      if (f) { await link.insertAction(rowFromFixture(f)); continue; }
      // Extra ids (07..0a) the claim fixture lacks: plain check-ins for distinct people.
      const personId = `9e000000-0000-4000-8000-0000000000${(n++).toString(16)}`;
      const payload = { serviceTimeId: claimRes.rows[0].payload.serviceTimeId, serviceId: claimRes.rows[0].payload.serviceId, personId };
      await link.insertAction(rowFromFixture({ id, type: 'checkIn', payload, note: null, serviceDate: '2026-10-16', by: { leaderName: 'Test Leader' } }));
    }
    const leased = await svc.claim({ ...claimReq, max: 20 });
    expect(leased.rows).toHaveLength(ids.length);
    // The fixture's last item resolves an already-final row (a repeat): mark it sent first.
    link._backdate('link_outbox', '0a000000-0000-4000-8000-00000000000a', 'status', 'sent');
    const reply = await svc.result(resultReq);
    expect(ResultResponse.parse(reply)).toBeTruthy();
    expect(reply).toEqual(resultRes);
    expect(await link.getAction('0a000000-0000-4000-8000-000000000009')).toMatchObject({ status: 'pending', leaseOwner: null });
  });
});

// ---------------- C2: pushes ----------------

describe('sync.service push', () => {
  for (const kind of ['roster', 'services', 'groups', 'flows'] as const) {
    it(`push-${kind}.json → applied, rows = row count; a repeat with the same takenAt is not applied`, async () => {
      const { svc } = await setup();
      const body = fx(`push-${kind}.json`);
      const first = await svc.push(kind, body);
      expect(PushResponse.parse(first)).toBeTruthy();
      expect(first).toMatchObject({ applied: true, rows: body.rows.length });
      if (kind !== 'roster') expect(first).toEqual({ applied: true, rows: body.rows.length });
      const again = await svc.push(kind, body);
      expect(PushResponse.parse(again)).toBeTruthy();
      expect(again).toEqual({ applied: false });
    });
  }

  it('B18 / X10: flows push of two rows, then rows: [] replaces the mirror with nothing', async () => {
    const { svc, link } = await setup();
    const body = fx('push-flows.json');
    const two = { ...body, rows: [body.rows[0], { ...body.rows[0], rowId: '7f000000-0000-4000-8000-0000000000ff' }] };
    expect(await svc.push('flows', two)).toEqual({ applied: true, rows: 2 });
    expect(await link.flows()).toHaveLength(2);
    const later = new Date(Date.parse(body.takenAt) + 60_000).toISOString();
    expect(await svc.push('flows', { ...body, takenAt: later, rows: [] })).toEqual({ applied: true, rows: 0 });
    expect(await link.flows()).toEqual([]);
    expect((await link.mirrorState()).find((m) => m.kind === 'flows')).toMatchObject({ takenAt: later, rowCount: 0 });
  });

  it('groups get grade/gender from parseGroupName', async () => {
    const { svc, link } = await setup();
    const body = fx('push-groups.json');
    body.rows[1] = { ...body.rows[1], name: 'Mixed Youth Group' }; // a copy in memory; the file is untouched
    await svc.push('groups', body);
    const groups = await link.groups();
    expect(groups.find((g) => g.groupId === body.rows[0].groupId)).toMatchObject({ grade: 9, gender: 'female' });
    expect(groups.find((g) => g.groupId === body.rows[1].groupId)).toMatchObject({ grade: null, gender: null });
  });

  it('roster → autoMatch against students.findAll(); reply matches push-response.json[0]', async () => {
    const { svc, link, students } = await setup();
    await students.save({ id: 's-alex', firstName: 'Alex', lastName: 'Sample', gender: 'male', grade: 9 } as any);
    await students.save({ id: 's-jamie', firstName: 'Jamie', lastName: 'Test', gender: 'female', grade: 9 } as any);
    await students.save({ id: 's-other', firstName: 'Nobody', lastName: 'Here', gender: 'male', grade: 8 } as any);
    const reply = await svc.push('roster', fx('push-roster.json'));
    expect(PushResponse.parse(reply)).toBeTruthy();
    expect(reply).toEqual(pushRes[0]);
    const roster = await link.roster();
    expect(roster.find((r) => r.firstName === 'Alex')).toMatchObject({ studentId: 's-alex', match: 'auto' });
    expect(roster.find((r) => r.firstName === 'Jamie')).toMatchObject({ studentId: 's-jamie', match: 'auto' });
    expect(roster.find((r) => r.firstName === 'Casey')).toMatchObject({ studentId: null, match: 'none' });
  });

  it("2026-10-14: a matched student takes Elvanto's gender when name + grade agree, on every push", async () => {
    const { svc, students } = await setup();
    await students.save({ id: 's-jamie', firstName: 'Jamie', lastName: 'Test', gender: 'other', grade: 9 } as any);
    await svc.push('roster', fx('push-roster.json'));
    expect(await students.findById('s-jamie')).toMatchObject({ gender: 'female', quad: 'g79' });
    await students.save({ ...(await students.findById('s-jamie'))!, gender: 'other' }); // already matched: next push fixes it
    await svc.push('roster', { ...fx('push-roster.json'), takenAt: '2026-10-16T09:30:00.000Z' });
    expect((await students.findById('s-jamie'))!.gender).toBe('female');
  });

  it('roster: an ambiguous name is counted', async () => {
    const { svc, students } = await setup();
    await students.save({ id: 's-a1', firstName: 'Alex', lastName: 'Sample', gender: 'male', grade: 9 } as any);
    await students.save({ id: 's-a2', firstName: 'Alex', lastName: 'Sample', gender: 'male', grade: 9 } as any); // same grade: no tie-break (B16)
    expect(await svc.push('roster', fx('push-roster.json'))).toEqual({ applied: true, rows: 4, matched: { auto: 0, ambiguous: 1 } });
  });

  it('B16: grade breaks the tie when exactly one same-name student has the roster grade', async () => {
    const { svc, students } = await setup();
    await students.save({ id: 's-a1', firstName: 'Alex', lastName: 'Sample', gender: 'male', grade: 9 } as any);
    await students.save({ id: 's-a2', firstName: 'Alex', lastName: 'Sample', gender: 'male', grade: 10 } as any);
    expect(await svc.push('roster', fx('push-roster.json'))).toEqual({ applied: true, rows: 4, matched: { auto: 1, ambiguous: 0 } });
  });

  it('an unknown :kind → SyncValidation (400), nothing applied', async () => {
    const { svc, link } = await setup();
    await expect(svc.push('people', fx('push-roster.json'))).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
    await expect(svc.push('__proto__', fx('push-roster.json'))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await link.mirrorState()).toEqual([]);
  });
});

describe('UX batch 2026-10-12 (T1 linkRev, T2 grade 6, T4 flow fields, T6 prune, T8 history)', () => {
  const later = (b: any, takenAt: string) => ({ ...b, takenAt });
  it('X-1: a console below rev 12 (missing = 1) is refused 409 LINK_CONTRACT_MISMATCH before the heartbeat; 12 is stored', async () => {
    const { svc, link } = await setup();
    const { linkRev: _drop, ...noRev } = claimReq;
    for (const body of [noRev, { ...claimReq, linkRev: 11 }, { ...claimReq, linkRev: 1 }]) {
      await expect(svc.claim(body)).rejects.toMatchObject({ code: 'LINK_CONTRACT_MISMATCH', statusCode: 409 });
    }
    expect(await link.listConsoles()).toEqual([]);
    const ok = await svc.claim(claimReq);
    expect(ClaimResponse.parse(ok).linkRev).toBe(19);
    expect((await link.listConsoles())[0]!.linkRev).toBe(12);
  });
  it('X1 (rev 14): the claim reply carries site from ministryConfig (structure + elvanto prefixes); a rev 12 console still claims', async () => {
    const { svc, settings } = await setup();
    const reply = ClaimResponse.parse(await svc.claim({ ...claimReq, linkRev: 12 }));
    expect(reply.site).toEqual({ timeZone: 'Australia/Brisbane', serviceDay: 5, consentCutoff: '09:00', peopleFlowPrefix: '', consentFlowPrefix: '' });
    const cfg = (await settings.getSettings()).ministryConfig;
    await settings.updateSettings({ ministryConfig: { ...cfg,
      structure: { ...cfg.structure, timeZone: 'Australia/Sydney', serviceDayOfWeek: 3, consentCutoff: '17:30' },
      elvanto: { ...cfg.elvanto, peopleFlowPrefix: 'North - Youth - New People', consentFlowPrefix: 'North - Youth - Parent Consent' } } } as any);
    expect(ClaimResponse.parse(await svc.claim(claimReq)).site).toEqual({ timeZone: 'Australia/Sydney', serviceDay: 3, consentCutoff: '17:30',
      peopleFlowPrefix: 'North - Youth - New People', consentFlowPrefix: 'North - Youth - Parent Consent' });
  });
  it('rev 17: the claim reply carries modules mirroring config (legacy config inherits newYouthForms; connectionAudit false)', async () => {
    const { svc, settings } = await setup();
    const cfg = (await settings.getSettings()).ministryConfig;
    const { checkin, lifegroupReport, flows, ...legacy } = cfg.modules as any; // a config stored before the T10 split
    await settings.updateSettings({ ministryConfig: { ...cfg, modules: { ...legacy, newYouthForms: 'admin', intakeAdmin: 'on', lifegroups: false, connectionAudit: false } } } as any);
    expect(ClaimResponse.parse(await svc.claim(claimReq)).modules).toEqual({ checkin: 'admin', lifegroupReport: 'admin', flows: 'admin', newYouthForms: 'admin',
      intakeAdmin: 'on', lifegroups: false, connectionAudit: false });
  });
  it('T2: a roster push with a grade-6 student is applied', async () => {
    const { svc, link } = await setup();
    const b = fx('push-roster.json');
    b.rows[0].grade = 6;
    expect((await svc.push('roster', b)).applied).toBe(true);
    expect((await link.roster()).find((r) => r.personId === b.rows[0].personId)!.grade).toBe(6);
  });
  it('T8: groups keep the pushed history (none = [])', async () => {
    const { svc, link } = await setup();
    const b = fx('push-groups.json');
    const lr = b.rows[0].lastReport;
    b.rows[0].history = [lr];
    await svc.push('groups', b);
    const gs = await link.groups();
    expect(gs.find((g) => g.groupId === b.rows[0].groupId)!.history).toEqual([lr]);
    expect(gs.find((g) => g.groupId === b.rows[1].groupId)!.history).toEqual([]);
  });
  it('T4: flows keep grade, gender, mobile, mobileIsParent (absent = null/false)', async () => {
    const { svc, link } = await setup();
    const b = fx('push-flows.json');
    Object.assign(b.rows[0], { grade: 8, gender: 'male', mobile: '0412345678', mobileIsParent: true });
    await svc.push('flows', b);
    const fs = await link.flows();
    expect(fs.find((f) => f.rowId === b.rows[0].rowId)).toMatchObject({ grade: 8, gender: 'male', mobile: '0412345678', mobileIsParent: true });
    expect(fs.find((f) => f.rowId === b.rows[1].rowId)).toMatchObject({ grade: null, gender: null, mobile: null, mobileIsParent: false });
  });
  it('T6: a flows push drops the assignments of people no longer in that flow, keeps the rest', async () => {
    const { svc, link } = await setup();
    const b = fx('push-flows.json');
    const flowId = b.rows[0].flowId as string;
    const kept = b.rows[0].personId as string;
    const gone = 'ee000000-0000-4000-8000-000000000001';
    const leaderId = 'ee000000-0000-4000-8000-0000000000aa';
    await svc.push('flows', b);
    await link.setFlowAssign({ flowId, personId: kept, leaderId, assignedBy: 'admin' });
    await link.setFlowAssign({ flowId, personId: gone, leaderId, assignedBy: 'admin' });
    await svc.push('flows', later(b, '2026-10-16T09:30:00.000Z'));
    expect((await link.flowAssignments()).map((a) => a.personId)).toEqual([kept]);
    await link.setFlowAssign({ flowId, personId: kept, leaderId: null, assignedBy: 'admin' });
    expect(await link.flowAssignments()).toEqual([]);
  });
});

describe('UX batch 2026-10-14b (rev 5)', () => {
  it('T8: POST /sync/leaders answers the names of the active leaders (version checked first)', async () => {
    const { link, settings, students, users } = await setup();
    const leaders = new InMemoryLeaderRepository();
    const L = (id: string, fullName: string, active: boolean) => ({ id, fullName, active, grade: null, gender: null }) as never;
    await leaders.save(L('l1', ' Sam Lee ', true)); await leaders.save(L('l2', 'Old Leader', false));
    const svc = makeSyncService({ link, settings, students, users, leaders });
    expect(await svc.leaders({ contractVersion: 1, consoleId: claimReq.consoleId })).toEqual({ contractVersion: 1, names: ['Sam Lee'] });
    await expect(svc.leaders({ contractVersion: 2, consoleId: claimReq.consoleId })).rejects.toMatchObject({ code: 'LINK_CONTRACT_MISMATCH' });
  });
  it('T12: a flows push keeps its optional steps; a push without them stores none', async () => {
    const { svc, link } = await setup();
    const body = fx('push-flows.json'), r = body.rows[0];
    const steps = [{ flowId: r.flowId, flowName: r.flowName, stepId: r.stepId, stepName: r.stepName, stepOrder: 1 }];
    expect((await svc.push('flows', { ...body, steps })).applied).toBe(true);
    expect(await link.flowSteps()).toEqual(steps);
    await svc.push('flows', { ...body, takenAt: '2026-10-16T09:30:00.000Z' });
    expect(await link.flowSteps()).toBeNull();
  });
});

describe('rematchRoster', () => {
  it('rematchRoster matches a new student without a push', async () => {
    const { svc, link, students } = await setup();
    await svc.push('roster', fx('push-roster.json'));
    const before = (await link.roster()).filter((r) => r.match === 'none').length;
    const r0 = (await link.roster()).find((r) => r.match === 'none' && r.kind === 'student')!;
    await students.save({ id: 's-new', firstName: r0.firstName, lastName: r0.lastName, gender: r0.gender, grade: r0.grade } as any);
    await rematchRoster(link, students);
    expect((await link.roster()).filter((r) => r.match === 'none').length).toBe(before - 1);
  });
});

describe('sync.service push audit (rev 16, spec 2026-10-22 §3)', () => {
  it("push('audit') is routed to ingest with by 'console'; a Zod failure never reaches it; no mirror is written", async () => {
    const { link, settings, users, students } = await setup();
    const ingest = vi.fn(async () => ({ applied: true, source: 'service' as const, status: 'stored' as const }));
    const svc = makeSyncService({ link, settings, students, users, audit: { ingest } });
    const body = fx('push-audit-service.json');
    expect(await svc.push('audit', body)).toEqual({ applied: true, source: 'service', status: 'stored' });
    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({ source: 'service', status: 'ok', takenAt: body.takenAt }), 'console');
    await expect(svc.push('audit', { ...body, rows: [['short']] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
    await expect(svc.push('audit', { ...body, contractVersion: 2 })).rejects.toMatchObject({ code: 'LINK_CONTRACT_MISMATCH' });
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(await link.mirrorState()).toEqual([]);
  });
  it('without the audit dep the push is not applied (test constructors)', async () => {
    const { svc } = await setup();
    expect(await svc.push('audit', fx('push-audit-failed.json'))).toEqual({ applied: false });
  });
  it('container: a console audit push lands in the store (wiring)', async () => {
    const c = await buildContainer();
    const r = await c.services.sync.push('audit', fx('push-audit-group.json'));
    expect(r).toMatchObject({ source: 'group', status: 'stored' });
  });
});

describe('sync.service bus consent (rev 18, spec 2026-10-22 bus consent)', () => {
  const BCC: NewOutboxRow = { id: 'b5c00000-0000-4000-8000-000000000001', type: 'busConsentCheck', payload: {}, note: null, dedupeKey: 'bcc',
    serviceDate: '2026-10-23', studentId: null, personId: null, createdBy: CREATOR, leaderId: null, leaderName: 'Pat Leader' };
  const req18 = { ...claimReq, linkRev: 18, max: 5, capabilities: { ...claimReq.capabilities, busConsentCheck: 'live' } };
  it('a busConsentForms push parses and calls deps.busConsent with the parsed body; a bad body never reaches it', async () => {
    const { link, settings, users, students } = await setup();
    const reply = { applied: true, rows: 2, new: 2, unmatched: 1 };
    const busConsent = vi.fn(async () => reply);
    const svc = makeSyncService({ link, settings, students, users, busConsent });
    const body = fx('push-bus-consent-forms.json');
    expect(await svc.push('busConsentForms', body)).toEqual(reply);
    expect(busConsent).toHaveBeenCalledWith(body);
    await expect(svc.push('busConsentForms', { ...body, rows: [{ ...body.rows[0], extra: 1 }] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(busConsent).toHaveBeenCalledTimes(1);
    expect(await link.mirrorState()).toEqual([]);
  });
  it('without the dep the push is not applied, in the strict response shape (F12)', async () => {
    const { svc } = await setup();
    expect(await svc.push('busConsentForms', fx('push-bus-consent-forms.json'))).toEqual({ applied: false, rows: 0, new: 0, unmatched: 0 });
  });
  it('every link screen off but the Bus module on: the claim leases (max > 0) the busConsentCheck row', async () => {
    const { svc, link } = await setup({ mode: 'off', modules: { busMinistry: true as any } });
    await link.insertAction(BCC);
    const reply = await svc.claim(req18);
    expect(reply.rows.map((r) => r.type)).toEqual(['busConsentCheck']);
  });
  it('fix round 1: every link screen off, Bus on: a queued checkIn is not leased (stop button holds); only busConsentCheck stays listed', async () => {
    const { svc, link } = await setup({ mode: 'off', modules: { busMinistry: true as any } });
    await link.insertAction(rowFromFixture(claimRes.rows.find((r: any) => r.type === 'checkIn')));
    await link.insertAction(BCC);
    const reply = await svc.claim(req18);
    expect(reply.rows.map((r) => r.type)).toEqual(['busConsentCheck']);
    expect(Object.keys((await link.listConsoles())[0]!.capabilities)).toEqual(['busConsentCheck']);
  });
  it('fix round 1: screens off, Bus on, intake on: the intake/consent capabilities stay listed too', async () => {
    const { svc, link } = await setup({ mode: 'off', modules: { busMinistry: true as any, intakeAdmin: 'on' } });
    await svc.claim({ ...req18, capabilities: { ...req18.capabilities, intakeAnswer: 'live', consentLookup: 'live' } });
    expect(Object.keys((await link.listConsoles())[0]!.capabilities).sort()).toEqual(['busConsentCheck', 'consentLookup', 'intakeAnswer']);
  });
  it('Bus module off: the claim strips busConsentCheck from the stored capabilities and never leases it', async () => {
    const { svc, link } = await setup({ modules: { busMinistry: false as any } });
    await link.insertAction(BCC);
    const reply = await svc.claim(req18);
    expect(reply.rows.map((r) => r.type)).not.toContain('busConsentCheck');
    expect((await link.listConsoles())[0]!.capabilities.busConsentCheck).toBeUndefined();
    expect((await link.listConsoles())[0]!.capabilities.checkIn).toBe('live');
  });
  it('container: a console bus consent push lands in the store (wiring)', async () => {
    const c = await buildContainer();
    const r = await c.services.sync.push('busConsentForms', fx('push-bus-consent-forms.json'));
    expect(r).toMatchObject({ applied: true, rows: 2, new: 2 });
  });
});

// ---------------- 2026-10-24 (plan Task 4): consentFix "missing field" refusals ----------------

describe('sync.service result: consentFix missing-field refusals (fix-no-date / fix-no-total)', () => {
  // Byte for byte from 11.1 src/ys-link.js FIX_SHAPE (fix-no-date, fix-no-total, fix-no-date-moved, fix-no-total-moved).
  const SHAPES = [
    "Not sent: this person's Elvanto profile has no consent date field, so the console can't copy the form. Change it in Elvanto.",
    "Not sent: this person's Elvanto profile has no TOTAL non-consent date field, so the console can't copy the form. Change it in Elvanto.",
    "Not sent: this person is now in New People in Elvanto, but their profile still has no consent date field, so the console can't copy the form. Change it in Elvanto.",
    "Not sent: this person is now in New People in Elvanto, but their profile still has no TOTAL non-consent date field, so the console can't copy the form. Change it in Elvanto.",
  ];
  const rid = (n: number) => `0c000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  function mk(types: Record<string, string>) {
    const record = vi.fn(async () => {});
    const link = {
      applyResults: async (_c: string, res: { id: string }[]) => ({ applied: res.map((r) => r.id), ignored: [] }),
      getAction: async (id: string) => (types[id] ? { id, type: types[id] } : null),
    };
    const svc = makeSyncService({ link: link as any, settings: new InMemorySettingsRepository(), students: new InMemoryStudentRepository(),
      users: new InMemoryUserRepository(), errorLog: { record } } as any);
    return { svc, record };
  }
  it('date texts record fix-no-date, TOTAL texts fix-no-total (never fix-no-date), -moved too', async () => {
    const types = Object.fromEntries([1, 2, 3, 4, 5].map((n) => [rid(n), 'consentFix']));
    const { svc, record } = mk(types);
    await svc.result({ contractVersion: 1, consoleId: CONSOLE, results: [
      ...SHAPES.map((detail, i) => ({ id: rid(i + 1), outcome: 'refused', reason: 'unknown', detail })),
      { id: rid(5), outcome: 'refused', reason: 'unknown', detail: SHAPES[0] },
    ] });
    expect(record.mock.calls.map((c: any) => c[0])).toEqual([
      { category: 'link', code: 'fix-no-date', route: 'consentFix', role: 'console', count: 3 },
      { category: 'link', code: 'fix-no-total', route: 'consentFix', role: 'console', count: 2 },
    ]);
  });
  it('a consentFix unknown with another detail or none, or another type with that detail, stays unknown', async () => {
    const { svc, record } = mk({ [rid(1)]: 'consentFix', [rid(2)]: 'consentFix', [rid(3)]: 'consentSave' });
    await svc.result({ contractVersion: 1, consoleId: CONSOLE, results: [
      { id: rid(1), outcome: 'refused', reason: 'unknown', detail: 'Something else.' },
      { id: rid(2), outcome: 'refused', reason: 'unknown' },
      { id: rid(3), outcome: 'refused', reason: 'unknown', detail: SHAPES[0] },
    ] });
    expect(record.mock.calls).toEqual([
      [{ category: 'link', code: 'unknown', route: 'consentFix', role: 'console', count: 2 }],
      [{ category: 'link', code: 'unknown', route: 'consentSave', role: 'console', count: 1 }],
    ]);
  });
});

// ---------------- D1 (2026-10-24, ruling e): the Error log sweep runs at the end of a link sync ----------------

describe('sync.service: the error-log sweep (D1, ruling e)', () => {
  const rid = (n: number) => `0d000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const checkIn = (n: number): NewOutboxRow => {
    const payload = { serviceTimeId: claimRes.rows[0].payload.serviceTimeId, serviceId: claimRes.rows[0].payload.serviceId,
      personId: `9e000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}` };
    return rowFromFixture({ id: rid(n), type: 'checkIn', payload, note: null, serviceDate: '2026-10-23', by: { leaderName: 'Test Leader' } });
  };
  async function mk(sweep: () => Promise<void>) {
    const { link, settings, users, students } = await setup();
    const clock = { now: new Date() };
    const record = vi.fn(async () => {});
    const sw = vi.fn(sweep);
    const svc = makeSyncService({ link, settings, students, users, now: () => clock.now, errorLog: { record, sweep: sw } });
    return { link, svc, record, sw, clock };
  }

  it('result() runs the sweep after recording', async () => {
    const { link, svc, record, sw } = await mk(async () => {});
    await link.insertAction(checkIn(1));
    await svc.claim({ ...claimReq, max: 5 });
    sw.mockClear();
    await svc.result({ contractVersion: 1, consoleId: CONSOLE, results: [{ id: rid(1), outcome: 'refused', reason: 'person-unknown' }] });
    expect(sw).toHaveBeenCalledTimes(1);
    expect(record.mock.invocationCallOrder[0]).toBeLessThan(sw.mock.invocationCallOrder[0]!);
  });
  it('a throwing sweep never fails the result', async () => {
    const { link, svc } = await mk(async () => { throw new Error('db down'); });
    await link.insertAction(checkIn(1));
    await svc.claim({ ...claimReq, max: 5 });
    await expect(svc.result({ contractVersion: 1, consoleId: CONSOLE, results: [{ id: rid(1), outcome: 'sent', sentLogKey: 'k1' }] })).resolves.toBeTruthy();
  });
  it('claim() runs the sweep at most once per 10 min', async () => {
    const { svc, sw, clock } = await mk(async () => {});
    await svc.claim(claimReq);
    await svc.claim(claimReq);
    expect(sw).toHaveBeenCalledTimes(1);
    clock.now = new Date(clock.now.getTime() + 10 * 60_000 + 1);
    await svc.claim(claimReq);
    expect(sw).toHaveBeenCalledTimes(2);
  });
  it('an unclear result writes no windowed unclear row', async () => {
    const { InMemoryErrorLogRepository } = await import('../repositories/in-memory/error-log.repository');
    const { makeErrorLogService } = await import('../services/error-log.service');
    const { link, settings, users, students } = await setup();
    const repo = new InMemoryErrorLogRepository();
    const errorLog = makeErrorLogService({ repo, link });
    const svc = makeSyncService({ link, settings, students, users, errorLog });
    await link.insertAction(checkIn(1));
    await svc.claim({ ...claimReq, max: 5 });
    await svc.result({ contractVersion: 1, consoleId: CONSOLE, results: [{ id: rid(1), outcome: 'unclear', sentLogKey: 'k1', detail: 'x' }] });
    expect(await repo.list()).toMatchObject([{ category: 'link', code: 'unclear', route: 'checkIn', count: 1, foldKey: null }]);
  });
  it('a swept lease-lost writes no windowed row; the sweep counts it', async () => {
    const { InMemoryErrorLogRepository } = await import('../repositories/in-memory/error-log.repository');
    const { makeErrorLogService } = await import('../services/error-log.service');
    const { link, settings, users, students } = await setup();
    const repo = new InMemoryErrorLogRepository();
    const errorLog = makeErrorLogService({ repo, link });
    const svc = makeSyncService({ link, settings, students, users, errorLog });
    await link.insertAction(checkIn(1));
    await svc.claim({ ...claimReq, max: 5 });
    link._backdate('link_outbox', rid(1), 'lease_until', new Date(Date.now() - 2 * 3_600_000).toISOString());
    await svc.claim({ ...claimReq, consoleId: '8f5a1c2e-0000-4000-8000-0000000000ff', max: 5 });
    expect((await link.getAction(rid(1)))?.reason).toBe('lease-lost');
    await errorLog.sweep();
    expect(await repo.list()).toMatchObject([{ category: 'link', code: 'lease-lost', route: 'checkIn', count: 1, foldKey: null }]);
  });
});
