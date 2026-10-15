import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import * as C from '../core/link-contract';

// Step 0 contract test (spec docs/superpowers/specs/2026-10-11-elvanto-link-contract.md, section 9).
// The fixtures are the source of truth; Project 11.1 keeps a byte copy in spike/fixtures/ys-link/.
// After any fixture change: bump LINK_CONTRACT_VERSION if the shape changed, regenerate the manifest from the repo root
//   node -e 'const fs=require("fs"),c=require("crypto"),d="src/tests/fixtures/elvanto-link/";const files={};for(const f of fs.readdirSync(d).filter(f=>f.endsWith(".json")&&f!=="manifest.json").sort())files[f]=c.createHash("sha256").update(JSON.stringify(JSON.parse(fs.readFileSync(d+f,"utf8")))).digest("hex");fs.writeFileSync(d+"manifest.json",JSON.stringify({contractVersion:1,files},null,2)+"\n")'
// and copy all 11 files into 11.1 in the same session (spec section 9 has the cp command).
const ROOT = join(__dirname, '..', '..');
const DIR = join(__dirname, 'fixtures', 'elvanto-link');
const load = (f: string): any => JSON.parse(readFileSync(join(DIR, f), 'utf8'));
// Hash the re-serialised JSON, never the raw bytes: core.autocrlf makes working copies CRLF while blobs are LF,
// and JSON.stringify(JSON.parse(x)) is identical for both.
const hash = (f: string) => createHash('sha256').update(JSON.stringify(load(f))).digest('hex');

describe('link contract: manifest', () => {
  const manifest = load('manifest.json');
  it('carries the contract version', () => expect(manifest.contractVersion).toBe(C.LINK_CONTRACT_VERSION));
  it('lists every fixture with its normalised sha256', () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== 'manifest.json').sort();
    expect(Object.keys(manifest.files).sort()).toEqual(files);
    for (const f of files) expect(manifest.files[f], f).toBe(hash(f));
  });
});

describe('link contract: draft SQL', () => {
  // The draft now lives in supabase/migrations/ as NNNN_elvanto_link.sql (0017, spec app-design §2.5).
  const MIG = join(ROOT, 'supabase', 'migrations');
  const matches = readdirSync(MIG).filter((f) => /^\d{4}_elvanto_link\.sql$/.test(f));
  const sql = matches.length === 1 ? readFileSync(join(MIG, matches[0]!), 'utf8') : '';
  it('exists exactly once in supabase/migrations', () => expect(matches).toHaveLength(1));
  it('adds report_id and the link_log index', () => {
    expect(sql).toContain('add column if not exists report_id uuid');
    expect(sql).toContain('create index if not exists link_log_at_idx');
  });
  it('enables RLS on every table it creates (by rule)', () => {
    const tables = [...sql.matchAll(/create table (?:if not exists )?(\w+)/gi)].map((m) => m[1]!);
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) expect(sql, t).toMatch(new RegExp(String.raw`alter table\s+${t}\s+enable row level security`, 'i'));
  });
});

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const rejects = (schema: z.ZodTypeAny, v: unknown) => expect(schema.safeParse(v).success).toBe(false);

