/**
 * src/features/auth/password-reset.processor.ts
 *
 * The delivery half of "forgot password": account lookup, OTP generation and
 * SMTP delivery for one accepted reset request.
 *
 * It is extracted from AuthService so the same durable queue can be drained by
 * the API process (low latency) and by the worker (crash/restart recovery)
 * without duplicating the delivery rules (F-06).
 *
 * Invariants kept from the original implementation:
 *  - No account-existence oracle: unknown or disabled accounts do nothing.
 *  - The OTP is generated only here, after the durable row is claimed, so a
 *    reusable code is never written to any queue or table.
 *  - SMTP failures are logged and surfaced as a failure outcome; they are
 *    never reported to the caller and never swallowed silently.
 */

import type { OtpStore } from '../../core/security/otp-service.js';
import type { EmailSender } from '../../infrastructure/external/email-sender.js';
import type { AuditLogger } from '../../infrastructure/database/postgres/audit-logger.js';
import { logger } from '../../core/logger/logger.js';

export interface ResetRequestMeta {
  requestId?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
  /** Durable row id, used only to attach the ownership key (V-06). */
  recordId?: string | undefined;
}

/**
 * Optional ownership-link port: the durable row gains its owning account as
 * soon as delivery resolves it, so erasure and retention can reach the
 * metadata without an admission-time lookup (V-06).
 */
export interface ResetOwnerLink {
  attachOwner(recordId: string, userId: string): Promise<void>;
}

export interface PasswordResetUserLookup {
  findUserByEmail(
    email: string
  ): Promise<{ id: string; email: string; status: string } | null | undefined>;
}

export class PasswordResetProcessor {
  constructor(
    private readonly repo: PasswordResetUserLookup,
    private readonly otpStore: OtpStore,
    private readonly emailSender: EmailSender,
    private readonly auditLogger: AuditLogger,
    private readonly ownerLink?: ResetOwnerLink | undefined
  ) {}

  /**
   * Resolves when the request was handled. Throws when delivery did not
   * succeed, so the durable dispatcher can retry or dead-letter the row.
   */
  public async process(email: string, meta?: ResetRequestMeta): Promise<void> {
    const user = await this.repo.findUserByEmail(email);
    if (!user || user.status === 'disabled') return;

    // Ownership key for erasure/retention (V-06). Failure here must not block
    // delivery: account purge also erases reset metadata by email address.
    if (meta?.recordId && this.ownerLink) {
      try {
        await this.ownerLink.attachOwner(meta.recordId, user.id);
      } catch (err) {
        logger.warn('Password reset ownership link failed', {
          reason: err instanceof Error ? err.name : 'unknown'
        });
      }
    }

    const allowed = await this.otpStore.checkCooldown(user.id);
    if (!allowed) return;

    const code = await this.otpStore.generateAndStoreCode(user.id);
    let deliveryOutcome: 'success' | 'failure' = 'success';
    let deliveryError: unknown = null;
    try {
      await this.emailSender.sendPasswordResetEmail(user.email, code);
    } catch (err) {
      deliveryOutcome = 'failure';
      deliveryError = err;
      // This endpoint accepts requests without revealing account existence.
      // SMTP failure is observable internally, not a claimed successful delivery.
      logger.error('Password reset delivery failed', { requestId: meta?.requestId });
    }

    await this.auditLogger.log({
      actorType: 'user',
      actorUserId: user.id,
      eventType: 'auth.password.reset.requested',
      outcome: deliveryOutcome,
      requestId: meta?.requestId,
      ip: meta?.ip,
      userAgent: meta?.userAgent
    });

    if (deliveryError) {
      // Re-thrown without provider detail so the durable row is retried.
      throw new Error('PASSWORD_RESET_DELIVERY_FAILED');
    }
  }
}
