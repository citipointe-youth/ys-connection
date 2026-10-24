// Admin Error log (UX batch 2026-10-13 T3; Part 1 rework 2026-10-17). One cause = one entry: occurrences with the same
// fold key within 30 min of the entry's last_seen join it (count, first/last seen). Stores code, route, status, role,
// tier and a FIXED line 1 only: never a name, phone, request body, error text or value (minors' data). The two lines
// shown are computed from the code at read time (error-log-text.ts). Admin only (admin:manage) apart from the SPA's report.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Actor } from '../core/entities/user';
import { NotFoundError } from '../core/errors/app-error';
import { ERROR_CATEGORIES, type ErrorCategory, type ErrorLogRow, type IErrorLogRepository } from '../repositories/interfaces/error-log.repository';
import type { ILinkRepository } from '../repositories/interfaces/link.repository';
import type { ActionType } from '../core/link-types';
import { ACTION_TYPES } from '../core/link-contract';
import { ERROR_TIERS, TEXT, TIER_RANK, textFor } from './error-log-text';
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
/** D1 (2026-10-24): a link refusal (any link row but a count row) goes after this long, or after a later success of its type. */
export const REFUSAL_KEEP_DAYS = 7;
/** Ultra #4 (operator ruling A, 2026-10-24): a later success of the same type clears only these type-wide refusal reasons.
 *  Per-person/per-item ones (person-unknown, form-unknown, not-landed, no-room, ...) wait for the 7-day expiry or an admin.
 *  no-room left the set by a later ruling (link seam review #3): the console's no-room is nearly always about one person. */
const SUCCESS_CLEARS = new Set(['locked', 'too-old', 'service-not-offered', 'console-busy', 'lease-lost']);
/** Link rows that are live counts (setCount on a fixed id): never expired by REFUSAL_KEEP_DAYS. Identified by code, not foldKey (pre-0035 rows have none). */
const COUNT_CODES = new Set(['pending-24h', 'unclear', 'lease-lost']);
const UNCLEAR_CODES = new Set(['unclear', 'lease-lost']);
const ACTION_TYPE_SET = new Set<string>(ACTION_TYPES);
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

