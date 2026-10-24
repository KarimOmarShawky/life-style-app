import '../infrastructure-safety.js';
/**
 * tests/integration/users-flow.test.ts
 *
 * Implements Acceptance Tests:
 * - AC-AUTH-10: Middleware lifecycle enforcement (active, disabled, pending_deletion exemptions)
 * - AC-AUTH-11: User profile, devices, deletion scheduling/cancellation, and GDPR export
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';
import { getContainer } from '../../src/container.js';
import { PgUsersRepository } from '../../src/features/users/users.repository.pg.js';

describe('Users Flow Integration Tests', () => {
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

  async function registerUser(email = 'user@example.com') {
    const res = await request(app).post('/api/v1/auth/register').send({
      email,
      password: 'ValidUserPassword123!',
      displayName: 'Test User',
      timezone: 'UTC',
      defaultCurrency: 'USD'
    });
    return res.body.data;
  }

  it('AC-AUTH-11: GET /users/me returns authenticated user profile omitting password_hash', async () => {
    const { user, tokens } = await registerUser();

    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user).toBeDefined();
    expect(res.body.data.user.id).toBe(user.id);
    expect(res.body.data.user.email).toBe(user.email);
    expect(res.body.data.user.password_hash).toBeUndefined();
    expect(res.body.data.user.status).toBe('active');
  });

  it('AC-AUTH-11: PATCH /users/me updates profile settings', async () => {
    const { tokens } = await registerUser();

    const updatePayload = {
      displayName: 'Updated Name',
      timezone: 'Europe/Paris',
      locale: 'fr',
      weekStart: 7,
      defaultCurrency: 'EUR',
      pushShowTitles: false
    };

    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send(updatePayload);

    expect(res.status).toBe(200);
    expect(res.body.data.user.displayName).toBe('Updated Name');
    expect(res.body.data.user.timezone).toBe('Europe/Paris');
    expect(res.body.data.user.locale).toBe('fr');
    expect(res.body.data.user.weekStart).toBe(7);
    expect(res.body.data.user.defaultCurrency).toBe('EUR');
    expect(res.body.data.user.pushShowTitles).toBe(false);
  });

  it('AC-AUTH-11: PUT and DELETE /users/me/devices manages push device tokens', async () => {
    const { user, tokens } = await registerUser();

    // Register push device
    const regDevice = await request(app)
      .put('/api/v1/users/me/devices')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({
        pushToken: 'test-push-token-abc',
        platform: 'ios',
        appVersion: '1.0.0'
      });

    expect(regDevice.status).toBe(200);
    expect(regDevice.body.data.status).toBe('registered');

    const dbDevice = await pool.query('SELECT * FROM push_devices WHERE user_id = $1', [user.id]);
    expect(dbDevice.rows.length).toBe(1);
    const deviceId = dbDevice.rows[0].id;

    // Delete device
    const delDevice = await request(app)
      .delete(`/api/v1/users/me/devices/${deviceId}`)
      .set('Authorization', `Bearer ${tokens.accessToken}`);

    expect(delDevice.status).toBe(204);

    const dbDeviceAfter = await pool.query('SELECT * FROM push_devices WHERE id = $1', [deviceId]);
    expect(dbDeviceAfter.rows.length).toBe(0);

    // Deleting unknown device returns 404
    const delNotFound = await request(app)
      .delete(`/api/v1/users/me/devices/${deviceId}`)
      .set('Authorization', `Bearer ${tokens.accessToken}`);

    expect(delNotFound.status).toBe(404);
  });

  it('AC-AUTH-11: POST /users/me/export returns comprehensive GDPR export payload', async () => {
    const { user, tokens } = await registerUser();

    const res = await request(app)
      .post('/api/v1/users/me/export')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ currentPassword: 'ValidUserPassword123!' });

    expect(res.status).toBe(200);
    expect(res.body.exportedAt).toBeDefined();
    expect(res.body.profile.id).toBe(user.id);
    expect(res.body.profile.email).toBe(user.email);
    expect(Array.isArray(res.body.sessions)).toBe(true);
    expect(Array.isArray(res.body.categories)).toBe(true);
    expect(Array.isArray(res.body.pushDevices)).toBe(true);
  });

  it('AC-AUTH-10 & AC-AUTH-11: Deletion schedule, cancellation, and pending_deletion endpoint restrictions', async () => {
    const { tokens } = await registerUser();

    // 1. Request deletion (starts 14-day grace period)
    const delReq = await request(app)
      .post('/api/v1/users/me/deletion')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ currentPassword: 'ValidUserPassword123!' });

    expect(delReq.status).toBe(202);
    expect(delReq.body.data.status).toBe('pending_deletion');
    expect(delReq.body.data.deletionScheduledFor).toBeDefined();

    // 2. Normal mutating endpoints should now be blocked with 403 ACCOUNT_PENDING_DELETION
    const patchBlocked = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ displayName: 'Blocked Name' });

    expect(patchBlocked.status).toBe(403);
    expect(patchBlocked.body.error.code).toBe('ACCOUNT_PENDING_DELETION');

    // 3. Exempt endpoints: GET /users/me, POST /users/me/export are allowed
    const meAllowed = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`);

    expect(meAllowed.status).toBe(200);
    expect(meAllowed.body.data.user.status).toBe('pending_deletion');

    const exportAllowed = await request(app)
      .post('/api/v1/users/me/export')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ currentPassword: 'ValidUserPassword123!' });

    expect(exportAllowed.status).toBe(200);

    // 4. Cancel deletion
    const cancelRes = await request(app)
      .delete('/api/v1/users/me/deletion')
      .set('Authorization', `Bearer ${tokens.accessToken}`);

    expect(cancelRes.status).toBe(204);
    expect(cancelRes.text).toBe('');

    // 5. Now normal mutating endpoints should work again
    const patchAllowed = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ displayName: 'Unblocked Name' });

    expect(patchAllowed.status).toBe(200);
    expect(patchAllowed.body.data.user.displayName).toBe('Unblocked Name');
  });

  it('AC-AUTH-10: Disabled account is blocked with 403 ACCOUNT_DISABLED', async () => {
    const { user, tokens } = await registerUser();

    // Administratively disable account in DB
    await pool.query("UPDATE users SET status = 'disabled' WHERE id = $1", [user.id]);

    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('domain archive endpoint remains available with current-password proof during the deletion grace period', async () => {
    const { tokens } = await registerUser('archive-grace@example.test');
    const deletion = await request(app)
      .post('/api/v1/users/me/deletion')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ currentPassword: 'ValidUserPassword123!' });
    expect(deletion.status).toBe(202);
    const archive = await request(app)
      .post('/api/v1/users/me/export/archive')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ currentPassword: 'ValidUserPassword123!' });
    expect(archive.status).toBe(200);
    const frames = archive.text
      .trimEnd()
      .split('\n')
      .map((line: string) => JSON.parse(line));
    expect(frames[0]).toMatchObject({ type: 'manifest', version: 1 });
    expect(frames.at(-1)).toMatchObject({ type: 'complete' });
    expect(
      frames.find((frame: { section?: string }) => frame.section === 'profile').data.status
    ).toBe('pending_deletion');
  });

  it('B-07: Purges expired pending_deletion account with categories/transactions without touching other users', async () => {
    const { user: userA, tokens: tokensA } = await registerUser('purge-a@example.com');
    const { user: userB, tokens: tokensB } = await registerUser('purge-b@example.com');

    // Create category + transaction for both users (exercises ON DELETE RESTRICT on categories)
    const catARes = await request(app)
      .post('/api/v1/money/categories')
      .set('Authorization', `Bearer ${tokensA.accessToken}`)
      .send({ kind: 'expense', name: 'Groceries' });
    expect(catARes.status).toBe(201);

    const txARes = await request(app)
      .post('/api/v1/money/transactions')
      .set('Authorization', `Bearer ${tokensA.accessToken}`)
      .set('Idempotency-Key', '00000000-0000-4000-8000-000000000001')
      .send({
        kind: 'expense',
        amount: '45.00',
        currency: 'USD',
        occurredOn: '2026-01-15',
        categoryId: catARes.body.data.category.id
      });
    expect(txARes.status).toBe(201);

    const catBRes = await request(app)
      .post('/api/v1/money/categories')
      .set('Authorization', `Bearer ${tokensB.accessToken}`)
      .send({ kind: 'expense', name: 'Rent' });
    expect(catBRes.status).toBe(201);

    // Schedule deletion for userA; second HTTP request is blocked by pending_deletion guard
    const sched1 = await request(app)
      .post('/api/v1/users/me/deletion')
      .set('Authorization', `Bearer ${tokensA.accessToken}`)
      .send({ currentPassword: 'ValidUserPassword123!' });
    const sched2 = await request(app)
      .post('/api/v1/users/me/deletion')
      .set('Authorization', `Bearer ${tokensA.accessToken}`)
      .send({ currentPassword: 'ValidUserPassword123!' });
    expect(sched1.status).toBe(202);
    expect(sched2.status).toBe(403);
    expect(sched2.body.error.code).toBe('ACCOUNT_PENDING_DELETION');

    // Expire userA's grace window and run purge
    await pool.query(
      `UPDATE users SET deletion_scheduled_for = now() - interval '1 hour' WHERE id = $1`,
      [userA.id]
    );
    const repo = new PgUsersRepository(pool);
    const purgedCount = await repo.purgeExpiredAccounts(new Date());
    expect(purgedCount).toBe(1);

    // Repeated purge is idempotent
    expect(await repo.purgeAccount(userA.id)).toBe(false);

    // userA and all owned rows are gone; userB remains intact
    const remA = await pool.query('SELECT count(*)::int AS cnt FROM users WHERE id = $1', [
      userA.id
    ]);
    expect(remA.rows[0]?.cnt).toBe(0);

    const remACats = await pool.query(
      'SELECT count(*)::int AS cnt FROM categories WHERE user_id = $1',
      [userA.id]
    );
    expect(remACats.rows[0]?.cnt).toBe(0);

    const remB = await pool.query(
      'SELECT count(*)::int AS cnt FROM categories WHERE user_id = $1 AND id = $2',
      [userB.id, catBRes.body.data.category.id]
    );
    expect(remB.rows[0]?.cnt).toBe(1);
  });
});
