// ID Checks (spec 2026-10-30 §7.1): one entry = a catch-up check or a random note for one leader.
// leaderId null = the leader was deleted (archived, decision I): nobody reads it until an admin re-attaches it.
export type IdCheckAnswer = { asked: boolean; note: string };
export type IdCheckCheckContent = { answers: Record<string, IdCheckAnswer>; nextTime: string };
export type IdCheckNoteContent = { text: string };

export interface IdCheckEntry {
  id: string;
  leaderId: string | null;
  leaderName: string;
  kind: 'check' | 'note';
  heldOn: string;
  finished: boolean;
  authorId: string;
  authorName: string;
  content: IdCheckCheckContent | IdCheckNoteContent;
  createdAt: string;
  updatedAt: string;
}

/** One grid tick: `userId` may read and write `leaderId`'s entries. */
export interface IdCheckTick { leaderId: string; userId: string }
