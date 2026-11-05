// Friday night check, Task 2: contract schemas and aggregates for POST /sync/night-summary. Fictional names only.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NightSummaryRequest, NightOutbox, NightTaps, NightErrors, NightImports, NightReconcile, NightConsole, NightServices,
  REFUSAL_CODES, REASONS, LINK_REV,
} from '../core/link-contract';
import {
  percentile, aggregateOutbox, aggregateTaps, aggregateErrors, aggregateImports, aggregateConsole, aggregateServices,
} from '../services/night-summary-aggregate';
import type { NightOutboxRow, NightTapRow } from '../repositories/interfaces/night-summary.repository';
import type { ErrorLogView } from '../services/error-log.service';
import type { ImportRecord } from '../core/entities/attendance';
import type { ConsoleRow, MirrorStateRow, LinkServiceRow } from '../core/link-types';

const NOW = new Date('2026-11-13T12:00:00.000Z');
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const orow = (o: Partial<NightOutboxRow> = {}): NightOutboxRow => ({ type: 'checkIn', status: 'sent', reason: null, serviceDate: '2026-11-13',
  createdAt: '2026-11-13T08:00:00.000Z', resultAt: '2026-11-13T08:00:10.000Z', attempts: 1, inWindow: true, ...o });
const trow = (o: Partial<NightTapRow> = {}): NightTapRow => ({ at: '2026-11-13T08:00:00.000Z', event: 'checkIn', outcome: 'saved', deviceId: 'd1', ...o });
const ZERO = { n: 0, p50S: 0, p95S: 0, maxS: 0 };

describe('percentile', () => {
  it('nearest rank', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    expect(percentile(Array.from({ length: 100 }, (_, i) => i + 1), 95)).toBe(95);
    expect(percentile([], 95)).toBe(0);
  });
});

describe('outbox', () => {
  it('door, intake and other buckets', () => {
    const rows = [
      orow({ type: 'checkIn', resultAt: '2026-11-13T08:00:10.000Z', attempts: 1 }),
      orow({ type: 'checkOut', resultAt: '2026-11-13T08:00:30.000Z', attempts: 3 }),
      orow({ type: 'firstTimerCheckIn', resultAt: null, attempts: 5 }),
      orow({ type: 'intakeAnswer', resultAt: '2026-11-13T08:01:00.000Z', attempts: 2 }),
      orow({ type: 'intakeSave' }), orow({ type: 'consentSave' }), orow({ type: 'intakeText' }),
      orow({ type: 'submitReport', resultAt: '2026-11-13T08:00:05.000Z', attempts: 7 }),
    ];
    const o = aggregateOutbox(rows, NOW);
    expect(o.latency.door).toEqual({ n: 2, p50S: 10, p95S: 30, maxS: 30 });   // the null resultAt row is excluded
    expect(o.latency.intake.n).toBe(4);
    expect(o.latency.intake.maxS).toBe(60);
    expect(o.latency.other).toEqual({ n: 1, p50S: 5, p95S: 5, maxS: 5 });
    expect(o.attempts.door).toEqual({ a1: 1, a2to4: 1, a5plus: 1, max: 5 });
    expect(o.attempts.intake).toEqual({ a1: 3, a2to4: 1, a5plus: 0, max: 2 });
    expect(o.attempts.other).toEqual({ a1: 0, a2to4: 0, a5plus: 1, max: 7 });
    expect(NightOutbox.safeParse(o).success).toBe(true);
  });
  it('openTotals count every date, groups only the window', () => {
    const o = aggregateOutbox([orow({ status: 'unclear', serviceDate: '2026-11-01', inWindow: false, resultAt: null }),
      orow({ status: 'pending', createdAt: '2026-11-13T11:00:00.000Z', resultAt: null }), orow({ status: 'sent' })], NOW);
    expect(o.openTotals).toEqual({ unclear: 1, pending: 1, claimed: 0 });
    expect(o.groups.find((g) => g.status === 'unclear')).toBeUndefined();
    expect(o.groups.reduce((a, g) => a + g.n, 0)).toBe(2);
    expect(o.oldestPendingAgeS).toBe(3600);
    expect(aggregateOutbox([], NOW).oldestPendingAgeS).toBeNull();
    expect(aggregateOutbox([], NOW).latency.door).toEqual(ZERO);
  });
  it('a reason outside REASONS becomes other, raw text never appears', () => {
    const o = aggregateOutbox([orow({ status: 'refused', reason: 'Sample Dummyton' }), orow({ status: 'refused', reason: 'no-room' }), orow({ reason: null })], NOW);
    expect(o.groups.filter((g) => g.reason === 'other')).toHaveLength(1);
    expect(o.groups.some((g) => g.reason === 'no-room')).toBe(true);
    expect(JSON.stringify(o)).not.toContain('Sample');
    expect(REASONS).not.toContain('other');
  });
  it('the retired shadowed status parses', () => {
    const o = aggregateOutbox([orow({ status: 'shadowed' })], NOW);
    expect(NightOutbox.safeParse(o).success).toBe(true);
    expect(o.groups[0]!.status).toBe('shadowed');
  });
});

