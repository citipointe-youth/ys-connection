// The console's side of the Elvanto link: /sync/claim, /sync/result, /sync/push/:kind
// (spec docs/superpowers/specs/2026-10-12-elvanto-link-app-design.md §8.1; contract §3).
// Called after the sync-token check. Never logs a body or a note: claimed notes are decrypted.
import type { z } from 'zod';
import { ClaimRequest, INTAKE_TYPES, LINK_CONTRACT_VERSION, LINK_REV, PUSH_KINDS, PUSH_SCHEMAS, ResultRequest } from '../core/link-contract';
import type { ClaimResponse, PushResponse } from '../core/link-contract';
import { LinkContractMismatch, SyncValidation } from '../core/errors/link-errors';
import type { ClaimArgs, MirrorKind, PushKind, ResultReply } from '../core/link-types';
import type { ConsentPush, IntakePush } from '../core/link-contract';
import type { IntakeService } from './link-intake.service';
import type { ILinkRepository } from '../repositories/interfaces/link.repository';
import type { ISettingsRepository, IStudentRepository, IUserRepository } from '../repositories/interfaces/entity-repositories';
import { ATTRIBUTED_TYPES, LEASE_LOST_MS, LINK_CUTOFF_DAYS, attributedNote, autoMatch } from './link-rules';
import { parseGroupName } from './import.service';
import type { ErrorLogService } from './error-log.service';

export interface SyncDeps {
  link: ILinkRepository; settings: ISettingsRepository; students: IStudentRepository; users: IUserRepository;
  now?: () => Date;
  /** T3: refused / unclear / expired rows go to the admin Error log (type + reason only). */
  errorLog?: Pick<ErrorLogService, 'record'>;
  /** T4 (X19): the claim hint and the intakePlan / consentPlan pushes. Without it those pushes are not applied. */
  intake?: Pick<IntakeService, 'hint' | 'push'>;
}

/** Version first (from the raw body), then Zod. Issues carry path + message only, never a value. */
function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const v = body !== null && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>).contractVersion : undefined;
  if (typeof v !== 'number') throw new SyncValidation([{ path: 'contractVersion', message: 'Required number' }]);
  if (v !== LINK_CONTRACT_VERSION) throw new LinkContractMismatch();
  const r = schema.safeParse(body);
  if (!r.success) throw new SyncValidation(r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}

