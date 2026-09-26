/**
 * Degraded-mode tests: MongoDB is not configured.
 *
 * The design says notes become unavailable while the rest of the API keeps
 * working. That claim was never verified before this file existed, and an
 * unverified degradation path is how a missing optional dependency turns into a
 * 500 on every endpoint.
 *
 * Runs only when MONGODB_URI is unset, which is the exact condition it describes.
 */
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

import { createApp } from '@/app';

import { MONGO_CONFIGURED, STRONG_PASSWORD, testEmail } from '../setup';

let app: Express;
let auth: string;

describe.runIf(!MONGO_CONFIGURED)('notes without MongoDB', () => {
  beforeAll(async () => {
    app = createApp();
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: testEmail('notes-degraded'), password: STRONG_PASSWORD })
      .expect(201);
    auth = `Bearer ${response.body.data.tokens.accessToken}`;
  });

  it('answers 503 rather than 500 when creating a note', async () => {
    const response = await request(app)
      .post('/api/v1/notes')
      .set('Authorization', auth)
      .send({ title: 'Cannot be stored' })
      .expect(503);

    // 503 says "valid request, try later". A 500 would tell the client to give up.
    expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('answers 503 on every note route', async () => {
    await request(app).get('/api/v1/notes').set('Authorization', auth).expect(503);
    await request(app)
      .get('/api/v1/notes/507f1f77bcf86cd799439011')
      .set('Authorization', auth)
      .expect(503);
    await request(app).get('/api/v1/notes/tags').set('Authorization', auth).expect(503);
    await request(app).post('/api/v1/notes/reconcile').set('Authorization', auth).expect(503);
  });

  it('does not leak the connection string, credentials or which service is down', async () => {
    const response = await request(app).get('/api/v1/notes').set('Authorization', auth).expect(503);

    // `AppError.serviceUnavailable` records { service: 'MongoDB' } as internal
    // metadata for the logs. toClientJSON is the boundary that must drop it:
    // naming the failing component tells a caller what our stack is built from.
    expect(response.body.error.metadata).toBeUndefined();
    expect(response.body.error.message).toBe('The service is temporarily unavailable.');

    const body = JSON.stringify(response.body);
    expect(body).not.toMatch(/mongodb(\+srv)?:\/\//);
    expect(body).not.toMatch(/password/i);
    expect(body).not.toMatch(/MongoServerError|MongooseServerSelectionError/);

    // A stack IS present here, and deliberately so: this suite runs with
    // NODE_ENV=test and the error handler withholds stacks only in production.
    // Asserting its absence would pass for the wrong reason and stop testing
    // anything the day the environment changed.
  });

  it('still requires authentication, before reporting unavailability', async () => {
    // Order matters: answering 503 to an anonymous caller would tell an
    // unauthenticated stranger about our infrastructure.
    await request(app).get('/api/v1/notes').expect(401);
  });

  it('rejects a malformed request before reaching the unavailable database', async () => {
    await request(app).get('/api/v1/notes?colour=red').set('Authorization', auth).expect(422);
  });

  it('leaves the rest of the API working', async () => {
    // The whole justification for making MongoDB optional in development.
    await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', auth)
      .send({ title: 'Tasks are unaffected' })
      .expect(201);

    await request(app).get('/api/v1/projects').set('Authorization', auth).expect(200);
    await request(app).get('/health').expect(200);
  });
});
