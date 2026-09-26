/**
 * Security tests (spec sections 41 and 57).
 *
 * Each test names the threat it defends against. These are regression tests for
 * security properties: if one starts failing, a protection has been removed.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

import { createApp } from '@/app';
import { config } from '@/config';

import { STRONG_PASSWORD, testEmail } from '../setup';

let app: Express;

beforeAll(() => {
  app = createApp();
});

async function register(
  label: string,
): Promise<{ id: string; accessToken: string; email: string }> {
  const email = testEmail(label);
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({ email, password: STRONG_PASSWORD })
    .expect(201);

  return {
    id: response.body.data.user.id,
    accessToken: response.body.data.tokens.accessToken,
    email,
  };
}

describe('SQL injection (spec section 14)', () => {
  const payloads = [
    "admin@example.com' OR '1'='1",
    "a@b.com'; DROP TABLE users; --",
    "a@b.com' UNION SELECT password_hash FROM users --",
    "a@b.com'/**/OR/**/1=1--",
  ];

  it.each(payloads)('rejects %s without reaching the database', async (payload) => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: payload, password: 'anything' });

    // Validation stops these before any query runs. Even if one reached the
    // repository, every statement is parameterized.
    expect([401, 422]).toContain(response.status);
    expect(JSON.stringify(response.body)).not.toContain('password_hash');
  });

  it('leaves the users table intact after injection attempts', async () => {
    const user = await register('sql-survivor');

    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: "x'; DROP TABLE users; --", password: 'x' });

    // Proof the table still exists and the account is still usable.
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(200);
  });
});

describe('NoSQL injection (spec section 15)', () => {
  it('rejects operator objects where a string is expected', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: { $ne: null }, password: { $ne: null } })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a $regex probe', async () => {
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: { $regex: '.*' }, password: 'x' })
      .expect(422);
  });

  it('rejects a $where payload', async () => {
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: { $where: 'sleep(5000)' }, password: 'x' })
      .expect(422);
  });
});

describe('Privilege escalation (spec sections 16 and 45)', () => {
  it('refuses a role injected into the registration body', async () => {
    // Never trust the client: the backend assigns the role, always.
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: testEmail('escalate'), password: STRONG_PASSWORD, role: 'admin' })
      .expect(422);

    expect(response.body.error.issues[0].message).toMatch(/[Uu]nrecognized key/);
  });

  it('ignores an isAdmin flag and other unknown fields', async () => {
    await request(app)
      .post('/api/v1/auth/register')
      .send({ email: testEmail('is-admin'), password: STRONG_PASSWORD, isAdmin: true })
      .expect(422);
  });

  it('does not honour a forged admin role in a self-signed token', async () => {
    const forged = jwt.sign(
      {
        sub: '00000000-0000-4000-8000-000000000000',
        email: 'attacker@example.com',
        role: 'admin',
        sid: 'forged',
      },
      'a-secret-the-attacker-guessed-wrong-0000',
      { issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE, expiresIn: 3600 },
    );

    await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${forged}`).expect(401);
  });
});

describe('JWT attacks (spec section 57)', () => {
  it('rejects an alg:none token', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: '00000000-0000-4000-8000-000000000000',
        email: 'attacker@example.com',
        role: 'admin',
        sid: 'x',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64url');

    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${header}.${payload}.`)
      .expect(401);
  });

  it('rejects an expired token', async () => {
    const expired = jwt.sign(
      { sub: '00000000-0000-4000-8000-000000000000', email: 'a@b.c', role: 'user', sid: 'x' },
      config.JWT_SECRET,
      { issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE, expiresIn: -60 },
    );

    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${expired}`)
      .expect(401);

    expect(response.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('rejects a token signed with the refresh secret on an access route', async () => {
    const crossed = jwt.sign(
      { sub: '00000000-0000-4000-8000-000000000000', email: 'a@b.c', role: 'user', sid: 'x' },
      config.JWT_REFRESH_SECRET,
      { issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE, expiresIn: 3600 },
    );

    await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${crossed}`).expect(401);
  });
});