const FIXTURES: Record<string, z.ZodTypeAny> = {
  'claim-request.json': C.ClaimRequest,
  'claim-response.json': C.ClaimResponse,
  'result-request.json': C.ResultRequest,
  'result-response.json': C.ResultResponse,
  'push-roster.json': C.PUSH_SCHEMAS.roster,
  'push-services.json': C.PUSH_SCHEMAS.services,
  'push-groups.json': C.PUSH_SCHEMAS.groups,
  'push-flows.json': C.PUSH_SCHEMAS.flows,
  'push-response.json': z.array(C.PushResponse).min(1),
  'errors.json': z.array(z.object({ status: z.number().int(), body: C.ErrorBody })).min(1),
  // X19 (T4)
  'push-intake.json': C.PUSH_SCHEMAS.intakePlan,
  'push-consent.json': C.PUSH_SCHEMAS.consentPlan,
  'claim-response-rev4.json': C.ClaimResponse,
  'result-request-intake.json': C.ResultRequest,
  'batch-intake.json': z.object({ device: z.object({ id: z.string(), label: z.string() }), sentAt: z.string().datetime(),
    items: z.array(z.union([z.object({ kind: z.literal('cancel'), id: z.string() }).strict(),
      z.object({ kind: z.literal('action'), id: z.string(), type: z.enum(C.INTAKE_TYPES), payload: z.record(z.unknown()),
        note: z.string().max(1900).nullable(), leaderId: z.null() }).strict()])).min(1) }).strict(),
  // Rev 6 (run 2026-10-15 lane A)
  'claim-request-rev6.json': C.ClaimRequest,
  'claim-response-rev6.json': C.ClaimResponse,
  'push-roster-rev6.json': C.PUSH_SCHEMAS.roster,
  'push-flows-rev6.json': C.PUSH_SCHEMAS.flows,
  'push-consent-lookup-forms.json': C.PUSH_SCHEMAS.consentLookup,
  'push-consent-lookup-mismatches.json': C.PUSH_SCHEMAS.consentLookup,
  'push-consent-lookup-unlinked.json': C.PUSH_SCHEMAS.consentLookup,
  'result-request-rev6.json': C.ResultRequest,
  'push-progress.json': C.PUSH_SCHEMAS.progress, // S5 (run 2026-10-15b)
};

describe('link contract: every fixture parses with its schema', () => {
  it('covers every fixture file', () => expect(Object.keys(FIXTURES).sort()).toEqual(Object.keys(load('manifest.json').files).sort()));
  for (const [f, schema] of Object.entries(FIXTURES)) it(f, () => { schema.parse(load(f)); });

  it('claim-response (+ claim-response-rev4, X19) has one row per action type; each payload parses with its type schema', () => {
    const rows = [...C.ClaimResponse.parse(load('claim-response.json')).rows, ...C.ClaimResponse.parse(load('claim-response-rev4.json')).rows,
      ...C.ClaimResponse.parse(load('claim-response-rev6.json')).rows];
    expect(rows.map((r) => r.type).sort()).toEqual([...C.ACTION_TYPES].sort());
    for (const r of rows) (C.PAYLOAD_SCHEMAS[r.type] as z.ZodTypeAny).parse(r.payload);
  });
  it('result-request (+ result-request-intake, X19) has every outcome', () => {
    const outcomes = new Set([...C.ResultRequest.parse(load('result-request.json')).results,
      ...C.ResultRequest.parse(load('result-request-intake.json')).results].map((r) => r.outcome));
    expect([...outcomes].sort()).toEqual([...C.OUTCOMES].sort());
  });
  it('errors.json is the section 3.1 set', () => {
    const errs = load('errors.json') as { status: number; body: { code: string } }[];
    expect(errs.map((e) => `${e.status} ${e.body.code}`).sort()).toEqual(['400 VALIDATION_ERROR', '401 UNAUTHORIZED',
      '409 LINK_CONTRACT_MISMATCH', '503 LINK_OFF', '503 REQUEST_TIMEOUT', '503 SERVICE_UNAVAILABLE']);
    expect([...new Set(errs.map((e) => e.body.code))].sort()).toEqual([...C.SYNC_ERROR_CODES].sort());
  });
});

