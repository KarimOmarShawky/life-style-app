import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { IngestController } from '../../src/features/ingest/ingest.controller.js';
import type { IngestService } from '../../src/features/ingest/ingest.service.js';

const accountId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('wallet ingest token issuance account binding', () => {
  it('returns the authenticated owner together with the session-bound token', async () => {
    const issueForSession = vi.fn().mockResolvedValue('lsi_test');
    const controller = new IngestController({ issueForSession } as unknown as IngestService);
    const app = express();
    const auth: RequestHandler = (req, _res, next) => {
      req.user = { id: accountId } as NonNullable<typeof req.user>;
      req.sessionId = sessionId;
      next();
    };
    app.post('/token', auth, controller.issueToken);
    const response = await request(app)
      .post('/token')
      .send({ ownerId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' });
    expect(response.status).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({ token: 'lsi_test', ownerId: accountId });
    expect(issueForSession).toHaveBeenCalledWith(accountId, sessionId);
  });
});
