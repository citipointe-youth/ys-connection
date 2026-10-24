// Connection Audit service (spec 2026-10-22 §5.6, §5.7, §7, §8). In-memory repos; bodies are the frozen fixtures.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeConnectionAuditService, maskDnc, siteYear, type AuditView } from '../services/connection-audit.service';
import { makeErrorLogService } from '../services/error-log.service';
import { InMemoryConnectionAuditRepository, InMemorySettingsRepository, InMemoryLinkRepository, InMemoryErrorLogRepository } from '../repositories/in-memory';
import { BadRequestError, ForbiddenError, ModuleDisabledError } from '../core/errors/app-error';
import type { AuditPushBody } from '../core/link-contract';
import type { AuditSnapshotV2 } from '../core/entities/connection-audit';
import type { Actor } from '../core/entities/user';

// T5 #4: import:run is admin + director only, and both see DNC phones; this switch plays a non-keep reader through get().
const dncPhones = vi.hoisted(() => ({ off: false }));
vi.mock('../services/access-control', async (orig) => {
  const m = await orig<typeof import('../services/access-control')>();
  return { ...m, canSeeDncPhones: (a: Actor) => !dncPhones.off && m.canSeeDncPhones(a) };
});

const FIX = join(__dirname, 'fixtures/elvanto-link');
const fx = (n: string) => JSON.parse(readFileSync(join(FIX, n), 'utf8'));
type OkBody = Extract<AuditPushBody, { status: 'ok' }>;
const SVC: OkBody = fx('push-audit-service.json');
const GRP: OkBody = fx('push-audit-group.json');
const TEAM: OkBody = fx('push-audit-team.json');
const YEAR = Number(SVC.exportedAt.slice(0, 4));
const NOW = new Date(Date.parse(SVC.exportedAt) + 3_600_000);
const DAY = 86_400_000;
const P1 = '9e000000-0000-4000-8000-0000000000a1';
const actor = (role: string): Actor => ({ id: `u-${role}`, role: role as any, displayName: 'T', grade: null as any, quad: null as any });
const ADMIN = actor('admin'), DIRECTOR = actor('director');

const later = <B extends AuditPushBody>(b: B, mins: number): B => ({ ...b, takenAt: new Date(Date.parse(b.takenAt) + mins * 60_000).toISOString() });
const failed = (source: AuditPushBody['source'], mins: number, reason: 'read' | 'timeout' | 'budget' | 'empty' = 'read'): AuditPushBody =>
  ({ contractVersion: 1, consoleId: SVC.consoleId, takenAt: later(SVC, mins).takenAt, exportedAt: SVC.exportedAt, source, status: 'failed', reason } as AuditPushBody);
const col = (b: OkBody, name: string) => b.headers.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
/** b plus one row: the named cells set, every other cell ''. */
const withRow = (b: OkBody, cells: Record<string, string>): OkBody => {
  const r = b.headers.map(() => '');
  for (const [k, v] of Object.entries(cells)) r[col(b, k)] = v;
  return { ...b, rows: [...b.rows, r] };
};

async function harness(o: { errorLog?: { record: (...a: any[]) => Promise<void> }; consentRows?: () => Promise<{ key: string; status: string }[]> } = {}) {
  const repo = new InMemoryConnectionAuditRepository(); await repo.init();
  const settings = new InMemorySettingsRepository(); await settings.init();
  await settings.updateSettings({ serviceMinAttendance: 1 });
  const link = new InMemoryLinkRepository();
  const errRepo = new InMemoryErrorLogRepository();
  let t = NOW;
  const errorLog = o.errorLog ?? makeErrorLogService({ repo: errRepo, now: () => t });
  const svc = makeConnectionAuditService(repo, settings, { link, errorLog, now: () => t, consentRows: o.consentRows ?? (async () => []) });
  return { svc, repo, settings, link, errRepo, setNow: (d: Date) => { t = d; } };
}
const errs = async (r: InMemoryErrorLogRepository) => Object.fromEntries((await r.list()).map((x) => [`${x.code}:${x.route}`, x.count]));
const snap = async (repo: InMemoryConnectionAuditRepository) => (await repo.findByYear(YEAR))!.snapshot as unknown as AuditSnapshotV2;
const copy = async (repo: InMemoryConnectionAuditRepository, s: string) => (await repo.sources(YEAR)).find((x) => x.source === s);

