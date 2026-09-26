/**
 * Project routes.
 *
 * `authenticate` is applied once at the router level rather than per route, so a
 * route added later cannot accidentally be public. That default matters more
 * than the small repetition it saves.
 */
import { Router } from 'express';

import { getContainer } from '@/core/container';
import { asyncHandler } from '@/core/middleware/async-handler';
import { createAuthenticate } from '@/core/middleware/authenticate';
import { validate } from '@/core/middleware/validate';
import { idParamSchema, paginationQuerySchema } from '@/core/validation/common';

import { createProjectSchema, updateProjectSchema } from './project.validation';

export function createProjectRouter(): Router {
  const router = Router();
  const { projectController, tokenService } = getContainer();

  router.use(createAuthenticate(tokenService));

  router.post('/', validate({ body: createProjectSchema }), asyncHandler(projectController.create));

  router.get('/', validate({ query: paginationQuerySchema }), asyncHandler(projectController.list));

  router.get('/:id', validate({ params: idParamSchema }), asyncHandler(projectController.getById));

  router.patch(
    '/:id',
    validate({ params: idParamSchema, body: updateProjectSchema }),
    asyncHandler(projectController.update),
  );

  router.delete(
    '/:id',
    validate({ params: idParamSchema }),
    asyncHandler(projectController.remove),
  );

  return router;
}
