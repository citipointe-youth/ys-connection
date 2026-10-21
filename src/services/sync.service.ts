// The console's side of the Elvanto link: /sync/claim, /sync/result, /sync/push/:kind
// (spec docs/superpowers/specs/2026-10-12-elvanto-link-app-design.md §8.1; contract §3).
// Called after the sync-token check. Never logs a body or a note: claimed notes are decrypted.
import type { z } from 'zod';
import { CONSENT_TYPES, ClaimRequest, INTAKE_TYPES, LINK_CONTRACT_VERSION, LINK_REV, LeadersRequest, MIN_CONSOLE_REV, PUSH_KINDS, PUSH_SCHEMAS, ResultRequest } from '../core/link-contract';
import type { ClaimResponse, LeadersResponse, PushResponse } from '../core/link-contract';
import { LinkContractMismatch, SyncValidation } from '../core/errors/link-errors';
import type { ActionType, ClaimArgs, LinkFlowStep, MirrorKind, PushKind, ResultReply } from '../core/link-types';
import type { ConsentLookupPush, ConsentPush, IntakePush } from '../core/link-contract';
import type { IntakeService } from './link-intake.service';
import type { ILinkRepository } from '../repositories/interfaces/link.repository';
import type { ILeaderRepository, ISettingsRepository, IStudentRepository, IUserRepository } from '../repositories/interfaces/entity-repositories';
import { ATTRIBUTED_TYPES, LEASE_LOST_MS, LINK_CUTOFF_DAYS, attributedNote, autoMatch, genderFixes } from './link-rules';
import type { Student } from '../core/entities/student';
import { computeQuad } from '../core/types/enums';

/** Writes genderFixes (idempotent: genderFixes skips an equal gender). Never logs a name. */
export async function saveGenderFixes(repo: IStudentRepository, fixes: { student: Student; gender: 'male' | 'female' }[]) {
  if (!fixes.length) return;
  const at = new Date().toISOString();
  await repo.saveMany(fixes.map(({ student: s, gender }) => ({ ...s, gender, quad: computeQuad(s.grade ?? null, gender), updatedAt: at })));
}
import { parseGroupName } from './import.service';
import type { ErrorLogService } from './error-log.service';

/** Roster auto-match + gender fixes (approved YS-only write). Called after a roster push and after every import (Part 2). */
export async function rematchRoster(link: Pick<ILinkRepository, 'roster' | 'setMatches'>, students: IStudentRepository) {
  const [roster, all] = await Promise.all([link.roster(), students.findAll()]);
  const changes = autoMatch(roster, all);
  if (changes.length) await link.setMatches(changes);
  await saveGenderFixes(students, genderFixes(roster, all, changes));
  return changes;
}

export interface SyncDeps {
  link: ILinkRepository; settings: ISettingsRepository; students: IStudentRepository; users: IUserRepository;
  now?: () => Date;
  /** T3: refused / unclear / expired rows go to the admin Error log (type + reason only). */
  errorLog?: Pick<ErrorLogService, 'record'>;
  /** T4 (X19): the claim hint and the intakePlan / consentPlan pushes. Without it those pushes are not applied. */
  intake?: Pick<IntakeService, 'hint' | 'push'>;
  /** T8 (rev 5): POST /sync/leaders. Without it the reply is an empty list. */
  leaders?: Pick<ILeaderRepository, 'findActive'>;
}

