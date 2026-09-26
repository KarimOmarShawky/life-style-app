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

export interface UsersRepository {
  getUserProfile(userId: string): Promise<UserRow | null>;
  updateUserProfile(userId: string, updates: UpdateUserProfileInput): Promise<UserRow>;
  upsertPushDevice(
    userId: string,
    sessionId: string,
    input: RegisterPushDeviceInput
  ): Promise<void>;
  deletePushDevice(userId: string, deviceId: string): Promise<boolean>;
  scheduleDeletion(userId: string, scheduledFor: Date): Promise<void>;
  cancelDeletion(userId: string): Promise<void>;
  getUserExportData(userId: string): Promise<UserExportData>;
}
