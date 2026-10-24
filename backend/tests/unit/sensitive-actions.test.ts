import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { UsersService } from '../../src/features/users/users.service.js';
import { UsersController } from '../../src/features/users/users.controller.js';
import { createUsersRouter } from '../../src/features/users/users.routes.js';
import {
  MemoryRateLimiter,
  RedisRateLimiter,
  type RateLimiter
} from '../../src/core/middleware/rate-limiter.js';
import { globalErrorHandler } from '../../src/core/middleware/error-handler.js';
import { AppError } from '../../src/core/errors/app-error.js';

function fixture(authenticated = true, rateLimiter: RateLimiter = new MemoryRateLimiter()) {
  const repo = {
    getUserProfile: vi.fn(async () => ({ id: 'user-a', password_hash: 'hash-a' })),
    getUserExportData: vi.fn(async () => ({ profile: { id: 'user-a' } })),
    scheduleDeletion: vi.fn(async () => new Date('2026-11-01T00:00:00Z'))
  };
  const hasher = {
    verify: vi.fn(
      async (password: string, hash: string) => password === 'Correct!12345' && hash === 'hash-a'
    ),
    dummyVerify: vi.fn(async () => false)
  };
  const service = new UsersService(repo as never, { log: vi.fn() } as never, hasher as never);
  const app = express();
  app.use(express.json());
  app.use(
    '/users',
    createUsersRouter({
      controller: new UsersController(service),
      rateLimiter,
      authenticate: (req, _res, next) => {
        if (!authenticated) return next(AppError.unauthenticated());
        req.user = {
          id: 'user-a',
          timezone: 'UTC',
          email: 'a@example.com',
          status: 'active',
          locale: 'en',
          weekStart: 1,
          defaultCurrency: 'USD',
          pushShowTitles: false
        };
        req.sessionId = 'session-a';
        next();
      }
    })
  );
  app.use(globalErrorHandler);
  return { app, repo, hasher };
}

describe('B-18 sensitive action reauthentication', () => {
  for (const action of ['export', 'deletion']) {
    it(`${action}: requires authenticated user and current password`, async () => {
      const { app, repo, hasher } = fixture();
      expect((await request(app).post(`/users/me/${action}`).send({})).status).toBe(400);
      expect(
        (await request(app).post(`/users/me/${action}`).send({ currentPassword: 'wrong' })).status
      ).toBe(403);
      expect(repo.getUserExportData).not.toHaveBeenCalled();
      expect(repo.scheduleDeletion).not.toHaveBeenCalled();
      const response = await request(app)
        .post(`/users/me/${action}`)
        .send({ currentPassword: 'Correct!12345' });
      expect(response.status).toBe(action === 'deletion' ? 202 : 200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(repo.getUserProfile).toHaveBeenCalledWith('user-a');
      expect(hasher.verify).toHaveBeenCalledWith('Correct!12345', 'hash-a');
      expect(JSON.stringify(response.body)).not.toContain('Correct!12345');
      const unauthenticated = fixture(false);
      expect(
        (
          await request(unauthenticated.app)
            .post(`/users/me/${action}`)
            .send({ currentPassword: 'Correct!12345' })
        ).status
      ).toBe(401);
      expect(unauthenticated.hasher.verify).not.toHaveBeenCalled();
    });
  }
  it('bounds expensive guesses across both actions with a shared per-user limiter', async () => {
    const { app, hasher } = fixture();
    for (let i = 0; i < 5; i++) {
      expect(
        (
          await request(app)
            .post(`/users/me/${i % 2 ? 'export' : 'deletion'}`)
            .send({ currentPassword: 'wrong' })
        ).status
      ).toBe(403);
    }
    expect(
      (await request(app).post('/users/me/export').send({ currentPassword: 'Correct!12345' }))
        .status
    ).toBe(429);
    expect(hasher.verify).toHaveBeenCalledTimes(5);
  });
  for (const action of ['export', 'deletion']) {
    it(`${action}: a Redis outage rejects before proof verification or data mutation`, async () => {
      const redis = {
        eval: vi.fn(async () => {
          throw new Error('provider credential');
        })
      };
      const { app, repo, hasher } = fixture(true, new RedisRateLimiter(redis as unknown as Redis));
      const response = await request(app)
        .post(`/users/me/${action}`)
        .send({ currentPassword: 'Correct!12345' });
      expect(response.status).toBe(503);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.text).not.toContain('provider credential');
      expect(hasher.verify).not.toHaveBeenCalled();
      expect(repo.getUserProfile).not.toHaveBeenCalled();
      expect(repo.getUserExportData).not.toHaveBeenCalled();
      expect(repo.scheduleDeletion).not.toHaveBeenCalled();
    });
  }
  it('does not allow extra identity fields to select another account', async () => {
    const { app, repo } = fixture();
    const response = await request(app)
      .post('/users/me/export')
      .send({ currentPassword: 'Correct!12345', userId: 'user-b' });
    expect(response.status).toBe(400);
    expect(repo.getUserProfile).not.toHaveBeenCalled();
  });
});
