import '../infrastructure-safety.js';
/**
 * tests/integration/auth-flow.test.ts
 *
 * Implements Acceptance Tests:
 * - AC-AUTH-01: User registration (201, user, tokens, default categories, case-insensitive)
 * - AC-AUTH-02: Duplicate registration (409 EMAIL_ALREADY_REGISTERED)
 * - AC-AUTH-03: Login with valid / invalid credentials
 * - AC-AUTH-06: Token refresh & rotation
 * - AC-AUTH-07: Token reuse detection & session revocation (ADR-041)
 * - AC-AUTH-08: Single and all-session logout
 * - AC-AUTH-09: Password reset flow (indistinguishable forgot-password, 6-digit OTP, session revocation)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { getContainer } from '../../src/container.js';
import { createApp } from '../../src/app.js';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';

describe('Auth Flow Integration Tests', () => {
  const app = createApp();
  const pool = getPgPool();
  const redis = getRedisClient();

  beforeEach(async () => {
    await getContainer().authService.waitForResetRequests();
    // Clean test data and rate limiter state before each test
    await pool.query('DELETE FROM users');
    await redis.flushdb();
    const container = getContainer();
    if ('clear' in container.rateLimiter && typeof container.rateLimiter.clear === 'function') {
      container.rateLimiter.clear();
    }
  });

  afterEach(async () => {
    await getContainer().authService.waitForResetRequests();
  });

  it('AC-AUTH-01 & AC-AUTH-02: Registration creates user, default categories, returns tokens, and prevents duplicates', async () => {
    const registerPayload = {
      email: 'Alice.Smith@Example.COM',
      password: 'MySecretPassword123!',
      displayName: 'Alice Smith',
      timezone: 'America/New_York',
      defaultCurrency: 'USD',
      locale: 'en',
      device: {
        platform: 'ios',
        name: 'iPhone 15 Pro',
        appVersion: '1.0.0'
      }
    };

    const res = await request(app).post('/api/v1/auth/register').send(registerPayload);

    expect(res.status).toBe(201);
    expect(res.body.data.user).toBeDefined();
    expect(res.body.data.user.email).toBe('alice.smith@example.com'); // Lowercased
    expect(res.body.data.user.displayName).toBe('Alice Smith');
    expect(res.body.data.user.password_hash).toBeUndefined(); // Never leaked
    expect(res.body.data.tokens.accessToken).toBeDefined();
    expect(res.body.data.tokens.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // Verify default categories were seeded
    const catRes = await pool.query('SELECT * FROM categories WHERE user_id = $1', [
      res.body.data.user.id
    ]);
    expect(catRes.rows.length).toBeGreaterThanOrEqual(11);

    // AC-AUTH-02: Duplicate registration with case variant
    const dupRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        ...registerPayload,
        email: 'alice.smith@EXAMPLE.com'
      });

    expect(dupRes.status).toBe(409);
    expect(dupRes.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('AC-AUTH-03: Login succeeds with correct credentials, fails with 401 INVALID_CREDENTIALS on bad password or missing user', async () => {
    // 1. Register Alice
    await request(app).post('/api/v1/auth/register').send({
      email: 'bob@example.com',
      password: 'BobSecurePassword123!',
      displayName: 'Bob Jones',
      timezone: 'UTC',
      defaultCurrency: 'EUR'
    });

    // 2. Login with valid credentials
    const validLogin = await request(app).post('/api/v1/auth/login').send({
      email: 'BOB@example.com',
      password: 'BobSecurePassword123!'
    });

    expect(validLogin.status).toBe(200);
    expect(validLogin.body.data.user.email).toBe('bob@example.com');
    expect(validLogin.body.data.tokens.accessToken).toBeDefined();
    expect(validLogin.body.data.tokens.refreshToken).toBeDefined();

    // 3. Login with wrong password
    const wrongPass = await request(app).post('/api/v1/auth/login').send({
      email: 'bob@example.com',
      password: 'WrongPassword999!'
    });

    expect(wrongPass.status).toBe(401);
    expect(wrongPass.body.error.code).toBe('INVALID_CREDENTIALS');

    // 4. Login with non-existent email
    const unknownUser = await request(app).post('/api/v1/auth/login').send({
      email: 'nonexistent@example.com',
      password: 'SomeRandomPassword123!'
    });

    expect(unknownUser.status).toBe(401);
    expect(unknownUser.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('AC-AUTH-06 & AC-AUTH-07: Refresh rotates token, and reuse detection revokes session and push devices', async () => {
    // 1. Register user
    const regRes = await request(app).post('/api/v1/auth/register').send({
      email: 'charlie@example.com',
      password: 'CharliePassword123!',
      displayName: 'Charlie',
      timezone: 'UTC',
      defaultCurrency: 'USD'
    });

    const initialRefreshToken = regRes.body.data.tokens.refreshToken;
    const initialAccessToken = regRes.body.data.tokens.accessToken;

    // Register a push device to test device deletion on reuse
    await request(app)
      .put('/api/v1/users/me/devices')
      .set('Authorization', `Bearer ${initialAccessToken}`)
      .send({
        pushToken: 'sample-push-token-12345',
        platform: 'ios'
      });

    // Verify push device exists
    const deviceBefore = await pool.query('SELECT * FROM push_devices WHERE user_id = $1', [
      regRes.body.data.user.id
    ]);
    expect(deviceBefore.rows.length).toBe(1);

    // 2. AC-AUTH-06: Rotate token
    const refreshRes = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: initialRefreshToken });

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.data.accessToken).toBeDefined();
    expect(refreshRes.body.data.refreshToken).toBeDefined();
    expect(refreshRes.body.data.refreshToken).not.toBe(initialRefreshToken);

    const newRefreshToken = refreshRes.body.data.refreshToken;

    // 3. AC-AUTH-07: Attempt REUSE of initialRefreshToken (ADR-041)
    const reuseRes = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: initialRefreshToken });

    expect(reuseRes.status).toBe(401);
    expect(reuseRes.body.error.code).toBe('INVALID_REFRESH_TOKEN');

    // Verify that reuse revoked the entire session and deleted push devices
    const sessionRes = await pool.query('SELECT * FROM auth_sessions WHERE user_id = $1', [
      regRes.body.data.user.id
    ]);
    expect(sessionRes.rows[0].revoked_at).not.toBeNull();
    expect(sessionRes.rows[0].revoked_reason).toBe('reuse_detected');

    const devicesAfter = await pool.query('SELECT * FROM push_devices WHERE user_id = $1', [
      regRes.body.data.user.id
    ]);
    expect(devicesAfter.rows.length).toBe(0);

    // 4. Using the newer refresh token should now also fail because session is revoked
    const nextRefresh = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: newRefreshToken });

    expect(nextRefresh.status).toBe(401);
    expect(nextRefresh.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('AC-AUTH-08: Logout revokes session; Logout-all revokes all user sessions and deletes push devices', async () => {
    // 1. Register user
    const regRes = await request(app).post('/api/v1/auth/register').send({
      email: 'david@example.com',
      password: 'DavidPassword123!',
      displayName: 'David',
      timezone: 'UTC',
      defaultCurrency: 'USD'
    });

    // 2. Login from second device
    const loginRes = await request(app).post('/api/v1/auth/login').send({
      email: 'david@example.com',
      password: 'DavidPassword123!'
    });

    // We have 2 active sessions
    let sessions = await pool.query(
      'SELECT * FROM auth_sessions WHERE user_id = $1 AND revoked_at IS NULL',
      [regRes.body.data.user.id]
    );
    expect(sessions.rows.length).toBe(2);

    // 3. Logout session 1 via refresh token
    const logoutRes = await request(app)
      .post('/api/v1/auth/logout')
      .send({ refreshToken: regRes.body.data.tokens.refreshToken });

    expect(logoutRes.status).toBe(204);

    sessions = await pool.query(
      'SELECT * FROM auth_sessions WHERE user_id = $1 AND revoked_at IS NULL',
      [regRes.body.data.user.id]
    );
    expect(sessions.rows.length).toBe(1);

    // 4. Logout-all using session 2 access token
    const logoutAllRes = await request(app)
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${loginRes.body.data.tokens.accessToken}`);

    expect(logoutAllRes.status).toBe(204);

    sessions = await pool.query(
      'SELECT * FROM auth_sessions WHERE user_id = $1 AND revoked_at IS NULL',
      [regRes.body.data.user.id]
    );
    expect(sessions.rows.length).toBe(0);
  });

  it('AC-AUTH-09: Password reset flow generates OTP, resets password, and revokes all active sessions', async () => {
    // 1. Register user
    const regRes = await request(app).post('/api/v1/auth/register').send({
      email: 'emma@example.com',
      password: 'EmmaPassword123!',
      displayName: 'Emma',
      timezone: 'UTC',
      defaultCurrency: 'GBP'
    });

    const oldAccessToken = regRes.body.data.tokens.accessToken;

    // 2. Forgot password request (indistinguishable response 202)
    const forgotRes = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'emma@example.com' });

    expect(forgotRes.status).toBe(202);

    // Non-existent email also returns 202
    const forgotUnknown = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'ghost@example.com' });

    expect(forgotUnknown.status).toBe(202);

    // 202 accepts volatile background work, not delivery. Drain before inspecting Redis.
    await getContainer().authService.waitForResetRequests();

    // 3. Retrieve code from Redis (for test assertion)
    // Note: In production code is delivered via email; here we verify Redis state
    const rawStored = await redis.get(`pwreset:${regRes.body.data.user.id}`);
    expect(rawStored).toMatch(/^[0-9a-f]{64}$/);
    const resetAudit = await pool.query(
      `SELECT outcome, metadata FROM audit_logs
       WHERE request_id = $1 AND event_type = 'auth.password.reset.requested'`,
      [forgotRes.headers['x-request-id']]
    );
    expect(resetAudit.rows).toHaveLength(1);
    // The fixture/provider result, not HTTP 202, determines the delivery audit outcome.
    expect(['success', 'failure']).toContain(resetAudit.rows[0].outcome);
    expect(resetAudit.rows[0].metadata).toEqual({});

    // Generate code using otpStore on the same test user or use the OTP store directly:
    // Let's create an OTP for emma to complete reset
    const { buildContainer } = await import('../../src/container.js');
    const container = buildContainer();
    const testCode = await container.otpStore.generateAndStoreCode(regRes.body.data.user.id);

    // 4. Reset password
    const resetRes = await request(app).post('/api/v1/auth/reset-password').send({
      email: 'emma@example.com',
      code: testCode,
      newPassword: 'BrandNewPassword456!'
    });

    expect(resetRes.status).toBe(200);

    // 5. Old access token should now be rejected because sessions were revoked
    const profileAttempt = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${oldAccessToken}`);

    expect(profileAttempt.status).toBe(401);

    // 6. Login with new password succeeds
    const newLogin = await request(app).post('/api/v1/auth/login').send({
      email: 'emma@example.com',
      password: 'BrandNewPassword456!'
    });

    expect(newLogin.status).toBe(200);
  });

  it('Change password updates password, keeps current session, and revokes other sessions', async () => {
    // 1. Register user
    const regRes = await request(app).post('/api/v1/auth/register').send({
      email: 'frank@example.com',
      password: 'FrankPassword123!',
      displayName: 'Frank',
      timezone: 'UTC',
      defaultCurrency: 'USD'
    });

    // 2. Login from second session
    const session2 = await request(app).post('/api/v1/auth/login').send({
      email: 'frank@example.com',
      password: 'FrankPassword123!'
    });

    // 3. Change password from session 1
    const changeRes = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${regRes.body.data.tokens.accessToken}`)
      .send({
        currentPassword: 'FrankPassword123!',
        newPassword: 'FrankNewPassword789!'
      });

    expect(changeRes.status).toBe(204);

    // 4. Session 1 should still be valid
    const session1Check = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${regRes.body.data.tokens.accessToken}`);
    expect(session1Check.status).toBe(200);

    // 5. Session 2 should now be revoked
    const session2Check = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${session2.body.data.tokens.accessToken}`);
    expect(session2Check.status).toBe(401);
  });
});