describe('link contract: bad requests are rejected', () => {
  const REQUESTS: [string, z.ZodTypeAny][] = [
    ['claim-request.json', C.ClaimRequest], ['result-request.json', C.ResultRequest],
    ['push-roster.json', C.PUSH_SCHEMAS.roster], ['push-services.json', C.PUSH_SCHEMAS.services],
    ['push-groups.json', C.PUSH_SCHEMAS.groups], ['push-flows.json', C.PUSH_SCHEMAS.flows],
  ];
  for (const [f, schema] of REQUESTS) {
    it(`${f}: missing or other contractVersion, non-uuid or upper-case consoleId`, () => {
      const missing = clone(load(f)); delete missing.contractVersion; rejects(schema, missing);
      rejects(schema, { ...load(f), contractVersion: 2 });
      rejects(schema, { ...load(f), consoleId: 'not-a-uuid' });
      rejects(schema, { ...load(f), consoleId: load(f).consoleId.toUpperCase() });
    });
  }
  it('unknown types, outcomes, capabilities and kinds are rejected', () => {
    const claim = clone(load('claim-request.json')); claim.capabilities.bogus = 'live'; rejects(C.ClaimRequest, claim);
    const result = clone(load('result-request.json')); result.results[0].outcome = 'bogus'; rejects(C.ResultRequest, result);
    const rows = clone(load('claim-response.json')); rows.rows[0].type = 'bogus'; rejects(C.ClaimResponse, rows);
    const roster = clone(load('push-roster.json')); roster.rows[0].kind = 'bogus'; rejects(C.PUSH_SCHEMAS.roster, roster);
  });
  it('B16: a roster lastName is trimmed', () => {
    const roster = clone(load('push-roster.json'));
    roster.rows[0].lastName = '  Sample  ';
    expect(C.PUSH_SCHEMAS.roster.parse(roster).rows[0]!.lastName).toBe('Sample');
  });
  it('a push over 5,000 rows is rejected', () => {
    const roster = load('push-roster.json');
    rejects(C.PUSH_SCHEMAS.roster, { ...roster, rows: Array(5001).fill(roster.rows[0]) });
  });
  it('a payload with an extra field, or did-not-meet with attendees, is rejected', () => {
    const p = load('claim-response.json').rows.find((r: any) => r.type === 'submitReport').payload;
    rejects(C.PAYLOAD_SCHEMAS.submitReport, { ...p, phone: '0400 000 000' });
    rejects(C.PAYLOAD_SCHEMAS.submitReport, { ...p, didNotMeet: true });
  });
  it('a report payload must say which service (null = none), and did-not-meet means no service', () => {
    const rows = load('claim-response.json').rows;
    const p = rows.find((r: any) => r.type === 'submitReport').payload;
    const { serviceTimeId, ...noService } = p;
    expect(serviceTimeId).toMatch(/^[0-9a-f-]{36}$/);
    rejects(C.PAYLOAD_SCHEMAS.submitReport, noService);
    C.PAYLOAD_SCHEMAS.submitReport.parse({ ...p, serviceTimeId: null });
    C.PAYLOAD_SCHEMAS.submitReport.parse({ ...p, didNotMeet: true, attendees: [], serviceTimeId: null });
    rejects(C.PAYLOAD_SCHEMAS.submitReport, { ...p, didNotMeet: true, attendees: [] });
    const e = rows.find((r: any) => r.type === 'editReport').payload;
    const { serviceTimeId: _s, ...baseNoService } = e.base;
    rejects(C.PAYLOAD_SCHEMAS.editReport, { ...e, base: baseNoService });
  });
});

describe('link contract: decisions 2026-10-12', () => {
  it('the services push carries a recent past service (check-ins and reports may pick one)', () => {
    const push = C.PUSH_SCHEMAS.services.parse(load('push-services.json'));
    const today = push.takenAt.slice(0, 10);
    expect(push.rows.some((r) => r.ymd < today)).toBe(true);
  });
  it('check-out is on: the console reports it locked until its writer exists, never off', () => {
    expect(C.ClaimRequest.parse(load('claim-request.json')).capabilities.checkOut).toBe('locked');
    expect(C.REASONS).not.toContain('pick-service' as never);
  });
});

