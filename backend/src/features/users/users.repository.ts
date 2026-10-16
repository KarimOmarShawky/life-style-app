import type { AccountArchiveSummary } from './account-archive.js';
/**
 * src/features/users/users.repository.ts
 *
 * Implements Section 14.3: Users Repository Interface.
 */

import type { UserRow } from '../auth/auth.types.js';
import type {
  UpdateUserProfileInput,
  RegisterPushDeviceInput,
  UserExportData
} from './users.types.js';

export interface PurgeAccountOptions {
  requirePendingDeletion?: boolean | undefined;
  cutoff?: Date | undefined;
}

export interface UsersRepository {
  getUserProfile(userId: string): Promise<UserRow | null>;
  updateUserProfile(userId: string, updates: UpdateUserProfileInput): Promise<UserRow>;
  upsertPushDevice(
    userId: string,
    sessionId: string,
    input: RegisterPushDeviceInput
  ): Promise<void>;
  deletePushDevice(userId: string, deviceId: string): Promise<boolean>;
  scheduleDeletion(userId: string, scheduledFor: Date, currentSessionId?: string): Promise<Date>;
  cancelDeletion(userId: string): Promise<void>;
  purgeAccount(userId: string, options?: PurgeAccountOptions): Promise<boolean>;
  purgeExpiredAccounts(cutoff: Date): Promise<number>;
  getUserExportData(userId: string): Promise<UserExportData>;
  streamUserArchive(
    userId: string,
    signal: AbortSignal
  ): AsyncGenerator<string, AccountArchiveSummary | undefined>;
}
