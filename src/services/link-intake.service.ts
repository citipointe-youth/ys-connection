// T4 (contract X19): youth intake + consents in the app, admin only (spec 2026-10-13-intake-consent-app-spec.md §3, §5,
// §6). The console plans and writes Elvanto; this app stores its pushed plans per (mode, date), shows them, and queues the
// admin's decisions as outbox rows (intakeAnswer / intakeSave / consentSave / intakeText via /link/batch).
// Never logs a value: the error log gets codes, routes and roles only.
import { z } from 'zod';
import type { Actor } from '../core/entities/user';
import type { AppSettings } from '../core/entities/settings';
import type { ActionType, OutboxRow } from '../core/link-types';
import { ConsentPush, INTAKE_TYPES, IntakeNote, IntakePush, Uuid } from '../core/link-contract';
import { BadRequestError, ForbiddenError, ModuleDisabledError } from '../core/errors/app-error';
import { IntakeStale } from '../core/errors/link-errors';
import type { ILinkRepository } from '../repositories/interfaces/link.repository';
import type { ILinkIntakeRepository, IntakeMode, IntakeRowWrite } from '../repositories/interfaces/link-intake.repository';
import type { ISettingsRepository } from '../repositories/interfaces/entity-repositories';
import type { ErrorLogService } from './error-log.service';
import type { LinkStatus } from './link.service';
import { canUseIntakeAdmin } from './access-control';
import { addDays, brisbaneToday } from './link-rules';

export const INTAKE_STALE_MS = 2 * 3_600_000;  // a plan older than this greys out; Save / Text refuse
export const INTAKE_KEEP_DAYS = 14;            // rows and dates older than this are deleted
export const INTAKE_NOTE_MAX = 1900;
const HURRY_VIEW_MS = 30 * 60_000;             // R1: an admin opened Intake in the last 30 min
const REFRESH_ASK_MS = 10 * 60_000;            // R2: a refresh ask is offered to the console for 10 min only
const REFRESH_BACK_DAYS = 56;                  // a Refresh may ask for a date up to 8 weeks back
const INTAKE: readonly string[] = INTAKE_TYPES;
export const isIntakeType = (t: ActionType) => INTAKE.includes(t);
const modeOf = (t: ActionType): IntakeMode => (t === 'consentSave' ? 'consent' : 'intake');

const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Mode = z.enum(['intake', 'consent']);

/** The module + RBAC check (Off = 404 for everyone, On = the admin login only, else 403). */
export function intakeGate(actor: Actor, s: AppSettings): void {
  const mode = s.ministryConfig.modules.intakeAdmin ?? 'off';
  if (mode !== 'on') throw new ModuleDisabledError('Intake');
  if (!canUseIntakeAdmin(actor, mode)) throw new ForbiddenError('Only the admin can do this.');
}

interface StepLike { key: string; alone?: boolean; alts?: { key: string }[] }
/**
 * One intake batch item, after its payload parsed (§6): the date was pushed, the plan is under 2 h old (Save / Text),
 * every confirmed key is in the stored plan of that row, and an intakeAnswer note is an IntakeNote within 1,900.
 * Throws an AppError; the batch turns it into a per-item refusal.
 */
export async function checkIntakeItem(repo: ILinkIntakeRepository, type: ActionType, p: Record<string, unknown>,
  note: string | null, now: Date): Promise<void> {
  const mode = modeOf(type);
  const date = p.date as string;
  const d = (await repo.dates(mode)).find((x) => x.date === date && x.takenAt);
  if (!d) throw new BadRequestError('This date is not in the plan. Refresh.');
  if (type === 'intakeAnswer') {
    if (note !== null) {
      let ok = note.length <= INTAKE_NOTE_MAX;
      try { ok = ok && IntakeNote.safeParse(JSON.parse(note)).success; } catch { ok = false; }
      if (!ok) throw new BadRequestError('These answers are too long or not readable.');
    }
    const family = p.family as string[];
    if (!(await repo.rows(mode, date)).some((r) => r.key === family[0])) throw new BadRequestError('This family is not in the plan. Refresh.');
    return;
  }
  if (note !== null) throw new BadRequestError('A note can only go on an answer.');
  if (now.getTime() - Date.parse(d.takenAt!) > INTAKE_STALE_MS) throw new IntakeStale();
  const x = await repo.detail(mode, date, p.row as string);
  const plan = x?.detail as { steps?: StepLike[]; extras?: StepLike[] } | null | undefined;
  if (!plan || !Array.isArray(plan.steps)) throw new BadRequestError('This family is not in the plan. Refresh.');
  const extras = plan.extras ?? [];
  const all = [...plan.steps, ...extras];
  const known = new Set(all.flatMap((s) => [s.key, ...(s.alts ?? []).map((a) => a.key)]));
  const keys = type === 'intakeText' ? [p.key as string] : (p.confirmed as string[]);
  if (keys.some((k) => !known.has(k))) throw new BadRequestError('This plan changed. Refresh and check again.');
  if (type === 'intakeSave') {
    // The parent text is its own row with its own confirm (D16 / B6), never part of a Save.
    if (keys.some((k) => k.startsWith('complete:parent:'))) throw new BadRequestError('The parent text is sent on its own.');
    if (p.one === true) {
      const s = all.find((y) => y.key === keys[0] || (y.alts ?? []).some((a) => a.key === keys[0]));
      if (!s || !(s.alone || extras.includes(s))) throw new BadRequestError('This step is saved with the family.');
    }
  }
}

