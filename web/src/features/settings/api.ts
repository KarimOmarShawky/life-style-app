/**
 * Users/Settings API — verified against `users.routes.ts`, `users.controller.ts`,
 * `users.service.ts`, `users.validation.ts`.
 *
 * Corrections vs OpenAPI:
 * - Export is `POST /users/me/export` (not GET) and returns JSON:
 *   `{exportedAt, profile, sessions, categories, pushDevices}` — it does NOT
 *   include tasks, projects, money, notes, habits, goals, or events.
 * - Deletion lifecycle: `POST /users/me/deletion` (schedule → 200
 *   `{status:'pending_deletion', deletionScheduledFor}`),
 *   `DELETE /users/me/deletion` (cancel → 200 `{status}`).
 *   There is NO `GET /deletion-status`; after a reload the scheduled date
 *   cannot be re-fetched (only `user.status`).
 * - No `DELETE /users/me`; deletion happens server-side after the grace period.
 * - While `pending_deletion`, the only API calls allowed are: logout, refresh,
 *   GET /users/me, DELETE /users/me/deletion, POST /users/me/export
 *   (see PENDING_DELETION_EXEMPT_ENDPOINTS in authenticate.ts).
 * - Push device registration (PUT /users/me/devices) is intentionally NOT
 *   called from the browser.
 */

import { apiFetch, rawApiFetch } from '@/lib/api/client';
import type { AuthSession } from '@/lib/auth/session';
import type { DeletionStatusResponse, UpdateProfileBody, UserDto } from '@/types/api';

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

export const settingsApi = {
  getProfile(auth: AuthSession): Promise<{ user: UserDto }> {
    return apiFetch<{ user: UserDto }>('/users/me', { auth });
  },

  updateProfile(body: UpdateProfileBody, auth: AuthSession): Promise<{ user: UserDto }> {
    return apiFetch<{ user: UserDto }>('/users/me', { method: 'PATCH', body, auth });
  },

  scheduleDeletion(auth: AuthSession): Promise<DeletionStatusResponse> {
    return apiFetch<DeletionStatusResponse>('/users/me/deletion', { method: 'POST', auth });
  },

  cancelDeletion(auth: AuthSession): Promise<{ status: string }> {
    return apiFetch<{ status: string }>('/users/me/deletion', { method: 'DELETE', auth });
  },

  exportData(auth: AuthSession): Promise<UserExportData> {
    return apiFetch<UserExportData>('/users/me/export', { method: 'POST', auth });
  }
};

export const settingsAuthApi = {
  /** 204 — different from the 200s elsewhere. */
  changePassword(body: { currentPassword: string; newPassword: string }): Promise<void> {
    return rawApiFetch<void>('/auth/change-password', { method: 'POST', body });
  }
};
