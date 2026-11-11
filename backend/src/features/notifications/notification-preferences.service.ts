/**
 * src/features/notifications/notification-preferences.service.ts
 *
 * Feature guide G2 (ADR-046): read and replace the account's notification
 * settings. The response always says which time zone the times are read in.
 */

import { AppError } from '../../core/errors/app-error.js';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  formatClockMinute,
  parseClockMinute,
  type NotificationPreferences
} from './notification-policy.js';
import type { NotificationPreferencesStore } from './notification-preferences.repository.pg.js';
import type { NotificationPreferencesBody } from './notification-preferences.validation.js';

export interface NotificationPreferencesView {
  notificationsEnabled: boolean;
  quietHours: { start: string; end: string } | null;
  dailyLimit: number | null;
  digestEnabled: boolean;
  criticalBreaksQuiet: boolean;
  /** Account time zone (users.timezone) that quiet hours and days are read in. */
  timeZone: string;
  /** False until the owner-run SQL is applied: the defaults are shown and saving fails. */
  available: boolean;
}

export function toPreferencesView(
  preferences: NotificationPreferences,
  timeZone: string,
  available: boolean
): NotificationPreferencesView {
  const { quietStartMinute: start, quietEndMinute: end } = preferences;
  return {
    notificationsEnabled: preferences.notificationsEnabled,
    quietHours:
      start !== null && end !== null && start !== end
        ? { start: formatClockMinute(start), end: formatClockMinute(end) }
        : null,
    dailyLimit: preferences.dailyCap,
    digestEnabled: preferences.digestEnabled,
    criticalBreaksQuiet: preferences.criticalBreaksQuiet,
    timeZone,
    available
  };
}

export function preferencesFromBody(body: NotificationPreferencesBody): NotificationPreferences {
  return {
    notificationsEnabled: body.notificationsEnabled,
    quietStartMinute: body.quietHours ? parseClockMinute(body.quietHours.start) : null,
    quietEndMinute: body.quietHours ? parseClockMinute(body.quietHours.end) : null,
    dailyCap: body.dailyLimit,
    digestEnabled: body.digestEnabled,
    criticalBreaksQuiet: body.criticalBreaksQuiet
  };
}

export class NotificationPreferencesService {
  constructor(private readonly store: NotificationPreferencesStore) {}

  public async get(userId: string, timeZone: string): Promise<NotificationPreferencesView> {
    const stored = await this.store.find(userId);
    if (!stored.available) {
      return toPreferencesView(DEFAULT_NOTIFICATION_PREFERENCES, timeZone, false);
    }
    return toPreferencesView(
      stored.preferences ?? DEFAULT_NOTIFICATION_PREFERENCES,
      timeZone,
      true
    );
  }

  public async replace(
    userId: string,
    timeZone: string,
    body: NotificationPreferencesBody
  ): Promise<NotificationPreferencesView> {
    const preferences = preferencesFromBody(body);
    const result = await this.store.save(userId, preferences);
    if (!result.available) {
      throw new AppError({
        httpStatus: 503,
        code: 'NOTIFICATION_PREFERENCES_UNAVAILABLE',
        safeMessage: 'Notification settings cannot be saved yet',
        isOperational: true
      });
    }
    if (!result.saved) {
      throw AppError.notFound('Account not found');
    }
    return toPreferencesView(preferences, timeZone, true);
  }
}
