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
  productEventsEnabled?: boolean | undefined;
  onboardingCompleted?: true | undefined;
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
    /** Present once the product-events schema (migration 1792750000000) exists. */
    productEventsEnabled?: boolean;
    onboardingCompletedAt?: string | null;
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
  /** Notification settings (G2); null when never saved or the schema is not yet applied. */
  notificationPreferences: {
    notificationsEnabled: boolean;
    quietHours: { start: string; end: string } | null;
    dailyLimit: number | null;
    digestEnabled: boolean;
    criticalBreaksQuiet: boolean;
    updatedAt: string;
  } | null;
  /** Content-free usage events (G5); empty when none exist or the schema is not yet applied. */
  productEvents: Array<{
    event: string;
    occurredAt: string;
    occurredOn: string;
    platform: string;
    appVersion: string | null;
  }>;
  /** In-app reports of AI output (AI-P); empty when none exist or the schema is not yet applied. */
  aiContentReports: Array<{
    surface: string;
    category: string;
    replyText: string | null;
    note: string | null;
    locale: string;
    createdAt: string;
  }>;
}
