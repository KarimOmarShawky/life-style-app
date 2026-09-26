/**
 * src/app.ts
 *
 * Implements Section 4.6: Express Application Builder.
 * Assembles middleware in strict sequence:
 * Request ID -> Security Headers -> Body Limit -> Content-Type -> Health / API Routes -> Error Handler.
 */

import express, { type Express } from 'express';
import { getEnv } from './config/env.js';
import { requestIdMiddleware } from './core/middleware/request-id.js';
import { helmetSecurityMiddleware, enforceJsonContentType } from './core/middleware/security.js';
import { globalErrorHandler } from './core/middleware/error-handler.js';
import { AppError } from './core/errors/app-error.js';
import { healthRouter } from './features/health/health.routes.js';
import { buildContainer, type AppContainer } from './container.js';

export function createApp(containerOverrides?: Partial<AppContainer>): Express {
  const env = getEnv();
  // Ensure container is initialized
  buildContainer(containerOverrides);

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

  // 7. Catch-all 404 handler for unknown routes
  app.use((_req, _res, next) => {
    next(AppError.notFound('Endpoint not found'));
  });

  // 8. Centralized global error handler (Section 15.3)
  app.use(globalErrorHandler);

  return app;
}
