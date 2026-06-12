export const GENDERS = ['male', 'female', 'other'] as const;
export type Gender = (typeof GENDERS)[number];

export const GRADES = [7, 8, 9, 10, 11, 12] as const;
export type Grade = (typeof GRADES)[number];

// Quad = a grouping of two grade-years: 7-9 girls, 7-9 boys, 10-12 girls, 10-12 boys
export const QUADS = ['g79', 'b79', 'g1012', 'b1012'] as const;
export type Quad = (typeof QUADS)[number];

export const QUAD_LABELS: Record<Quad, string> = {
  g79: 'Girls Yr 7–9',
  b79: 'Boys Yr 7–9',
  g1012: 'Girls Yr 10–12',
  b1012: 'Boys Yr 10–12',
};

// Compute the quad a student belongs to from grade + gender
export function computeQuad(grade: number | null, gender: string): Quad | null {
  if (!grade) return null;
  const g = gender.toLowerCase();
  const isFemale = g === 'female' || g === 'f';
  if (grade >= 7 && grade <= 9) return isFemale ? 'g79' : 'b79';
  if (grade >= 10 && grade <= 12) return isFemale ? 'g1012' : 'b1012';
  return null;
}

// Role hierarchy:
//   grade  — login scoped to one grade level (e.g. Grade 9)
//   quad   — login scoped to one quad (e.g. Girls Yr 7-9)
//   director — camp-wide read/write
//   admin  — everything + back-office
export const USER_ROLES = ['grade', 'quad', 'director', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const STUDENT_GENDERS = ['male', 'female'] as const;
export type StudentGender = (typeof STUDENT_GENDERS)[number];

export const AT_RISK_STATUSES = ['regular', 'declining', 'atrisk', 'stopped', 'watch', 'new'] as const;
export type AtRiskStatus = (typeof AT_RISK_STATUSES)[number];
