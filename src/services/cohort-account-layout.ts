// Pure helpers for the admin "Apply account layout" action (bug 8, admin bug
// list 2026-07-11): switching Youth Setup's Cohort model between Complex
// (grades-quads) and Simple (none) doesn't touch Accounts on its own — this
// is the explicit, separate, confirm-gated action that does, via
// account.service.ts's planCohortLayout/applyCohortLayout. No repository/I-O
// imports here, same pattern as connection-allocations.ts, so the plan is
// unit-testable without a database.

export type CohortModel = 'grades-quads' | 'none';

export type TargetAccountSpec =
  | { role: 'grade'; username: string; displayName: string; grades: number[]; gender: 'male' | 'female' }
  | { role: 'quad'; username: string; displayName: string; quad: 'g79' | 'b79' | 'g1012' | 'b1012' };

export interface ExistingAccountLite {
  id: string;
  role: string;
  email: string;
  displayName: string;
  status: string;
}

export interface CohortLayoutPlan {
  targetCohort: CohortModel;
  toCreate: TargetAccountSpec[];
  toDeactivate: { id: string; username: string; displayName: string }[];
}

// "Grade N" | "Grades N–M" — mirrors the SPA's gradeBadgeLabel()/gradesLabel()
// for a contiguous bracket (all brackets built by gradeBrackets() below are
// contiguous, so the non-contiguous ", "-joined case never applies here).
function gradeWordLabel(grades: number[], gradeWord: string): string {
  const g = [...grades].sort((a, b) => a - b);
  const nums = g.length > 1 ? `${g[0]}–${g[g.length - 1]}` : String(g[0]);
  return `${gradeWord}${g.length > 1 ? 's' : ''} ${nums}`;
}

// Split an inclusive [gradeMin, gradeMax] range into 2-grade brackets — the
// default 7-12 range yields [[7,8],[9,10],[11,12]] (bug 8's "boys and girls
// 7/8, 9/10, 11/12"). An odd-sized range's last bracket gets the extra grade.
export function gradeBrackets(gradeMin: number, gradeMax: number): number[][] {
  const all: number[] = [];
  for (let g = gradeMin; g <= gradeMax; g++) all.push(g);
  const out: number[][] = [];
  for (let i = 0; i < all.length; i += 2) out.push(all.slice(i, i + 2));
  return out;
}

const QUAD_TARGETS: { quad: 'g79' | 'b79' | 'g1012' | 'b1012'; label: string }[] = [
  { quad: 'g79', label: 'Girls Yr 7-9' },
  { quad: 'b79', label: 'Boys Yr 7-9' },
  { quad: 'g1012', label: 'Girls Yr 10-12' },
  { quad: 'b1012', label: 'Boys Yr 10-12' },
];

// The full target account set for a cohort model — 'none' (Simple) is the 6
// grade-bracket accounts; 'grades-quads' (Complex) is one account per grade
// per gender plus the 4 quads (mirrors the app's own seed layout).
export function buildTargetAccounts(
  targetCohort: CohortModel,
  gradeMin: number,
  gradeMax: number,
  gradeWord: string,
): TargetAccountSpec[] {
  const out: TargetAccountSpec[] = [];
  const genders: { gender: 'male' | 'female'; label: string; suffix: 'g' | 'b' }[] = [
    { gender: 'female', label: 'Girls', suffix: 'g' },
    { gender: 'male', label: 'Boys', suffix: 'b' },
  ];
  if (targetCohort === 'none') {
    for (const bracket of gradeBrackets(gradeMin, gradeMax)) {
      for (const g of genders) {
        out.push({
          role: 'grade',
          username: `grade${bracket.join('')}${g.suffix}`,
          displayName: `${gradeWordLabel(bracket, gradeWord)} ${g.label}`,
          grades: bracket,
          gender: g.gender,
        });
      }
    }
  } else {
    for (let grade = gradeMin; grade <= gradeMax; grade++) {
      for (const g of genders) {
        out.push({
          role: 'grade',
          username: `grade${grade}${g.suffix}`,
          displayName: `${gradeWordLabel([grade], gradeWord)} ${g.label}`,
          grades: [grade],
          gender: g.gender,
        });
      }
    }
    for (const q of QUAD_TARGETS) {
      out.push({ role: 'quad', username: q.quad, displayName: q.label, quad: q.quad });
    }
  }
  return out;
}

// Diff the target account set against what already exists. Accounts are
// matched by username (case-insensitive) only — an existing account with a
// matching username is left completely alone (never edited/reactivated),
// whatever its current role/grades/gender/status; a grade/quad account whose
// username ISN'T part of the target set is flagged for deactivation, never
// deletion, matching the rest of this app's "never delete accounts
// automatically" convention (see the orphaned-accounts note in
// _youthSetupBody, public/index.html).
export function planCohortAccountLayout(
  targetCohort: CohortModel,
  gradeMin: number,
  gradeMax: number,
  gradeWord: string,
  existing: ExistingAccountLite[],
): CohortLayoutPlan {
  const targets = buildTargetAccounts(targetCohort, gradeMin, gradeMax, gradeWord);
  const existingUsernames = new Set(existing.map((u) => u.email.toLowerCase()));
  const targetUsernames = new Set(targets.map((t) => t.username.toLowerCase()));

  const toCreate = targets.filter((t) => !existingUsernames.has(t.username.toLowerCase()));
  const toDeactivate = existing
    .filter((u) => (u.role === 'grade' || u.role === 'quad') && u.status === 'active' && !targetUsernames.has(u.email.toLowerCase()))
    .map((u) => ({ id: u.id, username: u.email, displayName: u.displayName }));

  return { targetCohort, toCreate, toDeactivate };
}
