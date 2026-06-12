import type { ID, ISODateString } from '../types/common';
import type { Gender, Grade } from '../types/enums';

export interface Leader {
  id: ID;
  fullName: string;
  gender: Gender | null;
  // Grades this leader focuses on (empty = no restriction)
  grades: Grade[];
  active: boolean;
  // Which grade-login created this leader
  createdByGrade: number | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
