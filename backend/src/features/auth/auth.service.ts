/**
 * Authentication business logic (spec sections 10, 23, 45).
 *
 * Dependencies arrive through the constructor rather than being imported
 * directly (spec section 5). `AuthService` depends on the PasswordHasher and
 * TokenService INTERFACES, so unit tests substitute fakes and a future move from
 * bcrypt to argon2, or from JWT to something else, touches one wiring file.
 *
 * Read the login path with account enumeration in mind: every branch that could
 * distinguish "no such account" from "wrong password" is deliberately collapsed
 * into one response and one timing profile (spec section 23).
 */
import { AppError, ErrorCode } from '@/core/errors';
import { createLogger } from '@/core/logger';
import type { PasswordHasher } from '@/core/security/password-hasher';
import { TIMING_EQUALIZER_HASH } from '@/core/security/password-hasher';
import type { TokenService } from '@/core/security/token-service';
import { AuditAction, recordAudit } from '@/infrastructure/database/mongodb/audit-log.service';
import { CacheKey, cacheSet } from '@/infrastructure/database/redis/cache';

import * as repository from './auth.repository';
import { toAuthResult, toUserProfile } from './auth.mapper';
import type {
  AuthResult,
  AuthTokens,
  LoginInput,
  RegisterInput,
  RequestOrigin,
  UserProfile,
  UserRecord,
} from './auth.types';

const log = createLogger('auth.service');

export interface AuthServiceConfig {
  readonly maxFailedAttempts: number;
  readonly lockoutSeconds: number;
  readonly accessTtlSeconds: number;
}

export class AuthService {
  constructor(
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly settings: AuthServiceConfig,
  ) {}

  /**
   * Registers a new account.
   *
   * Uniqueness is left to the database's unique index rather than being checked
   * first: a check-then-insert races, and two simultaneous signups with the same
   * email would both pass it (spec section 32). The duplicate surfaces as
   * ALREADY_EXISTS from the constraint.
   *
   * That response does disclose that an email is taken. It is the one place this
   * API accepts that trade-off, because a registration form that silently
   * succeeds on a taken address is unusable. Password reset, where no such
   * excuse exists, stays silent.
   */
  public async register(input: RegisterInput, origin: RequestOrigin): Promise<AuthResult> {
    const passwordHash = await this.hasher.hash(input.password);

    let user: UserRecord;
    try {
      user = await repository.insertUser({
        email: input.email,
        passwordHash,
        displayName: input.displayName ?? null,
      });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === '23505') {
        recordAudit({
          action: AuditAction.USER_REGISTERED,
          outcome: 'failure',
          ipAddress: origin.ipAddress,
          userAgent: origin.userAgent,
          metadata: { reason: 'email_taken' },
        });
        throw new AppError(ErrorCode.ALREADY_EXISTS, {
          message: 'An account with this email already exists.',
        });
      }
      throw error;
    }

    const tokens = await this.issueSession(user, origin);

    recordAudit({
      action: AuditAction.USER_REGISTERED,
      outcome: 'success',
      actorId: user.id,
      ipAddress: origin.ipAddress,
      userAgent: origin.userAgent,
    });

