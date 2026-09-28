/**
 * src/app.ts
 *
 * Implements Section 4.6: Express Application Builder.
 * Assembles middleware in strict sequence:
 * Request ID -> Security Headers -> Body Limit -> Content-Type -> Health / API Routes -> Error Handler.
 */

import express, { type Express, Router } from 'express';
import { getEnv } from './config/env.js';
import { requestIdMiddleware } from './core/middleware/request-id.js';
import { helmetSecurityMiddleware, enforceJsonContentType } from './core/middleware/security.js';
import { globalErrorHandler } from './core/middleware/error-handler.js';
import { createRateLimitMiddleware } from './core/middleware/rate-limiter.js';
import { AppError } from './core/errors/app-error.js';
import { healthRouter } from './features/health/health.routes.js';
import { createAuthRouter } from './features/auth/auth.routes.js';
import { createUsersRouter } from './features/users/users.routes.js';
import { createTasksRouter } from './features/tasks/tasks.routes.js';
import { createProjectsRouter } from './features/projects/projects.routes.js';
import { createRecurringTasksRouter } from './features/recurring-tasks/recurring-tasks.routes.js';
import { createTimerSessionsRouter } from './features/timer-sessions/timer-sessions.routes.js';
import { createHabitsRouter } from './features/habits/habits.routes.js';
import { createCalendarRouter } from './features/calendar/calendar.routes.js';
import { createGoalsRouter } from './features/goals/goals.routes.js';
import { createNotesRouter } from './features/notes/notes.routes.js';
import { createMoneyRouter } from './features/money/money.routes.js';
import { buildContainer, type AppContainer } from './container.js';

export function createApp(containerOverrides?: Partial<AppContainer>): Express {
  const env = getEnv();
  // Ensure container is initialized
  const container = buildContainer(containerOverrides);

  const app: Express = express();

  // Trust proxy hops per Section 16.2
  app.set('trust proxy', env.TRUST_PROXY_HOPS);

  // 1. Request ID and AsyncLocalStorage logger context (Section 4.6, 16.5)
  app.use(requestIdMiddleware);

  // 2. HTTP Hardening headers with Helmet (Section 16.2)
  app.use(helmetSecurityMiddleware);

  // 3. Health check endpoints (Section 4.8) — Unauthenticated, unversioned, excluded from body parser & rate limits
  app.use('/health', healthRouter);

  // 4. Request body limit: 100 KB JSON ceiling (Section 15.4, 16.2)
  app.use(express.json({ limit: '100kb' }));

  // 5. Content-Type validation on mutating requests (Section 16.2)
  app.use(enforceJsonContentType);

  // 6. Root status endpoint
  app.get('/', (_req, res) => {
    res.status(200).json({
      name: 'LifeStyle API',
      version: '1.0.1',
      status: 'healthy'
    });
  });

  // 7. API v1 Routers
  const v1Router = Router();

  // Global unauthenticated IP rate limit per Section 8.3: 120 req / 60 s
  const globalIpLimiter = createRateLimitMiddleware({
    limiter: container.rateLimiter,
    limit: 120,
    windowSeconds: 60,
    keyGenerator: (req) => `global:ip:${req.ip || 'unknown'}`
  });
  v1Router.use(globalIpLimiter);

  // Mount Auth routes
  v1Router.use(
    '/auth',
    createAuthRouter({
      controller: container.authController,
      authenticate: container.authenticate,
      rateLimiter: container.rateLimiter
    })
  );

  // Mount Users routes
  v1Router.use(
    '/users',
    createUsersRouter({
      controller: container.usersController,
      authenticate: container.authenticate,
      rateLimiter: container.rateLimiter
    })
  );

  // Mount Tasks routes
  v1Router.use(
    '/tasks',
    createTasksRouter({
      controller: container.tasksController,
      authenticate: container.authenticate,
      rateLimiter: container.rateLimiter
    })
  );

  // Mount Projects routes
  v1Router.use(
    '/projects',
    createProjectsRouter({
      controller: container.projectsController,
      authenticate: container.authenticate,
      rateLimiter: container.rateLimiter
    })
  );

  // Mount Recurring Tasks routes
  v1Router.use(
    '/recurring-tasks',
    createRecurringTasksRouter({
      controller: container.recurringTasksController,
      authenticate: container.authenticate,
      rateLimiter: container.rateLimiter
    })
  );

  // Mount Timer Sessions routes
  v1Router.use(
    '/timer-sessions',
    createTimerSessionsRouter({
      controller: container.timerSessionsController,
      authenticate: container.authenticate,
      rateLimiter: container.rateLimiter
    })
  );

  // Mount Habits routes
  v1Router.use(
    '/habits',
    createHabitsRouter({
      controller: container.habitsController,
      authenticate: container.authenticate,
      rateLimiter: container.rateLimiter
    })
  );

  // Mount Calendar Events routes
  v1Router.use(
    '/events',
    createCalendarRouter({
      controller: container.calendarController,
      authenticate: container.authenticate,
      rateLimiter: container.rateLimiter
    })
  );

  // Mount Goals routes
  v1Router.use(
    '/goals',
    createGoalsRouter({
      controller: container.goalsController,
      authenticate: container.authenticate,
      rateLimiter: container.rateLimiter
    })
  );

  // Mount Notes routes
  v1Router.use(
    '/notes',
    createNotesRouter({
      controller: container.notesController,
      authenticate: container.authenticate,
      rateLimiter: container.rateLimiter
    })
  );

  // Mount Money routes
  v1Router.use(
    '/money',
    createMoneyRouter({
      controller: container.moneyController,
      authenticate: container.authenticate,
      rateLimiter: container.rateLimiter
    })
  );

  app.use('/api/v1', v1Router);

  // 8. Catch-all 404 handler for unknown routes
  app.use((_req, _res, next) => {
    next(AppError.notFound('Endpoint not found'));
  });

  // 9. Centralized global error handler (Section 15.3)
  app.use(globalErrorHandler);

  return app;
}
