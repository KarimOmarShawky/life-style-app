/**
 * Express application assembly.
 *
 * MIDDLEWARE ORDER IS SECURITY-RELEVANT. It runs top to bottom:
 *
 *   1. trust proxy      so req.ip is the real client, not the load balancer
 *   2. request id       so every later log line and error is correlatable
 *   3. security headers before anything can produce a response
 *   4. CORS             before routes, so preflights are answered correctly
 *   5. body parsing     with a size cap, before anything reads the body
 *   6. rate limiting    before route handlers do real work
 *   7. routes
 *   8. 404 handler      after all routes, so it only catches genuine misses
 *   9. error handler    last: Express only treats 4-arity middleware as this
 *
 * Exported separately from server.ts so integration tests can drive the app with
 * supertest without binding a port.
 */
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';

import { config, isProduction } from '@/config';
import { errorHandler } from '@/core/middleware/error-handler';
import { notFoundHandler } from '@/core/middleware/not-found';
import { generalLimiter } from '@/core/middleware/rate-limit';
import { requestIdMiddleware } from '@/core/middleware/request-id';
import { corsMiddleware, securityHeaders } from '@/core/security/http-security';
import { createAuthRouter } from '@/features/auth/auth.routes';
import { createDocsRouter } from '@/features/docs/docs.routes';
import { createHealthRouter } from '@/features/health/health.routes';
import { createGoalRouter } from '@/features/goals/goal.routes';
import { createHabitRouter } from '@/features/habits/habit.routes';
import {
  createBudgetRouter,
  createExpenseRouter,
  createSubscriptionRouter,
} from '@/features/money/money.routes';
import { createNoteRouter } from '@/features/notes/note.routes';
import { createProjectRouter } from '@/features/projects/project.routes';
import { createDashboardRouter } from '@/features/dashboard/dashboard.routes';
import { createEventRouter, createReminderRouter } from '@/features/schedule/schedule.routes';
import { createTaskRouter } from '@/features/tasks/task.routes';

export function createApp(): Express {
  const app = express();

  // Required for correct req.ip behind a proxy, which rate limiting and the
  // audit trail both depend on. Set to 1 rather than `true`: trusting every hop
  // lets a client forge X-Forwarded-For and defeat IP-based limits entirely.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.set('etag', false);

  app.use(requestIdMiddleware);
  app.use(securityHeaders());
  app.use(corsMiddleware());

  // The size cap is the first line against memory-exhaustion payloads. 100kb is
  // generous for this API, whose largest body is a note.
  app.use(express.json({ limit: '100kb', strict: true }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(cookieParser(config.COOKIE_SECRET));

  // Health endpoints are mounted BEFORE the rate limiter: an orchestrator polling
  // liveness every few seconds must never be throttled into a false restart.
  app.use(createHealthRouter());

  app.use(generalLimiter);

  app.use(`${config.API_PREFIX}/auth`, createAuthRouter());
  app.use(`${config.API_PREFIX}/projects`, createProjectRouter());
  app.use(`${config.API_PREFIX}/tasks`, createTaskRouter());
  app.use(`${config.API_PREFIX}/notes`, createNoteRouter());
  app.use(`${config.API_PREFIX}/habits`, createHabitRouter());
  app.use(`${config.API_PREFIX}/goals`, createGoalRouter());
  app.use(`${config.API_PREFIX}/expenses`, createExpenseRouter());
  app.use(`${config.API_PREFIX}/subscriptions`, createSubscriptionRouter());
  app.use(`${config.API_PREFIX}/budgets`, createBudgetRouter());
  app.use(`${config.API_PREFIX}/events`, createEventRouter());
  app.use(`${config.API_PREFIX}/reminders`, createReminderRouter());
  app.use(`${config.API_PREFIX}/dashboard`, createDashboardRouter());

  if (!isProduction) {
    // Mounted only outside production. The spec allows Swagger UI, but exposing
    // the full surface of an API publicly is free reconnaissance for an attacker
    // (spec section 40); enable it in production deliberately, behind auth.
    app.use('/docs', createDocsRouter());
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
