/**
 * src/features/notes/notes.repository.ts
 *
 * Implements Section 4.3 & 6.6: Notes & Note Links Repository Interface.
 */

import type {
  NoteEntity,
  NoteLinkEntity,
  CreateNoteInput,
  UpdateNoteInput,
  ListNotesFilter,
  CreateNoteLinkInput
} from './notes.types.js';
import type { TagCountDto } from './notes.dto.js';

export interface NotesRepository {
  createNote(
    userId: string,
    input: CreateNoteInput,
    links?: CreateNoteLinkInput[] | undefined
  ): Promise<{ note: NoteEntity; links: NoteLinkEntity[] }>;

  findNoteById(userId: string, noteId: string): Promise<NoteEntity | null>;
  findNoteByIdWithDeleted(userId: string, noteId: string): Promise<NoteEntity | null>;
  listNotes(userId: string, filter: ListNotesFilter): Promise<NoteEntity[]>;
  updateNote(
    userId: string,
    noteId: string,
    input: UpdateNoteInput,
    expectedVersion?: number | undefined
  ): Promise<NoteEntity | null>;
  softDeleteNote(userId: string, noteId: string): Promise<boolean>;
  restoreNote(userId: string, noteId: string): Promise<NoteEntity | null>;
  countActiveNotes(userId: string): Promise<number>;

  createNoteLink(
    userId: string,
    noteId: string,
    link: CreateNoteLinkInput
  ): Promise<NoteLinkEntity>;
  listNoteLinks(userId: string, noteId: string): Promise<NoteLinkEntity[]>;
  replaceNoteLinks(
    userId: string,
    noteId: string,
    links: CreateNoteLinkInput[]
  ): Promise<NoteLinkEntity[]>;
  deleteNoteLink(userId: string, noteId: string, linkId: string): Promise<boolean>;
  findNoteLinkById(userId: string, noteId: string, linkId: string): Promise<NoteLinkEntity | null>;

  listTags(userId: string): Promise<TagCountDto[]>;
}
