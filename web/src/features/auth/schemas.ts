/**
 * Auth form schemas — mirror backend `auth.validation.ts` rules.
 */

import { z } from 'zod';
import { emailSchema, passwordSchema } from '@/lib/validation/common';

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required')
});
export type LoginFormValues = z.infer<typeof loginSchema>;

export const registerSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1, 'Display name is required')
      .max(100, 'Display name must not exceed 100 characters'),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string().min(1, 'Confirm your password')
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match'
  })
  .refine((data) => data.password !== data.email, {
    path: ['password'],
    message: 'Password must not match your email address'
  });
export type RegisterFormValues = z.infer<typeof registerSchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema
});
export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    email: emailSchema,
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'Enter the 6-digit code from your email'),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, 'Confirm your new password')
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match'
  })
  .refine((data) => data.newPassword !== data.email, {
    path: ['newPassword'],
    message: 'New password must not match your email address'
  });
export type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;