describe('ingest (spec §5.6, §8)', () => {
  it('a good service copy is stored and builds the year row', async () => {
    const h = await harness();
    expect(await h.svc.ingest(SVC, 'console')).toEqual({ applied: true, source: 'service', status: 'stored' });
    expect(await copy(h.repo, 'service')).toMatchObject({ headers: SVC.headers, rows: SVC.rows, rowCount: SVC.rows.length,
      takenAt: SVC.takenAt, exportedAt: SVC.exportedAt, fedAt: NOW.toISOString(), fedBy: 'console', lastFailedAt: null, lastFailReason: null });
    const a = (await h.repo.findByYear(YEAR))!;
    expect(a).toMatchObject({ id: String(YEAR), year: YEAR, label: String(YEAR), uploadedBy: 'console' });
    expect((a.snapshot as unknown as AuditSnapshotV2).version).toBe(2);
  });

  it('partial source failure keeps the last good copy while the other sources update', async () => {
    const h = await harness();
    await h.svc.ingest(SVC, 'console');
    await h.svc.ingest(GRP, 'console');
    const before = (await copy(h.repo, 'group'))!;
    h.setNow(new Date(NOW.getTime() + 60_000));
    expect(await h.svc.ingest(failed('group', 60), 'console')).toEqual({ applied: false, source: 'group', status: 'failed-recorded' });
    expect((await h.svc.ingest(later(TEAM, 60), 'console')).status).toBe('stored');
    const g = (await copy(h.repo, 'group'))!;
    expect(g).toMatchObject({ rows: before.rows, headers: before.headers, fedAt: before.fedAt, takenAt: before.takenAt, lastFailReason: 'read' });
    expect((await copy(h.repo, 'team'))!.fedAt).not.toBeNull();
    const s = await snap(h.repo);
    expect(s.sources.group).toMatchObject({ status: 'failed', rows: before.rowCount, lastFailReason: 'read' });
    expect(s.sources.team.status).toBe('ok');
    expect(s.sources.decision.status).toBe('missing');
  });

  it('a failure on a never-stored source writes an empty copy (fed_at null) and keeps it missing', async () => {
    const h = await harness();
    await h.svc.ingest(SVC, 'console');
    await h.svc.ingest(failed('decision', 5, 'timeout'), 'console');
    expect(await copy(h.repo, 'decision')).toMatchObject({ headers: [], rows: [], rowCount: 0, fedAt: null, fedBy: null,
      takenAt: later(SVC, 5).takenAt, exportedAt: SVC.exportedAt, lastFailReason: 'timeout' });
  });

  it('ultra #7: a failure placeholder (never fed) does not make an older real upload stale; a fed copy still does', async () => {
    const h = await harness();
    await h.svc.ingest(SVC, 'console');
    await h.svc.ingest({ ...failed('group', 0), takenAt: GRP.takenAt }, 'console');
    expect(await h.svc.ingest(later(GRP, -420), 'manual', ADMIN.id)).toEqual({ applied: true, source: 'group', status: 'stored' });
    expect((await h.svc.ingest(later(GRP, -480), 'manual', ADMIN.id)).status).toBe('stale');
  });

  it('stale takenAt → stale, nothing changes', async () => {
    const h = await harness();
    await h.svc.ingest(SVC, 'console');
    const kept = await copy(h.repo, 'service');
    const changed = { ...withRow(SVC, { 'First Name': 'Jamie', 'Last Name': 'Test' }) };
    expect(await h.svc.ingest(changed, 'console')).toEqual({ applied: false, source: 'service', status: 'stale' });       // equal takenAt
    expect(await h.svc.ingest(later(changed, -5), 'console')).toEqual({ applied: false, source: 'service', status: 'stale' }); // older
    expect(await copy(h.repo, 'service')).toEqual(kept);
  });

  it('a required column missing → shape: last good copy kept, audit-source-failed recorded', async () => {
    const h = await harness();
    await h.svc.ingest(SVC, 'console');
    const kept = (await copy(h.repo, 'service'))!;
    const bad = { ...later(SVC, 10), headers: ['Something'], rows: [['x']] };
    expect(await h.svc.ingest(bad as OkBody, 'console')).toEqual({ applied: false, source: 'service', status: 'shape' });
    expect(await copy(h.repo, 'service')).toMatchObject({ rows: kept.rows, fedAt: kept.fedAt, lastFailReason: 'shape' });
    expect((await errs(h.errRepo))['audit-source-failed:service']).toBe(1);
  });

  it('failed then good clears audit-source-failed (setCount 0)', async () => {
    const h = await harness();
    await h.svc.ingest(SVC, 'console');
    await h.svc.ingest(failed('group', 5), 'console');
    expect((await errs(h.errRepo))['audit-source-failed:group']).toBe(1);
    await h.svc.ingest(later(GRP, 10), 'console');
    expect((await errs(h.errRepo))['audit-source-failed:group']).toBeUndefined();
  });

  it('skipped counts recorded per source after each build', async () => {
    const h = await harness();
    await h.svc.ingest(SVC, 'console');
    const base = (await errs(h.errRepo))['audit-rows-skipped:service'] ?? 0;
    const two = withRow(withRow(later(SVC, 10), { 'First Name': '', 'Last Name': 'Sample' }), { 'First Name': 'Alex', 'Last Name': '' });
    await h.svc.ingest(two, 'console');
    expect((await errs(h.errRepo))['audit-rows-skipped:service']).toBe(base + 2);
    await h.svc.ingest(later(SVC, 20), 'console');                     // fixed in Elvanto -> back to the fixture's own count
    expect((await errs(h.errRepo))['audit-rows-skipped:service']).toBe(base || undefined);
  });

  it('unmatched names never written to error_log (counts only)', async () => {
    const h = await harness();                                          // empty roster: every person is unmatched
    await h.svc.ingest(withRow(SVC, { 'First Name': '', 'Last Name': 'Sample' }), 'console');
    await h.svc.ingest(GRP, 'console');
    expect((await snap(h.repo)).quality.unmatched.length).toBeGreaterThan(0);
    const fi = col(SVC, 'First Name'), li = col(SVC, 'Last Name');
    const names = SVC.rows.flatMap((r) => [r[fi]!, r[li]!]).filter((n) => n.length > 2);
    const stored = JSON.stringify(await h.errRepo.list());
    for (const n of names) expect(stored, n).not.toContain(n);
    expect(new Set((await h.errRepo.list()).map((r) => r.code))).toEqual(new Set(['audit-rows-skipped']));
  });

  it('service never fed → no year row; the other copy is kept', async () => {
    const h = await harness();
    expect((await h.svc.ingest(GRP, 'console')).status).toBe('stored');
    expect(await h.repo.findByYear(YEAR)).toBeNull();
    expect((await copy(h.repo, 'group'))!.fedAt).toBe(NOW.toISOString());
    expect(await h.errRepo.list()).toEqual([]);                         // no build -> no rows-skipped writes
  });

  it('the error_log write never throws and never undoes the ingest', async () => {
    const h = await harness({ errorLog: { record: async () => { throw new Error('db down'); } } });
    expect(await h.svc.ingest(SVC, 'console')).toEqual({ applied: true, source: 'service', status: 'stored' });
    expect(await h.repo.findByYear(YEAR)).not.toBeNull();
  });

  it('a service store clears audit-feed-stale', async () => {
    const h = await harness();
    await makeErrorLogService({ repo: h.errRepo }).record({ category: 'audit', code: 'audit-feed-stale', route: '' }, 1);
    expect((await errs(h.errRepo))['audit-feed-stale:']).toBe(1);
    await h.svc.ingest(SVC, 'console');
    expect((await errs(h.errRepo))['audit-feed-stale:']).toBeUndefined();
  });
});

