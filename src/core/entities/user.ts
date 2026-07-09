import type { ID, ISODateString } from '../types/common';
import type { UserRole, Grade, Quad } from '../types/enums';

export interface User {
  id: ID;
  displayName: string;
  email: string;
  role: UserRole;
  // For grade logins — which grade this account manages
  grade?: Grade | null;
  // For quad logins — which quad this account manages
  quad?: Quad | null;
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
  grade: Grade | null;
  quad: Quad | null;
  // Gender scope, derived at sign-in: quad logins from their quad; grade logins
  // from their email convention (grade7g -> female, grade7b -> male). null/absent
  // = no gender restriction (director/admin, or an ungendered grade login).
  gender?: 'male' | 'female' | null;
  // See User.mustChangePassword. Embedded in the signed session token so the
  // route gate can check it without a DB round-trip.
  mustChangePassword?: boolean;
}
