/**
 * src/features/notes/notes.types.ts
 *
 * Implements Section 1.4.11, 6.6 & 14.10: Notes & Note Links domain types.
 */

export type NoteLinkedEntityType = 'task' | 'project' | 'goal' | 'habit' | 'event';

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

export interface CreateNoteLinkInput {
  taskId?: string | null | undefined;
  projectId?: string | null | undefined;
  goalId?: string | null | undefined;
  habitId?: string | null | undefined;
  eventId?: string | null | undefined;
}

export interface CreateNoteInput {
  title?: string | null | undefined;
  body?: string | undefined;
  tags?: string[] | undefined;
  isPinned?: boolean | undefined;
  links?: CreateNoteLinkInput[] | undefined;
}

export interface UpdateNoteInput {
  title?: string | null | undefined;
  body?: string | undefined;
  tags?: string[] | undefined;
  isPinned?: boolean | undefined;
  links?: CreateNoteLinkInput[] | undefined;
  version?: number | undefined;
}

export interface ListNotesFilter {
  q?: string | undefined;
  tag?: string | undefined;
  isPinned?: boolean | undefined;
  taskId?: string | undefined;
  projectId?: string | undefined;
  goalId?: string | undefined;
  habitId?: string | undefined;
  eventId?: string | undefined;
  includeDeleted?: boolean | undefined;
}
