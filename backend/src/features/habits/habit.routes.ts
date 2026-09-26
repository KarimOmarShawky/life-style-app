/**
 * Habit routes.
 *
 * `authenticate` is applied at the router level so no route here can be public
 * by omission.
 *
 * Logging a day is a POST to a sub-resource rather than a field on the habit.
 * "I did this today" is an event, and modelling it as a boolean on the habit
 * would lose the history that streaks are computed from.
 */
import { Router } from 'express';

import { getContainer } from '@/core/container';
import { asyncHandler } from '@/core/middleware/async-handler';
import { createAuthenticate } from '@/core/middleware/authenticate';
import { validate } from '@/core/middleware/validate';
import { idParamSchema } from '@/core/validation/common';

import {
  createHabitSchema,
  habitDetailQuerySchema,
  habitLogParamsSchema,
  habitLogsQuerySchema,
  listHabitsQuerySchema,
  logHabitSchema,
  updateHabitSchema,
} from './habit.validation';

export function createHabitRouter(): Router {
  const router = Router();
  const { habitController, tokenService } = getContainer();

  router.use(createAuthenticate(tokenService));

  router.post('/', validate({ body: createHabitSchema }), asyncHandler(habitController.create));

  router.get('/', validate({ query: listHabitsQuerySchema }), asyncHandler(habitController.list));

  router.get(
    '/:id',
    validate({ params: idParamSchema, query: habitDetailQuerySchema }),
    asyncHandler(habitController.getById),
  );

  router.patch(
    '/:id',
    validate({ params: idParamSchema, body: updateHabitSchema }),
    asyncHandler(habitController.update),
  );

  router.delete('/:id', validate({ params: idParamSchema }), asyncHandler(habitController.remove));

  router.get(
    '/:id/logs',
    validate({ params: idParamSchema, query: habitLogsQuerySchema }),
    asyncHandler(habitController.listLogs),
  );

  router.post(
    '/:id/logs',
    validate({ params: idParamSchema, body: logHabitSchema }),
    asyncHandler(habitController.log),
  );

  router.delete(
    '/:id/logs/:date',
    validate({ params: habitLogParamsSchema }),
    asyncHandler(habitController.removeLog),
  );

  return router;
}
