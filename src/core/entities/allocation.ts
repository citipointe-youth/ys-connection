import type { ID, ISODateString } from '../types/common';

export interface Allocation {
  id: ID;
  studentId: string;
  leaderId: string;
  assignedByRole: string;
  createdAt: ISODateString;
}
