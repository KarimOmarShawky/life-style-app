/**
 * src/features/projects/projects.routes.ts
 *
 * Implements Section 14.5: Projects Routes.
 */

import { Router, type RequestHandler } from 'express';
import type { ProjectsController } from './projects.controller.js';
import { type RateLimiter, createRateLimitMiddleware } from '../../core/middleware/rate-limiter.js';

export function createProjectsRouter(options: {
  controller: ProjectsController;
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

  router.get('/', controller.listProjects);
  router.post('/', controller.createProject);
  router.get('/:id', controller.getProject);
  router.patch('/:id', controller.updateProject);
  router.delete('/:id', controller.deleteProject);
  router.post('/:id/restore', controller.restoreProject);

  return router;
}
