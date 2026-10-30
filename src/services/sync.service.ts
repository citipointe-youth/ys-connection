// The console's side of the Elvanto link: /sync/claim, /sync/result, /sync/push/:kind
// (spec docs/superpowers/specs/2026-10-12-elvanto-link-app-design.md §8.1; contract §3).
// Called after the sync-token check. Never logs a body or a note: claimed notes are decrypted.
import type { z } from 'zod';
import { CONSENT_LOOKUP_KINDS, CONSENT_TYPES, ClaimRequest, INTAKE_TYPES, LINK_CONTRACT_VERSION, LINK_REV, LeadersRequest, MIN_CONSOLE_REV, PUSH_KINDS, PUSH_SCHEMAS, ResultRequest } from '../core/link-contract';
import type { ClaimResponse, LeadersResponse, PushResponse } from '../core/link-contract';
import { LinkContractMismatch, SyncValidation } from '../core/errors/link-errors';
import { ModuleDisabledError } from '../core/errors/app-error';
import type { ActionType, ClaimArgs, LinkFlowStep, LinkRosterRow, MirrorKind, OutboxRow, PushKind, ResultReply } from '../core/link-types';
import type { AuditPushBody, BusConsentFormsPushBody, BusConsentFormsResponse, ConsentLookupPush, ConsentPush, ConsentSnapshotPush, DoorSearchPush, IntakePush } from '../core/link-contract';
import type { ConnectionAuditService, IngestResult } from './connection-audit.service';
import type { IntakeService } from './link-intake.service';
import type { ILinkRepository } from '../repositories/interfaces/link.repository';
import type { ILeaderRepository, ISettingsRepository, IStudentRepository, IUserRepository } from '../repositories/interfaces/entity-repositories';
import { ATTRIBUTED_TYPES, LEASE_LOST_MS, LINK_CUTOFF_DAYS, autoMatch, checkInLanded, claimNote, genderFixes, gradeFixes, gradeGlitch, graduations } from './link-rules';
import type { MatchChange } from './link-rules';
import type { Student } from '../core/entities/student';
import { computeQuad } from '../core/types/enums';
import { parseGroupName } from './import.service';
import { consentsHubOn } from '../core/module-tree';
import type { ErrorLogService } from './error-log.service';
// 2026-10-24: the console names a missing consent field only in detail (FIX_SHAPE, 11.1 ys-link.js:72-76); a contract reason would need a LINK_REV.
const NO_DATE = /has no consent date field/;
const NO_TOTAL = /has no TOTAL non-consent date field/;
// anchored: a bare /consent date/ would also match the TOTAL text
const noFieldCode = (d: string) => (NO_DATE.test(d) ? 'fix-no-date' : NO_TOTAL.test(d) ? 'fix-no-total' : null);

/** r25: grade follows Elvanto (gradeFixes, quad recomputed), THEN gender fixes on the updated grades (genderFixes needs
 *  the grades to agree), in one write. Idempotent. `all` must include graduated students. Never logs a name. */
export async function saveRosterFixes(repo: IStudentRepository, roster: LinkRosterRow[], all: Student[], changes: MatchChange[] = []) {
  const at = new Date().toISOString();
  const out = new Map<string, Student>();
  for (const { student: s, grade } of gradeFixes(roster, all, changes)) out.set(s.id, { ...s, grade, quad: computeQuad(grade, s.gender), updatedAt: at });
  const now = all.map((s) => out.get(s.id) ?? s);
  for (const { student: s, gender } of genderFixes(roster, now, changes)) out.set(s.id, { ...s, gender, quad: computeQuad(s.grade ?? null, gender), updatedAt: at });
  if (out.size) await repo.saveMany([...out.values()]);
}

/** Roster auto-match + grade and gender fixes (approved YS-only write). Called after a roster push and after every import (Part 2).
 *  r25: reads graduated students too, so a graduated student keeps its match (autoMatch never offers it as a new one). */
export async function rematchRoster(link: Pick<ILinkRepository, 'roster' | 'setMatches'>, students: IStudentRepository) {
  const [roster, all] = await Promise.all([link.roster(), students.findAllWithGraduated()]);
  const changes = autoMatch(roster, all);
  if (changes.length) await link.setMatches(changes);
  await saveRosterFixes(students, roster, all, changes);
  return changes;
}