describe('manual upload, reads, feed check (spec §5.6, §5.7, §7)', () => {
  const manual = (b: OkBody) => ({ headers: b.headers, rows: b.rows, exportedAt: b.exportedAt });

  it('manual upload needs admin:manage (director 403); same ingest path, fedBy manual, uploaded_by = admin id', async () => {
    const h = await harness();
    await expect(h.svc.uploadSource(DIRECTOR, 'service', manual(SVC))).rejects.toThrow(ForbiddenError);
    expect(await h.repo.sources(YEAR)).toEqual([]);
    expect(await h.svc.uploadSource(ADMIN, 'service', manual(SVC))).toEqual({ applied: true, source: 'service', status: 'stored' });
    expect(await copy(h.repo, 'service')).toMatchObject({ fedBy: 'manual', takenAt: SVC.exportedAt });
    expect((await h.repo.findByYear(YEAR))!.uploadedBy).toBe(ADMIN.id);
  });

  it('manual upload refuses an unknown source and a malformed table with BadRequestError, nothing stored', async () => {
    const h = await harness();
    await expect(h.svc.uploadSource(ADMIN, 'people', manual(SVC))).rejects.toThrow(BadRequestError);
    await expect(h.svc.uploadSource(ADMIN, 'service', { ...manual(SVC), rows: [['too', 'short']] })).rejects.toThrow(BadRequestError);
    await expect(h.svc.uploadSource(ADMIN, 'service', { ...manual(SVC), exportedAt: '2026-10-23' })).rejects.toThrow(BadRequestError);
    const future = new Date(NOW.getTime() + 2 * DAY).toISOString();   // M3: a future export date is refused
    await expect(h.svc.uploadSource(ADMIN, 'service', { ...manual(SVC), exportedAt: future })).rejects.toThrow(BadRequestError);
    expect(await h.repo.sources(YEAR)).toEqual([]);
  });

  it('list() uses the summary query (no snapshot)', async () => {
    const h = await harness();
    await h.svc.ingest(SVC, 'console');
    const all = vi.spyOn(h.repo, 'findAll');
    const sum = vi.spyOn(h.repo, 'findAllSummaries');
    const list = await h.svc.list(DIRECTOR);
    expect(all).not.toHaveBeenCalled();
    expect(sum).toHaveBeenCalledTimes(1);
    expect(list).toEqual([{ year: YEAR, label: String(YEAR), uploadedAt: NOW.toISOString(), termKeys: expect.any(Array) }]);
    expect(list[0]).not.toHaveProperty('snapshot');
  });

  it('get() masks DNC phones unless canSeeDncPhones', async () => {
    const h = await harness();
    const fi = col(SVC, 'First Name'), li = col(SVC, 'Last Name'), mi = col(SVC, 'Mobile');
    const body: OkBody = { ...SVC, rows: SVC.rows.map((r, i) => (i === 0 ? r.map((c, j) => (j === mi ? '0400000001' : c)) : r)) };
    await h.link.replaceMirror('roster', [{ personId: P1, firstName: SVC.rows[0]![fi]!, lastName: SVC.rows[0]![li]!, gender: null,
      grade: null, kind: 'student', consent: 'contact' }], { takenAt: SVC.takenAt, consoleId: SVC.consoleId });
    await h.svc.ingest(body, 'console');
    const got = (await h.svc.get(DIRECTOR, YEAR)) as AuditView;
    const me = got.snapshot.students.find((x) => x.personId === P1)!;
    expect(me).toMatchObject({ dnc: true, phone: '0400000001' });       // director: canSeeDncPhones
    const others = got.snapshot.students.filter((x) => x.personId !== P1);
    expect(others.every((x) => x.dnc === false)).toBe(true);
    // import:run is admin + director only and both see DNC phones, so the strip itself is checked on the pure helper:
    const masked = maskDnc(got.snapshot.students, [{ personId: P1, firstName: 'Zz', lastName: 'Zz', consent: 'contact' }], false);
    expect(masked.find((x) => x.personId === P1)).toMatchObject({ dnc: true, phone: null });
    expect(masked.filter((x) => x.personId !== P1)).toEqual(others);
    expect(maskDnc(got.snapshot.students, [{ personId: P1, firstName: 'Zz', lastName: 'Zz', consent: 'ok' }], false).find((x) => x.personId === P1))
      .toMatchObject({ dnc: false, phone: '0400000001' });
  });

  it('T1 (#3): an inactive DNC roster person gets an n: row that is still DNC (fail closed by name key)', async () => {
    const h = await harness();
    const fi = col(SVC, 'First Name'), li = col(SVC, 'Last Name'), mi = col(SVC, 'Mobile');
    const first = SVC.rows[0]![fi]!, last = SVC.rows[0]![li]!;
    const body: OkBody = { ...SVC, rows: SVC.rows.map((r, i) => (i === 0 ? r.map((c, j) => (j === mi ? '0400000001' : c)) : r)) };
    await h.link.replaceMirror('roster', [{ personId: P1, firstName: first, lastName: last, gender: null, grade: null, kind: 'student',
      consent: 'all' }], { takenAt: SVC.takenAt, consoleId: SVC.consoleId });
    await h.link.replaceMirror('roster', [], { takenAt: later(SVC, 1).takenAt, consoleId: SVC.consoleId }); // P1 now inactive (sticky DNC)
    await h.svc.ingest(body, 'console');
    const got = (await h.svc.get(ADMIN, YEAR)) as AuditView;
    const me = got.snapshot.students.find((x) => x.firstName === first && x.lastName === last)!;
    expect(me.personId).toBeNull();                                      // identify uses active rows only
    expect(me).toMatchObject({ dnc: true, phone: '0400000001' });        // admin keeps the number
    const masked = maskDnc(got.snapshot.students, await h.link.roster(), false);
    expect(masked.find((x) => x.id === me.id)).toMatchObject({ dnc: true, phone: null });
  });

  it('T2 (#8 #9 #14): get() marks consentPending per student; it opens itself at the consent Friday 9:00 with no rebuild', async () => {
    const CON: OkBody = fx('push-audit-connect.json');                  // an unmatched connect dated Wed 14/10 -> consent Fri 16 Oct
    const fi = col(SVC, 'First Name'), li = col(SVC, 'Last Name');
    const [a, b] = [SVC.rows[0]!, SVC.rows[1]!];
    const P2 = '9e000000-0000-4000-8000-0000000000a2', NPN = 'Brisbane - Youth - New People 2026';
    const h = await harness({ consentRows: async () => [{ key: P2, status: 'ready' }] });
    const st = await h.settings.getSettings();
    await h.settings.updateSettings({ ministryConfig: { ...st.ministryConfig, elvanto: { ...st.ministryConfig.elvanto,
      peopleFlowPrefix: 'Brisbane - Youth - New People' } } } as never);
    await h.link.replaceMirror('roster', [
      { personId: P1, firstName: a[fi]!, lastName: a[li]!, gender: null, grade: null, kind: 'student', consent: 'unknown' },
      { personId: P2, firstName: b[fi]!, lastName: b[li]!, gender: null, grade: null, kind: 'student', consent: 'unknown' },
    ], { takenAt: SVC.takenAt, consoleId: SVC.consoleId });
    // P1 waits on New People step 0, due Fri 16 Oct -> consent Fri 23 Oct; P2's Friday passed long ago but its consent row is open
    await h.link.replaceMirror('flows', [{ rowId: 'r1', flowId: 'f', flowName: NPN, stepId: 's0', stepName: 'Step 0 - wait', stepOrder: 1,
      personId: P1, name: 'Synthetic Kid', due: '2026-10-16', assignedTo: '', grade: 9, gender: 'male', mobile: null, mobileIsParent: false,
      consent: 'unknown' }, { rowId: 'r2', flowId: 'f', flowName: NPN, stepId: 's0', stepName: 'Step 0 - wait', stepOrder: 1, personId: P2,
      name: 'Synthetic Kid', due: '2026-10-01', assignedTo: '', grade: 9, gender: 'female', mobile: null, mobileIsParent: false,
      consent: 'unknown' }] as never, { takenAt: SVC.takenAt, consoleId: SVC.consoleId });
    await h.svc.ingest(SVC, 'console');
    await h.svc.ingest(CON, 'console');
    const pending = async (at: string) => {
      h.setNow(new Date(at));
      const got = (await h.svc.get(ADMIN, YEAR)) as AuditView;
      const by = (f: string) => got.snapshot.students.find((x) => x.firstName === f)!.consentPending;
      return [by(a[fi]!), by(b[fi]!), by(CON.rows[0]![0]!)];
    };
    expect(await pending('2026-10-15T22:59:00.000Z')).toEqual([true, true, true]);   // Fri 16 Oct 8:59 Brisbane
    expect(await pending('2026-10-15T23:00:00.000Z')).toEqual([true, true, false]);  // 9:00: the connect's Friday passed
    expect(await pending('2026-10-22T23:00:00.000Z')).toEqual([false, true, false]); // Fri 23 Oct 9:00: step 0's Friday passed
  });

  it('T2: a DNC person is consent-decided (stays on the list as Do not contact), never pending', async () => {
    const fi = col(SVC, 'First Name'), li = col(SVC, 'Last Name');
    const h = await harness();
    await h.link.replaceMirror('roster', [{ personId: P1, firstName: SVC.rows[0]![fi]!, lastName: SVC.rows[0]![li]!, gender: null,
      grade: null, kind: 'student', consent: 'contact' }], { takenAt: SVC.takenAt, consoleId: SVC.consoleId });
    await h.svc.ingest(SVC, 'console');
    h.setNow(new Date('2026-10-15T22:00:00.000Z'));
    const got = (await h.svc.get(ADMIN, YEAR)) as AuditView;
    expect(got.snapshot.students.find((x) => x.personId === P1)).toMatchObject({ dnc: true, consentPending: false });
  });

  it('Fix 1 (I1): DNC on the step-0 flow row only (roster unknown) is DNC: "Do not contact", never pending', async () => {
    const fi = col(SVC, 'First Name'), li = col(SVC, 'Last Name'), a = SVC.rows[0]!;
    const h = await harness();
    const st = await h.settings.getSettings();
    await h.settings.updateSettings({ ministryConfig: { ...st.ministryConfig, elvanto: { ...st.ministryConfig.elvanto,
      peopleFlowPrefix: 'Brisbane - Youth - New People' } } } as never);
    await h.link.replaceMirror('roster', [{ personId: P1, firstName: a[fi]!, lastName: a[li]!, gender: null, grade: null, kind: 'student',
      consent: 'unknown' }], { takenAt: SVC.takenAt, consoleId: SVC.consoleId });
    await h.link.replaceMirror('flows', [{ rowId: 'r1', flowId: 'f', flowName: 'Brisbane - Youth - New People 2026', stepId: 's0',
      stepName: 'Step 0 - wait', stepOrder: 1, personId: P1, name: 'Synthetic Kid', due: '2026-10-16', assignedTo: '', grade: 9,
      gender: 'male', mobile: null, mobileIsParent: false, consent: 'contact' }] as never, { takenAt: SVC.takenAt, consoleId: SVC.consoleId });
    await h.svc.ingest(SVC, 'console');
    h.setNow(new Date('2026-10-15T22:00:00.000Z'));                       // inside the consent week
    const got = (await h.svc.get(ADMIN, YEAR)) as AuditView;
    expect(got.snapshot.students.find((x) => x.personId === P1)).toMatchObject({ dnc: true, consentPending: false });
  });

  it('T1 (#3): a namesake pair where one is DNC makes the ambiguous n: row DNC; matched rows are untouched', () => {
    const s = (id: string, personId: string | null, firstName: string, lastName: string) => ({ id, personId, firstName, lastName,
      gender: 'male' as const, grade: 9, quad: null, caOnly: false, team: false, connect: null, decision: null, lastSeen: null,
      phone: '0400000009', phoneIsParent: false });
    const roster = [
      { personId: 'pa', firstName: 'Testa', lastName: "O'Synth", consent: 'contact' as const },
      { personId: 'pb', firstName: 'testa', lastName: 'OSynth', consent: 'ok' as const },
      { personId: 'pc', firstName: 'Other', lastName: 'Synth', consent: 'ok' as const },
    ];
    const out = maskDnc([s('n:testa|osynth', null, 'Testa', "O'Synth"), s('pc', 'pc', 'Other', 'Synth'), s('n:nobody|synth', null, 'Nobody', 'Synth')], roster, false);
    expect(out.map((x) => [x.dnc, x.phone])).toEqual([[true, null], [false, '0400000009'], [false, '0400000009']]);
  });

  it('v1 snapshot upgraded on read', async () => {
    const h = await harness();
    await h.repo.save({ id: '2025', year: 2025, label: '2025 (year-to-date)', uploadedBy: 'Test', uploadedAt: '2025-12-01T00:00:00.000Z',
      snapshot: { generatedAt: '2025-12-01T00:00:00.000Z', dataStartDate: null, dataEndDate: null, terms: [], students: [], perTerm: {},
        lgStatsByTerm: {}, uploads: { team: [], connect: [], decision: [], flows: [] } } as never });
    const got = (await h.svc.get(ADMIN, 2025)) as AuditView;
    expect(got.snapshot.version).toBe(2);
    expect(got.snapshot).not.toHaveProperty('uploads');
    expect(got.label).toBe('2025 (year-to-date)');
    expect(await h.svc.get(ADMIN, 2024)).toBeNull();
    await h.svc.remove(ADMIN, 2025);
    expect(await h.repo.findByYear(2025)).toBeNull();
  });

  it('a null/corrupt stored snapshot never 500s list/get (read as no year row)', async () => {
    const h = await harness();
    await h.repo.save({ id: '2024', year: 2024, label: '2024', uploadedBy: 'Test', uploadedAt: '2024-12-01T00:00:00.000Z', snapshot: null as never });
    expect(await h.svc.get(ADMIN, 2024)).toBeNull();
    expect(await h.svc.list(ADMIN)).toEqual([{ year: 2024, label: '2024', uploadedAt: '2024-12-01T00:00:00.000Z', termKeys: [] }]);
  });

  it("get() with copies but no year row returns each list's status (spec §6.1 empty state); nothing at all -> null", async () => {
    const h = await harness();
    expect(await h.svc.get(ADMIN, YEAR)).toBeNull();
    await h.svc.ingest(GRP, 'console');                                   // no service copy -> no year row
    const got = (await h.svc.get(ADMIN, YEAR)) as unknown as { year: number; snapshot: null; sources: AuditSnapshotV2['sources'] };
    expect(got).toMatchObject({ year: YEAR, snapshot: null });
    expect(got.sources.group.status).toBe('ok');
    expect(got.sources.service.status).toBe('missing');
  });

  it('siteYear: the site calendar year decides, not UTC (01:00 on 1 Jan in Brisbane is 31 Dec in UTC)', () => {
    expect(siteYear(new Date('2025-12-31T15:00:00.000Z'), 'Australia/Brisbane')).toBe(2026);
    expect(siteYear(new Date('2025-12-31T13:59:00.000Z'), 'Australia/Brisbane')).toBe(2025);
  });

  it('checkFeed: audit-feed-stale is 1 past 8 days since the service feed, 0 otherwise, nothing without a year row', async () => {
    const h = await harness();
    await h.svc.checkFeed();
    expect((await errs(h.errRepo))['audit-feed-stale:']).toBeUndefined();   // no year row
    await h.svc.ingest(SVC, 'console');
    h.setNow(new Date(NOW.getTime() + 8 * DAY));
    await h.svc.checkFeed();
    expect((await errs(h.errRepo))['audit-feed-stale:']).toBeUndefined();   // exactly 8 days: not stale
    h.setNow(new Date(NOW.getTime() + 9 * DAY));
    await h.svc.checkFeed();
    expect((await errs(h.errRepo))['audit-feed-stale:']).toBe(1);
    await h.svc.ingest(later(SVC, 9 * 24 * 60), 'console');
    expect((await errs(h.errRepo))['audit-feed-stale:']).toBeUndefined();   // a service store clears it
  });

  it('checkFeed: a v1 year row (never fed) is not stale however old, so no false "Act now" before the first push (I1)', async () => {
    const h = await harness();
    await h.repo.save({ id: String(YEAR), year: YEAR, label: String(YEAR), uploadedBy: 'Test', uploadedAt: new Date(NOW.getTime() - 60 * DAY).toISOString(),
      snapshot: { generatedAt: NOW.toISOString(), dataStartDate: null, dataEndDate: null, terms: [], students: [], perTerm: {},
        lgStatsByTerm: {}, uploads: { team: [], connect: [], decision: [], flows: [] } } as never });
    await h.svc.checkFeed();
    expect((await errs(h.errRepo))['audit-feed-stale:']).toBeUndefined();
  });

  it('checkFeed never throws', async () => {
    const h = await harness({ errorLog: { record: async () => { throw new Error('x'); } } });
    h.repo.findByYear = async () => { throw new Error('db'); };
    await expect(h.svc.checkFeed()).resolves.toBeUndefined();
  });
});

