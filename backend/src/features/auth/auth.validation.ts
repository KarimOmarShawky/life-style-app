/**
 * Auth request schemas (spec section 13).
 *
 * These run before any service code. Note what the schemas do beyond checking
 * types: they normalize. Email is lower-cased and trimmed here, once, so the
 * database's lowercase constraint can never be violated and lookups cannot miss
 * because of casing.
 */
import { z } from 'zod';

import { BcryptPasswordHasher } from '@/core/security/password-hasher';

/**
 * Passwords are capped at bcrypt's 72-BYTE input limit, measured in bytes rather
 * than characters because multi-byte characters would otherwise let a user set a
 * password whose tail is silently ignored at verification.
 */
const MIN_PASSWORD_LENGTH = 12;

export const passwordSchema = z
  .string({ required_error: 'password is required' })
  .min(MIN_PASSWORD_LENGTH, `password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  .refine(
    (value) => Buffer.byteLength(value, 'utf8') <= BcryptPasswordHasher.MAX_PASSWORD_BYTES,
    `password must be at most ${BcryptPasswordHasher.MAX_PASSWORD_BYTES} bytes`,
  )
  .refine(
    (value) => /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value),
    'password must contain a lowercase letter, an uppercase letter, and a digit',
  );

export const emailSchema = z
  .string({ required_error: 'email is required' })
  .trim()
  .toLowerCase()
  .email('email must be a valid address')
  .max(254, 'email must be at most 254 characters');

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    displayName: z.string().trim().min(1).max(80).optional(),
  })
  // `.strict()` rejects unknown keys outright rather than stripping them. On the
  // registration endpoint that is the stronger choice: a client sending
  // `{ role: "admin" }` gets a 422 telling them it is not accepted, instead of a
  // silent success that hides an attempted privilege escalation from the logs.
  .strict();

export const loginSchema = z
  .object({
    email: emailSchema,
    // Deliberately only a presence check. Applying the registration policy here
    // would reject a legacy password that predates a policy change, and would
    // tell an attacker which submitted strings could possibly be real passwords.
    password: z.string().min(1, 'password is required'),
  })
  .strict();

export const refreshSchema = z
  .object({
    refreshToken: z.string().min(1).optional(),
  })
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'currentPassword is required'),
    newPassword: passwordSchema,
  })
  .strict()
  .refine((value) => value.currentPassword !== value.newPassword, {
    path: ['newPassword'],
    message: 'newPassword must differ from currentPassword',
  });

export type RegisterBody = z.infer<typeof registerSchema>;
export type LoginBody = z.infer<typeof loginSchema>;
export type RefreshBody = z.infer<typeof refreshSchema>;
export type ChangePasswordBody = z.infer<typeof changePasswordSchema>;