/** A list row's outbox action, for the chips and the per-step results (admin only: step keys hold value hashes). */
export interface IntakeActionView { id: string; type: ActionType; status: OutboxRow['status']; reason: string | null;
  detail: string | null; steps: OutboxRow['steps']; stop: OutboxRow['stop']; createdAt: string; resultAt: string | null }
const actionView = (r: OutboxRow): IntakeActionView => ({ id: r.id, type: r.type, status: r.status, reason: r.reason,
  detail: r.detail, steps: r.steps ?? null, stop: r.stop ?? null, createdAt: r.createdAt, resultAt: r.resultAt });
/** The row key an intake outbox row is about (the student form for an answer, else payload.row). */
const rowKeyOf = (r: OutboxRow) => {
  const p = r.payload as { row?: string; family?: string[] };
  return p.row ?? p.family?.[0] ?? null;
};

export interface IntakeServiceDeps {
  intake: ILinkIntakeRepository; link: ILinkRepository; settings: ISettingsRepository;
  /** GET /link/status, for the console banner (online, last seen, capabilities, consoleLinkRev). */
  status: (actor: Actor) => Promise<LinkStatus>;
  now?: () => Date;
  errorLog?: Pick<ErrorLogService, 'record'>;
}

export function makeIntakeService(d: IntakeServiceDeps) {
  const clock = d.now ?? (() => new Date());
  const gate = async (actor: Actor) => { const s = await d.settings.getSettings(); intakeGate(actor, s); return s; };
  // ponytail: per instance (serverless), so at worst one purge per warm instance per hour; a DB-side schedule if that bites.
  let lastPurge = 0;
  const purgeIfDue = async (t: Date) => {
    if (t.getTime() - lastPurge < 3_600_000) return;
    lastPurge = t.getTime();
    await d.intake.purge(addDays(brisbaneToday(t), -INTAKE_KEEP_DAYS));
  };
  const stale = (takenAt: string | null, t: Date) => !takenAt || t.getTime() - Date.parse(takenAt) > INTAKE_STALE_MS;
  const actionsOf = async (mode: IntakeMode, date: string) =>
    (await d.link.listActions({ types: [...INTAKE_TYPES], serviceDateFrom: date, serviceDateTo: date }))
      .filter((r) => r.status !== 'cancelled' && modeOf(r.type) === mode);

  return {
    /** GET /link/intake?mode=[&date=]: the dates (counts), or one date's rows with their latest outbox actions. */
    async list(actor: Actor, q: unknown) {
      await gate(actor);
      const f = z.object({ mode: Mode, date: Ymd.optional() }).parse(q ?? {});
      const t = clock();
      await purgeIfDue(t);
      if (!f.date) await d.intake.markViewed();
      const st = await d.status(actor);
      const head = { console: st.console, consoleLinkRev: st.consoleLinkRev, appLinkRev: st.appLinkRev };
      const [dates, rows] = await Promise.all([d.intake.dates(f.mode), d.intake.rows(f.mode, f.date)]);
      const dateView = (x: (typeof dates)[number]) => ({ date: x.date, takenAt: x.takenAt, stale: stale(x.takenAt, t), cut: x.cut,
        inputs: x.inputsFrom ? { from: x.inputsFrom, at: x.inputsAt } : null, refreshAskedAt: x.refreshAskedAt });
      if (!f.date) {
        return { ...head, dates: dates.map((x) => {
          const mine = rows.filter((r) => r.date === x.date);
          const n = (s: string) => mine.filter((r) => r.status === s).length;
          return { ...dateView(x), counts: { needsYou: n('needs-you'), ready: n('ready'), done: n('done') } };
        }) };
      }
      const x = dates.find((y) => y.date === f.date);
      const acts = await actionsOf(f.mode, f.date);
      return { ...head, ...(x ? dateView(x) : { date: f.date, takenAt: null, stale: true, cut: false, inputs: null, refreshAskedAt: null }),
        rows: rows.map((r) => ({ key: r.key, status: r.status, title: r.title, reason: r.reason, outcome: r.outcome, fromApp: r.fromApp, hasText: r.hasText,
          actions: acts.filter((a) => rowKeyOf(a) === r.key).slice(0, 3).map(actionView) })) };
    },

    /** GET /link/intake/row?mode=&date=&key=: the decrypted plan row + its last 5 outbox rows. */
    async row(actor: Actor, q: unknown) {
      await gate(actor);
      const f = z.object({ mode: Mode, date: Ymd, key: Uuid }).parse(q ?? {});
      const x = await d.intake.detail(f.mode, f.date, f.key);
      if (!x) throw new BadRequestError('This family is not in the plan. Refresh.');
      if (x.unreadable) {
        await d.errorLog?.record({ category: 'link', code: 'intake-unreadable', route: 'GET /link/intake/row', role: actor.role });
      }
      const acts = (await actionsOf(f.mode, f.date)).filter((a) => rowKeyOf(a) === f.key).slice(0, 5).map(actionView);
      return { row: { key: x.row.key, status: x.row.status, title: x.row.title, reason: x.row.reason, fromApp: x.row.fromApp,
        hasText: x.row.hasText, takenAt: x.row.takenAt }, detail: x.detail, unreadable: x.unreadable, actions: acts };
    },

    /** POST /link/intake/refresh {mode, date}: asks the console to push that date now (once per 60 s). */
    async refresh(actor: Actor, body: unknown) {
      await gate(actor);
      const f = z.object({ mode: Mode, date: Ymd }).parse(body ?? {});
      const today = brisbaneToday(clock());
      if (f.date > today || f.date < addDays(today, -REFRESH_BACK_DAYS)) throw new BadRequestError('Pick a date in the last 8 weeks.');
      return { asked: await d.intake.askRefresh(f.mode, f.date) };
    },

    /** Module turned Off (settings save): drop every stored plan and cancel the intake rows nobody has leased yet. */
    async off(): Promise<void> {
      await d.intake.clear();
      for (const r of await d.link.listActions({ types: [...INTAKE_TYPES], statuses: ['pending'] })) await d.link.cancelPending(r.id);
    },

    /** The claim reply's intake hint (§3.2), for a console at rev >= 4. Also runs the 14-day purge, at most hourly. Off clears nothing: the Off save does (off()). */
    async hint(settings: AppSettings): Promise<{ mode: 'off' | 'on'; hurry: boolean; refresh: { mode: IntakeMode; date: string }[] }> {
      const t = clock();
      const mode = settings.ministryConfig.modules.intakeAdmin ?? 'off';
      if (mode === 'off') return { mode, hurry: false, refresh: [] };
      const today = brisbaneToday(t);
      await purgeIfDue(t);
      const [pending, viewed, dates] = await Promise.all([
        d.link.listActions({ types: [...INTAKE_TYPES], statuses: ['pending'] }), d.intake.viewedAt(), d.intake.dates()]);
      const hurry = pending.length > 0 || (!!viewed && t.getTime() - Date.parse(viewed) < HURRY_VIEW_MS);
      const refresh = dates.filter((x) => x.refreshAskedAt && t.getTime() - Date.parse(x.refreshAskedAt) < REFRESH_ASK_MS && x.date >= addDays(today, -REFRESH_BACK_DAYS) && x.date <= today)
        .sort((a, b) => Date.parse(b.refreshAskedAt!) - Date.parse(a.refreshAskedAt!)).slice(0, 4)
        .map((x) => ({ mode: x.mode, date: x.date }));
      return { mode, hurry, refresh };
    },

    /** POST /sync/push/intakePlan | consentPlan (already parsed). Module Off: nothing is stored. */
    async push(kind: 'intakePlan' | 'consentPlan', req: z.infer<typeof IntakePush> | z.infer<typeof ConsentPush>, settings: AppSettings) {
      if ((settings.ministryConfig.modules.intakeAdmin ?? 'off') !== 'on') return { applied: false };
      const mode: IntakeMode = kind === 'intakePlan' ? 'intake' : 'consent';
      const rows: IntakeRowWrite[] = req.rows.map((r) => ({ key: r.key, status: r.status, title: r.title, reason: r.holds[0]?.text ?? '', outcome: 'outcome' in r ? r.outcome : '',
        fromApp: 'fromApp' in r ? r.fromApp : false,
        hasText: mode === 'intake' && r.steps.some((s) => s.state === 'todo' && s.key.startsWith('complete:parent:')),
        detail: r }));
      const inputs = 'inputs' in req ? req.inputs : null;
      const res = await d.intake.replace(mode, { date: req.date, takenAt: req.takenAt, consoleId: req.consoleId, cut: req.cut, inputs }, rows);
      return res.applied ? { applied: true, rows: res.rows } : { applied: false };
    },
  };
}

export type IntakeService = ReturnType<typeof makeIntakeService>;
