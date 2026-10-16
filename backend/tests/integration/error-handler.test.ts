import '../infrastructure-safety.js';
/**
 * tests/integration/error-handler.test.ts
 *
 * Verifies Section 15.3: Global error mapping and response envelopes.
 */

import { describe, it, expect } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { globalErrorHandler } from '../../src/core/middleware/error-handler.js';
import { requestIdMiddleware } from '../../src/core/middleware/request-id.js';
import { AppError } from '../../src/core/errors/app-error.js';

function createErrorTestApp(): Express {
  const app = express();
  app.use(requestIdMiddleware);
  app.use(express.json());

  // Test route triggering ZodError
  app.post('/test/zod', (req, _res, next) => {
    try {
      const schema = z.object({
        email: z.string().email(),
        count: z.number().int().min(1)
      });
      schema.parse(req.body);
    } catch (err) {
      return next(err);
    }
  });

  // Test route triggering AppError
  app.get('/test/conflict', (_req, _res, next) => {
    next(AppError.conflict('EMAIL_ALREADY_REGISTERED', 'Email already in use'));
  });

  // Test route triggering PG unique violation (23505)
  app.get('/test/pg-unique', (_req, _res, next) => {
    const err = new Error('duplicate key value violates unique constraint') as Error & {
      code?: string;
    };
    err.code = '23505';
    next(err);
  });

  // Test route triggering PG foreign key violation (23503)
  app.get('/test/pg-fk', (_req, _res, next) => {
    const err = new Error('insert or update violates foreign key constraint') as Error & {
      code?: string;
    };
    err.code = '23503';
    next(err);
  });

  // Test route triggering PG deadlock / serialization (40001)
  app.get('/test/pg-concurrency', (_req, _res, next) => {
    const err = new Error('could not serialize access due to concurrent update') as Error & {
      code?: string;
    };
    err.code = '40001';
    next(err);
  });

  // Test route triggering unexpected internal error
  app.get('/test/unexpected', (_req, _res, next) => {
    next(new Error('Sensitive database credentials leak test: password=supersecret'));
  });

  app.use(globalErrorHandler);
  return app;
}

describe('Global Centralized Error Handler (Spec §15.3)', () => {
  const app = createErrorTestApp();

  it('maps ZodError to HTTP 400 VALIDATION_ERROR with structured field paths', async () => {
    const res = await request(app).post('/test/zod').send({ email: 'not-an-email', count: 0 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toBe('Invalid request');
    expect(res.body.error.details).toHaveLength(2);
    expect(res.body.error.details[0].field).toBe('email');
    expect(res.body.error.details[1].field).toBe('count');
    expect(res.body.error.requestId).toBeDefined();
  });

  it('maps domain AppError with custom business conflict code', async () => {
    const res = await request(app).get('/test/conflict');

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
    expect(res.body.error.message).toBe('Email already in use');
  });

  it('maps PostgreSQL 23505 unique violation to HTTP 409 CONFLICT envelope', async () => {
    const res = await request(app).get('/test/pg-unique');

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.message).toBe('A resource with these details already exists');
  });

  it('maps PostgreSQL 23503 foreign key violation to HTTP 400 VALIDATION_ERROR', async () => {
    const res = await request(app).get('/test/pg-fk');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toBe('Referenced entity does not exist or is not valid');
  });

  it('maps PostgreSQL 40001 serialization deadlock to HTTP 503 SERVICE_UNAVAILABLE', async () => {
    const res = await request(app).get('/test/pg-concurrency');

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('masks unexpected internal errors with generic 500 INTERNAL_ERROR envelope without leaking secrets/stack', async () => {
    const res = await request(app).get('/test/unexpected');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.body.error.message).toBe('Internal server error');
    // Verify that sensitive internal message is completely hidden
    expect(JSON.stringify(res.body)).not.toContain('supersecret');
    expect(JSON.stringify(res.body)).not.toContain('password');
    expect(res.body.error.stack).toBeUndefined();
  });
});
