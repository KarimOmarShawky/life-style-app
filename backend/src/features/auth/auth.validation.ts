/**
 * src/features/auth/auth.validation.ts
 *
 * Implements Section 8.4 & 14.2: Zod validation schemas for Authentication.
 * Enforces strict object parsing, 10-72 byte password policy, and common password denylist.
 */

import { z } from 'zod';

const COMMON_PASSWORDS = new Set([
  'password123',
  '1234567890',
  'qwertyuiop',
  'lifestyle123',
  'admin12345',
  'welcome123',
  'password1234',
  'changeme123'
]);

// Reusable password schema conforming to Section 8.4:
// Minimum 10 characters, maximum 72 bytes (UTF-8), non-blank, common password check.
export const passwordSchema = z
  .string()
  .min(10, { message: 'Password must be at least 10 characters long' })
  .refine((val) => Buffer.byteLength(val, 'utf8') <= 72, {
    message: 'Password must not exceed 72 bytes'
  })
  .refine((val) => !COMMON_PASSWORDS.has(val.toLowerCase()), {
    message: 'Password is too common; please select a stronger password'
  });

export const deviceSchema = z
  .object({
    platform: z.enum(['ios', 'android', 'unknown']),
    name: z.string().max(100).optional(),
    appVersion: z.string().max(32).optional()
  })
  .strict();

export const registerSchema = z
  .object({
    email: z
      .string()
      .email({ message: 'A valid email address is required' })
      .max(254, { message: 'Email must not exceed 254 characters' })
      .transform((val) => val.trim().toLowerCase()),
    password: passwordSchema,
    displayName: z
      .string()
      .trim()
      .min(1, { message: 'Display name cannot be blank' })
      .max(100, { message: 'Display name must not exceed 100 characters' }),
    timezone: z.string().default('UTC'),
    defaultCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/, { message: 'Currency must be a 3-letter ISO 4217 uppercase code' })
      .default('USD'),
    locale: z.string().max(16).default('en'),
    device: deviceSchema.optional()
  })
  .strict()
  .refine((data) => data.password !== data.email, {
    path: ['password'],
    message: 'Password must not match email address'
  });

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z
  .object({
    email: z
      .string()
      .email({ message: 'A valid email address is required' })
      .transform((val) => val.trim().toLowerCase()),
    password: z.string().min(1, { message: 'Password is required' }),
    device: deviceSchema.optional()
  })
  .strict();

export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z
  .object({
    refreshToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/, {
      message: 'Refresh token must be a 43-character base64url string'
    })
  })
  .strict();

export type RefreshInput = z.infer<typeof refreshSchema>;

export const logoutSchema = z
  .object({
    refreshToken: z.string().optional()
  })
  .strict();

export type LogoutInput = z.infer<typeof logoutSchema>;

export const forgotPasswordSchema = z
  .object({
    email: z
      .string()
      .email({ message: 'A valid email address is required' })
      .transform((val) => val.trim().toLowerCase())
  })
  .strict();

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    email: z
      .string()
      .email({ message: 'A valid email address is required' })
      .transform((val) => val.trim().toLowerCase()),
    code: z.string().regex(/^\d{6}$/, { message: 'Reset code must be exactly 6 digits' }),
    newPassword: passwordSchema
  })
  .strict()
  .refine((data) => data.newPassword !== data.email, {
    path: ['newPassword'],
    message: 'New password must not match email address'
  });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, { message: 'Current password is required' }),
    newPassword: passwordSchema
  })
  .strict()
  .refine((data) => data.currentPassword !== data.newPassword, {
    path: ['newPassword'],
    message: 'New password must be different from current password'
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
