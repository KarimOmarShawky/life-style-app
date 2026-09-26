/**
 * JWT issuing and verification behind an interface (spec sections 5 and 10).
 *
 * Token design:
 *   - Access token: short-lived, stateless, carries id/email/role/session.
 *     Verified on every request with no database round trip.
 *   - Refresh token: long-lived, carries only the session and a token id.
 *     Every use is checked against PostgreSQL, so revocation is immediate.
 *
 * The two use SEPARATE secrets. With one shared secret an access token would
 * verify as a refresh token, letting a stolen short-lived token be exchanged for
 * a long-lived session. `env.ts` refuses to start if they match.
 */
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';

import { AppError, ErrorCode } from '@/core/errors';

import type { UserRole } from './authenticated-user';
import { isUserRole } from './authenticated-user';

export interface AccessTokenClaims {
  readonly sub: string;
  readonly email: string;
  readonly role: UserRole;
  readonly sid: string;
  readonly iat: number;
  readonly exp: number;
}

export interface RefreshTokenClaims {
  readonly sub: string;
  readonly sid: string;
  /** Unique id of this specific refresh token, for rotation and reuse detection. */
  readonly jti: string;
  readonly iat: number;
  readonly exp: number;
}

export interface IssuedTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessExpiresAt: Date;
  readonly refreshExpiresAt: Date;
  readonly sessionId: string;
  readonly refreshTokenId: string;
}

export interface TokenService {
  issueTokenPair(input: {
    userId: string;
    email: string;
    role: UserRole;
    sessionId?: string;
  }): IssuedTokens;
  verifyAccessToken(token: string): AccessTokenClaims;
  verifyRefreshToken(token: string): RefreshTokenClaims;
}

export interface JwtTokenServiceConfig {
  readonly accessSecret: string;
  readonly refreshSecret: string;
  readonly issuer: string;
  readonly audience: string;
  readonly accessTtlSeconds: number;
  readonly refreshTtlSeconds: number;
}

export class JwtTokenService implements TokenService {
  constructor(private readonly settings: JwtTokenServiceConfig) {}

  public issueTokenPair(input: {
    userId: string;
    email: string;
    role: UserRole;
    sessionId?: string;
  }): IssuedTokens {
    const sessionId = input.sessionId ?? randomUUID();
    const refreshTokenId = randomUUID();
    const issuedAt = Math.floor(Date.now() / 1000);

    const common: SignOptions = {
      issuer: this.settings.issuer,
      audience: this.settings.audience,
      algorithm: 'HS256',
    };

    const accessToken = jwt.sign(
      { sub: input.userId, email: input.email, role: input.role, sid: sessionId, iat: issuedAt },
      this.settings.accessSecret,
      { ...common, expiresIn: this.settings.accessTtlSeconds },
    );

    // The refresh token carries no email and no role. It is only ever exchanged,
    // never used for authorization, so extra claims would be needless exposure
    // in a credential with a 30-day lifetime (spec section 10).
    const refreshToken = jwt.sign(
      { sub: input.userId, sid: sessionId, jti: refreshTokenId, iat: issuedAt },
      this.settings.refreshSecret,
      { ...common, expiresIn: this.settings.refreshTtlSeconds },
    );

    return {
      accessToken,
      refreshToken,
      accessExpiresAt: new Date((issuedAt + this.settings.accessTtlSeconds) * 1000),
      refreshExpiresAt: new Date((issuedAt + this.settings.refreshTtlSeconds) * 1000),
      sessionId,
      refreshTokenId,
    };
  }

  public verifyAccessToken(token: string): AccessTokenClaims {
    const payload = this.verify(token, this.settings.accessSecret);

    const email = payload['email'];
    const role = payload['role'];
    const sid = payload['sid'];

    if (
      typeof payload.sub !== 'string' ||
      typeof email !== 'string' ||
      typeof sid !== 'string' ||
      !isUserRole(role) ||
      typeof payload.iat !== 'number' ||
      typeof payload.exp !== 'number'
    ) {
      throw new AppError(ErrorCode.TOKEN_INVALID, {
        metadata: { reason: 'access token claims failed shape check' },
      });
    }

    return { sub: payload.sub, email, role, sid, iat: payload.iat, exp: payload.exp };
  }

  public verifyRefreshToken(token: string): RefreshTokenClaims {
    const payload = this.verify(token, this.settings.refreshSecret);

    const sid = payload['sid'];

    if (
      typeof payload.sub !== 'string' ||
      typeof sid !== 'string' ||
      typeof payload.jti !== 'string' ||
      typeof payload.iat !== 'number' ||
      typeof payload.exp !== 'number'
    ) {
      throw new AppError(ErrorCode.TOKEN_INVALID, {
        metadata: { reason: 'refresh token claims failed shape check' },
      });
    }

    return { sub: payload.sub, sid, jti: payload.jti, iat: payload.iat, exp: payload.exp };
  }

  /**
   * Shared verification.
   *
   * `algorithms` is pinned to HS256. Without it, a token whose header declares
   * `alg: none` is accepted by some verifiers, and a library that also supports
   * RSA can be tricked into treating a public key as an HMAC secret. Pinning the
   * algorithm closes both (spec section 57, JWT attacks).
   */
  private verify(token: string, secret: string): JwtPayload {
    let decoded: string | JwtPayload;

    try {
      decoded = jwt.verify(token, secret, {
        issuer: this.settings.issuer,
        audience: this.settings.audience,
        algorithms: ['HS256'],
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TokenExpiredError') {
        throw new AppError(ErrorCode.TOKEN_EXPIRED, { cause: error });
      }
      throw new AppError(ErrorCode.TOKEN_INVALID, { cause: error });
    }

    if (typeof decoded === 'string') {
      throw new AppError(ErrorCode.TOKEN_INVALID, {
        metadata: { reason: 'token payload was a string, expected an object' },
      });
    }

    return decoded;
  }
}
