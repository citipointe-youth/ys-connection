import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Actor } from '../core/entities/user';
import type { ISettingsRepository } from '../repositories/interfaces/entity-repositories';
import { AppError, BadRequestError, ModuleDisabledError } from '../core/errors/app-error';
import { RateLimiter } from '../utils/rate-limiter';
import { assertCan } from './access-control';
import * as EF from './elvanto-forms';

export interface NewYouthResult {
  student: EF.Outcome;
  parent: EF.Outcome;
  dryRun: boolean;
  repeat?: boolean;
}

export interface NewYouthService {
  send(actor: Actor, input: unknown): Promise<NewYouthResult>;
}

// Fixed strings only: never echo a submitted value (minors' data must not reach logs or replies).
const LABELS: Record<string, string> = {
  host: 'your name', firstName: 'first name', lastName: 'last name',
  dob: 'date of birth', gender: 'gender', grade: 'grade', school: 'school', mobile: 'student mobile',
  address: 'address', allergies: 'allergies', conditions: 'medical conditions', medicalNotes: 'medical comments',
  parentFirst: 'parent first name', parentLast: 'parent last name', parentMobile: 'parent mobile',
  parentGender: 'parent gender', send: 'request',
};

const keys = (r: Record<string, string>) => Object.keys(r) as [string, ...string[]];
const name = z.string().trim().min(1).max(50).transform(EF.tidyName);
const mobile = z.string().transform((v, ctx) => {
  const m = EF.toAuMobile(v);
  if (!m) { ctx.addIssue({ code: z.ZodIssueCode.custom }); return z.NEVER; }
  return m;
});

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
  grade: z.enum(keys(EF.GRADES)),
  school: z.string().trim().min(1).max(80),
  mobile,
  address: z.object({
    street: z.string().trim().max(120),
    suburb: z.string().trim().max(60),
    state: z.string().trim().max(20),
    postcode: z.string().trim().regex(/^(\d{4})?$/),
  }).optional(),
  allergies: z.array(z.enum(keys(EF.ALLERGIES))).max(11).default([]),
  conditions: z.array(z.enum(keys(EF.CONDITIONS))).max(4).default([]),
  medicalNotes: z.string().trim().max(500).default(''),
  parentFirst: name,
  parentLast: name,
  parentMobile: mobile,
  parentGender: z.enum(['m', 'f']).optional(),
});

// The route is in UNTIMED_ROUTES (Task 3), so these bound it: GETs in parallel + two POSTs = 5 + 10 + 10 s,
// plus the settings read, well inside Vercel's 60 s. Raise POST_TIMEOUT_MS if Task 0's SLOWEST_POST_MS is over 5 s
// (2x the slowest, at most 20 s).
const GET_TIMEOUT_MS = 5_000;
const POST_TIMEOUT_MS = 10_000;
const DEDUPE_MS = 2 * 60 * 1000;
const UA = 'Mozilla/5.0 (compatible; YS-Connection)';

export function makeNewYouthService(
  settingsRepo: ISettingsRepository,
  opts: { fetchFn?: typeof fetch; dryRun?: boolean } = {},
): NewYouthService {
  const fetchFn = opts.fetchFn ?? fetch;
  // ponytail: per-instance memory on serverless; a double tap lands on the same warm instance. Use a DB row if that stops holding.
  const limiter = new RateLimiter(60, 60 * 60 * 1000); // logins are shared (grade9g), so a busy night needs headroom
  const recent = new Map<string, { at: number; result: NewYouthResult }>();

  async function getForm(id: string): Promise<string> {
    try {
      const r = await fetchFn(EF.formUrl(id), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(GET_TIMEOUT_MS) });
      if (r.status !== 200) throw new Error(`status ${r.status}`);
      return await r.text();
    } catch {
      throw new AppError('ELVANTO_UNREACHABLE', "Couldn't reach Elvanto, so nothing was sent. Try again, or use the welcome-desk form.", 502);
    }
  }

  async function post(form: EF.FormKind, body: URLSearchParams): Promise<EF.Outcome> {
    const id = form === 'student' ? EF.STUDENT_FORM_ID : EF.PARENT_FORM_ID;
    try {
      const r = await fetchFn(EF.formUrl(id), {
        method: 'POST',
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(POST_TIMEOUT_MS),
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: EF.ELVANTO_BASE,
          Referer: EF.formUrl(id),
        },
      });
      return EF.classifyPost(form, { status: r.status, location: r.headers.get('location'), body: await r.text() });
    } catch {
      return 'unconfirmed'; // a timeout may still have landed in Elvanto: never auto-resend
    }
  }

  return {
    async send(actor, input) {
      assertCan(actor, 'intake:write');
      const settings = await settingsRepo.getSettings();
      if (!settings.ministryConfig.modules.newYouthForms) throw new ModuleDisabledError('New youth forms');

      const parsed = Schema.safeParse(input);
      if (!parsed.success) {
        const field = String(parsed.error.issues[0]?.path[0] ?? 'request');
        throw new BadRequestError(`Check the ${LABELS[field] ?? 'details'}`);
      }
      const data = parsed.data; // z.object strips unknown keys, so a stray `attending` is dropped here
      const y: EF.NewYouth = data;

      const now = Date.now();
      for (const [k, v] of recent) if (now - v.at > DEDUPE_MS) recent.delete(k);
      const key = createHash('sha256').update(JSON.stringify([y.firstName, y.lastName, y.dob, y.parentMobile, data.send])).digest('hex');
      const hit = recent.get(key);
      if (hit) return { ...hit.result, repeat: true };

      if (limiter.isBlocked(actor.id)) {
        throw new AppError('RATE_LIMITED', 'Too many forms from this login. Try again in an hour.', 429);
      }

      const [sHtml, pHtml] = await Promise.all([getForm(EF.STUDENT_FORM_ID), getForm(EF.PARENT_FORM_ID)]);
      const sHp = EF.honeypotName(sHtml), pHp = EF.honeypotName(pHtml);
      const sBody = EF.studentBody(y, sHp ?? 'elvanto-missing');
      const pBody = EF.parentBody(y, pHp ?? 'elvanto-missing');
      if (!sHp || !pHp || EF.shapeProblems(sHtml, sBody).length || EF.shapeProblems(pHtml, pBody).length) {
        throw new AppError('ELVANTO_FORM_CHANGED', 'The Elvanto form has changed, so nothing was sent. Use the welcome-desk form and tell the admin.', 502);
      }

      if (opts.dryRun) return { student: 'skipped', parent: 'skipped', dryRun: true };

      // Remember the send BEFORE the first POST: a second tap while this one is still in flight gets
      // "unconfirmed" back instead of posting the same student again.
      recent.set(key, { at: now, result: { student: 'unconfirmed', parent: 'unconfirmed', dryRun: false } });
      const student: EF.Outcome = data.send.includes('student') ? await post('student', sBody) : 'skipped';
      const parent: EF.Outcome = !data.send.includes('parent') || student === 'failed' ? 'skipped' : await post('parent', pBody);
      const result: NewYouthResult = { student, parent, dryRun: false };
      if (student !== 'failed' && parent !== 'failed') recent.set(key, { at: now, result });
      else recent.delete(key); // a clear rejection: let the fixed retry through
      return result;
    },
  };
}
