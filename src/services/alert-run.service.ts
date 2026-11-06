// Leader alerts scheduler (spec 5.2 d). One run serves POST /sync/alerts (console, every 15 min) and GET /sync/alerts
// (Vercel cron). Each kind plans its items; the run claims each (kind, key, leader) in alert_sends BEFORE sending, so
// overlapping runs send once (at-most-once: a failed push after the claim is lost, a repeat never happens).
import type { NoticePushSub } from '../core/entities/notice';
import type { User, Actor } from '../core/entities/user';
import type { Modules } from '../core/ministry-config';
import type { IAlertSendRepository, ILeaderRepository, INoticePushRepository, ISettingsRepository, IUserRepository } from '../repositories/interfaces/entity-repositories';
import type { ErrorLogService } from './error-log.service';
import { can } from './access-control';
import { readVapid, sendToSubs, webPushSender, type PushSender } from './push-send';

export type AlertKindName = 'bday' | 'lgrem';
export type Skip = 'window' | 'push-off' | 'module-off' | 'stale' | null;
export interface Counts { leaders: number; sent: number; failed: number; skipped: Skip; hidden?: number; unlinked?: number }
/** A subscription that may receive leader alerts (S6): leader picked and active, user active with notice:alerts. */
export type EligibleSub = NoticePushSub & { user: User };
export interface AlertCtx { now: Date; tz: string; modules: Modules; subs: EligibleSub[] }
/** One leader's alert; `subs` already filtered by the kind (its pref, visibility). */
export interface AlertItem { key: string; leaderId: string; subs: NoticePushSub[]; payload: object }
export interface AlertKind {
  kind: AlertKindName;
  plan(ctx: AlertCtx): Promise<{ skipped: Skip; items: AlertItem[]; hidden?: number; unlinked?: number }>;
}

export const ALERT_BUDGET_MS = 40_000; // Vercel caps the function at 60 s; stop claiming well before.
const KEEP_MS = 30 * 86_400_000;

export interface AlertRunDeps {
  subs: Pick<INoticePushRepository, 'findAll' | 'delete'>;
  users: Pick<IUserRepository, 'findAll'>;
  leaders: Pick<ILeaderRepository, 'findAll'>;
  settings: Pick<ISettingsRepository, 'getSettings'>;
  claims: IAlertSendRepository;
  sender?: PushSender;
  env?: Record<string, string | undefined>;
  errorLog: Pick<ErrorLogService, 'record'>;
  clock?: () => number;
}

export type AlertRun = { run(now: Date, which: AlertKindName[]): Promise<{ bday?: Counts; lgrem?: Counts }> };

export function makeAlertRun(deps: AlertRunDeps, kinds: AlertKind[]): AlertRun {
  const clock = deps.clock ?? Date.now;
  const sender = deps.sender ?? webPushSender;
  return {
    async run(now, which) {
      const start = clock();
      const todo = kinds.filter((k) => which.includes(k.kind));
      const out: { bday?: Counts; lgrem?: Counts } = {};
      if (!todo.length) return out;
      const vapid = readVapid(deps.env ?? process.env);
      const cfg = (await deps.settings.getSettings()).ministryConfig;
      const off: Skip = !vapid ? 'push-off' : cfg.modules.notices !== 'on' ? 'module-off' : null;
      if (off) {
        for (const k of todo) out[k.kind] = { leaders: 0, sent: 0, failed: 0, skipped: off };
        return out;
      }
      await deps.claims.prune(new Date(now.getTime() - KEEP_MS));
      const [users, leaders, subs] = await Promise.all([deps.users.findAll(), deps.leaders.findAll(), deps.subs.findAll()]);
      const userById = new Map(users.map((u) => [u.id, u]));
      const activeLeaders = new Set(leaders.filter((l) => l.active).map((l) => l.id));
      const eligible: EligibleSub[] = subs.flatMap((s) => {
        const u = s.leaderId && activeLeaders.has(s.leaderId) ? userById.get(s.userId) : undefined;
        return u && u.status === 'active' && can(u as unknown as Actor, 'notice:alerts') ? [{ ...s, user: u }] : [];
      });

      let failedAll = 0;
      for (const k of todo) {
        const p = await k.plan({ now, tz: cfg.structure.timeZone, modules: cfg.modules, subs: eligible });
        const c: Counts = { leaders: 0, sent: 0, failed: 0, skipped: p.skipped };
        if (p.hidden !== undefined) c.hidden = p.hidden;
        if (p.unlinked !== undefined) c.unlinked = p.unlinked;
        const reached = new Set<string>();
        for (const it of p.items) {
          if (clock() - start > ALERT_BUDGET_MS) break; // the rest stay unclaimed for the next run
          if (!(await deps.claims.claim(k.kind, it.key, it.leaderId))) continue;
          const r = await sendToSubs(it.subs, JSON.stringify(it.payload), { sender, vapid: vapid!, repo: deps.subs });
          c.sent += r.sent;
          c.failed += r.failed;
          if (r.sent) reached.add(it.leaderId);
        }
        c.leaders = reached.size;
        failedAll += c.failed;
        out[k.kind] = c;
      }
      // Counts only, never a name.
      if (failedAll) await deps.errorLog.record({ category: 'server', code: 'ALERT_PUSH_FAILED', route: 'alerts', count: failedAll });
      return out;
    },
  };
}
