// Friday night check, Task 4: the night-summary service over the in-memory twins. Fictional names only: Sample, Dummyton, Codeman.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { makeNightSummaryService, NIGHT_TAPS_MAX, type NightSummaryDeps } from '../services/night-summary.service';
import { NIGHT_SECTIONS, LINK_CONTRACT_VERSION } from '../core/link-contract';
import { MODULE_TREE } from '../core/module-tree';
import { InMemoryLinkRepository } from '../repositories/in-memory/link.repository';
import { InMemoryNightSummaryRepository } from '../repositories/in-memory/night-summary.repository';
import { InMemoryErrorLogRepository } from '../repositories/in-memory/error-log.repository';
import { InMemoryReconcileRunRepository } from '../repositories/in-memory/reconcile-run.repository';
import { InMemoryImportRepository, InMemorySettingsRepository } from '../repositories/in-memory';
import type { ErrorLogEntry } from '../repositories/interfaces/error-log.repository';
import type { LinkLogRow } from '../core/link-types';
import { newRow, claimArgs } from './helpers/link-repo-suite';

const NOW = new Date('2026-11-13T12:30:00.000Z');
const FROM = '2026-11-13T07:00:00.000Z', TO = '2026-11-13T20:00:00.000Z';   // Fri 17:00 to Sat 06:00 Brisbane
const ME = '8f5a1c2e-0000-4000-8000-000000000001';
const NAMES = /Sample|Dummyton|Codeman/;
const req = (section: string, o: Record<string, unknown> = {}) =>
  ({ contractVersion: LINK_CONTRACT_VERSION, consoleId: ME, section, from: FROM, to: TO, ...o });

const errEntry = (o: Partial<ErrorLogEntry>): ErrorLogEntry => ({ id: randomUUID(), category: 'server', code: 'INTERNAL_ERROR', route: 'GET /x',
  status: 500, message: '', tier: 'later', foldKey: null, role: null, at: '2026-11-13T10:00:00.000Z', ...o });
const tap = (at: string, o: Partial<LinkLogRow> = {}): LinkLogRow => ({ id: randomUUID(), at, userId: randomUUID(), login: 'Sample', deviceId: 'dev-1',
  deviceLabel: 'Codeman', event: 'checkIn', leaderId: null, leaderName: 'Sample', prevLeaderId: null, prevLeaderName: 'Dummyton',
  targetKind: 'person', targetId: randomUUID(), targetName: 'Dummyton', outboxId: null, outcome: 'saved', ...o });

async function harness() {
  const link = new InMemoryLinkRepository();
  const night = new InMemoryNightSummaryRepository(link);
  const errors = new InMemoryErrorLogRepository();
  const runs = new InMemoryReconcileRunRepository();
  const imports = new InMemoryImportRepository();
  const settings = new InMemorySettingsRepository(); await settings.init();
  const deps: NightSummaryDeps = { night, link, errorRows: errors, runs, imports, settings, now: () => NOW };
  return { link, night, errors, runs, imports, settings, deps, svc: makeNightSummaryService(deps) };
}

