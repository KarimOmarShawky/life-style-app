/**
 * src/core/security/token-service.ts
 *
 * Implements Section 8.1 & 8.2.1: HS256 Access Token signing and verification.
 * Pins algorithm to HS256, verifies claims (iss, aud, sub, sid), supports key rotation,
 * and distinguishes between expired tokens (TOKEN_EXPIRED) and invalid tokens (UNAUTHENTICATED).
 */

import { SignJWT, jwtVerify, errors } from 'jose';
import { getEnv } from '../../config/env.js';
import { AppError } from '../errors/app-error.js';

export interface TokenPayload {
  sub: string; // user_id UUID
  sid: string; // session_id UUID
}

export interface SignedToken {
  token: string;
  expiresAt: Date;
}

export interface TokenService {
  signAccessToken(payload: TokenPayload): Promise<SignedToken>;
  verifyAccessToken(token: string): Promise<TokenPayload>;
}

export class JoseTokenService implements TokenService {
  private readonly secretKey: Uint8Array;
  private readonly previousSecretKey?: Uint8Array;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly ttlSeconds: number;

  constructor() {
    const env = getEnv();
    this.secretKey = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
    if (env.JWT_ACCESS_SECRET_PREVIOUS) {
      this.previousSecretKey = new TextEncoder().encode(env.JWT_ACCESS_SECRET_PREVIOUS);
    }
    this.issuer = env.JWT_ISSUER;
    this.audience = env.JWT_AUDIENCE;
    this.ttlSeconds = env.ACCESS_TOKEN_TTL_SECONDS;
  }

  public async signAccessToken(payload: TokenPayload): Promise<SignedToken> {
    const now = Math.floor(Date.now() / 1000);
    const expiresAtSeconds = now + this.ttlSeconds;
    const expiresAt = new Date(expiresAtSeconds * 1000);

    const token = await new SignJWT({
      sid: payload.sid
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(payload.sub)
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setIssuedAt(now)
      .setExpirationTime(expiresAtSeconds)
      .sign(this.secretKey);

    return {
      token,
      expiresAt
    };
  }

  public async verifyAccessToken(token: string): Promise<TokenPayload> {
    const verifyOptions = {
      issuer: this.issuer,
      audience: this.audience,
      algorithms: ['HS256'],
      clockTolerance: 5 // 5 seconds clock tolerance per Spec §8.2.1
    };

    try {
      // Try current secret key
      const { payload } = await jwtVerify(token, this.secretKey, verifyOptions);
      return this.validatePayloadClaims(payload);
    } catch (err) {
      // If token expired with valid signature, return TOKEN_EXPIRED
      if (err instanceof errors.JWTExpired) {
        throw AppError.unauthenticated('Access token has expired', 'TOKEN_EXPIRED');
      }

      // If rotation overlap exists, try previous secret key
      if (this.previousSecretKey) {
        try {
          const { payload } = await jwtVerify(token, this.previousSecretKey, verifyOptions);
          return this.validatePayloadClaims(payload);
        } catch (prevErr) {
          if (prevErr instanceof errors.JWTExpired) {
            throw AppError.unauthenticated('Access token has expired', 'TOKEN_EXPIRED');
          }
        }
      }

      // Any other failure (alg: none, tampered, wrong key) maps strictly to UNAUTHENTICATED
      throw AppError.unauthenticated('Invalid access token', 'UNAUTHENTICATED');
    }
  }

  private validatePayloadClaims(payload: Record<string, unknown>): TokenPayload {
    const sub = payload.sub;
    const sid = payload['sid'];

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (
      typeof sub !== 'string' ||
      !uuidRegex.test(sub) ||
      typeof sid !== 'string' ||
      !uuidRegex.test(sid)
    ) {
      throw AppError.unauthenticated('Malformed token claims', 'UNAUTHENTICATED');
    }

    return {
      sub,
      sid
    };
  }
}
