import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import {
  retiredIngestGuard,
  retiredMoneyGuard
} from '../../src/core/middleware/retired-money-features.js';

describe('retired wallet and money HTTP boundary', () => {
  const setup = () => {
    const next = vi.fn((_req: Request, res: Response) => res.status(204).end());
    const app = express();
    app.use('/money', retiredMoneyGuard, next);
    app.use('/ingest', retiredIngestGuard, next);
    return { app, next };
  };

  it.each([
    ['get', '/money/budgets'],
    ['post', '/money/transactions'],
    ['post', '/money/wallet/transactions'],
    ['get', '/money/categories'],
    ['get', '/money/reports/summary'],
    ['post', '/money/subscriptions/123/pay'],
    ['post', '/ingest/token'],
    ['post', '/ingest/transactions'],
    ['post', '/ingest/wallet/transactions'],
    ['post', '/ingest/sms/analyze'],
    ['post', '/ingest/wallet/sms/analyze']
  ] as const)('blocks %s %s before downstream handlers', async (method, path) => {
    const { app, next } = setup();
    const response = await request(app)[method](path);
    expect(response.status).toBe(410);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.error.code).toBe('FEATURE_RETIRED');
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ['get', '/money/subscriptions'],
    ['post', '/money/subscriptions'],
    ['get', '/money/subscriptions/123'],
    ['patch', '/money/subscriptions/123'],
    ['delete', '/money/subscriptions/123'],
    ['delete', '/ingest/token']
  ] as const)('allows %s %s to reach authenticated handlers', async (method, path) => {
    const { app, next } = setup();
    const response = await request(app)[method](path);
    expect(response.status).toBe(204);
    expect(next).toHaveBeenCalledOnce();
  });
});
