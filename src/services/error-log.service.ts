// Admin Error log (UX batch 2026-10-13 T3). Groups identical errors by fingerprint (category + code + route + status)
// with a count and first/last seen. Stores code, route, status, role and a short FIXED message only: never a name,
// phone, request body, error text or value (minors' data). Admin only (admin:manage) apart from the SPA's own report.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Actor } from '../core/entities/user';
import { NotFoundError } from '../core/errors/app-error';
import { ERROR_CATEGORIES, type ErrorCategory, type ErrorLogRow, type IErrorLogRepository } from '../repositories/interfaces/error-log.repository';
import type { ILinkRepository } from '../repositories/interfaces/link.repository';
import { assertCan } from './access-control';
import { createLogger } from '../utils/logger';
import { RateLimiter } from '../utils/rate-limiter';

const logger = createLogger('error-log');
const DAY = 86_400_000;
export const ERROR_LOG_KEEP_DAYS = 90;
/** A link action still pending after this long is logged (the console may be offline; claim never sweeps it). */
export const STALE_PENDING_MS = DAY;
const RECORD_TIMEOUT_MS = 2_000;
const RECORD_THROTTLE_MS = 30_000;
// ponytail: per-instance memory on serverless, like the login limiter. A DB counter if reports ever flood.
export const CLIENT_REPORT_MAX = 20;
const CLIENT_REPORT_WINDOW_MS = 10 * 60 * 1000;

export interface ErrorReport {
  category: ErrorCategory; code: string; route: string; status?: number | null; role?: string | null;
  /** Occurrences to add (default 1): a batch of identical errors is one write. */
  count?: number;
}

