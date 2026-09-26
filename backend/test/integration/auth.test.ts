/**
 * Integration tests for the auth feature (spec section 41).
 *
 * These drive the real Express app with supertest against the real PostgreSQL
 * database. No mocks: the point is to prove that routing, validation, the
 * service, the repository, the database constraints and the error handler all
 * agree with each other.
 */
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

import { createApp } from '@/app';

import { STRONG_PASSWORD, testEmail } from '../setup';

let app: Express;

beforeAll(() => {
  app = createApp();
});

interface AuthBody {
  success: boolean;
  data: {
    user: { id: string; email: string; role: string };
    tokens: { accessToken: string; refreshToken: string; expiresIn: number; tokenType: string };
  };
}

async function registerUser(label: string): Promise<AuthBody['data']> {
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: testEmail(label), password: STRONG_PASSWORD, displayName: 'Test User' })
    .expect(201);

  return (response.body as AuthBody).data;
}

describe('POST /api/v1/auth/register', () => {
  it('creates an account and returns a usable session', async () => {
    const data = await registerUser('register-ok');

    expect(data.user.email).toContain('@example.test');
    expect(data.user.role).toBe('user');
    expect(data.tokens.tokenType).toBe('Bearer');
    expect(data.tokens.expiresIn).toBe(900);
  });

  it('never returns the password hash', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: testEmail('no-hash'), password: STRONG_PASSWORD })
      .expect(201);

    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain('password_hash');
    expect(serialized).not.toContain(STRONG_PASSWORD);
  });

  it('sets the refresh token as an HttpOnly cookie', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: testEmail('cookie'), password: STRONG_PASSWORD })
      .expect(201);

    const cookies = response.headers['set-cookie'] as unknown as string[] | undefined;
    const refreshCookie = cookies?.find((c) => c.startsWith('lifestyle_rt='));

    expect(refreshCookie).toBeDefined();
    expect(refreshCookie).toContain('HttpOnly');
    expect(refreshCookie).toContain('SameSite=Strict');
  });

  it('rejects a duplicate email with 409', async () => {
    const email = testEmail('duplicate');
    await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: STRONG_PASSWORD })
      .expect(201);

    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: STRONG_PASSWORD })
      .expect(409);

    expect(response.body.error.code).toBe('ALREADY_EXISTS');
  });

  it('normalizes email casing so the same address cannot register twice', async () => {
    const email = testEmail('casing');
    await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: STRONG_PASSWORD })
      .expect(201);

    await request(app)
      .post('/api/v1/auth/register')
      .send({ email: email.toUpperCase(), password: STRONG_PASSWORD })
      .expect(409);
  });

  it('rejects a weak password with field-level detail', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: testEmail('weak'), password: 'short' })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.issues.length).toBeGreaterThan(0);
  });
});

describe('POST /api/v1/auth/login', () => {
  it('signs in with correct credentials', async () => {
    const email = testEmail('login-ok');
    await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: STRONG_PASSWORD })
      .expect(201);

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: STRONG_PASSWORD })
      .expect(200);

    expect((response.body as AuthBody).data.tokens.accessToken).toBeTypeOf('string');
  });

  it('returns an identical response for a wrong password and an unknown email', async () => {
    // Account enumeration: the two cases must be indistinguishable to a client.
    const email = testEmail('enum');
    await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: STRONG_PASSWORD })
      .expect(201);

    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'WrongPassword9X!' })
      .expect(401);

    const unknownEmail = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testEmail('never-registered'), password: 'WrongPassword9X!' })
      .expect(401);

    expect(wrongPassword.body.error.code).toBe(unknownEmail.body.error.code);
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('GET /api/v1/auth/me', () => {
  it('returns the caller profile with a valid token', async () => {
    const data = await registerUser('me-ok');

    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${data.tokens.accessToken}`)
      .expect(200);

    expect(response.body.data.id).toBe(data.user.id);
  });

  it('rejects a missing, malformed or tampered token', async () => {
    const data = await registerUser('me-bad-token');

    await request(app).get('/api/v1/auth/me').expect(401);
    await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer not-a-jwt').expect(401);
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${data.tokens.accessToken.slice(0, -1)}X`)
      .expect(401);
    // The scheme matters too: a bare token without "Bearer " is not accepted.
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', data.tokens.accessToken)
      .expect(401);
  });
});

describe('POST /api/v1/auth/refresh', () => {
  it('rotates the refresh token and issues a working pair', async () => {
    const data = await registerUser('refresh-ok');

    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: data.tokens.refreshToken })
      .expect(200);

    const rotated = (response.body as AuthBody).data;
    expect(rotated.tokens.refreshToken).not.toBe(data.tokens.refreshToken);

    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${rotated.tokens.accessToken}`)
      .expect(200);
  });

  it('detects reuse of a rotated token and revokes the whole session', async () => {
    const data = await registerUser('refresh-reuse');

    const first = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: data.tokens.refreshToken })
      .expect(200);

    const live = (first.body as AuthBody).data.tokens.refreshToken;

    // Replaying the original, already-rotated token.
    const reuse = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: data.tokens.refreshToken })
      .expect(401);

    expect(reuse.body.error.code).toBe('TOKEN_REUSE_DETECTED');

    // The legitimate successor is revoked too: the family is burned, because
    // there is no way to tell the thief from the victim.
    await request(app).post('/api/v1/auth/refresh').send({ refreshToken: live }).expect(401);
  });

  it('refuses an access token presented as a refresh token', async () => {
    const data = await registerUser('refresh-wrong-type');

    await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: data.tokens.accessToken })
      .expect(401);
  });
});

describe('POST /api/v1/auth/logout and change-password', () => {
  it('revokes the session on logout', async () => {
    const data = await registerUser('logout');

    await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${data.tokens.accessToken}`)
      .expect(204);

    // The refresh token is dead immediately.
    await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: data.tokens.refreshToken })
      .expect(401);
  });

  it('changes the password and revokes every session', async () => {
    const email = testEmail('change-password');
    const registered = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: STRONG_PASSWORD })
      .expect(201);
    const data = (registered.body as AuthBody).data;

    await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${data.tokens.accessToken}`)
      .send({ currentPassword: STRONG_PASSWORD, newPassword: 'BrandNewPass7Word' })
      .expect(204);

    // Old sessions are gone.
    await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: data.tokens.refreshToken })
      .expect(401);

    // The old password no longer works, the new one does.
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: STRONG_PASSWORD })
      .expect(401);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'BrandNewPass7Word' })
      .expect(200);
  });

  it('rejects a password change with the wrong current password', async () => {
    const data = await registerUser('change-password-wrong');

    await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${data.tokens.accessToken}`)
      .send({ currentPassword: 'NotTheRightOne9', newPassword: 'BrandNewPass7Word' })
      .expect(401);
  });
});

describe('Health endpoints', () => {
  it('reports process health without authentication', async () => {
    await request(app).get('/health').expect(200, { status: 'ok' });
  });

  it('reports dependency readiness', async () => {
    const response = await request(app).get('/readiness').expect(200);
    expect(response.body.dependencies.postgres).toBe('up');
  });
});
