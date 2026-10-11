import { describe, it, expect } from 'vitest';
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
  // The YS stream moves this file into supabase/migrations/ and updates this path in the same commit.
  const sql = readFileSync(join(ROOT, 'docs', 'superpowers', 'specs', '2026-10-11-elvanto-link-0016.draft.sql'), 'utf8');
  it('enables RLS on every table it creates (by rule)', () => {
    const tables = [...sql.matchAll(/create table (?:if not exists )?(\w+)/gi)].map((m) => m[1]!);
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) expect(sql, t).toMatch(new RegExp(String.raw`alter table\s+${t}\s+enable row level security`, 'i'));
  });
});
