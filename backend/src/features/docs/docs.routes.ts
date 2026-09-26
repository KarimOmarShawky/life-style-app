/**
 * Swagger UI, served from the checked-in OpenAPI document (spec section 40).
 *
 * The specification lives at docs/api/openapi.yaml, outside src/, so it is
 * reviewed as documentation rather than buried in code. It is read from disk at
 * router construction; a parse failure degrades to a clear message instead of
 * preventing the API from starting, because broken docs must not be an outage.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Router, type Request, type Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import { parse } from 'yaml';

import { createLogger } from '@/core/logger';

const log = createLogger('docs');

const SPEC_PATH = path.resolve(__dirname, '../../../../docs/api/openapi.yaml');

function loadSpec(): Record<string, unknown> | undefined {
  try {
    const raw = readFileSync(SPEC_PATH, 'utf8');
    return parse(raw) as Record<string, unknown>;
  } catch (error) {
    log.error({ err: error, path: SPEC_PATH }, 'Could not load the OpenAPI document');
    return undefined;
  }
}

export function createDocsRouter(): Router {
  const router = Router();
  const spec = loadSpec();

  if (!spec) {
    router.get('/', (_req: Request, res: Response) => {
      res.status(503).json({
        success: false,
        error: { code: 'SERVICE_UNAVAILABLE', message: 'API documentation is unavailable.' },
      });
    });
    return router;
  }

  router.get('/openapi.json', (_req: Request, res: Response) => {
    res.status(200).json(spec);
  });

  router.use('/', swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: 'LifeStyle API' }));

  return router;
}
