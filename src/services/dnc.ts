// R1 (LINK_REV 6): DO NOT CONTACT. A student is DNC when an ACTIVE link_roster row matched to it
// (studentId) carries consent 'contact' or 'all'. Every student-shaped response gets `dnc`, and a
// non-admin/director login gets mobile / parentPhone stripped to null for a DNC student.
import { isDnc } from '../core/link-contract';
import { canSeeDncPhones } from './access-control';
import type { ILinkRepository } from '../repositories/interfaces/link.repository';
import type { Actor } from '../core/entities/user';

// Any student-shaped object; only a mobile / parentPhone key that is present is nulled.
export type DncMark = <T extends object>(o: T, studentId: string | null | undefined) => T & { dnc: boolean };
export interface Dnc { forActor(actor: Actor): Promise<DncMark> }

const TTL_MS = 60_000;

/** No `link` (test constructors) = nobody is DNC. */
export function makeDnc(link?: Pick<ILinkRepository, 'roster'>): Dnc {
  // ponytail: per-instance 60 s cache + in-flight dedupe, so a consent change reaches the strip
  // within a minute. Clear it from the roster push if that lag ever matters.
  let cache: { at: number; ids: Promise<Set<string>> } | null = null;
  function ids(): Promise<Set<string>> {
    if (!link) return Promise.resolve(new Set());
    const now = Date.now();
    if (!cache || now - cache.at > TTL_MS) {
      const p = link.roster().then((rows) => new Set(rows
        .filter((r) => r.active && r.studentId && isDnc(r.consent)).map((r) => r.studentId as string)));
      const entry = { at: now, ids: p };
      cache = entry;
      p.catch(() => { if (cache === entry) cache = null; }); // a failed read is not cached
    }
    return cache.ids;
  }
  return {
    async forActor(actor) {
      const set = await ids();
      const keep = canSeeDncPhones(actor);
      return <T extends object>(o: T, studentId: string | null | undefined) => {
        const dnc = !!studentId && set.has(studentId);
        if (!dnc || keep) return { ...o, dnc };
        return { ...o, dnc, ...('mobile' in o && { mobile: null }), ...('parentPhone' in o && { parentPhone: null }) } as T & { dnc: boolean };
      };
    },
  };
}
