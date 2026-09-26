/**
 * src/features/notes/notes.types.ts
 *
 * Implements Section 6.6 & 14.10: Notes & Note Links domain types.
 */

export interface NoteEntity {
  id: string;
  userId: string;
  title: string | null;
  body: string;
  tags: string[];
  isPinned: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
}

export interface NoteLinkEntity {
  id: string;
  userId: string;
  noteId: string;
  taskId: string | null;
  projectId: string | null;
  goalId: string | null;
  habitId: string | null;
  eventId: string | null;
  createdAt: Date;
}
