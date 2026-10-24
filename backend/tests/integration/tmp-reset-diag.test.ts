import '../infrastructure-safety.js';
/**
 * TEMPORARY diagnostic suite — remove before merge.
 *
 * Spies on the durable claim and on the service step so the CI annotation shows
 * which link in the chain fails instead of the coarse DELIVERY_FAILED code.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { getContainer } from '../../src/container.js';
import { createApp } from '../../src/app.js';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';

const errText = (error: unknown): string => {
  const err = error as Error;
  return `${err?.name ?? 'unknown'}: ${err?.message ?? String(error)}`;
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

  it('DIAG: which link fails on the HTTP reset path', async () => {
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

    const dispatcher = service.resetRequests as Record<string, any>;
    diag.hasStore = Boolean(dispatcher?.store);
    if (dispatcher?.store) {
      const store = dispatcher.store as Record<string, any>;
      const originalClaim = store.claimById.bind(store);
      store.claimById = async (...args: unknown[]) => {
        diag.claimCalled = true;
        try {
          const claimed = await originalClaim(...(args as []));
          diag.claimResult = claimed ? 'claimed' : 'null';
          return claimed;
        } catch (error) {
          diag.claimError = errText(error);
          throw error;
        }
      };
      const originalClaimDue = store.claimDue.bind(store);
      store.claimDue = async (...args: unknown[]) => {
        diag.claimDueCalled = true;
        try {
          const claimed = await originalClaimDue(...(args as []));
          diag.claimDueCount = Array.isArray(claimed) ? claimed.length : 'not-array';
          return claimed;
        } catch (error) {
          diag.claimDueError = errText(error);
          throw error;
        }
      };
    }

    const processor = service.resetProcessor as Record<string, any>;
    if (processor) {
      const originalProcess = processor.process.bind(processor);
      processor.process = async (...args: unknown[]) => {
        diag.processCalled = true;
        try {
          return await originalProcess(...(args as []));
        } catch (error) {
          diag.processError = errText(error);
          throw error;
        }
      };
    } else {
      diag.processor = 'MISSING';
    }

    const originalStep = service.processPasswordResetRequest.bind(service);
    service.processPasswordResetRequest = async (...args: unknown[]) => {
      diag.stepCalled = true;
      try {
        return await originalStep(...(args as []));
      } catch (error) {
        diag.stepError = errText(error);
        throw error;
      }
    };

    await request(app).post('/api/v1/auth/forgot-password').send({ email: 'diag@example.com' });
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