describe('UX batch 2026-10-12 additions (T1): all optional, LINK_CONTRACT_VERSION stays 1', () => {
  it('LINK_REV is 4 (T1 made it 2, X18 3, X19 4) and the contract version is still 1 (old fixtures above still parse)', () => {
    expect(C.LINK_REV).toBe(6); // 2026-10-14b: rev 5 = /sync/leaders + flows push steps; 2026-10-15: rev 6 = consent + 3 types
    expect(C.LINK_CONTRACT_VERSION).toBe(1);
  });
  it('claim: linkRev is an optional int >= 1 both ways', () => {
    expect(C.ClaimRequest.parse(load('claim-request.json')).linkRev).toBeUndefined();
    expect(C.ClaimRequest.parse({ ...load('claim-request.json'), linkRev: 2 }).linkRev).toBe(2);
    rejects(C.ClaimRequest, { ...load('claim-request.json'), linkRev: 0 });
    rejects(C.ClaimRequest, { ...load('claim-request.json'), linkRev: 1.5 });
    expect(C.ClaimResponse.parse({ ...load('claim-response.json'), linkRev: 2 }).linkRev).toBe(2);
  });
  it('T2: grade is 6..12 (a grade-6 roster row no longer rejects the whole push)', () => {
    const roster = clone(load('push-roster.json'));
    roster.rows[0].grade = 6;
    expect(C.PUSH_SCHEMAS.roster.parse(roster).rows[0]!.grade).toBe(6);
    roster.rows[0].grade = 5; rejects(C.PUSH_SCHEMAS.roster, roster);
    roster.rows[0].grade = 13; rejects(C.PUSH_SCHEMAS.roster, roster);
  });
  it('T3: a checked-in item may carry firstName/lastName (<= 60), kept by the parse', () => {
    const svc = clone(load('push-services.json'));
    svc.rows[0].checkedIn[0] = { ...svc.rows[0].checkedIn[0], firstName: 'Jamie', lastName: 'Test' };
    expect(C.PUSH_SCHEMAS.services.parse(svc).rows[0]!.checkedIn[0]).toMatchObject({ firstName: 'Jamie', lastName: 'Test' });
    // too long: cut to 60 instead of refusing the whole push
    svc.rows[0].checkedIn[0].lastName = 'x'.repeat(61); svc.rows[0].checkedIn[0].firstName = 'y'.repeat(200);
    const cut = C.PUSH_SCHEMAS.services.parse(svc).rows[0]!.checkedIn[0]!;
    expect(cut.lastName).toBe('x'.repeat(60)); expect(cut.firstName).toBe('y'.repeat(60));
  });
  it('T8: a group may carry history, at most 8, each shaped like lastReport', () => {
    const groups = clone(load('push-groups.json'));
    const lr = groups.rows[0].lastReport;
    groups.rows[0].history = [lr, { ...lr, reportId: '7e000000-0000-4000-8000-000000000009', date: '2026-10-05' }];
    expect(C.PUSH_SCHEMAS.groups.parse(groups).rows[0]!.history).toHaveLength(2);
    // more than 8: the newest 8 (newest first) are kept instead of refusing the whole push
    groups.rows[0].history = Array.from({ length: 10 }, (_, i) => ({ ...lr, date: `2026-10-${String(20 - i).padStart(2, '0')}` }));
    const kept = C.PUSH_SCHEMAS.groups.parse(groups).rows[0]!.history!;
    expect(kept).toHaveLength(8); expect(kept[0]!.date).toBe('2026-10-20'); expect(kept[7]!.date).toBe('2026-10-13');
    groups.rows[0].history = [{ ...lr, editable: undefined }]; rejects(C.PUSH_SCHEMAS.groups, groups);
  });
  it('T4: a flow row may carry grade, gender, a bare-digit mobile and mobileIsParent', () => {
    const flows = clone(load('push-flows.json'));
    Object.assign(flows.rows[0], { grade: 6, gender: 'female', mobile: '0412345678', mobileIsParent: true });
    expect(C.PUSH_SCHEMAS.flows.parse(flows).rows[0]).toMatchObject({ grade: 6, gender: 'female', mobile: '0412345678', mobileIsParent: true });
    Object.assign(flows.rows[1], { grade: null, gender: null, mobile: null });
    C.PUSH_SCHEMAS.flows.parse(flows);
    flows.rows[0].mobile = '0412 345 678'; rejects(C.PUSH_SCHEMAS.flows, flows);
  });
});

