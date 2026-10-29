import {
  ResetRequestDispatcher,
  type ResetDispatcherOptions
} from '../../core/security/reset-request-dispatcher.js';
import { logger } from '../../core/logger/logger.js';
import { getEnv } from '../../config/env.js';
/**
 * src/features/auth/auth.service.ts
 *
 * Implements Section 8.2–8.6: Authentication Business Logic.
 * Covers registration, login, strict refresh rotation with reuse revocation (ADR-041),
 * single & all-session logout, forgot/reset password with 6-digit OTP, and password change.
 */

import type pg from 'pg';
import type { AuthRepository } from './auth.repository.js';
import type { PasswordHasher } from '../../core/security/password-hasher.js';
import type { TokenService } from '../../core/security/token-service.js';
import type { OtpStore } from '../../core/security/otp-service.js';
import type { EmailSender } from '../../infrastructure/external/email-sender.js';
import type { AuditLogger } from '../../infrastructure/database/postgres/audit-logger.js';
import { generateRefreshToken, hashRefreshToken } from '../../core/security/refresh-token.js';
import { toUserDto, formatTokensDto } from './auth.dto.js';
import type {
  RegisterInput,
  LoginInput,
  ResetPasswordInput,
  ChangePasswordInput
} from './auth.validation.js';
import type { AuthResponseDto, TokensDto } from './auth.types.js';
import { AppError } from '../../core/errors/app-error.js';
import { PasswordResetProcessor, type ResetRequestMeta } from './password-reset.processor.js';

export interface RequestMeta {
  ip?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
}

export class AuthService {
  private readonly resetRequests: ResetRequestDispatcher;
  private readonly resetProcessor: PasswordResetProcessor;
  constructor(
    private readonly repo: AuthRepository,
    private readonly pool: pg.Pool,
    private readonly passwordHasher: PasswordHasher,
    private readonly tokenService: TokenService,
    private readonly otpStore: OtpStore,
    emailSender: EmailSender,
    private readonly auditLogger: AuditLogger,
    resetOptions?: ResetDispatcherOptions,
    resetProcessor?: PasswordResetProcessor
  ) {
    this.resetProcessor =
      resetProcessor ??
      new PasswordResetProcessor(repo, otpStore, emailSender, auditLogger, {
        // Ownership key written from the background delivery step (V-06).
        attachOwner: (recordId, userId) => this.resetRequests.attachOwner(recordId, userId)
      });
    this.resetRequests = new ResetRequestDispatcher(
      ({ email, meta }) => this.processPasswordResetRequest(email, meta),
      resetOptions
    );
  }

