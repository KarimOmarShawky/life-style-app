/**
 * src/features/notes/notes.controller.ts
 *
 * Implements Section 14.10: Notes & Note Links HTTP Controller.
 */

import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../core/errors/app-error.js';
import type { NotesService } from './notes.service.js';
import {
  createNoteSchema,
  updateNoteSchema,
  listNotesQuerySchema,
  noteIdParamSchema,
  noteLinkIdParamSchema,
  createNoteLinkSchema
} from './notes.validation.js';

export class NotesController {
  constructor(private readonly notesService: NotesService) {}

  createNote = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const validated = createNoteSchema.parse(req.body);
      const note = await this.notesService.createNote(req.user.id, validated);
      res.status(201).json({ note });
    } catch (err) {
      next(err);
    }
  };

  listNotes = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const query = listNotesQuerySchema.parse(req.query);
      const notes = await this.notesService.listNotes(req.user.id, query);
      res.status(200).json({ notes });
    } catch (err) {
      next(err);
    }
  };

  getNote = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = noteIdParamSchema.parse(req.params);
      const note = await this.notesService.getNote(req.user.id, id);
      res.status(200).json({ note });
    } catch (err) {
      next(err);
    }
  };

  updateNote = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = noteIdParamSchema.parse(req.params);
      const validated = updateNoteSchema.parse(req.body);
      const note = await this.notesService.updateNote(req.user.id, id, validated);
      res.status(200).json({ note });
    } catch (err) {
      next(err);
    }
  };

  deleteNote = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = noteIdParamSchema.parse(req.params);
      await this.notesService.deleteNote(req.user.id, id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };

  restoreNote = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = noteIdParamSchema.parse(req.params);
      const note = await this.notesService.restoreNote(req.user.id, id);
      res.status(200).json({ note });
    } catch (err) {
      next(err);
    }
  };

  listTags = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const tags = await this.notesService.listTags(req.user.id);
      res.status(200).json({ tags });
    } catch (err) {
      next(err);
    }
  };

  createNoteLink = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = noteIdParamSchema.parse(req.params);
      const validated = createNoteLinkSchema.parse(req.body);
      const link = await this.notesService.createNoteLink(req.user.id, id, validated);
      res.status(201).json({ link });
    } catch (err) {
      next(err);
    }
  };

  listNoteLinks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = noteIdParamSchema.parse(req.params);
      const links = await this.notesService.listNoteLinks(req.user.id, id);
      res.status(200).json({ links });
    } catch (err) {
      next(err);
    }
  };

  deleteNoteLink = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id, linkId } = noteLinkIdParamSchema.parse(req.params);
      await this.notesService.deleteNoteLink(req.user.id, id, linkId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };
}
