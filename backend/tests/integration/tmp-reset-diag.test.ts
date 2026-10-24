import '../infrastructure-safety.js';
/**
 * TEMPORARY diagnostic suite — remove before merge.
 *
 * Dumps the durable password-reset row and the Redis OTP state right after the
 * same drain the failing assertion relies on, so the CI annotation shows what
 * actually happened instead of "got object".
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

  it('DIAG: durable row and redis state after forgot-password', async () => {
    const regRes = await request(app).post('/api/v1/auth/register').send({
      email: 'diag@example.com',
      password: 'DiagPassword123!',
      displayName: 'Diag',
      timezone: 'UTC',
      defaultCurrency: 'GBP'
    });
    const userId = regRes.body?.data?.user?.id;

    await request(app).post('/api/v1/auth/forgot-password').send({ email: 'diag@example.com' });
    await getContainer().authService.waitForResetRequests();

    const rows = await pool.query(
      `SELECT email, status, attempts, last_error_code,
              next_attempt_at, lease_expires_at, completed_at
         FROM password_reset_requests ORDER BY created_at`
    );
    const keys = await redis.keys('pwreset*');
    const raw = await redis.get(`pwreset:${userId}`);
    const diag = JSON.stringify({
      userId,
      rowCount: rows.rows.length,
      rows: rows.rows,
      redisKeys: keys,
      rawType: typeof raw,
      rawIsNull: raw === null,
      rawSample: typeof raw === 'string' ? raw.slice(0, 12) : String(raw),
      counts: getContainer().authService.resetRequestCounts()
    });
    expect(diag, diag).toBe('DIAG');
  });
});
