import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { enforceJsonContentType } from '../../src/core/middleware/security.js';
import { globalErrorHandler } from '../../src/core/middleware/error-handler.js';

// Real HTTP middleware, owned synthetic buffers only. No database, Redis,
// provider or filesystem upload is contacted. Not an end-to-end/DLP proof.
function fixture() {
  const app = express();
  const handler = vi.fn((_req: express.Request, res: express.Response) => {
    res.status(200).json({ accepted: true });
  });
  app.use(express.json({ limit: '100kb' }));
  app.use(enforceJsonContentType);
  app.all('/boundary', handler);
  app.use(globalErrorHandler);
  return { app, handler };
}

describe('JSON-only server upload boundary', () => {
  for (const method of ['post', 'put', 'patch'] as const) {
    for (const mediaType of [
      'multipart/form-data; boundary=synthetic-boundary',
      'audio/mpeg',
      'application/octet-stream'
    ]) {
      it(`${method} rejects ${mediaType} before the endpoint handler`, async () => {
        const { app, handler } = fixture();
        const response = await request(app)
          [method]('/boundary')
          .set('Content-Type', mediaType)
          .send(Buffer.from('synthetic-audio-bytes-not-a-user-file'));
        expect(response.status).toBe(415);
        expect(handler).not.toHaveBeenCalled();
      });
    }
    it(`${method} still accepts ordinary structured JSON`, async () => {
      const { app, handler } = fixture();
      const response = await request(app)[method]('/boundary').send({ title: 'synthetic' });
      expect(response.status).toBe(200);
      expect(handler).toHaveBeenCalledTimes(1);
    });
  }

  it('rejects an oversized JSON body before the endpoint handler', async () => {
    const { app, handler } = fixture();
    const response = await request(app)
      .post('/boundary')
      .send({ title: 'x'.repeat(101 * 1024) });
    expect(response.status).toBe(413);
    expect(handler).not.toHaveBeenCalled();
  });
});