  public async register(input: RegisterInput, meta?: RequestMeta): Promise<AuthResponseDto> {
    const passwordHash = await this.passwordHasher.hash(input.password);

    const client = await this.pool.connect();
    let transactionOpen = false;
    // A failed BEGIN may leave an unusable/uncertain connection: discard it.
    let discardClient = true;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      discardClient = false;

      const user = await this.repo.createUser(
        {
          email: input.email,
          passwordHash,
          displayName: input.displayName,
          timezone: input.timezone,
          locale: input.locale,
          defaultCurrency: input.defaultCurrency
        },
        client
      );

      // Seed default categories
      await this.repo.createDefaultCategories(user.id, client);

      // Create session (90 days absolute cap)
      const now = new Date();
      const absoluteExpiresAt = new Date(
        now.getTime() + getEnv().SESSION_ABSOLUTE_TTL_DAYS * 24 * 60 * 60 * 1000
      );

      const session = await this.repo.createSession(
        {
          userId: user.id,
          absoluteExpiresAt,
          devicePlatform: input.device?.platform ?? 'unknown',
          deviceName: input.device?.name,
          appVersion: input.device?.appVersion,
          createdIp: meta?.ip
        },
        client
      );

      // Create initial refresh token (30 days sliding TTL, capped at absolute session expiry)
      const { rawToken, tokenHash } = generateRefreshToken();
      const refreshExpiresAt = new Date(
        Math.min(
          now.getTime() + getEnv().REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
          absoluteExpiresAt.getTime()
        )
      );

      await this.repo.createRefreshToken(
        {
          sessionId: session.id,
          userId: user.id,
          tokenHash,
          expiresAt: refreshExpiresAt
        },
        client
      );

      await client.query('COMMIT');

      transactionOpen = false;

      // Audit event
      await this.auditLogger.log({
        actorType: 'user',
        actorUserId: user.id,
        sessionId: session.id,
        eventType: 'auth.register',
        outcome: 'success',
        requestId: meta?.requestId,
        ip: meta?.ip,
        userAgent: meta?.userAgent
      });

      // Sign Access Token
      const signedAccess = await this.tokenService.signAccessToken({
        sub: user.id,
        sid: session.id
      });

      return {
        user: toUserDto(user),
        tokens: formatTokensDto({
          accessToken: signedAccess.token,
          accessTokenExpiresAt: signedAccess.expiresAt,
          refreshToken: rawToken,
          refreshTokenExpiresAt: refreshExpiresAt
        })
      };
    } catch (err: unknown) {
      if (transactionOpen) {
        try {
          await client.query('ROLLBACK');
        } catch {
          discardClient = true;
          // Never replace the original error or log raw database/provider details.
          logger.error('Authentication transaction rollback failed; discarding connection');
        }
      }
      const pgErr = err as { code?: string };
      if (pgErr.code === '23505') {
        throw AppError.conflict('EMAIL_ALREADY_REGISTERED', 'Email address is already registered');
      }
      throw err;
    } finally {
      client.release(discardClient);
    }
  }

  public async login(input: LoginInput, meta?: RequestMeta): Promise<AuthResponseDto> {
    const user = await this.repo.findUserByEmail(input.email);

    if (!user) {
      await this.passwordHasher.dummyVerify();
      await this.auditLogger.log({
        actorType: 'system',
        eventType: 'auth.login.failed',
        outcome: 'failure',
        requestId: meta?.requestId,
        ip: meta?.ip,
        userAgent: meta?.userAgent,
        metadata: { reason: 'user_not_found' }
      });
      throw AppError.unauthenticated('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    const isValidPassword = await this.passwordHasher.verify(input.password, user.password_hash);
    if (!isValidPassword) {
      await this.auditLogger.log({
        actorType: 'user',
        actorUserId: user.id,
        eventType: 'auth.login.failed',
        outcome: 'failure',
        requestId: meta?.requestId,
        ip: meta?.ip,
        userAgent: meta?.userAgent,
        metadata: { reason: 'wrong_password' }
      });
      throw AppError.unauthenticated('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    if (user.status === 'disabled') {
      throw AppError.forbidden('Account has been disabled by an administrator', 'ACCOUNT_DISABLED');
    }

    const client = await this.pool.connect();
    let transactionOpen = false;
    // A failed BEGIN may leave an unusable/uncertain connection: discard it.
    let discardClient = true;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      discardClient = false;

      const now = new Date();
      const absoluteExpiresAt = new Date(
        now.getTime() + getEnv().SESSION_ABSOLUTE_TTL_DAYS * 24 * 60 * 60 * 1000
      );

      const session = await this.repo.createSession(
        {
          userId: user.id,
          absoluteExpiresAt,
          devicePlatform: input.device?.platform ?? 'unknown',
          deviceName: input.device?.name,
          appVersion: input.device?.appVersion,
          createdIp: meta?.ip
        },
        client
      );

      const { rawToken, tokenHash } = generateRefreshToken();
      const refreshExpiresAt = new Date(
        Math.min(
          now.getTime() + getEnv().REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
          absoluteExpiresAt.getTime()
        )
      );

      await this.repo.createRefreshToken(
        {
          sessionId: session.id,
          userId: user.id,
          tokenHash,
          expiresAt: refreshExpiresAt
        },
        client
      );

      await this.repo.updateLastLogin(user.id, client);
      await client.query('COMMIT');
      transactionOpen = false;

      await this.auditLogger.log({
        actorType: 'user',
        actorUserId: user.id,
        sessionId: session.id,
        eventType: 'auth.login.succeeded',
        outcome: 'success',
        requestId: meta?.requestId,
        ip: meta?.ip,
        userAgent: meta?.userAgent
      });

      const signedAccess = await this.tokenService.signAccessToken({
        sub: user.id,
        sid: session.id
      });

      return {
        user: toUserDto(user),
        tokens: formatTokensDto({
          accessToken: signedAccess.token,
          accessTokenExpiresAt: signedAccess.expiresAt,
          refreshToken: rawToken,
          refreshTokenExpiresAt: refreshExpiresAt
        })
      };
    } catch (err) {
      if (transactionOpen) {
        try {
          await client.query('ROLLBACK');
        } catch {
          discardClient = true;
          // Never replace the original error or log raw database/provider details.
          logger.error('Authentication transaction rollback failed; discarding connection');
        }
      }
      throw err;
    } finally {
      client.release(discardClient);
    }
  }

  public async refresh(refreshToken: string, meta?: RequestMeta): Promise<TokensDto> {
    const tokenHash = hashRefreshToken(refreshToken);
    const record = await this.repo.findRefreshTokenWithSession(tokenHash);

    if (!record) {
      throw AppError.unauthenticated('Invalid refresh token', 'INVALID_REFRESH_TOKEN');
    }

    const { token, session, user } = record;
    const now = new Date();

    // 1. Dead session or dead token
    if (
      session.revokedAt !== null ||
      session.absoluteExpiresAt <= now ||
      token.revoked_at !== null
    ) {
      throw AppError.unauthenticated('Invalid refresh token', 'INVALID_REFRESH_TOKEN');
    }

    // 2. Reuse detection (ADR-041, Section 8.2.5)
    if (token.rotated_at !== null) {
      await this.repo.revokeSession(session.id, 'reuse_detected');
      await this.repo.deleteSessionPushDevices(session.id);

      await this.auditLogger.log({
        actorType: 'user',
        actorUserId: user.id,
        sessionId: session.id,
        eventType: 'auth.refresh.reuse_detected',
        outcome: 'failure',
        requestId: meta?.requestId,
        ip: meta?.ip,
        userAgent: meta?.userAgent
      });

      throw AppError.unauthenticated('Invalid refresh token', 'INVALID_REFRESH_TOKEN');
    }

    // 3. Expired token
    if (token.expires_at <= now) {
      throw AppError.unauthenticated('Invalid refresh token', 'INVALID_REFRESH_TOKEN');
    }

    // 4. Disabled user
    if (user.status === 'disabled') {
      throw AppError.unauthenticated('Invalid refresh token', 'INVALID_REFRESH_TOKEN');
    }

    // 5. Rotate atomically
    const { rawToken: newRawToken, tokenHash: newTokenHash } = generateRefreshToken();
    const newRefreshExpiresAt = new Date(
      Math.min(
        now.getTime() + getEnv().REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
        session.absoluteExpiresAt.getTime()
      )
    );

    const client = await this.pool.connect();
    let transactionOpen = false;
    // A failed BEGIN may leave an unusable/uncertain connection: discard it.
    let discardClient = true;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      discardClient = false;

      const rotated = await this.repo.rotateRefreshToken(
        token.id,
        {
          sessionId: session.id,
          userId: user.id,
          tokenHash: newTokenHash,
          expiresAt: newRefreshExpiresAt
        },
        client
      );

      if (!rotated) {
        // Lost race: treat as reuse and revoke
        await this.repo.revokeSession(session.id, 'reuse_detected', client);
        await this.repo.deleteSessionPushDevices(session.id, client);
        await client.query('COMMIT');
        transactionOpen = false;

        await this.auditLogger.log({
          actorType: 'user',
          actorUserId: user.id,
          sessionId: session.id,
          eventType: 'auth.refresh.reuse_detected',
          outcome: 'failure',
          requestId: meta?.requestId,
          ip: meta?.ip,
          userAgent: meta?.userAgent
        });

        throw AppError.unauthenticated('Invalid refresh token', 'INVALID_REFRESH_TOKEN');
      }

      await client.query('COMMIT');

      transactionOpen = false;

      const signedAccess = await this.tokenService.signAccessToken({
        sub: user.id,
        sid: session.id
      });

      return formatTokensDto({
        accessToken: signedAccess.token,
        accessTokenExpiresAt: signedAccess.expiresAt,
        refreshToken: newRawToken,
        refreshTokenExpiresAt: newRefreshExpiresAt
      });
    } catch (err) {
      if (transactionOpen) {
        try {
          await client.query('ROLLBACK');
        } catch {
          discardClient = true;
          // Never replace the original error or log raw database/provider details.
          logger.error('Authentication transaction rollback failed; discarding connection');
        }
      }
      throw err;
    } finally {
      client.release(discardClient);
    }
  }

  public async logout(
    options: { refreshToken?: string | undefined; accessToken?: string | undefined },
    meta?: RequestMeta
  ): Promise<void> {
    if (!options.refreshToken && !options.accessToken) {
      throw AppError.validation([
        {
          field: 'refreshToken',
          message: 'At least one of refreshToken or Authorization Bearer header must be supplied'
        }
      ]);
    }

    let revokedSessionId: string | null = null;
    let revokedUserId: string | null = null;

    if (options.accessToken) {
      try {
        const payload = await this.tokenService.verifyAccessToken(options.accessToken);
        revokedSessionId = payload.sid;
        revokedUserId = payload.sub;
      } catch {
        // Bearer invalid, fall through to refresh token check
      }
    }

    if (!revokedSessionId && options.refreshToken) {
      const tokenHash = hashRefreshToken(options.refreshToken);
      const record = await this.repo.findRefreshTokenWithSession(tokenHash);
      if (record) {
        revokedSessionId = record.session.id;
        revokedUserId = record.user.id;
      }
    }

    if (revokedSessionId && revokedUserId) {
      const client = await this.pool.connect();
      let transactionOpen = false;
      let discardClient = true;
      try {
        await client.query('BEGIN');
        transactionOpen = true;
        discardClient = false;
        await this.repo.revokeSession(revokedSessionId, 'logout', client);
        await this.repo.deleteSessionPushDevices(revokedSessionId, client);
        await client.query('COMMIT');
        transactionOpen = false;

        await this.auditLogger.log({
          actorType: 'user',
          actorUserId: revokedUserId,
          sessionId: revokedSessionId,
          eventType: 'auth.logout',
          outcome: 'success',
          requestId: meta?.requestId,
          ip: meta?.ip,
          userAgent: meta?.userAgent
        });
      } catch (err) {
        if (transactionOpen) {
          try {
            await client.query('ROLLBACK');
          } catch {
            discardClient = true;
            logger.error('Authentication transaction rollback failed; discarding connection');
          }
        }
        throw err;
      } finally {
        client.release(discardClient);
      }
    }
  }

  public async logoutAll(userId: string, meta?: RequestMeta): Promise<void> {
    const client = await this.pool.connect();
    let transactionOpen = false;
    let discardClient = true;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      discardClient = false;
      await this.repo.revokeAllUserSessions(userId, 'logout_all', undefined, client);
      await this.repo.deleteAllUserPushDevices(userId, undefined, client);
      await client.query('COMMIT');
      transactionOpen = false;

      await this.auditLogger.log({
        actorType: 'user',
        actorUserId: userId,
        eventType: 'auth.logout_all',
        outcome: 'success',
        requestId: meta?.requestId,
        ip: meta?.ip,
        userAgent: meta?.userAgent
      });
    } catch (err) {
      if (transactionOpen) {
        try {
          await client.query('ROLLBACK');
        } catch {
          discardClient = true;
          logger.error('Authentication transaction rollback failed; discarding connection');
        }
      }
      throw err;
    } finally {
      client.release(discardClient);
    }
  }

  public async forgotPassword(email: string, meta?: RequestMeta): Promise<void> {
    // No account lookup happens before admission: the endpoint must not become
    // an existence oracle, and the 202 must not wait on the database (F-06).
    // admit() persists the request first when a durable store is configured, so
    // a 202 is only returned once the work has durable ownership.
    const admitted = await this.resetRequests.admit({ email, meta });
    if (!admitted) {
      // Admission is process-wide for this service, before any account-dependent work.
      throw AppError.serviceUnavailable('Password reset requests temporarily unavailable');
    }
  }

  public stopResetRequests(): void {
    this.resetRequests.stopAccepting();
  }
  /** Releases durable rows abandoned by a crashed or restarted process. */
  public recoverResetRequests(): Promise<number> {
    return this.resetRequests.recoverStale();
  }
  /** Pulls due durable rows (previous process or earlier failure) into this one. */
  public drainResetRequests(): Promise<number> {
    return this.resetRequests.drainDue();
  }
  public waitForResetRequests(): Promise<void> {
    return this.resetRequests.waitForIdle();
  }
  public resetRequestCounts(): ReturnType<ResetRequestDispatcher['snapshot']> {
    return this.resetRequests.snapshot();
  }

  private async processPasswordResetRequest(email: string, meta?: RequestMeta): Promise<void> {
    await this.resetProcessor.process(email, meta as ResetRequestMeta | undefined);
  }

  public async resetPassword(input: ResetPasswordInput, meta?: RequestMeta): Promise<void> {
    const user = await this.repo.findUserByEmail(input.email);

    if (!user || user.status === 'disabled') {
      await this.passwordHasher.dummyVerify();
      throw new AppError({
        httpStatus: 400,
        code: 'INVALID_OR_EXPIRED_CODE',
        safeMessage: 'Invalid or expired password reset code'
      });
    }

    const isValid = await this.otpStore.verifyAndConsumeCode(user.id, input.code);
    if (!isValid) {
      // Match the unknown/disabled-user invalid-reset path's expensive operation.
      // This is expensive-operation parity, not a constant-time DB/Redis guarantee.
      await this.passwordHasher.dummyVerify();
      throw new AppError({
        httpStatus: 400,
        code: 'INVALID_OR_EXPIRED_CODE',
        safeMessage: 'Invalid or expired password reset code'
      });
    }

    const passwordHash = await this.passwordHasher.hash(input.newPassword);

    const client = await this.pool.connect();
    let transactionOpen = false;
    let discardClient = true;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      discardClient = false;
      await this.repo.updateUserPassword(user.id, passwordHash, client);
      await this.repo.revokeAllUserSessions(user.id, 'password_reset', undefined, client);
      await this.repo.deleteAllUserPushDevices(user.id, undefined, client);
      await client.query('COMMIT');
      transactionOpen = false;

      await this.auditLogger.log({
        actorType: 'user',
        actorUserId: user.id,
        eventType: 'auth.password.reset.completed',
        outcome: 'success',
        requestId: meta?.requestId,
        ip: meta?.ip,
        userAgent: meta?.userAgent
      });
    } catch (err) {
      if (transactionOpen) {
        try {
          await client.query('ROLLBACK');
        } catch {
          discardClient = true;
          logger.error('Authentication transaction rollback failed; discarding connection');
        }
      }
      throw err;
    } finally {
      client.release(discardClient);
    }
  }

  public async changePassword(
    userId: string,
    currentSessionId: string,
    input: ChangePasswordInput,
    meta?: RequestMeta
  ): Promise<void> {
    const user = await this.repo.findUserById(userId);
    if (!user) {
      throw AppError.notFound('User not found');
    }

    const isMatch = await this.passwordHasher.verify(input.currentPassword, user.password_hash);
    if (!isMatch) {
      throw AppError.unauthenticated('Invalid current password', 'INVALID_CREDENTIALS');
    }

    const passwordHash = await this.passwordHasher.hash(input.newPassword);

    const client = await this.pool.connect();
    let transactionOpen = false;
    let discardClient = true;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      discardClient = false;
      await this.repo.updateUserPassword(userId, passwordHash, client);
      // Revoke all OTHER sessions, keeping current session
      await this.repo.revokeAllUserSessions(userId, 'password_change', currentSessionId, client);
      await this.repo.deleteAllUserPushDevices(userId, currentSessionId, client);
      await client.query('COMMIT');
      transactionOpen = false;

      await this.auditLogger.log({
        actorType: 'user',
        actorUserId: userId,
        sessionId: currentSessionId,
        eventType: 'auth.password.changed',
        outcome: 'success',
        requestId: meta?.requestId,
        ip: meta?.ip,
        userAgent: meta?.userAgent
      });
    } catch (err) {
      if (transactionOpen) {
        try {
          await client.query('ROLLBACK');
        } catch {
          discardClient = true;
          logger.error('Authentication transaction rollback failed; discarding connection');
        }
      }
      throw err;
    } finally {
      client.release(discardClient);
    }
  }
}
