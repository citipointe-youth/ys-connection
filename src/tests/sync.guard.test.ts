// Security review 2026-11-04 D3 + D6: what a stolen sync token can do to the mirrors is bounded, and a new console id leaves a trace.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeSyncService } from '../services/sync.service';
import { textFor } from '../services/error-log-text';
import { InMemoryLinkRepository } from '../repositories/in-memory/link.repository';
import { InMemorySettingsRepository, InMemoryStudentRepository, InMemoryUserRepository } from '../repositories/in-memory';
import { LINK_CONTRACT_VERSION } from '../core/link-contract';

const fx = (name: string) => JSON.parse(readFileSync(join(__dirname, 'fixtures/elvanto-link', name), 'utf8'));
const CONSOLE = 'c0000000-0000-4000-8000-000000000001';
const NOW = new Date('2026-11-04T00:00:00.000Z');
const at = (min: number) => new Date(NOW.getTime() + min * 60_000).toISOString();
const person = (i: number) => `a0000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const row = (i: number, o: Record<string, unknown> = {}) => ({ personId: person(i), firstName: 'Sample', lastName: `Dummyton${i}`,
  gender: 'female', grade: 9, kind: 'student', consent: 'ok', ...o });
const roster = (rows: unknown[], takenAt = at(-1), consoleId = CONSOLE) => ({ contractVersion: LINK_CONTRACT_VERSION, consoleId, takenAt, rows });
const range = (n: number, o?: Record<string, unknown>) => Array.from({ length: n }, (_, i) => row(i, o));

async function setup() {
  const link = new InMemoryLinkRepository();
  const settings = new InMemorySettingsRepository();
  await settings.init();
  const record = vi.fn(async () => {});
  const svc = makeSyncService({ link, settings, students: new InMemoryStudentRepository(), users: new InMemoryUserRepository(),
    errorLog: { record } as never, now: () => NOW });
  const codes = () => record.mock.calls.map((c) => (c as unknown as [{ code: string; route: string }])[0]).map((r) => `${r.code}|${r.route}`);
  // Seed with the known console, and forget the calls that took.
  const seed = async (rows: unknown[]) => {
    await link.claim({ console: { consoleId: CONSOLE, label: 'x', contractVersion: LINK_CONTRACT_VERSION, consoleVersion: 'x', inWindow: false, pollSeconds: 10, capabilities: {}, linkRev: 21 },
      max: 0, leaseSeconds: 60, cutoffDays: 3, leaseLostMs: 1000 } as never);
    await svc.push('roster', roster(rows, at(-10)));
    record.mockClear();
  };
  return { link, svc, codes, seed, record };
}

describe('D3: a push dated in the future is refused', () => {
  it('refuses over 5 min ahead, logs it, and leaves the mirror and its clock alone', async () => {
    const { svc, link, codes, seed } = await setup();
    await seed(range(3));
    expect(await svc.push('roster', roster(range(4), at(5.5)))).toEqual({ applied: false });
    expect(codes()).toEqual(['push-future-time|roster']);
    expect(await link.roster()).toHaveLength(3);
    // The freeze attack: a real push straight after still lands.
    expect(await svc.push('roster', roster(range(4), at(0)))).toMatchObject({ applied: true, rows: 4 });
  });

  it('accepts up to 5 min ahead (clock drift)', async () => {
    const { svc, codes } = await setup();
    expect(await svc.push('roster', roster(range(4), at(5)))).toMatchObject({ applied: true });
    expect(codes()).toEqual(['link-new-console|roster']);
  });

  it('answers in each kind\'s own reply shape, and the version check still comes first', async () => {
    const { svc } = await setup();
    const audit = { ...fx('push-audit-service.json'), takenAt: at(60) };
    expect(await svc.push('audit', audit)).toEqual({ applied: false, source: audit.source, status: 'stale' });
    expect(await svc.push('busConsentForms', { ...fx('push-bus-consent-forms.json'), takenAt: at(60) })).toEqual({ applied: false, rows: 0, new: 0, unmatched: 0 });
    await expect(svc.push('roster', { ...roster([], at(60)), contractVersion: 999 })).rejects.toThrow();
  });
});

describe('D3: a roster far smaller than the live one is refused', () => {
  it('under half of 20+ active rows: refused and logged, nothing deactivated', async () => {
    const { svc, link, codes, seed } = await setup();
    await seed(range(20));
    expect(await svc.push('roster', roster(range(9)))).toEqual({ applied: false });
    expect(codes()).toEqual(['push-roster-shrink|roster']);
    expect((await link.roster()).filter((r) => r.active)).toHaveLength(20);
  });

  it('an empty roster is refused the same way', async () => {
    const { svc, seed } = await setup();
    await seed(range(20));
    expect(await svc.push('roster', roster([]))).toEqual({ applied: false });
  });

  it('exactly half, and under 20 active rows, still apply', async () => {
    const a = await setup();
    await a.seed(range(20));
    expect(await a.svc.push('roster', roster(range(10)))).toMatchObject({ applied: true, rows: 10 });
    const b = await setup();
    await b.seed(range(19));
    expect(await b.svc.push('roster', roster(range(2)))).toMatchObject({ applied: true, rows: 2 });
    expect(a.codes().concat(b.codes())).toEqual([]);
  });

  it('January: graduates stay as rows with a blank grade (gradeGlitch territory), so no refusal', async () => {
    const { svc, codes, seed } = await setup();
    await seed(range(40));
    const rows = range(40).map((r, i) => (i < 30 ? { ...r, grade: null } : r));
    expect(await svc.push('roster', roster(rows))).toMatchObject({ applied: true, rows: 40 });
    expect(codes()).toEqual([]);
  });
});

describe('D3: over 5 DNC flags lifted in one push are held', () => {
  const dnc = (i: number, consent = 'all') => row(i, { consent });

  it('6 lifts: those keep their old flags, the rest of the push applies, one log row', async () => {
    const { svc, link, codes, seed } = await setup();
    await seed([...Array.from({ length: 6 }, (_, i) => dnc(i, i % 2 ? 'all' : 'contact')), row(6)]);
    const lift = Array.from({ length: 6 }, (_, i) => row(i, { firstName: 'Renamed' }));
    expect(await svc.push('roster', roster([...lift, row(6, { consent: 'contact' })]))).toMatchObject({ applied: true, rows: 7 });
    expect(codes()).toEqual(['push-dnc-held|roster']);
    const got = new Map((await link.roster()).map((r) => [r.personId, r]));
    for (let i = 0; i < 6; i++) expect(got.get(person(i))).toMatchObject({ consent: i % 2 ? 'all' : 'contact', firstName: 'Renamed' });
    expect(got.get(person(6))!.consent).toBe('contact'); // a new DNC is never held back
  });

  it('5 lifts apply: a family\'s real change is not held', async () => {
    const { svc, link, codes, seed } = await setup();
    await seed(Array.from({ length: 5 }, (_, i) => dnc(i)));
    await svc.push('roster', roster(range(5)));
    expect((await link.roster()).every((r) => r.consent === 'ok')).toBe(true);
    expect(codes()).toEqual([]);
  });

  it('unknown or missing flags and all -> contact are not lifts', async () => {
    const { svc, codes, seed } = await setup();
    await seed(Array.from({ length: 9 }, (_, i) => dnc(i)));
    await svc.push('roster', roster(Array.from({ length: 9 }, (_, i) => row(i, { consent: i < 3 ? 'unknown' : i < 6 ? 'contact' : undefined }))));
    expect(codes()).toEqual([]);
  });
});

describe('D6: a console id with no link_console row', () => {
  const claimBody = (consoleId: string) => ({ ...fx('claim-request.json'), consoleId });

  it('claim: one log row, and the claim still works', async () => {
    const { svc, codes } = await setup();
    await expect(svc.claim(claimBody(CONSOLE))).resolves.toMatchObject({ rows: [] });
    await svc.claim(claimBody(CONSOLE));
    expect(codes()).toEqual(['link-new-console|claim']);
  });

  it('push: a stranger is logged and still applied; a known console is not logged', async () => {
    const { svc, codes, seed } = await setup();
    await seed(range(3));
    await svc.push('roster', roster(range(3), at(-1)));
    expect(codes()).toEqual([]);
    const other = 'c0000000-0000-4000-8000-000000000002';
    expect(await svc.push('roster', roster(range(3), at(0), other))).toMatchObject({ applied: true });
    expect(codes()).toEqual(['link-new-console|roster']);
  });

  it('every new code has its own wording, naming no values', () => {
    for (const code of ['link-new-console', 'push-future-time', 'push-roster-shrink', 'push-dnc-held', 'push-dob-held', 'sync-bad-token']) {
      expect(textFor('link', code, 'roster', null).line1, code).not.toMatch(/Elvanto link action|unknown/i);
    }
  });
});
