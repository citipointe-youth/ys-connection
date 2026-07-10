import type { Actor } from '../core/entities/user';

// Cache key for actor-scoped responses — two actors with the same role/grade(s)/
// quad/gender see identical scoped data, so they can share one cache entry.
// Multi-grade grade accounts (§5.1a) key on the full grade set: two accounts
// scoped to different grade spans (e.g. [7,8,9] vs [10,11,12]) both have a null
// single `grade`, so keying on `grade` alone would collide their scoped caches.
export function actorKey(actor: Actor): string {
  const gradeKey = actor.grades && actor.grades.length > 0
    ? actor.grades.join('-')
    : (actor.grade ?? '_');
  return `${actor.role}:${gradeKey}:${actor.quad ?? '_'}:${actor.gender ?? '_'}`;
}
