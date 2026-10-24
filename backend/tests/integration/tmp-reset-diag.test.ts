import '../infrastructure-safety.js';
/**
 * TEMPORARY diagnostic suite — remove before merge.
 *
 * Calls each step of the password-reset delivery path directly and reports the
 * first failure, so the CI annotation shows the real error instead of
 * "got object".
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { getContainer } from '../../src/container.js';
import { createApp } from '../../src/app.js';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';

const describeError = (error: unknown): string => {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
};

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

  it('DIAG: each reset delivery step in isolation', async () => {
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

    const step = async (name: string, fn: () => Promise<unknown>) => {
      try {
        const value = await fn();
        diag[name] = value === undefined ? 'undefined' : JSON.stringify(value)?.slice(0, 200);
      } catch (error) {
        diag[name] = `THREW ${describeError(error)}`;
      }
    };

    await step('findUserByEmail', async () => service.repo.findUserByEmail('diag@example.com'));
    await step('findUserByEmailMissing', async () => service.repo.findUserByEmail('nobody@example.com'));
    await step('checkCooldown', async () => service.otpStore.checkCooldown(userId));
    await step('generateAndStoreCode', async () => service.otpStore.generateAndStoreCode(userId));
    await step('redisDirect', async () => (await redis.get(`pwreset:${userId}`)) ?? 'NULL');
    await step('emailSender', async () => {
      await service.emailSender.sendPasswordResetEmail('diag@example.com', '000000');
      return 'sent';
    });
    await step('processDirect', async () => {
      await service.resetProcessor.process('diag@example.com', { requestId: 'diag-1' });
      return 'ok';
    });
    await step('processUnknown', async () => {
      await service.resetProcessor.process('ghost-diag@example.com', { requestId: 'diag-2' });
      return 'ok';
    });

    const rows = await pool.query(
      `SELECT email, status, attempts, last_error_code FROM password_reset_requests
        WHERE email LIKE '%diag%' ORDER BY created_at`
    );
    diag.rows = rows.rows;
    diag.redisKeys = await redis.keys('pwreset*');

    const message = JSON.stringify(diag);
    expect(message, message).toBe('DIAG');
  });
});