describe('Brute force and account protection (spec sections 22 and 23)', () => {
  it('locks the account after the configured number of failures', async () => {
    const user = await register('brute-force');

    for (let attempt = 0; attempt < config.MAX_FAILED_LOGIN_ATTEMPTS; attempt += 1) {
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: `WrongPassword${attempt}X` })
        .expect(401);
    }

    // Even the CORRECT password is refused while locked, which is what makes
    // the lockout meaningful rather than cosmetic.
    const locked = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: STRONG_PASSWORD })
      .expect(423);

    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(locked.headers['retry-after']).toBeDefined();
  });

  it('resets the failure counter after a successful sign-in', async () => {
    const user = await register('counter-reset');

    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'Wrong1X' })
      .expect(401);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'Wrong2X' })
      .expect(401);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: STRONG_PASSWORD })
      .expect(200);

    // The counter is back to zero, so the next two failures do not lock it.
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'Wrong3X' })
      .expect(401);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: STRONG_PASSWORD })
      .expect(200);
  });
});

describe('Information disclosure (spec sections 25 and 35)', () => {
  it('never returns a stack trace or internals in an error body', async () => {
    const response = await request(app).get('/api/v1/auth/does-not-exist').expect(404);
    const body = JSON.stringify(response.body);

    expect(body).not.toContain(config.JWT_SECRET);
    expect(body).not.toContain('DATABASE_URL');
    expect(body).not.toContain('postgresql://');
  });

  it('does not leak the framework in headers', async () => {
    const response = await request(app).get('/health').expect(200);
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('sets the expected security headers', async () => {
    const response = await request(app).get('/health').expect(200);

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(response.headers['content-security-policy']).toBeDefined();
  });

  it('attaches a correlation id to every response', async () => {
    const response = await request(app).get('/health').expect(200);
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('accepts a well-formed inbound correlation id so traces can span clients', async () => {
    const response = await request(app)
      .get('/health')
      .set('X-Request-Id', 'client-trace-abc123')
      .expect(200);

    expect(response.headers['x-request-id']).toBe('client-trace-abc123');
  });

  it('replaces a correlation id carrying unsafe characters', async () => {
    // The id is echoed in a response header and written into logs, so an
    // unfiltered one is a header-injection and log-forging vector. A raw CRLF
    // cannot be tested from here because Node's HTTP client refuses to transmit
    // it, so this covers the characters that DO reach the server.
    for (const forged of ['<script>alert(1)</script>', 'abc def; evil=1', 'a'.repeat(200), '']) {
      const response = await request(app).get('/health').set('X-Request-Id', forged).expect(200);

      // Anything unsafe is discarded and a fresh UUID issued instead.
      expect(response.headers['x-request-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(response.headers['x-request-id']).not.toBe(forged);
    }
  });
});

describe('Malformed input (spec sections 13 and 34)', () => {
  it('rejects a body that is not valid JSON', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": "a@b.com", ')
      .expect(400);

    expect(response.body.error.code).toBe('MALFORMED_JSON');
  });

  it('rejects an oversized body', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: testEmail('huge'),
        password: STRONG_PASSWORD,
        displayName: 'x'.repeat(200_000),
      })
      .expect(413);

    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects a password longer than bcrypt can actually verify', async () => {
    // Beyond 72 bytes bcrypt silently truncates, so a longer password would
    // only be partially checked. Capping it at validation keeps that honest.
    await request(app)
      .post('/api/v1/auth/register')
      .send({ email: testEmail('long-password'), password: 'A1'.repeat(50) })
      .expect(422);
  });

  it('handles an XSS payload as inert data', async () => {
    const payload = '<script>alert(1)</script>';
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: testEmail('xss'), password: STRONG_PASSWORD, displayName: payload })
      .expect(201);

    // Stored verbatim, returned as JSON, never as HTML. The API sets
    // nosniff and returns application/json, so a browser cannot execute it.
    expect(response.body.data.user.displayName).toBe(payload);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
});