export interface SyncDeps {
  link: ILinkRepository; settings: ISettingsRepository; students: IStudentRepository; users: IUserRepository;
  now?: () => Date;
  /** T3: refused / expired rows go to the admin Error log (type + reason only). D1: `sweep` turns unclear rows into live counts. */
  errorLog?: Pick<ErrorLogService, 'record'> & Partial<Pick<ErrorLogService, 'sweep'>>;
  /** T4 (X19): the claim hint and the intakePlan / consentPlan pushes. Without it those pushes are not applied. */
  intake?: Pick<IntakeService, 'hint' | 'push'>;
  /** T8 (rev 5): POST /sync/leaders. Without it the reply is an empty list. */
  leaders?: Pick<ILeaderRepository, 'findActive'>;
  /** Rev 16 (spec 2026-10-22): push kind audit, one Connection Audit source per body. Without it that push is not applied. */
  audit?: Pick<ConnectionAuditService, 'ingest'>;
  /** Rev 18 (bus consent, spec 2026-10-22): push kind busConsentForms. Without it that push is not applied. */
  busConsent?: (req: BusConsentFormsPushBody) => Promise<z.infer<typeof BusConsentFormsResponse>>;
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

/** M1: the reads behind checkInLanded (the re-check verdict in result() and the admin's Check again state agree). */
export async function checkInEvidence(link: ILinkRepository, row: OutboxRow): Promise<boolean> {
  if (!row.personId) return false;
  const [outs, services, mirrors] = await Promise.all([link.listActions({ types: ['checkOut'], personId: row.personId,
    serviceDateFrom: row.serviceDate, serviceDateTo: row.serviceDate }), link.services(), link.mirrorState()]);
  return checkInLanded(row, outs, services, mirrors.find((m) => m.kind === 'services')?.takenAt ?? null);
}

export function makeSyncService(d: SyncDeps) {
  const now = d.now ?? (() => new Date());
  // D1 (ruling e): the Error log sweep runs after each result and, at most every 10 min, on a claim (so alerts clear with no admin view).
  // ponytail: per-instance timer on serverless, like the record throttle; a DB timestamp if instances multiply.
  const SWEEP_EVERY_MS = 10 * 60_000;
  let lastSweep = -Infinity;
  const sweep = async () => {
    lastSweep = now().getTime();
    try { await d.errorLog?.sweep?.(); } catch { /* sweep() never throws; a fake one may */ }
  };

  // Rev 19: a Refresh asked in the last 10 min that no newer copy of every kind has answered yet.
  // Rev 21: the open ask also carries askedAt, so the console dedupes each Refresh by its value.
  const SNAP_REV = 19, ASK_AT_REV = 21, SNAP_ASK_MS = 10 * 60_000;
  const snapAsk = async () => {
    const { askedAt, taken } = await d.link.consentSnapshotMeta();
    const a = askedAt ? Date.parse(askedAt) : NaN;
    const ask = now().getTime() - a <= SNAP_ASK_MS && (taken.length < CONSENT_LOOKUP_KINDS.length || taken.some((x) => Date.parse(x.takenAt) < a));
    return { ask, askedAt };
  };
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
      const screensOff = (['checkin', 'lifegroupReport', 'flows'] as const).every((f) => (m[f] ?? m.newYouthForms) === 'off');
      // Modular setup: Live Elvanto link off stops every lease too.
      const max = m.liveLink === false || (screensOff && m.intakeAdmin !== 'on' && !m.busMinistry) ? 0 : req.max;
      const hub = consentsHubOn(m); // the Consents hub's types: on with the Public consent form or Intakes
      const swept: NonNullable<ClaimArgs['swept']> = [];
      // Intake off: strip the four intake keys, so a queued row (an irreversible intakeText SMS included) is never leased.
      const capabilities = { ...req.capabilities };
      if (m.intakeAdmin !== 'on') for (const t of INTAKE_TYPES) delete capabilities[t];
      if (!hub) for (const t of CONSENT_TYPES) delete capabilities[t]; // rev 6: the Consents screen's types (modular setup: consentsHubOn)
      if (!m.busConsentForm) delete capabilities.busConsentCheck; // rev 18: the Public consent form off = never leased
      // Fix round 1: Bus on keeps the claim leasing, but the screens' stop button still holds. With every link screen off,
      // only busConsentCheck (and the intake types while intake is on, the consent types while the hub is on) stays listed, so an older queued row is never sent.
      if (screensOff) {
        const keep = new Set<string>(['busConsentCheck', ...(m.intakeAdmin === 'on' ? INTAKE_TYPES : []), ...(hub ? CONSENT_TYPES : [])]);
        for (const t of Object.keys(capabilities) as (keyof typeof capabilities)[]) if (!keep.has(t)) delete capabilities[t];
      }
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
        // L7: a re-check's fate shows on its own row only. D1: lease-lost is the sweep's live count, not a row per sweep.
        for (const s of swept) if (s.type !== 'recheck' && s.reason !== 'lease-lost') add(s.reason, s.type);
        for (const c of claimed) if (c.noteUnreadable && c.row.type !== 'recheck') add('note-unreadable', c.row.type);
        await Promise.all([...groups.values()].map((g) => d.errorLog!.record({ category: 'link', ...g, role: 'console' })));
      }
      if (now().getTime() - lastSweep >= SWEEP_EVERY_MS) await sweep();
      // X1 (ledger 25 D2, reverses 17): the app prefixes the "I am" leader; the stored note stays their own words.
      // Rev 6: a removal with no note stays null (the console posts a note only when there is one). L7: a recheck row's note
      // is its ref row's (the repository claim), attributed by that row's own type, so the console compares what it first got.
      const noteFor = (row: (typeof ok)[number]['row']) => {
        const t = row.type === 'recheck' ? (row.payload as { type: ActionType }).type : row.type;
        return ATTRIBUTED_TYPES.includes(t) && (t !== 'removeFromFlowStep' || row.note) ? claimNote(t, row.leaderName, row.note) : row.note;
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
        // Rev 17: resolved values only (checkin/lifegroupReport/flows already inherit newYouthForms in the config transform).
        modules: { checkin: m.checkin ?? m.newYouthForms, lifegroupReport: m.lifegroupReport ?? m.newYouthForms, flows: m.flows ?? m.newYouthForms, newYouthForms: m.newYouthForms,
          intakeAdmin: m.intakeAdmin, lifegroups: m.lifegroups, connectionAudit: m.connectionAudit },
        ...(linkRev >= SNAP_REV && hub ? { consentSnap: await snapAsk().then(({ ask, askedAt }) =>
          ({ ask, ...(linkRev >= ASK_AT_REV && ask && askedAt ? { askedAt } : {}) })) } : {}), // rev 19; rev 21 askedAt
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
      // F1 (2026-10-22) + M1 (operator ruling 2026-10-24): a check-in a re-check found in no room counts as landed only with
      // YS evidence (checkInLanded: a later check-out, or a services mirror after the tap that had them in); otherwise it stays
      // not landed so it goes again. Only a re-check's verdict: an operator's own stays.
      const rechecked = async (id: string) => {
        const row = await d.link.getAction(id);
        if (row?.type !== 'checkIn' && row?.type !== 'firstTimerCheckIn') return false;
        if (!(await d.link.listActions({ types: ['recheck'], serviceDateFrom: row.serviceDate, serviceDateTo: row.serviceDate })).some((r) => (r.payload as { ref?: unknown }).ref === id && r.status !== 'cancelled')) return false;
        return checkInEvidence(d.link, row);
      };
      req.results = await Promise.all(req.results.map(async (it) => (it.outcome === 'resolved' && !it.landed && await rechecked(it.id) ? { ...it, landed: true } : it)));
      const reply = await d.link.applyResults(req.consoleId, req.results, now());
      // Link seam review #1 (2026-10-24): a retried check-in is pending again with a check-out queued behind it (M2): nothing reached
      // Elvanto, so the Undo / Check out wins, as before M2. Cancel the check-in first: if that fails it was re-claimed, and the queue stands.
      const appliedNow = new Set(reply.applied);
      for (const it of req.results) {
        if (it.outcome !== 'retry' || !appliedNow.has(it.id)) continue;
        const ci = await d.link.getAction(it.id);
        if (ci?.type !== 'checkIn' || ci.status !== 'pending' || !ci.personId) continue;
        const st = (ci.payload as { serviceTimeId?: unknown }).serviceTimeId;
        const out = (await d.link.listActions({ types: ['checkOut'], statuses: ['pending'], personId: ci.personId, serviceDateFrom: ci.serviceDate, serviceDateTo: ci.serviceDate }))
          .find((r) => (r.payload as { serviceTimeId?: unknown }).serviceTimeId === st && r.createdAt >= ci.createdAt);
        if (out && await d.link.cancelPending(ci.id, out.id)) await d.link.cancelPending(out.id);
      }
      if (d.errorLog) {
        const applied = new Set(reply.applied);
        // D1: an unclear is not written here; the sweep below keeps the live count of open unclear rows.
        const hits = req.results.filter((it): it is Extract<typeof it, { outcome: 'refused' }> => it.outcome === 'refused' && applied.has(it.id));
        const rows = await Promise.all(hits.map((it) => d.link.getAction(it.id)));
        const groups = new Map<string, { code: string; route: string; count: number }>();
        hits.forEach((it, i) => {
          if (rows[i]?.type === 'recheck') return; // L7: a re-check's answer shows on its own row, never as an Error log line
          const code = rows[i]?.type === 'consentFix' && it.reason === 'unknown' ? (noFieldCode(it.detail ?? '') ?? it.reason) : it.reason;
          const route = rows[i]?.type ?? 'unknown';
          const g = groups.get(`${route}|${code}`) ?? { code, route, count: 0 };
          g.count++; groups.set(`${route}|${code}`, g);
        });
        const errorLog = d.errorLog;
        await Promise.all([...groups.values()].map((g) => errorLog.record({ category: 'link', code: g.code, route: g.route, role: 'console', count: g.count })));
        await sweep();
      }
      return reply;
    },

