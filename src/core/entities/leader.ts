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
  // Custom SMS template for the "Message Custom" call-sheet option; "<first name>"
  // is substituted with the recipient's first name at send time.
  smsTemplate: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
