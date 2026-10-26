// Modular setup Task 1.1: migration 0050 (the module switchboard). The text checks always run; the real-DB block (MG1)
// runs where LINK_TEST_DATABASE_URL is set (CI's throwaway Postgres). It works in its own schema and drops it after.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { MinistryConfigSchema } from '../core/ministry-config';
import LIVE_MODULES from './fixtures/live-modules.json';

const SQL = readFileSync(join(__dirname, '..', '..', 'supabase', 'migrations', '0050_module_switchboard.sql'), 'utf8');

describe('0050 text', () => {
  it('is additive: only guarded jsonb_set updates of the global row, no delete / drop / rename / null', () => {
    const body = SQL.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
    expect(body).not.toMatch(/\b(delete|drop|rename|alter|truncate|insert|null)\b/i);
    const updates = body.split(';').filter((s) => s.trim());
    expect(updates).toHaveLength(7);
    for (const u of updates) {
      expect(u).toMatch(/^\s*update app_settings set ministry_config = jsonb_set\(ministry_config, '\{modules,(\w+)\}'/);
      const key = /\{modules,(\w+)\}/.exec(u)![1];
      expect(u).toContain(`and not (ministry_config->'modules' ? '${key}')`);
      expect(u).toContain("where id = 'global' and jsonb_typeof(ministry_config) = 'object' and jsonb_typeof(ministry_config->'modules') = 'object'");
    }
  });
});

const URL = process.env['LINK_TEST_DATABASE_URL'];
const PROD_REF = 'ltcblcudlzlzfcyzlhpc';
describe.skipIf(!URL || URL.includes(PROD_REF))('MG1: 0050 on a real Postgres', () => {
  const ROWS: Record<string, unknown> = {
    empty: {},
    legacyTrue: { modules: { newYouthForms: true } },
    legacyFalse: { modules: { newYouthForms: false, connectionAudit: false } },
    admin: { modules: { newYouthForms: 'admin' } },
    live: { modules: LIVE_MODULES },
    keysAlreadySet: { modules: { newYouthForms: 'on', liveLink: false, camp: false, flows: 'off' } },
    noModules: { branding: { appName: 'X' } },
  };
  it('applying it twice is a no-op, existing keys are untouched, and every row still parses', async () => {
    const sql = postgres(URL!, { max: 1, onnotice: () => {} });
    const schema = `mg0050_${randomBytes(4).toString('hex')}`;
    try {
      await sql.unsafe(`create schema ${schema}`);
      const out: Record<string, any> = {};
      for (const [name, cfg] of Object.entries(ROWS)) {
        await sql.begin(async (tx) => {
          await tx.unsafe(`set local search_path to ${schema}`);
          await tx.unsafe(`create table if not exists app_settings (id text primary key, ministry_config jsonb not null default '{}'::jsonb)`);
          await tx.unsafe('delete from app_settings');
          await tx`insert into app_settings (id, ministry_config) values ('global', ${tx.json(cfg as any)})`;
          await tx.unsafe(SQL);
          const once = (await tx`select ministry_config from app_settings`)[0]!.ministry_config;
          await tx.unsafe(SQL);
          const twice = (await tx`select ministry_config from app_settings`)[0]!.ministry_config;
          expect(twice, name).toEqual(once);
          out[name] = once;
        });
      }
      const NEW = { liveLink: true, digest: true, camp: true, busConsentForm: true };
      expect(out.empty).toEqual({});
      expect(out.noModules).toEqual(ROWS.noModules);
      expect(out.legacyTrue.modules).toEqual({ newYouthForms: true, checkin: 'on', lifegroupReport: 'on', flows: 'on', ...NEW });
      expect(out.legacyFalse.modules).toEqual({ newYouthForms: false, connectionAudit: false, checkin: 'off', lifegroupReport: 'off', flows: 'off', ...NEW });
      expect(out.admin.modules).toEqual({ newYouthForms: 'admin', checkin: 'admin', lifegroupReport: 'admin', flows: 'admin', ...NEW });
      expect(out.live.modules).toEqual({ ...LIVE_MODULES, ...NEW });
      expect(out.keysAlreadySet.modules).toEqual({ newYouthForms: 'on', liveLink: false, camp: false, flows: 'off', checkin: 'on', lifegroupReport: 'on',
        digest: true, busConsentForm: true });
      for (const [name, cfg] of Object.entries(out)) expect(MinistryConfigSchema.safeParse(cfg).success, name).toBe(true);
      // The live row reads exactly as before the migration (MC4 on the stored row).
      expect(MinistryConfigSchema.parse(out.live).modules).toEqual(MinistryConfigSchema.parse({ modules: LIVE_MODULES }).modules);
    } finally {
      await sql.unsafe(`drop schema if exists ${schema} cascade`);
      await sql.end();
    }
  });
});
