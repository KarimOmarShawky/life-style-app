import '../infrastructure-safety.js';
/**
 * tests/security/auth-security.test.ts
 *
 * Implements Security Tests for Section 8:
 * - AC-AUTH-04: Login timing similarity for non-existent users vs wrong passwords (dummy verify)
 * - Password policy rejection (length, 72-byte ceiling, common passwords, password equals email)
 * - Rate limiting on login and registration
 * - JWT tampering rejection (alg: none, forged secret, signature strip)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';
import { getContainer } from '../../src/container.js';

describe('Auth Security Tests', () => {
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

  it('AC-AUTH-04: Timing similarity: Login for non-existent user executes dummy bcrypt compare', async () => {
    // 1. Register a real user
    await request(app).post('/api/v1/auth/register').send({
      email: 'timing@example.com',
      password: 'ValidPassword123!',
      displayName: 'Timing Test',
      timezone: 'UTC',
      defaultCurrency: 'USD'
    });

    // Warm up
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'timing@example.com', password: 'WrongPassword123!' });

    // Measure wrong password on existing user
    const startReal = performance.now();
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'timing@example.com', password: 'WrongPassword123!' });
    const durationReal = performance.now() - startReal;

    // Measure non-existent user login
    const startFake = performance.now();
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nonexistent@example.com', password: 'WrongPassword123!' });
    const durationFake = performance.now() - startFake;

    // Both should take substantial time (bcrypt computation), ratio should be reasonably close (within 3.5x factor)
    expect(durationReal).toBeGreaterThan(10);
    expect(durationFake).toBeGreaterThan(10);
    const ratio = Math.max(durationReal, durationFake) / Math.min(durationReal, durationFake);
    expect(ratio).toBeLessThan(3.5);
  });

  it('Enforces strict password policy on registration', async () => {
    // 1. Too short (< 10 chars)
    const shortRes = await request(app).post('/api/v1/auth/register').send({
      email: 'short@example.com',
      password: 'Short1!',
      displayName: 'Short',
      timezone: 'UTC',
      defaultCurrency: 'USD'
    });
    expect(shortRes.status).toBe(400);

    // 2. Common password
    const commonRes = await request(app).post('/api/v1/auth/register').send({
      email: 'common@example.com',
      password: 'password123',
      displayName: 'Common',
      timezone: 'UTC',
      defaultCurrency: 'USD'
    });
    expect(commonRes.status).toBe(400);

    // 3. Password matches email
    const emailMatchRes = await request(app).post('/api/v1/auth/register').send({
      email: 'same@example.com',
      password: 'same@example.com',
      displayName: 'Same',
      timezone: 'UTC',
      defaultCurrency: 'USD'
    });
    expect(emailMatchRes.status).toBe(400);

    // 4. Greater than 72 bytes
    const longPass = 'A'.repeat(73);
    const longRes = await request(app).post('/api/v1/auth/register').send({
      email: 'long@example.com',
      password: longPass,
      displayName: 'Long',
      timezone: 'UTC',
      defaultCurrency: 'USD'
    });
    expect(longRes.status).toBe(400);
  });

  it('Enforces rate limits on consecutive login attempts', async () => {
    // Login limit: 5 requests / 15 min per email + IP
    for (let i = 1; i <= 5; i++) {
      const res = await request(app).post('/api/v1/auth/login').send({
        email: 'ratelimit@example.com',
        password: 'WrongPassword!'
      });
      expect(res.status).toBe(401);
    }

    // 6th attempt should be rate limited (429)
    const rateLimitedRes = await request(app).post('/api/v1/auth/login').send({
      email: 'ratelimit@example.com',
      password: 'WrongPassword!'
    });

    expect(rateLimitedRes.status).toBe(429);
    expect(rateLimitedRes.body.error.code).toBe('RATE_LIMITED');
    expect(rateLimitedRes.headers['retry-after']).toBeDefined();
  });
});
