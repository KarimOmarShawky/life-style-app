/**
 * Goal routes.
 *
 * `authenticate` is applied at the router level so no route here can be public
 * by omission.
 *
 * Milestones are nested under their goal rather than given a top-level
 * collection. A milestone has no meaning outside one, and nesting makes the goal
 * part of every ownership check instead of something a handler must remember to
 * verify separately.
 */
import { Router } from 'express';

import { getContainer } from '@/core/container';
import { asyncHandler } from '@/core/middleware/async-handler';
import { createAuthenticate } from '@/core/middleware/authenticate';
import { validate } from '@/core/middleware/validate';
import { idParamSchema } from '@/core/validation/common';

import {
  createGoalSchema,
  createMilestoneSchema,
  listGoalsQuerySchema,
  milestoneParamsSchema,
  updateGoalSchema,
  updateMilestoneSchema,
} from './goal.validation';

export function createGoalRouter(): Router {
  const router = Router();
  const { goalController, tokenService } = getContainer();

  router.use(createAuthenticate(tokenService));

  router.post('/', validate({ body: createGoalSchema }), asyncHandler(goalController.create));

  router.get('/', validate({ query: listGoalsQuerySchema }), asyncHandler(goalController.list));

  router.get('/:id', validate({ params: idParamSchema }), asyncHandler(goalController.getById));

  router.patch(
    '/:id',
    validate({ params: idParamSchema, body: updateGoalSchema }),
    asyncHandler(goalController.update),
  );

  router.delete('/:id', validate({ params: idParamSchema }), asyncHandler(goalController.remove));

  router.post(
    '/:id/milestones',
    validate({ params: idParamSchema, body: createMilestoneSchema }),
    asyncHandler(goalController.addMilestone),
  );

  router.patch(
    '/:id/milestones/:milestoneId',
    validate({ params: milestoneParamsSchema, body: updateMilestoneSchema }),
    asyncHandler(goalController.updateMilestone),
  );

  router.delete(
    '/:id/milestones/:milestoneId',
    validate({ params: milestoneParamsSchema }),
    asyncHandler(goalController.removeMilestone),
  );

  return router;
}
