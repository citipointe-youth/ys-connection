# Lifegroup names for year-end (short design, approved by Tom 21 Nov 2026)

Why: Tom archives the Grade 12 lifegroups and renames the rest for next year. Who sees a group comes from its name only, and
today a mixed or junior+senior group is admin-only or junior-only. Two import gaps also bite a rename.

Approach (Tom picked option 1 of 2): keep the name as the one source and teach it more patterns. Rejected: derive from the
members' grades (groups would move between quads as students join and leave).

Rules (one function, `groupScopeOf(name)` in core/types/enums.ts):
- "Grade N", "Grade 9-10", "Grades 9 & 10", "Grade 9 and 10" -> those grades; Girls / Boys / Guys -> one gender, else both.
- Otherwise Junior / Senior / both / neither (neither = both bands) x Girls / Guys / Boys / neither (= both genders) -> quads.
- A group's own leaders (leader: true in the pushed members, matched to the "I am" leader) always see it.
- Seeing a group = the report list and sending its report; member changes stay with its own leaders (unchanged).
- Lifegroup stats use the same name rule (lifegroupVisible). Audit per-quad roll counts: a group spanning quads is counted
  once in `none` (overall totals unchanged) — builder's call.

Import fixes (approved): (a) the group import maps a group to a link group by name only when that name is unique;
(b) reconcile matches groups by link group id, not name.

Non-goals: no contract change (LINK_REV unchanged), no console release, no stored quad list.
