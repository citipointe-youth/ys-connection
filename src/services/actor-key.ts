import type { Actor } from '../core/entities/user';

// Cache key for actor-scoped responses — two actors with the same role/grade/
// quad/gender see identical scoped data, so they can share one cache entry.
export function actorKey(actor: Actor): string {
  return `${actor.role}:${actor.grade ?? '_'}:${actor.quad ?? '_'}:${actor.gender ?? '_'}`;
}
