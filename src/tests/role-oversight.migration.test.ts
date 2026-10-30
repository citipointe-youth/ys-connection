// Oversight rename, migration 0052. The text checks always run; the real-DB block (RO1) runs where
// LINK_TEST_DATABASE_URL is set (CI's throwaway Postgres). It works in its own schema and drops it after.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';

const SQL = readFileSync(join(__dirname, '..', '..', 'supabase', 'migrations', '0052_role_oversight.sql'), 'utf8');
const count = (needle: string) => SQL.split(needle).length - 1;

describe('0052 text', () => {
  it('renames the role in users and the three label columns, once each', () => {
    for (const s of [
      "update users set role = 'oversight' where role = 'director'",
      "update prayer_requests set created_by_role = 'oversight' where created_by_role = 'director'",
      "update connections set assigned_by_role = 'oversight' where assigned_by_role = 'director'",
      "update error_log set last_role = 'oversight' where last_role = 'director'",
    ]) expect(count(s), s).toBe(1);
  });
  it('moves the config key, guarded', () => {
    expect(count("jsonb_set(ministry_config #- '{roles,enabled,director}', '{roles,enabled,oversight}', ministry_config->'roles'->'enabled'->'director')")).toBe(1);
    expect(SQL).toContain("jsonb_typeof(ministry_config->'roles'->'enabled') = 'object'");
    expect(SQL).toContain("ministry_config->'roles'->'enabled' ? 'director'");
    expect(SQL).toContain("not (ministry_config->'roles'->'enabled' ? 'oversight')");
  });
});

const URL = process.env['LINK_TEST_DATABASE_URL'];
const PROD_REF = 'ltcblcudlzlzfcyzlhpc';
describe.skipIf(!URL || URL.includes(PROD_REF))('RO1: 0052 on a real Postgres', () => {
  it('renames the data, leaves a double-encoded string row alone, and a second run changes nothing', async () => {
    const sql = postgres(URL!, { max: 1, onnotice: () => {} });
    const schema = `ro0052_${randomBytes(4).toString('hex')}`;
    const cfg = (v: unknown) => ({ roles: { enabled: v } });
    try {
      await sql.unsafe(`create schema ${schema}`);
      await sql.begin(async (tx) => {
        await tx.unsafe(`set local search_path to ${schema}`);
        await tx.unsafe(`create table users (id serial primary key, role text not null)`);
        await tx.unsafe(`create table prayer_requests (id serial primary key, created_by_role text)`);
        await tx.unsafe(`create table connections (id serial primary key, assigned_by_role text not null)`);
        await tx.unsafe(`create table error_log (id serial primary key, last_role text)`);
        await tx.unsafe(`create table app_settings (id text primary key, ministry_config jsonb not null default '{}'::jsonb)`);
        await tx.unsafe(`insert into users (role) values ('director'), ('admin')`);
        await tx.unsafe(`insert into prayer_requests (created_by_role) values ('director'), ('quad')`);
        await tx.unsafe(`insert into connections (assigned_by_role) values ('director'), ('grade')`);
        await tx.unsafe(`insert into error_log (last_role) values ('director'), (null)`);
        const run = async (c: unknown) => {
          await tx.unsafe('delete from app_settings');
          await tx`insert into app_settings (id, ministry_config) values ('global', ${tx.json(c as any)})`;
          await tx.unsafe(SQL);
          return (await tx`select ministry_config from app_settings`)[0]!.ministry_config;
        };
        expect(await run(cfg({ director: false }))).toEqual(cfg({ oversight: false }));
        expect(await run(cfg({ director: false, oversight: true }))).toEqual(cfg({ director: false, oversight: true }));
        // a double-encoded string row: written as a jsonb string, so untouched
        await tx.unsafe('delete from app_settings');
        const str = JSON.stringify(cfg({ director: false }));
        await tx.unsafe(`insert into app_settings (id, ministry_config) values ('global', to_jsonb($1::text))`, [str]);
        await tx.unsafe(SQL);
        expect((await tx`select ministry_config from app_settings`)[0]!.ministry_config).toBe(str);
        // second run over the data tables: nothing left to change
        await tx.unsafe(SQL);
        expect((await tx`select role from users order by id`).map((r) => r.role)).toEqual(['oversight', 'admin']);
        expect((await tx`select created_by_role r from prayer_requests order by id`).map((r) => r.r)).toEqual(['oversight', 'quad']);
        expect((await tx`select assigned_by_role r from connections order by id`).map((r) => r.r)).toEqual(['oversight', 'grade']);
        expect((await tx`select last_role r from error_log order by id`).map((r) => r.r)).toEqual(['oversight', null]);
      });
    } finally {
      await sql.unsafe(`drop schema if exists ${schema} cascade`);
      await sql.end();
    }
  });
});
