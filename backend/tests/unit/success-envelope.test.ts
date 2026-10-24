import { describe, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { successEnvelopeMiddleware } from '../../src/core/middleware/success-envelope.js';

describe('v1 success envelope middleware', () => {
  const app = express();
  app.use('/api/v1', successEnvelopeMiddleware);
  app.get('/api/v1/resource', (_req, res) => res.json({ item: { id: '123' } }));
  app.get('/api/v1/already-wrapped', (_req, res) =>
    res.json({ success: true, data: { item: { id: '123' } } })
  );
  app.get('/api/v1/paginated', (_req, res) =>
    res.json({ data: [{ id: '123' }], meta: { limit: 25, hasMore: false, nextCursor: null } })
  );
  app.get('/api/v1/users/me/export', (_req, res) => res.json({ rows: [] }));
  app.get('/health/live', (_req, res) => res.json({ status: 'ok' }));

  it('wraps ordinary v1 JSON success payloads exactly once', async () => {
    await request(app)
      .get('/api/v1/resource')
      .expect(200, { success: true, data: { item: { id: '123' } } });
    await request(app)
      .get('/api/v1/already-wrapped')
      .expect(200, { success: true, data: { item: { id: '123' } } });
    await request(app)
      .get('/api/v1/paginated')
      .expect(200, {
        success: true,
        data: [{ id: '123' }],
        meta: { limit: 25, hasMore: false, nextCursor: null }
      });
  });

  it('leaves account export and health responses unwrapped', async () => {
    await request(app).get('/api/v1/users/me/export').expect(200, { rows: [] });
    await request(app).get('/health/live').expect(200, { status: 'ok' });
  });
});
