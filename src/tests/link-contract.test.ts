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
};

describe('link contract: every fixture parses with its schema', () => {
  it('covers every fixture file', () => expect(Object.keys(FIXTURES).sort()).toEqual(Object.keys(load('manifest.json').files).sort()));
  for (const [f, schema] of Object.entries(FIXTURES)) it(f, () => { schema.parse(load(f)); });

  it('claim-response has one row per action type; each payload parses with its type schema', () => {
    const rows = C.ClaimResponse.parse(load('claim-response.json')).rows;
    expect(rows.map((r) => r.type).sort()).toEqual([...C.ACTION_TYPES].sort());
    for (const r of rows) (C.PAYLOAD_SCHEMAS[r.type] as z.ZodTypeAny).parse(r.payload);
  });
  it('result-request has every outcome', () => {
    const outcomes = new Set(C.ResultRequest.parse(load('result-request.json')).results.map((r) => r.outcome));
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