/** Keeps only safe characters, then truncates. Never trusts a caller's length. */
const clean = (s: unknown, n: number) => String(s ?? '').replace(/[^\w .:/#-]/g, '').trim().slice(0, n);

/** "GET /students/9e00…?q=Sam" -> "GET /students/:id". Query and hash dropped; a segment with a digit becomes :id. */
export function normaliseRoute(route: string): string {
  const [method, path = ''] = route.includes(' ') ? route.split(' ', 2) : ['', route];
  const p = path.split(/[?#]/)[0]!.split('/').map((seg) => (/\d/.test(seg) ? ':id' : seg)).join('/');
  return (method ? method.toUpperCase() + ' ' : '') + p;
}

/** Server error codes from the Elvanto form sender belong to the elvanto-form filter. */
export const categoryForCode = (code: string): ErrorCategory => (code.startsWith('ELVANTO_') ? 'elvanto-form' : 'server');

const MESSAGES: Record<string, string> = {
  INTERNAL_ERROR: 'Unexpected server error',
  INTERNAL: 'Unexpected server error in a link batch item',
  SERVICE_UNAVAILABLE: 'Database busy or unreachable',
  REQUEST_TIMEOUT: 'Request took too long',
  LINK_OFF: 'The YS link sync token is not set',
  ELVANTO_FORM_CHANGED: 'The Elvanto form changed, so nothing was sent',
  ELVANTO_UNREACHABLE: 'Could not reach Elvanto, so nothing was sent',
  STUDENT_FORM_UNCONFIRMED: 'New person: student form send not confirmed by Elvanto',
  PARENT_FORM_UNCONFIRMED: 'New person: parent form send not confirmed by Elvanto',
  STUDENT_FORM_FAILED: 'New person: Elvanto rejected the student form',
  PARENT_FORM_FAILED: 'New person: Elvanto rejected the parent form',
  unclear: 'The console could not confirm this action landed in Elvanto',
  'too-old': 'Expired before the console ran it',
  'lease-lost': 'The console stopped answering mid-send',
  'note-unreadable': 'The stored note could not be read',
  'intake-unreadable': 'A stored intake plan could not be decrypted',
  'pending-24h': 'Waiting more than 24 hours (is the console offline?)',
  NETWORK: 'Request failed: no connection',
};
/** Fixed text only. Exported for the tests. */
export function messageFor(category: ErrorCategory, code: string, status: number | null): string {
  if (MESSAGES[code]) return MESSAGES[code]!;
  if (category === 'link') return 'The console refused this action';
  if (category === 'client') return code.startsWith('JS_') ? 'Page error' : `Request failed${status ? ` (${status})` : ''}`;
  return `Server error${status ? ` (${status})` : ''}`;
}

/** Codes a client report may carry (server error codes + the fixed ones above). Anything else becomes HTTP_<status>. */
const KNOWN_CODES = new Set([...Object.keys(MESSAGES).filter((k) => /^[A-Z]/.test(k)), 'BAD_REQUEST', 'CONFLICT', 'FORBIDDEN',
  'INTAKE_STALE', 'LINK_CONTRACT_MISMATCH', 'LINK_DUPLICATE', 'LINK_EDIT_IN_ELVANTO', 'LINK_ID_REUSED', 'LINK_NOT_YOURS', 'LINK_STALE',
  'LINK_STILL_SENDING', 'LINK_TOO_LATE', 'LINK_TOO_OLD', 'LINK_UNAVAILABLE', 'MODULE_DISABLED', 'MUST_CHANGE_PASSWORD', 'NOT_FOUND',
  'RATE_LIMITED', 'ROUTING_BAD_ADDRESS', 'ROUTING_FAILED', 'SETTINGS_CHANGED', 'SETUP_INCOMPLETE', 'UNAUTHORIZED', 'VALIDATION_ERROR']);

const ClientReport = z.object({
  kind: z.enum(['js', 'api']),
  code: z.string().default(''),
  route: z.string().default(''),
  status: z.number().int().min(0).max(599).nullable().default(null),
});
const Flags = z.object({ minimised: z.boolean().optional(), ignored: z.boolean().optional() })
  .refine((f) => f.minimised !== undefined || f.ignored !== undefined, 'minimised or ignored');
const Category = z.enum(ERROR_CATEGORIES);

export interface ErrorLogDeps {
  repo: IErrorLogRepository;
  /** For the stale-pending sweep on the admin view. */
  link?: Pick<ILinkRepository, 'listActions'>;
  now?: () => Date;
}

export function makeErrorLogService(d: ErrorLogDeps) {
  const now = d.now ?? (() => new Date());
  const limiter = new RateLimiter(CLIENT_REPORT_MAX, CLIENT_REPORT_WINDOW_MS);
  // The router table's "METHOD /path" patterns, normalised (set by buildRoutes). Empty = every client route reads as 'page'.
  let knownRoutes = new Set<string>();
  // R5: one DB write per fingerprint per 30 s; skipped repeats are added to the next write's n.
  // ponytail: per-instance throttle; a skip with no later error is never written
  const lastWrite = new Map<string, { at: number; skipped: number }>();

  /**
   * THE helper other server code calls to log an error. Never throws and never waits more than 2 s.
   * `setCount` stores that count instead of adding one (the stale-pending sweep).
   */
  async function record(r: ErrorReport, setCount?: number): Promise<void> {
    try {
      const code = clean(r.code, 60) || 'UNKNOWN';
      const route = clean(r.route, 120);
      const status = typeof r.status === 'number' ? r.status : null;
      const id = createHash('sha256').update(`${r.category}|${code}|${route}|${status ?? ''}`).digest('hex').slice(0, 32);
      let n = r.count;
      if (setCount === undefined) {
        const t = now().getTime(), w = lastWrite.get(id);
        if (w && t - w.at < RECORD_THROTTLE_MS) { w.skipped += r.count ?? 1; return; }
        n = (r.count ?? 1) + (w?.skipped ?? 0);
        lastWrite.set(id, { at: t, skipped: 0 });
      }
      const write = d.repo.record({ id, category: r.category, code, route, status, message: messageFor(r.category, code, status),
        role: r.role ? clean(r.role, 20) : null, at: now().toISOString(), n }, setCount);
      await Promise.race([write, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), RECORD_TIMEOUT_MS).unref?.())]);
    } catch (e) {
      logger.warn('could not record', { category: r.category, code: r.code, err: e instanceof Error ? e.name : 'unknown' });
    }
  }

  /** Link actions pending past STALE_PENDING_MS, counted per type (count = how many wait now). */
  async function sweepStale(): Promise<void> {
    if (!d.link) return;
    const cut = now().getTime() - STALE_PENDING_MS;
    const byType = new Map<string, number>();
    for (const r of await d.link.listActions({ statuses: ['pending'] })) {
      if (Date.parse(r.createdAt) < cut) byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
    }
    for (const [type, n] of byType) await record({ category: 'link', code: 'pending-24h', route: type }, n);
  }

  return {
    record,

    /** Route patterns ("GET /students/:id") the SPA may report; anything else is stored as 'page'. */
    setKnownRoutes(patterns: string[]): void {
      knownRoutes = new Set(patterns.map((p) => normaliseRoute(p.replace(/:\w+/g, ':id'))));
    },

    /** POST from the logged-in SPA: window errors and failed API calls. Over the per-login limit it is dropped quietly. */
    async reportClient(actor: Actor, body: unknown): Promise<{ ok: boolean }> {
      if (limiter.isBlocked(actor.id)) return { ok: false };
      const b = ClientReport.parse(body);
      // Only shapes that cannot carry free text: an error class name, a server code, "line N:N" / "promise", a route.
      const code = b.kind === 'js'
        ? 'JS_' + (/^[A-Za-z]{1,40}/.exec(b.code)?.[0] ?? 'Error')
        : KNOWN_CODES.has(b.code) ? b.code : b.status ? `HTTP_${b.status}` : b.code ? 'CLIENT_ERROR' : 'NETWORK';
      const apiRoute = normaliseRoute(clean(b.route.split(/[?#]/)[0], 200));
      const route = b.kind === 'api' ? (knownRoutes.has(apiRoute) ? apiRoute : 'page')
        : /^(line \d{1,7}:\d{1,7}|promise)$/.test(b.route) ? b.route : 'page';
      await record({ category: 'client', code, route, status: b.status || null, role: actor.role });
      return { ok: true };
    },

    async list(actor: Actor): Promise<{ rows: ErrorLogRow[] }> {
      assertCan(actor, 'admin:manage');
      await d.repo.purgeBefore(new Date(now().getTime() - ERROR_LOG_KEEP_DAYS * DAY).toISOString());
      try { await sweepStale(); } catch (e) { logger.warn('stale sweep failed', { err: e instanceof Error ? e.name : 'unknown' }); }
      return { rows: await d.repo.list() };
    },

    async setFlags(actor: Actor, id: string, body: unknown): Promise<{ ok: true }> {
      assertCan(actor, 'admin:manage');
      if (!(await d.repo.setFlags(id, Flags.parse(body)))) throw new NotFoundError('That error is not in the log.');
      return { ok: true };
    },

    async remove(actor: Actor, id: string): Promise<{ ok: true }> {
      assertCan(actor, 'admin:manage');
      if (!(await d.repo.remove(id))) throw new NotFoundError('That error is not in the log.');
      return { ok: true };
    },

    /** category omitted = every row. */
    async removeAll(actor: Actor, category: unknown): Promise<{ deleted: number }> {
      assertCan(actor, 'admin:manage');
      const c = category === undefined || category === '' ? undefined : Category.parse(category);
      return { deleted: await d.repo.removeAll(c) };
    },
  };
}

export type ErrorLogService = ReturnType<typeof makeErrorLogService>;
