/**
 * src/features/notes/notes.service.ts
 *
 * Implements Section 1.4.11, 6.6 & 14.10: Notes & Note Links Business Service.
 */

import { AppError } from '../../core/errors/app-error.js';
import type { NotesRepository } from './notes.repository.js';
import type {
  CreateNoteInput,
  UpdateNoteInput,
  ListNotesFilter,
  CreateNoteLinkInput
} from './notes.types.js';
import {
  toNoteDto,
  toNoteListItemDto,
  toNoteLinkDto,
  type NoteDto,
  type NoteListItemDto,
  type NoteLinkDto,
  type TagCountDto
} from './notes.dto.js';

export const MAX_NOTES_PER_USER = 5000;

export class NotesService {
  constructor(private readonly notesRepository: NotesRepository) {}

  async createNote(userId: string, input: CreateNoteInput): Promise<NoteDto> {
    const activeCount = await this.notesRepository.countActiveNotes(userId);
    if (activeCount >= MAX_NOTES_PER_USER) {
      throw AppError.conflict(
        'QUOTA_EXCEEDED',
        `Notes quota exceeded (max ${MAX_NOTES_PER_USER} active notes)`
      );
    }

    try {
      const { note, links } = await this.notesRepository.createNote(userId, input, input.links);
      return toNoteDto(note, links);
    } catch (err: unknown) {
      const dbErr = err as { code?: string; constraint?: string };
      if (dbErr.code === '23503') {
        throw AppError.notFound('Referenced entity does not exist');
      }
      if (dbErr.code === '23505') {
        throw AppError.conflict('CONFLICT', 'Entity is already linked to this note');
      }
      throw err;
    }
  }

  async getNote(userId: string, noteId: string): Promise<NoteDto> {
    const note = await this.notesRepository.findNoteById(userId, noteId);
    if (!note) {
      throw AppError.notFound('Note not found');
    }

    const links = await this.notesRepository.listNoteLinks(userId, noteId);
    return toNoteDto(note, links);
  }

  async listNotes(userId: string, filter: ListNotesFilter): Promise<NoteListItemDto[]> {
    const notes = await this.notesRepository.listNotes(userId, filter);
    return notes.map(toNoteListItemDto);
  }

  async updateNote(userId: string, noteId: string, input: UpdateNoteInput): Promise<NoteDto> {
    const existing = await this.notesRepository.findNoteById(userId, noteId);
    if (!existing) {
      throw AppError.notFound('Note not found');
    }

    try {
      if (input.links !== undefined) {
        await this.notesRepository.replaceNoteLinks(userId, noteId, input.links);
      }

      const hasFieldUpdates =
        input.title !== undefined ||
        input.body !== undefined ||
        input.tags !== undefined ||
        input.isPinned !== undefined ||
        input.version !== undefined;

      let updatedNote = existing;
      if (hasFieldUpdates) {
        const updated = await this.notesRepository.updateNote(userId, noteId, input, input.version);

        if (!updated) {
          const checkExists = await this.notesRepository.findNoteById(userId, noteId);
          if (checkExists) {
            throw AppError.conflict('VERSION_CONFLICT', 'Conflict: Note was modified concurrently');
          }
          throw AppError.notFound('Note not found');
        }
        updatedNote = updated;
      }

      const links = await this.notesRepository.listNoteLinks(userId, noteId);
      return toNoteDto(updatedNote, links);
    } catch (err: unknown) {
      if (err instanceof AppError) {
        throw err;
      }
      const dbErr = err as { code?: string; constraint?: string };
      if (dbErr.code === '23503') {
        throw AppError.notFound('Referenced entity does not exist');
      }
      if (dbErr.code === '23505') {
        throw AppError.conflict('CONFLICT', 'Entity is already linked to this note');
      }
      throw err;
    }
  }

  async deleteNote(userId: string, noteId: string): Promise<void> {
    const deleted = await this.notesRepository.softDeleteNote(userId, noteId);
    if (!deleted) {
      throw AppError.notFound('Note not found');
    }
  }

  async restoreNote(userId: string, noteId: string): Promise<NoteDto> {
    const existing = await this.notesRepository.findNoteByIdWithDeleted(userId, noteId);
    if (!existing) {
      throw AppError.notFound('Note not found');
    }

    if (existing.deletedAt === null) {
      throw AppError.conflict('NOT_DELETED', 'Note is not deleted');
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    if (existing.deletedAt < thirtyDaysAgo) {
      throw new AppError({
        httpStatus: 410,
        code: 'NOT_FOUND',
        safeMessage: 'Note soft-delete restore window (30 days) has expired'
      });
    }

    const restored = await this.notesRepository.restoreNote(userId, noteId);
    if (!restored) {
      throw AppError.notFound('Note not found');
    }

    const links = await this.notesRepository.listNoteLinks(userId, noteId);
    return toNoteDto(restored, links);
  }

  async createNoteLink(
    userId: string,
    noteId: string,
    link: CreateNoteLinkInput
  ): Promise<NoteLinkDto> {
    const note = await this.notesRepository.findNoteById(userId, noteId);
    if (!note) {
      throw AppError.notFound('Note not found');
    }

    try {
      const created = await this.notesRepository.createNoteLink(userId, noteId, link);
      return toNoteLinkDto(created);
    } catch (err: unknown) {
      const dbErr = err as { code?: string; constraint?: string };
      if (dbErr.code === '23503') {
        throw AppError.notFound('Referenced entity does not exist');
      }
      if (dbErr.code === '23505') {
        throw AppError.conflict('CONFLICT', 'Entity is already linked to this note');
      }
      throw err;
    }
  }

  async listNoteLinks(userId: string, noteId: string): Promise<NoteLinkDto[]> {
    const note = await this.notesRepository.findNoteById(userId, noteId);
    if (!note) {
      throw AppError.notFound('Note not found');
    }

    const links = await this.notesRepository.listNoteLinks(userId, noteId);
    return links.map(toNoteLinkDto);
  }

  async deleteNoteLink(userId: string, noteId: string, linkId: string): Promise<void> {
    const note = await this.notesRepository.findNoteById(userId, noteId);
    if (!note) {
      throw AppError.notFound('Note not found');
    }

    const deleted = await this.notesRepository.deleteNoteLink(userId, noteId, linkId);
    if (!deleted) {
      throw AppError.notFound('Note link not found');
    }
  }

  async listTags(userId: string): Promise<TagCountDto[]> {
    return await this.notesRepository.listTags(userId);
  }
}