export function makeSyncService(d: SyncDeps) {
  const now = d.now ?? (() => new Date());

  return {
    async claim(body: unknown): Promise<z.infer<typeof ClaimResponse>> {
      const req = parseBody(ClaimRequest, body);
      const settings = await d.settings.getSettings();
      // Off is the stop button: heartbeat + sweep still run, nothing is leased while every link screen is off (T10).
      // ponytail: one screen on leases every type; rows of an off screen cannot be queued, only ones from before.
      const m = settings.ministryConfig.modules;
      const max = (['checkin', 'lifegroupReport', 'flows'] as const).every((f) => (m[f] ?? m.newYouthForms) === 'off')
        && (m.intakeAdmin ?? 'off') === 'off' ? 0 : req.max;
      const swept: NonNullable<ClaimArgs['swept']> = [];
      // Intake off: strip the four intake keys, so a queued row (an irreversible intakeText SMS included) is never leased.
      const capabilities = { ...req.capabilities };
      if ((m.intakeAdmin ?? 'off') === 'off') for (const t of INTAKE_TYPES) delete capabilities[t];
      const claimed = await d.link.claim({
        console: { consoleId: req.consoleId, label: req.consoleLabel, contractVersion: req.contractVersion,
          consoleVersion: req.consoleVersion, inWindow: req.inWindow, pollSeconds: req.pollSeconds,
          capabilities, linkRev: req.linkRev ?? 1 },
        max, leaseSeconds: req.leaseSeconds, cutoffDays: LINK_CUTOFF_DAYS, leaseLostMs: LEASE_LOST_MS, swept,
      });
      const ok = claimed.filter((c) => !c.noteUnreadable); // the repo already stored those as refused
      if (d.errorLog) {
        // One write per (type, reason) with its count, all in parallel: a bounded batch, not one awaited write per row.
        const groups = new Map<string, { code: string; route: string; count: number }>();
        const add = (code: string, route: string) => {
          const g = groups.get(`${route}|${code}`);
          if (g) g.count++; else groups.set(`${route}|${code}`, { code, route, count: 1 });
        };
        for (const s of swept) add(s.reason, s.type);
        for (const c of claimed) if (c.noteUnreadable) add('note-unreadable', c.row.type);
        await Promise.all([...groups.values()].map((g) => d.errorLog!.record({ category: 'link', ...g, role: 'console' })));
      }
      const logins = new Map<string, string>();
      for (const id of new Set(ok.map((c) => c.row.createdBy))) {
        logins.set(id, (await d.users.findById(id))?.email ?? '');
      }
      return {
        contractVersion: LINK_CONTRACT_VERSION,
        serverTime: now().toISOString(),
        rows: ok.map(({ row, reclaimed }) => ({
          id: row.id, type: row.type, attempts: row.attempts, reclaimed, createdAt: row.createdAt,
          serviceDate: row.serviceDate, by: { login: logins.get(row.createdBy) ?? '', leaderName: row.leaderName },
          payload: row.payload,
          // X1 (ledger 25 D2, reverses 17): the app prefixes the "I am" leader; the stored note stays their own words.
          note: ATTRIBUTED_TYPES.includes(row.type) ? attributedNote(row.leaderName, row.note) : row.note,
        })),
        linkRev: LINK_REV, // T1: the console shows "YS app out of date" when this is lower than its own
        // X19: only a console at rev >= 4 knows the hint (an older one would strip it anyway).
        ...((req.linkRev ?? 1) >= 4 && d.intake ? { intake: await d.intake.hint(settings) } : {}),
      };
    },

    async result(body: unknown): Promise<ResultReply> {
      const req = parseBody(ResultRequest, body);
      const reply = await d.link.applyResults(req.consoleId, req.results, now());
      if (d.errorLog) {
        const applied = new Set(reply.applied);
        for (const it of req.results) {
          if ((it.outcome !== 'refused' && it.outcome !== 'unclear') || !applied.has(it.id)) continue;
          const row = await d.link.getAction(it.id);
          await d.errorLog.record({ category: 'link', code: it.outcome === 'refused' ? it.reason : 'unclear', route: row?.type ?? 'unknown', role: 'console' });
        }
      }
      return reply;
    },

    async push(kind: string, body: unknown): Promise<z.infer<typeof PushResponse>> {
      if (!(PUSH_KINDS as readonly string[]).includes(kind)) throw new SyncValidation([{ path: 'kind', message: 'Unknown kind' }]);
      const pk = kind as PushKind;
      if (pk === 'intakePlan' || pk === 'consentPlan') { // X19: one (mode, date) per push
        const req = parseBody(PUSH_SCHEMAS[pk], body) as z.infer<typeof IntakePush> | z.infer<typeof ConsentPush>;
        if (!d.intake) return { applied: false };
        return d.intake.push(pk, req, await d.settings.getSettings());
      }
      const k = pk as MirrorKind;
      const req = parseBody(PUSH_SCHEMAS[k], body) as { consoleId: string; takenAt: string; rows: unknown[] };
      const rows = k === 'groups'
        ? (req.rows as { name: string }[]).map((g) => ({ ...g, ...parseGroupName(g.name) }))
        : req.rows;
      const res = await d.link.replaceMirror(k, rows, { takenAt: req.takenAt, consoleId: req.consoleId });
      if (!res.applied) return { applied: false };
      if (k !== 'roster') return { applied: true, rows: res.rows };
      const [roster, students] = await Promise.all([d.link.roster(), d.students.findAll()]);
      const changes = autoMatch(roster, students);
      if (changes.length) await d.link.setMatches(changes);
      return { applied: true, rows: res.rows, matched: {
        auto: changes.filter((c) => c.match === 'auto').length,
        ambiguous: changes.filter((c) => c.match === 'ambiguous').length,
      } };
    },
  };
}

export type SyncService = ReturnType<typeof makeSyncService>;
