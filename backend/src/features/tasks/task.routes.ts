/**
 * Task routes.
 *
 * `authenticate` is applied at the router level so no route here can be public
 * by omission.
 *
 * Timer start and stop are POSTs to sub-resources rather than a PATCH setting a
 * `running` flag. They are actions with side effects, not field assignments, and
 * modelling them as state changes would invite a client to "correct" the flag.
 */
import { Router } from 'express';

import { getContainer } from '@/core/container';
import { asyncHandler } from '@/core/middleware/async-handler';
import { createAuthenticate } from '@/core/middleware/authenticate';
import { validate } from '@/core/middleware/validate';
import { idParamSchema } from '@/core/validation/common';

import { createTaskSchema, listTasksQuerySchema, updateTaskSchema } from './task.validation';

export function createTaskRouter(): Router {
  const router = Router();
  const { taskController, tokenService } = getContainer();

  router.use(createAuthenticate(tokenService));

  router.post('/', validate({ body: createTaskSchema }), asyncHandler(taskController.create));

  router.get('/', validate({ query: listTasksQuerySchema }), asyncHandler(taskController.list));

  router.get('/:id', validate({ params: idParamSchema }), asyncHandler(taskController.getById));

  router.patch(
    '/:id',
    validate({ params: idParamSchema, body: updateTaskSchema }),
    asyncHandler(taskController.update),
  );

  router.delete('/:id', validate({ params: idParamSchema }), asyncHandler(taskController.remove));

  router.post(
    '/:id/timer/start',
    validate({ params: idParamSchema }),
    asyncHandler(taskController.startTimer),
  );

  router.post(
    '/:id/timer/stop',
    validate({ params: idParamSchema }),
    asyncHandler(taskController.stopTimer),
  );

  router.get(
    '/:id/timer/sessions',
    validate({ params: idParamSchema }),
    asyncHandler(taskController.timerSessions),
  );

  return router;
}