describe('taps', () => {
  it('identity, cancel, undo, resolve are not taps', () => {
    const rows = [
      trow({ event: 'checkIn', at: '2026-11-13T08:00:01.000Z', deviceId: 'd1' }),
      trow({ event: 'checkOut', at: '2026-11-13T08:00:30.000Z', deviceId: 'd2' }),
      trow({ event: 'firstTimerCheckIn', at: '2026-11-13T08:05:00.000Z', deviceId: 'd2', outcome: 'replay' }),
      trow({ event: 'submitReport', at: '2026-11-13T08:00:40.000Z', deviceId: 'd9', outcome: 'refused:LINK_STALE' }),
      trow({ event: 'identity', deviceId: 'd7', outcome: 'logged' }), trow({ event: 'cancel', deviceId: 'd8', outcome: 'cancelled' }),
      trow({ event: 'undo', deviceId: 'd8' }), trow({ event: 'resolve', outcome: 'refused:not-landed', deviceId: 'd6' }),
    ];
    const t = aggregateTaps(rows, 5000);
    expect(t.tapCount).toBe(3);
    expect(t.peakPerMinute).toBe(2);              // 08:00 holds the checkIn and the checkOut; submitReport is not a door event
    expect(t.distinctDevices).toBe(2);
    expect(t.replay).toBe(1);
    expect(t.refused).toEqual({ LINK_STALE: 1 }); // a resolve's refusal is not an action event
    expect(t.truncated).toBe(false);
    expect(NightTaps.safeParse(t).success).toBe(true);
  });
  it('LINK_TOO_OLD counts under its own code; a code outside REFUSAL_CODES becomes other; rows === limit sets truncated', () => {
    const rows = [trow({ outcome: 'refused:LINK_TOO_OLD' }), trow({ outcome: 'refused:LINK_TOO_OLD' }), trow({ outcome: 'refused:Sample Dummyton' }), trow({ deviceId: null })];
    const t = aggregateTaps(rows, 4);
    expect(t.refused).toEqual({ LINK_TOO_OLD: 2, other: 1 });
    expect(t.truncated).toBe(true);
    expect(t.distinctDevices).toBe(1);
    expect(JSON.stringify(t)).not.toContain('Sample');
    expect(aggregateTaps(rows, 5).truncated).toBe(false);
  });
});

