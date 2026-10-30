export const GENDERS = ['male', 'female', 'other'] as const;
export type Gender = (typeof GENDERS)[number];

export const GRADES = [7, 8, 9, 10, 11, 12] as const;
export type Grade = (typeof GRADES)[number];

// Quad (internal id) = Junior/Senior x Girls/Guys; its grades come from gradeBands()
export const QUADS = ['g79', 'b79', 'g1012', 'b1012'] as const;
export type Quad = (typeof QUADS)[number];

// The one name per quad on every screen: Junior/Senior Girls/Guys.
const QUAD_NAMES: Record<Quad, string> = {
  g79: 'Junior Girls',
  b79: 'Junior Guys',
  g1012: 'Senior Girls',
  b1012: 'Senior Guys',
};

// Login usernames for the quad accounts (migration 0022). Scope comes from the quad field, never the username.
export const QUAD_USERNAMES: Record<Quad, string> = {
  g79: 'juniorgirls',
  b79: 'juniorguys',
  g1012: 'seniorgirls',
  b1012: 'seniorguys',
};

export function quadLabelFor(quad: Quad): string {
  return QUAD_NAMES[quad];
}

// Highest Junior grade; above it is Senior. The one junior/senior split for the server
// (the SPA mirrors it in public/index.html `gradeBands`).
const JUNIOR_TOP = 9;
const range = (lo: number, hi: number) => Array.from({ length: Math.max(0, hi - lo + 1) }, (_, i) => lo + i);

/** Junior and Senior grades from the structure config. Include Grade 6 = gradeMin 6. No structure = grade 6 in. */
export function gradeBands(structure?: { gradeMin?: number; gradeMax?: number }): { junior: number[]; senior: number[] } {
  return {
    junior: range(Math.max(6, structure?.gradeMin ?? 6), JUNIOR_TOP),
    senior: range(JUNIOR_TOP + 1, Math.min(12, structure?.gradeMax ?? 12)),
  };
}

// Compute the quad a student belongs to from grade + gender (grade 6 is always junior here).
export function computeQuad(grade: number | null, gender: string): Quad | null {
  if (!grade) return null;
  const g = gender.toLowerCase();
  const isFemale = g === 'female' || g === 'f';
  const { junior, senior } = gradeBands();
  if (junior.includes(grade)) return isFemale ? 'g79' : 'b79';
  if (senior.includes(grade)) return isFemale ? 'g1012' : 'b1012';
  return null;
}

// A lifegroup named for a leader quad with no "Grade N" ("... Junior Girls Wednesday Lifegroup",
// "... Senior Guys Thursday Mt Gravatt Lifegroup"): its quad, else null. A "Grade N" name never has one.
export function groupQuadOf(name: string): Quad | null {
  if (/\bGrade\s+\d+\b/i.test(name)) return null;
  const female = /\bgirls?\b/i.test(name);
  if (!female && !/\b(?:boys?|guys?)\b/i.test(name)) return null;
  if (/\bjunior\b/i.test(name)) return female ? 'g79' : 'b79';
  if (/\bsenior\b/i.test(name)) return female ? 'g1012' : 'b1012';
  return null;
}

// Role hierarchy:
//   leader — sees ONLY their own connected students (own-connections-only
//            scope). Optional role, off by default (§5.2, roles.enabled.leader).
//   grade  — login scoped to one grade level (e.g. Grade 9), or several (§5.1a)
//   quad   — Junior/Senior login scoped to one group (e.g. Junior Girls). Optional (roles.enabled.quad)
//   oversight — ministry-wide read/write. Optional (roles.enabled.oversight)
//   admin  — everything + back-office. Always available.
export const USER_ROLES = ['leader', 'grade', 'quad', 'oversight', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const STUDENT_GENDERS = ['male', 'female'] as const;
export type StudentGender = (typeof STUDENT_GENDERS)[number];

// computeStatus (atrisk.service.ts) yields regular / declining / stopped; 'new' marks a fresh student (PY-P13).
export const AT_RISK_STATUSES = ['regular', 'declining', 'stopped', 'new'] as const;
export type AtRiskStatus = (typeof AT_RISK_STATUSES)[number];