describe('T5: a missing phone is filled from the person\'s flow row (consent audit E)', () => {
  const CON: OkBody = fx('push-audit-connect.json');                   // one connect-only row, Riley Sample, no phone cells
  const [CF, CL] = [CON.rows[0]![0]!, CON.rows[0]![1]!];
  const P3 = '9e000000-0000-4000-8000-0000000000a3', P4 = '9e000000-0000-4000-8000-0000000000a4';
  const NPN = 'Brisbane - Youth - New People 2026';
  const meta = { takenAt: SVC.takenAt, consoleId: SVC.consoleId };
  const ros = (personId: string, firstName: string, lastName: string, consent = 'ok') =>
    ({ personId, firstName, lastName, gender: null, grade: null, kind: 'student', consent });
  const fl = (o: Record<string, unknown>) => ({ rowId: `r${Math.random()}`, flowId: 'f', flowName: NPN, stepId: 's1', stepName: 'Step 1 - call',
    stepOrder: 2, personId: P3, name: 'Synthetic Kid', due: '2026-10-01', assignedTo: '', grade: 9, gender: 'female', mobile: '0400000077',
    mobileIsParent: false, consent: 'ok', ...o });
  async function setup(roster: unknown[], flows: unknown[], bodies: AuditPushBody[] = [SVC, CON]) {
    const h = await harness();
    const st = await h.settings.getSettings();
    await h.settings.updateSettings({ ministryConfig: { ...st.ministryConfig, elvanto: { ...st.ministryConfig.elvanto,
      peopleFlowPrefix: 'Brisbane - Youth - New People' } } } as never);
    await h.link.replaceMirror('roster', roster, meta);
    await h.link.replaceMirror('flows', flows, meta);
    for (const b of bodies) await h.svc.ingest(b, 'console');
    return h;
  }
  const riley = (got: AuditView) => got.snapshot.students.find((x) => x.firstName === CF && x.lastName === CL)!;

  it('#1: a matched connect-only student gets the New People flow mobile (parent flag carried), preferred over another flow; never stored', async () => {
    const h = await setup([ros(P3, CF, CL)], [fl({ flowName: 'Brisbane - Youth - Leaders', mobile: '0400000066' }),
      fl({ mobile: '0400000077', mobileIsParent: true })]);
    const save = vi.spyOn(h.repo, 'save');
    const got = (await h.svc.get(ADMIN, YEAR)) as AuditView;
    expect(riley(got)).toMatchObject({ personId: P3, phone: '0400000077', phoneIsParent: true, dnc: false });
    expect(save).not.toHaveBeenCalled();
    expect(JSON.stringify(await snap(h.repo))).not.toContain('0400000077');
  });

  it('#1b: with no New People row, the first flow row with a mobile is used', async () => {
    const h = await setup([ros(P3, CF, CL)], [fl({ flowName: 'Other A', mobile: null }), fl({ flowName: 'Other B', mobile: '0400000066' }),
      fl({ flowName: 'Other C', mobile: '0400000055' })]);
    expect(riley((await h.svc.get(ADMIN, YEAR)) as AuditView)).toMatchObject({ phone: '0400000066', phoneIsParent: false });
  });

  it('#2: a service-list phone is kept over a different flow mobile', async () => {
    const fi = col(SVC, 'First Name'), li = col(SVC, 'Last Name'), mi = col(SVC, 'Mobile');
    const body: OkBody = { ...SVC, rows: SVC.rows.map((r, i) => (i === 0 ? r.map((c, j) => (j === mi ? '0400000001' : c)) : r)) };
    const h = await setup([ros(P1, SVC.rows[0]![fi]!, SVC.rows[0]![li]!)], [fl({ personId: P1, mobile: '0400000055' })], [body]);
    const got = (await h.svc.get(ADMIN, YEAR)) as AuditView;
    expect(got.snapshot.students.find((x) => x.personId === P1)).toMatchObject({ phone: '0400000001' });
  });

  it('#3: unmatched (n:) and ambiguous students get no flow phone, even when a flow row carries their name (no name join)', async () => {
    const name = `${CF} ${CL}`;
    for (const roster of [[], [ros(P3, CF, CL), ros(P4, CF, CL)]]) {      // nobody / a namesake pair (ambiguous)
      const h = await setup(roster, [fl({ name }), fl({ personId: P4, name })]);
      const me = riley((await h.svc.get(ADMIN, YEAR)) as AuditView);
      expect(me.id.startsWith('n:')).toBe(true);
      expect(me).toMatchObject({ personId: null, phone: null });
    }
  });

  it('#4: a DNC flow row (roster not DNC, any step) makes the person DNC: admin/director keep the number, others do not', async () => {
    const h = await setup([ros(P3, CF, CL, 'ok')], [fl({ consent: 'contact' })]);
    expect(riley((await h.svc.get(DIRECTOR, YEAR)) as AuditView)).toMatchObject({ dnc: true, phone: '0400000077' });
    dncPhones.off = true;
    try {
      expect(riley((await h.svc.get(ADMIN, YEAR)) as AuditView)).toMatchObject({ dnc: true, phone: null });
    } finally { dncPhones.off = false; }
  });

  it('#5: flow rows with no personId or no mobile are ignored', async () => {
    const h = await setup([ros(P3, CF, CL)], [fl({ personId: null }), fl({ mobile: null })]);
    expect(riley((await h.svc.get(ADMIN, YEAR)) as AuditView)).toMatchObject({ personId: P3, phone: null });
  });

  it('fix 1: DNC only on a later step (step-0 row + roster not DNC) is decided: dnc, never consentPending', async () => {
    const h = await setup([ros(P3, CF, CL, 'unknown')], [fl({ stepId: 's0', stepName: 'Step 0 - wait', stepOrder: 1, due: '2026-10-16',
      consent: 'unknown' }), fl({ flowName: 'Brisbane - Youth - Leaders', consent: 'contact' })]);
    h.setNow(new Date('2026-10-15T22:00:00.000Z'));                       // inside the consent week
    expect(riley((await h.svc.get(ADMIN, YEAR)) as AuditView)).toMatchObject({ dnc: true, consentPending: false });
  });

  it('#6 (with T2): a step-0 person inside the consent week gets the phone but stays consentPending', async () => {
    const h = await setup([ros(P3, CF, CL, 'unknown')], [fl({ stepId: 's0', stepName: 'Step 0 - wait', stepOrder: 1, due: '2026-10-16',
      consent: 'unknown' })]);
    h.setNow(new Date('2026-10-15T22:00:00.000Z'));
    expect(riley((await h.svc.get(ADMIN, YEAR)) as AuditView)).toMatchObject({ phone: '0400000077', consentPending: true });
  });
});