describe('night-summary service', () => {
  it('one query at a time: at most one repository call in flight, for every section', async () => {
    const h = await harness();
    let inFlight = 0, max = 0;
    const spy = <T extends object>(o: T): T => new Proxy(o, { get: (t, k) => {
      const f = (t as any)[k];
      if (typeof f !== 'function') return f;
      return async (...a: unknown[]) => { inFlight++; max = Math.max(max, inFlight); await new Promise((r) => setTimeout(r, 2)); try { return await f.apply(t, a); } finally { inFlight--; } };
    } });
    const svc = makeNightSummaryService({ night: spy(h.night), link: spy(h.link), errorRows: spy(h.errors), runs: spy(h.runs),
      imports: spy(h.imports), settings: spy(h.settings), now: () => NOW });
    for (const s of NIGHT_SECTIONS) {
      await svc.get(req(s));
      expect(max, s).toBe(1);
      max = 0;
    }
    const src = readFileSync(join(__dirname, '..', 'services', 'night-summary.service.ts'), 'utf8');
    expect(src).not.toMatch(/Promise\.all/);
    expect(src).not.toMatch(/auditFeed/);
  });

  it('outbox window uses site dates: from and to become site-time days through brisbaneToday', async () => {
    const h = await harness();
    const seen: [string, string][] = [];
    const night = { outbox: async (a: string, b: string) => { seen.push([a, b]); return []; }, taps: h.night.taps.bind(h.night) };
    const withTz = (timeZone: string) => makeNightSummaryService({ ...h.deps, night,
      settings: { getSettings: async () => ({ ministryConfig: { structure: { timeZone } } }) as any } });
    await withTz('Australia/Brisbane').get(req('outbox', { from: '2026-11-13T12:00:00.000Z', to: '2026-11-13T20:00:00.000Z' }));
    await withTz('Pacific/Auckland').get(req('outbox', { from: '2026-11-13T12:00:00.000Z', to: '2026-11-13T20:00:00.000Z' }));
    expect(seen).toEqual([['2026-11-13', '2026-11-14'], ['2026-11-14', '2026-11-14']]);   // UTC dates would be 13 and 13
  });

  it('services: the rows inside the site-date window, counts only', async () => {
    const h = await harness();
    const row = (ymd: string) => ({ serviceTimeId: randomUUID(), serviceId: randomUUID(), name: 'Codeman', startsAt: `${ymd}T08:00:00.000Z`, ymd,
      rooms: [{ id: 'r1', name: 'Sample room' }], checkedIn: [{ personId: 'p1', roomId: 'r1', firstName: 'Sample', lastName: 'Dummyton' }] });
    await h.link.replaceMirror('services', [row('2026-11-13'), row('2026-11-20')], { takenAt: NOW.toISOString(), consoleId: ME });
    const r = await h.svc.get(req('services'));
    expect(r).toMatchObject({ contractVersion: 1, section: 'services' });
    expect((r.data as any).rows).toEqual([{ ymd: '2026-11-13', startsAt: '2026-11-13T08:00:00.000Z', rooms: 1, checkedIn: 1 }]);
  });

  it('reconcile: the run or null; never items', async () => {
    const h = await harness();
    expect((await h.svc.get(req('reconcile'))).data).toBeNull();
    await h.runs.save({ id: 'r1', ranAt: '2026-11-13T11:00:00.000Z', importId: null, ok: true,
      checks: { checkins: { count: 0 }, unmatched: { count: 2 }, lifegroups: { count: 0, noId: 1 }, members: { error: true } },
      items: { checkins: [], unmatched: ['Sample'], lifegroups: [], noId: ['Dummyton'], members: [] } });
    const d = (await h.svc.get(req('reconcile'))).data as any;
    expect(d).toEqual({ ranAt: '2026-11-13T11:00:00.000Z', ok: true,
      checks: { checkins: { count: 0 }, unmatched: { count: 2 }, lifegroups: { count: 0, noId: 1 }, members: { error: true } } });
    expect(JSON.stringify(d)).not.toMatch(/items|Sample|Dummyton/);
  });

  it('reconcile: an added key in the stored run fails the section (parsed through its schema)', async () => {
    const h = await harness();
    const runs = { latest: async () => ({ ranAt: '2026-11-13T11:00:00.000Z', ok: true,
      checks: { checkins: { count: 0 }, unmatched: { count: 0 }, lifegroups: { count: 0 }, members: { count: 0 }, names: ['Sample'] } }) as any };
    await expect(makeNightSummaryService({ ...h.deps, runs }).get(req('reconcile'))).rejects.toThrow();
  });

  it('errors: the tier comes from toView, not the stored column; ignored rows are only in ignored', async () => {
    const h = await harness();
    await h.errors.record(errEntry({ category: 'server', code: 'LINK_OFF', status: null, tier: 'fyi' }));   // stored fyi; the view says now
    const ign = errEntry({ code: 'INTERNAL_ERROR', route: 'GET /y' });
    await h.errors.record(ign);
    await h.errors.setFlags(ign.id, { ignored: true });
    const d = (await h.svc.get(req('errors'))).data as any;
    expect(d.ignored).toBe(1);
    expect(d.groups).toHaveLength(1);
    expect(d.groups[0]).toMatchObject({ code: 'LINK_OFF', tier: 'now', inWindow: true, n: 1 });
    expect(d.capped).toBe(false);
  });

  it('the console section: self only for the requested id; an unregistered id has no self row; a bad consoleVersion fails the section', async () => {
    const h = await harness();
    await h.link.claim(claimArgs({}, ME));
    await h.link.claim(claimArgs({}, randomUUID()));
    const some = (await h.svc.get(req('console'))).data as any;
    expect(some.consoles.map((c: any) => c.self).sort()).toEqual([false, true]);
    expect(JSON.stringify(some)).not.toContain(ME);
    const none = (await h.svc.get(req('console', { consoleId: randomUUID() }))).data as any;
    expect(none.consoles.some((c: any) => c.self)).toBe(false);
    await h.link.claim(claimArgs({ console: { ...claimArgs().console, consoleId: randomUUID(), consoleVersion: 'Sample Dummyton' } }));
    await expect(h.svc.get(req('console'))).rejects.toThrow();
  });

  // Every section parses its result. One bad repository value per section; the refusal is a plain Error with no issues in it,
  // so the adapter answers 500 INTERNAL_ERROR with no details (a ZodError would answer 400 and echo the received value).
  // taps has no case: its aggregate maps every outcome to a closed value or 'other', so no repository value can fail its schema.
  const REFUSED = 'night-summary: section shape refused';
  const BAD: [string, (h: Awaited<ReturnType<typeof harness>>) => Promise<NightSummaryDeps>][] = [
    ['outbox', async (h) => ({ ...h.deps, night: { taps: async () => [], outbox: async () => [{ type: 'checkIn', status: 'Sample', reason: null,
      serviceDate: '2026-11-13', createdAt: '2026-11-13T08:00:00.000Z', resultAt: null, attempts: 1, inWindow: true }] } })],
    ['errors', async (h) => { await h.errors.record(errEntry({})); return { ...h.deps, errorRows: { list: async () => [...(await h.errors.list())].map((r) => ({ ...r, category: 'Sample' as any })) } }; }],
    ['imports', async (h) => ({ ...h.deps, imports: { findByType: async (t) => (t === 'service' ? [{ type: 'service', filename: '', fileHash: '', rowCount: 1,
      sessionsAdded: 1, status: 'Sample', importedAt: '2026-11-13T09:00:00.000Z' }] as any : []) } })],
    ['reconcile', async (h) => ({ ...h.deps, runs: { latest: async () => ({ ranAt: '2026-11-13T11:00:00.000Z', ok: true,
      checks: { checkins: { count: -1 }, unmatched: { count: 0 }, lifegroups: { count: 0 }, members: { count: 0 } } }) as any } })],
    ['console', async (h) => ({ ...h.deps, link: { ...h.link, listConsoles: async () => [], mirrorState: async () => [{ kind: 'Sample' as any,
      takenAt: '2026-11-13T09:00:00.000Z', appliedAt: '2026-11-13T09:00:00.000Z', rowCount: 1, consoleId: ME }], services: async () => [] } })],
    ['services', async (h) => ({ ...h.deps, link: { ...h.link, listConsoles: async () => [], mirrorState: async () => [], services: async () => [{ serviceTimeId: 'a',
      serviceId: 'b', name: 'x', startsAt: '2026-11-13T08:00:00.000Z', ymd: '2026-11-13x', rooms: [], checkedIn: [] }] } })],
  ];
  it.each(BAD)('%s: a value outside its schema fails the section with a bare Error, naming no value', async (section, make) => {
    const h = await harness();
    const err = await makeNightSummaryService(await make(h)).get(req(section)).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe('Error');            // not a ZodError
    expect((err as Error).message).toBe(REFUSED);
  });

  it('outbox: the result does not depend on the order the repository returns rows', async () => {
    const h = await harness();
    for (const [date, status] of [['2026-11-13', 'sent'], ['2026-11-13', 'pending'], ['2026-11-14', 'refused'], ['2026-10-01', 'unclear']] as const) {
      const r = newRow({ serviceDate: date }); await h.link.insertAction(r);
      if (status !== 'pending') h.link._backdate('link_outbox', r.id, 'status', status);
    }
    const rows = await h.night.outbox('2026-11-13', '2026-11-14');
    const shaped = (rs: typeof rows) => makeNightSummaryService({ ...h.deps, night: { outbox: async () => rs, taps: async () => [] } }).get(req('outbox'));
    const a = (await shaped(rows)).data as any, b = (await shaped([...rows].reverse())).data as any;
    const key = (g: any) => JSON.stringify(g);
    expect(a.groups.map(key).sort()).toEqual(b.groups.map(key).sort());
    expect({ ...a, groups: 0 }).toEqual({ ...b, groups: 0 });
    expect(a.openTotals).toEqual({ unclear: 1, pending: 1, claimed: 0 });
  });

  it('outbox: a Saturday-dated row created after `to` is not counted (a later service)', async () => {
    const h = await harness();
    const a = newRow({ serviceDate: '2026-11-14' }); await h.link.insertAction(a);
    const b = newRow({ serviceDate: '2026-11-14' }); await h.link.insertAction(b);
    h.link._backdate('link_outbox', a.id, 'status', 'sent'); h.link._backdate('link_outbox', b.id, 'status', 'sent');
    h.link._backdate('link_outbox', a.id, 'createdAt', '2026-11-13T10:00:00.000Z');
    h.link._backdate('link_outbox', b.id, 'createdAt', '2026-11-14T01:00:00.000Z');
    const g = ((await h.svc.get(req('outbox'))).data as any).groups;
    expect(g.reduce((n: number, x: any) => n + x.n, 0)).toBe(1);
  });

  it('taps: asks for NIGHT_TAPS_MAX rows and flags a full read as truncated', async () => {
    const h = await harness();
    let asked = 0;
    const rows = Array.from({ length: NIGHT_TAPS_MAX }, () => ({ at: '2026-11-13T10:00:00.000Z', event: 'checkIn' as const, outcome: 'saved', deviceId: 'd' }));
    const svc = makeNightSummaryService({ ...h.deps, night: { outbox: async () => [], taps: async (_f, _t, limit) => { asked = limit; return rows; } } });
    expect(((await svc.get(req('taps'))).data as any).truncated).toBe(true);
    expect(asked).toBe(5000);
  });

  it('PII: seeded names reach no section', async () => {
    const h = await harness();
    // outbox: leader_name, note, payload-adjacent columns, a free-text reason and detail
    const o = newRow({ leaderName: 'Sample Dummyton', note: 'Codeman', serviceDate: '2026-11-13' });
    await h.link.insertAction(o);
    h.link._backdate('link_outbox', o.id, 'status', 'refused');
    h.link._backdate('link_outbox', o.id, 'reason', 'Sample Dummyton');
    h.link._backdate('link_outbox', o.id, 'detail', 'Codeman');
    // taps: login, target_name, device_label, leader_name, prev_leader_name; an outcome carrying a name is not a refusal code
    await h.link.addLog([tap('2026-11-13T10:00:00.000Z'), tap('2026-11-13T10:00:30.000Z', { outcome: 'refused:Sample' })]);
    // errors: message
    await h.errors.record(errEntry({ message: 'Sample Dummyton Codeman', route: 'GET /students/Sample' }));
    // imports: imported_by, filename, error_message
    await h.imports.save({ id: randomUUID(), type: 'service', filename: 'Dummyton.csv', fileHash: 'h', rowCount: 3, sessionsAdded: 1, studentsAdded: 0,
      studentsUpdated: 0, status: 'error', errorMessage: 'Codeman', importedAt: '2026-11-13T09:00:00.000Z', importedBy: 'Sample' } as any);
    // reconcile: items
    await h.runs.save({ id: 'r1', ranAt: '2026-11-13T11:00:00.000Z', importId: null, ok: true,
      checks: { checkins: { count: 1 }, unmatched: { count: 1 }, lifegroups: { count: 0 }, members: { count: 0 } },
      items: { checkins: [], unmatched: ['Sample Dummyton'], lifegroups: [], noId: ['Codeman'], members: [] } });
    // console: link_console.label
    await h.link.claim(claimArgs({ console: { ...claimArgs().console, consoleId: ME, label: 'Codeman Sample' } }, ME));
    // services: checked_in names and room names
    await h.link.replaceMirror('services', [{ serviceTimeId: randomUUID(), serviceId: randomUUID(), name: 'Codeman', startsAt: '2026-11-13T08:00:00.000Z', ymd: '2026-11-13',
      rooms: [{ id: 'r1', name: 'Codeman room' }], checkedIn: [{ personId: 'p1', roomId: 'r1', firstName: 'Sample', lastName: 'Dummyton' }] }],
      { takenAt: NOW.toISOString(), consoleId: ME });
    for (const s of NIGHT_SECTIONS) {
      const out = JSON.stringify(await h.svc.get(req(s)));
      expect(out, s).not.toMatch(NAMES);
    }
    // the seeds did reach the sections' counts, so the check above has something to fail on
    expect(((await h.svc.get(req('outbox'))).data as any).groups).toEqual([{ type: 'checkIn', status: 'refused', reason: 'other', n: 1 }]);
    expect(((await h.svc.get(req('taps'))).data as any).refused).toEqual({ other: 1 });
    expect(((await h.svc.get(req('imports'))).data as any).rows).toHaveLength(1);
  });

  it("the console's module key list is current", () => {
    // A literal copy of the console's MODULE_KEYS (plan Appendix E). A new module fails here as a reminder to update the console;
    // until then the console reads the new key as `other`.
    const MODULE_KEYS = ['prayers', 'notices', 'idChecks', 'digest', 'busMinistry', 'busConsentForm', 'newYouthForms', 'intakeAdmin', 'liveLink',
      'flows', 'lifegroupReport', 'checkin', 'connectionAudit', 'camp'];
    expect(MODULE_TREE.map((n) => n.key)).toEqual(MODULE_KEYS);
  });
});
