/**
 * Note routes.
 *
 * `authenticate` is applied at the router level so no route here can be public
 * by omission.
 *
 * ROUTE ORDER MATTERS. `/tags` and `/reconcile` are declared before `/:id`,
 * because Express matches in declaration order and `/:id` would otherwise
 * swallow them and reject "tags" as a malformed id.
 */
import { Router } from 'express';

import { getContainer } from '@/core/container';
import { asyncHandler } from '@/core/middleware/async-handler';
import { createAuthenticate } from '@/core/middleware/authenticate';
import { validate } from '@/core/middleware/validate';
import { objectIdParamSchema } from '@/core/validation/common';

import { createNoteSchema, listNotesQuerySchema, updateNoteSchema } from './note.validation';

export function createNoteRouter(): Router {
  const router = Router();
  const { noteController, tokenService } = getContainer();

  router.use(createAuthenticate(tokenService));

  router.post('/', validate({ body: createNoteSchema }), asyncHandler(noteController.create));

  router.get('/', validate({ query: listNotesQuerySchema }), asyncHandler(noteController.list));

  router.get('/tags', asyncHandler(noteController.tags));

  router.post('/reconcile', asyncHandler(noteController.reconcile));

  router.get(
    '/:id',
    validate({ params: objectIdParamSchema }),
    asyncHandler(noteController.getById),
  );

  router.patch(
    '/:id',
    validate({ params: objectIdParamSchema, body: updateNoteSchema }),
    asyncHandler(noteController.update),
  );

  router.delete(
    '/:id',
    validate({ params: objectIdParamSchema }),
    asyncHandler(noteController.remove),
  );

  return router;
}
