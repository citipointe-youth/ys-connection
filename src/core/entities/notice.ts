import type { ID, ISODateString } from '../types/common';

// The four quad logins a notice can be addressed to (users.quad values).
export const NOTICE_QUADS = ['b79', 'g79', 'b1012', 'g1012'] as const;
export type NoticeQuad = (typeof NOTICE_QUADS)[number];

export interface Notice {
  id: ID;
  title: string;
  body: string;
  recipients: NoticeQuad[];
  senderId: ID;
  senderName: string;
  createdAt: ISODateString;
}
