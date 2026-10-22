import { createHash, randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Actor } from '../core/entities/user';
import type { ISettingsRepository } from '../repositories/interfaces/entity-repositories';
import { AppError, BadRequestError, ModuleDisabledError, NotFoundError } from '../core/errors/app-error';
import type { IUnsentRepository, UnsentReason } from '../repositories/interfaces/unsent.repository';
import { decryptField, encryptField } from '../utils/field-crypto';
import { RateLimiter } from '../utils/rate-limiter';
import { assertCan, canUseNewYouth } from './access-control';
import { gradeRange, type ElvantoConfig } from '../core/ministry-config';
import * as EF from './elvanto-forms';
import type { ErrorLogService } from './error-log.service';

export interface NewYouthResult {
  student: EF.Outcome;
  parent: EF.Outcome;
  dryRun: boolean;
  repeat?: boolean;
  /** T4 (X19): the submission ref the student form carried (live sends only). Not stored, never logged. */
  ref?: string;
  /** T10: this send did not fully land and was saved (encrypted) for the admin to resend. */
  queued?: boolean;
}

/** T10 admin view of one unsent row. `name`/`host`/`grade` are null when the payload can't be decrypted. */
export interface UnsentView {
  id: string; reason: UnsentReason; createdAt: string; updatedAt: string;
  forms: string[]; name: string | null; host: string | null; grade: string | null;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** `YS-` + 6 Crockford base32 characters, crypto random (~1 in a billion clash). */
export function makeRef(): string {
  let s = 'YS-';
  for (let i = 0; i < 6; i++) s += CROCKFORD[randomInt(32)];
  return s;
}

/** Bus consent form send (spec 2026-10-22 bus consent). `dropoff` is parsed from Elvanto's success page (null until Task 0 sets the rule). */
export type BusResult = { result: EF.Outcome; dropoff: string | null; queued?: boolean; repeat?: boolean };

export interface NewYouthService {
  send(actor: Actor, input: unknown): Promise<NewYouthResult>;
  sendBusConsent(actor: Actor, input: unknown): Promise<BusResult>;
  /** T10 admin queue (admin:manage): list, resend through the same send path, delete. */
  unsentList(actor: Actor): Promise<{ rows: UnsentView[] }>;
  unsentRetry(actor: Actor, id: string, body: unknown): Promise<NewYouthResult | BusResult>;
  unsentDelete(actor: Actor, id: string): Promise<{ ok: true }>;
}

// Fixed strings only: never echo a submitted value (minors' data must not reach logs or replies).
const LABELS: Record<string, string> = {
  host: 'your name', firstName: 'first name', lastName: 'last name',
  dob: 'date of birth', gender: 'gender', grade: 'grade', school: 'school', mobile: 'student mobile',
  address: 'address', allergies: 'allergies', conditions: 'medical conditions', medicalNotes: 'medical comments',
  parentFirst: 'parent first name', parentLast: 'parent last name', parentMobile: 'parent mobile',
  parentGender: 'parent gender', send: 'request',
};

const name = z.string().trim().min(1).max(50).transform(EF.tidyName);
const mobile = z.string().transform((v, ctx) => {
  const m = EF.toAuMobile(v);
  if (!m) { ctx.addIssue({ code: z.ZodIssueCode.custom }); return z.NEVER; }
  return m;
});

const BusSchema = z.object({
  first: name, last: name, grade: z.enum(['6', '7', '8', '9', '10', '11', '12']), gender: z.enum(['m', 'f']), mobile,
  school: z.string().trim().min(1).max(80),
  address: z.object({
    line1: z.string().trim().min(1).max(120), line2: z.string().trim().max(120).default(''),
    postcode: z.string().trim().regex(/^\d{4}$/), city: z.string().trim().min(1).max(60), state: z.string().trim().max(20).default('QLD'),
  }),
  parentName: z.string().trim().min(1).max(120), parentPhone: mobile, pickup: z.boolean(), pickupBy: z.string().trim().max(120).default(''),
});
const BUS_LABELS: Record<string, string> = { first: 'first name', last: 'last name', grade: 'grade', gender: 'gender', mobile: 'mobile',
  school: 'school', address: 'address', parentName: 'parent name', parentPhone: 'parent phone', pickup: 'pickup answer' };

const Schema = z.object({
  send: z.array(z.enum(['student', 'parent'])).min(1).default(['student', 'parent']),
  host: z.string().trim().min(1).max(80),
  firstName: name,
  lastName: name,
  dob: z.string().transform((v, ctx) => {
    const d = EF.isoToDmy(v);
    if (!d) { ctx.addIssue({ code: z.ZodIssueCode.custom }); return z.NEVER; }
    return d;
  }),
  gender: z.enum(['m', 'f']),
  grade: z.enum(['6', '7', '8', '9', '10', '11', '12']), // gradeRange() below narrows it to this ministry's grades
  school: z.string().trim().min(1).max(80),
  mobile,
  address: z.object({
    street: z.string().trim().max(120),
    suburb: z.string().trim().max(60),
    state: z.string().trim().max(20),
    postcode: z.string().trim().regex(/^(\d{4})?$/),
  }).optional(),
  allergies: z.array(z.enum(EF.LABELS.allergies)).max(11).default([]),
  conditions: z.array(z.enum(EF.LABELS.conditions)).max(4).default([]),
  medicalNotes: z.string().trim().max(500).default(''),
  parentFirst: name,
  parentLast: name,
  parentMobile: mobile,
  parentGender: z.enum(['m', 'f']).optional(),
});

// The route is in UNTIMED_ROUTES (Task 3), so these bound it: GETs in parallel (8 s) + two 10 s POSTs = 28 s,
// plus the settings read, inside the SPA's 45 s wait and Vercel's 60 s. Raise POST_TIMEOUT_MS if Task 0's SLOWEST_POST_MS is over 5 s
// (2x the slowest, at most 20 s).
const GET_TIMEOUT_MS = 8_000;
const POST_TIMEOUT_MS = 10_000;
const DEDUPE_MS = 2 * 60 * 1000;
const RETRY_STALE_MS = 10 * 60 * 1000; // RV-S-m4: an admin retry runs well under a minute; an older unfinished claim was lost
const UA = 'Mozilla/5.0 (compatible; YS-Connection)';
export const UNSENT_KEEP_DAYS = 14;
const unsentAad = (id: string) => `newperson_unsent.payload:${id}`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function makeNewYouthService(
  settingsRepo: ISettingsRepository,
  // Live POSTs are an explicit opt-in: `live` omitted or false is a dry run (GETs and the shape check only).
  opts: { fetchFn?: typeof fetch; live?: boolean; errorLog?: Pick<ErrorLogService, 'record'>; unsent?: IUnsentRepository } = {},
): NewYouthService {
  const fetchFn = opts.fetchFn ?? fetch;
  const live = opts.live === true;
  // ponytail: per-instance memory on serverless; a double tap lands on the same warm instance. Use a DB row if that stops holding.
  const limiter = new RateLimiter(60, 60 * 60 * 1000); // logins are shared (grade9g), so a busy night needs headroom
  const recent = new Map<string, { at: number; result: NewYouthResult }>();

  async function getForm(url: string): Promise<string> {
    try {
      const r = await fetchFn(url, { headers: { 'User-Agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(GET_TIMEOUT_MS) });
      if (r.status !== 200) throw new Error(`status ${r.status}`);
      return await r.text();
    } catch {
      throw new AppError('ELVANTO_UNREACHABLE', "Couldn't reach Elvanto, so nothing was sent. Try again, or use the welcome-desk form.", 502);
    }
  }

  async function postRaw(e: ElvantoConfig, form: EF.FormKind, body: URLSearchParams): Promise<{ outcome: EF.Outcome; body: string }> {
    const url = EF.formUrl(e, form);
    try {
      const r = await fetchFn(url, {
        method: 'POST',
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(POST_TIMEOUT_MS),
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: e.baseUrl,
          Referer: url,
        },
      });
      const text = await r.text();
      return { outcome: EF.classifyPost(form, { status: r.status, location: r.headers.get('location'), body: text }), body: text };
    } catch {
      return { outcome: 'unconfirmed', body: '' }; // a timeout may still have landed in Elvanto: never auto-resend
    }
  }
  const post = async (e: ElvantoConfig, form: EF.FormKind, body: URLSearchParams): Promise<EF.Outcome> => (await postRaw(e, form, body)).outcome;

  // ── T10 unsent queue. The payload is the submitted form, encrypted; nothing about it is ever logged. ──
  const purge = () => opts.unsent!.purgeBefore(new Date(Date.now() - UNSENT_KEEP_DAYS * 86_400_000).toISOString());
  /** Saves (or, for a resend, updates) a row. Never throws: false when it could not be stored (e.g. no FIELD_ENCRYPTION_KEY). */
  async function keep(id: string | undefined, reason: UnsentReason, payload: unknown): Promise<boolean> {
    if (!opts.unsent) return false;
    try {
      await purge();
      const rid = id ?? randomUUID(), at = new Date().toISOString();
      // S-5: never keep the phone's requestId: an admin resend claims its own `retry:` key.
      const { requestId: _drop, ...form } = payload as Record<string, unknown>;
      await opts.unsent.save({ id: rid, reason, payload: encryptField(JSON.stringify(form), unsentAad(rid)), createdAt: at, updatedAt: at });
      return true;
    } catch {
      await opts.errorLog?.record({ category: 'elvanto-form', code: 'UNSENT_SAVE_FAILED', route: 'POST /intake/new-youth' });
      return false;
    }
  }
  async function readAll() {
    await purge();
    return (await opts.unsent!.list()).map(({ payload, ...r }) => {
      try { return { ...r, input: JSON.parse(decryptField(payload, unsentAad(r.id))) as Record<string, unknown> | null }; }
      catch { return { ...r, input: null }; }
    });
  }
  /** After a send fully landed: drop the resent row and any saved row for the same person. Never throws. */
  async function clear(retryId: string | undefined, d: { firstName: string; lastName: string; dob: string; parentMobile: string }) {
    if (!opts.unsent) return;
    try {
      for (const r of await readAll()) {
        const o = r.input ? Schema.safeParse(r.input) : null;
        const same = !!o?.success && o.data.firstName === d.firstName && o.data.lastName === d.lastName
          && o.data.dob === d.dob && o.data.parentMobile === d.parentMobile;
        if (r.id === retryId || same) await opts.unsent.remove(r.id);
      }
    } catch { /* the send itself landed; a stale row only stays until the admin deletes it or it is purged */ }
  }

  // S-5/D4: the DB request claim. It must FAIL OPEN: a DB blip never blocks a Friday host (error log NY_REQ_FAILED).
  const reqFailed = () => opts.errorLog?.record({ category: 'elvanto-form', code: 'NY_REQ_FAILED', route: 'POST /intake/new-youth' }).catch(() => {});
  async function claim(id: string, by: string, staleMs?: number): Promise<{ fresh: boolean; result: unknown | null } | null> {
    try { return await opts.unsent!.claimRequest(id, by, staleMs); } catch { await reqFailed(); return null; }
  }
  async function finish(id: string | undefined, result: NewYouthResult | null) {
    if (!id) return;
    try { await opts.unsent!.finishRequest(id, result); } catch { await reqFailed(); }
  }

  async function run(actor: Actor, input: unknown, retryId?: string, reqId?: string): Promise<NewYouthResult> {
      assertCan(actor, 'intake:write');
      const settings = await settingsRepo.getSettings();
      if (!canUseNewYouth(actor, settings.ministryConfig.modules.newYouthForms)) throw new ModuleDisabledError('New person');
      // A blank or half-filled Elvanto block never reaches Elvanto (and never falls back to Brisbane's forms).
      if (!EF.elvantoReady(settings.ministryConfig)) throw new AppError('ELVANTO_NOT_SET', "New person isn't set up here yet. Ask your admin.", 409);
      const elv = settings.ministryConfig.elvanto;

      const parsed = Schema.safeParse(input);
      if (!parsed.success) {
        const field = String(parsed.error.issues[0]?.path[0] ?? 'request');
        throw new BadRequestError(`Check the ${LABELS[field] ?? 'details'}`);
      }
      if (!gradeRange(settings.ministryConfig.structure).includes(Number(parsed.data.grade))) throw new BadRequestError(`Check the ${LABELS.grade}`); // grade 6 only when "Include Grade 6" is on
      const data = parsed.data; // z.object strips unknown keys, so a stray `attending` is dropped here
      const ref = makeRef();
      const y: EF.NewYouth = { ...data, ref };

      const now = Date.now();
      for (const [k, v] of recent) if (now - v.at > DEDUPE_MS) recent.delete(k);
      const key = createHash('sha256').update(JSON.stringify([y.firstName, y.lastName, y.dob, y.parentMobile, data.send])).digest('hex');
      const hit = retryId ? undefined : recent.get(key); // an admin resend is deliberate: never answered from the double-tap memory
      if (hit) return { ...hit.result, repeat: true };

      if (limiter.isBlocked(actor.id)) {
        throw new AppError('RATE_LIMITED', 'Too many forms from this login. Try again in an hour.', 429);
      }

      // S-5/D4: a request id seen before (any instance) is never posted again. Null claim = DB error: carry on.
      let held: string | undefined;
      if (live && reqId && opts.unsent) {
        const c = await claim(reqId, actor.id, retryId ? RETRY_STALE_MS : undefined); // RV-S-m4: a lost finish frees the row after 10 min
        if (c && !c.fresh) {
          // C-B2: an admin resend of the same row is still running (its key holds the row's updatedAt).
          if (retryId && c.result == null) throw new AppError('UNSENT_BUSY', 'Already resending. Wait for it to finish.', 409);
          return { ...((c.result as NewYouthResult | null) ?? { student: 'unconfirmed', parent: 'unconfirmed', dryRun: false }), repeat: true };
        }
        if (c) held = reqId;
      }

      // Remember the send BEFORE the form GETs (live mode only): a second tap while this one is still
      // fetching or posting gets "unconfirmed" back instead of posting the same student again.
      if (live) recent.set(key, { at: now, result: { student: 'unconfirmed', parent: 'unconfirmed', dryRun: false, ref } });

      let sBody: URLSearchParams, pBody: URLSearchParams;
      try {
        const [sHtml, pHtml] = await Promise.all([getForm(EF.formUrl(elv, 'student')), getForm(EF.formUrl(elv, 'parent'))]);
        const sHp = EF.honeypotName(sHtml), pHp = EF.honeypotName(pHtml);
        sBody = EF.studentBody(y, sHp ?? 'elvanto-missing', elv);
        pBody = EF.parentBody(y, pHp ?? 'elvanto-missing', elv);
        if (!sHp || !pHp || EF.shapeProblems(sHtml, sBody, elv).length || EF.shapeProblems(pHtml, pBody, elv).length) {
          throw new AppError('ELVANTO_FORM_CHANGED', 'The Elvanto form has changed, so nothing was sent. Use the welcome-desk form and tell the admin.', 502);
        }
      } catch (e) {
        recent.delete(key); // nothing was posted: let a fixed retry through
        await finish(held, null);
        // T10: Elvanto unreachable or its form changed. Nothing was posted, so the whole send is kept for the admin.
        if (live && e instanceof AppError && e.statusCode === 502
          && await keep(retryId, e.code === 'ELVANTO_FORM_CHANGED' ? 'form-changed' : 'unreachable', { ...(input as object), send: data.send })
          && !retryId) {
          throw new AppError(e.code, e.code === 'ELVANTO_FORM_CHANGED'
            ? 'The Elvanto form has changed, so nothing was sent. Saved for the admin to resend.'
            : "Couldn't reach Elvanto, so nothing was sent. Saved for the admin to resend.", 502);
        }
        throw e;
      }

      if (!live) return { student: 'skipped', parent: 'skipped', dryRun: true };

      const student: EF.Outcome = data.send.includes('student') ? await post(elv, 'student', sBody) : 'skipped';
      const parent: EF.Outcome = !data.send.includes('parent') || student === 'failed' ? 'skipped' : await post(elv, 'parent', pBody);
      const result: NewYouthResult = { student, parent, dryRun: false, ref };
      // T3: an unconfirmed or rejected send goes to the admin Error log (form + outcome only, never the person).
      for (const [form, o] of [['STUDENT', student], ['PARENT', parent]] as const) {
        if (o === 'unconfirmed' || o === 'failed') {
          await opts.errorLog?.record({ category: 'elvanto-form', code: `${form}_FORM_${o.toUpperCase()}`, route: 'POST /intake/new-youth', role: actor.role });
        }
      }
      // T10: keep only the forms that did not land; unconfirmed wins (the admin is warned it may already be in Elvanto).
      const outs = { student, parent };
      if ([student, parent].some((o) => o === 'failed' || o === 'unconfirmed')) {
        const reason: UnsentReason = [student, parent].includes('unconfirmed') ? 'unconfirmed' : 'failed';
        if (await keep(retryId, reason, { ...(input as object), send: data.send.filter((f) => outs[f] !== 'sent') })) result.queued = true;
      } else await clear(retryId, data);
      // RV-S-M1: free the id only when nothing can have landed; a partial send answers its stored result on repeat.
      if ([student, parent].some((o) => o === 'sent' || o === 'unconfirmed')) { recent.set(key, { at: now, result }); await finish(held, result); }
      else { recent.delete(key); await finish(held, null); } // a clear rejection: let the fixed retry through
      return result;
  }

  // ponytail: envelope duplicated from run(); extract a shared guard if a third form kind appears
  async function runBus(actor: Actor, input: unknown, retryId?: string, reqId?: string): Promise<BusResult> {
    assertCan(actor, 'bus:use');
    const settings = await settingsRepo.getSettings();
    if (!settings.ministryConfig.modules.busMinistry) throw new ModuleDisabledError('Bus Ministry');
    if (!EF.elvantoBusReady(settings.ministryConfig)) throw new AppError('ELVANTO_NOT_SET', "The bus consent form isn't set up here yet. Ask your admin.", 409);
    const elv = settings.ministryConfig.elvanto;
    const p = BusSchema.safeParse(input);
    if (!p.success) throw new BadRequestError(`Check the ${BUS_LABELS[String(p.error.issues[0]?.path[0] ?? '')] ?? 'details'}`);
    if (!gradeRange(settings.ministryConfig.structure).includes(Number(p.data.grade))) throw new BadRequestError('Check the grade');
    const b = p.data;
    const k = createHash('sha256').update(JSON.stringify(['bus', b.first, b.last, b.parentPhone])).digest('hex');
    const now = Date.now();
    for (const [x, v] of recent) if (now - v.at > DEDUPE_MS) recent.delete(x);
    const hit = retryId ? undefined : recent.get(k);
    if (hit) return { ...(hit.result as unknown as BusResult), repeat: true };
    if (limiter.isBlocked(actor.id)) throw new AppError('RATE_LIMITED', 'Too many forms from this login. Try again in an hour.', 429);
    let held: string | undefined;
    if (live && reqId && opts.unsent) {
      const c = await claim(reqId, actor.id, retryId ? RETRY_STALE_MS : undefined);
      if (c && !c.fresh) {
        if (retryId && c.result == null) throw new AppError('UNSENT_BUSY', 'Already resending. Wait for it to finish.', 409);
        return { ...((c.result as BusResult | null) ?? { result: 'unconfirmed', dropoff: null }), repeat: true };
      }
      if (c) held = reqId;
    }
    if (live) recent.set(k, { at: now, result: { result: 'unconfirmed', dropoff: null } as unknown as NewYouthResult });
    const saved = { ...(input as object), kind: 'busConsent', send: ['busConsent'] };
    let body: URLSearchParams;
    try {
      const html = await getForm(EF.formUrl(elv, 'busConsent'));
      const hp = EF.honeypotName(html);
      body = EF.busConsentBody(b, hp ?? 'elvanto-missing', elv);
      // F17: a blank grade or pickup option id would post an empty select: refuse like any other form change.
      if (!hp || !elv.options[`bcGrade${b.grade}`] || !elv.options[b.pickup ? 'bcPickupYes' : 'bcPickupNo'] || EF.shapeProblems(html, body, elv).length) {
        throw new AppError('ELVANTO_FORM_CHANGED', 'The Elvanto bus consent form has changed, so nothing was sent. Tell the admin.', 502);
      }
    } catch (e) {
      recent.delete(k);
      await finish(held, null);
      if (live && e instanceof AppError && e.statusCode === 502
        && await keep(retryId, e.code === 'ELVANTO_FORM_CHANGED' ? 'form-changed' : 'unreachable', saved) && !retryId) {
        throw new AppError(e.code, e.code === 'ELVANTO_FORM_CHANGED'
          ? 'The Elvanto bus consent form has changed, so nothing was sent. Saved for the admin to resend.'
          : "Couldn't reach Elvanto, so nothing was sent. Saved for the admin to resend.", 502);
      }
      throw e;
    }
    if (!live) return { result: 'skipped', dropoff: null };
    const r = await postRaw(elv, 'busConsent', body);
    const out: BusResult = { result: r.outcome, dropoff: r.outcome === 'sent' ? EF.dropoffOf(r.body) : null };
    if (r.outcome === 'sent') {
      if (opts.unsent && retryId) { try { await opts.unsent.remove(retryId); } catch { /* sent; a stale row waits for the admin or the purge */ } }
    } else {
      await opts.errorLog?.record({ category: 'elvanto-form', code: `BUS_CONSENT_FORM_${r.outcome.toUpperCase()}`, route: 'POST /bus/consent-form', role: actor.role });
      if (await keep(retryId, r.outcome === 'unconfirmed' ? 'unconfirmed' : 'failed', saved)) out.queued = true;
    }
    if (r.outcome === 'sent' || r.outcome === 'unconfirmed') { recent.set(k, { at: now, result: out as unknown as NewYouthResult }); await finish(held, out as unknown as NewYouthResult); }
    else { recent.delete(k); await finish(held, null); }
    return out;
  }

  return {
    send: (actor, input) => {
      // S-5: optional client request id (a UUID made at Send, reused on resend). Anything else is ignored, never refused.
      const r = (input as { requestId?: unknown } | null)?.requestId;
      return run(actor, input, undefined, typeof r === 'string' && UUID_RE.test(r) ? r : undefined);
    },

    sendBusConsent: (actor, input) => {
      const r = (input as { requestId?: unknown } | null)?.requestId;
      return runBus(actor, input, undefined, typeof r === 'string' && UUID_RE.test(r) ? r : undefined);
    },

    async unsentList(actor) {
      assertCan(actor, 'admin:manage');
      if (!opts.unsent) return { rows: [] };
      return { rows: (await readAll()).map(({ input: i, ...r }) => ({ ...r,
        forms: Array.isArray(i?.send) ? i.send.map(String) : [],
        name: i ? (i.kind === 'busConsent' ? `${String(i.first ?? '')} ${String(i.last ?? '')}` : `${String(i.firstName ?? '')} ${String(i.lastName ?? '')}`).trim() : null,
        host: i && i.kind !== 'busConsent' ? String(i.host ?? '') : null, grade: i ? String(i.grade ?? '') : null })) };
    },

    async unsentRetry(actor, id, body) {
      assertCan(actor, 'admin:manage');
      const row = opts.unsent ? (await readAll()).find((r) => r.id === id) : undefined;
      if (!row) throw new NotFoundError('That saved form is gone (sent, deleted, or older than 14 days).');
      if (!row.input) throw new AppError('UNSENT_UNREADABLE', "This saved form can't be read. Delete it.", 409);
      if (row.reason === 'unconfirmed' && (body as { confirm?: unknown } | undefined)?.confirm !== true) {
        throw new AppError('UNSENT_CHECK_ELVANTO', 'This may already be in Elvanto: check before retrying.', 409);
      }
      if (row.input.kind === 'busConsent') return runBus(actor, row.input, id, `retry:${id}:${row.updatedAt}`);
      return run(actor, row.input, id, `retry:${id}:${row.updatedAt}`); // C-B2: never the phone's requestId
    },

    async unsentDelete(actor, id) {
      assertCan(actor, 'admin:manage');
      if (!opts.unsent || !(await opts.unsent.remove(id))) throw new NotFoundError('That saved form is gone.');
      return { ok: true };
    },
  };
}
