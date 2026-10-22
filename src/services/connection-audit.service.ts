// Connection Audit (spec 2026-10-22). The console pushes one Elvanto source per body (sync push 'audit', rev 16); an admin
// can upload the same cell table by hand. Both go through ingest(): store that (year, source) copy, rebuild the year from
// every stored copy (parsing lives in audit-parse, the build in audit-build), then write the error_log state, counts only.
import { z } from 'zod';
import { assertCan, canSeeDncPhones } from './access-control';
import type { IConnectionAuditRepository, ISettingsRepository, AuditSummary } from '../repositories/interfaces/entity-repositories';
import type { ILinkRepository } from '../repositories/interfaces/link.repository';
import type { Actor } from '../core/entities/user';
import type { ConnectionAudit, AuditSnapshotV2, AuditSource, SourceMeta, StoredAuditSource } from '../core/entities/connection-audit';
import { AUDIT_SOURCES, AuditPush, LINK_CONTRACT_VERSION, isDnc, type AuditPushBody } from '../core/link-contract';
import type { LinkRosterRow } from '../core/link-types';
import { BadRequestError, ModuleDisabledError } from '../core/errors/app-error';
import type { AppSettings } from '../core/entities/settings';
import type { ErrorLogService } from './error-log.service';
import { brisbaneToday } from './link-rules';
import { parseSource } from './audit-parse';
import { auditConfigOf, buildYear, sourcesMeta } from './audit-build';
import { upgradeSnapshot } from './audit-upgrade';

export type { AuditSummary } from '../repositories/interfaces/entity-repositories';

const DAY = 86_400_000;
const FEED_STALE_MS = 8 * DAY;
/** The manual upload's envelope consoleId: the Zod needs one; never a real console. */
const MANUAL_CONSOLE = '00000000-0000-4000-8000-000000000000';

export type IngestStatus = 'stored' | 'stale' | 'shape' | 'failed-recorded';
export interface IngestResult { applied: boolean; source: AuditSource; status: IngestStatus }
export type AuditStudentView = AuditSnapshotV2['students'][number] & { dnc: boolean };
export type AuditView = Omit<ConnectionAudit, 'snapshot'> & { snapshot: Omit<AuditSnapshotV2, 'students'> & { students: AuditStudentView[] } };
/** A year with stored source copies but no year row yet (Youth service never stored): the per-list status only (spec §6.1). */
export interface AuditSourcesView { year: number; snapshot: null; sources: Record<AuditSource, SourceMeta> }

// Service-level module-disabled guard (house rule: validation inside services). The console's push (ingest) does not
// check it: the copies are kept while the screens are off, as the year rows are (toggle test below).
function requireCaModule(settings: AppSettings): void {
  if (settings.ministryConfig.modules.connectionAudit === false) throw new ModuleDisabledError('Connection Audit');
}

/** The audit's calendar year: the site-time year of `at` (spec §5.3). */
export const siteYear = (at: Date, tz: string): number => Number(brisbaneToday(at, tz).slice(0, 4));

/** R1: every student gets `dnc`; a DO NOT CONTACT person's phone is nulled unless `keep` (canSeeDncPhones). Read time only. */
export function maskDnc(students: AuditSnapshotV2['students'], roster: readonly Pick<LinkRosterRow, 'personId' | 'consent'>[], keep: boolean): AuditStudentView[] {
  const dnc = new Set(roster.filter((r) => isDnc(r.consent)).map((r) => r.personId));
  return students.map((s) => {
    const d = !!s.personId && dnc.has(s.personId);
    return { ...s, dnc: d, phone: d && !keep ? null : s.phone };
  });
}

const ImportAllSchema = z.array(z.object({
  id: z.string(), year: z.number(), label: z.string(), uploadedBy: z.string(), uploadedAt: z.string(), snapshot: z.unknown(),
}));

export interface ConnectionAuditDeps {
  link: Pick<ILinkRepository, 'roster'>;
  errorLog: Pick<ErrorLogService, 'record'>;
  now?: () => Date;
}

