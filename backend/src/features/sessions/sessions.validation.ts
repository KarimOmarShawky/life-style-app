/**
 * src/features/sessions/sessions.validation.ts
 *
 * Feature guide G6 (ADR-047). Strict input for the sessions API: the session
 * id in the path and, for revoking, the current password and nothing else.
 */

import { z } from 'zod';

export const sessionIdParamsSchema = z.object({ id: z.string().uuid() }).strict();

/** Same shape and limits as the other re-authenticated account actions. */
export const revokeSessionSchema = z
  .object({ currentPassword: z.string().min(1).max(1024) })
  .strict();
