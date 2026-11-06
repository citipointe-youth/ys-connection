// Lifegroup report reminder kind (spec 7.1, L1-L7): 2 h after a group meets (site time), each Elvanto leader of that
// group whose "I am" device has reminders on gets one push, unless a report for that Mon-Sun week is already in.
// Group name and time only (A2). The run claims ('lgrem', '<groupId>:<D>', leader) before sending.
import type { Actor } from '../core/entities/user';
import type { LinkGroupRow, OutboxRow, Status } from '../core/link-types';
import type { ILinkRepository } from '../repositories/interfaces/link.repository';
import type { ILeaderRepository } from '../repositories/interfaces/entity-repositories';
import { alertModuleOn, resolveModules } from '../core/module-tree';
import type { AlertItem, AlertKind } from './alert-run.service';
import { can, modeAllows } from './access-control';
import { groupVisible } from './link.service';
import { addDays, brisbaneToday, instantOf, meetsTime, meetsWeekday, rosterPersonMatcher, weekdayOf } from './link-rules';

const MIN = 60_000;
const STALE_MS = 6 * 60 * MIN;
const NAME_MAX = 40;
const DONE: Status[] = ['pending', 'claimed', 'sent', 'unclear'];

const pad = (n: number) => String(n).padStart(2, '0');
const mondayOf = (ymd: string) => addDays(ymd, -((weekdayOf(ymd) + 6) % 7));
const clock12 = (m: number) => `${Math.floor(m / 60) % 12 || 12}:${pad(m % 60)} ${m < 720 ? 'AM' : 'PM'}`;

/** Meeting dates D (today or yesterday, site-local) whose reminder is due now: due = D at the meets time + 2 h, sent until due + 60 min. */
export function dueOccurrences(meets: string, now: Date, tz: string): string[] {
  const wd = meetsWeekday(meets), t = meetsTime(meets);
  if (wd < 0 || t == null) return [];
  const today = brisbaneToday(now, tz), at = now.getTime(), hhmm = `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
  return [today, addDays(today, -1)].filter((d) => {
    if (weekdayOf(d) !== wd) return false;
    const due = instantOf(d, hhmm, tz) + 120 * MIN;
    return due <= at && at < due + 60 * MIN;
  });
}

/** L3/L5: a report for g is in for D's Mon-Sun week (open/sent outbox row, mirror report, or this week's mirror state). */
export function reportDone(g: LinkGroupRow, outbox: OutboxRow[], d: string, today: string): boolean | 'unreadable' {
  if (g.thisWeek === 'unreadable') return 'unreadable';
  const wk = mondayOf(d);
  const inWeek = (x: unknown) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && mondayOf(x) === wk;
  const p = (r: OutboxRow) => r.payload as { groupId?: unknown; date?: unknown };
  return outbox.some((r) => (r.type === 'submitReport' || r.type === 'editReport') && DONE.includes(r.status) && p(r).groupId === g.groupId && inWeek(p(r).date))
    || [g.lastReport, ...g.history].some((h) => h && inWeek(h.date))
    || (mondayOf(today) === wk && (g.thisWeek === 'reported' || g.thisWeek === 'did-not-meet'));
}

export function makeLifegroupKind(deps: {
  link: Pick<ILinkRepository, 'groups' | 'roster' | 'mirrorState' | 'listActions'>;
  leaders: Pick<ILeaderRepository, 'findAll'>;
}): AlertKind {
  return {
    kind: 'lgrem',
    async plan(ctx) {
      if (!alertModuleOn(ctx.modules, 'lifegroupReminders')) return { skipped: 'module-off', items: [] };
      const subs = ctx.subs.filter((s) => s.lgremOn);
      if (!subs.length) return { skipped: null, items: [] };
      const gAt = (await deps.link.mirrorState()).find((m) => m.kind === 'groups')?.takenAt;
      if (!gAt || ctx.now.getTime() - Date.parse(gAt) > STALE_MS) return { skipped: 'stale', items: [] };

      const today = brisbaneToday(ctx.now, ctx.tz);
      const due = (await deps.link.groups()).flatMap((g) => dueOccurrences(g.meets || '', ctx.now, ctx.tz).map((d) => ({ g, d })));
      if (!due.length) return { skipped: null, items: [], hidden: 0, unlinked: 0 };
      const [outbox, roster, leaders] = await Promise.all([
        deps.link.listActions({ types: ['submitReport', 'editReport'], statuses: DONE, serviceDateFrom: addDays(today, -8) }),
        deps.link.roster(), deps.leaders.findAll()]);
      const personOf = rosterPersonMatcher(roster, leaders);
      const leaderOf = new Map<string, string>();
      for (const l of leaders) { const pid = l.active ? personOf(l) : null; if (pid) leaderOf.set(pid, l.id); }
      const mode = resolveModules(ctx.modules).lifegroupReport;
      const canOpen = (a: Actor) => can(a, 'link:use') && modeAllows(a, mode);

      let hidden = 0, unlinked = 0;
      const items: AlertItem[] = [];
      for (const { g, d } of due) {
        if (reportDone(g, outbox, d, today) !== false) continue;
        const name = g.name.length > NAME_MAX ? `${g.name.slice(0, NAME_MAX - 1).trimEnd()}…` : g.name;
        const payload = { title: 'Lifegroup report', body: `${name} met at ${clock12(meetsTime(g.meets)!)}. Tap to fill in the report.`,
          tag: `lgrem:${g.groupId}`, screen: 'lgreport', g: g.groupId, d };
        for (const pid of new Set(g.members.filter((m) => m.leader).map((m) => m.personId))) {
          const leaderId = leaderOf.get(pid);
          if (!leaderId) { unlinked++; continue; }
          const mine = subs.filter((s) => s.leaderId === leaderId);
          const ok = mine.filter((s) => { const a = s.user as unknown as Actor; return canOpen(a) && groupVisible(a, g, ctx.structure); });
          hidden += mine.length - ok.length;
          if (ok.length) items.push({ key: `${g.groupId}:${d}`, leaderId, subs: ok, payload });
        }
      }
      return { skipped: null, items, hidden, unlinked };
    },
  };
}
