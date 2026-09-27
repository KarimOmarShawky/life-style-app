/**
 * src/features/notes/notes.routes.ts
 *
 * Implements Section 14.10: Express Router for Notes & Note Links endpoints.
 */

import { Router, type RequestHandler } from 'express';
import type { NotesController } from './notes.controller.js';
import { type RateLimiter, createRateLimitMiddleware } from '../../core/middleware/rate-limiter.js';

export function createNotesRouter(options: {
  controller: NotesController;
  authenticate: RequestHandler;
  rateLimiter: RateLimiter;
}): Router {
  const router = Router();
  const { controller, authenticate, rateLimiter } = options;

  // Authenticated user rate limit per Section 8.3: 300 req / 60 s
  const userRateLimiter = createRateLimitMiddleware({
    limiter: rateLimiter,
    limit: 300,
    windowSeconds: 60,
    keyGenerator: (req) => `user:${req.user?.id || 'anon'}`
  });

  router.use(authenticate, userRateLimiter);

  // Tags endpoint (must be registered before /:id)
  router.get('/tags', controller.listTags);

  // Notes collection
  router.post('/', controller.createNote);
  router.get('/', controller.listNotes);

  // Single note item operations
  router.get('/:id', controller.getNote);
  router.patch('/:id', controller.updateNote);
  router.delete('/:id', controller.deleteNote);
  router.post('/:id/restore', controller.restoreNote);

  // Note polymorphic links sub-resource
  router.post('/:id/links', controller.createNoteLink);
  router.get('/:id/links', controller.listNoteLinks);
  router.delete('/:id/links/:linkId', controller.deleteNoteLink);

  return router;
}
