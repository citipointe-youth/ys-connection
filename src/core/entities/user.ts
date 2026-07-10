import type { ID, ISODateString } from '../types/common';
import type { UserRole, Grade, Quad } from '../types/enums';

export interface User {
  id: ID;
  displayName: string;
  email: string;
  role: UserRole;
  // For grade logins — which grade this account manages. Legacy single-grade
  // field kept for back-compat with existing seeded accounts and old tokens.
  grade?: Grade | null;
  // For grade logins — the full set of grades this account manages (§5.1a,
  // generalisation). One or more grades. When present it is authoritative;
  // `grade` remains as the single-grade back-compat representation. Absent on
  // legacy single-grade accounts (which still work via `grade`).
  grades?: Grade[] | null;
  // For grade logins spanning >1 grade: gender scope set explicitly at account
  // creation (the grade7g/grade7b email regex only encodes one grade number and
  // doesn't generalise to a list). null = both genders. Single-grade accounts
  // may still leave this unset and rely on the email convention (back-compat).
  gender?: 'male' | 'female' | null;
  // For quad logins — which quad this account manages
  quad?: Quad | null;
  // For `leader` (junior leader) logins — the Leader record this account is bound
  // to (§5.2). The account sees exactly that leader's connected students.
  leaderId?: string | null;
  status: 'active' | 'inactive';
  passwordHash?: string;
  // True for accounts whose password was set by someone/something other than the
  // account holder (seed data, admin-created) and hasn't been changed since. The
  // holder is blocked from everything except changing their password until this
  // clears. Only ever set true by seed/migration data today.
  mustChangePassword?: boolean;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type SafeUser = Omit<User, 'passwordHash'>;

export interface Actor {
  id: ID;
  role: UserRole;
  displayName: string;
  // Legacy single grade (back-compat with old tokens); prefer `grades`.
  grade: Grade | null;
  // Full grade set for a grade login (§5.1a). When present it is authoritative;
  // access-control derives the effective list via actorGrades() which falls back
  // to [grade] when this is absent, so old tokens keep working.
  grades?: Grade[] | null;
  quad: Quad | null;
  // For `leader` logins — the bound Leader record id (§5.2); the actor sees only
  // students connected to it. null/absent for every other role.
  leaderId?: string | null;
  // Gender scope, derived at sign-in: quad logins from their quad; grade logins
  // from their email convention (grade7g -> female, grade7b -> male). null/absent
  // = no gender restriction (director/admin, or an ungendered grade login).
  gender?: 'male' | 'female' | null;
  // See User.mustChangePassword. Embedded in the signed session token so the
  // route gate can check it without a DB round-trip.
  mustChangePassword?: boolean;
}