export interface ConnectionAuditService {
  ingest(body: AuditPushBody, by: 'console' | 'manual', actorId?: string): Promise<IngestResult>;
  /** POST /audits/sources/:source (admin:manage): body {headers, rows, exportedAt}; takenAt = exportedAt. */
  uploadSource(actor: Actor, source: string, body: unknown): Promise<IngestResult>;
  list(actor: Actor): Promise<AuditSummary[]>;
  get(actor: Actor, year: number): Promise<AuditView | AuditSourcesView | null>;
  remove(actor: Actor, year: number): Promise<void>;
  exportAll(actor: Actor): Promise<ConnectionAudit[]>;
  importAll(actor: Actor, input: unknown): Promise<{ imported: number }>;
  /** audit-feed-stale (spec §7): 1 when the year row exists and its newest service feed is > 8 days old, else 0. Never throws. */
  checkFeed(): Promise<void>;
}

export function makeConnectionAuditService(
  repo: IConnectionAuditRepository,
  settingsRepo: ISettingsRepository,
  d: ConnectionAuditDeps,
): ConnectionAuditService {
  const now = d.now ?? (() => new Date());

  async function ingest(body: AuditPushBody, by: 'console' | 'manual', actorId?: string): Promise<IngestResult> {
    const cfg = auditConfigOf(await settingsRepo.getSettings());
    const year = siteYear(new Date(body.exportedAt), cfg.timeZone);
    const source = body.source;
    const roster = (await d.link.roster()).filter((r) => r.active);
    const out = await repo.withYearLock(year, async (tx) => {
      const at = now().toISOString();
      const prev = (await tx.sources(year)).find((s) => s.source === source) ?? null;
      if (prev && Date.parse(body.takenAt) <= Date.parse(prev.takenAt)) return { status: 'stale' as IngestStatus, skipped: null };
      // A failure keeps the stored rows; a never-stored source gets an empty copy (spec §9).
      const fail = (reason: NonNullable<StoredAuditSource['lastFailReason']>): StoredAuditSource => prev
        ? { ...prev, lastFailedAt: at, lastFailReason: reason }
        : { year, source, headers: [], rows: [], rowCount: 0, takenAt: body.takenAt, exportedAt: body.exportedAt,
          fedAt: null, fedBy: null, lastFailedAt: at, lastFailReason: reason };
      let status: IngestStatus;
      if (body.status === 'failed') {
        await tx.saveSource(fail(body.reason)); status = 'failed-recorded';
      } else if (parseSource(source, { headers: body.headers, rows: body.rows }, { ...cfg, exportedAt: body.exportedAt }).shape) {
        await tx.saveSource(fail('shape')); status = 'shape';
      } else {
        await tx.saveSource({ year, source, headers: body.headers, rows: body.rows, rowCount: body.rows.length, takenAt: body.takenAt,
          exportedAt: body.exportedAt, fedAt: at, fedBy: by, lastFailedAt: null, lastFailReason: null });
        status = 'stored';
      }
      const all = await tx.sources(year);
      if (!all.some((s) => s.source === 'service' && s.fedAt)) return { status, skipped: null }; // no year row until service fed
      const snapshot = buildYear(year, all, roster, cfg, now());
      await tx.save({ id: String(year), year, label: String(year), uploadedBy: by === 'manual' ? actorId ?? 'manual' : 'console',
        uploadedAt: at, snapshot });
      const skipped = AUDIT_SOURCES.map((s) => [s, snapshot.quality.skipped.filter((q) => q.source === s).reduce((n, q) => n + q.count, 0)] as const);
      return { status, skipped };
    });
    // After commit (spec §5.6 step 6). Counts only, never a name; record() never throws, the catch is the belt.
    const rec = (code: string, route: string, n: number) => d.errorLog.record({ category: 'audit', code, route }, n);
    const writes: Promise<void>[] = [];
    if (out.status === 'failed-recorded' || out.status === 'shape') writes.push(rec('audit-source-failed', source, 1));
    if (out.status === 'stored') {
      writes.push(rec('audit-source-failed', source, 0));
      if (source === 'service') writes.push(rec('audit-feed-stale', '', 0));
    }
    for (const [s, n] of out.skipped ?? []) writes.push(rec('audit-rows-skipped', s, n));
    await Promise.all(writes.map((w) => w.catch(() => undefined)));
    return { applied: out.status === 'stored', source, status: out.status };
  }

  return {
    ingest,

    async uploadSource(actor, source, body) {
      assertCan(actor, 'admin:manage');
      requireCaModule(await settingsRepo.getSettings());
      const b = (body ?? {}) as Record<string, unknown>;
      // The push's own Zod (caps, row length, form header allowlist, Iso), so the manual path is the same code path.
      const r = AuditPush.safeParse({ contractVersion: LINK_CONTRACT_VERSION, consoleId: MANUAL_CONSOLE, takenAt: b['exportedAt'],
        exportedAt: b['exportedAt'], source, status: 'ok', headers: b['headers'], rows: b['rows'] });
      // A future export date would beat every console push until that date (+1 day covers time zones).
      if (!r.success || Date.parse(r.data.exportedAt) > now().getTime() + 86_400_000)
        throw new BadRequestError("This file doesn't fit that source. Check it's the right export and the date.");
      return ingest(r.data, 'manual', actor.id);
    },

    async list(actor) {
      assertCan(actor, 'import:run');
      requireCaModule(await settingsRepo.getSettings());
      return repo.findAllSummaries();
    },

    async get(actor, year) {
      assertCan(actor, 'import:run');
      requireCaModule(await settingsRepo.getSettings());
      const a = await repo.findByYear(year);
      let snap: AuditSnapshotV2 | null = null;
      // A null/corrupt stored snapshot must not 500 the read: it is answered as "no year row" (the next feed rebuilds it).
      try { if (a) snap = upgradeSnapshot(a.snapshot); } catch { snap = null; }
      if (!a || !snap) { // spec §6.1: no year row yet, but the footer still shows each list's status
        const copies = await repo.sources(year);
        return copies.length ? { year, snapshot: null, sources: sourcesMeta(copies, year) } : null;
      }
      return { ...a, snapshot: { ...snap, students: maskDnc(snap.students, await d.link.roster(), canSeeDncPhones(actor)) } };
    },

    async remove(actor, year) {
      assertCan(actor, 'import:run');
      requireCaModule(await settingsRepo.getSettings());
      await repo.delete(String(year));
    },

    async exportAll(actor) {
      assertCan(actor, 'admin:manage');
      requireCaModule(await settingsRepo.getSettings());
      return (await repo.findAll()).sort((a, b) => a.year - b.year);
    },

    async importAll(actor, input) {
      assertCan(actor, 'admin:manage');
      requireCaModule(await settingsRepo.getSettings());
      const rows = ImportAllSchema.parse(input);
      for (const row of rows) await repo.save(row as unknown as ConnectionAudit);
      return { imported: rows.length };
    },

    async checkFeed() {
      try {
        const s = await settingsRepo.getSettings();
        const t = now();
        const row = await repo.findByYear(siteYear(t, s.ministryConfig.structure.timeZone));
        // ponytail: reads the whole year row; a fed_at column read if GET /admin/errors gets slow. Only a fed row ages: a v1
        // row (never fed) is not stale, so no false "Act now" before the first console push (spec §7: the service fedAt).
        const fedAt = (row?.snapshot as Partial<AuditSnapshotV2> | null | undefined)?.sources?.service?.fedAt ?? null;
        const n = fedAt && t.getTime() - Date.parse(fedAt) > FEED_STALE_MS ? 1 : 0;
        await d.errorLog.record({ category: 'audit', code: 'audit-feed-stale', route: '' }, n);
      } catch { /* never throws: the admin view and the console's latest() must still answer */ }
    },
  };
}