describe('X18 (UX batch 2026-10-13 T6): lifegroup member changes, optional for an older console', () => {
  const CR = () => clone(load('claim-request.json'));
  it('an older console that lists neither member type still parses (missing = it cannot do them)', () => {
    const old = CR(); delete old.capabilities.addGroupMember; delete old.capabilities.removeGroupMember;
    const caps = C.ClaimRequest.parse(old).capabilities;
    expect(caps.addGroupMember).toBeUndefined(); expect(caps.removeGroupMember).toBeUndefined();
  });
  it('the new console lists both; a bad value is rejected', () => {
    expect(C.ClaimRequest.parse(CR()).capabilities).toMatchObject({ addGroupMember: 'live', removeGroupMember: 'live' });
    const bad = CR(); bad.capabilities.addGroupMember = 'maybe'; rejects(C.ClaimRequest, bad);
  });
  it('payload is exactly { groupId, personId } (lower-case uuids, nothing else)', () => {
    const rows = load('claim-response.json').rows;
    for (const t of ['addGroupMember', 'removeGroupMember'] as const) {
      const p = rows.find((r: any) => r.type === t).payload;
      expect(Object.keys(p).sort()).toEqual(['groupId', 'personId']);
      rejects(C.PAYLOAD_SCHEMAS[t], { ...p, name: 'Amy' });
      rejects(C.PAYLOAD_SCHEMAS[t], { ...p, personId: p.personId.toUpperCase() });
      rejects(C.PAYLOAD_SCHEMAS[t], { groupId: p.groupId });
    }
  });
  it('the two new refusal reasons parse in a result', () => {
    for (const reason of ['group-unknown', 'leader-member']) {
      C.ResultItem.parse({ id: '0a000000-0000-4000-8000-000000000007', outcome: 'refused', reason });
    }
  });
});

