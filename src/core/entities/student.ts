import type { ID, ISODateString } from '../types/common';
import type { Gender, Quad, AtRiskStatus } from '../types/enums';

export interface Student {
  id: ID;
  firstName: string;
  lastName: string;
  gender: Gender;
  grade: number | null;
  quad: Quad | null;
  mobile: string | null;
  parentPhone: string | null;
  dateOfBirth: string | null;
  // Current-term attendance statistics (populated from import)
  svcAttended: number;
  svcTotal: number;
  grpAttended: number;
  grpTotal: number;
  grpMetWeeks: number;
  // Previous-term attendance snapshot (copied from current values at new-year rollover)
  // Used to show decline trends on the at-risk screen.
  prevSvcAttended: number;
  prevSvcTotal: number;
  prevGrpAttended: number;
  prevGrpTotal: number;
  // At-risk classification (computed)
  atRiskStatus: AtRiskStatus | null;
  // Import metadata
  dataSource: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
