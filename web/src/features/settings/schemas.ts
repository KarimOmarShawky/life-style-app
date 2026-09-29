/**
 * Settings form schemas — mirror `users.validation.ts` / `auth.validation.ts`.
 */

import { z } from 'zod';
import { passwordSchema } from '@/lib/validation/common';

export const profileFormSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'Display name cannot be blank')
    .max(100, 'Max 100 characters'),
  timezone: z.string().min(1, 'Timezone is required'),
  locale: z.string().trim().max(16, 'Max 16 characters'),
  weekStart: z.string().regex(/^[1-7]$/, 'Week start must be 1–7'),
  defaultCurrency: z.string().regex(/^[A-Z]{3}$/, 'Must be a 3-letter ISO 4217 code')
});
export type ProfileFormValues = z.infer<typeof profileFormSchema>;

export const changePasswordFormSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordSchema,
    confirmNewPassword: z.string().min(1, 'Confirm the new password')
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    path: ['confirmNewPassword'],
    message: 'Passwords do not match'
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    path: ['newPassword'],
    message: 'New password must be different from the current one'
  });
export type ChangePasswordFormValues = z.infer<typeof changePasswordFormSchema>;

export const changePasswordFormDefaults: ChangePasswordFormValues = {
  currentPassword: '',
  newPassword: '',
  confirmNewPassword: ''
};
