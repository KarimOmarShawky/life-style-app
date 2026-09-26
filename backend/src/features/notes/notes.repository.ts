/**
 * src/features/notes/notes.repository.ts
 *
 * Implements Section 4.3 & 6.6: Notes Repository Interface.
 */

import type { NoteEntity, NoteLinkEntity } from './notes.types.js';

export interface NotesRepository {
  findNoteById(userId: string, noteId: string): Promise<NoteEntity | null>;
  listNoteLinks(userId: string, noteId: string): Promise<NoteLinkEntity[]>;
}
