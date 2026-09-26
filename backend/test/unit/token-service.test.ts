/**
 * Unit tests for JWT issuing and verification (spec sections 10 and 41).
 */
import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';

import { AppError, ErrorCode } from '@/core/errors';
import { JwtTokenService } from '@/core/security/token-service';

const ACCESS_SECRET = 'access-secret-that-is-long-enough-for-tests-0001';
const REFRESH_SECRET = 'refresh-secret-that-is-long-enough-for-tests-002';

const service = new JwtTokenService({
  accessSecret: ACCESS_SECRET,
  refreshSecret: REFRESH_SECRET,
  issuer: 'lifestyle-api',
  audience: 'lifestyle-app',
  accessTtlSeconds: 900,
  refreshTtlSeconds: 2_592_000,
});

const user = {
  userId: '11111111-1111-4111-8111-111111111111',
  email: 'someone@example.com',
  role: 'user' as const,
};

describe('JwtTokenService', () => {
  it('issues a pair with distinct tokens and a shared session id', () => {
    const issued = service.issueTokenPair(user);

    expect(issued.accessToken).not.toBe(issued.refreshToken);
    expect(issued.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(issued.refreshExpiresAt.getTime()).toBeGreaterThan(issued.accessExpiresAt.getTime());
  });

  it('keeps the refresh token payload minimal', () => {
    // Spec section 10: a 30-day credential must not carry the email or the role.
    const issued = service.issueTokenPair(user);
    const payload = jwt.decode(issued.refreshToken) as Record<string, unknown>;

    expect(payload['sub']).toBe(user.userId);
    expect(payload['jti']).toBeTypeOf('string');
    expect(payload['email']).toBeUndefined();
    expect(payload['role']).toBeUndefined();
  });

  it('never puts the password or any secret in the access token', () => {
    const issued = service.issueTokenPair(user);
    const payload = JSON.stringify(jwt.decode(issued.accessToken));

    expect(payload).not.toContain('password');
    expect(payload).not.toContain(ACCESS_SECRET);
  });

  it('refuses an access token presented as a refresh token', () => {
    // The two secrets differ, so a stolen 15-minute token cannot be exchanged
    // for a 30-day session.
    const issued = service.issueTokenPair(user);

    expect(() => service.verifyRefreshToken(issued.accessToken)).toThrow(AppError);
    try {
      service.verifyRefreshToken(issued.accessToken);
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.TOKEN_INVALID);
    }
  });

  it('rejects a token signed with the wrong secret', () => {
    const forged = jwt.sign(
      { sub: user.userId, email: user.email, role: 'admin', sid: 'x' },
      'wrong-secret',
      {
        issuer: 'lifestyle-api',
        audience: 'lifestyle-app',
      },
    );

    expect(() => service.verifyAccessToken(forged)).toThrow(AppError);
  });

  it('rejects an alg:none token', () => {
    // The classic JWT bypass: strip the signature and claim no algorithm. The
    // verifier pins HS256, so this cannot validate.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({
        sub: user.userId,
        email: user.email,
        role: 'admin',
        sid: 'x',
        iat: 1,
        exp: 9_999_999_999,
      }),
    ).toString('base64url');

    expect(() => service.verifyAccessToken(`${header}.${body}.`)).toThrow(AppError);
  });

  it('rejects a token from another issuer or audience', () => {
    const foreign = jwt.sign(
      { sub: user.userId, email: user.email, role: 'user', sid: 'x' },
      ACCESS_SECRET,
      {
        issuer: 'someone-elses-api',
        audience: 'lifestyle-app',
      },
    );

    expect(() => service.verifyAccessToken(foreign)).toThrow(AppError);
  });

  it('reports an expired token distinctly from an invalid one', () => {
    const expired = jwt.sign(
      { sub: user.userId, email: user.email, role: 'user', sid: 'x' },
      ACCESS_SECRET,
      { issuer: 'lifestyle-api', audience: 'lifestyle-app', expiresIn: -10 },
    );

    // The client needs the difference: expired means refresh, invalid means
    // sign in again.
    try {
      service.verifyAccessToken(expired);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.TOKEN_EXPIRED);
    }
  });

  it('rejects a well-signed token whose claims have the wrong shape', () => {
    // Correct signature, but `role` is not a valid role. Verification must not
    // trust the payload shape just because the signature checks out.
    const malformed = jwt.sign(
      { sub: user.userId, email: user.email, role: 'superuser', sid: 'x' },
      ACCESS_SECRET,
      {
        issuer: 'lifestyle-api',
        audience: 'lifestyle-app',
      },
    );

    expect(() => service.verifyAccessToken(malformed)).toThrow(AppError);
  });
});
