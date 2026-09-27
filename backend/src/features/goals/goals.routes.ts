/**
 * src/features/goals/goals.routes.ts
 *
 * Implements Section 14.9 & AC-GOAL-01: Goals & Milestones Routes.
 */

import { Router, type RequestHandler } from 'express';
import type { GoalsController } from './goals.controller.js';
import { type RateLimiter, createRateLimitMiddleware } from '../../core/middleware/rate-limiter.js';

export function createGoalsRouter(options: {
  controller: GoalsController;
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

  // Goal collection routes
  router.get('/', controller.listGoals);
  router.post('/', controller.createGoal);

  // Milestone nested routes
  router.get('/:id/milestones', controller.listMilestones);
  router.post('/:id/milestones', controller.createMilestone);
  router.get('/:id/milestones/:milestoneId', controller.getMilestone);
  router.patch('/:id/milestones/:milestoneId', controller.updateMilestone);
  router.delete('/:id/milestones/:milestoneId', controller.deleteMilestone);

  // Goal individual entity routes
  router.get('/:id', controller.getGoal);
  router.patch('/:id', controller.updateGoal);
  router.delete('/:id', controller.deleteGoal);
  router.post('/:id/restore', controller.restoreGoal);

  return router;
}
