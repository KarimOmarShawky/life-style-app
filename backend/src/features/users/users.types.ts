/**
 * src/features/users/users.types.ts
 *
 * Implements Section 14.3: User Profile & Device Types.
 */

export interface UpdateUserProfileInput {
  displayName?: string | undefined;
  timezone?: string | undefined;
  locale?: string | undefined;
  weekStart?: number | undefined;
  defaultCurrency?: string | undefined;
  pushShowTitles?: boolean | undefined;
}

export interface RegisterPushDeviceInput {
  pushToken: string;
  platform: 'ios' | 'android';
  appVersion?: string | undefined;
}

export interface PushDeviceRecord {
  id: string;
  userId: string;
  sessionId: string;
  platform: 'ios' | 'android';
  pushToken: string;
  appVersion: string | null;
  lastSeenAt: Date;
  disabledAt: Date | null;
  createdAt: Date;
}

export interface UserExportData {
  exportedAt: string;
  profile: {
    id: string;
    email: string;
    displayName: string;
    timezone: string;
    locale: string;
    weekStart: number;
    defaultCurrency: string;
    status: string;
    createdAt: string;
  };
  sessions: Array<{
    id: string;
    devicePlatform: string;
    deviceName: string | null;
    appVersion: string | null;
    createdAt: string;
    lastUsedAt: string;
  }>;
  categories: Array<{
    id: string;
    kind: string;
    name: string;
    color: string | null;
  }>;
  pushDevices: Array<{
    platform: string;
    lastSeenAt: string;
    createdAt: string;
  }>;
}
