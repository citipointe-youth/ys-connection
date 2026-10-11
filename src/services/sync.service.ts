// The console's side of the Elvanto link: /sync/claim, /sync/result, /sync/push/:kind
// (spec docs/superpowers/specs/2026-10-12-elvanto-link-app-design.md §8.1; contract §3).
// Called after the sync-token check. Never logs a body or a note: claimed notes are decrypted.
import type { z } from 'zod';
import { ClaimRequest, LINK_CONTRACT_VERSION, PUSH_KINDS, PUSH_SCHEMAS, ResultRequest } from '../core/link-contract';
import type { ClaimResponse, PushResponse } from '../core/link-contract';
import { LinkContractMismatch, SyncValidation } from '../core/errors/link-errors';
import type { PushKind, ResultReply } from '../core/link-types';
import type { ILinkRepository } from '../repositories/interfaces/link.repository';
import type { ISettingsRepository, IStudentRepository, IUserRepository } from '../repositories/interfaces/entity-repositories';
import { LEASE_LOST_MS, LINK_CUTOFF_DAYS, autoMatch } from './link-rules';
import { parseGroupName } from './import.service';

export interface SyncDeps {
  link: ILinkRepository; settings: ISettingsRepository; students: IStudentRepository; users: IUserRepository;
  now?: () => Date;
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
      // Off is the stop button: heartbeat + sweep still run, nothing is leased.
      const max = settings.ministryConfig.modules.newYouthForms === 'off' ? 0 : req.max;
      const claimed = await d.link.claim({
        console: { consoleId: req.consoleId, label: req.consoleLabel, contractVersion: req.contractVersion,
          consoleVersion: req.consoleVersion, inWindow: req.inWindow, pollSeconds: req.pollSeconds,
          capabilities: req.capabilities },
        max, leaseSeconds: req.leaseSeconds, cutoffDays: LINK_CUTOFF_DAYS, leaseLostMs: LEASE_LOST_MS,
      });
      const ok = claimed.filter((c) => !c.noteUnreadable); // the repo already stored those as refused
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
          payload: row.payload, note: row.note, // raw note: the console composes the attribution (decision 17)
        })),
      };
    },

    async result(body: unknown): Promise<ResultReply> {
      const req = parseBody(ResultRequest, body);
      return d.link.applyResults(req.consoleId, req.results, now());
    },

    async push(kind: string, body: unknown): Promise<z.infer<typeof PushResponse>> {
      if (!(PUSH_KINDS as readonly string[]).includes(kind)) throw new SyncValidation([{ path: 'kind', message: 'Unknown kind' }]);
      const k = kind as PushKind;
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
