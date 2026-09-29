/**
 * Auth API operations — verified against `auth.routes.ts`, `auth.controller.ts`,
 * `auth.validation.ts`, and `auth.service.ts`.
 */

import { rawApiFetch } from '@/lib/api/client';
import type { AuthResponseDto, LoginBody, RegisterBody, UserDto } from '@/types/api';

export const authApi = {
  register(body: RegisterBody): Promise<AuthResponseDto> {
    return rawApiFetch<AuthResponseDto>('/auth/register', { method: 'POST', body });
  },

  login(body: LoginBody): Promise<AuthResponseDto> {
    return rawApiFetch<AuthResponseDto>('/auth/login', { method: 'POST', body });
  },

  /** Runtime returns 202 with an empty body (timing-equalized). */
  forgotPassword(body: { email: string }): Promise<void> {
    return rawApiFetch<void>('/auth/forgot-password', { method: 'POST', body });
  },

  resetPassword(body: { email: string; code: string; newPassword: string }): Promise<void> {
    return rawApiFetch<void>('/auth/reset-password', { method: 'POST', body });
  }
};

export type { UserDto };