describe('REFUSAL_CODES', () => {
  it("holds every super('X' code in src/core/errors/, plus INTERNAL and not-landed", () => {
    const codes = new Set<string>();
    for (const f of ['link-errors.ts', 'app-error.ts']) {
      for (const m of readFileSync(join(__dirname, '..', 'core', 'errors', f), 'utf8').matchAll(/super\('([A-Z][A-Z_]*)'\s*,/g)) codes.add(m[1]!);
    }
    expect(codes.size).toBeGreaterThan(20);
    expect([...REFUSAL_CODES].sort()).toEqual([...codes, 'INTERNAL', 'not-landed'].sort());
  });
});

const view = (o: Partial<ErrorLogView> = {}): ErrorLogView => ({ id: 'e1', category: 'server', code: 'NOT_FOUND', route: 'GET /x', status: 404, message: '',
  count: 2, firstSeen: '2026-11-13T05:00:00.000Z', lastSeen: '2026-11-13T09:00:00.000Z', lastRole: null, minimised: false, ignored: false,
  tier: 'later', foldKey: null, line1: 'Sample Dummyton', line2: 'Codeman', counted: true, ...o });
const FROM = '2026-11-13T02:00:00.000Z', TO = '2026-11-14T20:00:00.000Z';

describe('errors', () => {
  it('a code failing the format becomes other', () => {
    const e = aggregateErrors([view({ code: 'Sample Dummyton' }), view({ code: 'x'.repeat(81) }), view({ code: 'OK_CODE-1' })], 3, FROM, TO);
    expect(e.groups.map((g) => g.code).sort()).toEqual(['OK_CODE-1', 'other']);
    expect(e.groups.find((g) => g.code === 'other')!.n).toBe(4);
    expect(JSON.stringify(e)).not.toContain('Sample');
    expect(NightErrors.safeParse(e).success).toBe(true);
  });
  it('client category code is client; tier from the view; capped when total is 500; inWindow from lastSeen', () => {
    const e = aggregateErrors([
      view({ category: 'client', code: 'https://page', status: null, tier: 'fyi' }),
      view({ tier: 'now', lastSeen: '2026-11-12T09:00:00.000Z', firstSeen: '2026-11-10T09:00:00.000Z' }),
      view({ tier: 'now', ignored: true }), view({ ignored: true, id: 'e3' }),
    ], 500, FROM, TO);
    expect(e.ignored).toBe(2);
    expect(e.capped).toBe(true);
    expect(e.groups).toHaveLength(2);
    expect(e.groups.find((g) => g.category === 'client')).toMatchObject({ code: 'client', tier: 'fyi', status: null, inWindow: true });
    expect(e.groups.find((g) => g.category === 'server')).toMatchObject({ tier: 'now', inWindow: false, oldestFirstSeen: '2026-11-10T09:00:00.000Z' });
    expect(aggregateErrors([], 499, FROM, TO).capped).toBe(false);
  });
});

const imp = (o: Partial<ImportRecord>): ImportRecord => ({ id: 'i', type: 'service', filename: 'Sample-Dummyton.csv', fileHash: 'abc', rowCount: 10, sessionsAdded: 1,
  studentsAdded: 0, studentsUpdated: 0, status: 'ok', errorMessage: 'Codeman', importedAt: '2026-11-13T10:00:00.000Z', importedBy: 'Sample', ...o });

describe('imports', () => {
  it('newest before from is previous; no hash, filename, importedBy, errorMessage key', () => {
    const svc = [imp({ importedAt: '2026-11-13T10:00:00.000Z', rowCount: 12 }), imp({ importedAt: '2026-11-06T10:00:00.000Z', rowCount: 9 }), imp({ importedAt: '2026-10-30T10:00:00.000Z', rowCount: 8 })];
    const lg = [imp({ type: 'lifegroup', importedAt: '2026-11-13T11:00:00.000Z', status: 'error' })];
    const i = aggregateImports(svc, lg, '2026-11-13T02:00:00.000Z', '2026-11-15T02:00:00.000Z');
    expect(i.rows).toHaveLength(2);
    expect(i.rows.find((r) => r.type === 'lifegroup')!.status).toBe('error');
    expect(i.previous.service).toEqual({ rowCount: 9, sessionsAdded: 1, importedAt: '2026-11-06T10:00:00.000Z' });
    expect(i.previous.lifegroup).toBeNull();
    const text = JSON.stringify(i);
    for (const k of ['fileHash', 'filename', 'importedBy', 'errorMessage', 'Sample', 'Codeman']) expect(text).not.toContain(k);
    expect(NightImports.safeParse(i).success).toBe(true);
  });
});

const crow = (o: Partial<ConsoleRow> = {}): ConsoleRow => ({ consoleId: U(1), label: 'Sample Dummyton', lastSeenAt: '2026-11-13T11:59:00.000Z', contractVersion: 1,
  consoleVersion: 'v2026.11.12.1', inWindow: true, pollSeconds: 30, capabilities: {} as ConsoleRow['capabilities'], linkRev: 21, ...o });

describe('console', () => {
  it('self only for the requested id; the id is never returned; appLinkRev === LINK_REV', () => {
    const mirror: MirrorStateRow[] = [{ kind: 'services', takenAt: '2026-11-13T11:00:00.000Z', consoleId: U(1), rowCount: 3, appliedAt: '2026-11-13T11:00:01.000Z' }];
    const c = aggregateConsole([crow(), crow({ consoleId: U(2), label: 'Codeman' })], mirror, U(2));
    expect(c.consoles.map((x) => x.self)).toEqual([false, true]);
    expect(c.appLinkRev).toBe(LINK_REV);
    expect(c.mirror).toEqual([{ kind: 'services', takenAt: '2026-11-13T11:00:00.000Z', appliedAt: '2026-11-13T11:00:01.000Z', rowCount: 3 }]);
    const text = JSON.stringify(c);
    for (const bad of [U(1), U(2), 'Sample', 'Codeman', 'label']) expect(text).not.toContain(bad);
    expect(NightConsole.safeParse(c).success).toBe(true);
    expect(aggregateConsole([crow()], [], U(9)).consoles[0]!.self).toBe(false);
  });
  it('a consoleVersion failing the format fails the section', () => {
    const c = aggregateConsole([crow({ consoleVersion: 'Sample Dummyton' })], [], U(1));
    expect(NightConsole.safeParse(c).success).toBe(false);
  });
});

describe('services', () => {
  it('counts only', () => {
    const rows: LinkServiceRow[] = [
      { serviceTimeId: U(5), serviceId: U(6), name: 'Sample Dummyton room', startsAt: '2026-11-13T08:30:00.000Z', ymd: '2026-11-13',
        rooms: [{ id: U(7), name: 'Codeman' }, { id: U(8), name: 'Room' }], checkedIn: [{ personId: U(9), roomId: U(7), firstName: 'Sample', lastName: 'Dummyton' }] },
      { serviceTimeId: U(5), serviceId: U(6), name: 'x', startsAt: '2026-11-20T08:30:00.000Z', ymd: '2026-11-20', rooms: [], checkedIn: [] },
    ];
    const s = aggregateServices(rows, '2026-11-13', '2026-11-14');
    expect(s.rows).toEqual([{ ymd: '2026-11-13', startsAt: '2026-11-13T08:30:00.000Z', rooms: 2, checkedIn: 1 }]);
    const text = JSON.stringify(s);
    for (const bad of ['firstName', 'Sample', 'Codeman', 'personId']) expect(text).not.toContain(bad);
    expect(NightServices.safeParse(s).success).toBe(true);
  });
});

describe('request', () => {
  const ok = { contractVersion: 1, consoleId: U(1), section: 'outbox', from: '2026-11-13T02:00:00.000Z', to: '2026-11-14T02:00:00.000Z' };
  it('accepts a 24 h and a 48 h window', () => {
    expect(NightSummaryRequest.safeParse(ok).success).toBe(true);
    expect(NightSummaryRequest.safeParse({ ...ok, to: '2026-11-15T02:00:00.000Z' }).success).toBe(true);
  });
  it('over 48 h refused; unknown section refused; extra key refused; upper-case uuid refused', () => {
    expect(NightSummaryRequest.safeParse({ ...ok, to: '2026-11-15T02:00:00.001Z' }).success).toBe(false);
    expect(NightSummaryRequest.safeParse({ ...ok, to: ok.from }).success).toBe(false);
    expect(NightSummaryRequest.safeParse({ ...ok, section: 'roster' }).success).toBe(false);
    expect(NightSummaryRequest.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(NightSummaryRequest.safeParse({ ...ok, consoleId: 'ABCDEF01-0000-4000-8000-000000000001' }).success).toBe(false);
  });
});

describe('each response schema refuses an added field', () => {
  const good: [string, { safeParse: (v: unknown) => { success: boolean } }, unknown][] = [
    ['outbox', NightOutbox, aggregateOutbox([orow()], NOW)],
    ['taps', NightTaps, aggregateTaps([trow()], 10)],
    ['errors', NightErrors, aggregateErrors([view()], 1, FROM, TO)],
    ['imports', NightImports, aggregateImports([imp({})], [], FROM, TO)],
    ['reconcile', NightReconcile, { ranAt: '2026-11-13T10:00:00.000Z', ok: true, checks: { checkins: { count: 0 }, unmatched: { error: true }, lifegroups: { count: 1, noId: 0 }, members: { count: 0 } } }],
    ['console', NightConsole, aggregateConsole([crow()], [], U(1))],
    ['services', NightServices, aggregateServices([], '2026-11-13', '2026-11-14')],
  ];
  for (const [name, schema, data] of good) {
    it(name, () => {
      expect(schema.safeParse(data).success).toBe(true);
      expect(schema.safeParse({ ...(data as object), extra: 1 }).success).toBe(false);
    });
  }
  it('reconcile is null when never run', () => { expect(NightReconcile.safeParse(null).success).toBe(true); });
  it('nested objects are strict too', () => {
    const o = aggregateOutbox([orow()], NOW);
    expect(NightOutbox.safeParse({ ...o, groups: [{ ...o.groups[0]!, extra: 1 }] }).success).toBe(false);
    expect(NightOutbox.safeParse({ ...o, latency: { ...o.latency, door: { ...o.latency.door, extra: 1 } } }).success).toBe(false);
  });
});
