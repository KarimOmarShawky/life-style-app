/**
 * tests/integration/timer-without-task.test.ts
 *
 * Focus sessions can be saved without a task. A task id that is given must still belong to the user.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';
import { getContainer } from '../../src/container.js';

describe('Timer sessions without a task', () => {
  const app = createApp();
  const pool = getPgPool();
  const redis = getRedisClient();

  beforeEach(async () => {
    await pool.query('DELETE FROM users');
    await redis.flushdb();
    const container = getContainer();
    if ('clear' in container.rateLimiter && typeof container.rateLimiter.clear === 'function') {
      container.rateLimiter.clear();
    }
  });

  async function registerUser(email = 'focus-user@example.com') {
    const res = await request(app).post('/api/v1/auth/register').send({
      email,
      password: 'ValidUserPassword123!',
      displayName: 'Focus User',
      timezone: 'UTC',
      defaultCurrency: 'EGP'
    });
    return res.body;
  }

  it('starts and stops a session with no taskId, returning taskId as null', async () => {
    const { tokens } = await registerUser();

    const started = await request(app)
      .post('/api/v1/timer-sessions')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ mode: 'stopwatch' });
    expect(started.status).toBe(201);
    expect(started.body.timerSession.taskId).toBeNull();

    const stopped = await request(app)
      .post(`/api/v1/timer-sessions/${started.body.timerSession.id}/stop`)
      .set('Authorization', `Bearer ${tokens.accessToken}`);
    expect(stopped.status).toBe(200);
    expect(stopped.body.timerSession.endReason).toBe('stopped');
  });

  it('accepts an explicit null taskId', async () => {
    const { tokens } = await registerUser();

    const started = await request(app)
      .post('/api/v1/timer-sessions')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ taskId: null, mode: 'stopwatch' });
    expect(started.status).toBe(201);
    expect(started.body.timerSession.taskId).toBeNull();
  });

  it('still rejects a taskId that does not exist for this user', async () => {
    const { tokens } = await registerUser();

    const res = await request(app)
      .post('/api/v1/timer-sessions')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ taskId: '99999999-9999-4999-8999-999999999999', mode: 'stopwatch' });
    expect(res.status).toBe(404);
  });

  it('still rejects a malformed taskId', async () => {
    const { tokens } = await registerUser();

    const res = await request(app)
      .post('/api/v1/timer-sessions')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ taskId: 'not-a-uuid', mode: 'stopwatch' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
