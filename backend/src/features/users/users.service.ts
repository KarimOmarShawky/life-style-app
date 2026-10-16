import { ACCOUNT_ARCHIVE_LIMITS } from './account-archive.js';
import type { PasswordHasher } from '../../core/security/password-hasher.js';
/**
 * src/features/users/users.service.ts
 *
 * Implements Section 14.3: User Profile & Device Management Service.
 */

import type { UsersRepository, PurgeAccountOptions } from './users.repository.js';
import type { AuditLogger } from '../../infrastructure/database/postgres/audit-logger.js';
import type {
  UpdateUserProfileInput,
  RegisterPushDeviceInput,
  UserExportData
} from './users.types.js';
import type { UserDto } from '../auth/auth.types.js';
import { toUserDto } from '../auth/auth.dto.js';
import { AppError } from '../../core/errors/app-error.js';

export interface RequestMeta {
  ip?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
}

export class UsersService {
  constructor(
    private readonly repo: UsersRepository,
    private readonly auditLogger: AuditLogger,
    private readonly passwordHasher: PasswordHasher
  ) {}

  public async reauthenticate(userId: string, currentPassword: string): Promise<void> {
    const user = await this.repo.getUserProfile(userId);
    const valid = user
      ? await this.passwordHasher.verify(currentPassword, user.password_hash)
      : await this.passwordHasher.dummyVerify();
    if (!user || !valid) {
      throw AppError.forbidden('Current password verification failed', 'REAUTHENTICATION_FAILED');
    }
  }

  public async getProfile(userId: string): Promise<UserDto> {
    const user = await this.repo.getUserProfile(userId);
    if (!user) {
      throw AppError.notFound('User not found');
    }
    return toUserDto(user);
  }

  public async updateProfile(
    userId: string,
    updates: UpdateUserProfileInput,
    meta?: RequestMeta
  ): Promise<UserDto> {
    const updated = await this.repo.updateUserProfile(userId, updates);

    await this.auditLogger.log({
      actorType: 'user',
      actorUserId: userId,
      eventType: 'user.profile.updated',
      outcome: 'success',
      requestId: meta?.requestId,
      ip: meta?.ip,
      userAgent: meta?.userAgent
    });

    return toUserDto(updated);
  }

  public async registerPushDevice(
    userId: string,
    sessionId: string,
    input: RegisterPushDeviceInput
  ): Promise<{ status: string }> {
    await this.repo.upsertPushDevice(userId, sessionId, input);
    return { status: 'registered' };
  }

  public async deletePushDevice(userId: string, deviceId: string): Promise<void> {
    const deleted = await this.repo.deletePushDevice(userId, deviceId);
    if (!deleted) {
      throw AppError.notFound('Push device not found');
    }
  }

  public async scheduleDeletion(
    userId: string,
    meta?: RequestMeta,
    currentSessionId?: string
  ): Promise<{ status: string; deletionScheduledFor: string }> {
    const defaultScheduledFor = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const effectiveScheduledFor = await this.repo.scheduleDeletion(
      userId,
      defaultScheduledFor,
      currentSessionId
    );
    const scheduledIso = (effectiveScheduledFor ?? defaultScheduledFor).toISOString();

    await this.auditLogger.log({
      actorType: 'user',
      actorUserId: userId,
      eventType: 'user.deletion.requested',
      outcome: 'success',
      requestId: meta?.requestId,
      ip: meta?.ip,
      userAgent: meta?.userAgent,
      metadata: { scheduledFor: scheduledIso }
    });

    return {
      status: 'pending_deletion',
      deletionScheduledFor: scheduledIso
    };
  }

  public async cancelDeletion(userId: string, meta?: RequestMeta): Promise<{ status: string }> {
    await this.repo.cancelDeletion(userId);

    await this.auditLogger.log({
      actorType: 'user',
      actorUserId: userId,
      eventType: 'user.deletion.cancelled',
      outcome: 'success',
      requestId: meta?.requestId,
      ip: meta?.ip,
      userAgent: meta?.userAgent
    });

    return { status: 'active' };
  }

  public async purgeAccount(
    userId: string,
    options?: PurgeAccountOptions,
    meta?: RequestMeta
  ): Promise<boolean> {
    const purged = await this.repo.purgeAccount(userId, options);
    if (purged) {
      await this.auditLogger.log({
        actorType: 'system',
        actorUserId: null,
        eventType: 'user.deletion.purged',
        outcome: 'success',
        entityType: 'user',
        entityId: userId,
        requestId: meta?.requestId,
        ip: meta?.ip,
        userAgent: meta?.userAgent
      });
    }
    return purged;
  }

  public async purgeExpiredAccounts(cutoff = new Date()): Promise<number> {
    return this.repo.purgeExpiredAccounts(cutoff);
  }

  public async *streamUserArchive(
    userId: string,
    requestedSignal: AbortSignal,
    meta?: RequestMeta
  ): AsyncGenerator<string> {
    const signal = AbortSignal.any([
      requestedSignal,
      AbortSignal.timeout(ACCOUNT_ARCHIVE_LIMITS.durationMs)
    ]);
    const archive = this.repo.streamUserArchive(userId, signal);
    try {
      while (true) {
        const frame = await archive.next();
        if (!frame.done) {
          yield frame.value;
          continue;
        }
        if (!frame.value || signal.aborted)
          throw AppError.serviceUnavailable('Account archive interrupted; retry later');
        let onAbort: (() => void) | undefined;
        try {
          await Promise.race([
            this.auditLogger.log({
              actorType: 'user',
              actorUserId: userId,
              eventType: 'user.domain_archive.generated',
              outcome: 'success',
              requestId: meta?.requestId,
              ip: meta?.ip,
              userAgent: meta?.userAgent
            }),
            new Promise<never>((_resolve, reject) => {
              onAbort = () =>
                reject(AppError.serviceUnavailable('Account archive interrupted; retry later'));
              signal.addEventListener('abort', onAbort, { once: true });
            })
          ]);
        } finally {
          if (onAbort) signal.removeEventListener('abort', onAbort);
        }
        if (signal.aborted)
          throw AppError.serviceUnavailable('Account archive interrupted; retry later');
        const footer = JSON.stringify({ type: 'complete', ...frame.value }) + '\n';
        if (Buffer.byteLength(footer) > ACCOUNT_ARCHIVE_LIMITS.footerReserveBytes) {
          throw AppError.payloadTooLarge('Account archive summary exceeds the export limit');
        }
        yield footer;
        return;
      }
    } finally {
      await archive.return(undefined);
    }
  }

  public async exportUserData(userId: string, meta?: RequestMeta): Promise<UserExportData> {
    const exportData = await this.repo.getUserExportData(userId);

    await this.auditLogger.log({
      actorType: 'user',
      actorUserId: userId,
      eventType: 'user.data.exported',
      outcome: 'success',
      requestId: meta?.requestId,
      ip: meta?.ip,
      userAgent: meta?.userAgent
    });

    return exportData;
  }
}
