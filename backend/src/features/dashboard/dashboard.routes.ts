/**
 * Home summary route.
 *
 * One endpoint, no parameters. There is nothing to validate because there is
 * nothing to send: the day is the server's, the bounds are derived from it, and
 * every list is capped by the query. A `?date=` parameter would be easy to add
 * and would turn a fixed-cost endpoint into one whose cost a caller chooses.
 */
import { Router } from 'express';

import { getContainer } from '@/core/container';
import { asyncHandler } from '@/core/middleware/async-handler';
import { createAuthenticate } from '@/core/middleware/authenticate';

export function createDashboardRouter(): Router {
  const router = Router();
  const { dashboardController, tokenService } = getContainer();

  router.use(createAuthenticate(tokenService));

  router.get('/', asyncHandler(dashboardController.summary));

  return router;
}
