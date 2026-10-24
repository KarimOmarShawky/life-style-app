import '../infrastructure-safety.js';
/**
 * TEMPORARY diagnostic suite — remove before merge.
 *
 * Wraps the reset processor with a spy so the HTTP-path error is reported in
 * the CI annotation instead of the coarse DELIVERY_FAILED code.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { getContainer } from '../../src/container.js';
import { createApp } from '../../src/app.js';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';

describe('TEMP reset diagnostics', () => {
  const app = createApp();
  const pool = getPgPool();
  const redis = getRedisClient();

  beforeEach(async () => {
    await getContainer().authService.waitForResetRequests();
    await pool.query('DELETE FROM users');
    await redis.flushdb();
  });

  afterEach(async () => {
    await getContainer().authService.waitForResetRequests();
  });

  it('DIAG: error thrown on the HTTP reset path', async () => {
    const regRes = await request(app).post('/api/v1/auth/register').send({
      email: 'diag@example.com',
      password: 'DiagPassword123!',
      displayName: 'Diag',
      timezone: 'UTC',
      defaultCurrency: 'GBP'
    });
    const userId = regRes.body?.data?.user?.id as string;
    const service = getContainer().authService as unknown as Record<string, any>;
    const diag: Record<string, unknown> = { userId };

    const processor = service.resetProcessor;
    const original = processor.process.bind(processor);
    processor.process = async (email: string, meta: unknown) => {
      diag.processCalled = true;
      diag.processMeta = JSON.stringify(meta);
      try {
        const result = await original(email, meta as never);
        diag.processResult = 'resolved';
        return result;
      } catch (error) {
        const err = error as Error;
        diag.processError = `${err?.name}: ${err?.message}`;
        diag.processStack = String(err?.stack ?? '').split('\n').slice(1, 5).join(' | ');
        throw error;
      }
    };

    const forgotRes = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'diag@example.com' });
    diag.forgotStatus = forgotRes.status;
    diag.requestId = forgotRes.headers['x-request-id'];

    await getContainer().authService.waitForResetRequests();
    diag.redisKeys = await redis.keys('pwreset*');
    diag.redisValue = (await redis.get(`pwreset:${userId}`)) ?? 'NULL';

    const rows = await pool.query(
      `SELECT email, status, attempts, last_error_code FROM password_reset_requests
        WHERE email = 'diag@example.com' ORDER BY created_at`
    );
    diag.rows = rows.rows;

    const message = JSON.stringify(diag);
    expect(message, message).toBe('DIAG');
  });
});
