// Birthday alert kind (spec 6.1, B1-B11): at 08:00-11:59 site time, each leader with an alert-enabled device gets one
// push naming the connected students whose birthday is today. First names and ages only (A2); the run claims
// ('bday', day, leader) before sending, so a repeat trigger sends nothing.
import type { IConnectionRepository, IStudentRepository } from '../repositories/interfaces/entity-repositories';
import { alertModuleOn } from '../core/module-tree';
import type { AlertItem, AlertKind } from './alert-run.service';
import type { Dnc } from './dnc';
import { brisbaneToday, instantOf } from './link-rules';
import { isRealDob } from './terms';

const MAX_IDS = 10;
const MAX_BODY = 120;

const isLeap = (y: number) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);

/** Age turned on `day` (YYYY-MM-DD), or null when `dob` is not a real date or today is not the birthday. A Feb 29 birthday is kept on 28 Feb in non-leap years. */
export function birthdayToday(dob: string | null, day: string): number | null {
  if (!dob || !isRealDob(dob, new Date(`${day}T00:00:00Z`))) return null;
  const md = dob.slice(5, 10);
  const dayMd = day.slice(5, 10);
  const y = Number(day.slice(0, 4));
  const hit = md === dayMd || (md === '02-29' && dayMd === '02-28' && !isLeap(y));
  const age = y - Number(dob.slice(0, 4));
  return hit && age > 0 ? age : null;
}

/** B8 wording. `students` is already sorted by first name; the 3+ form is cut at ~120 chars as `… and N more today`. */
export function birthdayBody(students: { firstName: string; age: number }[]): string {
  const [a, b] = students;
  if (!a) return '';
  if (!b) return `🎂 ${a.firstName} turns ${a.age} today`;
  const two = `🎂 ${a.firstName} turns ${a.age} and ${b.firstName} turns ${b.age} today`;
  if (students.length === 2 && two.length <= MAX_BODY) return two;
  const parts = students.map((s) => `${s.firstName} (${s.age})`);
  const full = `🎂 ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]} have birthdays today`;
  if (full.length <= MAX_BODY) return full;
  for (let k = parts.length - 1; k > 0; k--) {
    const body = `🎂 ${parts.slice(0, k).join(', ')} … and ${parts.length - k} more today`;
    if (body.length <= MAX_BODY) return body;
  }
  return `🎂 ${parts.length} birthdays today`;
}

export function makeBirthdayKind(deps: {
  connections: Pick<IConnectionRepository, 'findAll'>;
  students: Pick<IStudentRepository, 'findAll'>;
  dnc: Pick<Dnc, 'ids'>;
}): AlertKind {
  return {
    kind: 'bday',
    async plan(ctx) {
      if (!alertModuleOn(ctx.modules, 'birthdayAlerts')) return { skipped: 'module-off', items: [] };
      const day = brisbaneToday(ctx.now, ctx.tz);
      const t = ctx.now.getTime();
      if (t < instantOf(day, '08:00', ctx.tz) || t >= instantOf(day, '12:00', ctx.tz)) return { skipped: 'window', items: [] };
      const subs = ctx.subs.filter((s) => s.bdayOn);
      if (!subs.length) return { skipped: null, items: [] };

      const [students, connections, dnc] = await Promise.all([deps.students.findAll(), deps.connections.findAll(), deps.dnc.ids()]);
      const turning = new Map<string, { id: string; firstName: string; age: number }>();
      for (const s of students) {
        const age = dnc.has(s.id) ? null : birthdayToday(s.dateOfBirth, day);
        if (age && s.firstName.trim()) turning.set(s.id, { id: s.id, firstName: s.firstName.trim(), age });
      }
      const items: AlertItem[] = [];
      for (const leaderId of new Set(subs.map((s) => s.leaderId!))) {
        const mine = connections.filter((c) => c.leaderId === leaderId && turning.has(c.studentId)).map((c) => turning.get(c.studentId)!);
        const uniq = [...new Map(mine.map((m) => [m.id, m])).values()]
          .sort((x, y) => x.firstName.localeCompare(y.firstName) || x.id.localeCompare(y.id));
        if (!uniq.length) continue;
        items.push({
          key: day, leaderId, subs: subs.filter((s) => s.leaderId === leaderId),
          payload: { title: 'Birthday', body: birthdayBody(uniq), tag: 'bday', screen: 'student', ids: uniq.slice(0, MAX_IDS).map((m) => m.id) },
        });
      }
      return { skipped: null, items };
    },
  };
}