/** "GET /students/9e00…?q=Sam" -> "GET /students/:id". Query and hash dropped; a segment with a digit, a hex/uuid run or 16+ chars (token-like) becomes :id. */
export function normaliseRoute(route: string): string {
  const [method, path = ''] = route.includes(' ') ? route.split(' ', 2) : ['', route];
  const p = path.split(/[?#]/)[0]!.split('/').map((seg) => (/\d/.test(seg) || seg.length >= 16 || /^[0-9a-f-]{8,}$/i.test(seg) ? ':id' : seg)).join('/');
  return (method ? method.toUpperCase() + ' ' : '') + p;
}

/** Server error codes from the Elvanto form sender belong to the elvanto-form filter. */
export const categoryForCode = (code: string): ErrorCategory => (code.startsWith('ELVANTO_') ? 'elvanto-form' : 'server');

/** A stored row plus its texts, computed from the code at read time (a wording change applies to old rows). */
export type ErrorLogView = ErrorLogRow & { line1: string; line2: string; counted: boolean };
export function toView(r: ErrorLogRow, recheckLive = false): ErrorLogView {
  const t = textFor(r.category, r.code, r.route, r.status, r.count, recheckLive);
  return { ...r, tier: t.tier, line1: t.line1, line2: t.line2, counted: t.counted };
}
const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32);
/** The fixed id a setCount row is stored under. */
const fixedId = (category: string, code: string, route: string, status: number | null) => hash(`${category}|${code}|${route}|${status ?? ''}`);

/** Codes a client report may carry (server error codes + the TEXT ones + NETWORK). Anything else becomes HTTP_<status>. */
const KNOWN_CODES = new Set([...Object.keys(TEXT).filter((k) => /^[A-Z]/.test(k)), 'NETWORK', 'BAD_REQUEST', 'CONFLICT', 'FORBIDDEN',
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
const Tier = z.enum(ERROR_TIERS);

export interface ErrorLogDeps {
  repo: IErrorLogRepository;
  /** For the stale-pending sweep on the admin view. */
  link?: Pick<ILinkRepository, 'listActions'> & Partial<Pick<ILinkRepository, 'listConsoles'>>;
  now?: () => Date;
  /** Spec 2026-10-22 §7: re-evaluates audit-feed-stale (setCount) before the admin view reads. */
  auditFeed?: () => Promise<void>;
}

export function makeErrorLogService(d: ErrorLogDeps) {
  const now = d.now ?? (() => new Date());
  const limiter = new RateLimiter(CLIENT_REPORT_MAX, CLIENT_REPORT_WINDOW_MS);
  // The router table's "METHOD /path" patterns, normalised (set by buildRoutes). Empty = every client route reads as 'page'.
  let knownRoutes = new Set<string>();
  // R5: one DB write per fold key per 30 s; skipped repeats are added to the next write's n.
  // ponytail: per-instance throttle; a skip with no later error is never written
  const lastWrite = new Map<string, { at: number; skipped: number }>();

  /**
   * THE helper other server code calls to log an error. Never throws and never waits more than 2 s.
   * `setCount` stores that count instead of adding one, on a fixed id with no window (pending-24h, reconcile); 0 deletes it.
   */
  async function record(r: ErrorReport, setCount?: number): Promise<void> {
    try {
      const code = clean(r.code, 60) || 'UNKNOWN';
      const route = clean(r.route, 120);
      const status = typeof r.status === 'number' ? r.status : null;
      const at = now().toISOString();
      const text = textFor(r.category, code, route, status, setCount ?? r.count ?? 1);
      let id: string, foldKey: string | null = null, n = r.count;
      if (setCount !== undefined) {
        id = fixedId(r.category, code, route, status); // fixed id, no window (pending-24h, unclear, lease-lost, reconcile)
      } else {
        // Same cause = one entry: link rows by reason + type; anything else by code + status (route and category dropped).
        foldKey = r.category === 'link' ? `link|${code}|${route}` : `${code}|${status ?? ''}`;
        const t = now().getTime(), w = lastWrite.get(foldKey);
        if (w && t - w.at < RECORD_THROTTLE_MS) { w.skipped += r.count ?? 1; return; }
        n = (r.count ?? 1) + (w?.skipped ?? 0);
        lastWrite.set(foldKey, { at: t, skipped: 0 });
        id = hash(`${foldKey}|${at}`);
      }
      const write = d.repo.record({ id, category: r.category, code, route, status, message: text.line1, tier: text.tier, foldKey,
        role: r.role ? clean(r.role, 20) : null, at, n }, setCount);
      await Promise.race([write, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), RECORD_TIMEOUT_MS).unref?.())]);
    } catch (e) {
      logger.warn('could not record', { category: r.category, code: r.code, err: e instanceof Error ? e.name : 'unknown' });
    }
  }

  /**
   * Link alerts clear themselves (D1). Pending past STALE_PENDING_MS and open unclear actions are live counts per type
   * (a type back to zero is cleared); every other link row goes after REFUSAL_KEEP_DAYS or once a later action of its type was sent.
   */
  async function sweepStale(existing: ErrorLogRow[]): Promise<void> {
    if (!d.link) return;
    const link = d.link;
    const t = now().getTime(), cut = t - STALE_PENDING_MS;
    const byType = new Map<string, number>();
    for (const r of await d.link.listActions({ statuses: ['pending'] })) {
      if (r.type !== 'recheck' && Date.parse(r.createdAt) < cut) byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
    }
    for (const [type, n] of byType) await record({ category: 'link', code: 'pending-24h', route: type }, n);
    for (const r of existing) {
      if (r.category === 'link' && r.code === 'pending-24h' && !byType.has(r.route)) await record({ category: 'link', code: 'pending-24h', route: r.route }, 0);
    }
    // Open unclear actions (lease-lost is an unclear with that reason), counted per (code, type). Recheck rows show on their own row.
    const open = new Map<string, number>();
    for (const r of await link.listActions({ statuses: ['unclear'] })) {
      if (r.type !== 'recheck') { const k = `${r.reason === 'lease-lost' ? 'lease-lost' : 'unclear'}|${r.type}`; open.set(k, (open.get(k) ?? 0) + 1); }
    }
    for (const [k, n] of open) { const [code, route] = k.split('|') as [string, string]; await record({ category: 'link', code, route }, n); }
    const events: ErrorLogRow[] = [];
    for (const r of existing) {
      if (r.category !== 'link') continue;
      if (!COUNT_CODES.has(r.code)) { events.push(r); continue; }
      if (!UNCLEAR_CODES.has(r.code)) continue;
      // Only the fixed-id row is the count: windowed and pre-0035 copies go; the fixed one goes once nothing is open.
      if (r.id !== fixedId('link', r.code, r.route, r.status)) await d.repo.remove(r.id);
      else if (!open.has(`${r.code}|${r.route}`)) await record({ category: 'link', code: r.code, route: r.route }, 0);
    }
    const keepFrom = new Date(t - REFUSAL_KEEP_DAYS * DAY).toISOString();
    const left = new Map<string, ErrorLogRow[]>();
    for (const r of events) {
      if (r.lastSeen < keepFrom) await d.repo.remove(r.id);
      else if (ACTION_TYPE_SET.has(r.route) && SUCCESS_CLEARS.has(r.code)) left.set(r.route, [...(left.get(r.route) ?? []), r]);
    }
    for (const [route, rows] of left) {
      // Bounded: the newest 50 sent since a week before the oldest row's day (an unbounded sent read is the whole history).
      const from = new Date(Date.parse(rows.reduce((a, r) => (r.lastSeen < a ? r.lastSeen : a), rows[0]!.lastSeen)) - REFUSAL_KEEP_DAYS * DAY).toISOString().slice(0, 10);
      const sent = await link.listActions({ types: [route as ActionType], statuses: ['sent'], serviceDateFrom: from, limit: 50 });
      const last = sent.reduce((a, s) => (s.resultAt && s.resultAt > a ? s.resultAt : a), '');
      for (const r of rows) if (last > r.lastSeen) await d.repo.remove(r.id);
    }
  }

  /** The sweep on its own (end of a link sync, ruling e). Never throws and never waits more than 2 s. */
  async function sweep(): Promise<void> {
    try {
      await Promise.race([(async () => sweepStale(await d.repo.list()))(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), RECORD_TIMEOUT_MS).unref?.())]);
    } catch (e) {
      logger.warn('stale sweep failed', { err: e instanceof Error ? e.name : 'unknown' });
    }
  }

  return {
    record,
    sweep,

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

    async list(actor: Actor): Promise<{ rows: ErrorLogView[] }> {
      assertCan(actor, 'admin:manage');
      await d.repo.purgeBefore(new Date(now().getTime() - ERROR_LOG_KEEP_DAYS * DAY).toISOString());
      try { await d.auditFeed?.(); } catch (e) { logger.warn('audit feed check failed', { err: e instanceof Error ? e.name : 'unknown' }); }
      await sweep();
      // Check again is offered only while the newest console lists recheck live (as the SPA's _lkRcHtml).
      let live = false;
      try {
        const con = [...((await d.link?.listConsoles?.()) ?? [])].sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))[0];
        live = con?.capabilities?.recheck === 'live';
      } catch { /* no consoles read: the old wording */ }
      const rows = (await d.repo.list()).map((r) => toView(r, live));
      rows.sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || b.lastSeen.localeCompare(a.lastSeen));
      return { rows };
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

    /** category / tier omitted = every row. `tier=fyi` is the SPA's "Clear FYI". */
    async removeAll(actor: Actor, category: unknown, tier?: unknown): Promise<{ deleted: number }> {
      assertCan(actor, 'admin:manage');
      const c = category === undefined || category === '' ? undefined : Category.parse(category);
      const t = tier === undefined || tier === '' ? undefined : Tier.parse(tier);
      return { deleted: await d.repo.removeAll(c, t) };
    },
  };
}

export type ErrorLogService = ReturnType<typeof makeErrorLogService>;
