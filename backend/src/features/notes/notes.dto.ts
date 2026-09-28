/**
 * src/features/notes/notes.dto.ts
 *
 * Implements Section 14.10, 14.17.1 & AC-NOTE-01: Notes & Note Links DTO Serialization.
 */

import type { NoteEntity, NoteLinkEntity, NoteLinkedEntityType } from './notes.types.js';

export interface NoteLinkDto {
  id: string;
  noteId: string;
  entityType: NoteLinkedEntityType;
  entityId: string;
  taskId: string | null;
  projectId: string | null;
  goalId: string | null;
  habitId: string | null;
  eventId: string | null;
  createdAt: string;
}

export interface NoteDto {
  id: string;
  userId: string;
  title: string | null;
  body: string;
  excerpt: string;
  tags: string[];
  isPinned: boolean;
  links?: NoteLinkDto[] | undefined;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface NoteListItemDto {
  id: string;
  userId: string;
  title: string | null;
  excerpt: string;
  tags: string[];
  isPinned: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface TagCountDto {
  tag: string;
  count: number;
}

export function toNoteLinkDto(link: NoteLinkEntity): NoteLinkDto {
  let entityType: NoteLinkedEntityType = 'task';
  let entityId = '';

  if (link.taskId) {
    entityType = 'task';
    entityId = link.taskId;
  } else if (link.projectId) {
    entityType = 'project';
    entityId = link.projectId;
  } else if (link.goalId) {
    entityType = 'goal';
    entityId = link.goalId;
  } else if (link.habitId) {
    entityType = 'habit';
    entityId = link.habitId;
  } else if (link.eventId) {
    entityType = 'event';
    entityId = link.eventId;
  }

  return {
    id: link.id,
    noteId: link.noteId,
    entityType,
    entityId,
    taskId: link.taskId,
    projectId: link.projectId,
    goalId: link.goalId,
    habitId: link.habitId,
    eventId: link.eventId,
    createdAt:
      link.createdAt instanceof Date ? link.createdAt.toISOString() : String(link.createdAt)
  };
}

export function toNoteDto(note: NoteEntity, links?: NoteLinkEntity[]): NoteDto {
  return {
    id: note.id,
    userId: note.userId,
    title: note.title,
    body: note.body,
    excerpt: note.body ? note.body.slice(0, 200) : '',
    tags: note.tags,
    isPinned: note.isPinned,
    ...(links !== undefined ? { links: links.map(toNoteLinkDto) } : {}),
    version: note.version,
    createdAt:
      note.createdAt instanceof Date ? note.createdAt.toISOString() : String(note.createdAt),
    updatedAt:
      note.updatedAt instanceof Date ? note.updatedAt.toISOString() : String(note.updatedAt),
    deletedAt:
      note.deletedAt instanceof Date
        ? note.deletedAt.toISOString()
        : note.deletedAt
          ? String(note.deletedAt)
          : null
  };
}

export function toNoteListItemDto(note: NoteEntity): NoteListItemDto {
  return {
    id: note.id,
    userId: note.userId,
    title: note.title,
    excerpt: note.body ? note.body.slice(0, 200) : '',
    tags: note.tags,
    isPinned: note.isPinned,
    version: note.version,
    createdAt:
      note.createdAt instanceof Date ? note.createdAt.toISOString() : String(note.createdAt),
    updatedAt:
      note.updatedAt instanceof Date ? note.updatedAt.toISOString() : String(note.updatedAt),
    deletedAt:
      note.deletedAt instanceof Date
        ? note.deletedAt.toISOString()
        : note.deletedAt
          ? String(note.deletedAt)
          : null
  };
}