    async push(kind: string, body: unknown): Promise<z.infer<typeof PushResponse> | IngestResult | z.infer<typeof BusConsentFormsResponse>> {
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
      if (pk === 'doorSearch') { // rev 20: the youth one door search found, for the row this console holds; they join the roster now
        const req = parseBody(PUSH_SCHEMAS.doorSearch, body) as z.infer<typeof DoorSearchPush>;
        const row = await d.link.getAction(req.requestId);
        if (!row || row.type !== 'doorSearch' || row.status !== 'claimed' || row.leaseOwner !== req.consoleId) return { applied: false };
        const n = await d.link.addRoster(req.rows.map((r) => ({ ...r, kind: 'student' as const })));
        await rematchRoster(d.link, d.students); // a found youth with a YS record checks in against it
        return { applied: true, rows: n };
      }
      if (pk === 'consentSnapshot') { // rev 19: the console's standing copy of one consent list; module Off stores nothing
        const req = parseBody(PUSH_SCHEMAS.consentSnapshot, body) as z.infer<typeof ConsentSnapshotPush>;
        if (!consentsHubOn((await d.settings.getSettings()).ministryConfig.modules)) return { applied: false };
        const ok = await d.link.putConsentSnapshot({ kind: req.kind, total: req.total, rows: req.rows, takenAt: req.takenAt, consoleId: req.consoleId });
        return ok ? { applied: true, rows: req.rows.length } : { applied: false };
      }
      // Modular setup: Live Elvanto link off refuses the mirror and audit pushes, so no console copy lands while the link is off.
      if (['roster', 'services', 'groups', 'flows', 'audit'].includes(pk) && (await d.settings.getSettings()).ministryConfig.modules.liveLink === false) throw new ModuleDisabledError('Elvanto link');
      if (pk === 'audit') { // rev 16: not a mirror (no link_mirror_state); its own store, staleness and transaction
        const req = parseBody(PUSH_SCHEMAS.audit, body) as AuditPushBody;
        if (!d.audit) return { applied: false };
        return d.audit.ingest(req, 'console');
      }
      if (pk === 'busConsentForms') { // rev 18: one console read of the bus consent forms; idempotent upsert, never a mirror
        const req = parseBody(PUSH_SCHEMAS.busConsentForms, body) as BusConsentFormsPushBody;
        return d.busConsent ? d.busConsent(req) : { applied: false, rows: 0, new: 0, unmatched: 0 }; // F12: the strict response shape
      }
      const k = pk as MirrorKind;
      const req = parseBody(PUSH_SCHEMAS[k], body) as { consoleId: string; takenAt: string; rows: unknown[]; steps?: LinkFlowStep[] };
      const rows = k === 'groups'
        ? (req.rows as { name: string }[]).map((g) => ({ ...g, ...parseGroupName(g.name) }))
        : req.rows;
      // r25: the stored roster before this push, to see a Year 12 whose grade Elvanto has just blanked (graduations).
      const before = k === 'roster' ? await d.link.roster() : [];
      const res = await d.link.replaceMirror(k, rows, { takenAt: req.takenAt, consoleId: req.consoleId, ...(req.steps ? { steps: req.steps } : {}) });
      if (!res.applied) return { applied: false };
      if (k !== 'roster') return { applied: true, rows: res.rows };
      const inRows = req.rows as { personId: string; grade: number | null; kind?: string }[];
      if (gradeGlitch(inRows)) console.warn('roster push: over half of the student grades are blank, graduations skipped'); // r25 guard
      const grads = graduations(before, inRows, await d.students.findAll());
      const at = new Date().toISOString();
      for (const s of grads) await d.students.setGraduated(s.id, at);
      const changes = await rematchRoster(d.link, d.students);
      return { applied: true, rows: res.rows, matched: {
        auto: changes.filter((c) => c.match === 'auto').length,
        ambiguous: changes.filter((c) => c.match === 'ambiguous').length,
      } };
    },
  };
}

export type SyncService = ReturnType<typeof makeSyncService>;