/** Version first (from the raw body), then Zod. Issues carry path + message only, never a value. */
export function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
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
      // X-1: a console below MIN_CONSOLE_REV (missing = 1) is refused before the heartbeat: it must be updated first.
      const linkRev = req.linkRev ?? 1;
      if (linkRev < MIN_CONSOLE_REV) throw new LinkContractMismatch();
      const settings = await d.settings.getSettings();
      // Off is the stop button: heartbeat + sweep still run, nothing is leased while every link screen is off (T10).
      // ponytail: one screen on leases every type; rows of an off screen cannot be queued, only ones from before.
      const m = settings.ministryConfig.modules;
      const max = (['checkin', 'lifegroupReport', 'flows'] as const).every((f) => (m[f] ?? m.newYouthForms) === 'off')
        && m.intakeAdmin !== 'on' ? 0 : req.max;
      const swept: NonNullable<ClaimArgs['swept']> = [];
      // Intake off: strip the four intake keys, so a queued row (an irreversible intakeText SMS included) is never leased.
      const capabilities = { ...req.capabilities };
      if (m.intakeAdmin !== 'on') for (const t of [...INTAKE_TYPES, ...CONSENT_TYPES]) delete capabilities[t]; // rev 6: the Consents screen's types too
      const claimed = await d.link.claim({
        console: { consoleId: req.consoleId, label: req.consoleLabel, contractVersion: req.contractVersion,
          consoleVersion: req.consoleVersion, inWindow: req.inWindow, pollSeconds: req.pollSeconds,
          capabilities, linkRev },
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
        for (const s of swept) if (s.type !== 'recheck') add(s.reason, s.type); // L7: a re-check's fate shows on its own row only
        for (const c of claimed) if (c.noteUnreadable && c.row.type !== 'recheck') add('note-unreadable', c.row.type);
        await Promise.all([...groups.values()].map((g) => d.errorLog!.record({ category: 'link', ...g, role: 'console' })));
      }
      // X1 (ledger 25 D2, reverses 17): the app prefixes the "I am" leader; the stored note stays their own words.
      // Rev 6: a removal with no note stays null (the console posts a note only when there is one). L7: a recheck row's note
      // is its ref row's (the repository claim), attributed by that row's own type, so the console compares what it first got.
      const noteFor = (row: (typeof ok)[number]['row']) => {
        const t = row.type === 'recheck' ? (row.payload as { type: ActionType }).type : row.type;
        return ATTRIBUTED_TYPES.includes(t) && (t !== 'removeFromFlowStep' || row.note) ? attributedNote(row.leaderName, row.note) : row.note;
      };
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
          // Rev 6: a removal with no note stays null (the console posts a note only when there is one).
          note: noteFor(row),
        })),
        linkRev: LINK_REV, // T1: the console shows "YS app out of date" when this is lower than its own
        ...(d.intake ? { intake: await d.intake.hint(settings, capabilities, req.inWindow) } : {}), // X19: the intake hint
        progress: true as const, // S5: this app takes POST /sync/push/progress (an older console ignores the key)
        consentLink: true as const, // L6 review: this app takes the consentLink capability key (an older rev 6 app 400s on it)
        // X1 (rev 14): the location facts; an older console strips the key (z.object default), a rev 14 one compares them.
        site: { timeZone: settings.ministryConfig.structure.timeZone, serviceDay: settings.ministryConfig.structure.serviceDayOfWeek,
          consentCutoff: settings.ministryConfig.structure.consentCutoff, peopleFlowPrefix: settings.ministryConfig.elvanto.peopleFlowPrefix,
          consentFlowPrefix: settings.ministryConfig.elvanto.consentFlowPrefix },
      };
    },

    /** T8 (rev 5): the active app leaders' full names, so the console can find each one in Elvanto by name. */
    async leaders(body: unknown): Promise<z.infer<typeof LeadersResponse>> {
      parseBody(LeadersRequest, body);
      const names = d.leaders ? (await d.leaders.findActive()).map((l) => l.fullName.trim()).filter(Boolean) : [];
      return { contractVersion: LINK_CONTRACT_VERSION, names: [...new Set(names)] };
    },

    async result(body: unknown): Promise<ResultReply> {
      const req = parseBody(ResultRequest, body);
      // F1 (2026-10-22): a check-in a re-check found in no room counts as landed. Elvanto can't tell "never landed" from
      // "checked out since", and checking in a child who has left is worse than a missed one (reconcile still finds a
      // missed one in attendance; the door follows the room mirror). Only a re-check's verdict: an operator's own stays.
      const rechecked = async (id: string) => {
        const row = await d.link.getAction(id);
        if (row?.type !== 'checkIn' && row?.type !== 'firstTimerCheckIn') return false;
        return (await d.link.listActions({ types: ['recheck'], serviceDateFrom: row.serviceDate, serviceDateTo: row.serviceDate })).some((r) => (r.payload as { ref?: unknown }).ref === id && r.status !== 'cancelled');
      };
      req.results = await Promise.all(req.results.map(async (it) => (it.outcome === 'resolved' && !it.landed && await rechecked(it.id) ? { ...it, landed: true } : it)));
      const reply = await d.link.applyResults(req.consoleId, req.results, now());
      if (d.errorLog) {
        const applied = new Set(reply.applied);
        const hits = req.results.filter((it) => (it.outcome === 'refused' || it.outcome === 'unclear') && applied.has(it.id));
        const rows = await Promise.all(hits.map((it) => d.link.getAction(it.id)));
        const groups = new Map<string, { code: string; route: string; count: number }>();
        hits.forEach((it, i) => {
          if (rows[i]?.type === 'recheck') return; // L7: a re-check's answer shows on its own row, never as an Error log line
          const code = it.outcome === 'refused' ? it.reason : 'unclear', route = rows[i]?.type ?? 'unknown';
          const g = groups.get(`${route}|${code}`) ?? { code, route, count: 0 };
          g.count++; groups.set(`${route}|${code}`, g);
        });
        const errorLog = d.errorLog;
        await Promise.all([...groups.values()].map((g) => errorLog.record({ category: 'link', code: g.code, route: g.route, role: 'console', count: g.count })));
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
      if (pk === 'progress') { // S5: a hint only; stored on the console's row, read by the screens that wait on it
        const req = parseBody(PUSH_SCHEMAS.progress, body);
        await d.link.setProgress(req.consoleId, req.key, { done: req.done, total: req.total, stage: req.stage });
        return { applied: true };
      }
      if (pk === 'consentLookup') { // rev 6 (R2 b/c): the answer to one consentLookup row this console holds
        const req = parseBody(PUSH_SCHEMAS.consentLookup, body) as z.infer<typeof ConsentLookupPush>;
        const row = await d.link.getAction(req.requestId);
        const p = row?.payload as { kind?: string; page?: number } | undefined;
        if (!row || row.type !== 'consentLookup' || p?.kind !== req.kind || p?.page !== req.page
          || row.status !== 'claimed' || row.leaseOwner !== req.consoleId) return { applied: false };
        await d.link.putConsentLookup({ requestId: req.requestId, kind: req.kind, page: req.page, pageSize: req.pageSize,
          total: req.total, rows: req.rows, takenAt: req.takenAt, consoleId: req.consoleId });
        return { applied: true, rows: req.rows.length };
      }
      const k = pk as MirrorKind;
      const req = parseBody(PUSH_SCHEMAS[k], body) as { consoleId: string; takenAt: string; rows: unknown[]; steps?: LinkFlowStep[] };
      const rows = k === 'groups'
        ? (req.rows as { name: string }[]).map((g) => ({ ...g, ...parseGroupName(g.name) }))
        : req.rows;
      const res = await d.link.replaceMirror(k, rows, { takenAt: req.takenAt, consoleId: req.consoleId, ...(req.steps ? { steps: req.steps } : {}) });
      if (!res.applied) return { applied: false };
      if (k !== 'roster') return { applied: true, rows: res.rows };
      const changes = await rematchRoster(d.link, d.students);
      return { applied: true, rows: res.rows, matched: {
        auto: changes.filter((c) => c.match === 'auto').length,
        ambiguous: changes.filter((c) => c.match === 'ambiguous').length,
      } };
    },
  };
}

export type SyncService = ReturnType<typeof makeSyncService>;
