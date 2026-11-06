/**
 * Isolated integration harness for retained legacy money/ingest components.
 * These routes are NOT mounted without retirement guards by the production app.
 * Production retirement is tested separately in retired-money-flow.test.ts.
 */
import express from 'express';
import { createApp } from '../../src/app.js';
import { buildContainer, type AppContainer } from '../../src/container.js';
import { globalErrorHandler } from '../../src/core/middleware/error-handler.js';
import { requestIdMiddleware } from '../../src/core/middleware/request-id.js';
import { successEnvelopeMiddleware } from '../../src/core/middleware/success-envelope.js';
import { createIngestRouter } from '../../src/features/ingest/ingest.routes.js';
import { createMoneyRouter } from '../../src/features/money/money.routes.js';

export function createLegacyMoneyTestApp(overrides?: Partial<AppContainer>) {
  const container = buildContainer(overrides);
  const app = express();
  app.use(requestIdMiddleware, express.json({ limit: '100kb' }), successEnvelopeMiddleware);
  app.use(
    '/api/v1/money',
    createMoneyRouter({
      controller: container.moneyController,
      authenticate: container.authenticate,
      rateLimiter: container.rateLimiter
    })
  );
  app.use(
    '/api/v1/ingest',
    createIngestRouter({
      controller: container.ingestController,
      authenticate: container.authenticate,
      authenticateIngest: container.authenticateIngest,
      authenticateIngestOrUser: container.authenticateIngestOrUser,
      createTransaction: container.moneyController.createTransaction,
      rateLimiter: container.rateLimiter
    })
  );
  app.use(globalErrorHandler);
  app.use(createApp(container));
  return app;
}
