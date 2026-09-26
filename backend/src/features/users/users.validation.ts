/**
 * src/features/users/users.validation.ts
 *
 * Implements Section 14.3: User Profile & Device Zod Schemas.
 */

import { z } from 'zod';

export const updateProfileSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1, { message: 'Display name cannot be blank' })
      .max(100, { message: 'Display name must not exceed 100 characters' })
      .optional(),
    timezone: z.string().optional(),
    locale: z.string().max(16).optional(),
    weekStart: z.number().int().min(1).max(7).optional(),
    defaultCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/, { message: 'Currency must be a 3-letter ISO 4217 uppercase code' })
      .optional(),
    pushShowTitles: z.boolean().optional()
  })
  .strict();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const registerDeviceSchema = z
  .object({
    pushToken: z.string().min(1).max(512, { message: 'Push token must not exceed 512 characters' }),
    platform: z.enum(['ios', 'android']),
    appVersion: z.string().max(32).optional()
  })
  .strict();

export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;

export const deviceIdParamSchema = z
  .object({
    deviceId: z.string().uuid({ message: 'Device ID must be a valid UUID' })
  })
  .strict();
