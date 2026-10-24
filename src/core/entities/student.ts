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
  // Previous-term attendance snapshot — populated at import time by the term split
  // (see aggregates.ts). Used to show this-term vs last-term trends.
  prevSvcAttended: number;
  prevSvcTotal: number;
  prevGrpAttended: number;
  prevGrpTotal: number;
  // At-risk classification (computed)
  atRiskStatus: AtRiskStatus | null;
  // Import metadata
  dataSource: string | null;
  // r25 (0048): set when Elvanto's yearly update blanked a Year 12's grade. A graduated student is kept (history) but
  // left out of findAll(); only setGraduated writes it (save/saveMany never do).
  graduatedAt?: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
