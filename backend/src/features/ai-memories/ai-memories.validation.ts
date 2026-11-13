/**
 * src/features/ai-memories/ai-memories.validation.ts
 *
 * Strict schemas for /api/v1/ai/memories: unknown keys are rejected, texts are
 * trimmed, blank texts and control characters other than tab and line breaks
 * are rejected.
 */
import { z } from 'zod';
import { AI_MEMORY_KINDS, AI_MEMORY_LIMITS, AI_MEMORY_LIST_STATUSES } from './ai-memories.types.js';

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const memoryContent = z
  .string()
  .trim()
  .min(1)
  .max(AI_MEMORY_LIMITS.contentMaxChars)
  .refine((text) => !CONTROL_CHARACTERS.test(text), {
    message: 'content must not contain control characters'
  });

export const createAiMemorySchema = z
  .object({
    kind: z.enum(AI_MEMORY_KINDS),
    content: memoryContent
  })
  .strict();

export const updateAiMemorySchema = z
  .object({
    kind: z.enum(AI_MEMORY_KINDS).optional(),
    content: memoryContent.optional()
  })
  .strict()
  .refine((body) => body.kind !== undefined || body.content !== undefined, {
    message: 'Send kind, content or both'
  });

export const listAiMemoriesQuerySchema = z
  .object({
    status: z.enum(AI_MEMORY_LIST_STATUSES).optional()
  })
  .strict();

export const aiMemoryIdSchema = z.string().uuid();

export type CreateAiMemoryBody = z.infer<typeof createAiMemorySchema>;
export type UpdateAiMemoryBody = z.infer<typeof updateAiMemorySchema>;
