// Migration 0051 (dashboard.upcoming_birthdays + role dashboard_reader). The text checks always run; the real-DB block
// runs where LINK_TEST_DATABASE_URL is set (CI's throwaway Postgres, which has every migration applied). Its rows live in a
// transaction that is rolled back.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

const SQL = readFileSync(join(__dirname, '..', '..', 'supabase', 'migrations', '0051_dashboard_birthdays.sql'), 'utf8');
const body = SQL.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

describe('0051 text', () => {
  it('is additive and safe to re-run', () => {
    expect(body).not.toMatch(/\b(delete|drop|rename|truncate|insert|update)\b/i);
    expect(body).toMatch(/create schema if not exists dashboard/);
    expect(body).toMatch(/create or replace view dashboard\.upcoming_birthdays/);
    expect(body).toMatch(/if not exists \(select 1 from pg_roles where rolname = 'dashboard_reader'\)/);
  });
  it('the view never selects date of birth, phone numbers or the full last name', () => {
    const select = body.slice(body.indexOf('select s.first_name'), body.indexOf('from ('));
    expect(select).not.toMatch(/date_of_birth|mobile|parent_phone/);
    expect(select).toContain('left(s.last_name, 1)');
    expect(body).not.toMatch(/security_invoker/);
  });
  it('dashboard_reader gets only schema usage and select on the view', () => {
    const grants = body.match(/^grant .*$/gim) ?? [];
    expect(grants).toEqual([
      'grant usage on schema dashboard to dashboard_reader;',
      'grant select on dashboard.upcoming_birthdays to dashboard_reader;',
    ]);
  });
});

const URL = process.env['LINK_TEST_DATABASE_URL'];
const PROD_REF = 'ltcblcudlzlzfcyzlhpc';
class Rollback extends Error {}
describe.skipIf(!URL || URL.includes(PROD_REF))('DB1: 0051 on a real Postgres', () => {
  it('re-applies cleanly; male, not graduated, today..today+6 only; dashboard_reader cannot read students', async () => {
    const sql = postgres(URL!, { max: 1, onnotice: () => {} });
    const tag = `Bday${Date.now()}`;
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(SQL); // a second apply on top of CI's migrate run
        const cols = await tx`select column_name, data_type from information_schema.columns
          where table_schema = 'dashboard' and table_name = 'upcoming_birthdays' order by ordinal_position`;
        expect(cols.map((c) => `${c.column_name}:${c.data_type}`)).toEqual([
          'first_name:text', 'last_initial:text', 'grade:integer', 'birthday:date', 'days_away:integer']);
        // Birth year 2008 is a leap year, so a Feb 29 window still makes a valid date.
        const add = (name: string, k: number, gender = 'male', graduated = false) => tx`
          insert into students (first_name, last_name, gender, grade, date_of_birth, graduated_at)
          select ${tag + name}, 'Smith', ${gender}, 10,
            make_date(2008, extract(month from d)::int, extract(day from d)::int), ${graduated ? new Date() : null}
          from (select (now() at time zone 'Australia/Brisbane')::date + ${k}::int as d) x`;
        for (let k = 0; k <= 7; k++) await add(`M${k}`, k);
        await add('F0', 0, 'female');
        await add('G0', 0, 'male', true);
        const rows = await tx`select first_name, last_initial, grade, days_away,
            birthday = (now() at time zone 'Australia/Brisbane')::date + days_away as ok
          from dashboard.upcoming_birthdays where first_name like ${tag + '%'} order by days_away`;
        expect(rows.map((r) => [r.first_name.slice(tag.length), r.last_initial, r.grade, r.days_away, r.ok])).toEqual(
          [0, 1, 2, 3, 4, 5, 6].map((k) => [`M${k}`, 'S', 10, k, true]));
        let seen = -1;
        let denied = '';
        await tx.savepoint(async (sp) => {
          await sp.unsafe('set local role dashboard_reader');
          seen = (await sp`select count(*)::int as n from dashboard.upcoming_birthdays where first_name like ${tag + '%'}`)[0]!.n;
          try { await sp`select 1 from public.students limit 1`; } catch (e) { denied = String(e); }
          throw new Rollback(); // back to the savepoint: drops the role switch and the aborted state
        }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
        expect(seen).toBe(7);
        expect(denied).toMatch(/permission denied/);
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    } finally {
      await sql.end();
    }
  });
});
