import '../infrastructure-safety.js';
/**
 * tests/integration/sessions-flow.test.ts
 *
 * Feature guide G6 (ADR-047) against migrated PostgreSQL: listing signed-in
 * devices and signing one out. Covers ownership (IDOR), the password check
 * and its shared budget, refresh/access/push cleanup, idempotency, expired
 * sessions, a revoke racing a refresh, the ADR-041 reuse-detection path,
 * export and account deletion, and that created_ip never reaches a response.
 * No production data is used.
 */

import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';
import { getContainer } from '../../src/container.js';
import { SESSIONS_USER_LIMIT } from '../../src/features/sessions/sessions.routes.js';
import { resetSessionRevokeReasonCache } from '../../src/features/sessions/sessions.repository.pg.js';
import { REAUTHENTICATION_LIMIT } from '../../src/core/middleware/reauthentication.js';

const PASSWORD = 'ValidUserPassword123!';

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

describe('Signed-in devices (G6) on PostgreSQL', () => {
  const app = createApp();
  const pool = getPgPool();
  const redis = getRedisClient();
  /** Every response body seen in a test, checked for leaked IP data at the end. */
  let seen: string[] = [];

  beforeEach(async () => {
    await pool.query('DELETE FROM users');
    await redis.flushdb();
    resetSessionRevokeReasonCache();
    seen = [];
    const container = getContainer();
    if ('clear' in container.rateLimiter && typeof container.rateLimiter.clear === 'function') {
      container.rateLimiter.clear();
    }
  });

  function record<T extends { text: string }>(res: T): T {
    seen.push(res.text);
    return res;
  }

  async function register(email: string): Promise<Tokens> {
    const res = record(
      await request(app)
        .post('/api/v1/auth/register')
        .send({
          email,
          password: PASSWORD,
          displayName: 'Devices User',
          timezone: 'Africa/Cairo',
          defaultCurrency: 'USD',
          device: { platform: 'android', name: 'Pixel 8', appVersion: '1.4.0' }
        })
    );
    expect(res.status).toBe(201);
    return res.body.data.tokens as Tokens;
  }

  async function login(email: string, deviceName = 'iPhone 15'): Promise<Tokens> {
    const res = record(
      await request(app)
        .post('/api/v1/auth/login')
        .send({
          email,
          password: PASSWORD,
          device: { platform: 'ios', name: deviceName, appVersion: '1.5.0' }
        })
    );
    expect(res.status).toBe(200);
    return res.body.data.tokens as Tokens;
  }

  const list = async (token: string) =>
    record(await request(app).get('/api/v1/sessions').set('Authorization', `Bearer ${token}`));

  const revoke = async (token: string, sessionId: string, currentPassword: unknown = PASSWORD) =>
    record(
      await request(app)
        .post(`/api/v1/sessions/${sessionId}/revoke`)
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword })
    );

  const refresh = async (refreshToken: string) =>
    record(await request(app).post('/api/v1/auth/refresh').send({ refreshToken }));

  const me = async (token: string) =>
    record(await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${token}`));

  async function currentSessionId(token: string): Promise<string> {
    const res = await list(token);
    expect(res.status).toBe(200);
    const current = (res.body.data.sessions as Array<{ id: string; current: boolean }>).find(
      (session) => session.current
    );
    expect(current).toBeDefined();
    return current!.id;
  }

  async function sessionRow(id: string) {
    const res = await pool.query<{
      revoked_at: Date | null;
      revoked_reason: string | null;
      created_ip: string | null;
    }>('SELECT revoked_at, revoked_reason, created_ip::text FROM auth_sessions WHERE id = $1', [
      id
    ]);
    return res.rows[0];
  }

  /** created_ip is stored, but no response in the test may contain it. */
  async function expectNoIpInResponses() {
    const ips = await pool.query<{ ip: string }>(
      'SELECT DISTINCT host(created_ip) AS ip FROM auth_sessions WHERE created_ip IS NOT NULL'
    );
    expect(ips.rows.length).toBeGreaterThan(0);
    for (const text of seen) {
      expect(text).not.toMatch(/created_?ip/i);
      for (const { ip } of ips.rows) {
        for (const form of new Set([ip, ip.replace(/^::ffff:/, '')])) {
          expect(text).not.toContain(form);
        }
      }
    }
  }

  it('lists this device first, with device metadata only and no caching', async () => {
    await register('list@example.com');
    const phone = await login('list@example.com');

    const res = await list(phone.accessToken);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const { sessions, truncated } = res.body.data as {
      sessions: Array<Record<string, unknown>>;
      truncated: boolean;
    };
    expect(truncated).toBe(false);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({
      devicePlatform: 'ios',
      deviceName: 'iPhone 15',
      appVersion: '1.5.0',
      current: true
    });
    expect(sessions[1]).toMatchObject({
      devicePlatform: 'android',
      deviceName: 'Pixel 8',
      appVersion: '1.4.0',
      current: false
    });
    for (const session of sessions) {
      expect(Object.keys(session).sort()).toEqual(
        [
          'appVersion',
          'createdAt',
          'current',
          'deviceName',
          'devicePlatform',
          'id',
          'lastUsedAt'
        ].sort()
      );
    }
    expect((await sessionRow(sessions[0]!.id as string))?.created_ip).not.toBeNull();
    expect(record(await request(app).get('/api/v1/sessions')).status).toBe(401);
    await expectNoIpInResponses();
  });

  it('signs out another device: its refresh token, access token and push device stop working', async () => {
    const laptop = await register('other@example.com');
    const phone = await login('other@example.com');
    const phoneSession = await currentSessionId(phone.accessToken);
    const device = record(
      await request(app)
        .put('/api/v1/users/me/devices')
        .set('Authorization', `Bearer ${phone.accessToken}`)
        .send({ platform: 'ios', pushToken: `push-${randomUUID()}`, appVersion: '1.5.0' })
    );
    expect(device.status).toBe(200);

    const res = await revoke(laptop.accessToken, phoneSession);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ revoked: true, current: false });

    expect((await me(phone.accessToken)).status).toBe(401);
    const refreshed = await refresh(phone.refreshToken);
    expect(refreshed.status).toBe(401);
    expect(refreshed.body.error.code).toBe('INVALID_REFRESH_TOKEN');
    expect(await sessionRow(phoneSession)).toMatchObject({ revoked_reason: 'user_revoked' });
    const tokens = await pool.query(
      'SELECT count(*)::int AS live FROM refresh_tokens WHERE session_id = $1 AND revoked_at IS NULL',
      [phoneSession]
    );
    expect(tokens.rows[0].live).toBe(0);
    const pushes = await pool.query(
      'SELECT count(*)::int AS n FROM push_devices WHERE session_id = $1',
      [phoneSession]
    );
    expect(pushes.rows[0].n).toBe(0);

    // The device that signed the other out keeps working, and the list shrinks.
    expect((await me(laptop.accessToken)).status).toBe(200);
    const after = await list(laptop.accessToken);
    expect(after.body.data.sessions).toHaveLength(1);
    expect(after.body.data.sessions[0].current).toBe(true);
    await expectNoIpInResponses();
  });

  it("answers other accounts' and unknown session ids with 404 and changes nothing", async () => {
    const owner = await register('owner@example.com');
    const ownerSession = await currentSessionId(owner.accessToken);
    await request(app)
      .put('/api/v1/users/me/devices')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ platform: 'android', pushToken: `push-${randomUUID()}` });
    const intruder = await register('intruder@example.com');

    const cross = await revoke(intruder.accessToken, ownerSession);
    expect(cross.status).toBe(404);
    expect(cross.body.error.code).toBe('NOT_FOUND');
    const unknown = await revoke(intruder.accessToken, randomUUID());
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('NOT_FOUND');
    expect(cross.body.error.message).toBe(unknown.body.error.message);
    expect((await revoke(intruder.accessToken, 'not-a-uuid')).status).toBe(400);

    expect(await sessionRow(ownerSession)).toMatchObject({
      revoked_at: null,
      revoked_reason: null
    });
    const pushes = await pool.query(
      'SELECT count(*)::int AS n FROM push_devices WHERE session_id = $1',
      [ownerSession]
    );
    expect(pushes.rows[0].n).toBe(1);
    expect((await me(owner.accessToken)).status).toBe(200);
    // The intruder's list never shows the owner's session.
    const intruderList = await list(intruder.accessToken);
    expect(JSON.stringify(intruderList.body)).not.toContain(ownerSession);
  });

  it('needs the current password, and wrong passwords revoke nothing', async () => {
    const laptop = await register('password@example.com');
    const phone = await login('password@example.com');
    const phoneSession = await currentSessionId(phone.accessToken);

    const wrong = await revoke(laptop.accessToken, phoneSession, 'NotThePassword123!');
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe('REAUTHENTICATION_FAILED');
    for (const body of [{}, { currentPassword: '' }, { currentPassword: PASSWORD, extra: true }]) {
      const res = record(
        await request(app)
          .post(`/api/v1/sessions/${phoneSession}/revoke`)
          .set('Authorization', `Bearer ${laptop.accessToken}`)
          .send(body)
      );
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(await sessionRow(phoneSession)).toMatchObject({ revoked_at: null });
    expect((await me(phone.accessToken)).status).toBe(200);
  });

  it('is idempotent, and ends an expired session that is no longer listed', async () => {
    const laptop = await register('repeat@example.com');
    const phone = await login('repeat@example.com');
    const tablet = await login('repeat@example.com', 'Galaxy Tab');
    const phoneSession = await currentSessionId(phone.accessToken);
    const tabletSession = await currentSessionId(tablet.accessToken);

    const first = await revoke(laptop.accessToken, phoneSession);
    const second = await revoke(laptop.accessToken, phoneSession);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.data).toEqual(first.body.data);
    expect(await sessionRow(phoneSession)).toMatchObject({ revoked_reason: 'user_revoked' });

    await pool.query(
      "UPDATE auth_sessions SET absolute_expires_at = now() - interval '1 minute' WHERE id = $1",
      [tabletSession]
    );
    const listed = await list(laptop.accessToken);
    expect(JSON.stringify(listed.body)).not.toContain(tabletSession);
    expect((await revoke(laptop.accessToken, tabletSession)).status).toBe(200);
    expect(await sessionRow(tabletSession)).toMatchObject({ revoked_reason: 'user_revoked' });
  });

  it('signing out this device ends it like logout', async () => {
    const phone = await register('self@example.com');
    const phoneSession = await currentSessionId(phone.accessToken);

    const res = await revoke(phone.accessToken, phoneSession);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ revoked: true, current: true });
    expect((await me(phone.accessToken)).status).toBe(401);
    expect((await refresh(phone.refreshToken)).status).toBe(401);
    // A later logout with the old tokens is harmless.
    const logout = record(
      await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${phone.accessToken}`)
        .send({ refreshToken: phone.refreshToken })
    );
    expect(logout.status).toBeLessThan(500);
    expect(await sessionRow(phoneSession)).toMatchObject({ revoked_reason: 'user_revoked' });
  });

  it('leaves no working token when a revoke races a refresh of the same session', async () => {
    for (let round = 0; round < 3; round += 1) {
      await pool.query('DELETE FROM users');
      await redis.flushdb();
      const laptop = await register(`race${round}@example.com`);
      const phone = await login(`race${round}@example.com`);
      const phoneSession = await currentSessionId(phone.accessToken);

      const [revoked, refreshed] = await Promise.all([
        revoke(laptop.accessToken, phoneSession),
        refresh(phone.refreshToken)
      ]);
      expect(revoked.status).toBe(200);
      expect([200, 401]).toContain(refreshed.status);

      const refreshTokens = [phone.refreshToken];
      const accessTokens = [phone.accessToken];
      if (refreshed.status === 200) {
        refreshTokens.push(refreshed.body.data.refreshToken as string);
        accessTokens.push(refreshed.body.data.accessToken as string);
      }
      for (const token of refreshTokens) expect((await refresh(token)).status).toBe(401);
      for (const token of accessTokens) expect((await me(token)).status).toBe(401);
      expect((await sessionRow(phoneSession))?.revoked_at).not.toBeNull();
    }
  });

  it('keeps ADR-041 reuse detection unchanged', async () => {
    await register('reuse@example.com');
    const phone = await login('reuse@example.com');
    const phoneSession = await currentSessionId(phone.accessToken);

    const rotated = await refresh(phone.refreshToken);
    expect(rotated.status).toBe(200);
    const reused = await refresh(phone.refreshToken);
    expect(reused.status).toBe(401);
    expect(await sessionRow(phoneSession)).toMatchObject({ revoked_reason: 'reuse_detected' });
    expect((await refresh(rotated.body.data.refreshToken as string)).status).toBe(401);
  });

  it('keeps the JSON export and account deletion working', async () => {
    const laptop = await register('export@example.com');
    const phone = await login('export@example.com');
    const phoneSession = await currentSessionId(phone.accessToken);
    expect((await revoke(laptop.accessToken, phoneSession)).status).toBe(200);

    const exported = record(
      await request(app)
        .post('/api/v1/users/me/export')
        .set('Authorization', `Bearer ${laptop.accessToken}`)
        .send({ currentPassword: PASSWORD })
    );
    expect(exported.status).toBe(200);
    expect(exported.text).toContain(phoneSession);

    const deletion = record(
      await request(app)
        .post('/api/v1/users/me/deletion')
        .set('Authorization', `Bearer ${laptop.accessToken}`)
        .send({ currentPassword: PASSWORD })
    );
    expect(deletion.status).toBe(202);
    // During the grace period the account can only cancel deletion.
    const blocked = await list(laptop.accessToken);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('ACCOUNT_PENDING_DELETION');
    // The session revoked earlier keeps its reason.
    expect(await sessionRow(phoneSession)).toMatchObject({ revoked_reason: 'user_revoked' });
    await expectNoIpInResponses();
  });

  it('rate limits both routes; malformed requests spend no password budget', async () => {
    const laptop = await register('limits@example.com');
    const phone = await login('limits@example.com');
    const phoneSession = await currentSessionId(phone.accessToken);

    for (let i = 0; i < 3; i += 1) {
      expect((await revoke(laptop.accessToken, phoneSession, '')).status).toBe(400);
    }
    for (let i = 0; i < REAUTHENTICATION_LIMIT; i += 1) {
      expect((await revoke(laptop.accessToken, phoneSession, 'WrongPassword123!')).status).toBe(
        403
      );
    }
    expect((await revoke(laptop.accessToken, phoneSession)).status).toBe(429);
    expect(await sessionRow(phoneSession)).toMatchObject({ revoked_at: null });

    await redis.flushdb();
    const container = getContainer();
    if ('clear' in container.rateLimiter && typeof container.rateLimiter.clear === 'function') {
      container.rateLimiter.clear();
    }
    for (let i = 0; i < SESSIONS_USER_LIMIT; i += 1) {
      expect((await list(laptop.accessToken)).status).toBe(200);
    }
    expect((await list(laptop.accessToken)).status).toBe(429);
  });
});