    log.info({ userId: user.id }, 'User registered');
    return toAuthResult(user, tokens);
  }

  /**
   * Authenticates a user.
   *
   * Every failure returns INVALID_CREDENTIALS with the same message, and the
   * unknown-email path still performs a bcrypt comparison against a dummy hash
   * so the response time does not reveal whether the account exists.
   */
  public async login(input: LoginInput, origin: RequestOrigin): Promise<AuthResult> {
    const user = await repository.findUserByEmail(input.email);

    if (!user) {
      // Burn equivalent time, then fail identically to a wrong password.
      await this.hasher.verify(input.password, TIMING_EQUALIZER_HASH);
      recordAudit({
        action: AuditAction.LOGIN_FAILED,
        outcome: 'failure',
        ipAddress: origin.ipAddress,
        userAgent: origin.userAgent,
        metadata: { reason: 'unknown_email' },
      });
      throw new AppError(ErrorCode.INVALID_CREDENTIALS);
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const retryAfter = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
      recordAudit({
        action: AuditAction.LOGIN_FAILED,
        outcome: 'failure',
        actorId: user.id,
        ipAddress: origin.ipAddress,
        userAgent: origin.userAgent,
        metadata: { reason: 'account_locked' },
      });
      throw new AppError(ErrorCode.ACCOUNT_LOCKED, { retryAfterSeconds: retryAfter });
    }

    const passwordMatches = await this.hasher.verify(input.password, user.passwordHash);

    if (!passwordMatches) {
      const { attempts, lockedUntil } = await repository.registerFailedLogin(
        user.id,
        this.settings.maxFailedAttempts,
        this.settings.lockoutSeconds,
      );

      recordAudit({
        action: AuditAction.LOGIN_FAILED,
        outcome: 'failure',
        actorId: user.id,
        ipAddress: origin.ipAddress,
        userAgent: origin.userAgent,
        metadata: { reason: 'wrong_password', attempts },
      });

      if (lockedUntil && lockedUntil > new Date()) {
        recordAudit({
          action: AuditAction.ACCOUNT_LOCKED,
          outcome: 'success',
          actorId: user.id,
          ipAddress: origin.ipAddress,
          metadata: { attempts },
        });
        log.warn({ userId: user.id, attempts }, 'Account locked after repeated failures');
      }

      // Same error as an unknown email: the client cannot tell the two apart.
      throw new AppError(ErrorCode.INVALID_CREDENTIALS);
    }

    if (!user.isActive) {
      // Checked only AFTER the password verifies, so a disabled account is not
      // discoverable without the correct credentials.
      recordAudit({
        action: AuditAction.LOGIN_FAILED,
        outcome: 'failure',
        actorId: user.id,
        ipAddress: origin.ipAddress,
        metadata: { reason: 'account_disabled' },
      });
      throw new AppError(ErrorCode.ACCOUNT_DISABLED);
    }

    await repository.clearFailedLogins(user.id);

    // Opportunistic upgrade: if the cost factor was raised since this password
    // was set, re-hash now that the plaintext is available (spec section 12).
    if (this.hasher.needsRehash(user.passwordHash)) {
      const upgraded = await this.hasher.hash(input.password);
      await repository.updatePasswordHash(user.id, upgraded);
      log.info({ userId: user.id }, 'Password hash upgraded to current cost factor');
    }

    const tokens = await this.issueSession(user, origin);

    recordAudit({
      action: AuditAction.LOGIN_SUCCEEDED,
      outcome: 'success',
      actorId: user.id,
      ipAddress: origin.ipAddress,
      userAgent: origin.userAgent,
    });

    return toAuthResult(user, tokens);
  }

  /**
   * Exchanges a refresh token for a new pair, rotating the old one.
   *
   * REUSE DETECTION. Rotation means each refresh token is single-use. If a token
   * that has already been rotated is presented again, either it was stolen and
   * the thief is using it, or it was stolen and the legitimate user is. There is
   * no way to tell which, so the whole session family is revoked and both
   * parties must sign in again. That converts a silent, indefinite session
   * hijack into a visible, bounded one (spec section 58).
   */
  public async refresh(refreshToken: string, origin: RequestOrigin): Promise<AuthResult> {
    const claims = this.tokens.verifyRefreshToken(refreshToken);
    const stored = await repository.findRefreshTokenById(claims.jti);

    if (!stored) {
      throw new AppError(ErrorCode.TOKEN_INVALID, {
        metadata: { reason: 'refresh token not found', jti: claims.jti },
      });
    }

    if (stored.revokedAt !== null) {
      const revokedCount = await repository.revokeSession(stored.sessionId, 'reuse_detected');
      await cacheSet(CacheKey.revokedSession(stored.sessionId), true, 86_400);

      recordAudit({
        action: AuditAction.TOKEN_REUSE_DETECTED,
        outcome: 'failure',
        actorId: stored.userId,
        targetId: stored.sessionId,
        ipAddress: origin.ipAddress,
        userAgent: origin.userAgent,
        metadata: { previousReason: stored.revokedReason, sessionsRevoked: revokedCount },
      });

      log.warn(
        { userId: stored.userId, sessionId: stored.sessionId },
        'Refresh token reuse detected; session family revoked',
      );

      throw new AppError(ErrorCode.TOKEN_REUSE_DETECTED);
    }

    if (stored.expiresAt <= new Date()) {
      throw new AppError(ErrorCode.TOKEN_EXPIRED);
    }

    const user = await repository.findUserById(stored.userId);
    if (!user || !user.isActive) {
      await repository.revokeSession(stored.sessionId, 'admin');
      throw new AppError(ErrorCode.ACCOUNT_DISABLED);
    }

    // A password change invalidates every token issued before it.
    //
    // Both sides are compared in WHOLE SECONDS. A JWT `iat` is defined in
    // seconds, so a token minted at 12:00:00.000 carries iat=12:00:00 while
    // `password_changed_at` keeps millisecond precision from the same insert,
    // e.g. 12:00:00.224. Comparing raw values makes every token issued at
    // registration look older than the password it was issued with, and the
    // very first refresh fails with TOKEN_REVOKED.
    //
    // The residual sub-second window is harmless: changePassword explicitly
    // revokes every session row, so this check is a secondary defence rather
    // than the mechanism doing the work.
    const passwordChangedAtSeconds = Math.floor(user.passwordChangedAt.getTime() / 1000);
    if (claims.iat < passwordChangedAtSeconds) {
      await repository.revokeSession(stored.sessionId, 'password_changed');
      throw new AppError(ErrorCode.TOKEN_REVOKED, {
        message: 'Your password changed. Please sign in again.',
      });
    }

    const issued = this.tokens.issueTokenPair({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId: stored.sessionId,
    });

    const rotated = await repository.rotateRefreshToken({
      oldTokenId: stored.id,
      newTokenId: issued.refreshTokenId,
      userId: user.id,
      sessionId: stored.sessionId,
      newToken: issued.refreshToken,
      expiresAt: issued.refreshExpiresAt,
      ipAddress: origin.ipAddress,
      userAgent: origin.userAgent,
    });

    if (!rotated) {
      // Lost the race against a concurrent refresh with the same token. Treat it
      // as reuse: the conservative reading is the safe one.
      await repository.revokeSession(stored.sessionId, 'reuse_detected');
      throw new AppError(ErrorCode.TOKEN_REUSE_DETECTED);
    }

    recordAudit({
      action: AuditAction.TOKEN_REFRESHED,
      outcome: 'success',
      actorId: user.id,
      targetId: stored.sessionId,
      ipAddress: origin.ipAddress,
    });

    return toAuthResult(user, {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      expiresIn: this.settings.accessTtlSeconds,
      tokenType: 'Bearer',
    });
  }

  /**
   * Ends a session.
   *
   * The refresh token is revoked in PostgreSQL immediately. The access token
   * cannot be revoked, since it is stateless, so the session id is also written
   * to a short-lived Redis denylist that `authenticate` consults. Without Redis
   * the already-issued access token stays valid until it expires, which is why
   * the access lifetime is only 15 minutes.
   */
  public async logout(sessionId: string, userId: string, origin: RequestOrigin): Promise<void> {
    const revoked = await repository.revokeSession(sessionId, 'logout');
    await cacheSet(CacheKey.revokedSession(sessionId), true, this.settings.accessTtlSeconds);

    recordAudit({
      action: AuditAction.LOGOUT,
      outcome: 'success',
      actorId: userId,
      targetId: sessionId,
      ipAddress: origin.ipAddress,
      metadata: { tokensRevoked: revoked },
    });
  }

  /**
   * Changes a password and ends every other session.
   *
   * Signing out other devices is the point: a password change usually follows a
   * suspected compromise, and leaving existing sessions alive would leave the
   * attacker signed in (spec section 58).
   */
  public async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    origin: RequestOrigin,
  ): Promise<void> {
    const user = await repository.findUserById(userId);
    if (!user) {
      throw AppError.notFound('User');
    }

    const matches = await this.hasher.verify(currentPassword, user.passwordHash);
    if (!matches) {
      recordAudit({
        action: AuditAction.PASSWORD_CHANGED,
        outcome: 'failure',
        actorId: userId,
        ipAddress: origin.ipAddress,
        metadata: { reason: 'wrong_current_password' },
      });
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, {
        message: 'The current password is incorrect.',
      });
    }

    const newHash = await this.hasher.hash(newPassword);
    await repository.updatePasswordHash(userId, newHash);
    const revoked = await repository.revokeAllUserSessions(userId, 'password_changed');

    recordAudit({
      action: AuditAction.PASSWORD_CHANGED,
      outcome: 'success',
      actorId: userId,
      ipAddress: origin.ipAddress,
      metadata: { sessionsRevoked: revoked },
    });

    log.info({ userId, sessionsRevoked: revoked }, 'Password changed; all sessions revoked');
  }

  public async getProfile(userId: string): Promise<UserProfile> {
    const user = await repository.findUserById(userId);
    if (!user) {
      throw AppError.notFound('User');
    }
    return toUserProfile(user);
  }

  /** Issues a fresh token pair and persists the refresh half. */
  private async issueSession(user: UserRecord, origin: RequestOrigin): Promise<AuthTokens> {
    const issued = this.tokens.issueTokenPair({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    await repository.insertRefreshToken({
      id: issued.refreshTokenId,
      userId: user.id,
      sessionId: issued.sessionId,
      token: issued.refreshToken,
      expiresAt: issued.refreshExpiresAt,
      ipAddress: origin.ipAddress,
      userAgent: origin.userAgent,
    });

    return {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      expiresIn: this.settings.accessTtlSeconds,
      tokenType: 'Bearer',
    };
  }
}
