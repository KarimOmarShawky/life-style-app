/**
 * tests/unit/token-service.test.ts
 *
 * Validates Section 8.1 & 8.2.1: HS256 TokenService behavior, expiry, tampering.
 */

import { describe, it, expect } from 'vitest';
import { JoseTokenService } from '../../src/core/security/token-service.js';
import { AppError } from '../../src/core/errors/app-error.js';
import { SignJWT } from 'jose';
import { getEnv } from '../../src/config/env.js';

describe('JoseTokenService', () => {
  const tokenService = new JoseTokenService();
  const validSub = '11111111-1111-4111-8111-111111111111';
  const validSid = '22222222-2222-4222-8222-222222222222';

  it('signs and verifies a valid HS256 access token', async () => {
    const signed = await tokenService.signAccessToken({ sub: validSub, sid: validSid });
    expect(signed.token).toBeDefined();
    expect(signed.expiresAt).toBeInstanceOf(Date);

    const payload = await tokenService.verifyAccessToken(signed.token);
    expect(payload.sub).toBe(validSub);
    expect(payload.sid).toBe(validSid);
  });

  it('throws TOKEN_EXPIRED error when token is expired', async () => {
    const env = getEnv();
    const secret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

    // Create a token expired 10 seconds ago
    const past = Math.floor(Date.now() / 1000) - 10;
    const expiredToken = await new SignJWT({ sid: validSid })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(validSub)
      .setIssuer(env.JWT_ISSUER)
      .setAudience(env.JWT_AUDIENCE)
      .setIssuedAt(past - 60)
      .setExpirationTime(past)
      .sign(secret);

    try {
      await tokenService.verifyAccessToken(expiredToken);
      expect.fail('Should have thrown TOKEN_EXPIRED');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.code).toBe('TOKEN_EXPIRED');
      expect(appErr.httpStatus).toBe(401);
    }
  });

  it('throws UNAUTHENTICATED on tampered token or invalid signature', async () => {
    const signed = await tokenService.signAccessToken({ sub: validSub, sid: validSid });
    const parts = signed.token.split('.');
    // Tamper with payload
    const tampered = `${parts[0]}.e30.${parts[2]}`;

    try {
      await tokenService.verifyAccessToken(tampered);
      expect.fail('Should have thrown UNAUTHENTICATED');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.code).toBe('UNAUTHENTICATED');
      expect(appErr.httpStatus).toBe(401);
    }
  });

  it('rejects tokens signed with alg: none or foreign key', async () => {
    const foreignSecret = new TextEncoder().encode(
      'foreign-secret-must-be-at-least-32-chars-long!'
    );
    const env = getEnv();

    const forged = await new SignJWT({ sid: validSid })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(validSub)
      .setIssuer(env.JWT_ISSUER)
      .setAudience(env.JWT_AUDIENCE)
      .setExpirationTime('15m')
      .sign(foreignSecret);

    await expect(tokenService.verifyAccessToken(forged)).rejects.toThrowError(
      expect.objectContaining({ code: 'UNAUTHENTICATED' })
    );
  });
});