describe('modules.connectionAudit toggle', () => {
  async function disable(settings: InMemorySettingsRepository) {
    const c = await settings.getSettings();
    await settings.updateSettings({ ministryConfig: { ...c.ministryConfig, modules: { ...c.ministryConfig.modules, connectionAudit: false } } });
  }
  it('uploadSource/list/get/remove/exportAll/importAll throw ModuleDisabledError when off; the console push is still stored', async () => {
    const h = await harness();
    await disable(h.settings);
    await expect(h.svc.uploadSource(ADMIN, 'service', { headers: SVC.headers, rows: SVC.rows, exportedAt: SVC.exportedAt })).rejects.toThrow(ModuleDisabledError);
    await expect(h.svc.list(ADMIN)).rejects.toThrow(ModuleDisabledError);
    await expect(h.svc.get(ADMIN, YEAR)).rejects.toThrow(ModuleDisabledError);
    await expect(h.svc.remove(ADMIN, YEAR)).rejects.toThrow(ModuleDisabledError);
    await expect(h.svc.exportAll(ADMIN)).rejects.toThrow(ModuleDisabledError);
    await expect(h.svc.importAll(ADMIN, [])).rejects.toThrow(ModuleDisabledError);
    expect((await h.svc.ingest(SVC, 'console')).status).toBe('stored');
    const c = await h.settings.getSettings();                           // back on: nothing was dropped while off
    await h.settings.updateSettings({ ministryConfig: { ...c.ministryConfig, modules: { ...c.ministryConfig.modules, connectionAudit: true } } });
    expect(await h.svc.list(ADMIN)).toHaveLength(1);
  });
  it('rejects a non-director/admin read', async () => {
    const h = await harness();
    await expect(h.svc.list(actor('grade'))).rejects.toThrow(ForbiddenError);
  });
});

describe('audit routes', () => {
  it('POST /audits is gone; POST /audits/sources/:source is the manual upload (auth)', async () => {
    const { buildContainer } = await import('../container');
    const { buildRoutes } = await import('../api/http/router');
    const routes = buildRoutes((await buildContainer()).services).filter((r) => r.path.startsWith('/audits'));
    expect(routes.some((r) => r.method === 'POST' && r.path === '/audits')).toBe(false);
    expect(routes.find((r) => r.method === 'POST' && r.path === '/audits/sources/:source')).toMatchObject({ auth: true });
  });
});
