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
    private readonly auditLogger: AuditLogger
  ) {}

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
