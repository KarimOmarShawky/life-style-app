/**
 * Shared validation primitives mirroring the backend's Zod rules.
 * (Backend validation is authoritative; these provide fast, friendly
 * client-side feedback and are re-checked server-side.)
 */

import { z } from 'zod';

export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
export const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export const dateStringSchema = z
  .string()
  .regex(DATE_ONLY_PATTERN, 'Enter a date in YYYY-MM-DD format');

export const timeStringSchema = z.string().regex(TIME_PATTERN, 'Enter a time in HH:mm format');

export const uuidSchema = z.string().uuid('Enter a valid identifier');

export const currencySchema = z
  .string()
  .regex(CURRENCY_PATTERN, 'Use a 3-letter uppercase currency code (e.g. USD)');

/** Positive decimal string (no floats) — money & numeric goal values. */
export const decimalStringSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, 'Enter a valid amount greater than 0')
  .refine((value) => !/^0+(\.0+)?$/.test(value), 'Amount must be greater than 0');

/**
 * Password policy matching backend `passwordSchema`:
 * min 10 characters, max 72 UTF-8 bytes, not a common password.
 */
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

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters long')
  .max(128, 'Password is too long')
  .refine(
    (value) => new TextEncoder().encode(value).length <= 72,
    'Password must not exceed 72 bytes'
  )
  .refine(
    (value) => !COMMON_PASSWORDS.has(value.toLowerCase()),
    'Password is too common; choose a stronger one'
  );

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Email is required')
  .max(254, 'Email must not exceed 254 characters')
  .email('Enter a valid email address');