describe('X19 (UX batch 2026-10-13 T4): intake + consents, optional for an older console', () => {
  const CR = () => clone(load('claim-request.json'));
  const PI = () => clone(load('push-intake.json'));
  const MIG = join(ROOT, 'supabase', 'migrations', '0021_link_intake.sql');
  it('a claim without the intake capability keys still parses; with them each must be a capability', () => {
    expect(C.ClaimRequest.parse(CR()).capabilities.intakeSave).toBeUndefined();
    const caps = { ...CR(), capabilities: { ...CR().capabilities, intakeAnswer: 'live', intakeSave: 'shadow', consentSave: 'shadow', intakeText: 'locked' } };
    expect(C.ClaimRequest.parse(caps).capabilities).toMatchObject({ intakeAnswer: 'live', intakeText: 'locked' });
    caps.capabilities.intakeSave = 'maybe'; rejects(C.ClaimRequest, caps);
  });
  it('the claim reply may carry the intake hint (mode off/on only, at most 4 refresh dates); without it an older reply parses', () => {
    const r = C.ClaimResponse.parse(load('claim-response-rev4.json'));
    expect(r.intake).toEqual({ mode: 'on', hurry: true, refresh: [{ mode: 'intake', date: '2026-10-16' }] });
    expect(C.ClaimResponse.parse(load('claim-response.json')).intake).toBeUndefined();
    rejects(C.ClaimResponse, { ...r, intake: { ...r.intake, mode: 'shadow' } });
    rejects(C.ClaimResponse, { ...r, intake: { ...r.intake, refresh: Array(5).fill(r.intake!.refresh[0]) } });
  });
  it('review fixes: a Suburb diff entry must be blank; row keys are unique within a push (400, not a 500)', () => {
    const sub = JSON.parse(JSON.stringify(PI()).replace('"label":"Suburb","a":""', '"label":"Suburb","a":"Carindale"'));
    expect(JSON.stringify(sub)).toContain('Carindale');
    rejects(C.PUSH_SCHEMAS.intakePlan, sub);
    const dupI = PI(); dupI.rows.push(clone(dupI.rows[0])); rejects(C.PUSH_SCHEMAS.intakePlan, dupI);
    const dupC = clone(load('push-consent.json')); dupC.rows.push(clone(dupC.rows[0])); rejects(C.PUSH_SCHEMAS.consentPlan, dupC);
  });
  it('intake push: strict, no suburb / address / email anywhere (an unknown key rejects the push)', () => {
    const raw = readFileSync(join(DIR, 'push-intake.json'), 'utf8') + readFileSync(join(DIR, 'push-consent.json'), 'utf8');
    expect(raw).not.toMatch(/suburb"\s*:|address|email/i);
    const bads: ((x: any) => void)[] = [
      (x) => { x.rows[0].forms.student.values.suburb = 'Carindale'; },
      (x) => { x.rows[0].forms.student.edits.suburb = 'Carindale'; },
      (x) => { x.rows[0].email = 'a@b.c'; },
      (x) => { x.rows[0].steps[0].extra = 1; },
      (x) => { x.rows[0].links[0][1] = 'http://evil.example'; },
      (x) => { x.rows[0].status = 'maybe'; },
    ];
    for (const bad of bads) { const x = PI(); bad(x); rejects(C.PUSH_SCHEMAS.intakePlan, x); }
    rejects(C.PUSH_SCHEMAS.intakePlan, { ...PI(), rows: Array(101).fill(PI().rows[0]) });
  });
  it('intake push: an over-long string is cut, not refused', () => {
    const x = PI(); x.rows[0].title = 'x'.repeat(500); x.rows[0].holds[0].text = 'y'.repeat(500);
    const row = C.PUSH_SCHEMAS.intakePlan.parse(x).rows[0]!;
    expect(row.title).toHaveLength(120); expect(row.holds[0]!.text).toHaveLength(200);
  });
  it('batch-intake: each action payload parses with its type schema; the answer note is an IntakeNote under 1,900', () => {
    const items = load('batch-intake.json').items.filter((i: any) => i.kind === 'action');
    expect(items.map((i: any) => i.type).sort()).toEqual([...C.INTAKE_TYPES].sort());
    for (const it of items) {
      (C.PAYLOAD_SCHEMAS[it.type as 'intakeSave'] as z.ZodTypeAny).parse(it.payload);
      if (it.note) { expect(it.note.length).toBeLessThanOrEqual(1900); C.IntakeNote.parse(JSON.parse(it.note)); }
    }
  });
  it('payload rules: strict; intakeText key is the parent text; intakeSave one = exactly one key; family 1..2; fixes never suburb', () => {
    const rows = load('claim-response-rev4.json').rows;
    const p = (t: string) => clone(rows.find((r: any) => r.type === t).payload);
    rejects(C.PAYLOAD_SCHEMAS.intakeSave, { ...p('intakeSave'), phone: '0400' });
    rejects(C.PAYLOAD_SCHEMAS.intakeSave, { ...p('intakeSave'), one: true }); // two keys
    C.PAYLOAD_SCHEMAS.intakeSave.parse({ ...p('intakeSave'), one: true, confirmed: [p('intakeSave').confirmed[0]] });
    rejects(C.PAYLOAD_SCHEMAS.intakeText, { ...p('intakeText'), key: 'approve:student:x' });
    rejects(C.PAYLOAD_SCHEMAS.intakeAnswer, { ...p('intakeAnswer'), family: [] });
    rejects(C.PAYLOAD_SCHEMAS.consentSave, { ...p('consentSave'), confirmed: Array(5).fill('k') });
    rejects(C.IntakeNote, { fixes: { '5b000000-0000-4000-8000-000000000001': { suburb: 'Carindale' } }, keeps: {} });
  });
  it('results: steps/stop optional (an older result parses), planned has no extras, stop.text is cut to 200', () => {
    const items = C.ResultRequest.parse(load('result-request-intake.json')).results;
    expect(items.find((i) => i.outcome === 'planned')).toEqual({ id: '0a000000-0000-4000-8000-000000000101', outcome: 'planned' });
    const sent = clone(load('result-request-intake.json').results[1]);
    sent.stop.text = 'z'.repeat(300);
    expect((C.ResultItem.parse(sent) as any).stop.text).toHaveLength(200);
    sent.steps[0].outcome = 'bogus'; rejects(C.ResultItem, sent);
    for (const reason of ['needs-you', 'plan-changed', 'saved-before', 'chain-not-done', 'bad-answer']) {
      C.ResultItem.parse({ id: '0a000000-0000-4000-8000-000000000101', outcome: 'refused', reason });
    }
  });
  it('the app ref is YS- + 6 Crockford base32 characters', () => {
    expect(C.APP_REF_RE.test('YS-7K2M9Q')).toBe(true);
    for (const bad of ['YS-7K2M9', 'YS-7K2M9QQ', 'YS-ILOU00', 'ys-7k2m9q']) expect(C.APP_REF_RE.test(bad)).toBe(false);
  });
  it('0021: the type check lists every ACTION_TYPE; RLS on every table it creates; additive', () => {
    const sql = readFileSync(MIG, 'utf8');
    const check = sql.slice(sql.indexOf('add constraint link_outbox_type_check'), sql.indexOf('));') + 2);
    const REV6: string[] = ['removeFromFlowStep', 'consentLookup', 'consentFix', 'consentLink'];
    expect([...check.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort()).toEqual(C.ACTION_TYPES.filter((t) => !REV6.includes(t)).sort());
    const sql27 = readFileSync(join(ROOT, 'supabase', 'migrations', '0027_link_rev6.sql'), 'utf8');
    const at27 = sql27.indexOf('add constraint link_outbox_type_check'), check27 = sql27.slice(at27, sql27.indexOf('));', at27) + 2);
    expect([...check27.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort()).toEqual(C.ACTION_TYPES.filter((t) => t !== 'consentLink').sort()); // 0027: every type then
    const sql31 = readFileSync(join(ROOT, 'supabase', 'migrations', '0031_link_consent_link.sql'), 'utf8');
    const at31 = sql31.indexOf('add constraint link_outbox_type_check'), check31 = sql31.slice(at31, sql31.indexOf('));', at31) + 2);
    expect([...check31.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort()).toEqual([...C.ACTION_TYPES].sort()); // 0031: every type
    expect(sql31).toMatch(/kind in \('forms','mismatches','unlinked'\)/);
    expect(sql31).not.toMatch(/\b(drop table|rename|alter column)\b/i);
    expect(sql27).toMatch(/alter table link_consent_lookup enable row level security/);
    expect(sql27).not.toMatch(/\b(drop table|rename|alter column)\b/i);
    const tables = [...sql.matchAll(/create table if not exists (\w+)/g)].map((m) => m[1]!);
    expect(tables).toEqual(['link_intake_dates', 'link_intake_rows', 'link_intake_view']);
    for (const t of tables) expect(sql).toMatch(new RegExp(`alter table ${t} enable row level security`));
    expect(sql).not.toMatch(/\b(drop table|rename|alter column)\b/i);
  });
});

describe('UX batch 2026-10-14b (rev 5): optional only', () => {
  it('T12: the flows push takes an optional steps list (the old fixture still parses)', () => {
    const body = clone(load('push-flows.json'));
    expect(C.PUSH_SCHEMAS.flows.parse(body).steps).toBeUndefined();
    const s = { flowId: body.rows[0].flowId, flowName: 'F', stepId: body.rows[0].stepId, stepName: 'S', stepOrder: 0 };
    expect(C.PUSH_SCHEMAS.flows.parse({ ...body, steps: [s] }).steps).toEqual([s]);
    rejects(C.PUSH_SCHEMAS.flows, { ...body, steps: [{ ...s, stepId: 'x' }] });
  });
  it('T8: leaders request is the envelope; the reply is names', () => {
    expect(C.LeadersRequest.parse({ contractVersion: 1, consoleId: load('claim-request.json').consoleId }).contractVersion).toBe(1);
    expect(C.LeadersResponse.parse({ contractVersion: 1, names: ['Sam Lee'] }).names).toEqual(['Sam Lee']);
  });
});

describe('link contract: rev 6 (R1 consent, R4 remove, R2 consent lookup / fix)', () => {
  it('roster and flow rows carry an optional consent flag; an unknown value is refused', () => {
    expect(C.PUSH_SCHEMAS.roster.parse(load('push-roster-rev6.json')).rows.map((r) => r.consent)).toEqual(['ok', 'contact', 'all', 'unknown']);
    C.PUSH_SCHEMAS.roster.parse(load('push-roster.json')); // an older console sends none
    const bad = clone(load('push-roster-rev6.json')); bad.rows[0].consent = 'maybe'; rejects(C.PUSH_SCHEMAS.roster, bad);
    const badF = clone(load('push-flows-rev6.json')); badF.rows[0].consent = 'no'; rejects(C.PUSH_SCHEMAS.flows, badF);
  });
  it('isDnc is contact or all only', () => {
    expect(['ok', 'contact', 'all', 'unknown', null, undefined].map((c) => C.isDnc(c))).toEqual([false, true, true, false, false, false]);
  });
  it('the three new payloads are strict', () => {
    rejects(C.PAYLOAD_SCHEMAS.removeFromFlowStep, { rowId: load('claim-response-rev6.json').rows[0].payload.rowId });
    rejects(C.PAYLOAD_SCHEMAS.consentLookup, { kind: 'forms', page: 0, ref: '0a000000-0000-4000-8000-000000000202' });
    rejects(C.PAYLOAD_SCHEMAS.consentLookup, { kind: 'forms', page: 1, ref: '0a000000-0000-4000-8000-000000000202', q: 'a name' });
    rejects(C.PAYLOAD_SCHEMAS.consentFix, { personId: '9e000000-0000-4000-8000-000000000003' });
  });
  it('L6: consentLink and the unlinked lookup kind', () => {
    const sub = '5c000000-0000-4000-8000-000000000002', person = '9e000000-0000-4000-8000-000000000003';
    C.PAYLOAD_SCHEMAS.consentLink.parse({ subId: sub, personId: person });
    C.PAYLOAD_SCHEMAS.consentLink.parse({ subId: sub, personId: null });
    rejects(C.PAYLOAD_SCHEMAS.consentLink, { subId: sub });
    rejects(C.PAYLOAD_SCHEMAS.consentLink, { subId: sub, personId: person, note: 'x' });
    C.PAYLOAD_SCHEMAS.consentLookup.parse({ kind: 'unlinked', page: 1, ref: '0a000000-0000-4000-8000-000000000202' });
    const u = clone(load('push-consent-lookup-unlinked.json')); u.rows[0].personId = person; rejects(C.PUSH_SCHEMAS.consentLookup, u);
    const v = clone(load('push-consent-lookup-unlinked.json')); v.rows[0].names = ['a', 'b', 'c', 'd', 'e']; rejects(C.PUSH_SCHEMAS.consentLookup, v);
    const w = clone(load('push-consent-lookup-unlinked.json')); w.kind = 'forms'; rejects(C.PUSH_SCHEMAS.consentLookup, w);
  });
  it('a consentLookup push is strict: unknown keys and a mismatch row with no diff are refused', () => {
    const f = clone(load('push-consent-lookup-forms.json')); f.rows[0].email = 'x@example.com'; rejects(C.PUSH_SCHEMAS.consentLookup, f);
    const m = clone(load('push-consent-lookup-mismatches.json')); m.rows[0].diffs = []; rejects(C.PUSH_SCHEMAS.consentLookup, m);
    const k = clone(load('push-consent-lookup-forms.json')); k.kind = 'mismatches'; rejects(C.PUSH_SCHEMAS.consentLookup, k);
  });
});
