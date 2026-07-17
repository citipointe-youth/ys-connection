import type { ID, ISODateString } from '../types/common';
import type { UserRole } from '../types/enums';

export type PrayerStatus = 'open' | 'answered' | 'archived';

export interface PrayerRequest {
  id: ID;
  studentId: ID;
  text: string;
  status: PrayerStatus;
  answerNote: string | null;
  createdByLabel: string;
  createdByRole: UserRole;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  answeredAt: ISODateString | null;
}

export interface PrayerWithStudent extends PrayerRequest {
  student: { id: ID; firstName: string; lastName: string; grade: number | null; gender: string };
}
