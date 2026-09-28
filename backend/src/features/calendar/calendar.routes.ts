/**
 * src/features/calendar/calendar.routes.ts
 *
 * Implements Section 14.14–14.15 & AC-CAL-01: Calendar Events & Reminders Routes.
 */

import { Router, type RequestHandler } from 'express';
import type { CalendarController } from './calendar.controller.js';
import { type RateLimiter, createRateLimitMiddleware } from '../../core/middleware/rate-limiter.js';

export function createCalendarRouter(options: {
  controller: CalendarController;
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

  // Non-parameterized routes mounted before /:id
  router.get('/conflicts', controller.checkConflicts);
  router.get('/agenda', controller.getAgenda);
  router.get('/', controller.listEvents);
  router.post('/', controller.createEvent);

  // Reminders routes
  router.get('/:id/reminders', controller.listReminders);
  router.post('/:id/reminders', controller.addReminder);
  router.delete('/:id/reminders/:reminderId', controller.deleteReminder);

  // Individual event CRUD & restore
  router.get('/:id', controller.getEvent);
  router.patch('/:id', controller.updateEvent);
  router.delete('/:id', controller.deleteEvent);
  router.post('/:id/restore', controller.restoreEvent);

  return router;
}
